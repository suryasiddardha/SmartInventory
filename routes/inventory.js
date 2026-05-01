const express = require("express");
const db = require("../db/connection");
const { authenticate, authorize } = require("../middleware/auth");
const { calculateStatus, resolveReorderLevel } = require("../lib/inventory-utils");
const { logActivity } = require("../lib/activity-log");
const { recordInventoryMovement } = require("../lib/inventory-movements");
const { asyncHandler } = require("../src/shared/http/async-handler");
const { validateBody } = require("../src/shared/http/validate");

const router = express.Router();

router.use(authenticate);

async function syncInventoryStockAndStatus(inventoryId) {
  const [[inventory]] = await db.query(
    "SELECT category, low_stock_point FROM inventory WHERE id = ?",
    [inventoryId]
  );

  if (!inventory) return { totalStock: 0, status: "out-of-stock" };

  const [[{ total_stock }]] = await db.query(
    "SELECT COALESCE(SUM(stock), 0) AS total_stock FROM supplier_products WHERE inventory_id = ? AND is_active = 1",
    [inventoryId]
  );

  const totalStock = Number(total_stock || 0);
  const status = calculateStatus(totalStock, inventory.low_stock_point, inventory.category);

  await db.query(
    "UPDATE inventory SET stock = ?, status = ? WHERE id = ?",
    [totalStock, status, inventoryId]
  );

  return { totalStock, status };
}

// NEW: specific supplier update route (Moved to top to avoid shadowing)
router.put("/:inventoryId/suppliers/:supplierId", authorize("admin", "manager"), asyncHandler(async (req, res) => {
  const { inventoryId, supplierId } = req.params;
  const { stock, unit_cost } = req.body;

  const [rows] = await db.query(
    "SELECT * FROM supplier_products WHERE inventory_id = ? AND supplier_id = ?",
    [inventoryId, supplierId]
  );

  if (rows.length === 0) {
    return res.status(404).json({ message: "Supplier-product relationship not found" });
  }

  const [[beforeInv]] = await db.query("SELECT stock FROM inventory WHERE id = ?", [inventoryId]);
  const beforeStock = Number(beforeInv?.stock || 0);

  await db.query(
    "UPDATE supplier_products SET stock = ?, unit_cost = ? WHERE inventory_id = ? AND supplier_id = ?",
    [Number(stock), Number(unit_cost), inventoryId, supplierId]
  );

  const { totalStock } = await syncInventoryStockAndStatus(inventoryId);

  if (totalStock !== beforeStock) {
    const diff = totalStock - beforeStock;
    await recordInventoryMovement(db, {
      inventoryId,
      movementType: diff > 0 ? "restock" : "adjustment",
      quantity: Math.abs(diff),
      beforeStock,
      afterStock: totalStock,
      referenceType: "manual_update",
      performedBy: req.user.id,
      reason: `Supplier stock updated manually to ${stock}`,
    });
  }

  await logActivity(db, {
    userId: req.user.id,
    actionType: "update",
    entityType: "inventory",
    entityId: inventoryId,
    details: `Updated stock (${stock}) and price (${unit_cost}) for supplier ID ${supplierId}`,
  });

  res.json({ message: "Supplier product updated successfully", total_stock: totalStock });
}));

