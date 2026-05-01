async function logActivity(db, payload) {
  const {
    userId = null,
    actionType,
    entityType,
    entityId = null,
    details = null,
    status = "success",
  } = payload;

  if (!actionType || !entityType) return;

  try {
    await db.query(
      `INSERT INTO activity_logs (user_id, action_type, entity_type, entity_id, details, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, actionType, entityType, entityId, details, status]
    );
  } catch (error) {
    console.error("Failed to write activity log:", error.message);
  }
}

module.exports = { logActivity };
