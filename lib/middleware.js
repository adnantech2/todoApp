// Small Express middleware shared by the API routes.

function requireUser(request, response, next) {
  if (!request.session.user) return response.status(401).json({ error: "Please sign in to continue." });
  next();
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence in depth (the session cookie is already SameSite=Lax):
 * - browsers always send an Origin header on cross-site POST/PUT/PATCH/DELETE,
 *   so a request whose Origin does not match this server is rejected;
 * - request bodies must be JSON, which plain HTML forms cannot send.
 */
function protectAgainstCsrf(request, response, next) {
  if (!UNSAFE_METHODS.has(request.method)) return next();
  const origin = request.get("origin");
  if (origin) {
    let originHost = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    if (originHost !== request.get("host")) {
      return response.status(403).json({ error: "Cross-site requests are not allowed." });
    }
  }
  const hasBody = Number(request.get("content-length") || 0) > 0 || request.get("transfer-encoding");
  if (hasBody && !request.is("application/json")) {
    return response.status(415).json({ error: "Requests must be sent as JSON." });
  }
  next();
}

/** Logs one line per API request: method, path, status and duration. */
function requestLogger(request, response, next) {
  const startedAt = process.hrtime.bigint();
  response.on("finish", () => {
    const milliseconds = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(`${new Date().toISOString()} ${request.method} ${request.originalUrl.split("?")[0]} ${response.statusCode} ${milliseconds.toFixed(1)}ms`);
  });
  next();
}

module.exports = { requireUser, protectAgainstCsrf, requestLogger };
