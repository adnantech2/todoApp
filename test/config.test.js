const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../lib/config");
const { validateNewPassword } = require("../routes/auth");
const { diffTasks } = require("../lib/task-repository");
const { splitStatements } = require("../database/migrate");

const validEnv = {
  SESSION_SECRET: "a-very-long-random-session-secret-value-123",
  DB_USER: "todo_user",
  DB_NAME: "todo_list_management",
};

test("loads a valid configuration with sensible defaults", () => {
  const config = loadConfig(validEnv);
  assert.equal(config.port, 3000);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.isProduction, false);
  assert.equal(config.db.connectionLimit, 10);
});

test("refuses unsafe or missing settings", () => {
  assert.throws(() => loadConfig({ ...validEnv, SESSION_SECRET: "short" }), /SESSION_SECRET/);
  assert.throws(() => loadConfig({ ...validEnv, SESSION_SECRET: "replace-with-a-random-secret-at-least-32-characters-long" }), /example/);
  assert.throws(() => loadConfig({ ...validEnv, DB_NAME: "todo; DROP" }), /DB_NAME/);
  assert.throws(() => loadConfig({ ...validEnv, DB_USER: "" }), /DB_USER/);
  assert.throws(() => loadConfig({ ...validEnv, PORT: "99999" }), /PORT/);
  assert.throws(() => loadConfig({ ...validEnv, API_RATE_LIMIT: "-1" }), /API_RATE_LIMIT/);
});

test("enables verified MySQL TLS only when DB_SSL=1", () => {
  assert.equal(loadConfig(validEnv).db.ssl, undefined);
  assert.deepEqual(loadConfig({ ...validEnv, DB_SSL: "1" }).db.ssl, { rejectUnauthorized: true });
  assert.deepEqual(loadConfig({ ...validEnv, DB_SSL: "1", DB_SSL_CA: "-----BEGIN\\nabc" }).db.ssl, { rejectUnauthorized: true, ca: "-----BEGIN\nabc" });
});

test("requires reasonably strong new passwords", () => {
  assert.equal(validateNewPassword("password123"), null);
  assert.match(validateNewPassword("short1"), /8 characters/);
  assert.match(validateNewPassword("passwordonly"), /letter and one number/);
  assert.match(validateNewPassword("1234567890"), /letter and one number/);
  assert.match(validateNewPassword("a1".repeat(40)), /72/);
});

test("records only changed fields in task history", () => {
  const before = { title: "A", description: "", category: "Work", priority: "Low", status: "Pending", dueDate: "2026-10-08", important: false, tags: ["x"] };
  assert.deepEqual(diffTasks(before, { title: "A", status: "Completed" }), { status: { from: "Pending", to: "Completed" } });
  assert.deepEqual(diffTasks(before, { tags: ["x", "y"] }), { tags: { from: "x", to: "x, y" } });
  assert.deepEqual(diffTasks(before, { tags: ["x"] }), {});
});

test("splits SQL files into statements and ignores comments", () => {
  assert.deepEqual(splitStatements("-- comment; here\nSELECT 1;\n\nSELECT 2;"), ["SELECT 1", "SELECT 2"]);
});