router.get("/", asyncHandler(async (req, res) => {
    const [rows] = await db.query(`
      SELECT
        i.id,
        i.product_name,
        i.category,
        i.stock,
        i.price,
        i.expiry_date,
        i.status,
        i.description,
        i.low_stock_point,
        i.created_at,
        i.updated_at,
        s.id AS supplier_id,
        s.company_name AS supplier_name,
        s.contact_person AS supplier_contact_person,
        s.phone AS supplier_phone,
        s.email AS supplier_email,
        s.status AS supplier_status
      FROM inventory i
      LEFT JOIN suppliers s ON i.supplier_id = s.id
      ORDER BY i.updated_at DESC
    `);

    // Fetch all supplier mappings
    const [supplierProducts] = await db.query(`
      SELECT
        sp.inventory_id,
        s.id AS supplier_id,
        s.company_name,
        sp.stock AS supplier_stock,
        sp.unit_cost
      FROM supplier_products sp
      JOIN suppliers s ON sp.supplier_id = s.id
      WHERE sp.is_active = 1
    `);

    // Group mappings by inventory_id
    const mappingsByInv = {};
    for (const sp of supplierProducts) {
      if (!mappingsByInv[sp.inventory_id]) {
        mappingsByInv[sp.inventory_id] = [];
      }
      mappingsByInv[sp.inventory_id].push({
        id: sp.supplier_id,
        company_name: sp.company_name,
        stock: Number(sp.supplier_stock || 0),
        unit_cost: Number(sp.unit_cost || 0),
      });
    }

    res.json(rows.map((item) => {
      const all_suppliers = mappingsByInv[item.id] || [];
      return {
        ...item,
        low_stock_point: item.low_stock_point,
        supplier_count: all_suppliers.length,
        all_suppliers: all_suppliers,
        supplier: item.supplier_id ? {
          id: item.supplier_id,
          company_name: item.supplier_name,
          contact_person: item.supplier_contact_person,
          phone: item.supplier_phone,
          email: item.supplier_email,
          status: item.supplier_status,
        } : null,
        supplier_id: undefined,
        supplier_name: undefined,
        supplier_contact_person: undefined,
        supplier_phone: undefined,
        supplier_email: undefined,
        supplier_status: undefined,
      };
    }));
}));

