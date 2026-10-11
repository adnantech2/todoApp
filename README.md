# TodoApp — MUIT BCA Project

A full-stack To-Do List Management System built with **Node.js + Express**, **MySQL**, and a
**vanilla JavaScript** frontend (no build step). Each user has a private, password-protected task list
with priorities, categories, tags, subtasks, due dates, history and a statistics dashboard.

## Features

**Tasks**
- Create, view, edit, complete and delete tasks
- Priority: **Low / Medium / High / Urgent**; status: **Pending / In Progress / Completed**
- Built-in categories (Work, Study, Personal, Others) **plus custom categories**
- **Tags** (`#exam`, `#project`, …), up to 10 per task
- **Subtasks** (checklists) with progress bars
- **Task history** — every change is recorded (status, priority, title, subtasks, …)
- Due dates with **overdue** highlighting, "Today" and "Next 7 days" views
- Mark tasks as important (★)

**Finding tasks**
- Server-side **search** (title, description, tags), **filters** (status, priority, category, tag, due date, important),
  **sorting** (due date, priority, created, updated, title, status) and **pagination**
- Calendar: click a date to see tasks due that day (dots show open / overdue / done tasks)

**Dashboard**
- Totals, completion rate, overdue and due-today counts
- Open tasks by priority, tasks completed in the last 7 days, progress ring
- Reminders panel (🔔) listing overdue tasks and tasks due today

**Experience**
- Responsive layout (desktop, tablet, phone) with a slide-out menu on small screens
- Light/dark mode (follows your system setting until you choose)
- Toast notifications with **Undo** for completing tasks, confirm dialog before deleting
- Loading skeletons, empty states and error states with retry
- Keyboard shortcuts: `Ctrl+K` or `/` search, `N` new task, `Esc` close
- Accessible: keyboard focus styles, focus trapping in dialogs, ARIA labels, skip link, reduced-motion support

**Account & security**
- Register, sign in, sign out, change display name, change password
- bcrypt password hashing, server-side sessions stored in MySQL, session fixation protection
- Rate limiting (sign-in attempts and the whole API), CSRF protection, strict Content-Security-Policy (Helmet)
- Every query is scoped to the signed-in user — users can never see each other's tasks
- Parameterized SQL everywhere; all input validated on the server

## Requirements

- Node.js 20 or newer
- MySQL 5.7.8+ or 8.x/9.x, running locally or on a reachable host

## Setup

1. Install dependencies:

   ```powershell
   npm.cmd install
   ```

2. Create your environment file and edit it:

   ```powershell
   Copy-Item .env.example .env
   ```

   Set `DB_USER`, `DB_PASSWORD` and `DB_NAME`, and replace `SESSION_SECRET` with a random value:

   ```powershell
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Never commit `.env` (it is already in `.gitignore`).

3. Create or upgrade the database:

   ```powershell
   npm.cmd run db:setup
   ```

   This creates the database (if needed), the original tables, and then applies any new migrations from
   `database/migrations/`. It is safe to run again — existing users and tasks are kept.
   **If you used the earlier version of this app, run this command once to upgrade your database.**

4. Start the app and open <http://localhost:3000>:

   ```powershell
   npm.cmd start        # or: npm.cmd run dev   (restarts automatically when files change)
   ```

## Project structure

```
server.js                  Entry point: loads config, connects to MySQL, starts the server
lib/
  app.js                   Builds the Express app (security headers, sessions, routes, errors)
  config.js                Reads and validates environment variables
  database.js              MySQL connection pool (UTC time zone)
  middleware.js            requireUser, CSRF protection, request logging
  http-error.js            HttpError class and small route helpers
  task-validation.js       Validation rules for tasks, subtasks and list queries
  task-query.js            Builds safe SQL for search / filter / sort / pagination
  task-repository.js       All task, tag, subtask, history and statistics SQL
  mysql-session-store.js   Stores login sessions in MySQL
