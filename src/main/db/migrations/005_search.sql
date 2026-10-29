-- 006 search (data-model.md, research §4): plain text and folded keys per item, a trigram FTS5 index over
-- the keys, and triggers that keep both in step with every write. The triggers call vesta_search_plain and
-- vesta_search_key, which openDatabase registers. Existing rows are indexed by the background fill
-- (src/main/search/fill.ts), not here, so this migration stays fast.

CREATE TABLE search_docs (
  rowid       INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('task', 'reminder')),
  item_id     TEXT NOT NULL,
  title_plain TEXT NOT NULL,
  body_plain  TEXT NOT NULL,
  title_key   TEXT NOT NULL,
  body_key    TEXT NOT NULL,
  -- 1 while details over 100,000 characters wait for the background fill (research §2); body_* are '' meanwhile.
  pending     INTEGER NOT NULL DEFAULT 0 CHECK (pending IN (0, 1)),
  UNIQUE (kind, item_id)
);

CREATE INDEX search_docs_pending ON search_docs (pending) WHERE pending = 1;

CREATE VIRTUAL TABLE search_fts USING fts5(
  title_key, body_key,
  content = 'search_docs', content_rowid = 'rowid',
  tokenize = 'trigram'
);

-- The standard external-content triggers.
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts (rowid, title_key, body_key) VALUES (new.rowid, new.title_key, new.body_key);
END;

CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts (search_fts, rowid, title_key, body_key) VALUES ('delete', old.rowid, old.title_key, old.body_key);
END;

CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts (search_fts, rowid, title_key, body_key) VALUES ('delete', old.rowid, old.title_key, old.body_key);
  INSERT INTO search_fts (rowid, title_key, body_key) VALUES (new.rowid, new.title_key, new.body_key);
END;

-- Tasks. Upserts, so a row the background fill has not reached yet is indexed by its first write. Details over
-- 100,000 characters are not extracted here (about 220 ms at the limit, research §2): the row is marked pending
-- and the fill extracts them in a worker thread.
CREATE TRIGGER tasks_search_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_docs (kind, item_id, title_plain, body_plain, title_key, body_key, pending)
    SELECT 'task', new.id, p.t, p.b, vesta_search_key(p.t), vesta_search_key(p.b), p.large
    FROM (
      SELECT vesta_search_plain(new.title_md, 'title') AS t,
             CASE WHEN length(new.details_md) > 100000 THEN '' ELSE vesta_search_plain(new.details_md, 'details') END AS b,
             length(new.details_md) > 100000 AS large
    ) AS p
    WHERE true
  ON CONFLICT (kind, item_id) DO UPDATE SET
    title_plain = excluded.title_plain, body_plain = excluded.body_plain,
    title_key = excluded.title_key, body_key = excluded.body_key, pending = excluded.pending;
END;

-- The 001 upsert sets every column, so the guard keeps alert ticks from re-extracting unchanged markdown.
CREATE TRIGGER tasks_search_au AFTER UPDATE OF title_md, details_md ON tasks
WHEN old.title_md IS NOT new.title_md OR old.details_md IS NOT new.details_md
BEGIN
  INSERT INTO search_docs (kind, item_id, title_plain, body_plain, title_key, body_key, pending)
    SELECT 'task', new.id, p.t, p.b, vesta_search_key(p.t), vesta_search_key(p.b), p.large
    FROM (
      SELECT vesta_search_plain(new.title_md, 'title') AS t,
             CASE WHEN length(new.details_md) > 100000 THEN '' ELSE vesta_search_plain(new.details_md, 'details') END AS b,
             length(new.details_md) > 100000 AS large
    ) AS p
    WHERE true
  ON CONFLICT (kind, item_id) DO UPDATE SET
    title_plain = excluded.title_plain, body_plain = excluded.body_plain,
    title_key = excluded.title_key, body_key = excluded.body_key, pending = excluded.pending;
END;

CREATE TRIGGER tasks_search_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM search_docs WHERE kind = 'task' AND item_id = old.id;
END;

-- Reminders: the text is the title; there are no details.
CREATE TRIGGER reminders_search_ai AFTER INSERT ON reminders BEGIN
  INSERT INTO search_docs (kind, item_id, title_plain, body_plain, title_key, body_key)
    SELECT 'reminder', new.id, p.t, '', vesta_search_key(p.t), ''
    FROM (SELECT vesta_search_plain(new.text_md, 'title') AS t) AS p
    WHERE true
  ON CONFLICT (kind, item_id) DO UPDATE SET
    title_plain = excluded.title_plain, body_plain = '', title_key = excluded.title_key, body_key = '', pending = 0;
END;

CREATE TRIGGER reminders_search_au AFTER UPDATE OF text_md ON reminders
WHEN old.text_md IS NOT new.text_md
BEGIN
  INSERT INTO search_docs (kind, item_id, title_plain, body_plain, title_key, body_key)
    SELECT 'reminder', new.id, p.t, '', vesta_search_key(p.t), ''
    FROM (SELECT vesta_search_plain(new.text_md, 'title') AS t) AS p
    WHERE true
  ON CONFLICT (kind, item_id) DO UPDATE SET
    title_plain = excluded.title_plain, body_plain = '', title_key = excluded.title_key, body_key = '', pending = 0;
END;

CREATE TRIGGER reminders_search_ad AFTER DELETE ON reminders BEGIN
  DELETE FROM search_docs WHERE kind = 'reminder' AND item_id = old.id;
END;
