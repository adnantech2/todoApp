// Reusable UI pieces: toasts, the modal dialog, the confirm dialog and the side drawer.
import { escapeHtml } from "./utils.js";

const $ = (selector) => document.querySelector(selector);

// ---- Toast notifications ---------------------------------------------------

const TOAST_ICONS = { success: "✓", error: "!", info: "i", warning: "⚠" };

/**
 * Shows a short message in the corner of the screen.
 * @param {string} message
 * @param {"success"|"error"|"info"|"warning"} type
 * @param {{ actionLabel?: string, onAction?: () => void }} options optional button (e.g. "Undo")
 */
export function showToast(message, type = "info", { actionLabel, onAction } = {}) {
  const region = $("#toast-region");
  // Replace an identical message instead of stacking duplicates.
  [...region.children].find((existing) => existing.dataset.message === message)?.remove();
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.dataset.message = message;
  toast.setAttribute("role", type === "error" ? "alert" : "status");
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] || "i"}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    ${actionLabel ? `<button class="toast-action" type="button">${escapeHtml(actionLabel)}</button>` : ""}
    <button class="toast-close" type="button" aria-label="Dismiss notification">×</button>`;
  const remove = () => {
    toast.classList.remove("visible");
    window.setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector(".toast-close").addEventListener("click", remove);
  if (actionLabel) {
    toast.querySelector(".toast-action").addEventListener("click", () => {
      remove();
      onAction?.();
    });
  }
  region.append(toast);
  while (region.children.length > 3) region.firstElementChild.remove();
  requestAnimationFrame(() => toast.classList.add("visible"));
  window.setTimeout(remove, type === "error" ? 6000 : actionLabel ? 6000 : 3200);
}

// ---- Focus management ------------------------------------------------------

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab / Shift+Tab inside `container` while it is open (for accessibility). */
function trapFocus(container, event) {
  if (event.key !== "Tab") return;
  const items = [...container.querySelectorAll(FOCUSABLE)].filter((item) => item.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// ---- Modal dialog ----------------------------------------------------------

let modalReturnFocus = null;

/** Opens the shared modal and returns its content element. */
export function openModal({ eyebrow, title, html, wide = false }) {
  if ($("#modal-backdrop").classList.contains("hidden")) modalReturnFocus = document.activeElement;
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-title").textContent = title;
  $("#modal").classList.toggle("modal-wide", wide);
  const content = $("#modal-content");
  content.innerHTML = html;
  $("#modal-backdrop").classList.remove("hidden");
  document.body.classList.add("no-scroll");
  return content;
}

export function closeModal() {
  if ($("#modal-backdrop").classList.contains("hidden")) return;
  $("#modal-backdrop").classList.add("hidden");
  $("#modal-content").innerHTML = "";
  if ($("#drawer").classList.contains("hidden")) document.body.classList.remove("no-scroll");
  modalReturnFocus?.focus?.();
}

export function isModalOpen() {
  return !$("#modal-backdrop").classList.contains("hidden");
}

// ---- Confirm dialog (replaces window.confirm) -----------------------------

/** Resolves to true when the user confirms, false when they cancel. */
export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const backdrop = $("#confirm-backdrop");
    const returnFocus = document.activeElement;
    $("#confirm-title").textContent = title;
    $("#confirm-message").textContent = message;
    const okButton = $("#confirm-ok");
    okButton.textContent = confirmLabel;
    okButton.classList.toggle("danger-button", danger);
    okButton.classList.toggle("primary-button", !danger);
    backdrop.classList.remove("hidden");
    okButton.focus();

    const finish = (result) => {
      backdrop.classList.add("hidden");
      okButton.removeEventListener("click", onOk);
      $("#confirm-cancel").removeEventListener("click", onCancel);
      backdrop.removeEventListener("keydown", onKey);
      backdrop.removeEventListener("click", onBackdrop);
      returnFocus?.focus?.();
      resolve(result);
    };
    const onOk = () => finish(true);
    const onCancel = () => finish(false);
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        finish(false);
      }
      trapFocus(backdrop, event);
    };
    const onBackdrop = (event) => { if (event.target === backdrop) finish(false); };
    okButton.addEventListener("click", onOk);
    $("#confirm-cancel").addEventListener("click", onCancel);
    backdrop.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", onBackdrop);
  });
}

// ---- Side drawer (task details) -------------------------------------------

let drawerReturnFocus = null;

export function openDrawer() {
  if ($("#drawer").classList.contains("hidden")) drawerReturnFocus = document.activeElement;
  $("#drawer").classList.remove("hidden");
  $("#drawer-backdrop").classList.remove("hidden");
  document.body.classList.add("no-scroll");
}

export function closeDrawer() {
  if ($("#drawer").classList.contains("hidden")) return;
  $("#drawer").classList.add("hidden");
  $("#drawer-backdrop").classList.add("hidden");
  if (!isModalOpen()) document.body.classList.remove("no-scroll");
  drawerReturnFocus?.focus?.();
}

export function isDrawerOpen() {
  return !$("#drawer").classList.contains("hidden");
}

/** Wires up focus trapping for the modal and drawer. Call once at start-up. */
export function initDialogs() {
  $("#modal-backdrop").addEventListener("keydown", (event) => trapFocus($("#modal"), event));
  $("#drawer").addEventListener("keydown", (event) => trapFocus($("#drawer"), event));
}
