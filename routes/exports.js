const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");

const router = express.Router();
router.use(authenticate, authorize("admin", "manager"));

function escapeCsv(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  if (normalized.includes(",") || normalized.includes('"') || normalized.includes("\n")) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
}

function formatINR(value) {
  const amount = Number(value || 0);
  return `₹${amount.toFixed(2)}`;
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric"
  });
}

function formatDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true
  });
}

function buildMinimalPdf(lines) {
  const safeLines = lines.map((line) =>
    String(line).replace(/[^\x20-\x7E]/g, "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
  );

  let stream = "BT\n/F1 12 Tf\n50 780 Td\n14 TL\n";
  safeLines.forEach((line, index) => {
    if (index === 0) {
      stream += `(${line}) Tj\n`;
    } else {
      stream += `T*\n(${line}) Tj\n`;
    }
  });
  stream += "ET";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

router.get("/daily", async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const [rows] = await db.query(`
      SELECT
        o.id,
        o.order_date,
        o.customer_name,
        o.items_count,
        o.total_amount,
        o.status,
        i.product_name,
        i.category,
        u.username AS created_by_name
      FROM orders o
      LEFT JOIN inventory i ON i.id = o.inventory_id
      LEFT JOIN users u ON u.id = o.created_by
      WHERE o.order_date = ?
      ORDER BY o.created_at DESC
    `, [date]);

    if (format === "csv") {
      const headers = ["Order ID", "Date", "Customer", "Product", "Category", "Qty", "Total", "Status", "Created By"];
      const csv = [
        headers.join(","),
        ...rows.map((row) => [
          row.id,
          formatDateTime(row.created_at),
          escapeCsv(row.customer_name),
          escapeCsv(row.product_name),
          escapeCsv(row.category),
          row.items_count,
          escapeCsv(formatINR(row.total_amount)),
          row.status,
          escapeCsv(row.created_by_name),
        ].join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="daily-orders-${date}.csv"`);
      return res.send(csv);
    }

    if (format === "excel" || format === "xlsx") {
      const headers = ["Order ID", "Date", "Customer", "Product", "Category", "Qty", "Total", "Status", "Created By"];
      const tableRows = rows.map((row) => `
        <tr>
          <td>${row.id}</td>
          <td>${formatDateTime(row.created_at)}</td>
          <td>${row.customer_name || ""}</td>
          <td>${row.product_name || ""}</td>
          <td>${row.category || ""}</td>
          <td>${row.items_count}</td>
          <td>${formatINR(row.total_amount)}</td>
          <td>${row.status}</td>
          <td>${row.created_by_name || ""}</td>
        </tr>
      `).join("");

      const workbookHtml = `
        <html>
          <head><meta charset="utf-8" /></head>
          <body>
            <table border="1">
              <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `;

      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="daily-orders-${date}.xls"`);
      return res.send(workbookHtml);
    }

    if (format === "pdf") {
      const totals = rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
      const lines = [
        `Daily Orders Report - ${date}`,
        `Orders: ${rows.length}`,
        `Revenue: ${formatINR(totals)}`,
        "",
        ...rows.flatMap((row) => [
          `#${row.id} | ${row.customer_name} | ${row.product_name || "Item"} | Qty ${row.items_count} | ${formatINR(row.total_amount)} | ${row.status}`,
        ]),
      ];

      const pdfBuffer = buildMinimalPdf(lines);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="daily-orders-${date}.pdf"`);
      return res.send(pdfBuffer);
    }

    res.json({
      date,
      totalOrders: rows.length,
      totalRevenue: Number(rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0).toFixed(2)),
      orders: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to export daily orders." });
  }
});

// Advanced order reports with filtering
router.get("/orders/report", async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const dateFrom = req.query.date_from || req.query.from;
    const dateTo = req.query.date_to || req.query.to;
    const status = req.query.status;
    const productId = req.query.product_id;
    const staffId = req.query.staff_id;
    const category = req.query.category;

    let query = `
      SELECT
        o.id,
        o.order_date,
        o.customer_name,
        o.items_count,
        o.total_amount,
        o.status,
        i.id AS product_id,
        i.product_name,
        i.category,
        i.sku,
        i.price,
        u.username AS created_by_name,
        o.created_at
      FROM orders o
      LEFT JOIN inventory i ON i.id = o.inventory_id
      LEFT JOIN users u ON u.id = o.created_by
      WHERE 1=1
    `;
    const params = [];

    if (dateFrom) {
      query += " AND o.order_date >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      query += " AND o.order_date <= ?";
      params.push(dateTo);
    }
    if (status) {
      query += " AND o.status = ?";
      params.push(status);
    }
    if (productId) {
      query += " AND o.inventory_id = ?";
      params.push(productId);
    }
    if (staffId) {
      query += " AND o.created_by = ?";
      params.push(staffId);
    }
    if (category) {
      query += " AND i.category = ?";
      params.push(category);
    }

    query += " ORDER BY o.order_date DESC, o.created_at DESC";

    const [rows] = await db.query(query, params);

    // Calculate summary stats
    const summary = {
      total_orders: rows.length,
      total_revenue: Number(rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0).toFixed(2)),
      total_items: rows.reduce((sum, row) => sum + row.items_count, 0),
      avg_order_value: rows.length > 0 ? Number((rows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0) / rows.length).toFixed(2)) : 0,
      orders_by_status: {},
    };

    rows.forEach(row => {
      summary.orders_by_status[row.status] = (summary.orders_by_status[row.status] || 0) + 1;
    });

    if (format === "csv") {
      const headers = ["Order ID", "Date", "Customer", "Product", "SKU", "Category", "Qty", "Unit Price", "Total", "Status", "Created By"];
      const csv = [
        `# Order Report ${new Date().toISOString().slice(0, 10)}`,
        `# Total Orders: ${summary.total_orders}, Total Revenue: ${formatINR(summary.total_revenue)}`,
        `# Filters: ${[dateFrom ? `From ${dateFrom}` : '', dateTo ? `To ${dateTo}` : '', status ? `Status: ${status}` : ''].filter(Boolean).join(', ')}`,
        "",
        headers.join(","),
        ...rows.map((row) => [
          row.id,
          formatDateTime(row.created_at),
          escapeCsv(row.customer_name),
          escapeCsv(row.product_name || "Unknown"),
          escapeCsv(row.sku || ""),
          escapeCsv(row.category || ""),
          row.items_count,
          escapeCsv(formatINR(row.price)),
          escapeCsv(formatINR(row.total_amount)),
          row.status,
          escapeCsv(row.created_by_name || ""),
        ].join(",")),
        "",
        `Summary Statistics`,
        `Total Orders,${summary.total_orders}`,
        `Total Revenue,${formatINR(summary.total_revenue)}`,
        `Avg Order Value,${formatINR(summary.avg_order_value)}`,
        ...Object.entries(summary.orders_by_status).map(([s, c]) => `Orders (${s}),${c}`),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="orders-report-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv"`);
      return res.send(csv);
    }

    if (format === "excel" || format === "xlsx") {
      const headers = ["Order ID", "Date", "Customer", "Product", "SKU", "Category", "Qty", "Unit Price", "Total", "Status", "Created By"];
      const tableRows = rows.map((row) => `
        <tr>
          <td>${row.id}</td>
          <td>${formatDateTime(row.created_at)}</td>
          <td>${row.customer_name || ""}</td>
          <td>${row.product_name || ""}</td>
          <td>${row.sku || ""}</td>
          <td>${row.category || ""}</td>
          <td>${row.items_count}</td>
          <td>${formatINR(row.price)}</td>
          <td>${formatINR(row.total_amount)}</td>
          <td>${row.status}</td>
          <td>${row.created_by_name || ""}</td>
        </tr>
      `).join("");

      const summaryRows = Object.entries(summary.orders_by_status)
        .map(([s, c]) => `<tr><td>Orders (${s})</td><td>${c}</td></tr>`)
        .join("");

      const workbookHtml = `
        <html>
          <head><meta charset="utf-8" /></head>
          <body style="font-family: Arial, sans-serif;">
            <h2>Order Report - ${new Date().toISOString().slice(0, 10)}</h2>
            <p>
              <strong>Date Range:</strong> ${dateFrom || "All"} to ${dateTo || "All"}<br/>
              <strong>Total Orders:</strong> ${summary.total_orders} | <strong>Total Revenue:</strong> ${formatINR(summary.total_revenue)}<br/>
              <strong>Avg Order Value:</strong> ${formatINR(summary.avg_order_value)}
            </p>
            <table border="1" cellpadding="5" cellspacing="0">
              <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
            <h3>Summary</h3>
            <table border="1" cellpadding="5" cellspacing="0">
              <tr><th>Metric</th><th>Value</th></tr>
              <tr><td>Total Orders</td><td>${summary.total_orders}</td></tr>
              <tr><td>Total Revenue</td><td>${formatINR(summary.total_revenue)}</td></tr>
              <tr><td>Total Items</td><td>${summary.total_items}</td></tr>
              <tr><td>Avg Order Value</td><td>${formatINR(summary.avg_order_value)}</td></tr>
              ${summaryRows}
            </table>
          </body>
        </html>
      `;

      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="orders-report-${dateFrom || 'all'}.xls"`);
      return res.send(workbookHtml);
    }

    res.json({
      summary,
      filters: {
        date_from: dateFrom,
        date_to: dateTo,
        status,
        product_id: productId,
        staff_id: staffId,
        category,
      },
      orders: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate order report." });
  }
});

// Product performance report
router.get("/products/report", async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const dateFrom = req.query.date_from || req.query.from;
    const dateTo = req.query.date_to || req.query.to;
    const category = req.query.category;

    let query = `
      SELECT
        i.id,
        i.product_name,
        i.sku,
        i.category,
        i.stock,
        i.price,
        i.status,
        s.company_name AS supplier_name,
        COALESCE(SUM(CASE WHEN o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS total_sold,
        COALESCE(SUM(CASE WHEN o.status = 'completed' THEN o.total_amount ELSE 0 END), 0) AS total_revenue,
        COUNT(DISTINCT o.id) AS order_count
      FROM inventory i
      LEFT JOIN suppliers s ON s.id = i.supplier_id
      LEFT JOIN orders o ON o.inventory_id = i.id
    `;

    const params = [];

    if (dateFrom || dateTo) {
      query += " AND o.order_date";
      if (dateFrom) {
        query += " >= ?";
        params.push(dateFrom);
      }
      if (dateTo) {
        query += " AND o.order_date <= ?";
        params.push(dateTo);
      }
    }

    if (category) {
      query += " WHERE i.category = ?";
      params.push(category);
    }

    query += `
      GROUP BY i.id, i.product_name, i.sku, i.category, i.stock, i.price, i.status, s.company_name
      ORDER BY total_revenue DESC, total_sold DESC
    `;

    const [rows] = await db.query(query, params);

    if (format === "csv") {
      const headers = ["Product Name", "SKU", "Category", "Current Stock", "Price", "Status", "Supplier", "Units Sold", "Revenue", "Orders"];
      const csv = [
        `# Product Report ${new Date().toISOString().slice(0, 10)}`,
        `# Date Range: ${dateFrom || "All"} to ${dateTo || "All"}`,
        "",
        headers.join(","),
        ...rows.map((row) => [
          escapeCsv(row.product_name),
          escapeCsv(row.sku || ""),
          escapeCsv(row.category),
          row.stock,
          formatINR(row.price),
          row.status,
          escapeCsv(row.supplier_name || "Unassigned"),
          row.total_sold,
          formatINR(row.total_revenue),
          row.order_count,
        ].join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="products-report-${dateFrom || 'all'}.csv"`);
      return res.send(csv);
    }

    if (format === "excel" || format === "xlsx") {
      const headers = ["Product Name", "SKU", "Category", "Current Stock", "Price", "Status", "Supplier", "Units Sold", "Revenue", "Orders"];
      const tableRows = rows.map((row) => `
        <tr>
          <td>${row.product_name}</td>
          <td>${row.sku || ""}</td>
          <td>${row.category}</td>
          <td>${row.stock}</td>
          <td>${formatINR(row.price)}</td>
          <td>${row.status}</td>
          <td>${row.supplier_name || "Unassigned"}</td>
          <td>${row.total_sold}</td>
          <td>${formatINR(row.total_revenue)}</td>
          <td>${row.order_count}</td>
        </tr>
      `).join("");

      const workbookHtml = `
        <html>
          <head><meta charset="utf-8" /></head>
          <body style="font-family: Arial, sans-serif;">
            <h2>Product Report - ${new Date().toISOString().slice(0, 10)}</h2>
            <p><strong>Date Range:</strong> ${dateFrom || "All"} to ${dateTo || "All"}</p>
            <table border="1" cellpadding="5" cellspacing="0">
              <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `;

      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="products-report-${dateFrom || 'all'}.xls"`);
      return res.send(workbookHtml);
    }

    res.json({
      report_type: "product_performance",
      generated_at: new Date().toISOString(),
      filters: { date_from: dateFrom, date_to: dateTo, category },
      products: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate product report." });
  }
});

// Staff productivity report
router.get("/staff/report", async (req, res) => {
  try {
    const format = String(req.query.format || "json").toLowerCase();
    const dateFrom = req.query.date_from || req.query.from;
    const dateTo = req.query.date_to || req.query.to;

    let query = `
      SELECT
        u.id,
        u.username,
        u.role,
        u.department,
        COUNT(o.id) AS orders_processed,
        COALESCE(SUM(o.total_amount), 0) AS total_sales,
        COUNT(DISTINCT al.id) AS total_actions,
        SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) AS successful_actions,
        ROUND(SUM(CASE WHEN al.status = 'success' THEN 1 ELSE 0 END) / NULLIF(COUNT(DISTINCT al.id), 0) * 100, 2) AS success_rate
      FROM users u
      LEFT JOIN orders o ON o.created_by = u.id
      LEFT JOIN activity_logs al ON al.user_id = u.id
    `;

    const params = [];

    if (dateFrom || dateTo) {
      query += " WHERE 1=1";
      if (dateFrom) {
        query += " AND o.order_date >= ?";
        params.push(dateFrom);
      }
      if (dateTo) {
        query += " AND o.order_date <= ?";
        params.push(dateTo);
      }
    }

    query += `
      GROUP BY u.id, u.username, u.role, u.department
      HAVING u.role IN ('manager', 'staff')
      ORDER BY orders_processed DESC
    `;

    const [rows] = await db.query(query, params);

    if (format === "csv") {
      const headers = ["Username", "Role", "Department", "Orders Processed", "Total Sales", "Total Actions", "Successful Actions", "Success Rate (%)"];
      const csv = [
        `# Staff Report ${new Date().toISOString().slice(0, 10)}`,
        `# Date Range: ${dateFrom || "All"} to ${dateTo || "All"}`,
        "",
        headers.join(","),
        ...rows.map((row) => [
          escapeCsv(row.username),
          escapeCsv(row.role),
          escapeCsv(row.department || ""),
          row.orders_processed,
          formatINR(row.total_sales),
          row.total_actions,
          row.successful_actions,
          row.success_rate || "N/A",
        ].join(",")),
      ].join("\n");

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="staff-report-${dateFrom || 'all'}.csv"`);
      return res.send(csv);
    }

    if (format === "excel" || format === "xlsx") {
      const headers = ["Username", "Role", "Department", "Orders Processed", "Total Sales", "Total Actions", "Successful Actions", "Success Rate (%)"];
      const tableRows = rows.map((row) => `
        <tr>
          <td>${row.username}</td>
          <td>${row.role}</td>
          <td>${row.department || ""}</td>
          <td>${row.orders_processed}</td>
          <td>${formatINR(row.total_sales)}</td>
          <td>${row.total_actions}</td>
          <td>${row.successful_actions}</td>
          <td>${row.success_rate || "N/A"}%</td>
        </tr>
      `).join("");

      const workbookHtml = `
        <html>
          <head><meta charset="utf-8" /></head>
          <body style="font-family: Arial, sans-serif;">
            <h2>Staff Productivity Report - ${new Date().toISOString().slice(0, 10)}</h2>
            <p><strong>Date Range:</strong> ${dateFrom || "All"} to ${dateTo || "All"}</p>
            <table border="1" cellpadding="5" cellspacing="0">
              <thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
              <tbody>${tableRows}</tbody>
            </table>
          </body>
        </html>
      `;

      res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="staff-report-${dateFrom || 'all'}.xls"`);
      return res.send(workbookHtml);
    }

    res.json({
      report_type: "staff_productivity",
      generated_at: new Date().toISOString(),
      filters: { date_from: dateFrom, date_to: dateTo },
      staff: rows,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to generate staff report." });
  }
});

module.exports = router;
