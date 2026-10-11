const fs = require("node:fs/promises");
const path = require("node:path");

const SCHEMA_FILE = path.join(__dirname, "schema.sql");
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

// Splits a .sql file into statements. Our SQL files never contain semicolons
// inside strings, so a simple split is enough. Lines starting with "--" are comments.
function splitStatements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/**
 * Brings the database up to date.
 * 1. schema.sql creates the original (version 1) tables when they are missing.
 * 2. Each file in database/migrations runs once, in name order, and is recorded
 *    in the schema_migrations table so it is never applied twice.
 *
 * @param {import("mysql2/promise").Connection} connection
 * @returns {Promise<string[]>} the migrations applied by this run
 */
async function migrate(connection) {
  for (const statement of splitStatements(await fs.readFile(SCHEMA_FILE, "utf8"))) {
    await connection.query(statement);
  }
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [rows] = await connection.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.version));
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
  const newlyApplied = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const statement of splitStatements(sql)) {
      await connection.query(statement);
    }
    await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
    newlyApplied.push(file);
  }
  return newlyApplied;
}

module.exports = { migrate, splitStatements };
