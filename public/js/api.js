// Thin wrapper around fetch() for the TodoApp JSON API.

let handleUnauthorized = () => {};

/** Registers a callback that runs when the server says the session has expired. */
export function onUnauthorized(callback) {
  handleUnauthorized = callback;
}

/**
 * Sends a request to the API and returns the parsed JSON body (or null for 204).
 * Throws an Error with a user-friendly message when the request fails.
 */
export async function api(url, { method = "GET", body, signal } = {}) {
  const options = { method, credentials: "same-origin", headers: { Accept: "application/json" }, signal };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Cannot reach the TodoApp server. Check that it is running and try again.");
  }
  if (response.status === 204) return null;

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new Error(`The server returned an unexpected response (${response.status}).`);
  }
  if (response.status === 401 && !url.startsWith("/api/auth/login") && !url.startsWith("/api/auth/session")) {
    handleUnauthorized();
  }
  if (!response.ok) throw new Error(data?.error || `The request failed (${response.status}).`);
  return data;
}

/** Builds "/path?a=1&b=2", skipping empty values. */
export function withQuery(path, params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== "" && value !== undefined && value !== null && value !== false) query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
