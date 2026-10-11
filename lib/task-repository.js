// All task-related SQL lives here so the route handlers stay small.
// `db` is a PostgreSQL pool wrapped with a mysql2-shaped execute() helper
// (see lib/database.js). Every query includes the owner's user_id, so one
// user can never read or change another user's tasks.

const { buildTaskFilters, buildOrderBy, buildPagination, addDays } = require("./task-query");
const { LIMITS } = require("./task-validation");

const UTC_NOW = "(now() AT TIME ZONE 'utc')";

const TASK_COLUMNS = `t.task_id, t.title, t.description, t.category, t.priority, t.status, t.due_date,
  t.important, t.completed_at, t.created_at, t.updated_at,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id) AS subtask_total,
  (SELECT COUNT(*) FROM subtasks s WHERE s.task_id = t.task_id AND s.completed = TRUE) AS subtask_done,
  (SELECT STRING_AGG(g.name, ',' ORDER BY g.name)
     FROM task_tags tt JOIN tags g ON g.tag_id = tt.tag_id WHERE tt.task_id = t.task_id) AS tag_names`;

// Fields compared when recording what changed in the task history.
const TRACKED_FIELDS = ["title", "description", "category", "priority", "status", "dueDate", "important", "tags"];

/** Postgres returns DATETIME columns as JS Date objects or ISO-ish strings; normalize to ISO 8601 UTC. */
function toIso(value) {
  if (!value) return null;
  const iso = value instanceof Date ? value.toISOString() : String(value).replace(" ", "T");
  return iso.endsWith("Z") ? iso : `${iso}Z`;
}

