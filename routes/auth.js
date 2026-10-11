const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { HttpError, asyncRoute } = require("../lib/http-error");
const { requireUser } = require("../lib/middleware");

const BCRYPT_ROUNDS = 12;
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("todoapp-account-not-found", BCRYPT_ROUNDS);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function publicUser(user) {
  return { id: user.user_id, name: user.name, email: user.email };
}

function validateName(name) {
  if (name.length < 2 || name.length > 100) return "Name must be between 2 and 100 characters.";
  return null;
}

/** New passwords need 8+ characters with at least one letter and one number. bcrypt reads at most 72 bytes. */
function validateNewPassword(password) {
  if (typeof password !== "string" || password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return "Password must be at least 8 characters and no more than 72 UTF-8 bytes.";
  }
  if (!/\p{L}/u.test(password) || !/\p{N}/u.test(password)) return "Password must contain at least one letter and one number.";
  return null;
}

/** Starts a fresh session (new id) for the user to prevent session fixation. */
function startSession(request, user) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) return reject(error);
      request.session.user = publicUser(user);
      request.session.save((saveError) => (saveError ? reject(saveError) : resolve(request.session.user)));
    });
  });
}

function createAuthRouter({ db, config }) {
  const router = express.Router();
  const limiterOptions = {
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: "Too many sign-in attempts. Please wait a few minutes and try again." },
  };
  const registerRateLimit = rateLimit(limiterOptions);
  // Only failed sign-ins count towards the limit, so normal users are never locked out.
  const loginRateLimit = rateLimit({ ...limiterOptions, skipSuccessfulRequests: true });

  router.get("/session", (request, response) => {
    response.json({ user: request.session.user || null });
  });

  router.post("/register", registerRateLimit, asyncRoute(async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = request.body?.password;
    const nameError = validateName(name);
    if (nameError) throw new HttpError(400, nameError);
    if (email.length > 100 || !EMAIL_PATTERN.test(email)) throw new HttpError(400, "Enter a valid email address.");
    const passwordError = validateNewPassword(password);
    if (passwordError) throw new HttpError(400, passwordError);

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let result;
    try {
      [result] = await db.execute(
        "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
        [name, email, passwordHash],
      );
    } catch (error) {
      if (error.code === "ER_DUP_ENTRY") throw new HttpError(409, "An account with this email already exists.");
      throw error;
    }
    const user = await startSession(request, { user_id: result.insertId, name, email });
    response.status(201).json({ user });
  }));

  router.post("/login", loginRateLimit, asyncRoute(async (request, response) => {
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = request.body?.password;
    if (!email || typeof password !== "string" || email.length > 100 || Buffer.byteLength(password, "utf8") > 72) {
      throw new HttpError(400, "Enter your email and password.");
    }
    const [rows] = await db.execute(
      "SELECT user_id, name, email, password_hash FROM users WHERE email = ? LIMIT 1",
      [email],
    );
    const account = rows[0];
    // Compare against a dummy hash when the email is unknown so response times do not reveal which emails exist.
    const passwordMatches = await bcrypt.compare(password, account?.password_hash || DUMMY_PASSWORD_HASH);
    if (!account || !passwordMatches) throw new HttpError(401, "Email or password is incorrect.");
    const user = await startSession(request, account);
    response.json({ user });
  }));

  router.post("/logout", requireUser, (request, response, next) => {
    request.session.destroy((error) => {
      if (error) return next(error);
      response.clearCookie("todo.sid", { httpOnly: true, sameSite: "lax", secure: config.isProduction });
      response.status(204).end();
    });
  });

  router.patch("/profile", requireUser, asyncRoute(async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name.trim() : "";
    const nameError = validateName(name);
    if (nameError) throw new HttpError(400, nameError);
    await db.execute("UPDATE users SET name = ? WHERE user_id = ?", [name, request.session.user.id]);
    request.session.user = { ...request.session.user, name };
    response.json({ user: request.session.user });
  }));

  router.post("/password", requireUser, registerRateLimit, asyncRoute(async (request, response) => {
    const { currentPassword, newPassword } = request.body || {};
    if (typeof currentPassword !== "string" || Buffer.byteLength(currentPassword, "utf8") > 72) {
      throw new HttpError(400, "Enter your current password.");
    }
    const passwordError = validateNewPassword(newPassword);
    if (passwordError) throw new HttpError(400, passwordError);
    const [rows] = await db.execute("SELECT password_hash FROM users WHERE user_id = ? LIMIT 1", [request.session.user.id]);
    if (!rows[0] || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw new HttpError(400, "Your current password is incorrect.");
    }
    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await db.execute("UPDATE users SET password_hash = ? WHERE user_id = ?", [passwordHash, request.session.user.id]);
    response.status(204).end();
  }));

  return router;
}

module.exports = { createAuthRouter, validateNewPassword };
