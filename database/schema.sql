-- PostgreSQL schema. This file creates the full current table layout
-- (the original tables plus everything migrations/002_advanced_tasks.sql
-- used to add under MySQL) so a fresh database is ready in one pass.
-- migrate() still runs migrations/*.sql afterwards for any data backfill.

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT uq_users_email UNIQUE (email)
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  description TEXT NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'Work',
  priority VARCHAR(10) NOT NULL DEFAULT 'Medium' CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent')),
  status VARCHAR(15) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed')),
  due_date DATE NOT NULL,
  important BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  updated_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_due_date ON tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due ON tasks (user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_user_priority ON tasks (user_id, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_user_category ON tasks (user_id, category);
CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON tasks (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed ON tasks (user_id, completed_at);

CREATE TABLE IF NOT EXISTS tags (
  tag_id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  name VARCHAR(30) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc'),
  CONSTRAINT uq_tags_user_name UNIQUE (user_id, name)
);

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INTEGER NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_tag ON task_tags (tag_id);

CREATE TABLE IF NOT EXISTS subtasks (
  subtask_id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
  title VARCHAR(150) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_position ON subtasks (task_id, position);

CREATE TABLE IF NOT EXISTS task_history (
  history_id BIGSERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks (task_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (user_id) ON DELETE CASCADE,
  action VARCHAR(30) NOT NULL,
  details TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT (now() AT TIME ZONE 'utc')
);
CREATE INDEX IF NOT EXISTS idx_task_history_task_created ON task_history (task_id, created_at);

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) PRIMARY KEY,
  expires BIGINT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires);
