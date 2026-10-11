require("dotenv").config();
const { Client } = require("pg");
const { migrate } = require("./migrate");
const { sslOptions } = require("../lib/config");

async function setupDatabase() {
  const { DB_HOST = "127.0.0.1", DB_PORT = "5432", DB_USER, DB_PASSWORD = "", DB_NAME } = process.env;
  if (!DB_USER || !DB_NAME || !/^[a-zA-Z0-9_]+$/.test(DB_NAME)) {
    throw new Error("Set DB_USER and a DB_NAME containing only letters, numbers, and underscores in .env.");
  }

  // Managed PostgreSQL hosts (Aiven, Render, etc.) provision the database for
  // you, and the app's user usually cannot CREATE DATABASE, so this connects
  // straight to DB_NAME and only brings its tables up to date.
  const client = new Client({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
    ssl: sslOptions(),
  });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "No new migrations to apply.");
    console.log(`Database "${DB_NAME}" and its tables are ready.`);
  } finally {
    await client.end();
  }
}

setupDatabase().catch((error) => {
  console.error(`Database setup failed: ${error.message}`);
  process.exitCode = 1;
});
