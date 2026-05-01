async function tableExists(db, tableName) {
  const [[result]] = await db.query(
    `SELECT COUNT(*) AS table_count
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name = ?`,
    [tableName]
  );

  return Number(result?.table_count || 0) > 0;
}

module.exports = { tableExists };