router.get("/alerts", async (req, res) => {
  try {
    const [lowStock] = await db.query(`
      SELECT
        id,
        product_name,
        category,
        stock,
        low_stock_point,
        status,
        COALESCE(low_stock_point, 20) AS effective_low_stock_point
      FROM inventory
      WHERE stock <= COALESCE(low_stock_point, 20)
      ORDER BY effective_low_stock_point - stock DESC, stock ASC
    `);

    const [expiring] = await db.query(`
      SELECT id, product_name, expiry_date, stock
      FROM inventory
      WHERE expiry_date IS NOT NULL
        AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 90 DAY)
        AND expiry_date >= CURDATE()
      ORDER BY expiry_date ASC
    `);

    res.json({
      lowStock: lowStock.map((item) => ({
        ...item,
        low_stock_point: item.low_stock_point,
        effective_low_stock_point: Number(resolveReorderLevel(item.low_stock_point, item.category)),
      })),
      expiring,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch alerts." });
  }
});

router.get("/:id/alternative-suppliers", asyncHandler(async (req, res) => {
  const inventoryId = req.params.id;

  const [suppliers] = await db.query(`
    SELECT
      s.id,
      s.company_name,
      s.contact_person,
      s.phone,
      s.email,
      s.status AS supplier_status,
      sp.stock AS supplier_stock,
      sp.unit_cost,
      sp.contract_price,
      sp.lead_time_days,
      sp.minimum_order_quantity,
      sp.preferred_supplier,
      sp.is_active,
      CASE WHEN i.supplier_id = s.id THEN 1 ELSE 0 END AS is_current
    FROM supplier_products sp
    JOIN suppliers s ON sp.supplier_id = s.id
    JOIN inventory i ON sp.inventory_id = i.id
    WHERE sp.inventory_id = ? AND sp.is_active = 1
    ORDER BY sp.preferred_supplier DESC, sp.unit_cost ASC
  `, [inventoryId]);

  res.json({
    alternatives: suppliers.map(s => ({
      id: s.id,
      company_name: s.company_name,
      contact_person: s.contact_person,
      phone: s.phone,
      email: s.email,
      status: s.supplier_status,
      stock: Number(s.supplier_stock || 0),
      unit_cost: Number(s.unit_cost || 0),
      contract_price: s.contract_price ? Number(s.contract_price) : null,
      lead_time_days: Number(s.lead_time_days || 7),
      minimum_order_quantity: Number(s.minimum_order_quantity || 1),
      is_preferred: Boolean(s.preferred_supplier),
      is_current: Boolean(s.is_current),
    })),
  });
}));

router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        i.id,
        i.product_name,
        i.category,
        i.stock,
        i.price,
        i.expiry_date,
        i.status,
        i.description,
        i.low_stock_point,
        i.created_at,
        i.updated_at,
        s.id AS supplier_id,
        s.company_name AS supplier_name,
        s.contact_person AS supplier_contact_person,
        s.phone AS supplier_phone,
        s.email AS supplier_email
      FROM inventory i
      LEFT JOIN suppliers s ON i.supplier_id = s.id
      WHERE i.id = ?
    `, [req.params.id]);

    if (rows.length === 0) return res.status(404).json({ error: "Item not found." });

    const item = rows[0];
    res.json({
      ...item,
      low_stock_point: item.low_stock_point,
      supplier: item.supplier_id ? {
        id: item.supplier_id,
        company_name: item.supplier_name,
        contact_person: item.supplier_contact_person,
        phone: item.supplier_phone,
        email: item.supplier_email,
      } : null,
      supplier_id: undefined,
      supplier_name: undefined,
      supplier_contact_person: undefined,
      supplier_phone: undefined,
      supplier_email: undefined,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch item." });
  }
});

router.post(
  "/",
  authorize("admin", "manager"),
  validateBody({
    product_name: { required: true, minLength: 2 },
    category: { required: true, enum: ["Electronics", "Food & Beverages", "Daily Essentials", "Utensils & Kitchenware", "electronics"] },
    supplier_id: { required: true, type: "integer" },
    stock: { required: true, type: "integer" },
    price: { required: true, type: "number", custom: (value) => Number(value) >= 0 ? null : "price must be 0 or higher." },
  }),
  asyncHandler(async (req, res) => {
    const {
      product_name,
      category,
      stock,
      price,
      expiry_date,
      supplier_id,
      description,
      low_stock_point,
    } = req.body;

    // CHECK FOR DUPLICATE PRODUCT NAME
    const [[existingItem]] = await db.query(
      "SELECT id FROM inventory WHERE product_name = ?",
      [product_name]
    );

    let inventoryId;

    if (existingItem) {
      // PRODUCT EXISTS: Link new supplier to existing ID
      inventoryId = existingItem.id;

      // Check if this supplier is already linked to this product
      const [[existingLink]] = await db.query(
        "SELECT id FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
        [supplier_id, inventoryId]
      );

      if (existingLink) {
        return res.status(400).json({ 
          error: `Supplier is already linked to '${product_name}'. Use the Edit button to update their stock instead.` 
        });
      }

      // Add the new supplier link
      const [supplierRows] = await db.query(
        "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
        [supplier_id]
      );
      const supplier = supplierRows[0];

      await db.query(
        `INSERT INTO supplier_products (
          supplier_id, inventory_id, unit_cost, contract_price, currency,
          lead_time_days, quality_rating, minimum_order_quantity, preferred_supplier, is_active, stock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          supplier_id,
          inventoryId,
          price,
          null,
          'USD',
          supplier?.lead_time_days || 7,
          supplier?.quality_rating || 4.5,
          1,
          0, // Not primary initially
          1,
          stock,
        ]
      );
    } else {
      // NEW PRODUCT: Create row in inventory table
      const itemStatus = calculateStatus(stock, low_stock_point, category);
      const [result] = await db.query(
        `INSERT INTO inventory (
          product_name, category, stock, price, expiry_date, supplier_id, status, description,
          low_stock_point
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          product_name,
          category,
          stock,
          price,
          expiry_date || null,
          supplier_id,
          itemStatus,
          description || null,
          low_stock_point || null,
        ]
      );
      inventoryId = result.insertId;

      // Create the initial supplier_products entry
      const [supplierRows] = await db.query(
        "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
        [supplier_id]
      );
      const supplier = supplierRows[0];

      await db.query(
        `INSERT INTO supplier_products (
          supplier_id, inventory_id, unit_cost, contract_price, currency,
          lead_time_days, quality_rating, minimum_order_quantity, preferred_supplier, is_active, stock
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          supplier_id,
          inventoryId,
          price,
          null,
          'USD',
          supplier?.lead_time_days || 7,
          supplier?.quality_rating || 4.5,
          1,
          1, // Primary supplier
          1,
          stock,
        ]
      );
    }

    // Recalculate total stock for the inventory item (covers both new and existing items)
    const { totalStock } = await syncInventoryStockAndStatus(inventoryId);

    if (!existingItem && Number(stock) > 0) {
      await recordInventoryMovement(db, {
        inventoryId,
        movementType: "restock",
        quantity: Number(stock),
        beforeStock: 0,
        afterStock: Number(stock),
        referenceType: "initial",
        performedBy: req.user.id,
        reason: "Initial stock on creation",
      });
    }

    res.status(201).json({ 
      message: existingItem ? "Supplier linked to existing product." : "New item added successfully.", 
      id: inventoryId 
    });
  })
);

