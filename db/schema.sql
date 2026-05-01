-- ============================================================
-- Smart Inventory Management System - Enterprise Upgrade Schema
-- Run: mysql -u root -p smart_inventory < db/schema.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS smart_inventory;
USE smart_inventory;

CREATE TABLE IF NOT EXISTS users (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  username    VARCHAR(100) NOT NULL UNIQUE,
  password    VARCHAR(255) NOT NULL,
  full_name   VARCHAR(200) NOT NULL,
  phone       VARCHAR(50) NULL,
  email       VARCHAR(150) NULL,
  address     TEXT NULL,
  role        ENUM('admin','manager','staff') NOT NULL DEFAULT 'staff',
  status      ENUM('active','inactive') NOT NULL DEFAULT 'active',
  department  VARCHAR(100) NULL,
  manager_id  INT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_manager
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id                      INT AUTO_INCREMENT PRIMARY KEY,
  company_name            VARCHAR(200) NOT NULL,
  contact_person          VARCHAR(150),
  phone                   VARCHAR(30),
  email                   VARCHAR(150),
  status                  ENUM('active','pending','inactive') NOT NULL DEFAULT 'active',
  lead_time_days          INT NOT NULL DEFAULT 7,
  on_time_delivery_rate   DECIMAL(5,2) NOT NULL DEFAULT 95.00,
  quality_rating          DECIMAL(3,2) NOT NULL DEFAULT 4.50,
  payment_terms           VARCHAR(100) NOT NULL DEFAULT 'Net 30',
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  product_name    VARCHAR(200) NOT NULL,
  sku             VARCHAR(100) UNIQUE NULL,
  category        VARCHAR(100) NOT NULL DEFAULT 'Electronics',
  stock           INT NOT NULL DEFAULT 0,
  price           DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  expiry_date     DATE,
  supplier_id     INT,
  status          ENUM('in-stock','low-stock','critical','out-of-stock') NOT NULL DEFAULT 'in-stock',
  description     TEXT,
  low_stock_point INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  customer_name VARCHAR(200) NOT NULL,
  inventory_id  INT NOT NULL,
  supplier_id   INT,
  items_count   INT NOT NULL DEFAULT 1,
  total_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  order_date    DATE NOT NULL,
  status        ENUM('completed','processing','pending','cancelled') NOT NULL DEFAULT 'pending',
  created_by    INT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  inventory_id   INT NOT NULL,
  movement_type  ENUM('sale','restock','adjustment','transfer','return','other') NOT NULL,
  quantity       INT NOT NULL,
  before_stock   INT NOT NULL,
  after_stock    INT NOT NULL,
  reference_type VARCHAR(50) NULL,
  reference_id   INT NULL,
  performed_by   INT NULL,
  reason         TEXT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE,
  FOREIGN KEY (performed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id                    INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id           INT NOT NULL,
  inventory_id          INT NOT NULL,
  supplier_sku          VARCHAR(100) NULL,
  unit_cost             DECIMAL(10,2) NOT NULL,
  contract_price        DECIMAL(10,2) NULL,
  currency              VARCHAR(10) NOT NULL DEFAULT 'USD',
  lead_time_days        INT NOT NULL DEFAULT 7,
  quality_rating        DECIMAL(3,2) NOT NULL DEFAULT 4.50,
  minimum_order_quantity INT NOT NULL DEFAULT 1,
  last_purchase_date    DATE NULL,
  last_received_date    DATE NULL,
  preferred_supplier    TINYINT(1) NOT NULL DEFAULT 0,
  is_active             TINYINT(1) NOT NULL DEFAULT 1,
  created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_supplier_inventory (supplier_id, inventory_id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE,
  FOREIGN KEY (inventory_id) REFERENCES inventory(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NULL,
  action_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   INT NULL,
  details     TEXT NULL,
  status      ENUM('success','warning','failed') NOT NULL DEFAULT 'success',
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO users (username, password, role, department) VALUES
('admin', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin', 'Administration'),
('manager1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'manager', 'Operations'),
('staff1', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'staff', 'Warehouse')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO suppliers (
  company_name, contact_person, phone, email, status, lead_time_days,
  on_time_delivery_rate, quality_rating, payment_terms
) VALUES
('Tech Solutions Inc.', 'Robert Chen', '+1 234-567-8901', 'robert@techsolutions.com', 'active', 5, 97.50, 4.80, 'Net 30'),
('Global Imports Ltd.', 'Maria Garcia', '+1 234-567-8902', 'maria@globalimports.com', 'active', 7, 95.20, 4.60, 'Net 45'),
('Premium Goods Co.', 'David Wilson', '+1 234-567-8903', 'david@premiumgoods.com', 'pending', 10, 90.50, 4.20, 'Net 15'),
('Quality Parts Inc.', 'Lisa Anderson', '+1 234-567-8904', 'lisa@qualityparts.com', 'active', 4, 98.10, 4.90, 'Net 30')
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO inventory (
  product_name, sku, category, stock, price, expiry_date, supplier_id, status,
  description, low_stock_point
) VALUES
('Wireless Mouse', 'SKU-001', 'electronics', 234, 29.99, '2027-12-31', 1, 'in-stock', 'Wireless productivity accessory', 60),
('USB-C Cable', 'SKU-002', 'electronics', 567, 12.99, '2027-01-15', 2, 'in-stock', 'Fast-charge accessory', 120),
('Laptop Stand', 'SKU-003', 'electronics', 15, 45.99, '2027-08-20', 3, 'low-stock', 'Ergonomic workstation stand', 25),
('Mechanical Keyboard', 'SKU-004', 'electronics', 89, 89.99, '2028-11-10', 1, 'in-stock', 'Premium mechanical keyboard', 30),
('Webcam HD', 'SKU-005', 'electronics', 3, 65.99, '2027-03-30', 2, 'critical', 'High-definition webcam', 20),
('Smart Plug', 'SKU-006', 'electronics', 120, 14.99, '2028-06-30', 1, 'in-stock', 'Wi-Fi enabled smart plug for home automation', 20),
('LED Strip Light', 'SKU-007', 'electronics', 75, 22.50, '2028-12-31', 2, 'in-stock', 'RGB LED strip for electrical setups and lighting', 25),
('Power Bank 10000mAh', 'SKU-008', 'electronics', 200, 39.99, '2028-09-15', 4, 'in-stock', 'Portable power bank for charging devices', 40),
('Bluetooth Speaker', 'SKU-009', 'electronics', 50, 79.99, '2028-05-20', 1, 'in-stock', 'Wireless Bluetooth speaker with excellent sound', 15),
('Smart Bulb', 'SKU-010', 'electronics', 180, 9.99, '2028-11-25', 3, 'in-stock', 'Energy-efficient smart LED bulb', 30)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO supplier_products (
  supplier_id, inventory_id, supplier_sku, unit_cost, contract_price, currency,
  lead_time_days, quality_rating, minimum_order_quantity, last_purchase_date,
  last_received_date, preferred_supplier, is_active
) VALUES
(1, 1, 'TS-WM-001', 18.50, NULL, 'USD', 5, 4.80, 25, '2026-04-15', NULL, 0, 1),
(2, 2, 'GI-UC-002', 6.20, NULL, 'USD', 7, 4.60, 100, '2026-04-18', NULL, 0, 1),
(3, 3, 'PG-LS-003', 29.10, NULL, 'USD', 10, 4.20, 10, '2026-04-01', NULL, 0, 1),
(1, 4, 'TS-MK-004', 54.00, NULL, 'USD', 6, 4.75, 15, '2026-04-16', NULL, 0, 1),
(2, 5, 'GI-WH-005', 39.50, NULL, 'USD', 8, 4.55, 20, '2026-04-10', NULL, 0, 1),
(1, 6, 'TS-SP-006', 9.50, NULL, 'USD', 4, 4.85, 50, '2026-04-20', NULL, 0, 1),
(2, 7, 'GI-LS-007', 14.00, NULL, 'USD', 6, 4.70, 30, '2026-04-22', NULL, 0, 1),
(4, 8, 'QP-PB-008', 25.00, NULL, 'USD', 5, 4.90, 20, '2026-04-18', NULL, 0, 1),
(1, 9, 'TS-BS-009', 50.00, NULL, 'USD', 7, 4.75, 10, '2026-04-19', NULL, 0, 1),
(3, 10, 'PG-SB-010', 6.50, NULL, 'USD', 8, 4.60, 100, '2026-04-21', NULL, 0, 1)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO orders (customer_name, inventory_id, items_count, total_amount, order_date, status, created_by) VALUES
('John Smith', 1, 3, 89.97, '2026-04-21', 'completed', 2),
('Sarah Johnson', 3, 2, 91.98, '2026-04-21', 'processing', 2),
('Michael Brown', 2, 5, 64.95, '2026-04-20', 'completed', 3),
('Emily Davis', 3, 1, 45.99, '2026-04-20', 'completed', 3),
('Neha Patel', 2, 18, 233.82, '2026-04-22', 'completed', 3),
('Arjun Mehta', 5, 2, 131.98, '2026-04-22', 'completed', 2),
('Alice Cooper', 6, 10, 149.90, '2026-04-23', 'completed', 2),
('Bob Dylan', 7, 5, 112.50, '2026-04-23', 'pending', 3),
('Charlie Parker', 8, 8, 319.92, '2026-04-24', 'completed', 2),
('Diana Ross', 9, 3, 239.97, '2026-04-24', 'processing', 3),
('Eve Adams', 10, 20, 199.80, '2026-04-25', 'completed', 2)
ON DUPLICATE KEY UPDATE id=id;

INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details, status) VALUES
(2, 'create', 'order', 1, 'Created priority order for John Smith', 'success'),
(3, 'update', 'inventory', 2, 'Cycle count completed for USB-C Cable', 'success'),
(2, 'assign_reorder', 'reorder_assignment', 1, 'Assigned reorder follow-up for Webcam HD', 'warning')
ON DUPLICATE KEY UPDATE id=id;
