// TodoApp frontend: state, data loading, rendering and event handling.
// The server does the searching, filtering, sorting and pagination; this file
// keeps track of what the user selected and renders the results.

import { api, onUnauthorized, withQuery } from "./api.js";
import {
  PRIORITIES, STATUSES, DEFAULT_CATEGORIES,
  escapeHtml, todayString, toDateString, isOverdue, formatDueDate, formatLongDate,
  timeAgo, debounce, colorIndex, plural,
} from "./utils.js";
import {
  showToast, openModal, closeModal, isModalOpen, confirmDialog,
  openDrawer, closeDrawer, isDrawerOpen, initDialogs,
} from "./ui.js";
import { SYNOPSIS_SECTIONS } from "./synopsis.js";

const THEME_KEY = "todoapp.darkMode";
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

// ---- Application state -------------------------------------------------------

const state = {
  user: null,
  view: "dashboard", // sidebar view: dashboard, all, pending, completed, important, today, upcoming, overdue
  status: "all", // status tab
  category: "",
  tag: "",
  priority: "",
  date: "", // date picked in the calendar
  search: "",
  sort: "dueDate",
  order: "asc",
  page: 1,
  limit: 20,
  tasks: [],
  pagination: null,
  stats: null,
  tags: [],
  calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  drawerTaskId: null,
};

const VIEW_TITLES = {
  dashboard: "My Tasks",
  all: "All Tasks",
  pending: "Pending Tasks",
  completed: "Completed Tasks",
  important: "Important Tasks",
  today: "Today's Tasks",
  upcoming: "Next 7 Days",
  overdue: "Overdue Tasks",
};

// Extra API filters applied by each sidebar view.
const VIEW_FILTERS = {
  pending: { status: "active" },
  completed: { status: "Completed" },
  important: { important: true },
  today: { due: "today" },
  upcoming: { due: "week", status: "active" },
  overdue: { due: "overdue" },
};

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage may be disabled */ }
}

// ---- Loading data ------------------------------------------------------------

function taskQuery() {
  const query = {
    search: state.search,
    priority: state.priority,
    category: state.category,
    tag: state.tag,
    date: state.date,
    sort: state.sort,
    order: state.order,
    page: state.page,
    limit: state.limit,
    today: todayString(),
    ...VIEW_FILTERS[state.view],
  };
  if (state.status !== "all") query.status = state.status;
  return query;
}

let listRequestId = 0;
async function loadTasks({ quiet = false } = {}) {
  const requestId = ++listRequestId; // ignore responses that arrive after a newer request
  if (!quiet) renderSkeleton();
  try {
    const data = await api(withQuery("/api/tasks", taskQuery()));
    if (requestId !== listRequestId) return;
    if (!data.tasks.length && state.page > data.pagination.totalPages) {
      state.page = data.pagination.totalPages; // e.g. the last task on the last page was deleted
      return loadTasks({ quiet });
    }
    state.tasks = data.tasks;
    state.pagination = data.pagination;
    renderTasks();
    renderHeading();
  } catch (error) {
    if (requestId === listRequestId) renderListError(error.message);
  } finally {
    if (requestId === listRequestId) $("#task-list").setAttribute("aria-busy", "false");
  }
}

function calendarRange() {
  const first = state.calendarMonth;
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
  const end = new Date(start);
  end.setDate(start.getDate() + weeks * 7 - 1);
  return { from: toDateString(start), to: toDateString(end), start, weeks };
}

async function loadStats() {
  const { from, to } = calendarRange();
  try {
    const { stats } = await api(withQuery("/api/stats", { today: todayString(), from, to, tzOffset: -new Date().getTimezoneOffset() }));
    state.stats = stats;
    renderStats();
    renderCalendar();
  } catch (error) {
    showToast(`Could not load statistics: ${error.message}`, "error");
  }
}

async function loadTags() {
  try {
    state.tags = (await api("/api/tags")).tags;
    renderTagCloud();
  } catch {
    state.tags = [];
  }
}

/** Reloads everything that can change after a task is created, edited or deleted. */
function refreshAfterChange() {
  return Promise.all([loadTasks({ quiet: true }), loadStats(), loadTags()]);
}

// ---- Rendering: task list ------------------------------------------------------

function renderSkeleton() {
  const list = $("#task-list");
  list.setAttribute("aria-busy", "true");
  if (list.querySelector(".task-row")) {
    list.classList.add("is-loading"); // keep current rows visible but dimmed
    return;
  }
  list.innerHTML = Array.from({ length: 4 }, () => '<div class="task-row skeleton" aria-hidden="true"><span></span><span></span><span></span></div>').join("");
}

function renderListError(message) {
  const list = $("#task-list");
  list.classList.remove("is-loading");
  list.innerHTML = `<div class="empty-state error-state"><strong>Couldn't load tasks</strong>${escapeHtml(message)}<br><button class="secondary-button" data-action="retry">Try again</button></div>`;
  $("#pagination").classList.add("hidden");
}

function hasActiveFilters() {
  return Boolean(state.search || state.category || state.tag || state.priority || state.date || state.status !== "all");
}

function categoryChip(category) {
  return `<span class="task-category color-${colorIndex(category)}">${escapeHtml(category)}</span>`;
}

