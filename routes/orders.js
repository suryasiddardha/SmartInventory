const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { calculateStatus } = require("../lib/inventory-utils");
const { logActivity } = require("../lib/activity-log");
const { recordInventoryMovement } = require("../lib/inventory-movements");
const { asyncHandler } = require("../src/shared/http/async-handler");
const { validateBody } = require("../src/shared/http/validate");

const router = express.Router();
router.use(authenticate);

router.get("/", asyncHandler(async (req, res) => {
    const [rows] = await db.query(`
      SELECT o.*, u.username AS created_by_name, i.product_name AS product_name
      FROM orders o
      LEFT JOIN users u ON o.created_by = u.id
      LEFT JOIN inventory i ON o.inventory_id = i.id
      ORDER BY o.order_date DESC, o.created_at DESC
    `);
    res.json(rows);
}));

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM orders WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: "Order not found." });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch order." });
  }
});

router.post(
  "/",
  authorize("admin", "manager", "staff"),
  validateBody({
    customer_name: { required: true, minLength: 2 },
    inventory_id: { required: true, type: "integer" },
    supplier_id: { required: true, type: "integer" },
    items_count: { required: true, type: "integer", custom: (value) => Number(value) > 0 ? null : "items_count must be greater than 0." },
  }),
  asyncHandler(async (req, res) => {
    const { customer_name, inventory_id, supplier_id, items_count } = req.body;

    const [invRows] = await db.query("SELECT * FROM inventory WHERE id = ?", [inventory_id]);
    if (invRows.length === 0) return res.status(404).json({ error: "Inventory item not found." });
    const item = invRows[0];

    const [spRows] = await db.query("SELECT stock FROM supplier_products WHERE inventory_id = ? AND supplier_id = ?", [inventory_id, supplier_id]);
    if (spRows.length === 0) return res.status(404).json({ error: "Supplier not found for this item." });
    
    const supplierStock = spRows[0].stock;
    if (supplierStock < items_count) {
      return res.status(400).json({ error: `Insufficient stock from this supplier. Only ${supplierStock} left.` });
    }

    const total_amount = item.price * items_count;
    const order_date = new Date().toISOString().split("T")[0];

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [result] = await conn.query(
        `INSERT INTO orders (customer_name, inventory_id, supplier_id, items_count, total_amount, order_date, status, created_by)
         VALUES (?,?,?,?,?,?,?,?)`,
        [customer_name, inventory_id, supplier_id, items_count, total_amount, order_date, "completed", req.user.id]
      );

      // Update supplier specific stock
      const newSupplierStock = supplierStock - items_count;
      await conn.query("UPDATE supplier_products SET stock=? WHERE inventory_id=? AND supplier_id=?", [newSupplierStock, inventory_id, supplier_id]);

      // Update total inventory stock
      const newStock = item.stock - items_count;
      const newStatus = calculateStatus(newStock, item.low_stock_point, item.category);
      await conn.query("UPDATE inventory SET stock=?, status=? WHERE id=?", [newStock, newStatus, inventory_id]);

      await conn.commit();

      await logActivity(db, {
        userId: req.user.id,
        actionType: "create",
        entityType: "order",
        entityId: result.insertId,
        details: `Created order for ${customer_name} (${items_count} x ${item.product_name})`,
      });

      await recordInventoryMovement(db, {
        inventoryId: inventory_id,
        movementType: "sale",
        quantity: Number(items_count),
        beforeStock: Number(item.stock),
        afterStock: Number(newStock),
        referenceType: "order",
        referenceId: result.insertId,
        performedBy: req.user.id,
        reason: `Order created for ${customer_name}`,
      });

      res.status(201).json({ message: "Order processed successfully.", id: result.insertId });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  })
);

