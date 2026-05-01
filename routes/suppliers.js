const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { logActivity } = require("../lib/activity-log");
const { calculateStatus, calculateDynamicReorderMetrics } = require("../lib/inventory-utils");
const { asyncHandler } = require("../src/shared/http/async-handler");
const { validateBody } = require("../src/shared/http/validate");

const router = express.Router();
router.use(authenticate);

function mapSupplierProduct(product) {
  const velocity = Number(product.sold_last_30_days || 0) / 30;
  const metrics = calculateDynamicReorderMetrics({
    stock: product.stock,
    velocity,
    leadTimeDays: product.lead_time_days,
    unitCost: product.contract_price || product.unit_cost,
  });
  const reorderPoint = product.low_stock_point || metrics.reorderPoint;

  return {
    ...product,
    stock: Number(product.supplier_stock !== undefined ? product.supplier_stock : product.stock || 0),
    sale_price: Number(product.sale_price || 0),
    unit_cost: Number(product.unit_cost || 0),
    contract_price: product.contract_price === null ? null : Number(product.contract_price || 0),
    sold_last_7_days: Number(product.sold_last_7_days || 0),
    sold_last_30_days: Number(product.sold_last_30_days || 0),
    revenue_last_30_days: Number(product.revenue_last_30_days || 0),
    minimum_order_quantity: Number(product.minimum_order_quantity || 0),
    preferred_supplier: Boolean(product.preferred_supplier),
    is_active: Boolean(product.is_active),
    velocity: Number(velocity.toFixed(2)),
    reorder_point: reorderPoint,
    recommended_quantity: Math.max(metrics.reorderQuantity, Number(product.minimum_order_quantity || 1)),
    days_until_stockout: metrics.daysUntilStockout,
    stock_status: calculateStatus(product.stock, reorderPoint),
    estimated_margin: Number(
      (Number(product.sale_price || 0) - Number(product.contract_price || product.unit_cost || 0)).toFixed(2)
    ),
  };
}

router.get("/", asyncHandler(async (req, res) => {
  const [rows] = await db.query(`
    SELECT
      s.*,
      COUNT(DISTINCT sp.inventory_id) AS linked_products,
      COALESCE(AVG(sp.unit_cost), 0) AS average_unit_cost,
      COALESCE(SUM(CASE WHEN i.status IN ('low-stock', 'critical', 'out-of-stock') THEN 1 ELSE 0 END), 0) AS low_stock_products
    FROM suppliers s
    LEFT JOIN supplier_products sp ON sp.supplier_id = s.id
    LEFT JOIN inventory i ON i.id = sp.inventory_id
    GROUP BY s.id
    ORDER BY s.company_name ASC
  `);

  res.json(rows);
}));

