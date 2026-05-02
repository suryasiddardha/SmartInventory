const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { tableExists } = require("../lib/schema-utils");
const { asyncHandler } = require("../src/shared/http/async-handler");

const router = express.Router();
router.use(authenticate);

router.get("/overview", asyncHandler(async (req, res) => {
  const isLeader = ["admin", "manager"].includes(req.user.role);
  const roleFilter = isLeader ? "u.status = 'active'" : "u.id = ?";
  const roleParams = isLeader ? [] : [req.user.id];

  const [teamPerformance] = await db.query(`
    SELECT
      u.id,
      u.username,
      u.role,
      COUNT(al.id) AS totalActions,
      SUM(CASE WHEN al.entity_type = 'order' THEN 1 ELSE 0 END) AS ordersProcessed,
      SUM(CASE WHEN al.entity_type = 'inventory' THEN 1 ELSE 0 END) AS inventoryUpdates,
      SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) AS successfulActions,
      ROUND(
        (SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) / NULLIF(COUNT(al.id), 0)) * 100,
        2
      ) AS accuracyRate
    FROM users u
    LEFT JOIN activity_logs al
      ON al.user_id = u.id
     AND al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    WHERE ${roleFilter}
    GROUP BY u.id
    ORDER BY ordersProcessed DESC, totalActions DESC
  `, roleParams);

  const [recentActivity] = await db.query(`
    SELECT
      al.id,
      al.created_at,
      al.action_type,
      al.entity_type,
      al.details,
      al.status,
      u.username
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ${isLeader ? "" : "WHERE al.user_id = ?"}
    ORDER BY al.created_at DESC
    LIMIT 20
  `, isLeader ? [] : [req.user.id]);

  const tasksEnabled = await tableExists(db, "staff_tasks") && await tableExists(db, "staff_task_updates");
  let taskSummary = null;
  let taskQueue = [];
  let recentTaskUpdates = [];

  if (tasksEnabled) {
    const [summaryRows] = await db.query(`
      SELECT
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_tasks,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_tasks,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN due_date IS NOT NULL AND due_date < NOW() AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS overdue_tasks
      FROM staff_tasks
      ${isLeader ? "" : "WHERE assigned_to = ?"}
    `, isLeader ? [] : [req.user.id]);
    taskSummary = summaryRows[0];

    const [queueRows] = await db.query(`
      SELECT
        st.id,
        st.title,
        st.task_type,
        st.priority,
        st.status,
        st.due_date,
        st.created_at,
        st.remarks,
        assignee.username AS assigned_to_name,
        assigner.username AS assigned_by_name,
        i.product_name,
        s.company_name AS supplier_name
      FROM staff_tasks st
      JOIN users assignee ON assignee.id = st.assigned_to
      JOIN users assigner ON assigner.id = st.assigned_by
      LEFT JOIN inventory i ON i.id = st.inventory_id
      LEFT JOIN suppliers s ON s.id = st.supplier_id
      ${isLeader ? "" : "WHERE st.assigned_to = ?"}
      ORDER BY
        CASE
          WHEN st.status = 'blocked' THEN 0
          WHEN st.status IN ('pending', 'in_progress') THEN 1
          ELSE 2
        END,
        CASE WHEN st.due_date IS NULL THEN 1 ELSE 0 END,
        st.due_date ASC,
        st.created_at DESC
      LIMIT 12
    `, isLeader ? [] : [req.user.id]);
    taskQueue = queueRows.map((task) => ({
      ...task,
      is_overdue: task.due_date
        ? !["completed", "cancelled"].includes(task.status) && new Date(task.due_date) < new Date()
        : false,
    }));

    const [updateRows] = await db.query(`
      SELECT
        stu.id,
        stu.old_status,
        stu.new_status,
        stu.comment,
        stu.created_at,
        st.title,
        u.username AS updated_by_name
      FROM staff_task_updates stu
      JOIN staff_tasks st ON st.id = stu.task_id
      JOIN users u ON u.id = stu.updated_by
      ${isLeader ? "" : "WHERE st.assigned_to = ?"}
      ORDER BY stu.created_at DESC
      LIMIT 12
    `, isLeader ? [] : [req.user.id]);
    recentTaskUpdates = updateRows;
  }

  res.json({
    scope: isLeader ? "team" : "personal",
    teamPerformance,
    recentActivity,
    taskSummary,
    taskQueue,
    recentTaskUpdates,
    tasksEnabled,
  });
}));

