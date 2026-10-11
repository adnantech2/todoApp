const express = require("express");
const { HttpError, asyncRoute, parseId } = require("../lib/http-error");
const { requireUser } = require("../lib/middleware");
const {
  isValidDateString,
  validateTask,
  validateTaskPatch,
  validateSubtask,
  normalizeTask,
  parseTaskListQuery,
} = require("../lib/task-validation");
const repository = require("../lib/task-repository");

/** Today's date on the server, used when the browser does not send its own date. */
function serverToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Last day of the month containing `date` (YYYY-MM-DD). */
function monthEnd(date) {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function createTaskRouter({ db }) {
  const router = express.Router();
  router.use(requireUser);
  const userIdOf = (request) => request.session.user.id;

  // ---- Tasks -------------------------------------------------------------

  // GET /api/tasks?search=&status=&priority=&category=&tag=&due=&date=&important=&sort=&order=&page=&limit=&today=
  router.get("/tasks", asyncRoute(async (request, response) => {
    const parsed = parseTaskListQuery(request.query, serverToday());
    if (parsed.error) throw new HttpError(400, parsed.error);
    response.json(await repository.listTasks(db, userIdOf(request), parsed.value));
  }));

  router.get("/tasks/:id", asyncRoute(async (request, response) => {
    const task = await repository.getTaskDetail(db, userIdOf(request), parseId(request.params.id));
    if (!task) throw new HttpError(404, "Task not found.");
    response.json({ task });
  }));

  router.post("/tasks", asyncRoute(async (request, response) => {
    const validationError = validateTask(request.body);
    if (validationError) throw new HttpError(400, validationError);
    const task = await repository.createTask(db, userIdOf(request), normalizeTask(request.body));
    response.status(201).json({ task });
  }));

  // PUT replaces every field (the original API); PATCH changes only the fields sent.
  router.put("/tasks/:id", asyncRoute(async (request, response) => {
    const taskId = parseId(request.params.id);
    const validationError = validateTask(request.body);
    if (validationError) throw new HttpError(400, validationError);
    const task = await repository.updateTask(db, userIdOf(request), taskId, normalizeTask(request.body));
    if (!task) throw new HttpError(404, "Task not found.");
    response.json({ task });
  }));

  router.patch("/tasks/:id", asyncRoute(async (request, response) => {
    const taskId = parseId(request.params.id);
    const validationError = validateTaskPatch(request.body);
    if (validationError) throw new HttpError(400, validationError);
    const task = await repository.updateTask(db, userIdOf(request), taskId, normalizeTask(request.body));
    if (!task) throw new HttpError(404, "Task not found.");
    response.json({ task });
  }));

  router.delete("/tasks/:id", asyncRoute(async (request, response) => {
    const deleted = await repository.deleteTask(db, userIdOf(request), parseId(request.params.id));
    if (!deleted) throw new HttpError(404, "Task not found.");
    response.status(204).end();
  }));

  router.get("/tasks/:id/history", asyncRoute(async (request, response) => {
    const task = await repository.getTaskDetail(db, userIdOf(request), parseId(request.params.id));
    if (!task) throw new HttpError(404, "Task not found.");
    response.json({ history: task.history });
  }));

  // ---- Subtasks ----------------------------------------------------------

  router.post("/tasks/:id/subtasks", asyncRoute(async (request, response) => {
    const taskId = parseId(request.params.id);
    const validationError = validateSubtask(request.body);
    if (validationError) throw new HttpError(400, validationError);
    const result = await repository.addSubtask(db, userIdOf(request), taskId, request.body.title.trim());
    if (result.notFound) throw new HttpError(404, "Task not found.");
    if (result.limitReached) throw new HttpError(400, "This task already has the maximum number of subtasks.");
    response.status(201).json({ subtask: result.subtask });
  }));

  router.patch("/tasks/:id/subtasks/:subtaskId", asyncRoute(async (request, response) => {
    const taskId = parseId(request.params.id);
    const subtaskId = parseId(request.params.subtaskId, "subtask");
    const validationError = validateSubtask(request.body, { partial: true });
    if (validationError) throw new HttpError(400, validationError);
    const changes = {};
    if (request.body.title !== undefined) changes.title = request.body.title.trim();
    if (request.body.completed !== undefined) changes.completed = request.body.completed;
    const subtask = await repository.updateSubtask(db, userIdOf(request), taskId, subtaskId, changes);
    if (!subtask) throw new HttpError(404, "Subtask not found.");
    response.json({ subtask });
  }));

  router.delete("/tasks/:id/subtasks/:subtaskId", asyncRoute(async (request, response) => {
    const deleted = await repository.deleteSubtask(
      db,
      userIdOf(request),
      parseId(request.params.id),
      parseId(request.params.subtaskId, "subtask"),
    );
    if (!deleted) throw new HttpError(404, "Subtask not found.");
    response.status(204).end();
  }));

  // ---- Tags and dashboard statistics -------------------------------------

  router.get("/tags", asyncRoute(async (request, response) => {
    response.json({ tags: await repository.listTags(db, userIdOf(request)) });
  }));

  // GET /api/stats?today=YYYY-MM-DD&from=YYYY-MM-DD&to=YYYY-MM-DD&tzOffset=300 (from/to = calendar range)
  router.get("/stats", asyncRoute(async (request, response) => {
    const today = String(request.query.today || serverToday());
    if (!isValidDateString(today)) throw new HttpError(400, "Dates must use YYYY-MM-DD.");
    const from = String(request.query.from || `${today.slice(0, 8)}01`);
    const to = String(request.query.to || monthEnd(today));
    if (!isValidDateString(from) || !isValidDateString(to)) throw new HttpError(400, "Dates must use YYYY-MM-DD.");
    const days = (new Date(to) - new Date(from)) / 86400000;
    if (days < 0 || days > 62) throw new HttpError(400, "The calendar range must be at most two months.");
    // tzOffset = minutes east of UTC (e.g. 300 for UTC+5), sent by the browser.
    const tzOffset = Number(request.query.tzOffset || 0);
    if (!Number.isInteger(tzOffset) || Math.abs(tzOffset) > 14 * 60) throw new HttpError(400, "tzOffset must be minutes between -840 and 840.");
    const sign = tzOffset < 0 ? "-" : "+";
    const utcOffset = `${sign}${String(Math.floor(Math.abs(tzOffset) / 60)).padStart(2, "0")}:${String(Math.abs(tzOffset) % 60).padStart(2, "0")}`;
    response.json({ stats: await repository.getStats(db, userIdOf(request), today, { from, to }, utcOffset) });
  }));

  return router;
}

module.exports = { createTaskRouter };
