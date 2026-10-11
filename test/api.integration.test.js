// End-to-end API tests against a real MySQL server.
// They run only when TEST_DB_USER is set, for example:
//   TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=3306 TEST_DB_USER=root TEST_DB_PASSWORD=secret npm test
// A throwaway database (TEST_DB_NAME, default "todo_integration_test") is DROPPED and recreated.

const test = require("node:test");
const assert = require("node:assert/strict");

const enabled = Boolean(process.env.TEST_DB_USER);
const DB_NAME = process.env.TEST_DB_NAME || "todo_integration_test";

test("API integration", { skip: enabled ? false : "set TEST_DB_USER to run against MySQL" }, async (t) => {
  const mysql = require("mysql2/promise");
  const { migrate } = require("../database/migrate");
  const { createPool } = require("../lib/database");
  const { createApp } = require("../lib/app");
  const MySQLSessionStore = require("../lib/mysql-session-store");

  if (!/^[a-zA-Z0-9_]+$/.test(DB_NAME) || !DB_NAME.includes("test")) throw new Error("TEST_DB_NAME must contain 'test'.");
  const dbSettings = {
    host: process.env.TEST_DB_HOST || "127.0.0.1",
    port: Number(process.env.TEST_DB_PORT || 3306),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD || "",
  };
  const admin = await mysql.createConnection(dbSettings);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB_NAME}\``);
  await admin.query(`CREATE DATABASE \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.changeUser({ database: DB_NAME });
  await migrate(admin);
  await admin.end();

  const pool = createPool({ ...dbSettings, database: DB_NAME, connectionLimit: 5 });
  const sessionStore = new MySQLSessionStore(pool);
  const config = {
    isProduction: false,
    trustProxy: false,
    sessionSecret: "integration-test-secret-that-is-long-enough",
    sessionMaxAgeHours: 1,
    authRateLimit: 100,
    apiRateLimit: 10_000,
    logRequests: false,
  };
  const server = createApp({ pool, sessionStore, config }).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    sessionStore.close();
    await pool.promise().end();
  });

  /** A tiny HTTP client that remembers its own session cookie, like one browser. */
  function client() {
    let cookie = "";
    return async (method, url, body, headers = {}) => {
      const response = await fetch(`${baseUrl}${url}`, {
        method,
        headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null };
    };
  }

  const alice = client();
  const bob = client();
  const today = "2026-10-08";
  const baseTask = { description: "", category: "Work", priority: "Medium", status: "Pending", dueDate: today, important: false };

  await t.test("health check and authentication guard", async () => {
    assert.equal((await alice("GET", "/api/health")).status, 200);
    assert.equal((await alice("GET", "/api")).body.status, "running", "/api root is a friendly status page");
    assert.equal((await alice("GET", "/api/tasks")).status, 401);
    assert.deepEqual((await alice("GET", "/api/auth/session")).body, { user: null });
  });

  await t.test("registration validates input and rejects duplicates", async () => {
    assert.equal((await alice("POST", "/api/auth/register", { name: "Alice", email: "alice@example.com", password: "password" })).status, 400);
    const created = await alice("POST", "/api/auth/register", { name: "Alice", email: "Alice@Example.com", password: "password123" });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.email, "alice@example.com");
    assert.equal((await bob("POST", "/api/auth/register", { name: "Bob", email: "alice@example.com", password: "password123" })).status, 409);
    assert.equal((await bob("POST", "/api/auth/register", { name: "Bob", email: "bob@example.com", password: "password123" })).status, 201);
  });

  const ids = {};
  await t.test("creates tasks with tags, Urgent priority and custom categories", async () => {
    const urgent = await alice("POST", "/api/tasks", { ...baseTask, title: "Submit report", priority: "Urgent", category: "Finance", tags: ["#School", "exam", "exam"], important: true });
    assert.equal(urgent.status, 201);
    assert.deepEqual(urgent.body.task.tags, ["exam", "school"]);
    assert.equal(urgent.body.task.category, "Finance");
    ids.urgent = urgent.body.task.id;
    const overdue = await alice("POST", "/api/tasks", { ...baseTask, title: "Pay 50% deposit", dueDate: "2026-10-01", priority: "Low" });
    ids.overdue = overdue.body.task.id;
    // Original API payload (no tags) still works.
    const done = await alice("POST", "/api/tasks", { ...baseTask, title: "Old style task", status: "Completed", dueDate: "2026-11-02" });
    assert.equal(done.status, 201);
    assert.ok(done.body.task.completedAt);
    assert.equal((await alice("POST", "/api/tasks", { ...baseTask, title: "x", priority: "Critical" })).status, 400);
    assert.equal((await alice("POST", "/api/tasks", { ...baseTask, title: "x", tags: ["bad tag!"] })).status, 400);
  });

  await t.test("searches, filters, sorts and paginates", async () => {
    const list = async (query) => (await alice("GET", `/api/tasks?today=${today}&${query}`)).body;
    assert.equal((await list("")).pagination.total, 3);
    assert.deepEqual((await list("search=50%25")).tasks.map((task) => task.title), ["Pay 50% deposit"]);
    assert.equal((await list("search=5_")).tasks.length, 0, "LIKE wildcards are escaped");
    assert.equal((await list("search=exam")).tasks[0].id, ids.urgent, "search matches tags");
    assert.equal((await list("priority=Urgent")).tasks.length, 1);
    assert.equal((await list("tag=school")).tasks.length, 1);
    assert.equal((await list("category=Finance")).tasks.length, 1);
    assert.equal((await list("status=active")).tasks.length, 2);
    assert.equal((await list("important=true")).tasks.length, 1);
    assert.deepEqual((await list("due=overdue")).tasks.map((task) => task.id), [ids.overdue]);
    assert.equal((await list("due=today")).tasks.length, 1);
    assert.equal((await list("sort=priority&order=desc")).tasks[0].priority, "Urgent");
    const firstPage = await list("limit=2&page=1&sort=title");
    const secondPage = await list("limit=2&page=2&sort=title");
    assert.equal(firstPage.pagination.totalPages, 2);
    assert.equal(firstPage.tasks.length + secondPage.tasks.length, 3);
    assert.equal((await alice("GET", "/api/tasks?sort=password")).status, 400);
    assert.equal((await alice("GET", "/api/tasks?limit=1000")).status, 400);
  });

  await t.test("partial updates set completion time and record history", async () => {
    const patched = await alice("PATCH", `/api/tasks/${ids.urgent}`, { status: "Completed" });
    assert.equal(patched.status, 200);
    assert.ok(patched.body.task.completedAt);
    assert.deepEqual(patched.body.task.tags, ["exam", "school"], "tags unchanged by PATCH without tags");
    const reopened = await alice("PUT", `/api/tasks/${ids.urgent}`, { ...baseTask, title: "Submit final report", priority: "High", category: "Finance", important: true });
    assert.equal(reopened.body.task.completedAt, null);
    assert.deepEqual(reopened.body.task.tags, ["exam", "school"], "PUT without tags keeps tags");
    const detail = (await alice("GET", `/api/tasks/${ids.urgent}`)).body.task;
    assert.deepEqual(detail.history.map((entry) => entry.action), ["updated", "updated", "created"]);
    assert.deepEqual(detail.history[0].details.changes.title, { from: "Submit report", to: "Submit final report" });
    assert.equal((await alice("PATCH", `/api/tasks/${ids.urgent}`, {})).status, 400);
    assert.equal((await alice("PATCH", "/api/tasks/abc", { status: "Completed" })).status, 400);
  });

  await t.test("manages subtasks", async () => {
    const first = await alice("POST", `/api/tasks/${ids.urgent}/subtasks`, { title: "Draft" });
    const second = await alice("POST", `/api/tasks/${ids.urgent}/subtasks`, { title: "Review" });
    assert.equal(first.status, 201);
    const toggled = await alice("PATCH", `/api/tasks/${ids.urgent}/subtasks/${first.body.subtask.id}`, { completed: true });
    assert.equal(toggled.body.subtask.completed, true);
    assert.equal((await alice("DELETE", `/api/tasks/${ids.urgent}/subtasks/${second.body.subtask.id}`)).status, 204);
    const detail = (await alice("GET", `/api/tasks/${ids.urgent}`)).body.task;
    assert.deepEqual(detail.subtasks, { total: 1, completed: 1 });
    assert.deepEqual(detail.subtaskItems.map((item) => item.title), ["Draft"]);
    assert.ok(detail.history.some((entry) => entry.action === "subtask_completed"));
  });

  await t.test("users cannot see or change each other's tasks", async () => {
    assert.equal((await bob("GET", "/api/tasks")).body.pagination.total, 0);
    assert.equal((await bob("GET", `/api/tasks/${ids.urgent}`)).status, 404);
    assert.equal((await bob("PATCH", `/api/tasks/${ids.urgent}`, { title: "Hacked" })).status, 404);
    assert.equal((await bob("DELETE", `/api/tasks/${ids.urgent}`)).status, 404);
    assert.equal((await bob("POST", `/api/tasks/${ids.urgent}/subtasks`, { title: "Hacked" })).status, 404);
    const [subtask] = (await alice("GET", `/api/tasks/${ids.urgent}`)).body.task.subtaskItems;
    assert.equal((await bob("PATCH", `/api/tasks/${ids.urgent}/subtasks/${subtask.id}`, { completed: false })).status, 404);
    assert.deepEqual((await bob("GET", "/api/tags")).body.tags, []);
  });

  await t.test("dashboard statistics", async () => {
    const { stats } = (await alice("GET", `/api/stats?today=${today}&from=2026-10-01&to=2026-10-31`)).body;
    assert.equal(stats.total, 3);
    assert.equal(stats.completed, 1);
    assert.equal(stats.pending, 2);
    assert.equal(stats.overdue, 1);
    assert.equal(stats.dueToday, 1);
    assert.equal(stats.byPriority.High, 1);
    assert.deepEqual(stats.byCategory.map((category) => category.name), ["Finance", "Work"]);
    assert.equal(stats.calendar.length, 2);
    assert.equal(stats.completedTrend.length, 7);
    assert.equal((await alice("GET", "/api/stats?from=2026-01-01&to=2026-12-31")).status, 400);
    // Completion times are grouped by the user's local day (UTC+14 here).
    const local = (await alice("GET", `/api/stats?tzOffset=840&today=${new Date(Date.now() + 840 * 60000).toISOString().slice(0, 10)}`)).body.stats;
    assert.equal(local.completedTrend.at(-1).count, 1, "completed today in the user's time zone");
    assert.equal((await alice("GET", "/api/stats?tzOffset=9999")).status, 400);
  });

  await t.test("tags are listed and cleaned up when unused", async () => {
    assert.deepEqual((await alice("GET", "/api/tags")).body.tags, [{ name: "exam", count: 1 }, { name: "school", count: 1 }]);
    await alice("PATCH", `/api/tasks/${ids.urgent}`, { tags: ["exam"] });
    assert.deepEqual((await alice("GET", "/api/tags")).body.tags, [{ name: "exam", count: 1 }]);
    assert.equal((await alice("DELETE", `/api/tasks/${ids.urgent}`)).status, 204);
    assert.deepEqual((await alice("GET", "/api/tags")).body.tags, []);
  });

  await t.test("rejects cross-site and non-JSON requests", async () => {
    assert.equal((await alice("POST", "/api/tasks", { ...baseTask, title: "csrf" }, { Origin: "https://evil.example" })).status, 403);
    const form = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "a=1" });
    assert.equal(form.status, 415);
    assert.equal((await alice("POST", "/api/tasks", { ...baseTask, title: "same origin" }, { Origin: baseUrl })).status, 201);
  });

  await t.test("profile, password change, logout and login", async () => {
    assert.equal((await alice("PATCH", "/api/auth/profile", { name: "Alice Smith" })).body.user.name, "Alice Smith");
    assert.equal((await alice("POST", "/api/auth/password", { currentPassword: "wrong-pass1", newPassword: "newpassword1" })).status, 400);
    assert.equal((await alice("POST", "/api/auth/password", { currentPassword: "password123", newPassword: "newpassword1" })).status, 204);
    assert.equal((await alice("POST", "/api/auth/logout")).status, 204);
    assert.equal((await alice("GET", "/api/tasks")).status, 401);
    assert.equal((await alice("POST", "/api/auth/login", { email: "alice@example.com", password: "password123" })).status, 401);
    const login = await alice("POST", "/api/auth/login", { email: "alice@example.com", password: "newpassword1" });
    assert.equal(login.status, 200);
    assert.equal(login.body.user.name, "Alice Smith");
  });

  await t.test("serves the frontend and JSON errors", async () => {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.equal((await fetch(`${baseUrl}/server.js`)).status, 404, "server files are not exposed");
    assert.equal((await fetch(`${baseUrl}/.env`)).status, 404);
    assert.equal((await alice("GET", "/api/nope")).status, 404);
    const badJson = await fetch(`${baseUrl}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{bad" });
    assert.equal(badJson.status, 400);
    assert.equal((await badJson.json()).error, "Request body must contain valid JSON.");
  });
});
