// Input validation for tasks, subtasks and task-list query parameters.
// Each validator returns an error message string, or null when the input is valid.

const DEFAULT_CATEGORIES = ["Work", "Study", "Personal", "Others"];
const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
const STATUSES = ["Pending", "In Progress", "Completed"];
const SORT_FIELDS = ["dueDate", "priority", "createdAt", "updatedAt", "title", "status"];
const DUE_FILTERS = ["overdue", "today", "week", "upcoming"];

const LIMITS = {
  title: 150,
  description: 5000,
  category: 40,
  tag: 30,
  tagsPerTask: 10,
  subtaskTitle: 150,
  subtasksPerTask: 50,
  search: 100,
  pageSize: 100,
};

const priorities = new Set(PRIORITIES);
const statuses = new Set(STATUSES);
// Letters (any language), numbers, spaces and a few separators.
const CATEGORY_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} &/+._-]*$/u;
const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u;

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === value;
}

/** Lower-cases, trims and removes duplicate tags. Assumes validateTags passed. */
function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => tag.trim().replace(/^#/, "").toLowerCase()))];
}

function validateTags(tags) {
  if (!Array.isArray(tags)) return "Tags must be a list of words.";
  if (tags.length > LIMITS.tagsPerTask) return `A task can have at most ${LIMITS.tagsPerTask} tags.`;
  for (const tag of tags) {
    if (typeof tag !== "string") return "Each tag must be text.";
    const cleaned = tag.trim().replace(/^#/, "");
    if (!cleaned || cleaned.length > LIMITS.tag || !TAG_PATTERN.test(cleaned)) {
      return `Tags must be 1-${LIMITS.tag} characters using letters, numbers, "-" or "_".`;
    }
  }
  return null;
}

/** Validates one field of a task. Shared by full (PUT/POST) and partial (PATCH) validation. */
const fieldValidators = {
  title: (value) => (typeof value !== "string" || !value.trim() || value.trim().length > LIMITS.title
    ? `Task title must be between 1 and ${LIMITS.title} characters.` : null),
  description: (value) => (typeof value !== "string" || value.length > LIMITS.description
    ? `Task description must not exceed ${LIMITS.description} characters.` : null),
  category: (value) => (typeof value !== "string" || !value.trim() || value.trim().length > LIMITS.category
    || !CATEGORY_PATTERN.test(value.trim())
    ? `Choose a valid task category (1-${LIMITS.category} letters or numbers).` : null),
  priority: (value) => (priorities.has(value) ? null : "Choose a valid priority."),
  status: (value) => (statuses.has(value) ? null : "Choose a valid task status."),
  dueDate: (value) => (isValidDateString(value) ? null : "Provide a valid due date."),
  important: (value) => (typeof value === "boolean" ? null : "Task importance must be true or false."),
  tags: validateTags,
};
const REQUIRED_FIELDS = ["title", "description", "category", "priority", "status", "dueDate", "important"];

/**
 * Validates a complete task (used when creating or fully replacing a task).
 * `tags` is optional so older clients that do not send tags keep working.
 */
function validateTask(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "A task object is required.";
  for (const field of REQUIRED_FIELDS) {
    const error = fieldValidators[field](body[field]);
    if (error) return error;
  }
  if (body.tags !== undefined) return validateTags(body.tags);
  return null;
}

/** Validates a partial task update (PATCH). At least one known field is required. */
function validateTaskPatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "A task object is required.";
  const fields = Object.keys(body).filter((field) => field in fieldValidators);
  if (!fields.length) return "Provide at least one task field to update.";
  for (const field of fields) {
    const error = fieldValidators[field](body[field]);
    if (error) return error;
  }
  return null;
}

/** Returns a cleaned copy of the known task fields in `body` (trimmed text, normalized tags). */
function normalizeTask(body) {
  const task = {};
  if (body.title !== undefined) task.title = body.title.trim();
  if (body.description !== undefined) task.description = body.description.trim();
  if (body.category !== undefined) task.category = body.category.trim().replace(/\s+/g, " ");
  for (const field of ["priority", "status", "dueDate", "important"]) {
    if (body[field] !== undefined) task[field] = body[field];
  }
  if (body.tags !== undefined) task.tags = normalizeTags(body.tags);
  return task;
}

function validateSubtask(body, { partial = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "A subtask object is required.";
  if (!partial || body.title !== undefined) {
    if (typeof body.title !== "string" || !body.title.trim() || body.title.trim().length > LIMITS.subtaskTitle) {
      return `Subtask title must be between 1 and ${LIMITS.subtaskTitle} characters.`;
    }
  }
  if (body.completed !== undefined && typeof body.completed !== "boolean") return "Subtask completion must be true or false.";
  if (partial && body.title === undefined && body.completed === undefined) return "Provide a subtask title or completion state.";
  return null;
}

function parsePositiveInteger(value, fallback) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * Validates and normalizes the query string of GET /api/tasks.
 * @returns {{ error: string } | { value: object }}
 */
function parseTaskListQuery(query, serverToday) {
  const single = (name) => (Array.isArray(query[name]) ? query[name][0] : query[name]);
  const value = {
    search: (single("search") || "").trim(),
    status: single("status") || "",
    priority: single("priority") || "",
    category: (single("category") || "").trim(),
    tag: (single("tag") || "").trim().replace(/^#/, "").toLowerCase(),
    due: single("due") || "",
    date: single("date") || "",
    important: single("important") === "true",
    sort: single("sort") || "dueDate",
    order: (single("order") || "asc").toLowerCase(),
    page: parsePositiveInteger(single("page"), 1),
    limit: parsePositiveInteger(single("limit"), 20),
    today: single("today") || serverToday,
  };
  if (value.search.length > LIMITS.search) return { error: `Search text must not exceed ${LIMITS.search} characters.` };
  if (value.status && value.status !== "active" && !statuses.has(value.status)) return { error: "Unknown status filter." };
  if (value.priority && !priorities.has(value.priority)) return { error: "Unknown priority filter." };
  if (value.category.length > LIMITS.category) return { error: "Unknown category filter." };
  if (value.tag.length > LIMITS.tag) return { error: "Unknown tag filter." };
  if (value.due && !DUE_FILTERS.includes(value.due)) return { error: "Unknown due-date filter." };
  if (value.date && !isValidDateString(value.date)) return { error: "Date filter must use YYYY-MM-DD." };
  if (!isValidDateString(value.today)) return { error: "Today must use YYYY-MM-DD." };
  if (!SORT_FIELDS.includes(value.sort)) return { error: `Sort must be one of: ${SORT_FIELDS.join(", ")}.` };
  if (value.order !== "asc" && value.order !== "desc") return { error: "Order must be asc or desc." };
  if (value.page === null) return { error: "Page must be a positive whole number." };
  if (value.limit === null || value.limit > LIMITS.pageSize) return { error: `Limit must be between 1 and ${LIMITS.pageSize}.` };
  return { value };
}

module.exports = {
  DEFAULT_CATEGORIES,
  PRIORITIES,
  STATUSES,
  SORT_FIELDS,
  LIMITS,
  isValidDateString,
  validateTask,
  validateTaskPatch,
  validateTags,
  normalizeTask,
  normalizeTags,
  validateSubtask,
  parseTaskListQuery,
};
