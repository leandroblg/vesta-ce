-- 009 settings (data-model.md "Database"): the log level and the automatic update check, stored as JSON with
-- updated_at = 0 like 006's rows, so a missing row means damage, not a first run. OR IGNORE keeps a value
-- written by a newer build or an import. The local `updateNotice` row is written only on the first announcement.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('logLevel', '"info"', 0),
  ('autoUpdateCheck', 'true', 0);
