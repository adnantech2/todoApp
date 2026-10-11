// Reads and validates environment variables once at start-up.
// The server refuses to start with unsafe or missing settings.

/**
 * TLS options for managed MySQL services that require encrypted connections.
 * DB_SSL=1 turns it on; DB_SSL_CA may hold the provider's CA certificate (PEM,
 * with real or "\n"-escaped newlines). Without a CA, Node's trusted roots are used.
 */
function sslOptions(env = process.env) {
  if (env.DB_SSL !== "1") return undefined;
  const ssl = { rejectUnauthorized: true };
  if (env.DB_SSL_CA) ssl.ca = env.DB_SSL_CA.replace(/\\n/g, "\n");
  return ssl;
}

function loadConfig(env = process.env) {
  const config = {
    port: Number(env.PORT || 3000),
    host: env.HOST || "127.0.0.1",
    isProduction: env.NODE_ENV === "production",
    trustProxy: env.TRUST_PROXY === "1",
    sessionSecret: env.SESSION_SECRET,
    sessionMaxAgeHours: Number(env.SESSION_MAX_AGE_HOURS || 24),
    authRateLimit: Number(env.AUTH_RATE_LIMIT || 10),
    apiRateLimit: Number(env.API_RATE_LIMIT || 300),
    logRequests: env.LOG_REQUESTS ? env.LOG_REQUESTS === "1" : env.NODE_ENV !== "test",
    db: {
      host: env.DB_HOST || "127.0.0.1",
      port: Number(env.DB_PORT || 3306),
      user: env.DB_USER,
      password: env.DB_PASSWORD || "",
      database: env.DB_NAME,
      connectionLimit: Number(env.DB_CONNECTION_LIMIT || 10),
      ssl: sslOptions(env),
    },
  };

  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters.");
  }
  if (config.sessionSecret.startsWith("replace-with-a-random-secret")) {
    throw new Error("Replace the example SESSION_SECRET with a private random value before starting the server.");
  }
  if (!config.db.database || !/^[a-zA-Z0-9_]+$/.test(config.db.database)) {
    throw new Error("DB_NAME must be set and may contain only letters, numbers, and underscores.");
  }
  if (!config.db.user) throw new Error("DB_USER must be set to a MySQL account.");
  if (!Number.isInteger(config.port) || config.port < 0 || config.port > 65535) throw new Error("PORT must be a valid TCP port.");
  for (const [name, value] of [
    ["SESSION_MAX_AGE_HOURS", config.sessionMaxAgeHours],
    ["AUTH_RATE_LIMIT", config.authRateLimit],
    ["API_RATE_LIMIT", config.apiRateLimit],
    ["DB_CONNECTION_LIMIT", config.db.connectionLimit],
  ]) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  }
  return config;
}

module.exports = { loadConfig, sslOptions };
