const test = require("node:test");
const assert = require("node:assert/strict");
const MySQLSessionStore = require("../lib/mysql-session-store");

class MemoryPool {
  constructor() {
    this.sessions = new Map();
  }

  execute(query, values, callback) {
    if (typeof values === "function") {
      callback = values;
      values = [];
    }
    if (query.startsWith("INSERT INTO sessions")) {
      this.sessions.set(values[0], { expires: values[1], data: values[2] });
      callback(null, { affectedRows: 1 });
    } else if (query.startsWith("SELECT data FROM sessions")) {
      const record = this.sessions.get(values[0]);
      callback(null, record && record.expires > values[1] ? [{ data: record.data }] : []);
    } else if (query.startsWith("UPDATE sessions")) {
      const record = this.sessions.get(values[1]);
      if (record) record.expires = values[0];
      callback(null, { affectedRows: record ? 1 : 0 });
    } else if (query.startsWith("DELETE FROM sessions WHERE session_id")) {
      callback(null, { affectedRows: Number(this.sessions.delete(values[0])) });
    } else if (query.startsWith("DELETE FROM sessions WHERE expires")) {
      let deleted = 0;
      for (const [sessionId, record] of this.sessions) {
        if (record.expires <= values[0]) {
          this.sessions.delete(sessionId);
          deleted += 1;
        }
      }
      callback(null, { affectedRows: deleted });
    } else if (query.startsWith("DELETE FROM sessions")) {
      this.sessions.clear();
      callback(null, { affectedRows: 1 });
    } else if (query.startsWith("SELECT COUNT(*)")) {
      callback(null, [{ count: this.sessions.size }]);
    } else {
      callback(new Error(`Unexpected query: ${query}`));
    }
  }
}

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, result) => error ? reject(error) : resolve(result));
  });
}

test("stores and reloads server-side sessions with their expiry", async () => {
  const pool = new MemoryPool();
  const store = new MySQLSessionStore(pool, { cleanupInterval: 60_000 });
  const data = { user: { id: 12, name: "Sarfaraz Malik" }, cookie: { expires: new Date(Date.now() + 60_000) } };
  await storeCall(store, "set", "session-1", data);
  assert.deepEqual(await storeCall(store, "get", "session-1"), {
    ...data,
    cookie: { expires: data.cookie.expires.toISOString() },
  });
  assert.equal(await storeCall(store, "length"), 1);
  store.close();
});

test("touches, expires, and destroys only the specified session", async () => {
  const pool = new MemoryPool();
  const store = new MySQLSessionStore(pool, { cleanupInterval: 60_000 });
  await storeCall(store, "set", "session-expired", { cookie: { expires: new Date(Date.now() - 1000) } });
  await storeCall(store, "set", "session-active", { cookie: { expires: new Date(Date.now() + 60_000) } });
  assert.equal(await storeCall(store, "get", "session-expired"), null);
  await storeCall(store, "touch", "session-expired", { cookie: { expires: new Date(Date.now() + 60_000) } });
  assert.ok(await storeCall(store, "get", "session-expired"));
  await storeCall(store, "destroy", "session-active");
  assert.equal(await storeCall(store, "length"), 1);
  await storeCall(store, "clear");
  assert.equal(await storeCall(store, "length"), 0);
  store.close();
});