routes/
  auth.js                  /api/auth/* (register, login, logout, profile, password)
  tasks.js                 /api/tasks, /api/tags, /api/stats
database/
  schema.sql               Original (version 1) tables
  migrations/              Numbered upgrade scripts, each applied once
  migrate.js, setup.js     Migration runner and the `npm run db:setup` command
public/                    Frontend (served as static files)
  index.html, styles.css
  js/app.js                State, rendering and event handling
  js/api.js                fetch() wrapper for the JSON API
  js/ui.js                 Toasts, modal, confirm dialog, drawer
  js/utils.js              Dates, HTML escaping and other helpers
  js/synopsis.js           Project synopsis content
test/                      Unit tests + API integration tests
```

## API

All endpoints return JSON. Protected endpoints need the HTTP-only `todo.sid` session cookie
(the browser sends it automatically). Errors look like `{ "error": "message" }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Application and database status |
| `GET` | `/api/auth/session` | Current user (or `null`) |
| `POST` | `/api/auth/register` | `{ name, email, password }` — create account and sign in |
| `POST` | `/api/auth/login` | `{ email, password }` — sign in |
| `POST` | `/api/auth/logout` | Sign out |
| `PATCH` | `/api/auth/profile` | `{ name }` — change display name |
| `POST` | `/api/auth/password` | `{ currentPassword, newPassword }` — change password |
| `GET` | `/api/tasks` | List tasks (see query parameters below) |
| `POST` | `/api/tasks` | Create a task |
| `GET` | `/api/tasks/:id` | One task with `subtaskItems` and `history` |
| `PUT` | `/api/tasks/:id` | Replace all fields of a task |
| `PATCH` | `/api/tasks/:id` | Change only the fields sent, e.g. `{ "status": "Completed" }` |
| `DELETE` | `/api/tasks/:id` | Delete a task (and its subtasks/history) |
| `GET` | `/api/tasks/:id/history` | Change history of a task |
| `POST` | `/api/tasks/:id/subtasks` | `{ title }` — add a subtask |
| `PATCH` | `/api/tasks/:id/subtasks/:subtaskId` | `{ title?, completed? }` |
| `DELETE` | `/api/tasks/:id/subtasks/:subtaskId` | Delete a subtask |
| `GET` | `/api/tags` | The user's tags with task counts |
| `GET` | `/api/stats` | Dashboard numbers (`?today=&from=&to=&tzOffset=`) |

**Task body** (POST/PUT):

```json
{
  "title": "Finish DBMS assignment",
  "description": "ER diagram and normalization",
  "category": "Study",
  "priority": "Urgent",
  "status": "Pending",
  "dueDate": "2026-10-12",
  "important": true,
  "tags": ["exam", "dbms"]
}
```

`tags` is optional (omitting it keeps the existing tags), so clients written for the original API still work.

**`GET /api/tasks` query parameters**

| Parameter | Values |
| --- | --- |
| `search` | Text matched against title, description and tags |
| `status` | `Pending`, `In Progress`, `Completed`, or `active` (not completed) |
| `priority` | `Low`, `Medium`, `High`, `Urgent` |
| `category`, `tag` | Exact category / tag name |
| `due` | `overdue`, `today`, `week` (next 7 days), `upcoming` |
| `date` | `YYYY-MM-DD` — tasks due on that day |
| `important` | `true` |
| `sort` / `order` | `dueDate`, `priority`, `createdAt`, `updatedAt`, `title`, `status` / `asc`, `desc` |
| `page` / `limit` | Page number (default 1) / page size 1–100 (default 20) |
| `today` | The user's local date, used for overdue/today calculations |

Response: `{ "tasks": [...], "pagination": { "page", "limit", "total", "totalPages" } }`.

## Database

| Table | Purpose |
| --- | --- |
| `users` | Accounts (bcrypt password hashes) |
| `tasks` | Tasks; indexed by `(user_id, status, due_date)`, priority, category, created and completed time |
| `tags`, `task_tags` | Per-user tags and the many-to-many link to tasks |
| `subtasks` | Checklist items of a task |
| `task_history` | Audit trail of task changes |
| `sessions` | Server-side login sessions |
| `schema_migrations` | Which migration files have been applied |

To change the schema later, add a new file such as `database/migrations/003_add_reminders.sql`
and run `npm run db:migrate`.

## Tests

```powershell
npm.cmd test
```

Runs the unit tests (validation, SQL builder, config, session store). The API integration tests
run the real app against MySQL and are skipped unless you point them at a server. They create and
**drop** a throwaway database named `todo_integration_test`:

```powershell
$env:TEST_DB_USER="root"; $env:TEST_DB_PASSWORD="your-password"; npm.cmd test
```

## Deployment checklist

- Set `NODE_ENV=production` and serve the app over **HTTPS** (secure cookies are enabled in production).
- Use a long random `SESSION_SECRET` and a dedicated MySQL user with access only to this database.
- The server listens on `127.0.0.1` by default; put it behind a reverse proxy (e.g. Nginx) and set
  `TRUST_PROXY=1`, or set `HOST=0.0.0.0` only with suitable firewall rules.
- Run `npm run db:migrate` after every update, and back up the database regularly.
- Use a process manager (e.g. PM2 or a systemd service) to restart the app if it stops. The server shuts down
  gracefully on `SIGINT`/`SIGTERM`.
- `GET /api/health` returns 503 when the database is unreachable, for uptime monitoring.
- No CORS setup is needed: Express serves the frontend and the API from the same domain, and cross-site
  write requests are rejected. Do not add a CORS package unless the frontend moves to another domain.
- Before running migrations against a database that already holds data, take a backup. Migrations never
  delete users or tasks, but MySQL cannot roll back schema changes if one fails half-way.

## Deploy to Railway

Railway runs the Node.js app and MySQL in one project, provides HTTPS automatically, and redeploys on
every push to GitHub. Express serves both the API and the frontend, so there is only one service to deploy.

1. **GitHub** — push this repository (keep it private). Check first that `.env` is not staged:
   `git status` must not list it.
2. **Project** — on <https://railway.com>, choose *New Project → Deploy from GitHub repo* and pick this
   repository.
3. **Database** — in the project, choose *+ New → Database → MySQL*.
4. **Variables** — open the app service → *Variables* and add:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `HOST` | `0.0.0.0` |
   | `TRUST_PROXY` | `1` |
   | `SESSION_SECRET` | a new value from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `DB_HOST` | `${{MySQL.MYSQLHOST}}` |
   | `DB_PORT` | `${{MySQL.MYSQLPORT}}` |
   | `DB_USER` | `${{MySQL.MYSQLUSER}}` |
   | `DB_PASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
   | `DB_NAME` | `${{MySQL.MYSQLDATABASE}}` |

   Railway sets `PORT` itself. Never reuse your local `SESSION_SECRET` or database password.
5. **Settings → Deploy** — set *Pre-deploy command* to `npm run db:migrate` (applies only new migrations;
   existing data is kept) and *Healthcheck path* to `/api/health`.
6. **Settings → Networking** — click *Generate Domain*. The app is then live at
   `https://<service-name>.up.railway.app`.

**Other hosts.** The same variables work on Render, a VPS, etc. If the MySQL provider requires TLS
(Aiven, TiDB Cloud), also set `DB_SSL=1` and, if the provider gives one, `DB_SSL_CA` (its CA certificate).

## Self-host on a Linux or Windows server

Unzip the project on the server, then install **Node.js 20+** and **MySQL 8**.

1. In the project folder run `npm ci --omit=dev` (Windows: `npm.cmd ci --omit=dev`).
2. Copy `.env.example` to `.env` and set the MySQL values and a new `SESSION_SECRET`.
3. Run `npm run db:setup` once to create the database and tables.
4. Choose how phones will reach the server:

   | Access | `.env` settings |
   |---|---|
   | **HTTPS domain** behind Nginx/Caddy/IIS (recommended) | `NODE_ENV=production`, `HOST=127.0.0.1`, `TRUST_PROXY=1` |
   | **Plain HTTP** by IP, e.g. `http://192.168.1.20:3000` (LAN/testing only) | `NODE_ENV=development`, `HOST=0.0.0.0`, `TRUST_PROXY=0` |

   With `NODE_ENV=production` the sign-in cookie is `Secure`, so sign-in only works over HTTPS. Over
   plain HTTP, sign-in fails unless `NODE_ENV=development`.
5. Keep the app running with PM2 (works on both Linux and Windows):

   ```bash
   npm install -g pm2
   pm2 start server.js --name todo-app
   pm2 save
   pm2 startup          # Linux: run the command it prints. Windows: use the pm2-windows-startup package instead.
   ```

6. Open the port. If you use plain HTTP, open port 3000. Behind a proxy, open only 80 and 443.
   - Linux: `sudo ufw allow 80,443/tcp`
   - Windows: `New-NetFirewallRule -DisplayName "TodoApp" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow`
   - Cloud VMs need the same port opened in the provider's security group/firewall.

**HTTPS with Caddy (Linux).** Point your domain's DNS A record at the server, install Caddy, and put this
in `/etc/caddy/Caddyfile`. Caddy gets and renews the certificate automatically:

```
todo.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then run `sudo systemctl reload caddy`.

### After deploying

- [ ] `https://<your-domain>/api/health` returns `{"status":"ok","database":"ok"}`
- [ ] The site loads over HTTPS (padlock shown)
- [ ] Register → sign out → sign in works, and you stay signed in after a refresh
- [ ] Create, edit, complete and delete a task; tags, filters and stats update
- [ ] A second account cannot see the first account's tasks
- [ ] In DevTools → Application → Cookies, `todo.sid` is marked `Secure` and `HttpOnly`
- [ ] The deploy logs show no errors and no `TRUST_PROXY` warning