function renderTaskRow(task) {
  const completed = task.status === "Completed";
  const overdue = isOverdue(task);
  const id = escapeHtml(task.id);
  const tags = task.tags.slice(0, 3).map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join("")
    + (task.tags.length > 3 ? `<span class="tag-chip">+${task.tags.length - 3}</span>` : "");
  const subtasks = task.subtasks.total
    ? `<span class="subtask-count ${task.subtasks.completed === task.subtasks.total ? "done" : ""}" title="Subtasks completed">☑ ${task.subtasks.completed}/${task.subtasks.total}</span>` : "";
  return `<article class="task-row ${completed ? "is-complete" : ""} ${overdue ? "is-overdue" : ""} priority-edge-${task.priority.toLowerCase()}">
    <button class="task-check ${completed ? "checked" : ""}" data-action="toggle" data-id="${id}" aria-label="${completed ? "Mark as pending" : "Mark as completed"}: ${escapeHtml(task.title)}">${completed ? "✓" : ""}</button>
    <div class="task-main">
      <button class="task-title" data-action="open" data-id="${id}" title="Open details">${escapeHtml(task.title)}</button>
      <div class="task-meta">${categoryChip(task.category)}<span class="status-chip ${task.status.toLowerCase().replace(" ", "-")}">${escapeHtml(task.status)}</span>${subtasks}${tags}</div>
    </div>
    <div class="task-due ${overdue ? "overdue" : ""}" title="${escapeHtml(formatLongDate(task.dueDate))}"><span aria-hidden="true">▣</span>${overdue ? "Overdue · " : ""}${formatDueDate(task.dueDate)}</div>
    <span class="priority ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
    <div class="row-menu">
      <button data-action="important" data-id="${id}" class="${task.important ? "is-starred" : ""}" aria-pressed="${task.important}" aria-label="${task.important ? "Remove from" : "Add to"} important tasks" title="${task.important ? "Remove important" : "Mark important"}">${task.important ? "★" : "☆"}</button>
      <button data-action="edit" data-id="${id}" aria-label="Edit ${escapeHtml(task.title)}" title="Edit task">✎</button>
      <button data-action="delete" data-id="${id}" aria-label="Delete ${escapeHtml(task.title)}" title="Delete task">🗑</button>
    </div>
  </article>`;
}

function renderTasks() {
  const list = $("#task-list");
  list.classList.remove("is-loading");
  if (!state.tasks.length) {
    list.innerHTML = hasActiveFilters()
      ? '<div class="empty-state"><span class="empty-icon" aria-hidden="true">🔍</span><strong>No matching tasks</strong>Try a different search or clear the filters.<br><button class="secondary-button" data-action="clear-filters">Clear filters</button></div>'
      : `<div class="empty-state"><span class="empty-icon" aria-hidden="true">✨</span><strong>${state.view === "overdue" ? "Nothing overdue" : "No tasks here yet"}</strong>${state.view === "overdue" ? "You're all caught up. Great work!" : "Add a task to get started."}<br><button class="primary-button" data-action="new">＋ Add a task</button></div>`;
    $("#pagination").classList.add("hidden");
    return;
  }
  list.innerHTML = state.tasks.map(renderTaskRow).join("");
  renderPagination();
}

function renderPagination() {
  const { page, totalPages, total, limit } = state.pagination;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);
  $("#pagination").classList.toggle("hidden", total <= limit && page === 1);
  $("#page-info").textContent = `${first}–${last} of ${plural(total, "task")} · Page ${page} of ${totalPages}`;
  $("#previous-page").disabled = page <= 1;
  $("#next-page").disabled = page >= totalPages;
}

function renderHeading() {
  let title = VIEW_TITLES[state.view];
  if (state.category) title = state.category;
  if (state.tag) title = `#${state.tag}`;
  $("#task-heading").textContent = title;
  const total = state.pagination?.total;
  let subtitle = "A little progress goes a long way";
  if (state.date) subtitle = `Tasks due ${formatLongDate(state.date)}`;
  else if (state.search) subtitle = `Results for “${state.search}”`;
  else if (total !== undefined && state.view !== "dashboard") subtitle = plural(total, "task");
  $("#task-subtitle").textContent = subtitle;

  $$(".nav-link[data-view]").forEach((link) => {
    const active = link.dataset.view === state.view && !state.category && !state.tag && !state.date;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  });
  $$(".category-link").forEach((link) => link.classList.toggle("active", link.dataset.category === state.category));
  $$(".tag-link").forEach((link) => link.classList.toggle("active", link.dataset.tag === state.tag));
  $$(".filter-tab").forEach((tab) => {
    tab.classList.toggle("selected", tab.dataset.status === state.status);
    tab.setAttribute("aria-pressed", String(tab.dataset.status === state.status));
  });
  $("#insight-grid").classList.toggle("hidden", state.view !== "dashboard" || Boolean(state.category || state.tag || state.date));
  $("#priority-filter").value = state.priority;
  $("#sort-select").value = state.sort;
  $("#page-size").value = String(state.limit);
  $("#order-button").textContent = state.order === "asc" ? "↑" : "↓";
  $("#order-button").setAttribute("aria-label", state.order === "asc" ? "Sorted ascending. Switch to descending" : "Sorted descending. Switch to ascending");
  renderActiveFilters();
}

function renderActiveFilters() {
  const chips = [];
  if (state.search) chips.push(["search", `Search: ${state.search}`]);
  if (state.category) chips.push(["category", `Category: ${state.category}`]);
  if (state.tag) chips.push(["tag", `#${state.tag}`]);
  if (state.priority) chips.push(["priority", `Priority: ${state.priority}`]);
  if (state.date) chips.push(["date", `Due: ${formatDueDate(state.date)}`]);
  $("#active-filters").innerHTML = chips.map(([key, label]) =>
    `<button class="filter-chip" data-clear="${key}" aria-label="Remove filter ${escapeHtml(label)}">${escapeHtml(label)} <span aria-hidden="true">×</span></button>`).join("")
    + (chips.length > 1 ? '<button class="filter-chip clear-all" data-clear="all">Clear all</button>' : "");
}

// ---- Rendering: dashboard statistics -------------------------------------------