router.put("/:id", authorize("admin", "manager"), async (req, res) => {
  try {
    const {
      product_name,
      category,
      stock,
      price,
      expiry_date,
      supplier_id,
      description,
      low_stock_point,
    } = req.body;
    const requestedSupplierId = supplier_id ? Number(supplier_id) : null;
    const requestedStock = Number(stock);

    const [[oldInv]] = await db.query("SELECT stock FROM inventory WHERE id = ?", [req.params.id]);
    const oldStock = Number(oldInv?.stock || 0);

    // Get the current product
    const [[currentProduct]] = await db.query(
      "SELECT supplier_id FROM inventory WHERE id = ?",
      [req.params.id]
    );

    if (!currentProduct) {
      return res.status(404).json({ error: "Item not found." });
    }

    if (!requestedSupplierId) {
      return res.status(400).json({ error: "Supplier is required." });
    }
    if (!Number.isFinite(requestedStock) || requestedStock < 0) {
      return res.status(400).json({ error: "Stock must be 0 or higher." });
    }

    // Update basic inventory fields (don't delete anything)
    const itemStatus = calculateStatus(requestedStock, low_stock_point, category);
    const [result] = await db.query(
      `UPDATE inventory
       SET product_name=?, category=?, stock=?, price=?, expiry_date=?,
           status=?, description=?, low_stock_point=?
       WHERE id=?`,
      [
        product_name,
        category,
        requestedStock,
        price,
        expiry_date || null,
        itemStatus,
        description || null,
        low_stock_point || null,
        req.params.id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Item not found." });
    }

    // If supplier_id is provided and different from current, just update the primary supplier
    // Don't delete other suppliers - they remain as alternatives
    if (requestedSupplierId !== Number(currentProduct.supplier_id)) {
      await db.query(
        "UPDATE inventory SET supplier_id = ? WHERE id = ?",
        [requestedSupplierId, req.params.id]
      );

      await db.query(
        "UPDATE supplier_products SET preferred_supplier = 0 WHERE inventory_id = ?",
        [req.params.id]
      );

      // Check if this supplier is already linked
      const [[existingLink]] = await db.query(
        "SELECT id FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
        [requestedSupplierId, req.params.id]
      );

      if (!existingLink) {
        // Add this as a new supplier option (don't delete old ones)
        const [supplierRows] = await db.query(
          "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
          [requestedSupplierId]
        );
        const supplier = supplierRows[0];

        await db.query(
          `INSERT INTO supplier_products (
            supplier_id, inventory_id, unit_cost, contract_price, currency,
            lead_time_days, quality_rating, minimum_order_quantity, preferred_supplier, is_active, stock
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestedSupplierId,
            req.params.id,
            price,
            null,
            'USD',
            supplier?.lead_time_days || 7,
            supplier?.quality_rating || 4.5,
            1,
            1, // Make new supplier preferred initially
            1,
            requestedStock,
          ]
        );
      } else {
        // Update existing supplier_products entry
        const [supplierRows] = await db.query(
          "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
          [requestedSupplierId]
        );
        const supplier = supplierRows[0];

        await db.query(
          `UPDATE supplier_products 
           SET unit_cost = ?, preferred_supplier = 1, lead_time_days = ?, quality_rating = ?, stock = ?
           WHERE supplier_id = ? AND inventory_id = ?`,
          [
            price,
            supplier?.lead_time_days || 7,
            supplier?.quality_rating || 4.5,
            requestedStock,
            requestedSupplierId,
            req.params.id,
          ]
        );
      }
    } else {
      // Same supplier, just update the supplier_products entry
      const [supplierRows] = await db.query(
        "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
        [requestedSupplierId]
      );
      const supplier = supplierRows[0];

      const [[existingLink]] = await db.query(
        "SELECT id FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
        [requestedSupplierId, req.params.id]
      );

      if (!existingLink) {
        await db.query(
          `INSERT INTO supplier_products (
            supplier_id, inventory_id, unit_cost, contract_price, currency,
            lead_time_days, quality_rating, minimum_order_quantity, preferred_supplier, is_active, stock
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            requestedSupplierId,
            req.params.id,
            price,
            null,
            'USD',
            supplier?.lead_time_days || 7,
            supplier?.quality_rating || 4.5,
            1,
            1,
            1,
            requestedStock,
          ]
        );
      } else {
        await db.query(
          `UPDATE supplier_products
           SET unit_cost = ?, lead_time_days = ?, quality_rating = ?, stock = ?
           WHERE supplier_id = ? AND inventory_id = ?`,
          [
            price,
            supplier?.lead_time_days || 7,
            supplier?.quality_rating || 4.5,
            requestedStock,
            requestedSupplierId,
            req.params.id,
          ]
        );
      }
    }

    const { totalStock } = await syncInventoryStockAndStatus(req.params.id);

    if (totalStock !== oldStock) {
      const diff = totalStock - oldStock;
      await recordInventoryMovement(db, {
        inventoryId: req.params.id,
        movementType: diff > 0 ? "restock" : "adjustment",
        quantity: Math.abs(diff),
        beforeStock: oldStock,
        afterStock: totalStock,
        referenceType: "manual_update",
        performedBy: req.user.id,
        reason: "Manual adjustment via update",
      });
    }

    await logActivity(db, {
      userId: req.user.id,
      actionType: "update",
      entityType: "inventory",
      entityId: req.params.id,
      details: `Updated inventory item ${product_name}`,
    });

    res.json({ message: "Item updated successfully." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update item." });
  }
});

router.delete("/:id", authorize("admin"), async (req, res) => {
  try {
    const [[item]] = await db.query("SELECT product_name FROM inventory WHERE id = ?", [req.params.id]);
    const [result] = await db.query("DELETE FROM inventory WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Item not found." });

    await logActivity(db, {
      userId: req.user.id,
      actionType: "delete",
      entityType: "inventory",
      entityId: req.params.id,
      details: `Deleted inventory item ${item?.product_name || req.params.id}`,
    });

    res.json({ message: "Item deleted successfully." });
  } catch (err) {
    if (err.code === "ER_ROW_IS_REFERENCED_2" || (err.message && err.message.includes("foreign key constraint"))) {
      return res.status(400).json({ error: "Cannot delete this item because it is referenced by existing orders. Please cancel or delete the associated orders first." });
    }
    res.status(500).json({ error: "Failed to delete item." });
  }
});

// Add an alternative supplier to an existing product (without deleting other suppliers)
router.post(
  "/:id/suppliers",
  authorize("admin", "manager"),
  validateBody({
    supplier_id: { required: true, type: "integer" },
    unit_cost: { required: true, type: "number", custom: (value) => Number(value) >= 0 ? null : "unit_cost must be 0 or higher." },
  }),
  asyncHandler(async (req, res) => {
    const inventoryId = req.params.id;
    const { supplier_id, unit_cost } = req.body;

    // Check if product exists
    const [[product]] = await db.query(
      "SELECT product_name FROM inventory WHERE id = ?",
      [inventoryId]
    );
    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    // Check if supplier exists
    const [[supplier]] = await db.query(
      "SELECT lead_time_days, quality_rating FROM suppliers WHERE id = ?",
      [supplier_id]
    );
    if (!supplier) {
      return res.status(404).json({ error: "Supplier not found." });
    }

    // Check if this supplier is already linked to this product
    const [[existingLink]] = await db.query(
      "SELECT id FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
      [supplier_id, inventoryId]
    );

    if (existingLink) {
      return res.status(400).json({ 
        error: `${product.product_name} is already linked to this supplier.` 
      });
    }

    // Add the supplier as an alternative
    await db.query(
      `INSERT INTO supplier_products (
        supplier_id, inventory_id, unit_cost, contract_price, currency,
        lead_time_days, quality_rating, minimum_order_quantity, preferred_supplier, is_active, stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        supplier_id,
        inventoryId,
        unit_cost,
        null, // contract_price
        'USD',
        supplier.lead_time_days || 7,
        supplier.quality_rating || 4.5,
        1, // minimum_order_quantity
        0, // preferred_supplier (don't override existing)
        1, // is_active
        0, // new supplier option starts with 0 stock
      ]
    );

    await logActivity(db, {
      userId: req.user.id,
      actionType: "update",
      entityType: "inventory",
      entityId: inventoryId,
      details: `Added alternative supplier to ${product.product_name}`,
    });

    res.status(201).json({ 
      message: "Alternative supplier added successfully.",
      productId: inventoryId,
      supplierId: supplier_id,
    });
  })
);

// Remove a supplier option from a product (but keep the product itself)
router.delete(
  "/:id/suppliers/:supplierId",
  authorize("admin", "manager"),
  asyncHandler(async (req, res) => {
    const { id: inventoryId, supplierId } = req.params;

    // Check if product exists
    const [[product]] = await db.query(
      "SELECT product_name, supplier_id FROM inventory WHERE id = ?",
      [inventoryId]
    );
    if (!product) {
      return res.status(404).json({ error: "Product not found." });
    }

    // Prevent removing the primary supplier if it's the only one
    const [[supplierLink]] = await db.query(
      "SELECT id FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
      [supplierId, inventoryId]
    );
    if (!supplierLink) {
      return res.status(404).json({ error: "This supplier is not linked to this product." });
    }

    // Check how many suppliers this product has
    const [[count]] = await db.query(
      "SELECT COUNT(*) as total FROM supplier_products WHERE inventory_id = ?",
      [inventoryId]
    );

    if (count.total === 1 && Number(product.supplier_id) === Number(supplierId)) {
      return res.status(400).json({ 
        error: "Cannot remove the last supplier. A product must have at least one supplier." 
      });
    }

    // Remove the supplier option
    await db.query(
      "DELETE FROM supplier_products WHERE supplier_id = ? AND inventory_id = ?",
      [supplierId, inventoryId]
    );

    // If this was the primary supplier, reassign to another available supplier
    if (Number(product.supplier_id) === Number(supplierId)) {
      const [[newPrimary]] = await db.query(
        "SELECT supplier_id FROM supplier_products WHERE inventory_id = ? LIMIT 1",
        [inventoryId]
      );
      if (newPrimary) {
        await db.query(
          "UPDATE inventory SET supplier_id = ? WHERE id = ?",
          [newPrimary.supplier_id, inventoryId]
        );
      }
    }

    await syncInventoryStockAndStatus(inventoryId);

    await logActivity(db, {
      userId: req.user.id,
      actionType: "update",
      entityType: "inventory",
      entityId: inventoryId,
      details: `Removed supplier option from ${product.product_name}`,
    });

    res.json({ message: "Supplier removed successfully." });
  })
);



module.exports = router;
