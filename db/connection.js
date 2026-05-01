const mysql = require("mysql2/promise");
const { env } = require("../src/config/env");

const pool = mysql.createPool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  multipleStatements: true,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test the database connection on startup.
pool
  .getConnection()
  .then((conn) => {
    console.log("MySQL connected successfully.");
    conn.release();
  })
  .catch((err) => {
    console.error("MySQL connection failed:", err.message);
    process.exit(1);
  });

module.exports = pool;
