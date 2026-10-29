-- 018 release preparation (PRD Q272, Q273, Q278, Q281; data-model.md "Migration 012"). A done item sent from the
-- Archive to the Trash keeps its completion date here, since the CHECK refuses a row both done and deleted; the two
-- automatic cleanups are seeded like the other settings: updated_at = 0, so an exported choice applies over an
-- untouched default, and OR IGNORE keeps a value written by a newer build or an import.
ALTER TABLE tasks ADD COLUMN kept_done_at INTEGER NULL;
ALTER TABLE reminders ADD COLUMN kept_done_at INTEGER NULL;

INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('archiveCleanupOn', 'true', 0),
  ('archiveCleanupHours', '87600', 0),
  ('trashCleanupOn', 'true', 0),
  ('trashCleanupHours', '720', 0);
