/** Payload shape checks run by main before any handler touches a payload (constitution II). */
import { CLEANUP_LIMITS } from "../domain/cleanup";
import type { InvokeChannel, Req } from "./ipc-contract";
import { ALERT_LIMITS, ALERT_SETTING_KEYS } from "../domain/alert-settings";
import { isLanguageSetting } from "../domain/language";
import {
  MAX_DETAILS_CHARS,
  MAX_FILE_NAME_CHARS,
  MAX_LOG_CONTEXT_CHARS,
  MAX_LOG_MESSAGE_CHARS,
  MAX_LOG_STACK_CHARS,
  MAX_PATH_CHARS,
  MAX_PINNED_COLORS,
  MAX_RECENT_COLORS,
  MAX_REMINDER_CHARS,
  MAX_SEARCH_CHARS,
  MAX_TITLE_CHARS,
  MAX_TOKEN_CHARS,
  MAX_URL_CHARS,
  OVERRIDE_MAX_MINUTES,
  OVERRIDE_MIN_MINUTES,
} from "../domain/limits";
import { isLogLevel } from "../domain/logs/levels";
import { isColorList, isHex8 } from "../domain/markdown/colors";
import { isPaletteSetting, isReminderDays, isThemeSetting } from "../domain/settings";
import { SHORTCUT_ACTIONS, isActionId } from "../domain/shortcuts/actions";
import { MAX_SNAPSHOT_IDS, SNAPSHOT_IDS, TABLE_ACTION_IDS, VALID_HEADINGS } from "../domain/menu/state";

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type FieldCheck = (v: unknown) => boolean;

const isId: FieldCheck = (v) => typeof v === "string" && UUID.test(v);
const isString: FieldCheck = (v) => typeof v === "string";
const isBool: FieldCheck = (v) => typeof v === "boolean";
const isIdOrNull: FieldCheck = (v) => v === null || isId(v);
// 010 L1 (contracts/ipc.md "String limits"): every text field has a limit, from the one limits module.
const textUpTo =
  (max: number): FieldCheck =>
  (v) =>
    typeof v === "string" && v.length <= max;
const isTitle = textUpTo(MAX_TITLE_CHARS);
const isReminderText = textUpTo(MAX_REMINDER_CHARS);
const isLogMessage = textUpTo(MAX_LOG_MESSAGE_CHARS);
const isLogStack: FieldCheck = (v) => v === null || (typeof v === "string" && v.length <= MAX_LOG_STACK_CHARS);
const isLogContext = textUpTo(MAX_LOG_CONTEXT_CHARS);
const isToken = textUpTo(MAX_TOKEN_CHARS);
/** 016 contracts/ipc.md: what the clipboard may receive, the details limit. */
const MAX_CLIPBOARD_CHARS = 1_000_000;
const isClipboardText = textUpTo(MAX_CLIPBOARD_CHARS);
/** An alert override in minutes: null (follow the global default) or 60 to 9999 d 23 h 59 min (003 FR-035). */
const isOverrideMinutes: FieldCheck = (v) =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= OVERRIDE_MIN_MINUTES && v <= OVERRIDE_MAX_MINUTES);

// 005 limits (contracts/ipc.md).
const MAX_DETAILS = MAX_DETAILS_CHARS;
const MAX_FILE_BYTES = 104_857_600;
const ASSET_REF = /^assets\/[0-9a-f]{64}(?:\.[a-z0-9]{1,16})?$/;
const ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;
const WEB_URL = /^(?:https?:\/\/|mailto:)\S+$/i;

