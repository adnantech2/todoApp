-- Migration 002 (PostgreSQL): advanced task features.
-- database/schema.sql already creates the full current table layout
-- (Urgent priority, custom categories, completion timestamps, tags,
-- subtasks, task history, and their indexes), so the only work left here
-- is backfilling completed_at on any task that was marked Completed
-- before that column existed. Kept as a migration file (instead of being
-- folded into schema.sql) so the schema_migrations tracking table, and
-- this script, still have a real step to run.

UPDATE tasks SET completed_at = updated_at WHERE status = 'Completed' AND completed_at IS NULL;
