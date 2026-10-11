// Builds the SQL WHERE / ORDER BY / LIMIT parts for GET /api/tasks.
// Every user-supplied value is passed as a "?" parameter, never concatenated
// into the SQL string. Only fixed, whitelisted column names appear in the SQL.

const SORT_COLUMNS = {
  dueDate: "t.due_date",
  priority: "FIELD(t.priority, 'Low', 'Medium', 'High', 'Urgent')",
  createdAt: "t.created_at",
  updatedAt: "t.updated_at",
  title: "t.title",
  status: "FIELD(t.status, 'Pending', 'In Progress', 'Completed')",
};

/** Escapes LIKE wildcards so a search for "50%" matches the literal text. */
function escapeLike(text) {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/** Adds `days` to a YYYY-MM-DD date string and returns a new YYYY-MM-DD string. */
function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {number} userId the signed-in user; every query is scoped to this owner
 * @param {object} filters output of parseTaskListQuery()
 */
function buildTaskFilters(userId, filters) {
  const conditions = ["t.user_id = ?"];
  const params = [userId];

  if (filters.search) {
    const pattern = `%${escapeLike(filters.search)}%`;
    conditions.push(`(t.title LIKE ? OR t.description LIKE ? OR EXISTS (
      SELECT 1 FROM task_tags stt JOIN tags sg ON sg.tag_id = stt.tag_id
      WHERE stt.task_id = t.task_id AND sg.name LIKE ?))`);
    params.push(pattern, pattern, pattern);
  }
  if (filters.status === "active") {
    conditions.push("t.status <> 'Completed'");
  } else if (filters.status) {
    conditions.push("t.status = ?");
    params.push(filters.status);
  }
  if (filters.priority) {
    conditions.push("t.priority = ?");
    params.push(filters.priority);
  }
  if (filters.category) {
    conditions.push("t.category = ?");
    params.push(filters.category);
  }
  if (filters.tag) {
    conditions.push(`EXISTS (SELECT 1 FROM task_tags ftt JOIN tags fg ON fg.tag_id = ftt.tag_id
      WHERE ftt.task_id = t.task_id AND fg.name = ?)`);
    params.push(filters.tag);
  }
  if (filters.important) conditions.push("t.important = TRUE");
  if (filters.date) {
    conditions.push("t.due_date = ?");
    params.push(filters.date);
  }
  if (filters.due === "overdue") {
    conditions.push("t.status <> 'Completed' AND t.due_date < ?");
    params.push(filters.today);
  } else if (filters.due === "today") {
    conditions.push("t.due_date = ?");
    params.push(filters.today);
  } else if (filters.due === "week") {
    conditions.push("t.due_date BETWEEN ? AND ?");
    params.push(filters.today, addDays(filters.today, 6));
  } else if (filters.due === "upcoming") {
    conditions.push("t.due_date > ?");
    params.push(filters.today);
  }

  return { where: conditions.join(" AND "), params };
}

function buildOrderBy(sort, order) {
  const direction = order === "desc" ? "DESC" : "ASC";
  const column = SORT_COLUMNS[sort] || SORT_COLUMNS.dueDate;
  // task_id is a stable tie-breaker so pagination never repeats or skips rows.
  return `${column} ${direction}, t.task_id DESC`;
}

/** LIMIT/OFFSET values are validated integers, so they are safe to inline. */
function buildPagination(page, limit) {
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || page < 1 || limit < 1) {
    throw new TypeError("page and limit must be positive integers");
  }
  return `LIMIT ${limit} OFFSET ${(page - 1) * limit}`;
}

module.exports = { buildTaskFilters, buildOrderBy, buildPagination, escapeLike, addDays };
