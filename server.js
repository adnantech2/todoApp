require("dotenv").config();
const { Client } = require("pg");
const { loadConfig } = require("./lib/config");
const { createPool } = require("./lib/database");
const { createApp } = require("./lib/app");
const PostgresSessionStore = require("./lib/mysql-session-store");
const { migrate } = require("./database/migrate");

const config = loadConfig();
if (config.isProduction && !config.trustProxy) {
  console.warn("Warning: NODE_ENV=production without TRUST_PROXY=1. Behind an HTTPS proxy (Railway, Render, Nginx) sign-in cookies will not be set.");
}

/**
 * Brings the database's tables up to date on every boot. Most managed
 * PostgreSQL free tiers (Render, Aiven, ...) do not offer a separate
 * pre-deploy shell step, so the server migrates itself on startup instead
 * of requiring `npm run db:setup` to be run by hand. Uses its own short-lived
 * connection, independent of the app's pool.
 */
async function migrateOnBoot() {
  const client = new Client({ ...config.db, max: undefined });
  await client.connect();
  try {
    const applied = await migrate(client);
    console.log(applied.length ? `Applied migrations: ${applied.join(", ")}` : "Database schema is up to date.");
  } finally {
    await client.end();
  }
}

async function start() {
  await migrateOnBoot();
  const pool = createPool(config.db);
  const sessionStore = new PostgresSessionStore(pool, { ttl: config.sessionMaxAgeHours * 60 * 60 * 1000 });
  const app = createApp({ pool, sessionStore, config });

  const server = app.listen(config.port, config.host, () => {
    console.log(`TodoApp is running at http://${config.host}:${config.port}`);
  });
  return { server, pool, sessionStore };
}

const ready = start().catch((error) => {
  console.error("Failed to start the server:", error.message);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  // Force-exit if open connections keep the server alive for too long.
  setTimeout(() => process.exit(1), 10_000).unref();
  const { server, pool, sessionStore } = await ready;
  server.close(() => {
    sessionStore.close();
    pool.end()
      .then(() => process.exit(0))
      .catch((error) => {
        console.error("Error closing the PostgreSQL pool:", error.message);
        process.exit(1);
      });
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));
