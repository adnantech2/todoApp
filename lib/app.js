const path = require("node:path");
const express = require("express");
const session = require("express-session");
const compression = require("compression");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const { protectAgainstCsrf, requestLogger } = require("./middleware");
const { createAuthRouter } = require("../routes/auth");
const { createTaskRouter } = require("../routes/tasks");

const PUBLIC_DIR = path.join(__dirname, "..", "public");

/**
 * Builds the Express application. Dependencies are passed in so tests can
 * create an app against a test database without starting the real server.
 *
 * @param {object} options
 * @param {import("mysql2").Pool} options.pool MySQL pool (callback API)
 * @param {import("express-session").Store} options.sessionStore
 * @param {ReturnType<import("./config").loadConfig>} options.config
 */
function createApp({ pool, sessionStore, config }) {
  const db = pool.promise();
  const app = express();

  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
  }));
  app.use(compression());

  // ---- API ---------------------------------------------------------------
  if (config.logRequests) app.use("/api", requestLogger);
  app.use("/api", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", rateLimit({
    windowMs: 60 * 1000,
    limit: config.apiRateLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down and try again in a minute." },
  }));
  app.use("/api", protectAgainstCsrf);
  app.use(express.json({ limit: "20kb" }));
  app.use(session({
    name: "todo.sid",
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: config.isProduction,
      maxAge: config.sessionMaxAgeHours * 60 * 60 * 1000,
    },
  }));

  app.get("/api/health", async (_request, response) => {
    try {
      await db.query("SELECT 1");
      response.json({ status: "ok", database: "ok" });
    } catch {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  });
  app.get("/api", (_request, response) => {
    response.json({ name: "TodoApp API", status: "running", health: "/api/health", docs: "See README.md for the endpoint list." });
  });
  app.use("/api/auth", createAuthRouter({ db, config }));
  app.use("/api", createTaskRouter({ db }));
  app.use("/api", (_request, response) => response.status(404).json({ error: "API route not found." }));

  // ---- Frontend (static files from /public) ------------------------------
  app.use(express.static(PUBLIC_DIR, {
    index: "index.html",
    maxAge: config.isProduction ? "1h" : 0,
    setHeaders: (response, filePath) => {
      if (filePath.endsWith(".html")) response.set("Cache-Control", "no-cache");
    },
  }));
  app.use((_request, response) => response.status(404).type("text").send("Page not found."));

  // ---- Errors ------------------------------------------------------------
  app.use((error, _request, response, _next) => {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500;
    if (status >= 500) console.error("Request failed:", error);
    if (response.headersSent) return;
    let message = "The request could not be completed. Please try again later.";
    if (error.expose && error.message && status < 500) message = error.message;
    if (error.type === "entity.parse.failed") message = "Request body must contain valid JSON.";
    if (error.type === "entity.too.large") message = "Request body is too large.";
    response.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
