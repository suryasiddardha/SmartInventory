const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { asyncHandler } = require("../src/shared/http/async-handler");

const router = express.Router();

router.use(authenticate);

// GET /api/customers
router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await db.query("SELECT * FROM customers ORDER BY name ASC");
  res.json(rows);
}));

// POST /api/customers
router.post("/", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const { name, email, phone, address } = req.body;
  if (!name) return res.status(400).json({ error: "Customer name is required." });

  const [result] = await db.query(
    "INSERT INTO customers (name, email, phone, address) VALUES (?, ?, ?, ?)",
    [name, email || null, phone || null, address || null]
  );

  res.status(201).json({ id: result.insertId, message: "Customer created successfully." });
}));

// PUT /api/customers/:id
router.put("/:id", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const { name, email, phone, address } = req.body;
  await db.query(
    "UPDATE customers SET name = ?, email = ?, phone = ?, address = ? WHERE id = ?",
    [name, email, phone, address, req.params.id]
  );
  res.json({ message: "Customer updated successfully." });
}));

// DELETE /api/customers/:id
router.delete("/:id", authorize("admin"), asyncHandler(async (req, res) => {
  await db.query("DELETE FROM customers WHERE id = ?", [req.params.id]);
  res.json({ message: "Customer deleted successfully." });
}));

// GET /api/customers/:id/orders
router.get("/:id/orders", asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT o.*, i.product_name, s.company_name AS supplier_name
    FROM orders o
    LEFT JOIN inventory i ON o.inventory_id = i.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    WHERE o.customer_id = ?
    ORDER BY o.created_at DESC
  `, [req.params.id]);
  res.json(rows);
}));


module.exports = router;
