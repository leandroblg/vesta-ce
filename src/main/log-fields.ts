/**
 * The field names a log entry may carry (009 FR-003, research §4). `tests/unit/main/log-fields.test.ts` fails on
 * any other name, so a new field is a deliberate, reviewed addition: none may hold item text, details, search
 * queries, clipboard content, link addresses or video ids from items, or file names other than one the user
 * picked in that same action.
 */
export const LOG_FIELDS: readonly string[] = [
  "message",
  "stack",
  "ids",
  "id",
  "count",
  "key",
  "kind",
  "issue",
  "action",
  "channel",
  "ms",
  "ok",
  "bytes",
  "sha256",
  "scheme",
  "host",
  "status",
  "reason",
  "version",
  "running",
  "found",
  "releases",
  "url",
  "phase",
  "rows",
  "episodes",
  "files",
  "outcome",
  "nextAt",
  "dataDir",
  "damagedPath",
  "backupAt",
  "moved",
  "to",
  "at",
  "startup",
  "context",
  "code",
  "name",
  "skippedFiles",
  "logs",
  "added",
  "updated",
  "unchanged",
  "lastBackupAt",
  "backupExists",
  "items",
  // 008: an ignored field's path in data.json and the shortcut actions an import dropped (structure, never text).
  "field",
  "actions",
  // 011: how many tasks and reminders the one-time color rewrite changed (numbers only).
  "tasks",
  "reminders",
  // 006: a failed search logs its flags and the text's length, never the text.
  "length",
  "matchCase",
  "exactPhrase",
  "includeArchiveTrash",
  // a stored file's path inside the data folder, written with ~ (assets/<sha256>.<ext>).
  "path",
  // 010: counts and byte sizes only. `changed` rows of the one-time type recomputation (M2); `listedBytes` and
  // `free` of the import free-space check (L10); `clamped` time values of an import (L14).
  "changed",
  "listedBytes",
  "free",
  // 017: what started the run without Chromium's sandbox ("launcher" or "app", FR-006a), and the two schema numbers
  // of a refusal of newer data (FR-015a). Words and numbers only.
  "via",
  "dataVersion",
  "latestVersion",
  // 018 data-model.md "Log events": a cleanup change (which cleanup, its switch, its hours, whether a dialog asked)
  // and the rows each cleanup removed in a purge run. No item text.
  "which",
  "on",
  "hours",
  "confirmed",
  "archive",
  "trash",
];

/** Fields allowed only in some files: the release-list address, and the name of the file the user just picked. */
export const LOG_FIELDS_ONLY_IN: Readonly<Record<string, readonly string[]>> = {
  url: ["src/main/updates/check.ts"],
  name: ["src/main/ipc/handlers.ts"],
  path: ["src/main/assets/locks.ts"],
};

/** Spreads whose source is a known, already-checked object. */
/** `err.refusal` is an import refusal: its kind, cause and a field path (008 contracts/export-format.md). */
export const LOG_SPREADS: readonly string[] = ["issue", "repair", "plan.counts", "err.refusal", "hostOnly(url)", "(stack === null ? {} : { stack })"];
