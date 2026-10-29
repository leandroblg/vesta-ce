-- Feature 001: tasks and schema version (data-model.md).

CREATE TABLE schema_version (
  version INTEGER NOT NULL
);

CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,
  parent_id       TEXT NULL REFERENCES tasks(id) ON DELETE SET NULL,
  title_md        TEXT NOT NULL,
  position        REAL NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  done_at         INTEGER NULL,
  deleted_at      INTEGER NULL,
  collapsed       INTEGER NOT NULL DEFAULT 0,
  prev_sibling_id TEXT NULL,
  next_sibling_id TEXT NULL,
  left_with_id    TEXT NULL,
  CHECK (done_at IS NULL OR deleted_at IS NULL),
  CHECK (collapsed IN (0, 1))
);

CREATE INDEX tasks_parent_position ON tasks (parent_id, position);
CREATE INDEX tasks_done_at ON tasks (done_at);
CREATE INDEX tasks_deleted_at ON tasks (deleted_at);
CREATE INDEX tasks_left_with ON tasks (left_with_id);

-- One level only (FR-015): a parent must itself be top level.
CREATE TRIGGER tasks_one_level_insert
BEFORE INSERT ON tasks
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM tasks WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'tasks_one_level: a subtask cannot have subtasks');
END;

CREATE TRIGGER tasks_one_level_update
BEFORE UPDATE OF parent_id ON tasks
WHEN NEW.parent_id IS NOT NULL
  AND (SELECT parent_id FROM tasks WHERE id = NEW.parent_id) IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'tasks_one_level: a subtask cannot have subtasks');
END;
