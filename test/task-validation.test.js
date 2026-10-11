const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateTask,
  validateTaskPatch,
  validateSubtask,
  normalizeTask,
  parseTaskListQuery,
} = require("../lib/task-validation");

const validTask = {
  title: "Finish the project",
  description: "Review the database design.",
  category: "Study",
  priority: "High",
  status: "In Progress",
  dueDate: "2026-10-03",
  important: true,
};

test("accepts a complete task with every supported status and priority", () => {
  for (const status of ["Pending", "In Progress", "Completed"]) {
    assert.equal(validateTask({ ...validTask, status }), null);
  }
  for (const priority of ["Low", "Medium", "High", "Urgent"]) {
    assert.equal(validateTask({ ...validTask, priority }), null);
  }
});

test("rejects a missing task and malformed task fields", () => {
  assert.match(validateTask(null), /task object/i);
  assert.match(validateTask({ ...validTask, title: " " }), /title/i);
  assert.match(validateTask({ ...validTask, title: "a".repeat(151) }), /title/i);
  assert.match(validateTask({ ...validTask, description: "a".repeat(5001) }), /description/i);
  assert.match(validateTask({ ...validTask, category: "" }), /category/i);
  assert.match(validateTask({ ...validTask, category: "<script>" }), /category/i);
  assert.match(validateTask({ ...validTask, category: "a".repeat(41) }), /category/i);
  assert.match(validateTask({ ...validTask, priority: "Critical" }), /priority/i);
  assert.match(validateTask({ ...validTask, status: "Blocked" }), /status/i);
  assert.match(validateTask({ ...validTask, important: "yes" }), /importance/i);
});

test("accepts custom categories", () => {
  assert.equal(validateTask({ ...validTask, category: "Side Projects" }), null);
  assert.equal(validateTask({ ...validTask, category: "Ghar ka kaam" }), null);
});

test("rejects impossible calendar dates without throwing", () => {
  assert.match(validateTask({ ...validTask, dueDate: "2026-02-30" }), /due date/i);
  assert.match(validateTask({ ...validTask, dueDate: "not-a-date" }), /due date/i);
  assert.equal(validateTask({ ...validTask, dueDate: "2024-02-29" }), null);
});

test("validates and normalizes tags", () => {
  assert.equal(validateTask({ ...validTask, tags: ["exam", "#Urgent-fix", "lab_2"] }), null);
  assert.match(validateTask({ ...validTask, tags: "exam" }), /tags/i);
  assert.match(validateTask({ ...validTask, tags: ["two words"] }), /tags/i);
  assert.match(validateTask({ ...validTask, tags: ["a,b"] }), /tags/i);
  assert.match(validateTask({ ...validTask, tags: Array.from({ length: 11 }, (_, index) => `t${index}`) }), /at most/i);
  assert.deepEqual(normalizeTask({ ...validTask, tags: ["#Exam", "exam ", "Lab"] }).tags, ["exam", "lab"]);
});

test("normalizes text fields", () => {
  const task = normalizeTask({ ...validTask, title: "  Read  ", description: " notes ", category: " Side   Projects " });
  assert.equal(task.title, "Read");
  assert.equal(task.description, "notes");
  assert.equal(task.category, "Side Projects");
});

test("validates partial updates", () => {
  assert.equal(validateTaskPatch({ status: "Completed" }), null);
  assert.equal(validateTaskPatch({ important: false, priority: "Urgent" }), null);
  assert.match(validateTaskPatch({}), /at least one/i);
  assert.match(validateTaskPatch({ unknown: 1 }), /at least one/i);
  assert.match(validateTaskPatch({ status: "Done" }), /status/i);
  assert.match(validateTaskPatch([]), /task object/i);
});

test("validates subtasks", () => {
  assert.equal(validateSubtask({ title: "Step one" }), null);
  assert.match(validateSubtask({ title: "" }), /title/i);
  assert.equal(validateSubtask({ completed: true }, { partial: true }), null);
  assert.match(validateSubtask({ completed: "yes" }, { partial: true }), /completion/i);
  assert.match(validateSubtask({}, { partial: true }), /provide/i);
});

test("parses task list query parameters with safe defaults", () => {
  const { value } = parseTaskListQuery({}, "2026-10-08");
  assert.equal(value.page, 1);
  assert.equal(value.limit, 20);
  assert.equal(value.sort, "dueDate");
  assert.equal(value.order, "asc");
  assert.equal(value.today, "2026-10-08");

  const custom = parseTaskListQuery({ search: " report ", tag: "#Exam", status: "active", sort: "priority", order: "DESC", page: "2", limit: "50", important: "true" }, "2026-10-08").value;
  assert.equal(custom.search, "report");
  assert.equal(custom.tag, "exam");
  assert.equal(custom.order, "desc");
  assert.equal(custom.page, 2);
  assert.equal(custom.important, true);

  for (const query of [{ sort: "password" }, { order: "sideways" }, { page: "0" }, { page: "1.5" }, { limit: "101" },
    { status: "Done" }, { priority: "Critical" }, { due: "later" }, { date: "2026-13-01" }, { today: "yesterday" },
    { search: "a".repeat(101) }]) {
    assert.ok(parseTaskListQuery(query, "2026-10-08").error, JSON.stringify(query));
  }
});