const isDetails: FieldCheck = (v) => typeof v === "string" && v.length <= MAX_DETAILS;
const isFileName: FieldCheck = (v) => typeof v === "string" && v.length >= 1 && v.length <= MAX_FILE_NAME_CHARS;
const isFileBytes: FieldCheck = (v) => v instanceof Uint8Array && v.byteLength <= MAX_FILE_BYTES;
const isAssetScope: FieldCheck = (v) => v === "title" || v === "details";
// An absolute path, or a `file:` URL to one (FR-027a); main converts the URL.
const isAbsolutePath: FieldCheck = (v) =>
  typeof v === "string" && v.length <= MAX_PATH_CHARS && !v.includes("\u0000") && (ABSOLUTE_PATH.test(v) || /^file:\/\//i.test(v));
const isAssetRef: FieldCheck = (v) => typeof v === "string" && ASSET_REF.test(v);
const isWebUrl: FieldCheck = (v) => typeof v === "string" && v.length <= MAX_URL_CHARS && WEB_URL.test(v);
// 006 limits (contracts/ipc.md).
const MAX_SEARCH_TEXT = MAX_SEARCH_CHARS;
const isSeq: FieldCheck = (v) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isSearchText: FieldCheck = (v) => typeof v === "string" && v.length <= MAX_SEARCH_TEXT;
const isPanelWidth: FieldCheck = (v) => typeof v === "number" && Number.isInteger(v) && v >= 300 && v <= 760;
// 007 limits (contracts/ipc.md). The minutes are checked against the key's limits in the handler.
const isAlertKey: FieldCheck = (v) => typeof v === "string" && (ALERT_SETTING_KEYS as readonly string[]).includes(v);
/** 015 FR-008: a reschedule's quick duration, or null for the reschedule tolerance. */
const isQuickMinutesOrNull: FieldCheck = (v) =>
  v === null || (typeof v === "number" && Number.isInteger(v) && v >= ALERT_LIMITS.quickReschedule1Min.min && v <= ALERT_LIMITS.quickReschedule1Min.max);
const isMinutes: FieldCheck = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= Math.max(...Object.values(ALERT_LIMITS).map((l) => l.max));
const isOverrides: FieldCheck = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const entries = Object.entries(v as Record<string, unknown>);
  return (
    entries.length <= SHORTCUT_ACTIONS.length &&
    entries.every(
      ([k, combos]) =>
        isActionId(k) &&
        Array.isArray(combos) &&
        combos.length >= 1 &&
        combos.length <= 2 &&
        combos.every((c) => typeof c === "string" && c.length >= 1 && c.length <= 40),
    )
  );
};

/** 013 contracts/ipc.md: an enum value. */
const oneOf =
  (...values: readonly string[]): FieldCheck =>
  (v) =>
    typeof v === "string" && values.includes(v);
/** At most `max` elements, each one of the known ids. */
const idList =
  (known: readonly string[], max: number): FieldCheck =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && known.includes(x));

/** An object with exactly these keys, each passing its check. */
function exactly(shape: Record<string, FieldCheck>): FieldCheck {
  return (v) => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
    const record = v as Record<string, unknown>;
    const keys = Object.keys(record);
    const expected = Object.keys(shape);
    // 010 L1: a key counts only as the payload's own property.
    return keys.length === expected.length && expected.every((k) => Object.hasOwn(record, k) && (shape[k] as FieldCheck)(record[k]));
  };
}

// 013 contracts/ipc.md "menu:set-state": every field by its enum, type or id list.
const isTarget: FieldCheck = (v) =>
  v === null || exactly({ kind: oneOf("task", "subtask", "reminder"), topLevel: isBool, stale: isBool })(v);
const isFormatSnapshot: FieldCheck = (v) =>
  v === null ||
  exactly({
    offered: idList(SNAPSHOT_IDS, MAX_SNAPSHOT_IDS),
    pressed: idList(SNAPSHOT_IDS, MAX_SNAPSHOT_IDS),
    disabled: idList(SNAPSHOT_IDS, MAX_SNAPSHOT_IDS),
    heading: (h) => typeof h === "number" && VALID_HEADINGS.includes(h),
    inTable: isBool,
    tableActions: idList(TABLE_ACTION_IDS, TABLE_ACTION_IDS.length),
  })(v);
const isSearchFlags = exactly({ active: isBool, everything: isBool, matchCase: isBool, exactPhrase: isBool });

// 009 contracts/ipc.md: a log cursor names a log file, never a path.
const LOG_FILE = /^vesta-\d{3}\.log$/;
const isLogCursor: FieldCheck = (v) =>
  v === null ||
  exactly({
    file: (f) => typeof f === "string" && LOG_FILE.test(f),
    offset: (o) => typeof o === "number" && Number.isSafeInteger(o) && o >= 0,
  })(v);

