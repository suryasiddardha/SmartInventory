-- Create the inventory_batches table
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

-- Backfill data from supplier_products and inventory
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
WHERE sp.stock > 0;

-- Add cost and profit tracking to orders
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_amount;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS total_profit DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER total_cost;

-- Backfill past orders (estimated)
UPDATE orders o
JOIN supplier_products sp ON o.inventory_id = sp.inventory_id AND o.supplier_id = sp.supplier_id
SET o.total_cost = sp.unit_cost * o.items_count;

UPDATE orders
SET total_profit = total_amount - total_cost;
