-- 011 settings (data-model.md "Database"): the color picker's pinned and recent colors and the order of table
-- sizes, stored as JSON with updated_at = 0 like 006 to 008's rows, so an exported choice applies over an
-- untouched default. OR IGNORE keeps a value written by a newer build or an import. The local
-- `colorsRewritten` row is written on demand by the one-time color rewrite.
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES
  ('pinnedColors', '[]', 0),
  ('recentColors', '[]', 0),
  ('tableRowsFirst', 'false', 0);
