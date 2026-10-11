const { Pool } = require("pg");

/**
 * Converts a "?"-placeholder MySQL-style query into PostgreSQL's "$1, $2, ..."
 * placeholder style. Every "?" in the whole codebase is a bind parameter
 * (never a literal character), so a straightforward left-to-right rename is safe.
 */
function toPgSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * Runs `query` and returns a [rows, meta] tuple shaped like the mysql2 API
 * this codebase was originally written against, so call sites written as
 * `const [rows] = await db.execute(...)` or `const [result] = await
 * connection.execute(...)` keep working unchanged.
 *
 * meta.affectedRows mirrors pg's rowCount. meta.insertId reads the first
 * row's "id" column, present only on INSERT statements that end with
 * `RETURNING <primary key> AS id`.
 */
async function execute(queryable, sql, params) {
  const result = await queryable.query(toPgSql(sql), params);
  const meta = { affectedRows: result.rowCount, insertId: result.rows[0]?.id };
  return [result.rows, meta];
}

function attachExecute(queryable) {
  queryable.execute = (sql, params) => execute(queryable, sql, params);
  return queryable;
}

/**
 * Creates the shared PostgreSQL connection pool.
 * All timestamps (created_at, completed_at, ...) are stored and read as UTC
 * so the server behaves the same no matter where it runs; see the
 * "(now() AT TIME ZONE 'utc')" expressions used throughout lib/task-repository.js.
 */
function createPool(dbConfig) {
  const pool = new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    database: dbConfig.database,
    max: dbConfig.connectionLimit,
    ssl: dbConfig.ssl,
  });
  pool.on("error", (error) => {
    // Emitted for errors on idle clients in the pool; a failed query already
    // rejects its own caller, so this only logs unexpected background errors.
    console.error("Unexpected error on idle PostgreSQL client:", error.message);
  });
  attachExecute(pool);

  // getConnection() mirrors mysql2's API: a single checked-out client with
  // execute()/beginTransaction()/commit()/rollback()/release().
  pool.getConnection = async () => {
    const client = await pool.connect();
    attachExecute(client);
    client.beginTransaction = () => client.query("BEGIN");
    client.commit = () => client.query("COMMIT");
    client.rollback = () => client.query("ROLLBACK");
    return client;
  };
  return pool;
}

module.exports = { createPool, toPgSql };
