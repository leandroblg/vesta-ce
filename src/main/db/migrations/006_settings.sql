-- 007 settings (data-model.md, research §7): theme, language and the shortcut overrides, stored as JSON with
-- updated_at = 0, so a missing row means damage, not a first run (as for 003's alert settings). OR IGNORE
-- keeps a value written by a newer build or an import.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('theme', '"system"', 0),
  ('language', '"system"', 0),
  ('shortcuts', '{}', 0);
