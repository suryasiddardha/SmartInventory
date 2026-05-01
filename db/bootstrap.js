const pool = require("./connection");

const USER_COLUMNS = [
  { name: "full_name", definition: "VARCHAR(200) NULL AFTER password" },
  { name: "phone", definition: "VARCHAR(50) NULL AFTER full_name" },
  { name: "email", definition: "VARCHAR(150) NULL AFTER phone" },
  { name: "address", definition: "TEXT NULL AFTER email" },
  { name: "department", definition: "VARCHAR(100) NULL AFTER status" },
  { name: "manager_id", definition: "INT NULL AFTER department" },
];

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1
    `,
    [tableName, columnName],
  );

  return rows.length > 0;
}

async function ensureUsersTableShape() {
  const missingColumns = [];

  for (const column of USER_COLUMNS) {
    // Check each column individually so older local databases can self-heal.
    // This keeps the app usable without forcing a manual migration step.
    // The startup path only adds what is missing.
    // eslint-disable-next-line no-await-in-loop
    if (!(await columnExists("users", column.name))) {
      missingColumns.push(column);
    }
  }

  if (missingColumns.length > 0) {
    for (const column of missingColumns) {
      await pool.query(`ALTER TABLE users ADD COLUMN ${column.name} ${column.definition}`);
    }
  }

  if (missingColumns.some((column) => column.name === "full_name")) {
    await pool.query(`
      UPDATE users
      SET full_name = username
      WHERE full_name IS NULL OR full_name = ''
    `);

    await pool.query(`
      ALTER TABLE users
      MODIFY COLUMN full_name VARCHAR(200) NOT NULL
    `);
  }
}

async function normalizeInventoryCategories() {
  const [rows] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory'
  `);

  if (!rows[0] || Number(rows[0].count) === 0) {
    return;
  }

  await pool.query(`
    UPDATE inventory
    SET category = 'Electronics'
    WHERE category IS NULL OR category = ''
  `);
}

async function ensureInventoryLowStockColumn() {
  const [tableRows] = await pool.query(`
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'inventory'
    LIMIT 1
  `);

  if (tableRows.length === 0) {
    return;
  }

  const lowStockExists = await columnExists("inventory", "low_stock_point");
  const reorderExists = await columnExists("inventory", "reorder_level");

  if (reorderExists && !lowStockExists) {
    await pool.query(`
      ALTER TABLE inventory
      CHANGE COLUMN reorder_level low_stock_point INT NULL AFTER description
    `);
    return;
  }

  if (reorderExists && lowStockExists) {
    await pool.query(`
      UPDATE inventory
      SET low_stock_point = COALESCE(low_stock_point, reorder_level)
    `);
    await pool.query(`
      ALTER TABLE inventory
      DROP COLUMN reorder_level
    `);
    return;
  }

  if (!lowStockExists) {
    await pool.query(`
      ALTER TABLE inventory
      ADD COLUMN low_stock_point INT NULL AFTER description
    `);
  }
}

async function ensureOrdersTableShape() {
  const [tableRows] = await pool.query(`
    SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'orders' LIMIT 1
  `);
  if (tableRows.length === 0) return;

  if (!(await columnExists("orders", "supplier_id"))) {
    await pool.query(`ALTER TABLE orders ADD COLUMN supplier_id INT NULL AFTER inventory_id`);
    await pool.query(`ALTER TABLE orders ADD CONSTRAINT fk_orders_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL`);
  }
}

async function bootstrapDatabase() {
  await ensureUsersTableShape();
  await normalizeInventoryCategories();
  await ensureInventoryLowStockColumn();
  await ensureOrdersTableShape();
}

module.exports = {
  bootstrapDatabase,
};
