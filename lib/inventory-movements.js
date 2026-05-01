async function recordInventoryMovement(db, payload) {
  const {
    inventoryId,
    movementType,
    quantity,
    beforeStock,
    afterStock,
    referenceType = null,
    referenceId = null,
    performedBy = null,
    reason = null,
  } = payload;

  if (!inventoryId || !movementType) return;

  try {
    await db.query(
      `INSERT INTO inventory_movements (
        inventory_id, movement_type, quantity, before_stock, after_stock,
        reference_type, reference_id, performed_by, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        inventoryId,
        movementType,
        quantity,
        beforeStock,
        afterStock,
        referenceType,
        referenceId,
        performedBy,
        reason,
      ]
    );
  } catch (error) {
    console.error("Failed to record inventory movement:", error.message);
  }
}

module.exports = { recordInventoryMovement };