router.get("/:id/intelligence", asyncHandler(async (req, res) => {
  const supplierId = req.params.id;

  const [[supplier]] = await db.query(`
    SELECT
      s.*,
      COUNT(DISTINCT sp.inventory_id) AS linked_products,
      COALESCE(SUM(CASE WHEN COALESCE(sp.is_active, 1) = 1 THEN 1 ELSE 0 END), 0) AS active_mappings,
      COALESCE(SUM(CASE WHEN COALESCE(sp.preferred_supplier, 0) = 1 THEN 1 ELSE 0 END), 0) AS preferred_mappings,
      COALESCE(SUM(i.stock), 0) AS total_stock_units,
      COALESCE(SUM(i.stock * i.price), 0) AS total_stock_value,
      COALESCE(SUM(CASE WHEN i.status IN ('low-stock', 'critical', 'out-of-stock') THEN 1 ELSE 0 END), 0) AS low_stock_products,
      COALESCE(SUM(CASE WHEN i.status IN ('critical', 'out-of-stock') THEN 1 ELSE 0 END), 0) AS critical_stock_products
    FROM suppliers s
    LEFT JOIN supplier_products sp ON sp.supplier_id = s.id
    LEFT JOIN inventory i ON i.id = sp.inventory_id
    WHERE s.id = ?
    GROUP BY s.id
  `, [supplierId]);

  if (!supplier) {
    return res.status(404).json({ error: "Supplier not found." });
  }

  const [[orderSummary]] = await db.query(`
    SELECT
      COUNT(o.id) AS total_orders,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS sold_last_30_days,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS revenue_last_30_days,
      MAX(o.order_date) AS last_order_date
    FROM supplier_products sp
    JOIN inventory i ON i.id = sp.inventory_id
    LEFT JOIN orders o ON o.inventory_id = i.id
    WHERE sp.supplier_id = ?
  `, [supplierId]);

  const [productRows] = await db.query(`
    SELECT
      sp.id,
      i.id AS inventory_id,
      i.product_name,
      i.sku,
      i.category,
      i.stock,
      sp.stock AS supplier_stock,
      i.price AS sale_price,
      i.status AS inventory_status,
      i.low_stock_point,
      sp.unit_cost,
      sp.contract_price,
      sp.currency,
      sp.lead_time_days,
      sp.quality_rating,
      sp.minimum_order_quantity,
      sp.last_purchase_date,
      sp.last_received_date,
      COALESCE(sp.preferred_supplier, 0) AS preferred_supplier,
      COALESCE(sp.is_active, 1) AS is_active,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS sold_last_7_days,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS sold_last_30_days,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS revenue_last_30_days,
      MAX(o.order_date) AS last_order_date
    FROM supplier_products sp
    JOIN inventory i ON i.id = sp.inventory_id
    LEFT JOIN orders o ON o.inventory_id = i.id
    WHERE sp.supplier_id = ?
    GROUP BY
      sp.id, i.id, i.product_name, i.sku, i.category, i.stock, i.price, i.status,
      i.low_stock_point, sp.unit_cost, sp.contract_price, sp.currency,
      sp.lead_time_days, sp.quality_rating, sp.minimum_order_quantity, sp.last_purchase_date,
      sp.last_received_date, sp.preferred_supplier, sp.is_active
    ORDER BY sold_last_30_days DESC, i.product_name ASC
  `, [supplierId]);

  const products = productRows.map(mapSupplierProduct);

  const [purchaseHistory] = await db.query(`
    SELECT
      o.id,
      o.order_date,
      o.customer_name,
      o.items_count,
      o.total_amount,
      o.status,
      i.product_name
    FROM supplier_products sp
    JOIN inventory i ON i.id = sp.inventory_id
    JOIN orders o ON o.inventory_id = i.id
    WHERE sp.supplier_id = ?
    ORDER BY o.order_date DESC, o.created_at DESC
    LIMIT 12
  `, [supplierId]);

  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
  const topProducts = [...products].sort((a, b) => b.sold_last_30_days - a.sold_last_30_days).slice(0, 3);
  const urgentProducts = products
    .filter((product) => ["low-stock", "critical", "out-of-stock"].includes(product.stock_status))
    .sort((a, b) => (a.days_until_stockout ?? 9999) - (b.days_until_stockout ?? 9999))
    .slice(0, 5);

  const intelligence = {
    orderSummary: {
      total_orders: Number(orderSummary?.total_orders || 0),
      sold_last_30_days: Number(orderSummary?.sold_last_30_days || 0),
      revenue_last_30_days: Number(orderSummary?.revenue_last_30_days || 0),
      last_order_date: orderSummary?.last_order_date || null,
    },
    categories,
    topProducts,
    urgentProducts,
  };

  res.json({
    supplier: {
      ...supplier,
      linked_products: Number(supplier.linked_products || 0),
      active_mappings: Number(supplier.active_mappings || 0),
      preferred_mappings: Number(supplier.preferred_mappings || 0),
      total_stock_units: Number(supplier.total_stock_units || 0),
      total_stock_value: Number(supplier.total_stock_value || 0),
      low_stock_products: Number(supplier.low_stock_products || 0),
      critical_stock_products: Number(supplier.critical_stock_products || 0),
    },
    products,
    purchaseHistory,
    intelligence,
  });
}));

router.get("/:id/products", asyncHandler(async (req, res) => {
  const { products } = await APILikeProducts(req.params.id);
  res.json(products);
}));

async function APILikeProducts(supplierId) {
  const [productRows] = await db.query(`
    SELECT
      sp.id,
      i.id AS inventory_id,
      i.product_name,
      i.sku,
      i.category,
      i.stock,
      sp.stock AS supplier_stock,
      i.price AS sale_price,
      i.status AS inventory_status,
      i.low_stock_point,
      sp.unit_cost,
      sp.contract_price,
      sp.currency,
      sp.lead_time_days,
      sp.quality_rating,
      sp.minimum_order_quantity,
      sp.last_purchase_date,
      sp.last_received_date,
      COALESCE(sp.preferred_supplier, 0) AS preferred_supplier,
      COALESCE(sp.is_active, 1) AS is_active,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS sold_last_7_days,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.items_count ELSE 0 END), 0) AS sold_last_30_days,
      COALESCE(SUM(CASE WHEN o.order_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND o.status != 'cancelled' THEN o.total_amount ELSE 0 END), 0) AS revenue_last_30_days,
      MAX(o.order_date) AS last_order_date
    FROM supplier_products sp
    JOIN inventory i ON i.id = sp.inventory_id
    LEFT JOIN orders o ON o.inventory_id = i.id
    WHERE sp.supplier_id = ?
    GROUP BY
      sp.id, i.id, i.product_name, i.sku, i.category, i.stock, i.price, i.status,
      i.low_stock_point, sp.unit_cost, sp.contract_price, sp.currency,
      sp.lead_time_days, sp.quality_rating, sp.minimum_order_quantity, sp.last_purchase_date,
      sp.last_received_date, sp.preferred_supplier, sp.is_active
    ORDER BY sold_last_30_days DESC, i.product_name ASC
  `, [supplierId]);

  return { products: productRows.map(mapSupplierProduct) };
}

router.get("/:id", asyncHandler(async (req, res) => {
  const [rows] = await db.query("SELECT * FROM suppliers WHERE id = ?", [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ error: "Supplier not found." });
  res.json(rows[0]);
}));