/** A MoveDest (004 contracts/ipc.md): top, sub or group, each with exactly its own keys. */
const isMoveDest: FieldCheck = (v) => {
  const kind = typeof v === "object" && v !== null ? (v as { kind?: unknown }).kind : undefined;
  if (kind === "top") return exactly({ kind: isString, beforeId: isIdOrNull })(v);
  if (kind === "sub") return exactly({ kind: isString, parentId: isId, beforeId: isIdOrNull })(v);
  if (kind === "group") return exactly({ kind: isString })(v);
  return false;
};

const SHAPES: Record<InvokeChannel, Record<string, FieldCheck> | null> = {
  "app:get-initial-state": null,
  "app:flush-done": null,
  "app:log-error": { message: isLogMessage, stack: isLogStack, context: isLogContext },
  "tasks:create": { title: isTitle, parentId: isIdOrNull },
  "tasks:edit-title": { id: isId, title: isTitle },
  "tasks:set-collapsed": { id: isId, collapsed: isBool },
  "tasks:mark-done": { id: isId },
  "tasks:delete": { id: isId },
  "tasks:restore": { id: isId },
  "tasks:delete-permanently": { id: isId },
  "tasks:reschedule": { id: isId, forMin: isQuickMinutesOrNull },
  "tasks:history": { id: isId },
  "tasks:set-alert-override": { id: isId, minutes: isOverrideMinutes },
  "tasks:move": { id: isId, dest: isMoveDest },
  "alerts:tick": { visible: isBool },
  "reminders:create": { text: isReminderText },
  "reminders:edit-text": { id: isId, text: isReminderText },
  "reminders:set-collapsed": { collapsed: isBool },
  "reminders:mark-done": { id: isId },
  "reminders:delete": { id: isId },
  "reminders:restore": { id: isId },
  "reminders:delete-permanently": { id: isId },
  "reminders:move": { id: isId, beforeId: isIdOrNull },
  "undo:apply": { token: isToken },
  "undo:redo": { token: isToken },
  "tasks:edit-details": { id: isId, details: isDetails },
  "assets:import-bytes": { name: isFileName, bytes: isFileBytes, scope: isAssetScope },
  "assets:pick": { scope: isAssetScope },
  "assets:import-path": { path: isAbsolutePath, scope: isAssetScope },
  "assets:open": { ref: isAssetRef },
  "assets:reveal": { ref: isAssetRef },
  "clipboard:write": { text: isClipboardText, html: (v) => v === null || isClipboardText(v) },
  "app:open-external": { url: isWebUrl },
  "settings:set-panel-width": { px: isPanelWidth },
  "search:query": { seq: isSeq, text: isSearchText, matchCase: isBool, exactPhrase: isBool, includeArchiveTrash: isBool },
  "settings:set-alert": { key: isAlertKey, minutes: isMinutes },
  "settings:set-theme": { theme: isThemeSetting },
  "settings:set-palette": { palette: isPaletteSetting },
  "settings:set-language": { setting: isLanguageSetting },
  "settings:set-shortcuts": { overrides: isOverrides },
  "window:minimize": null,
  "keys:set-capture": { on: isBool },
  "data:export": { includeLogs: isBool },
  "data:import": null,
  "data:undo-import": { token: isToken },
  "data:end-undo-offer": null,
  "logs:read": { cursor: isLogCursor, level: isLogLevel },
  "logs:watch": { on: isBool, level: isLogLevel },
  "settings:set-log-level": { level: isLogLevel },
  "settings:set-auto-update-check": { on: isBool },
  "settings:set-update-reminder": { on: isBool },
  "settings:set-update-reminder-days": { days: isReminderDays },
  "settings:set-color-lists": {
    pinned: (v) => v === null || isColorList(v, MAX_PINNED_COLORS),
    recent: (v) => v === null || isColorList(v, MAX_RECENT_COLORS),
    pinnedNow: (v) => v === null || isHex8(v),
  },
  "settings:set-table-rows-first": { on: isBool },
  "settings:set-last-text-color": { hex: isHex8 },
  "settings:set-cleanup": {
    which: (v) => v === "archive" || v === "trash",
    on: isBool,
    hours: (v) => typeof v === "number" && Number.isInteger(v) && v >= CLEANUP_LIMITS.minTotalHours && v <= CLEANUP_LIMITS.maxTotalHours,
    commit: isBool,
  },
  "cleanup:status": null,
  "updates:check": null,
  "updates:pane-shown": { shown: isBool },
  "menu:set-state": {
    view: oneOf("tasks", "archive", "trash"),
    target: isTarget,
    editing: oneOf("none", "text", "title", "reminder", "details"),
    format: isFormatSnapshot,
    remindersExpanded: isBool,
    panelOpen: isBool,
    search: isSearchFlags,
    modal: oneOf("none", "settings", "about", "transient"),
    busy: isBool,
    remindersFull: isBool,
    undoOffered: isBool,
    redoOffered: isBool,
    linkAtCursor: isBool,
  },
  "dialog:confirm-delete-forever": { title: isTitle },
  "app:open-help": { target: (v) => v === "readme" || v === "release" },
  "updates:open": { target: (v) => v === "file" || v === "release" },
};

