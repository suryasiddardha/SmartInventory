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
      SELECT o.*, u.username AS created_by_name, i.product_name AS product_name, i.category, sp.unit_cost
      FROM orders o
      LEFT JOIN users u ON o.created_by = u.id
      LEFT JOIN inventory i ON o.inventory_id = i.id
      LEFT JOIN supplier_products sp ON o.inventory_id = sp.inventory_id AND o.supplier_id = sp.supplier_id
      ORDER BY o.order_date DESC, o.created_at DESC
    `);
    res.json(rows);
}));

router.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT o.*, i.product_name, s.company_name AS supplier_name, c.email AS customer_email, c.phone AS customer_phone, c.address AS customer_address
    FROM orders o
    LEFT JOIN inventory i ON o.inventory_id = i.id
    LEFT JOIN suppliers s ON o.supplier_id = s.id
    LEFT JOIN customers c ON o.customer_id = c.id
    WHERE o.id = ?
  `, [req.params.id]);

  if (rows.length === 0) return res.status(404).json({ error: "Order not found." });
  res.json(rows[0]);
}));

// Admin-only: price breakdown for a completed order
router.get("/:id/breakdown", authorize("admin"), asyncHandler(async (req, res) => {
  const [[order]] = await db.query(`
    SELECT o.*, i.product_name, s.company_name AS supplier_name
    FROM orders o
    LEFT JOIN inventory i ON i.id = o.inventory_id
    LEFT JOIN suppliers s ON s.id = o.supplier_id
    WHERE o.id = ?
  `, [req.params.id]);

  if (!order) return res.status(404).json({ error: "Order not found." });

  const unit_selling_price = order.items_count > 0
    ? Number(order.total_amount) / Number(order.items_count)
    : 0;

  const unit_cost = order.items_count > 0
    ? Number(order.total_cost) / Number(order.items_count)
    : 0;

  const margin_pct = order.total_amount > 0
    ? ((Number(order.total_profit) / Number(order.total_amount)) * 100).toFixed(1)
    : "0.0";

  res.json({
    order_id: order.id,
    product_name: order.product_name,
    supplier_name: order.supplier_name,
    customer_name: order.customer_name,
    order_date: order.order_date,
    status: order.status,
    items_count: Number(order.items_count),
    unit_selling_price: Number(unit_selling_price.toFixed(2)),
    total_amount: Number(order.total_amount),
    unit_cost: Number(unit_cost.toFixed(2)),
    total_cost: Number(order.total_cost),
    total_profit: Number(order.total_profit),
    margin_pct: Number(margin_pct),
    pricing_method: "MAX batch selling price × qty | FIFO purchase cost",
  });
}));

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
    const { customer_name, customer_phone, customer_email, inventory_id, supplier_id, items_count } = req.body;

    const [invRows] = await db.query("SELECT * FROM inventory WHERE id = ?", [inventory_id]);
    if (invRows.length === 0) return res.status(404).json({ error: "Inventory item not found." });
    const item = invRows[0];

    const [spRows] = await db.query("SELECT stock FROM supplier_products WHERE inventory_id = ? AND supplier_id = ?", [inventory_id, supplier_id]);
    if (spRows.length === 0) return res.status(404).json({ error: "Supplier not found for this item." });
    
    const supplierStock = spRows[0].stock;
    if (supplierStock < items_count) {
      return res.status(400).json({ error: `Insufficient stock from this supplier. Only ${supplierStock} left.` });
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // 1. Fetch available batches sequentially (FIFO)
      const [batches] = await conn.query(
        "SELECT id, current_stock, purchase_cost, selling_price FROM inventory_batches WHERE inventory_id = ? AND supplier_id = ? AND current_stock > 0 ORDER BY received_at ASC FOR UPDATE",
        [inventory_id, supplier_id]
      );

      // 2. Find the MAX selling_price across all active batches for this supplier
      //    Customer is always charged the highest available rate (Option B).
      const customer_unit_price = batches.reduce((max, b) => Math.max(max, Number(b.selling_price || 0)), 0);

      let remainingToFulfill = items_count;
      let total_cost = 0;  // FIFO blended purchase cost
      const usageToRecord = [];

      for (const batch of batches) {
        if (remainingToFulfill <= 0) break;

        const quantityFromBatch = Math.min(batch.current_stock, remainingToFulfill);
        // Cost uses the actual historical purchase price for each batch (FIFO accuracy)
        total_cost += quantityFromBatch * Number(batch.purchase_cost);
        remainingToFulfill -= quantityFromBatch;

        await conn.query(
          "UPDATE inventory_batches SET current_stock = current_stock - ? WHERE id = ?",
          [quantityFromBatch, batch.id]
        );

        usageToRecord.push({
          batch_id: batch.id,
          quantity_used: quantityFromBatch,
          purchase_cost: batch.purchase_cost
        });
      }

      if (remainingToFulfill > 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Insufficient stock from this supplier. Missing ${remainingToFulfill} units.` });
      }

      // Customer is charged the max unit price x total items
      const total_amount = items_count * customer_unit_price;
      const total_profit = total_amount - total_cost;
      const order_date = new Date().toISOString().split("T")[0];

      // 4. Find or create customer and update contact info
      let customer_id = null;
      const [custRows] = await conn.query("SELECT id FROM customers WHERE name = ?", [customer_name]);
      if (custRows.length > 0) {
        customer_id = custRows[0].id;
        // Update existing customer info if provided
        if (customer_phone || customer_email) {
          await conn.query(
            "UPDATE customers SET phone = COALESCE(?, phone), email = COALESCE(?, email) WHERE id = ?",
            [customer_phone || null, customer_email || null, customer_id]
          );
        }
      } else {
        const [custResult] = await conn.query(
          "INSERT INTO customers (name, phone, email) VALUES (?, ?, ?)",
          [customer_name, customer_phone || null, customer_email || null]
        );
        customer_id = custResult.insertId;
      }

      const [result] = await conn.query(
        `INSERT INTO orders (customer_name, customer_id, inventory_id, supplier_id, items_count, total_amount, total_cost, total_profit, order_date, status, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [customer_name, customer_id, inventory_id, supplier_id, items_count, total_amount, total_cost, total_profit, order_date, "completed", req.user.id]
      );

      // 5. Record batch usage with the new order_id
      for (const usage of usageToRecord) {
        await conn.query(
          "INSERT INTO order_batch_usage (order_id, batch_id, quantity_used, cost_at_time) VALUES (?, ?, ?, ?)",
          [result.insertId, usage.batch_id, usage.quantity_used, usage.purchase_cost]
        );
      }

      // Update supplier specific stock
      const newSupplierStock = supplierStock - items_count;
      await conn.query("UPDATE supplier_products SET stock=? WHERE inventory_id=? AND supplier_id=?", [newSupplierStock, inventory_id, supplier_id]);

      // Update total inventory stock and price based on remaining batches
      const newStock = item.stock - items_count;
      const newStatus = calculateStatus(newStock, item.low_stock_point, item.category);

      const [[activeBatch]] = await conn.query(
        "SELECT selling_price FROM inventory_batches WHERE inventory_id = ? AND current_stock > 0 ORDER BY received_at ASC LIMIT 1",
        [inventory_id]
      );
      
      if (activeBatch) {
        await conn.query("UPDATE inventory SET stock=?, status=?, price=? WHERE id=?", [newStock, newStatus, activeBatch.selling_price, inventory_id]);
      } else {
        await conn.query("UPDATE inventory SET stock=?, status=? WHERE id=?", [newStock, newStatus, inventory_id]);
      }

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

          // Restore stock to original batches
          const [usageRows] = await conn.query("SELECT batch_id, quantity_used FROM order_batch_usage WHERE order_id = ?", [order.id]);
          for (const usage of usageRows) {
            await conn.query("UPDATE inventory_batches SET current_stock = current_stock + ? WHERE id = ?", [usage.quantity_used, usage.batch_id]);
          }
        } else if (previousStatus !== "completed" && nextStatus === "completed") {
          // Re-deducting stock would require repeating the FIFO logic.
          // For now, let's assume we can't easily "re-complete" a cancelled order without a fresh check.
          // But since the current UI allows it, we should handle it or prevent it.
          // Let's implement re-deduction if needed, but for now focus on restoration.
          const requested = Number(order.items_count || 0);
          if (updatedSupplierStock < requested) {
            await conn.rollback();
            return res.status(400).json({ error: `Insufficient stock from this supplier. Only ${updatedSupplierStock} left.` });
          }
          updatedStock -= requested;
          updatedSupplierStock -= requested;
          
          // Re-deduct from batches
          const [batches] = await conn.query(
            "SELECT id, current_stock FROM inventory_batches WHERE inventory_id = ? AND supplier_id = ? AND current_stock > 0 ORDER BY received_at ASC FOR UPDATE",
            [order.inventory_id, order.supplier_id]
          );
          let rem = requested;
          await conn.query("DELETE FROM order_batch_usage WHERE order_id = ?", [order.id]);
          for (const b of batches) {
            if (rem <= 0) break;
            const take = Math.min(b.current_stock, rem);
            await conn.query("UPDATE inventory_batches SET current_stock = current_stock - ? WHERE id = ?", [take, b.id]);
            await conn.query("INSERT INTO order_batch_usage (order_id, batch_id, quantity_used, cost_at_time) SELECT ?, ?, ?, purchase_cost FROM inventory_batches WHERE id = ?", [order.id, b.id, take, b.id]);
            rem -= take;
          }
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
        
        // Restore stock to original batches
        const [usageRows] = await conn.query("SELECT batch_id, quantity_used FROM order_batch_usage WHERE order_id = ?", [order.id]);
        for (const usage of usageRows) {
          await conn.query("UPDATE inventory_batches SET current_stock = current_stock + ? WHERE id = ?", [usage.quantity_used, usage.batch_id]);
        }

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
