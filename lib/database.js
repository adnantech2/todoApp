const mysql = require("mysql2");

/**
 * Creates the shared MySQL connection pool.
 * Each connection uses UTC so timestamps (created_at, completed_at, ...) are
 * consistent no matter where the server runs.
 */
function createPool(dbConfig) {
  const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    queueLimit: 0,
    charset: "utf8mb4",
    dateStrings: true,
  });
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}

module.exports = { createPool };
