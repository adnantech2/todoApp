const session = require("express-session");

class MySQLSessionStore extends session.Store {
  constructor(pool, options = {}) {
    super();
    this.pool = pool;
    this.ttl = options.ttl || 24 * 60 * 60 * 1000;
    this.cleanupTimer = setInterval(() => {
      this.pool.execute("DELETE FROM sessions WHERE expires <= ?", [Date.now()], (error) => {
        if (error) console.error("Expired session cleanup failed:", error.message);
      });
    }, options.cleanupInterval || 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.execute(
      "SELECT data FROM sessions WHERE session_id = ? AND expires > ? LIMIT 1",
      [sessionId, Date.now()],
      (error, rows) => {
        if (error) return callback(error);
        if (!rows.length) return callback(null, null);
        try {
          callback(null, JSON.parse(rows[0].data));
        } catch (parseError) {
          callback(parseError);
        }
      },
    );
  }

  set(sessionId, sessionData, callback = () => {}) {
    const requestedExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const expires = Number.isFinite(requestedExpiry) ? requestedExpiry : Date.now() + this.ttl;
    this.pool.execute(
      `INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sessionId, expires, JSON.stringify(sessionData)],
      callback,
    );
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const requestedExpiry = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.ttl;
    const expires = Number.isFinite(requestedExpiry) ? requestedExpiry : Date.now() + this.ttl;
    this.pool.execute(
      "UPDATE sessions SET expires = ? WHERE session_id = ?",
      [expires, sessionId],
      callback,
    );
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.execute("DELETE FROM sessions WHERE session_id = ?", [sessionId], callback);
  }

  clear(callback = () => {}) {
    this.pool.execute("DELETE FROM sessions", callback);
  }

  length(callback) {
    this.pool.execute("SELECT COUNT(*) AS count FROM sessions", (error, rows) => {
      if (error) return callback(error);
      callback(null, rows[0].count);
    });
  }

  close() {
    clearInterval(this.cleanupTimer);
  }
}

module.exports = MySQLSessionStore;