router.post(
  "/",
  authorize("admin"),
  validateBody({
    company_name: { required: true, minLength: 2 },
    status: { enum: ["active", "pending", "inactive"] },
    lead_time_days: { type: "integer", custom: (value) => Number(value) > 0 ? null : "lead_time_days must be greater than 0." },
  }),
  asyncHandler(async (req, res) => {
    const {
      company_name,
      contact_person,
      phone,
      email,
      status,
      lead_time_days,
      on_time_delivery_rate,
      quality_rating,
      payment_terms,
    } = req.body;

    const [result] = await db.query(
      `INSERT INTO suppliers (
        company_name, contact_person, phone, email, status, lead_time_days,
        on_time_delivery_rate, quality_rating, payment_terms
      ) VALUES (?,?,?,?,?,?,?,?,?)`,
      [
        company_name,
        contact_person || null,
        phone || null,
        email || null,
        status || "active",
        lead_time_days || 7,
        on_time_delivery_rate || 95,
        quality_rating || 4.5,
        payment_terms || "Net 30",
      ]
    );

    await logActivity(db, {
      userId: req.user.id,
      actionType: "create",
      entityType: "supplier",
      entityId: result.insertId,
      details: `Created supplier ${company_name}`,
    });

    res.status(201).json({ message: "Supplier added.", id: result.insertId });
  })
);

router.put(
  "/:id",
  authorize("admin", "manager"),
  validateBody({
    company_name: { required: true, minLength: 2 },
    status: { required: true, enum: ["active", "pending", "inactive"] },
    lead_time_days: { type: "integer", custom: (value) => Number(value) > 0 ? null : "lead_time_days must be greater than 0." },
  }),
  asyncHandler(async (req, res) => {
    const {
      company_name,
      contact_person,
      phone,
      email,
      status,
      lead_time_days,
      on_time_delivery_rate,
      quality_rating,
      payment_terms,
    } = req.body;

    const [result] = await db.query(
      `UPDATE suppliers
       SET company_name=?, contact_person=?, phone=?, email=?, status=?,
           lead_time_days=?, on_time_delivery_rate=?, quality_rating=?, payment_terms=?
       WHERE id=?`,
      [
        company_name,
        contact_person,
        phone,
        email,
        status,
        lead_time_days || 7,
        on_time_delivery_rate || 95,
        quality_rating || 4.5,
        payment_terms || "Net 30",
        req.params.id,
      ]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: "Supplier not found." });

    await logActivity(db, {
      userId: req.user.id,
      actionType: "update",
      entityType: "supplier",
      entityId: req.params.id,
      details: `Updated supplier ${company_name}`,
    });

    res.json({ message: "Supplier updated." });
  })
);

router.delete("/:id", authorize("admin"), asyncHandler(async (req, res) => {
  const [[supplier]] = await db.query("SELECT company_name FROM suppliers WHERE id = ?", [req.params.id]);
  
  if (!supplier) {
    return res.status(404).json({ error: "Supplier not found." });
  }

  // Prevent deletion if there is active stock
  const [[{ total_stock }]] = await db.query(
    "SELECT COALESCE(SUM(current_stock), 0) as total_stock FROM inventory_batches WHERE supplier_id = ?", 
    [req.params.id]
  );

  if (Number(total_stock) > 0) {
    return res.status(400).json({ 
      error: `Cannot delete supplier. There are ${total_stock} items in stock from this supplier. Please adjust stock to 0 before deleting.` 
    });
  }

  const [affectedProducts] = await db.query("SELECT inventory_id FROM supplier_products WHERE supplier_id = ?", [req.params.id]);

  const [result] = await db.query("DELETE FROM suppliers WHERE id = ?", [req.params.id]);
  
  // Recalculate stock for affected inventory items
  for (const { inventory_id } of affectedProducts) {
    const [[inv]] = await db.query("SELECT category, low_stock_point FROM inventory WHERE id = ?", [inventory_id]);
    if (inv) {
      // Re-sync using batches
      const [[{ new_total_stock }]] = await db.query(
        "SELECT COALESCE(SUM(current_stock), 0) AS new_total_stock FROM inventory_batches WHERE inventory_id = ?",
        [inventory_id]
      );
      
      const totalStock = Number(new_total_stock || 0);
      const newStatus = calculateStatus(totalStock, inv.low_stock_point, inv.category);
      
      const [[activeBatch]] = await db.query(
        "SELECT selling_price FROM inventory_batches WHERE inventory_id = ? AND current_stock > 0 ORDER BY received_at ASC LIMIT 1",
        [inventory_id]
      );
      
      if (activeBatch) {
        await db.query("UPDATE inventory SET stock = ?, status = ?, price = ? WHERE id = ?", [totalStock, newStatus, activeBatch.selling_price, inventory_id]);
      } else {
        await db.query("UPDATE inventory SET stock = ?, status = ? WHERE id = ?", [totalStock, newStatus, inventory_id]);
      }
    }
  }

  await logActivity(db, {
    userId: req.user.id,
    actionType: "delete",
    entityType: "supplier",
    entityId: req.params.id,
    details: `Deleted supplier ${supplier.company_name}`,
  });

  res.json({ message: "Supplier deleted and associated inventory updated." });
}));

module.exports = router;