function renderStats() {
  const stats = state.stats;
  if (!stats) return;
  const set = (selector, value) => { $(selector).textContent = value; };
  set("#stat-total", stats.total);
  set("#stat-week", stats.dueThisWeek);
  set("#stat-completed", stats.completed);
  set("#completion-rate", stats.completionRate);
  set("#stat-pending", stats.pending + stats.inProgress);
  set("#stat-in-progress", stats.inProgress);
  set("#stat-overdue", stats.overdue);
  set("#stat-due-today", stats.dueToday);
  set("#stat-important", stats.important);
  set("#progress-percent", `${stats.completionRate}%`);
  $("#progress-ring").style.setProperty("--progress", `${stats.completionRate * 3.6}deg`);
  set("#legend-completed", stats.completed);
  set("#legend-pending", stats.pending);
  set("#legend-in-progress", stats.inProgress);
  set("#legend-total", stats.total);
  set("#all-count", stats.total);
  set("#pending-count", stats.pending + stats.inProgress);
  set("#completed-count", stats.completed);
  set("#important-count", stats.important);
  set("#today-count", stats.today);
  set("#upcoming-count", stats.dueThisWeek);
  set("#overdue-count", stats.overdue);
  $("#overdue-count").classList.toggle("hidden", !stats.overdue);
  $(".stat-card[data-view='overdue']").classList.toggle("has-alert", stats.overdue > 0);
  $("#notification-dot").classList.toggle("hidden", !(stats.overdue + stats.dueToday));
  $("#consistency-text").textContent = stats.completedThisWeek
    ? `You've completed ${plural(stats.completedThisWeek, "task")} in the last 7 days. Keep it up!`
    : "You're one step closer to your goals!";

  // Priority breakdown (open tasks only)
  const maxPriority = Math.max(1, ...Object.values(stats.byPriority));
  $("#priority-bars").innerHTML = [...PRIORITIES].reverse().map((priority) => {
    const count = stats.byPriority[priority];
    return `<button class="priority-bar" data-priority="${priority}" aria-label="${count} open ${priority} priority tasks. Filter by ${priority}">
      <span class="priority-bar-label">${priority}</span>
      <span class="priority-bar-track"><span class="priority-bar-fill ${priority.toLowerCase()}" style="width:${(count / maxPriority) * 100}%"></span></span>
      <strong>${count}</strong></button>`;
  }).join("");

  // Completions over the last 7 days
  const maxTrend = Math.max(1, ...stats.completedTrend.map((day) => day.count));
  $("#week-completed-total").textContent = `· ${stats.completedThisWeek} total`;
  $("#trend-chart").innerHTML = stats.completedTrend.map((day) => {
    const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
    return `<div class="trend-day" title="${escapeHtml(formatLongDate(day.date))}: ${plural(day.count, "task")} completed">
      <span class="trend-value">${day.count || ""}</span>
      <span class="trend-bar" style="height:${Math.max(4, (day.count / maxTrend) * 100)}%"></span>
      <span class="trend-label">${escapeHtml(label)}</span></div>`;
  }).join("");

  renderCategories();
}

function renderCategories() {
  const counts = new Map(DEFAULT_CATEGORIES.map((name) => [name, 0]));
  for (const category of state.stats?.byCategory || []) counts.set(category.name, category.total);
  $("#category-nav").innerHTML = [...counts].map(([name, count]) =>
    `<button class="category-link ${name === state.category ? "active" : ""}" data-category="${escapeHtml(name)}" title="${escapeHtml(name)}"><span class="category-dot color-dot-${colorIndex(name)}"></span><span class="nav-text">${escapeHtml(name)}</span><span class="nav-count">${count}</span></button>`).join("");
}

function renderTagCloud() {
  $("#tag-cloud").innerHTML = state.tags.length
    ? state.tags.slice(0, 20).map((tag) => `<button class="tag-link ${tag.name === state.tag ? "active" : ""}" data-tag="${escapeHtml(tag.name)}">#${escapeHtml(tag.name)} <small>${tag.count}</small></button>`).join("")
    : '<span class="tag-empty">Add tags to tasks to see them here.</span>';
}

function renderCalendar() {
  const { start, weeks } = calendarRange();
  const month = state.calendarMonth;
  $("#calendar-month").textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const byDate = new Map((state.stats?.calendar || []).map((day) => [day.date, day]));
  const today = todayString();
  const cells = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((name) => `<span class="calendar-day-name" aria-hidden="true">${name}</span>`);
  for (let index = 0; index < weeks * 7; index += 1) {
    const cellDate = new Date(start);
    cellDate.setDate(start.getDate() + index);
    const value = toDateString(cellDate);
    const info = byDate.get(value);
    const classes = ["calendar-date"];
    if (cellDate.getMonth() !== month.getMonth()) classes.push("muted");
    if (value === today) classes.push("today");
    if (value === state.date) classes.push("selected");
    if (info) classes.push(info.open && value < today ? "has-overdue" : info.open ? "has-task" : "has-done");
    const label = `${formatLongDate(value)}${info ? `, ${plural(info.total, "task")}` : ""}`;
    cells.push(`<button class="${classes.join(" ")}" data-date="${value}" aria-label="${escapeHtml(label)}" aria-pressed="${value === state.date}">${cellDate.getDate()}</button>`);
  }
  $("#calendar-grid").innerHTML = cells.join("");
}

function renderUser() {
  const user = state.user;
  const hour = new Date().getHours();
  const firstName = user.name.trim().split(/\s+/)[0];
  $("#greeting").innerHTML = `Good ${hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening"}, ${escapeHtml(firstName)}! <span aria-hidden="true">👋</span>`;
  $("#profile-name").textContent = user.name;
  $("#profile-avatar").textContent = user.name.trim().charAt(0).toUpperCase();
  $("#menu-profile-name").textContent = user.name;
  $("#menu-profile-email").textContent = user.email || "";
  $("#today-label").textContent = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

/** Re-renders the heading/filters and reloads the task list. Call after any filter change. */
function applyFilters({ resetPage = true } = {}) {
  if (resetPage) state.page = 1;
  renderHeading();
  renderCategories();
  renderTagCloud();
  renderCalendar();
  return loadTasks();
}

function setView(view) {
  Object.assign(state, { view, status: "all", category: "", tag: "", date: "", priority: "" });
  closeSidebar();
  applyFilters();
  // Counts and tags may have changed in another tab or device.
  loadStats();
  loadTags();
}

function clearFilter(key) {
  if (key === "all") {
    Object.assign(state, { search: "", category: "", tag: "", priority: "", date: "", status: "all" });
    $("#search-input").value = "";
  } else {
    state[key] = "";
    if (key === "search") $("#search-input").value = "";
  }
  applyFilters();
}

// ---- Task actions -------------------------------------------------------------

const findTask = (id) => state.tasks.find((task) => task.id === id);

async function patchTask(task, changes, successMessage, undoChanges) {
  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "PATCH", body: changes });
    await refreshAfterChange();
    if (state.drawerTaskId === task.id) loadDrawer(task.id);
    if (successMessage) {
      showToast(successMessage, "success", undoChanges ? {
        actionLabel: "Undo",
        onAction: () => patchTask(task, undoChanges, "Change undone."),
      } : {});
    }
  } catch (error) {
    showToast(error.message, "error");
    loadTasks({ quiet: true }); // re-enables the buttons that were disabled while saving
  }
}

function toggleComplete(task) {
  const completing = task.status !== "Completed";
  return patchTask(task, { status: completing ? "Completed" : "Pending" },
    completing ? `“${task.title}” completed 🎉` : "Task moved back to pending.",
    { status: task.status });
}

