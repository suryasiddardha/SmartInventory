const db = require("../db/connection");

async function migrate() {
  try {
    console.log("Adding inventory_batches table...");
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_batches (
        id INT AUTO_INCREMENT PRIMARY KEY,
        inventory_id INT NOT NULL,
        supplier_id INT NOT NULL,
        purchase_cost DECIMAL(10,2) NOT NULL,
        selling_price DECIMAL(10,2) NOT NULL,
        initial_stock INT NOT NULL,
        current_stock INT NOT NULL,
        received_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
      );
    `);

    // Backfill from supplier_products and inventory
    console.log("Backfilling data...");
    await db.query(`
      INSERT INTO inventory_batches (inventory_id, supplier_id, purchase_cost, selling_price, initial_stock, current_stock, received_at)
      SELECT 
        sp.inventory_id,
        sp.supplier_id,
        sp.unit_cost,
        i.price,
        sp.stock,
        sp.stock,
        sp.created_at
      FROM supplier_products sp
      JOIN inventory i ON sp.inventory_id = i.id
      WHERE sp.stock > 0
    `);

    // Add total_cost to orders table if it doesn't exist
    console.log("Updating orders table...");
    const [cols] = await db.query("SHOW COLUMNS FROM orders LIKE 'total_cost'");
    if (cols.length === 0) {
      await db.query("ALTER TABLE orders ADD COLUMN total_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount");
      // Backfill total_cost
      await db.query(`
        UPDATE orders o
        JOIN supplier_products sp ON o.inventory_id = sp.inventory_id AND o.supplier_id = sp.supplier_id
        SET o.total_cost = sp.unit_cost * o.items_count
      `);
    }

    // Add total_profit to orders table if it doesn't exist
    const [cols2] = await db.query("SHOW COLUMNS FROM orders LIKE 'total_profit'");
    if (cols2.length === 0) {
      await db.query("ALTER TABLE orders ADD COLUMN total_profit DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_cost");
      // Backfill total_profit
      await db.query(`
        UPDATE orders
        SET total_profit = total_amount - total_cost
      `);
    }

    console.log("Migration complete!");
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

migrate();
