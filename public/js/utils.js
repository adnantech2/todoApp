// Small helpers shared by the frontend modules.

export const PRIORITIES = ["Low", "Medium", "High", "Urgent"];
export const STATUSES = ["Pending", "In Progress", "Completed"];
export const DEFAULT_CATEGORIES = ["Work", "Study", "Personal", "Others"];

/** Escapes text before it is inserted into HTML, preventing XSS. */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

/** A Date as YYYY-MM-DD in the user's local time zone. */
export function toDateString(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

/** Today's date (recomputed every call so the app stays correct after midnight). */
export function todayString() {
  return toDateString(new Date());
}

export function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateString(date);
}

export function daysBetween(fromDate, toDate) {
  return Math.round((new Date(`${toDate}T00:00:00`) - new Date(`${fromDate}T00:00:00`)) / 86400000);
}

export function isOverdue(task) {
  return task.status !== "Completed" && task.dueDate < todayString();
}

/** "Today", "Tomorrow", "Yesterday", "3 days overdue", or "Oct 12". */
export function formatDueDate(value) {
  const difference = daysBetween(todayString(), value);
  if (difference === 0) return "Today";
  if (difference === 1) return "Tomorrow";
  if (difference === -1) return "Yesterday";
  const date = new Date(`${value}T00:00:00`);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function formatLongDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

/** "just now", "5 min ago", "3 h ago", or a date. */
export function timeAgo(isoString) {
  if (!isoString) return "";
  const seconds = Math.round((Date.now() - new Date(isoString).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  if (seconds < 7 * 86400) return `${Math.round(seconds / 86400)} d ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function debounce(callback, wait = 250) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), wait);
  };
}

/** A stable colour (0-7) for a category or tag name, so custom names still look distinct. */
export function colorIndex(name) {
  const known = { work: 0, study: 1, personal: 2, others: 3 };
  const key = String(name).toLowerCase();
  if (key in known) return known[key];
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return 4 + (hash % 4);
}

export function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}