async function deleteTask(task) {
  const confirmed = await confirmDialog({
    title: "Delete this task?",
    message: `“${task.title}” and its subtasks and history will be permanently deleted.`,
    confirmLabel: "Delete task",
    danger: true,
  });
  if (!confirmed) return;
  try {
    await api(`/api/tasks/${encodeURIComponent(task.id)}`, { method: "DELETE" });
    if (state.drawerTaskId === task.id) closeTaskDrawer();
    showToast("Task deleted.", "success");
    await refreshAfterChange();
  } catch (error) {
    showToast(error.message, "error");
  }
}

// ---- Task form (create / edit) -------------------------------------------------

function parseTagInput(text) {
  return [...new Set(text.split(/[\s,]+/).map((tag) => tag.replace(/^#/, "").trim().toLowerCase()).filter(Boolean))];
}

function knownCategories() {
  return [...new Set([...DEFAULT_CATEGORIES, ...(state.stats?.byCategory || []).map((category) => category.name)])];
}

function openTaskModal(task = null) {
  const isEditing = Boolean(task);
  const option = (value, selected) => `<option ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`;
  const content = openModal({
    eyebrow: isEditing ? "UPDATE YOUR TASK" : "MAKE A PLAN",
    title: isEditing ? "Edit task" : "Add a task",
    html: `<form class="task-form" id="task-form" novalidate>
      <p class="form-error hidden" id="task-form-error" role="alert"></p>
      <div class="form-field"><label for="task-title-input">Task title</label><input id="task-title-input" name="title" maxlength="150" placeholder="What needs to get done?" required value="${task ? escapeHtml(task.title) : ""}"></div>
      <div class="form-field"><label for="task-description-input">Description <span class="optional">(optional)</span></label><textarea id="task-description-input" name="description" maxlength="5000" placeholder="Add a few details...">${task ? escapeHtml(task.description) : ""}</textarea></div>
      <div class="form-row form-row-three">
        <div class="form-field"><label for="task-category-input">Category</label><input id="task-category-input" name="category" list="category-options" maxlength="40" required value="${escapeHtml(task?.category || (state.category || "Work"))}"><datalist id="category-options">${knownCategories().map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist></div>
        <div class="form-field"><label for="task-priority-input">Priority</label><select id="task-priority-input" name="priority">${PRIORITIES.map((value) => option(value, task?.priority || "Medium")).join("")}</select></div>
        <div class="form-field"><label for="task-status-input">Status</label><select id="task-status-input" name="status">${STATUSES.map((value) => option(value, task?.status || "Pending")).join("")}</select></div>
      </div>
      <div class="form-row">
        <div class="form-field"><label for="task-date-input">Due date</label><input id="task-date-input" name="dueDate" type="date" required value="${task ? task.dueDate : (state.date || todayString())}"></div>
        <div class="form-field"><label for="task-tags-input">Tags <span class="optional">(space or comma separated)</span></label><input id="task-tags-input" name="tags" placeholder="exam, lab-report" value="${task ? escapeHtml(task.tags.join(", ")) : (state.tag || "")}"></div>
      </div>
      <label class="important-option"><input type="checkbox" name="important" ${task?.important || (!task && state.view === "important") ? "checked" : ""}> Mark as important</label>
      <div class="form-actions"><button type="button" class="secondary-button" id="cancel-modal">Cancel</button><button type="submit" class="primary-button">${isEditing ? "Save changes" : "Add task"}</button></div>
    </form>`,
  });
  $("#task-title-input").focus();
  $("#cancel-modal").addEventListener("click", closeModal);
  content.querySelector("#task-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const showError = (message) => {
      const error = $("#task-form-error");
      if (!error) return; // the form was closed, e.g. because the session expired
      error.textContent = message;
      error.classList.remove("hidden");
    };
    const details = {
      title: String(formData.get("title")).trim(),
      description: String(formData.get("description")).trim(),
      category: String(formData.get("category")).trim(),
      priority: String(formData.get("priority")),
      status: String(formData.get("status")),
      dueDate: String(formData.get("dueDate")),
      important: formData.get("important") === "on",
      tags: parseTagInput(String(formData.get("tags"))),
    };
    if (!details.title) return showError("Please enter a task title.");
    if (!details.category) return showError("Please choose a category.");
    if (!details.dueDate) return showError("Please choose a due date.");
    if (details.tags.length > 10) return showError("A task can have at most 10 tags.");
    if (details.tags.some((tag) => tag.length > 30 || !/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(tag))) {
      return showError('Tags may use letters, numbers, "-" and "_" (max 30 characters each).');
    }
    const submitButton = form.querySelector("button[type='submit']");
    submitButton.disabled = true;
    submitButton.classList.add("is-busy");
    try {
      await api(task ? `/api/tasks/${encodeURIComponent(task.id)}` : "/api/tasks", { method: task ? "PUT" : "POST", body: details });
      closeModal();
      showToast(task ? "Task updated." : "Task added.", "success");
      await refreshAfterChange();
      if (task && state.drawerTaskId === task.id) loadDrawer(task.id);
    } catch (error) {
      showError(error.message);
      submitButton.disabled = false;
      submitButton.classList.remove("is-busy");
    }
  });
}

// ---- Task details drawer (subtasks + history) ---------------------------------

const FIELD_LABELS = { title: "Title", category: "Category", priority: "Priority", status: "Status", dueDate: "Due date", tags: "Tags" };

function describeHistory(entry) {
  const details = entry.details || {};
  const quote = (value) => `“${escapeHtml(value === "" || value === null || value === undefined ? "none" : value)}”`;
  switch (entry.action) {
    case "created": return ["Task created"];
    case "subtask_added": return [`Subtask ${quote(details.title)} added`];
    case "subtask_completed": return [`Subtask ${quote(details.title)} completed`];
    case "subtask_reopened": return [`Subtask ${quote(details.title)} reopened`];
    case "subtask_deleted": return [`Subtask ${quote(details.title)} removed`];
    case "subtask_renamed": return [`Subtask renamed from ${quote(details.from)} to ${quote(details.to)}`];
    case "updated": return Object.entries(details.changes || {}).map(([field, change]) => {
      if (field === "description") return "Description updated";
      if (field === "important") return change.to ? "Marked as important" : "Removed from important";
      const format = (value) => (field === "dueDate" && value ? formatDueDate(value) : value);
      return `${FIELD_LABELS[field] || escapeHtml(field)} changed from ${quote(format(change.from))} to ${quote(format(change.to))}`;
    });
    default: return [escapeHtml(entry.action)];
  }
}

function openTaskDrawer(taskId) {
  state.drawerTaskId = taskId;
  $("#drawer-title").textContent = "Loading…";
  $("#drawer-content").innerHTML = '<div class="drawer-loading"><span class="spinner" aria-hidden="true"></span> Loading task…</div>';
  openDrawer();
  $("#drawer-close").focus();
  loadDrawer(taskId);
}

function closeTaskDrawer() {
  state.drawerTaskId = null;
  closeDrawer();
}

async function loadDrawer(taskId) {
  try {
    const { task } = await api(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (state.drawerTaskId !== taskId) return;
    renderDrawer(task);
  } catch (error) {
    if (state.drawerTaskId !== taskId) return;
    $("#drawer-title").textContent = "Task unavailable";
    $("#drawer-content").innerHTML = `<div class="empty-state error-state"><strong>Couldn't load this task</strong>${escapeHtml(error.message)}</div>`;
  }
}

function renderDrawer(task) {
  const overdue = isOverdue(task);
  const progress = task.subtasks.total ? Math.round((task.subtasks.completed / task.subtasks.total) * 100) : 0;
  $("#drawer-title").textContent = task.title;
  $("#drawer-content").innerHTML = `
    <div class="drawer-chips">
      <span class="priority ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span>
      ${categoryChip(task.category)}
      ${task.important ? '<span class="tag-chip starred">★ Important</span>' : ""}
      ${task.tags.map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`).join("")}
    </div>
    <dl class="drawer-facts">
      <div><dt>Status</dt><dd><select id="drawer-status" aria-label="Change status">${STATUSES.map((status) => `<option ${status === task.status ? "selected" : ""}>${status}</option>`).join("")}</select></dd></div>
      <div><dt>Due</dt><dd class="${overdue ? "overdue-text" : ""}">${overdue ? "Overdue · " : ""}${escapeHtml(formatLongDate(task.dueDate))}</dd></div>
      <div><dt>Created</dt><dd title="${escapeHtml(new Date(task.createdAt).toLocaleString())}">${timeAgo(task.createdAt)}</dd></div>
      ${task.completedAt ? `<div><dt>Completed</dt><dd>${timeAgo(task.completedAt)}</dd></div>` : `<div><dt>Updated</dt><dd>${timeAgo(task.updatedAt)}</dd></div>`}
    </dl>
    ${task.description ? `<p class="drawer-description">${escapeHtml(task.description)}</p>` : '<p class="drawer-description muted-text">No description.</p>'}

    <section class="drawer-section">
      <h3>Subtasks <span class="widget-note">${task.subtasks.completed}/${task.subtasks.total}</span></h3>
      ${task.subtasks.total ? `<div class="subtask-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}" aria-label="Subtask progress"><span style="width:${progress}%"></span></div>` : ""}
      <ul class="subtask-list">${task.subtaskItems.map((subtask) => `<li class="${subtask.completed ? "done" : ""}">
          <label><input type="checkbox" data-subtask-toggle="${escapeHtml(subtask.id)}" ${subtask.completed ? "checked" : ""}> <span>${escapeHtml(subtask.title)}</span></label>
          <button class="icon-button" data-subtask-delete="${escapeHtml(subtask.id)}" aria-label="Delete subtask ${escapeHtml(subtask.title)}">×</button>
        </li>`).join("")}</ul>
      <form class="subtask-form" id="subtask-form"><input name="title" maxlength="150" placeholder="Add a subtask..." aria-label="New subtask title" required><button class="secondary-button" type="submit">Add</button></form>
    </section>

    <section class="drawer-section">
      <h3>Activity</h3>
      <ol class="history-list">${task.history.map((entry) => describeHistory(entry).map((line) =>
        `<li><span class="history-dot history-${escapeHtml(entry.action)}" aria-hidden="true"></span><span>${line}</span><time datetime="${escapeHtml(entry.createdAt)}" title="${escapeHtml(new Date(entry.createdAt).toLocaleString())}">${timeAgo(entry.createdAt)}</time></li>`).join("")).join("") || "<li>No activity yet.</li>"}</ol>
    </section>

    <div class="form-actions drawer-actions">
      <button class="danger-link" id="drawer-delete">Delete</button>
      <button class="secondary-button" id="drawer-important">${task.important ? "★ Unstar" : "☆ Star"}</button>
      <button class="primary-button" id="drawer-edit">Edit task</button>
    </div>`;

  const taskRef = { ...task };
  $("#drawer-status").addEventListener("change", (event) => patchTask(taskRef, { status: event.target.value }, `Status changed to ${event.target.value}.`));
  $("#drawer-edit").addEventListener("click", () => openTaskModal(taskRef));
  $("#drawer-delete").addEventListener("click", () => deleteTask(taskRef));
  $("#drawer-important").addEventListener("click", () => patchTask(taskRef, { important: !task.important }));
  $("#subtask-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.currentTarget.elements.title;
    const title = input.value.trim();
    if (!title) return;
    input.disabled = true;
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}/subtasks`, { method: "POST", body: { title } });
      await loadDrawer(task.id);
      $("#subtask-form input")?.focus();
      loadTasks({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
      input.disabled = false;
    }
  });
  $("#drawer-content").querySelectorAll("[data-subtask-toggle]").forEach((checkbox) => checkbox.addEventListener("change", async () => {
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}/subtasks/${encodeURIComponent(checkbox.dataset.subtaskToggle)}`, { method: "PATCH", body: { completed: checkbox.checked } });
      await loadDrawer(task.id);
      loadTasks({ quiet: true });
    } catch (error) {
      checkbox.checked = !checkbox.checked;
      showToast(error.message, "error");
    }
  }));
  $("#drawer-content").querySelectorAll("[data-subtask-delete]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await api(`/api/tasks/${encodeURIComponent(task.id)}/subtasks/${encodeURIComponent(button.dataset.subtaskDelete)}`, { method: "DELETE" });
      await loadDrawer(task.id);
      loadTasks({ quiet: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  }));
}

// ---- Other dialogs: sign in, settings, synopsis, shortcuts ----------------------

function openAuthModal(mode = "login") {
  const isRegister = mode === "register";
  const content = openModal({
    eyebrow: "YOUR ACCOUNT",
    title: isRegister ? "Create account" : "Welcome back",
    html: `<form class="task-form" id="auth-form" novalidate>
      <p class="form-error hidden" id="auth-form-error" role="alert"></p>
      ${isRegister ? '<div class="form-field"><label for="auth-name">Full name</label><input id="auth-name" name="name" autocomplete="name" maxlength="100" required placeholder="Your name"></div>' : ""}
      <div class="form-field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" maxlength="100" required placeholder="you@example.com"></div>
      <div class="form-field"><label for="auth-password">Password</label>
        <div class="password-field"><input id="auth-password" name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" minlength="8" required placeholder="${isRegister ? "At least 8 characters, with a letter and a number" : "Your password"}"><button type="button" class="show-password" aria-label="Show password" aria-pressed="false">Show</button></div>
      </div>
      <div class="form-actions"><button type="button" class="secondary-button" id="auth-mode-toggle">${isRegister ? "I already have an account" : "Create an account"}</button><button type="submit" class="primary-button">${isRegister ? "Register" : "Sign in"}</button></div>
    </form>`,
  });
  content.querySelector("input").focus();
  content.querySelector(".show-password").addEventListener("click", (event) => {
    const input = $("#auth-password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    event.currentTarget.textContent = show ? "Hide" : "Show";
    event.currentTarget.setAttribute("aria-pressed", String(show));
  });
  $("#auth-mode-toggle").addEventListener("click", () => openAuthModal(isRegister ? "login" : "register"));
  $("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = { email: String(formData.get("email")).trim(), password: String(formData.get("password")) };
    if (isRegister) payload.name = String(formData.get("name")).trim();
    const showError = (message) => {
      const error = $("#auth-form-error");
      if (!error) return;
      error.textContent = message;
      error.classList.remove("hidden");
    };
    if (isRegister && payload.name.length < 2) return showError("Please enter your name (at least 2 characters).");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return showError("Please enter a valid email address.");
    if (!payload.password) return showError("Please enter your password.");
    if (isRegister && (payload.password.length < 8 || !/\p{L}/u.test(payload.password) || !/\p{N}/u.test(payload.password))) {
      return showError("Password must be at least 8 characters and include a letter and a number.");
    }
    const submitButton = $("#auth-form button[type='submit']");
    submitButton.disabled = true;
    submitButton.classList.add("is-busy");
    try {
      const response = await api(isRegister ? "/api/auth/register" : "/api/auth/login", { method: "POST", body: payload });
      closeModal();
      await enterApp(response.user);
      showToast(isRegister ? "Your account is ready. Welcome!" : `Welcome back, ${response.user.name.split(" ")[0]}!`, "success");
    } catch (error) {
      showError(error.message);
      submitButton.disabled = false;
      submitButton.classList.remove("is-busy");
    }
  });
}

function openSettingsModal() {
  const isDark = document.body.classList.contains("dark-mode");
  openModal({
    eyebrow: "PREFERENCES",
    title: "Workspace settings",
    html: `<div class="settings-content">
      <div class="setting-row"><div><strong>Appearance</strong><br><span>Choose a light or dark workspace</span></div><button class="secondary-button" id="settings-theme">${isDark ? "Switch to light" : "Switch to dark"}</button></div>
      <form class="setting-block" id="profile-form">
        <strong>Profile</strong>
        <div class="form-field"><label for="profile-name-input">Display name</label><input id="profile-name-input" name="name" maxlength="100" required value="${escapeHtml(state.user.name)}"></div>
        <div class="form-actions"><button class="primary-button" type="submit">Save name</button></div>
      </form>
      <form class="setting-block" id="password-form">
        <strong>Change password</strong>
        <p class="form-error hidden" id="password-form-error" role="alert"></p>
        <div class="form-row">
          <div class="form-field"><label for="current-password">Current password</label><input id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div>
          <div class="form-field"><label for="new-password">New password</label><input id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="8" required></div>
        </div>
        <div class="form-actions"><button class="primary-button" type="submit">Update password</button></div>
      </form>
      <div class="setting-row"><div><strong>Your data</strong><br><span>Tasks are linked to your signed-in account and stored in MySQL.</span></div><span>MySQL</span></div>
      <div class="setting-row"><div><strong>Project</strong><br><span>To-Do List Management System · BCA 2026–2027</span></div><button class="secondary-button" id="settings-about">Project info</button></div>
    </div>`,
  });
  $("#settings-theme").addEventListener("click", toggleTheme);
  $("#settings-about").addEventListener("click", () => openProjectModal());
  $("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = event.currentTarget.elements.name.value.trim();
    try {
      const { user } = await api("/api/auth/profile", { method: "PATCH", body: { name } });
      state.user = { ...state.user, ...user };
      renderUser();
      showToast("Name updated.", "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  $("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: form.elements.currentPassword.value, newPassword: form.elements.newPassword.value } });
      form.reset();
      $("#password-form-error").classList.add("hidden");
      showToast("Password updated.", "success");
    } catch (error) {
      const message = $("#password-form-error");
      if (!message) return;
      message.textContent = error.message;
      message.classList.remove("hidden");
    }
  });
}

function openProjectModal(section = "overview") {
  const selected = SYNOPSIS_SECTIONS[section] ? section : "overview";
  const content = openModal({
    eyebrow: "TO-DO LIST MANAGEMENT SYSTEM · BCA 2026–2027",
    title: "Project synopsis",
    wide: true,
    html: `<nav class="project-tabs" aria-label="Project synopsis sections">${Object.entries(SYNOPSIS_SECTIONS).map(([key, value]) =>
      `<button class="project-tab ${key === selected ? "selected" : ""}" data-project-section="${key}" aria-pressed="${key === selected}">${value.label}</button>`).join("")}</nav>
      <div class="project-content">${SYNOPSIS_SECTIONS[selected].content}</div>`,
  });
  content.querySelectorAll("[data-project-section]").forEach((button) => button.addEventListener("click", () => {
    openProjectModal(button.dataset.projectSection);
    $(`[data-project-section="${button.dataset.projectSection}"]`)?.focus();
  }));
}

function openShortcutsModal() {
  openModal({
    eyebrow: "WORK FASTER",
    title: "Keyboard shortcuts",
    html: `<div class="shortcut-list">
      <div><kbd>Ctrl</kbd> + <kbd>K</kbd> or <kbd>/</kbd><span>Search tasks</span></div>
      <div><kbd>N</kbd><span>Add a new task</span></div>
      <div><kbd>Esc</kbd><span>Close a dialog or menu</span></div>
    </div>`,
  });
}

// ---- Notifications panel ---------------------------------------------------------

async function toggleNotifications() {
  const panel = $("#notification-panel");
  const opening = panel.classList.contains("hidden");
  closeMenus();
  if (!opening) return;
  panel.classList.remove("hidden");
  $("#notifications-button").setAttribute("aria-expanded", "true");
  panel.innerHTML = '<div class="dropdown-loading"><span class="spinner" aria-hidden="true"></span> Checking reminders…</div>';
  try {
    const today = todayString();
    const [overdue, dueToday] = await Promise.all([
      api(withQuery("/api/tasks", { due: "overdue", sort: "dueDate", limit: 5, today })),
      api(withQuery("/api/tasks", { due: "today", status: "active", sort: "priority", order: "desc", limit: 5, today })),
    ]);
    const item = (task) => `<button class="reminder" data-open-task="${escapeHtml(task.id)}"><span class="priority ${task.priority.toLowerCase()}">${escapeHtml(task.priority)}</span><span class="reminder-title">${escapeHtml(task.title)}</span><small class="${isOverdue(task) ? "overdue-text" : ""}">${formatDueDate(task.dueDate)}</small></button>`;
    const section = (title, data, view) => (data.tasks.length
      ? `<h3>${title} <span class="widget-note">${data.pagination.total}</span></h3>${data.tasks.map(item).join("")}${data.pagination.total > data.tasks.length ? `<button class="link-button" data-view-link="${view}">See all ${data.pagination.total} →</button>` : ""}`
      : "");
    const html = section("Overdue", overdue, "overdue") + section("Due today", dueToday, "today");
    panel.innerHTML = html || '<div class="dropdown-empty"><span aria-hidden="true">🎉</span><strong>You\'re all caught up</strong>No overdue tasks or tasks due today.</div>';
  } catch (error) {
    panel.innerHTML = `<div class="dropdown-empty">${escapeHtml(error.message)}</div>`;
  }
}

// ---- Theme, sidebar and menus --------------------------------------------------

function applyTheme(isDark) {
  document.body.classList.toggle("dark-mode", isDark);
  $("#theme-toggle").setAttribute("aria-pressed", String(isDark));
  document.querySelector('meta[name="theme-color"]').setAttribute("content", isDark ? "#0c1730" : "#101d3b");
  const settingsButton = $("#settings-theme");
  if (settingsButton) settingsButton.textContent = isDark ? "Switch to light" : "Switch to dark";
}

function toggleTheme() {
  const isDark = !document.body.classList.contains("dark-mode");
  applyTheme(isDark);
  writeStorage(THEME_KEY, String(isDark));
}

function closeMenus() {
  $("#profile-menu").classList.add("hidden");
  $("#profile-button").setAttribute("aria-expanded", "false");
  $("#notification-panel").classList.add("hidden");
  $("#notifications-button").setAttribute("aria-expanded", "false");
}

function openSidebar() {
  $("#app-shell").classList.add("sidebar-open");
  $("#sidebar-overlay").classList.remove("hidden");
  $("#menu-button").setAttribute("aria-expanded", "true");
}

function closeSidebar() {
  $("#app-shell").classList.remove("sidebar-open");
  $("#sidebar-overlay").classList.add("hidden");
  $("#menu-button").setAttribute("aria-expanded", "false");
}

// ---- Sign in / out ---------------------------------------------------------------

function showAuthGate(errorMessage = "") {
  state.user = null;
  state.tasks = [];
  state.stats = null;
  closeModal();
  closeTaskDrawer();
  closeMenus();
  $("#app-shell").classList.add("hidden");
  $("#auth-gate").classList.remove("hidden");
  $("#auth-status").classList.add("hidden");
  $("#auth-error").textContent = errorMessage;
  $("#auth-error").classList.toggle("hidden", !errorMessage);
  $("#auth-retry").classList.toggle("hidden", !errorMessage || !errorMessage.includes("reach"));
}

async function enterApp(user) {
  state.user = user;
  $("#auth-gate").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  renderUser();
  renderHeading();
  await Promise.all([loadTasks(), loadStats(), loadTags()]);
  if (state.stats?.overdue) {
    showToast(`You have ${plural(state.stats.overdue, "overdue task")}.`, "warning", { actionLabel: "View", onAction: () => setView("overdue") });
  }
}

onUnauthorized(() => {
  if (state.user) showAuthGate("Your session has expired. Please sign in again.");
});

async function initialize() {
  $("#auth-status").classList.remove("hidden");
  $("#auth-error").classList.add("hidden");
  $("#auth-retry").classList.add("hidden");
  try {
    const response = await api("/api/auth/session");
    if (response.user) await enterApp(response.user);
    else showAuthGate();
  } catch (error) {
    showAuthGate(error.message);
  }
}

// ---- Event listeners -------------------------------------------------------------

function bindEvents() {
  initDialogs();

  $$(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$(".stat-card[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $(".brand").addEventListener("click", (event) => { event.preventDefault(); setView("dashboard"); });

  $("#category-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    const category = button.dataset.category;
    Object.assign(state, { view: "all", category: state.category === category ? "" : category, tag: "", date: "" });
    closeSidebar();
    applyFilters();
  });
  $("#tag-cloud").addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag]");
    if (!button) return;
    Object.assign(state, { view: "all", tag: state.tag === button.dataset.tag ? "" : button.dataset.tag, category: "", date: "" });
    closeSidebar();
    applyFilters();
  });

  $$(".filter-tab").forEach((button) => button.addEventListener("click", () => {
    state.status = button.dataset.status;
    if (state.view === "pending" || state.view === "completed") state.view = "all"; // these views already filter by status
    applyFilters();
  }));
  $("#priority-filter").addEventListener("change", (event) => { state.priority = event.target.value; applyFilters(); });
  $("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; applyFilters(); });
  $("#page-size").addEventListener("change", (event) => { state.limit = Number(event.target.value); applyFilters(); });
  $("#order-button").addEventListener("click", () => { state.order = state.order === "asc" ? "desc" : "asc"; applyFilters(); });
  $("#active-filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-clear]");
    if (button) clearFilter(button.dataset.clear);
  });
  $("#priority-bars").addEventListener("click", (event) => {
    const button = event.target.closest("[data-priority]");
    if (!button) return;
    Object.assign(state, { view: "pending", status: "all", priority: button.dataset.priority });
    applyFilters();
  });

  const runSearch = debounce(() => applyFilters(), 300);
  $("#search-input").addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    runSearch();
  });

  $("#previous-page").addEventListener("click", () => {
    if (state.page > 1) { state.page -= 1; applyFilters({ resetPage: false }); $("#task-heading").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
  $("#next-page").addEventListener("click", () => {
    if (state.pagination && state.page < state.pagination.totalPages) { state.page += 1; applyFilters({ resetPage: false }); $("#task-heading").scrollIntoView({ behavior: "smooth", block: "start" }); }
  });

  $("#task-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "retry") return loadTasks();
    if (action === "clear-filters") return clearFilter("all");
    if (action === "new") return openTaskModal();
    const task = findTask(id);
    if (!task) return;
    if (action === "open") return openTaskDrawer(task.id);
    if (action === "edit") return openTaskModal(task);
    if (action === "delete") return deleteTask(task);
    button.disabled = true;
    if (action === "toggle") return toggleComplete(task);
    if (action === "important") return patchTask(task, { important: !task.important }, task.important ? "Removed from important." : "Marked as important ★");
  });

  $("#add-task-button").addEventListener("click", () => openTaskModal());
  $("#quick-add").addEventListener("click", () => openTaskModal());
  $("#quick-filter").addEventListener("click", () => {
    const cycle = ["all", "Pending", "In Progress", "Completed"];
    state.status = cycle[(cycle.indexOf(state.status) + 1) % cycle.length];
    if (state.view === "pending" || state.view === "completed") state.view = "all";
    applyFilters();
    showToast(state.status === "all" ? "Showing all tasks." : `Showing ${state.status.toLowerCase()} tasks.`);
  });
  $("#quick-sort").addEventListener("click", () => {
    state.order = state.order === "asc" ? "desc" : "asc";
    applyFilters();
    showToast(state.order === "asc" ? "Sorted ascending." : "Sorted descending.");
  });
  $("#quick-settings").addEventListener("click", openSettingsModal);

  $("#previous-month").addEventListener("click", () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() - 1); renderCalendar(); loadStats(); });
  $("#next-month").addEventListener("click", () => { state.calendarMonth.setMonth(state.calendarMonth.getMonth() + 1); renderCalendar(); loadStats(); });
  $("#calendar-grid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    const value = button.dataset.date;
    Object.assign(state, { date: state.date === value ? "" : value, view: "all", category: "", tag: "", status: "all" });
    applyFilters();
  });

  $("#project-nav-button").addEventListener("click", () => { closeSidebar(); openProjectModal(); });
  $("#team-link").addEventListener("click", () => openProjectModal("team"));
  $("#settings-menu-button").addEventListener("click", () => { closeMenus(); openSettingsModal(); });
  $("#about-button").addEventListener("click", () => { closeMenus(); openProjectModal(); });
  $("#shortcuts-button").addEventListener("click", () => { closeMenus(); openShortcutsModal(); });
  $("#gate-login").addEventListener("click", () => openAuthModal("login"));
  $("#gate-register").addEventListener("click", () => openAuthModal("register"));
  $("#auth-retry").addEventListener("click", initialize);
  $("#logout-button").addEventListener("click", async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
      showAuthGate();
      showToast("You have been signed out.", "info");
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#profile-button").addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = $("#profile-menu").classList.contains("hidden");
    closeMenus();
    if (opening) {
      $("#profile-menu").classList.remove("hidden");
      $("#profile-button").setAttribute("aria-expanded", "true");
    }
  });
  $("#notifications-button").addEventListener("click", (event) => { event.stopPropagation(); toggleNotifications(); });
  $("#notification-panel").addEventListener("click", (event) => {
    event.stopPropagation();
    const taskButton = event.target.closest("[data-open-task]");
    const viewButton = event.target.closest("[data-view-link]");
    if (taskButton) { closeMenus(); openTaskDrawer(taskButton.dataset.openTask); }
    if (viewButton) { closeMenus(); setView(viewButton.dataset.viewLink); }
  });
  $("#profile-menu").addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", closeMenus);

  $("#menu-button").addEventListener("click", openSidebar);
  $("#sidebar-overlay").addEventListener("click", closeSidebar);
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#modal-close").addEventListener("click", closeModal);
  $("#modal-backdrop").addEventListener("mousedown", (event) => { if (event.target === event.currentTarget) closeModal(); });
  $("#drawer-close").addEventListener("click", closeTaskDrawer);
  $("#drawer-backdrop").addEventListener("click", closeTaskDrawer);

  document.addEventListener("keydown", (event) => {
    if (!$("#confirm-backdrop").classList.contains("hidden")) return; // the confirm dialog handles its own keys
    const typing = event.target.matches("input, textarea, select, [contenteditable]");
    if (event.key === "Escape") {
      if (isModalOpen()) return closeModal();
      if (isDrawerOpen()) return closeTaskDrawer();
      closeMenus();
      closeSidebar();
      return;
    }
    if (!state.user) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      $("#search-input").focus();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || isModalOpen()) return;
    if (event.key === "/") { event.preventDefault(); $("#search-input").focus(); }
    if (event.key.toLowerCase() === "n") { event.preventDefault(); openTaskModal(); }
  });

  // Follow the operating-system theme until the user picks one explicitly.
  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  darkQuery.addEventListener("change", (event) => { if (readStorage(THEME_KEY) === null) applyTheme(event.matches); });

  // When the user returns to this tab, pick up changes made elsewhere and keep "today" correct after midnight.
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { hiddenAt = Date.now(); return; }
    if (!state.user || Date.now() - hiddenAt < 30_000) return;
    renderUser();
    refreshAfterChange();
  });
}

// ---- Start-up ---------------------------------------------------------------------

const savedTheme = readStorage(THEME_KEY);
applyTheme(savedTheme === null ? window.matchMedia("(prefers-color-scheme: dark)").matches : savedTheme === "true");
bindEvents();
initialize();

