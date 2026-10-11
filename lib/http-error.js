/** An error with an HTTP status code and a message that is safe to show to users. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.expose = true;
  }
}

/** Wraps an async route so rejected promises reach the Express error handler. */
function asyncRoute(handler) {
  return (request, response, next) => Promise.resolve(handler(request, response, next)).catch(next);
}

/** Parses a positive integer route parameter such as :id, or throws a 400 error. */
function parseId(value, label = "task") {
  const id = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(id) || id < 1) {
    throw new HttpError(400, `Invalid ${label} identifier.`);
  }
  return id;
}

module.exports = { HttpError, asyncRoute, parseId };
