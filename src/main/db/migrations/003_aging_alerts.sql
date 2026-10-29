-- Feature 003: task alert fields and the three alert settings (data-model.md).

ALTER TABLE tasks ADD COLUMN alert_period_override_min INTEGER NULL
  CHECK (alert_period_override_min IS NULL OR alert_period_override_min >= 60);
-- NOT NULL needs a default for existing rows; it is set from created_at just below.
ALTER TABLE tasks ADD COLUMN stale_base_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN stale_since INTEGER NULL;
ALTER TABLE tasks ADD COLUMN was_stale INTEGER NOT NULL DEFAULT 0 CHECK (was_stale IN (0, 1));
ALTER TABLE tasks ADD COLUMN last_blink_at INTEGER NULL;
ALTER TABLE tasks ADD COLUMN first_blink_count INTEGER NULL
  CHECK (first_blink_count IS NULL OR first_blink_count IN (1, 3));
ALTER TABLE tasks ADD COLUMN manually_positioned INTEGER NOT NULL DEFAULT 0 CHECK (manually_positioned IN (0, 1));
-- Subtasks only: when the collapsed parent last blinked for this hidden subtask (FR-021a).
ALTER TABLE tasks ADD COLUMN last_signal_at INTEGER NULL;

UPDATE tasks SET stale_base_at = created_at;

-- updated_at 0 = a default never edited, so feature 008's newest-edit merge prefers any real edit.
INSERT INTO settings (key, value, updated_at) VALUES
  ('alertPeriodMin', '1440', 0),
  ('reblinkIntervalMin', '240', 0),
  ('rescheduleToleranceMin', '1440', 0);
