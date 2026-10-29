-- 015 review follow-ups (PRD Q206, Q207, Q210, Q214–Q217): the duration of a task's last reschedule (null = the
-- reschedule tolerance applies) and the per-task history, written with the change that causes it. Existing tasks get
-- no events; their history is derived from their stored dates (research §3, FR-024).
ALTER TABLE tasks ADD COLUMN reschedule_for_min INTEGER;

CREATE TABLE task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('created', 'stale', 'unstale', 'rescheduled', 'override_set', 'override_changed',
                                     'override_cleared', 'done', 'trashed', 'restored')),
  at INTEGER NOT NULL,
  detail INTEGER
);
CREATE INDEX task_events_task ON task_events (task_id, at);

-- The four quick reschedule durations (Q207), seeded like 003's alert settings: updated_at = 0, so an exported choice
-- applies over an untouched default; OR IGNORE keeps a value written by a newer build or an import.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('quickReschedule1Min', '60', 0),
  ('quickReschedule2Min', '120', 0),
  ('quickReschedule3Min', '240', 0),
  ('quickReschedule4Min', '360', 0);