/** Rules across fields, run after the per-field checks. */
const REFINE: Partial<Record<InvokeChannel, (record: Record<string, unknown>) => boolean>> = {
  // 011 contracts/ipc.md: at least one list; no color in both; a just-pinned color is in the pinned list (016 FR-028:
  // a drop pins it where it lands, not only first).
  "settings:set-color-lists": (r) => {
    const pinned = r["pinned"] as string[] | null;
    const recent = r["recent"] as string[] | null;
    const pinnedNow = r["pinnedNow"] as string | null;
    if (pinned === null && recent === null) return false;
    if (pinned !== null && recent !== null && recent.some((h) => pinned.includes(h))) return false;
    return pinnedNow === null || (pinned !== null && pinned.includes(pinnedNow));
  },
};

export function validatePayload<C extends InvokeChannel>(channel: C, payload: unknown): Validation<Req<C>> {
  const shape = SHAPES[channel];
  if (shape === null) {
    return payload === undefined || payload === null
      ? { ok: true, value: undefined as Req<C> }
      : { ok: false, message: `${channel} takes no payload` };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { ok: false, message: `${channel} payload must be an object` };
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  const expected = Object.keys(shape);
  if (keys.length !== expected.length || !expected.every((k) => Object.hasOwn(record, k))) {
    return { ok: false, message: `${channel} payload must have exactly: ${expected.join(", ")}` };
  }
  for (const [key, check] of Object.entries(shape)) {
    if (!check(record[key])) return { ok: false, message: `${channel}.${key} is invalid` };
  }
  const refine = REFINE[channel];
  if (refine !== undefined && !refine(record)) return { ok: false, message: `${channel} payload is inconsistent` };
  return { ok: true, value: record as Req<C> };
}

/** 010 L1 (contracts/ipc.md "String limits"): every string field and its limit, for the enumeration test. */
export const STRING_LIMITS: Readonly<Record<string, number>> = Object.freeze({
  "tasks:create.title": MAX_TITLE_CHARS,
  "tasks:edit-title.title": MAX_TITLE_CHARS,
  "reminders:create.text": MAX_REMINDER_CHARS,
  "reminders:edit-text.text": MAX_REMINDER_CHARS,
  "tasks:edit-details.details": MAX_DETAILS_CHARS,
  "app:log-error.message": MAX_LOG_MESSAGE_CHARS,
  "app:log-error.stack": MAX_LOG_STACK_CHARS,
  "app:log-error.context": MAX_LOG_CONTEXT_CHARS,
  "undo:apply.token": MAX_TOKEN_CHARS,
  "undo:redo.token": MAX_TOKEN_CHARS,
  "clipboard:write.text": MAX_CLIPBOARD_CHARS,
  "data:undo-import.token": MAX_TOKEN_CHARS,
  "assets:import-bytes.name": MAX_FILE_NAME_CHARS,
  "assets:import-path.path": MAX_PATH_CHARS,
  "app:open-external.url": MAX_URL_CHARS,
  "search:query.text": MAX_SEARCH_CHARS,
  "dialog:confirm-delete-forever.title": MAX_TITLE_CHARS,
});
