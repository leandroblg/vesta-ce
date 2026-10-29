-- Feature 002: reminders and the PRD B2 settings table (data-model.md).

CREATE TABLE reminders (
  id              TEXT PRIMARY KEY,
  text_md         TEXT NOT NULL,
  position        REAL NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  done_at         INTEGER NULL,
  deleted_at      INTEGER NULL,
  prev_sibling_id TEXT NULL,
  next_sibling_id TEXT NULL,
  CHECK (done_at IS NULL OR deleted_at IS NULL)
);

CREATE INDEX reminders_position ON reminders (position);
CREATE INDEX reminders_done_at ON reminders (done_at);
CREATE INDEX reminders_deleted_at ON reminders (deleted_at);

-- Only `remindersCollapsed` in this feature; feature 007 adds the other settings.
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
