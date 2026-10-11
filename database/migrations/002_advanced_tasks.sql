-- Migration 002: advanced task features.
-- Adds the Urgent priority, custom categories, completion timestamps,
-- tags, subtasks, task history, and indexes for filtered/sorted queries.
-- Existing users and tasks are preserved.

ALTER TABLE tasks
  MODIFY category VARCHAR(40) NOT NULL DEFAULT 'Work',
  MODIFY priority ENUM('Low', 'Medium', 'High', 'Urgent') NOT NULL DEFAULT 'Medium',
  ADD COLUMN completed_at DATETIME NULL DEFAULT NULL AFTER important,
  DROP KEY idx_tasks_user_status,
  ADD KEY idx_tasks_user_status_due (user_id, status, due_date),
  ADD KEY idx_tasks_user_priority (user_id, priority),
  ADD KEY idx_tasks_user_category (user_id, category),
  ADD KEY idx_tasks_user_created (user_id, created_at),
  ADD KEY idx_tasks_user_completed (user_id, completed_at);

UPDATE tasks SET completed_at = updated_at WHERE status = 'Completed' AND completed_at IS NULL;

CREATE TABLE IF NOT EXISTS tags (
  tag_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(30) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tag_id),
  UNIQUE KEY uq_tags_user_name (user_id, name),
  CONSTRAINT fk_tags_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_tags (
  task_id INT UNSIGNED NOT NULL,
  tag_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (task_id, tag_id),
  KEY idx_task_tags_tag (tag_id),
  CONSTRAINT fk_task_tags_task FOREIGN KEY (task_id)
    REFERENCES tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT fk_task_tags_tag FOREIGN KEY (tag_id)
    REFERENCES tags (tag_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subtasks (
  subtask_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id INT UNSIGNED NOT NULL,
  title VARCHAR(150) NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  position INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (subtask_id),
  KEY idx_subtasks_task_position (task_id, position),
  CONSTRAINT fk_subtasks_task FOREIGN KEY (task_id)
    REFERENCES tasks (task_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS task_history (
  history_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  task_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  action VARCHAR(30) NOT NULL,
  details TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (history_id),
  KEY idx_task_history_task_created (task_id, created_at),
  CONSTRAINT fk_task_history_task FOREIGN KEY (task_id)
    REFERENCES tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT fk_task_history_user FOREIGN KEY (user_id)
    REFERENCES users (user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
