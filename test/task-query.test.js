const test = require("node:test");
const assert = require("node:assert/strict");
const { buildTaskFilters, buildOrderBy, buildPagination, escapeLike, addDays } = require("../lib/task-query");
const { parseTaskListQuery } = require("../lib/task-validation");

const filtersFor = (query) => parseTaskListQuery(query, "2026-10-08").value;

test("always scopes queries to the signed-in user", () => {
  const { where, params } = buildTaskFilters(7, filtersFor({}));
  assert.equal(where, "t.user_id = ?");
  assert.deepEqual(params, [7]);
});

test("passes user input only as parameters", () => {
  const evil = "'; DROP TABLE tasks; --";
  const { where, params } = buildTaskFilters(1, filtersFor({ search: evil, category: evil }));
  assert.ok(!where.includes("DROP"));
  assert.ok(params.includes(`%${evil}%`));
  assert.ok(params.includes(evil));
});

test("escapes LIKE wildcards in search text", () => {
  assert.equal(escapeLike("50%_off\\"), "50\\%\\_off\\\\");
});

test("builds due-date filters relative to the user's today", () => {
  assert.deepEqual(buildTaskFilters(1, filtersFor({ due: "overdue" })).params, [1, "2026-10-08"]);
  assert.deepEqual(buildTaskFilters(1, filtersFor({ due: "week" })).params, [1, "2026-10-08", "2026-10-14"]);
  assert.match(buildTaskFilters(1, filtersFor({ due: "overdue" })).where, /status <> 'Completed'/);
});

test("orders by whitelisted columns with a stable tie-breaker", () => {
  assert.equal(buildOrderBy("dueDate", "asc"), "t.due_date ASC, t.task_id DESC");
  assert.match(buildOrderBy("priority", "desc"), /^FIELD\(t\.priority.*DESC, t\.task_id DESC$/);
  assert.equal(buildOrderBy("not-a-column", "asc"), "t.due_date ASC, t.task_id DESC");
});

test("builds LIMIT/OFFSET and rejects non-integers", () => {
  assert.equal(buildPagination(3, 20), "LIMIT 20 OFFSET 40");
  assert.throws(() => buildPagination("1; DROP", 20), TypeError);
  assert.throws(() => buildPagination(0, 20), TypeError);
});

test("adds days across month and year boundaries", () => {
  assert.equal(addDays("2026-12-29", 6), "2027-01-04");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
