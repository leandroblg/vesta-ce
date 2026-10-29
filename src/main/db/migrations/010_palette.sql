-- HIG identity: the color theme (palette) beside 007's Appearance (theme) row, stored as JSON with
-- updated_at = 0 like the other settings rows, so an exported choice applies over an untouched default.
-- OR IGNORE keeps a value written by a newer build or an import.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('palette', '"hearth"', 0);
