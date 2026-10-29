-- Feature 005: task details, stored files and backup locks (data-model.md).

ALTER TABLE tasks ADD COLUMN details_md TEXT NOT NULL DEFAULT '';

-- Stored files, named by content hash: <data folder>/assets/<sha256>[.<ext>] (FR-027, FR-032).
CREATE TABLE assets (
  sha256     TEXT PRIMARY KEY NOT NULL
             CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  ext        TEXT NOT NULL CHECK (length(ext) <= 16 AND ext NOT GLOB '*[^a-z0-9]*'),
  mime_type  TEXT NOT NULL,
  size       INTEGER NOT NULL CHECK (size >= 0 AND size <= 104857600),
  created_at INTEGER NOT NULL,
  -- The "removed from system" tag (FR-032a): unreferenced, but a backup still lists it.
  removed_at INTEGER NULL
);

-- Backup locks (FR-032a): which stored files each backup references, by relative paths.
CREATE TABLE backup_assets (
  backup TEXT NOT NULL CHECK (backup LIKE 'backups/%'),
  path   TEXT NOT NULL CHECK (path LIKE 'assets/%' AND length(path) BETWEEN 71 AND 88),
  PRIMARY KEY (backup, path)
);

-- updated_at 0 = a default never edited (as 003).
INSERT INTO settings (key, value, updated_at) VALUES ('panelWidth', '420', 0);
