require("dotenv").config();
const { loadConfig } = require("./lib/config");
const { createPool } = require("./lib/database");
const { createApp } = require("./lib/app");
const MySQLSessionStore = require("./lib/mysql-session-store");

const config = loadConfig();
if (config.isProduction && !config.trustProxy) {
  console.warn("Warning: NODE_ENV=production without TRUST_PROXY=1. Behind an HTTPS proxy (Railway, Render, Nginx) sign-in cookies will not be set.");
}
const pool = createPool(config.db);
const sessionStore = new MySQLSessionStore(pool, { ttl: config.sessionMaxAgeHours * 60 * 60 * 1000 });
const app = createApp({ pool, sessionStore, config });

const server = app.listen(config.port, config.host, () => {
  console.log(`TodoApp is running at http://${config.host}:${config.port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down...`);
  // Force-exit if open connections keep the server alive for too long.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    sessionStore.close();
    pool.end((error) => {
      if (error) console.error("Error closing the MySQL pool:", error.message);
      process.exit(error ? 1 : 0);
    });
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => console.error("Unhandled promise rejection:", reason));