function taskFromRow(row) {
  return {
    id: String(row.task_id),
    title: row.title,
    description: row.description,
    category: row.category,
    priority: row.priority,
    status: row.status,
    dueDate: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : row.due_date,
    important: Boolean(row.important),
    tags: row.tag_names ? row.tag_names.split(",") : [],
    subtasks: { total: Number(row.subtask_total || 0), completed: Number(row.subtask_done || 0) },
    completedAt: toIso(row.completed_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function subtaskFromRow(row) {
  return { id: String(row.subtask_id), title: row.title, completed: Boolean(row.completed), position: row.position };
}

function historyFromRow(row) {
  let details = null;
  try {
    details = row.details ? JSON.parse(row.details) : null;
  } catch {
    details = null;
  }
  return { id: String(row.history_id), action: row.action, details, createdAt: toIso(row.created_at) };
}

async function withTransaction(db, work) {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function shorten(value) {
  if (typeof value !== "string") return value;
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

/** Returns { field: { from, to } } for every tracked field whose value changed. */
function diffTasks(before, after) {
  const changes = {};
  for (const field of TRACKED_FIELDS) {
    if (after[field] === undefined) continue;
    const from = field === "tags" ? before.tags.join(", ") : before[field];
    const to = field === "tags" ? after.tags.join(", ") : after[field];
    if (from !== to) changes[field] = { from: shorten(from), to: shorten(to) };
  }
  return changes;
}

async function recordHistory(connection, taskId, userId, action, details = null) {
  await connection.execute(
    "INSERT INTO task_history (task_id, user_id, action, details) VALUES (?, ?, ?, ?)",
    [taskId, userId, action, details ? JSON.stringify(details) : null],
  );
}

/** Replaces the tags of a task, creating any new tag names for this user. */
async function setTaskTags(connection, userId, taskId, tags) {
  await connection.execute("DELETE FROM task_tags WHERE task_id = ?", [taskId]);
  for (const name of tags) {
    const [, result] = await connection.execute(
      `INSERT INTO tags (user_id, name) VALUES (?, ?)
       ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING tag_id AS id`,
      [userId, name],
    );
    await connection.execute(
      "INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
      [taskId, result.insertId],
    );
  }
  await deleteUnusedTags(connection, userId);
}

async function deleteUnusedTags(connection, userId) {
  await connection.execute(
    `DELETE FROM tags g WHERE g.user_id = ? AND NOT EXISTS (
       SELECT 1 FROM task_tags tt WHERE tt.tag_id = g.tag_id)`,
    [userId],
  );
}

async function findTask(db, userId, taskId, { forUpdate = false } = {}) {
  const [rows] = await db.execute(
    `SELECT ${TASK_COLUMNS} FROM tasks t WHERE t.task_id = ? AND t.user_id = ? LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [taskId, userId],
  );
  return rows[0] ? taskFromRow(rows[0]) : null;
}

async function listTasks(db, userId, filters) {
  const { where, params } = buildTaskFilters(userId, filters);
  const [[{ total }]] = await db.execute(`SELECT COUNT(*) AS total FROM tasks t WHERE ${where}`, params);
  const [rows] = await db.execute(
    `SELECT ${TASK_COLUMNS} FROM tasks t WHERE ${where}
     ORDER BY ${buildOrderBy(filters.sort, filters.order)} ${buildPagination(filters.page, filters.limit)}`,
    params,
  );
  const totalCount = Number(total);
  return {
    tasks: rows.map(taskFromRow),
    pagination: {
      page: filters.page,
      limit: filters.limit,
      total: totalCount,
      totalPages: Math.max(1, Math.ceil(totalCount / filters.limit)),
    },
  };
}

/** A task together with its subtasks and its most recent history entries. */
async function getTaskDetail(db, userId, taskId) {
  const task = await findTask(db, userId, taskId);
  if (!task) return null;
  const [subtaskRows] = await db.execute(
    "SELECT subtask_id, title, completed, position FROM subtasks WHERE task_id = ? ORDER BY position, subtask_id",
    [taskId],
  );
  const [historyRows] = await db.execute(
    `SELECT history_id, action, details, created_at FROM task_history
     WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC, history_id DESC LIMIT 50`,
    [taskId, userId],
  );
  return { ...task, subtaskItems: subtaskRows.map(subtaskFromRow), history: historyRows.map(historyFromRow) };
}

async function createTask(db, userId, data) {
  return withTransaction(db, async (connection) => {
    const [, result] = await connection.execute(
      `INSERT INTO tasks (user_id, title, description, category, priority, status, due_date, important, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${data.status === "Completed" ? UTC_NOW : "NULL"})
       RETURNING task_id AS id`,
      [userId, data.title, data.description, data.category, data.priority, data.status, data.dueDate, data.important],
    );
    const taskId = result.insertId;
    if (data.tags?.length) await setTaskTags(connection, userId, taskId, data.tags);
    await recordHistory(connection, taskId, userId, "created", { title: data.title, status: data.status });
    return findTask(connection, userId, taskId);
  });
}

/**
 * Applies `changes` (any subset of task fields) to an owned task.
 * Returns the updated task, or null when the task does not exist for this user.
 */
async function updateTask(db, userId, taskId, changes) {
  return withTransaction(db, async (connection) => {
    const before = await findTask(connection, userId, taskId, { forUpdate: true });
    if (!before) return null;
    const after = { ...before, ...changes };
    const diff = diffTasks(before, changes);
    if (!Object.keys(diff).length) return before;

    let completedAt = "completed_at";
    if (before.status !== "Completed" && after.status === "Completed") completedAt = UTC_NOW;
    if (after.status !== "Completed") completedAt = "NULL";
    await connection.execute(
      `UPDATE tasks SET title = ?, description = ?, category = ?, priority = ?, status = ?, due_date = ?,
         important = ?, completed_at = ${completedAt}, updated_at = ${UTC_NOW}
       WHERE task_id = ? AND user_id = ?`,
      [after.title, after.description, after.category, after.priority, after.status, after.dueDate,
        after.important, taskId, userId],
    );
    if (diff.tags) await setTaskTags(connection, userId, taskId, changes.tags);
    await recordHistory(connection, taskId, userId, "updated", { changes: diff });
    return findTask(connection, userId, taskId);
  });
}

async function deleteTask(db, userId, taskId) {
  return withTransaction(db, async (connection) => {
    const [, result] = await connection.execute("DELETE FROM tasks WHERE task_id = ? AND user_id = ?", [taskId, userId]);
    if (result.affectedRows) await deleteUnusedTags(connection, userId);
    return result.affectedRows > 0;
  });
}

async function addSubtask(db, userId, taskId, title) {
  return withTransaction(db, async (connection) => {
    const task = await findTask(connection, userId, taskId, { forUpdate: true });
    if (!task) return { notFound: true };
    if (task.subtasks.total >= LIMITS.subtasksPerTask) return { limitReached: true };
    const [[{ nextposition }]] = await connection.execute(
      "SELECT COALESCE(MAX(position), 0) + 1 AS nextposition FROM subtasks WHERE task_id = ?",
      [taskId],
    );
    const [, result] = await connection.execute(
      "INSERT INTO subtasks (task_id, title, position) VALUES (?, ?, ?) RETURNING subtask_id AS id",
      [taskId, title, nextposition],
    );
    await recordHistory(connection, taskId, userId, "subtask_added", { title });
    await connection.execute(`UPDATE tasks SET updated_at = ${UTC_NOW} WHERE task_id = ?`, [taskId]);
    return { subtask: { id: String(result.insertId), title, completed: false, position: Number(nextposition) } };
  });
}

/** Loads a subtask only if its parent task belongs to the user. */
async function findOwnedSubtask(connection, userId, taskId, subtaskId) {
  const [rows] = await connection.execute(
    `SELECT s.subtask_id, s.title, s.completed, s.position FROM subtasks s
     JOIN tasks t ON t.task_id = s.task_id
     WHERE s.subtask_id = ? AND s.task_id = ? AND t.user_id = ? LIMIT 1 FOR UPDATE`,
    [subtaskId, taskId, userId],
  );
  return rows[0] ? subtaskFromRow(rows[0]) : null;
}

async function updateSubtask(db, userId, taskId, subtaskId, changes) {
  return withTransaction(db, async (connection) => {
    const before = await findOwnedSubtask(connection, userId, taskId, subtaskId);
    if (!before) return null;
    const after = { ...before, ...changes };
    await connection.execute(
      "UPDATE subtasks SET title = ?, completed = ? WHERE subtask_id = ?",
      [after.title, after.completed, subtaskId],
    );
    if (before.completed !== after.completed) {
      await recordHistory(connection, taskId, userId, after.completed ? "subtask_completed" : "subtask_reopened", { title: after.title });
    }
    if (before.title !== after.title) {
      await recordHistory(connection, taskId, userId, "subtask_renamed", { from: before.title, to: after.title });
    }
    await connection.execute(`UPDATE tasks SET updated_at = ${UTC_NOW} WHERE task_id = ?`, [taskId]);
    return after;
  });
}

async function deleteSubtask(db, userId, taskId, subtaskId) {
  return withTransaction(db, async (connection) => {
    const subtask = await findOwnedSubtask(connection, userId, taskId, subtaskId);
    if (!subtask) return false;
    await connection.execute("DELETE FROM subtasks WHERE subtask_id = ?", [subtaskId]);
    await recordHistory(connection, taskId, userId, "subtask_deleted", { title: subtask.title });
    await connection.execute(`UPDATE tasks SET updated_at = ${UTC_NOW} WHERE task_id = ?`, [taskId]);
    return true;
  });
}

async function listTags(db, userId) {
  const [rows] = await db.execute(
    `SELECT g.name, COUNT(tt.task_id) AS count FROM tags g
     LEFT JOIN task_tags tt ON tt.tag_id = g.tag_id
     WHERE g.user_id = ? GROUP BY g.tag_id, g.name ORDER BY g.name`,
    [userId],
  );
  return rows.map((row) => ({ name: row.name, count: Number(row.count) }));
}

/**
 * Dashboard numbers for one user.
 * @param {string} today the user's local date (YYYY-MM-DD)
 * @param {{from: string, to: string}} range dates to include in the calendar summary
 * @param {number} tzOffsetMinutes the user's offset from UTC in minutes (e.g. 330 for UTC+5:30),
 *   so completion times (stored in UTC) are grouped by the user's local day
 */
async function getStats(db, userId, today, range, tzOffsetMinutes = 0) {
  const weekEnd = addDays(today, 6);
  const weekStart = addDays(today, -6);
  const [[totals]] = await db.execute(
    `SELECT COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status = 'Completed') AS completed,
       COUNT(*) FILTER (WHERE status = 'Pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'In Progress') AS "inProgress",
       COUNT(*) FILTER (WHERE important = TRUE) AS important,
       COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date < ?) AS overdue,
       COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date = ?) AS "dueToday",
       COUNT(*) FILTER (WHERE due_date = ?) AS today,
       COUNT(*) FILTER (WHERE status <> 'Completed' AND due_date BETWEEN ? AND ?) AS "dueThisWeek",
       COUNT(*) FILTER (WHERE (completed_at + (? * interval '1 minute'))::date >= ?) AS "completedThisWeek"
     FROM tasks WHERE user_id = ?`,
    [today, today, today, today, weekEnd, tzOffsetMinutes, weekStart, userId],
  );
  const [priorityRows] = await db.execute(
    "SELECT priority, COUNT(*) AS count FROM tasks WHERE user_id = ? AND status <> 'Completed' GROUP BY priority",
    [userId],
  );
  const [categoryRows] = await db.execute(
    `SELECT category, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'Completed') AS completed
     FROM tasks WHERE user_id = ? GROUP BY category ORDER BY category`,
    [userId],
  );
  const [calendarRows] = await db.execute(
    `SELECT due_date, COUNT(*) AS total, COUNT(*) FILTER (WHERE status <> 'Completed') AS open
     FROM tasks WHERE user_id = ? AND due_date BETWEEN ? AND ? GROUP BY due_date`,
    [userId, range.from, range.to],
  );
  const [trendRows] = await db.execute(
    `SELECT (completed_at + (? * interval '1 minute'))::date AS day, COUNT(*) AS count FROM tasks
     WHERE user_id = ? AND completed_at >= ? GROUP BY day`,
    [tzOffsetMinutes, userId, addDays(weekStart, -1)],
  );

  const numbers = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
  const asDate = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
  const trendByDay = Object.fromEntries(trendRows.map((row) => [asDate(row.day), Number(row.count)]));
  return {
    ...numbers,
    completionRate: numbers.total ? Math.round((numbers.completed / numbers.total) * 100) : 0,
    byPriority: Object.fromEntries(["Low", "Medium", "High", "Urgent"].map((priority) => [
      priority, Number(priorityRows.find((row) => row.priority === priority)?.count || 0),
    ])),
    byCategory: categoryRows.map((row) => ({ name: row.category, total: Number(row.total), completed: Number(row.completed) })),
    calendar: calendarRows.map((row) => ({ date: asDate(row.due_date), total: Number(row.total), open: Number(row.open) })),
    completedTrend: Array.from({ length: 7 }, (_, index) => {
      const day = addDays(weekStart, index);
      return { date: day, count: trendByDay[day] || 0 };
    }),
  };
}

module.exports = {
  taskFromRow,
  diffTasks,
  listTasks,
  findTask,
  getTaskDetail,
  createTask,
  updateTask,
  deleteTask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
  listTags,
  getStats,
};