router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const { customer_name, status } = req.body;
    const nextStatus = String(status || "").toLowerCase();
    if (!["pending", "completed", "cancelled"].includes(nextStatus)) {
      return res.status(400).json({ error: "Invalid order status." });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      const [orderRows] = await conn.query(
        "SELECT id, inventory_id, supplier_id, items_count, status FROM orders WHERE id = ? FOR UPDATE",
        [req.params.id]
      );
      if (orderRows.length === 0) {
        await conn.rollback();
        return res.status(404).json({ error: "Order not found." });
      }

      const order = orderRows[0];
      const [inventoryRows] = await conn.query(
        "SELECT id, stock, category, low_stock_point FROM inventory WHERE id = ? FOR UPDATE",
        [order.inventory_id]
      );

      const [spRows] = await conn.query(
        "SELECT stock FROM supplier_products WHERE inventory_id = ? AND supplier_id = ? FOR UPDATE",
        [order.inventory_id, order.supplier_id]
      );

      const previousStatus = String(order.status || "").toLowerCase();
      const statusChanged = previousStatus !== nextStatus;

      if (statusChanged && inventoryRows.length > 0 && spRows.length > 0) {
        const item = inventoryRows[0];
        let updatedStock = Number(item.stock || 0);
        let updatedSupplierStock = Number(spRows[0].stock || 0);

        if (previousStatus === "completed" && nextStatus !== "completed") {
          updatedStock += Number(order.items_count || 0);
          updatedSupplierStock += Number(order.items_count || 0);
        } else if (previousStatus !== "completed" && nextStatus === "completed") {
          const requested = Number(order.items_count || 0);
          if (updatedSupplierStock < requested) {
            await conn.rollback();
            return res.status(400).json({ error: `Insufficient stock from this supplier. Only ${updatedSupplierStock} left.` });
          }
          updatedStock -= requested;
          updatedSupplierStock -= requested;
        }

        const updatedStatus = calculateStatus(updatedStock, item.low_stock_point, item.category);
        await conn.query("UPDATE inventory SET stock = ?, status = ? WHERE id = ?", [
          updatedStock,
          updatedStatus,
          item.id,
        ]);
        await conn.query("UPDATE supplier_products SET stock = ? WHERE inventory_id = ? AND supplier_id = ?", [
          updatedSupplierStock,
          item.id,
          order.supplier_id,
        ]);

        const movementType = (previousStatus === "completed" && nextStatus !== "completed") ? "return" : "sale";
        await recordInventoryMovement(conn, {
          inventoryId: item.id,
          movementType: movementType,
          quantity: Number(order.items_count),
          beforeStock: Number(item.stock),
          afterStock: Number(updatedStock),
          referenceType: "order",
          referenceId: req.params.id,
          performedBy: req.user.id,
          reason: `Order ${req.params.id} status changed from ${previousStatus} to ${nextStatus}`,
        });
      }

      const [result] = await conn.query(
        "UPDATE orders SET customer_name = ?, status = ? WHERE id = ?",
        [customer_name, nextStatus, req.params.id]
      );
      if (result.affectedRows === 0) {
        await conn.rollback();
        return res.status(404).json({ error: "Order not found." });
      }

      await conn.commit();

      await logActivity(db, {
        userId: req.user.id,
        actionType: "update",
        entityType: "order",
        entityId: req.params.id,
        details: `Updated order ${req.params.id} to status ${nextStatus}`,
      });

      res.json({ message: "Order updated." });
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: "Failed to update order." });
  }
});

router.delete("/:id", authorize("admin"), async (req, res) => {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [orderRows] = await conn.query("SELECT * FROM orders WHERE id = ? FOR UPDATE", [req.params.id]);
    if (orderRows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: "Order not found." });
    }
    const order = orderRows[0];

    if (order.status === "completed") {
      const [inventoryRows] = await conn.query("SELECT * FROM inventory WHERE id = ? FOR UPDATE", [order.inventory_id]);
      const [spRows] = await conn.query("SELECT stock FROM supplier_products WHERE inventory_id = ? AND supplier_id = ? FOR UPDATE", [order.inventory_id, order.supplier_id]);

      if (inventoryRows.length > 0 && spRows.length > 0) {
        const item = inventoryRows[0];
        const updatedStock = Number(item.stock || 0) + Number(order.items_count || 0);
        const updatedSupplierStock = Number(spRows[0].stock || 0) + Number(order.items_count || 0);

        const updatedStatus = calculateStatus(updatedStock, item.low_stock_point, item.category);
        await conn.query("UPDATE inventory SET stock = ?, status = ? WHERE id = ?", [updatedStock, updatedStatus, item.id]);
        await conn.query("UPDATE supplier_products SET stock = ? WHERE inventory_id = ? AND supplier_id = ?", [updatedSupplierStock, item.id, order.supplier_id]);
        
        await recordInventoryMovement(conn, {
          inventoryId: item.id,
          movementType: "return",
          quantity: Number(order.items_count),
          beforeStock: Number(item.stock),
          afterStock: Number(updatedStock),
          referenceType: "order",
          referenceId: req.params.id,
          performedBy: req.user.id,
          reason: `Order ${req.params.id} deleted`,
        });
      }
    }

    await conn.query("DELETE FROM orders WHERE id = ?", [req.params.id]);
    await conn.commit();

    await logActivity(db, {
      userId: req.user.id,
      actionType: "delete",
      entityType: "order",
      entityId: req.params.id,
      details: `Deleted order ${req.params.id}`,
    });

    res.json({ message: "Order deleted and stock restored if applicable." });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: "Failed to delete order." });
  } finally {
    conn.release();
  }
});

module.exports = router;
