require("dotenv").config();
const mysql = require("mysql2/promise");
const { migrate } = require("./migrate");
const { sslOptions } = require("../lib/config");

async function setupDatabase() {
  const { DB_HOST = "127.0.0.1", DB_PORT = "3306", DB_USER, DB_PASSWORD = "", DB_NAME } = process.env;
  if (!DB_USER || !DB_NAME || !/^[a-zA-Z0-9_]+$/.test(DB_NAME)) {
    throw new Error("Set DB_USER and a DB_NAME containing only letters, numbers, and underscores in .env.");
  }

  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    charset: "utf8mb4",
    ssl: sslOptions(),
  });
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.changeUser({ database: DB_NAME });
    const applied = await migrate(connection);
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "No new migrations to apply.");
    console.log(`Database "${DB_NAME}" and its tables are ready.`);
  } finally {
    await connection.end();
  }
}

setupDatabase().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  process.exitCode = 1;
});