router.get("/audits/recent", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      al.id,
      al.created_at,
      al.action_type,
      al.entity_type,
      al.entity_id,
      al.details,
      al.status,
      u.username
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT 50
  `);

  res.json(rows);
}));

// Manager dashboard - Team health overview
router.get("/team-health", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const tasksEnabled = await tableExists(db, "staff_tasks");

  // Get team members and their status
  const [teamMembers] = await db.query(`
    SELECT
      u.id,
      u.username,
      u.role,
      u.department,
      u.status,
      COUNT(DISTINCT al.id) AS recent_actions,
      SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) AS successful_actions,
      ROUND(SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) / NULLIF(COUNT(al.id), 0) * 100, 2) AS success_rate
    FROM users u
    LEFT JOIN activity_logs al ON al.user_id = u.id AND al.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    WHERE u.status = 'active' AND u.role IN ('manager', 'staff')
    GROUP BY u.id
    ORDER BY u.role ASC, u.username ASC
  `);

  let taskHealth = null;
  if (tasksEnabled) {
    const [taskStats] = await db.query(`
      SELECT
        COUNT(*) AS total_open_tasks,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_tasks,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_tasks,
        SUM(CASE WHEN status = 'blocked' THEN 1 ELSE 0 END) AS blocked_tasks,
        SUM(CASE WHEN due_date IS NOT NULL AND due_date < NOW() AND status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) AS overdue_tasks,
        COUNT(DISTINCT assigned_to) AS team_members_with_tasks,
        ROUND(AVG(CASE WHEN completed_at IS NOT NULL THEN DATEDIFF(completed_at, created_at) ELSE NULL END), 1) AS avg_completion_days
      FROM staff_tasks
      WHERE status NOT IN ('completed', 'cancelled')
    `);
    taskHealth = taskStats[0];
  }

  res.json({
    generated_at: new Date().toISOString(),
    team_size: teamMembers.length,
    team_members: teamMembers,
    task_health: taskHealth,
    tasks_enabled: tasksEnabled,
  });
}));

// Get critical alerts for manager
router.get("/alerts", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const tasksEnabled = await tableExists(db, "staff_tasks");
  const alerts = [];

  // Check for overdue tasks
  if (tasksEnabled) {
    const [overdueTasks] = await db.query(`
      SELECT COUNT(*) AS count FROM staff_tasks
      WHERE due_date IS NOT NULL AND due_date < NOW()
        AND status NOT IN ('completed', 'cancelled')
    `);
    if (overdueTasks[0].count > 0) {
      alerts.push({
        severity: "high",
        type: "overdue_tasks",
        message: `${overdueTasks[0].count} tasks are overdue`,
        count: overdueTasks[0].count,
      });
    }

    // Check for blocked tasks
    const [blockedTasks] = await db.query(`
      SELECT COUNT(*) AS count FROM staff_tasks WHERE status = 'blocked'
    `);
    if (blockedTasks[0].count > 0) {
      alerts.push({
        severity: "high",
        type: "blocked_tasks",
        message: `${blockedTasks[0].count} tasks are blocked`,
        count: blockedTasks[0].count,
      });
    }
  }

  // Check for low stock
  const [lowStock] = await db.query(`
    SELECT COUNT(*) AS count FROM inventory
    WHERE status IN ('low-stock', 'critical')
  `);
  if (lowStock[0].count > 0) {
    alerts.push({
      severity: lowStock[0].count > 5 ? "high" : "medium",
      type: "low_stock",
      message: `${lowStock[0].count} items have low or critical stock`,
      count: lowStock[0].count,
    });
  }

  // Check for out of stock
  const [outOfStock] = await db.query(`
    SELECT COUNT(*) AS count FROM inventory WHERE status = 'out-of-stock'
  `);
  if (outOfStock[0].count > 0) {
    alerts.push({
      severity: "high",
      type: "out_of_stock",
      message: `${outOfStock[0].count} items are out of stock`,
      count: outOfStock[0].count,
    });
  }

  // Check for inactive suppliers
  const [inactiveSuppliers] = await db.query(`
    SELECT COUNT(*) AS count FROM suppliers WHERE status != 'active'
  `);
  if (inactiveSuppliers[0].count > 0) {
    alerts.push({
      severity: "medium",
      type: "inactive_suppliers",
      message: `${inactiveSuppliers[0].count} suppliers are not active`,
      count: inactiveSuppliers[0].count,
    });
  }

  res.json({
    generated_at: new Date().toISOString(),
    alert_count: alerts.length,
    alerts: alerts.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    }),
  });
}));

// Get inventory health status
router.get("/inventory-health", asyncHandler(async (req, res) => {
  const [[health]] = await db.query(`
    SELECT
      COUNT(*) AS total_items,
      SUM(CASE WHEN status = 'in-stock' THEN 1 ELSE 0 END) AS in_stock,
      SUM(CASE WHEN status = 'low-stock' THEN 1 ELSE 0 END) AS low_stock,
      SUM(CASE WHEN status = 'critical' THEN 1 ELSE 0 END) AS critical_stock,
      SUM(CASE WHEN status = 'out-of-stock' THEN 1 ELSE 0 END) AS out_of_stock,
      ROUND(SUM(CASE WHEN status = 'in-stock' THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS in_stock_percentage,
      ROUND(SUM(stock * price), 2) AS total_inventory_value,
      ROUND(AVG(stock), 0) AS avg_stock_level
    FROM inventory
  `);

  res.json({
    generated_at: new Date().toISOString(),
    inventory_health: health,
  });
}));

// Get recent performance metrics by category
router.get("/performance-by-category", asyncHandler(async (req, res) => {
  const [categories] = await db.query(`
    SELECT
      i.category,
      COUNT(*) AS total_items,
      SUM(CASE WHEN i.status IN ('low-stock', 'critical', 'out-of-stock') THEN 1 ELSE 0 END) AS problem_items,
      ROUND(SUM(CASE WHEN i.status IN ('low-stock', 'critical', 'out-of-stock') THEN 1 ELSE 0 END) / COUNT(*) * 100, 2) AS problem_percentage,
      ROUND(SUM(i.stock * i.price), 2) AS category_value,
      COALESCE(ROUND(AVG(i.low_stock_point), 0), 20) AS avg_low_stock_point,
      ROUND(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) THEN o.items_count ELSE 0 END), 0) AS sales_last_30_days
    FROM inventory i
    LEFT JOIN orders o ON o.inventory_id = i.id AND o.status != 'cancelled'
    GROUP BY i.category
    ORDER BY category ASC
  `);

  res.json({
    generated_at: new Date().toISOString(),
    categories,
  });
}));

// Download audit logs as Excel with date range
router.get("/audits/export", authorize("admin"), asyncHandler(async (req, res) => {
  const dateFrom = req.query.from;
  const dateTo = req.query.to;

  if (!dateFrom || !dateTo) {
    return res.status(400).json({ error: "Both 'from' and 'to' dates are required." });
  }

  const [rows] = await db.query(`
    SELECT
      al.id,
      al.created_at,
      al.action_type,
      al.entity_type,
      al.entity_id,
      al.details,
      al.status,
      u.username
    FROM activity_logs al
    LEFT JOIN users u ON u.id = al.user_id
    WHERE al.created_at >= ? AND al.created_at <= DATE_ADD(?, INTERVAL 1 DAY)
    ORDER BY al.created_at DESC
  `, [dateFrom, dateTo]);

  function fmtDateTime(val) {
    if (!val) return "";
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true
    });
  }

  const headers = ["Log ID", "Date & Time", "User", "Action", "Entity", "Entity ID", "Details", "Status"];
  const tableRows = rows.map(row => `
    <tr>
      <td>${row.id}</td>
      <td>${fmtDateTime(row.created_at)}</td>
      <td>${row.username || ""}</td>
      <td>${row.action_type || ""}</td>
      <td>${row.entity_type || ""}</td>
      <td>${row.entity_id || ""}</td>
      <td>${(row.details || "").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>
      <td>${row.status || ""}</td>
    </tr>
  `).join("");

  const workbookHtml = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body style="font-family: Arial, sans-serif;">
        <h2>Audit Logs Report</h2>
        <p>
          <strong>Date Range:</strong> ${dateFrom} to ${dateTo}<br/>
          <strong>Total Entries:</strong> ${rows.length}
        </p>
        <table border="1" cellpadding="5" cellspacing="0">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join("")}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
    </html>
  `;

  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="audit-logs-${dateFrom}-to-${dateTo}.xls"`);
  res.send(workbookHtml);
}));

router.get("/backup", authorize("admin"), asyncHandler(async (req, res) => {
  try {
    const tables = [
      "users", "inventory", "suppliers", "supplier_products", 
      "inventory_batches", "customers", "orders", 
      "order_batch_usage", "inventory_movements", "activity_logs"
    ];

    let sqlOutput = `-- Smart Inventory Backup\n-- Generated: ${new Date().toISOString()}\n\n`;
    sqlOutput += "SET FOREIGN_KEY_CHECKS = 0;\n\n";

    for (const table of tables) {
      // eslint-disable-next-line no-await-in-loop
      const [rows] = await db.query(`SELECT * FROM ${table}`);
      if (rows.length > 0) {
        sqlOutput += `-- Data for table ${table}\n`;
        const columns = Object.keys(rows[0]).map(c => `\`${c}\``).join(", ");
        
        for (const row of rows) {
          const values = Object.values(row).map(val => {
            if (val === null) return "NULL";
            if (typeof val === "string") return `'${val.replace(/'/g, "''")}'`;
            if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace("T", " ")}'`;
            return val;
          }).join(", ");
          sqlOutput += `INSERT INTO \`${table}\` (${columns}) VALUES (${values});\n`;
        }
        sqlOutput += "\n";
      }
    }

    sqlOutput += "SET FOREIGN_KEY_CHECKS = 1;\n";

    res.setHeader("Content-Type", "application/sql");
    res.setHeader("Content-Disposition", `attachment; filename=smart-inventory-backup-${new Date().toISOString().split("T")[0]}.sql`);
    res.send(sqlOutput);
  } catch (err) {
    console.error("Backup failed:", err);
    res.status(500).json({ error: "Failed to generate backup." });
  }
}));

module.exports = router;
