const db = require('../db/connection');

async function test() {
  try {
    const isLeader = true;
    
    console.log("Checking table exists...");
    const [[result]] = await db.query(
      `SELECT COUNT(*) AS table_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE()
         AND table_name = ?`,
      ["staff_tasks"]
    );
    console.log("staff_tasks exists:", result.table_count > 0);

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
    `, isLeader ? [] : [1]);
    console.log("queueRows:", queueRows.length);
    
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
    `, isLeader ? [] : [1]);
    console.log("updateRows:", updateRows.length);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit();
  }
}

test();
