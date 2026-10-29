-- 010 settings (data-model.md "Database", PRD Q133): the update reminder while automatic checks are off,
-- stored as JSON with updated_at = 0 like 006's and 007's rows. OR IGNORE keeps a value written by a newer
-- build or an import. The local `updateReminderAnchor` and `assetTypesRecomputed` rows are written on demand.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('updateReminder', 'true', 0),
  ('updateReminderDays', '30', 0);
