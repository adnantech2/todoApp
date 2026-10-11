const session = require("express-session");

// Note: file name kept as mysql-session-store.js to avoid churning imports
// elsewhere; this now stores sessions in PostgreSQL instead of MySQL.
class PostgresSessionStore extends session.Store {
  constructor(pool, options = {}) {
    super();
    this.pool = pool;
    this.ttl = options.ttl || 24 * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.pool.query("DELETE FROM sessions WHERE expires <= $1", [Date.now()]).catch((error) => {
        console.error("Expired session cleanup failed:", error.message);
      });
    }, options.cleanupInterval || 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.query(
      "SELECT data FROM sessions WHERE session_id = $1 AND expires > $2 LIMIT 1",
      [sessionId, Date.now()],
    ).then(({ rows }) => {
      if (!rows.length) return callback(null, null);
      try {
        callback(null, JSON.parse(rows[0].data));
      } catch (parseError) {
        callback(parseError);
      }
    }).catch((error) => callback(error));
  }

  set(sessionId, sessionData, callback = () => {}) {
    const requestedExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const expires = Number.isFinite(requestedExpiry) ? requestedExpiry : Date.now() + this.ttl;
    this.pool.query(
      `INSERT INTO sessions (session_id, expires, data) VALUES ($1, $2, $3)
       ON CONFLICT (session_id) DO UPDATE SET expires = EXCLUDED.expires, data = EXCLUDED.data`,
      [sessionId, expires, JSON.stringify(sessionData)],
    ).then(() => callback()).catch((error) => callback(error));
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const requestedExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const expires = Number.isFinite(requestedExpiry) ? requestedExpiry : Date.now() + this.ttl;
    this.pool.query(
      "UPDATE sessions SET expires = $1 WHERE session_id = $2",
      [expires, sessionId],
    ).then(() => callback()).catch((error) => callback(error));
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.query("DELETE FROM sessions WHERE session_id = $1", [sessionId])
      .then(() => callback()).catch((error) => callback(error));
  }

  clear(callback = () => {}) {
    this.pool.query("DELETE FROM sessions").then(() => callback()).catch((error) => callback(error));
  }

  length(callback) {
    this.pool.query("SELECT COUNT(*) AS count FROM sessions")
      .then(({ rows }) => callback(null, Number(rows[0].count)))
      .catch((error) => callback(error));
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = PostgresSessionStore;
