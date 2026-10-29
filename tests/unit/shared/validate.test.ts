import { describe, expect, it } from "vitest";
import { INVOKE_CHANNELS, type InvokeChannel } from "../../../src/shared/ipc-contract";
import { STRING_LIMITS, validatePayload } from "../../../src/shared/validate";

const ID = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";

describe("validatePayload (contracts/ipc.md)", () => {
  it("accepts well-formed payloads", () => {
    expect(validatePayload("tasks:create", { title: "x", parentId: null }).ok).toBe(true);
    expect(validatePayload("tasks:create", { title: "x", parentId: ID }).ok).toBe(true);
    expect(validatePayload("tasks:edit-title", { id: ID, title: "" }).ok).toBe(true);
    expect(validatePayload("tasks:set-collapsed", { id: ID, collapsed: true }).ok).toBe(true);
    expect(validatePayload("tasks:mark-done", { id: ID }).ok).toBe(true);
    expect(validatePayload("undo:apply", { token: "abc" }).ok).toBe(true);
    expect(validatePayload("app:get-initial-state", undefined).ok).toBe(true);
    expect(validatePayload("app:log-error", { message: "boom", stack: null, context: "store.run" }).ok).toBe(true);
    expect(validatePayload("app:log-error", { message: "boom", stack: "at x", context: "window" }).ok).toBe(true);
  });

  it("rejects malformed error reports (FR-040)", () => {
    expect(validatePayload("app:log-error", { message: 1, stack: null, context: "x" }).ok).toBe(false);
    expect(validatePayload("app:log-error", { message: "m", stack: 3, context: "x" }).ok).toBe(false);
    expect(validatePayload("app:log-error", { message: "m", stack: null }).ok).toBe(false);
  });

  it("rejects ids that are not UUID strings", () => {
    for (const id of ["", "abc", 42, null, undefined, `${ID}x`]) {
      expect(validatePayload("tasks:delete", { id }).ok).toBe(false);
    }
  });

  it("rejects wrong types", () => {
    expect(validatePayload("tasks:create", { title: 1, parentId: null }).ok).toBe(false);
    expect(validatePayload("tasks:create", { title: "x" }).ok).toBe(false);
    expect(validatePayload("tasks:create", { title: "x", parentId: "nope" }).ok).toBe(false);
    expect(validatePayload("tasks:set-collapsed", { id: ID, collapsed: "yes" }).ok).toBe(false);
    expect(validatePayload("undo:apply", { token: 5 }).ok).toBe(false);
    expect(validatePayload("tasks:restore", null).ok).toBe(false);
    expect(validatePayload("tasks:restore", "x").ok).toBe(false);
  });

  it("rejects extra properties", () => {
    expect(validatePayload("tasks:mark-done", { id: ID, extra: 1 }).ok).toBe(false);
  });

  it("accepts the reminder channels' payloads (002 contracts/ipc.md)", () => {
    expect(validatePayload("reminders:create", { text: "Call the bank" }).ok).toBe(true);
    expect(validatePayload("reminders:edit-text", { id: ID, text: "" }).ok).toBe(true);
    expect(validatePayload("reminders:set-collapsed", { collapsed: false }).ok).toBe(true);
    for (const channel of ["reminders:mark-done", "reminders:delete", "reminders:restore", "reminders:delete-permanently"] as const) {
      expect(validatePayload(channel, { id: ID }).ok).toBe(true);
    }
  });

  it("rejects malformed reminder payloads", () => {
    expect(validatePayload("reminders:create", { text: 1 }).ok).toBe(false);
    expect(validatePayload("reminders:create", { text: "x", parentId: null }).ok).toBe(false);
    expect(validatePayload("reminders:create", {}).ok).toBe(false);
    expect(validatePayload("reminders:edit-text", { id: "abc", text: "x" }).ok).toBe(false);
    expect(validatePayload("reminders:edit-text", { id: ID }).ok).toBe(false);
    expect(validatePayload("reminders:set-collapsed", { collapsed: "yes" }).ok).toBe(false);
    expect(validatePayload("reminders:set-collapsed", { id: ID, collapsed: true }).ok).toBe(false);
    for (const channel of ["reminders:mark-done", "reminders:delete", "reminders:restore", "reminders:delete-permanently"] as const) {
      expect(validatePayload(channel, { id: "nope" }).ok).toBe(false);
      expect(validatePayload(channel, { id: ID, extra: 1 }).ok).toBe(false);
    }
  });

  it("accepts the alert channels' payloads (003 contracts/ipc.md)", () => {
    expect(validatePayload("tasks:reschedule", { id: ID, forMin: null }).ok).toBe(true);
    expect(validatePayload("tasks:reschedule", { id: ID, forMin: 120 }).ok).toBe(true);
    expect(validatePayload("tasks:set-alert-override", { id: ID, minutes: null }).ok).toBe(true);
    expect(validatePayload("tasks:set-alert-override", { id: ID, minutes: 60 }).ok).toBe(true);
    expect(validatePayload("tasks:set-alert-override", { id: ID, minutes: 14_399_999 }).ok).toBe(true);
    expect(validatePayload("alerts:tick", { visible: true }).ok).toBe(true);
    expect(validatePayload("alerts:tick", { visible: false }).ok).toBe(true);
  });

  it("rejects malformed alert payloads", () => {
    expect(validatePayload("tasks:reschedule", { id: "nope", forMin: null }).ok).toBe(false);
    // 015: forMin is null (the tolerance) or a quick duration of 60–43,200 whole minutes.
    for (const forMin of [59, 43_201, 90.5, "120", undefined]) expect(validatePayload("tasks:reschedule", { id: ID, forMin }).ok).toBe(false);
    expect(validatePayload("tasks:reschedule", { id: ID }).ok).toBe(false);
    for (const minutes of [59, 14_400_000, 90.5, "120", undefined, -60, Number.NaN]) {
      expect(validatePayload("tasks:set-alert-override", { id: ID, minutes }).ok).toBe(false);
    }
    expect(validatePayload("tasks:set-alert-override", { id: ID, minutes: 60, extra: 1 }).ok).toBe(false);
    expect(validatePayload("alerts:tick", { visible: "yes" }).ok).toBe(false);
    expect(validatePayload("alerts:tick", {}).ok).toBe(false);
  });

  it("accepts tasks:move and reminders:move payloads (004 contracts/ipc.md)", () => {
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "top", beforeId: null } }).ok).toBe(true);
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "top", beforeId: ID } }).ok).toBe(true);
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "sub", parentId: ID, beforeId: null } }).ok).toBe(true);
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "sub", parentId: ID, beforeId: ID } }).ok).toBe(true);
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "group" } }).ok).toBe(true);
    expect(validatePayload("reminders:move", { id: ID, beforeId: null }).ok).toBe(true);
    expect(validatePayload("reminders:move", { id: ID, beforeId: ID }).ok).toBe(true);
  });

  it("rejects malformed move payloads: unknown kind, missing or extra keys, non-UUID ids", () => {
    const bad: unknown[] = [
      { kind: "middle", beforeId: null },
      { kind: "sub", beforeId: null },
      { kind: "top" },
      { kind: "top", beforeId: null, extra: 1 },
      { kind: "group", beforeId: null },
      { kind: "top", beforeId: "abc" },
      { kind: "top", beforeId: "" },
      { kind: "top", beforeId: 5 },
      { kind: "sub", parentId: "abc", beforeId: null },
      null,
      "top",
      [],
    ];
    for (const dest of bad) expect(validatePayload("tasks:move", { id: ID, dest }).ok).toBe(false);
    expect(validatePayload("tasks:move", { id: "abc", dest: { kind: "group" } }).ok).toBe(false);
    expect(validatePayload("tasks:move", { id: ID, dest: { kind: "group" }, extra: 1 }).ok).toBe(false);
    expect(validatePayload("reminders:move", { id: ID, beforeId: "abc" }).ok).toBe(false);
    expect(validatePayload("reminders:move", { id: ID, beforeId: 3 }).ok).toBe(false);
    expect(validatePayload("reminders:move", { id: ID, beforeId: null, extra: 1 }).ok).toBe(false);
  });
});

describe("005 channels (005 contracts/ipc.md)", () => {
  const HASH = "0123456789abcdef".repeat(4);

  it("tasks:edit-details takes an id and at most 1,000,000 characters", () => {
    expect(validatePayload("tasks:edit-details", { id: ID, details: "" }).ok).toBe(true);
    expect(validatePayload("tasks:edit-details", { id: ID, details: "x".repeat(1_000_000) }).ok).toBe(true);
    expect(validatePayload("tasks:edit-details", { id: ID, details: "x".repeat(1_000_001) }).ok).toBe(false);
    expect(validatePayload("tasks:edit-details", { id: ID, details: 1 }).ok).toBe(false);
    expect(validatePayload("tasks:edit-details", { id: "x", details: "" }).ok).toBe(false);
  });

  it("assets:import-bytes takes a name of 1–255 characters, bytes up to 100 MB and a scope", () => {
    const bytes = new Uint8Array(4);
    expect(validatePayload("assets:import-bytes", { name: "a.png", bytes, scope: "title" }).ok).toBe(true);
    expect(validatePayload("assets:import-bytes", { name: "x".repeat(255), bytes, scope: "details" }).ok).toBe(true);
    expect(validatePayload("assets:import-bytes", { name: "", bytes, scope: "details" }).ok).toBe(false);
    expect(validatePayload("assets:import-bytes", { name: "x".repeat(256), bytes, scope: "details" }).ok).toBe(false);
    expect(validatePayload("assets:import-bytes", { name: "a", bytes: [1, 2], scope: "details" }).ok).toBe(false);
    expect(validatePayload("assets:import-bytes", { name: "a", bytes: "abc", scope: "details" }).ok).toBe(false);
    expect(validatePayload("assets:import-bytes", { name: "a", bytes, scope: "reminder" }).ok).toBe(false);
    const big = { byteLength: 104_857_601 } as unknown;
    expect(validatePayload("assets:import-bytes", { name: "a", bytes: big, scope: "details" }).ok).toBe(false);
  });

  it("assets:pick takes a scope", () => {
    expect(validatePayload("assets:pick", { scope: "title" }).ok).toBe(true);
    expect(validatePayload("assets:pick", { scope: "x" }).ok).toBe(false);
  });

  it("assets:import-path takes an absolute path of at most 4096 characters", () => {
    for (const path of ["/Users/me/a.pdf", "C:\\Users\\me\\a.pdf", "D:/x.png", "\\\\server\\share\\x", "file:///Users/me/a.pdf"]) {
      expect(validatePayload("assets:import-path", { path, scope: "details" }).ok, path).toBe(true);
    }
    for (const path of ["a.pdf", "./a.pdf", "", `/${"x".repeat(4096)}`, "/a\u0000b"]) {
      expect(validatePayload("assets:import-path", { path, scope: "details" }).ok, path).toBe(false);
    }
  });

  it("assets:open takes a stored file reference", () => {
    expect(validatePayload("assets:open", { ref: `assets/${HASH}.pdf` }).ok).toBe(true);
    expect(validatePayload("assets:open", { ref: `assets/${HASH}` }).ok).toBe(true);
    for (const ref of [`assets/../${HASH}`, `assets/${HASH.toUpperCase()}.pdf`, `/assets/${HASH}.pdf`, `assets/${HASH}.PDF`]) {
      expect(validatePayload("assets:open", { ref }).ok, ref).toBe(false);
    }
  });

  it("app:open-external takes an http, https or mailto URL of at most 2048 characters", () => {
    for (const url of ["https://example.com", "http://example.com/a", "mailto:me@example.com"]) {
      expect(validatePayload("app:open-external", { url }).ok, url).toBe(true);
    }
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "ftp://x", "example.com", `https://x.com/${"a".repeat(2048)}`]) {
      expect(validatePayload("app:open-external", { url }).ok, url).toBe(false);
    }
  });

  it("settings:set-panel-width takes an integer from 300 to 760", () => {
    expect(validatePayload("settings:set-panel-width", { px: 300 }).ok).toBe(true);
    expect(validatePayload("settings:set-panel-width", { px: 760 }).ok).toBe(true);
    for (const px of [299, 761, 420.5, "420", null]) {
      expect(validatePayload("settings:set-panel-width", { px }).ok, String(px)).toBe(false);
    }
  });
  it("search:query takes seq, text (≤ 10,000 characters) and three booleans (006 T022)", () => {
    const ok = { seq: 0, text: "sales report", matchCase: false, exactPhrase: true, includeArchiveTrash: false };
    expect(validatePayload("search:query", ok).ok).toBe(true);
    expect(validatePayload("search:query", { ...ok, seq: Number.MAX_SAFE_INTEGER, text: "x".repeat(10_000) }).ok).toBe(true);
    for (const bad of [
      { ...ok, seq: -1 },
      { ...ok, seq: 1.5 },
      { ...ok, seq: Number.MAX_SAFE_INTEGER + 1 },
      { ...ok, seq: "1" },
      { ...ok, text: "x".repeat(10_001) },
      { ...ok, text: null },
      { ...ok, matchCase: "false" },
      { ...ok, exactPhrase: 0 },
      { ...ok, includeArchiveTrash: null },
      { ...ok, extra: true },
      { seq: 0, text: "" },
    ]) {
      expect(validatePayload("search:query", bad).ok, JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });

  it("settings:set-alert takes a known alert key and whole minutes (007)", () => {
    expect(validatePayload("settings:set-alert", { key: "reblinkIntervalMin", minutes: 30 }).ok).toBe(true);
    // 015 Q207: the four quick reschedule durations are alert settings too.
    for (const key of ["quickReschedule1Min", "quickReschedule2Min", "quickReschedule3Min", "quickReschedule4Min"])
      expect(validatePayload("settings:set-alert", { key, minutes: 120 }).ok).toBe(true);
    for (const bad of [
      { key: "nope", minutes: 30 },
      { key: "alertPeriodMin", minutes: 1.5 },
      { key: "alertPeriodMin", minutes: -1 },
      { key: "alertPeriodMin", minutes: "60" },
      { key: "alertPeriodMin" },
    ]) expect(validatePayload("settings:set-alert", bad).ok, JSON.stringify(bad)).toBe(false);
  });

  it("settings:set-theme and settings:set-language take only the listed values (007)", () => {
    for (const theme of ["light", "dark", "system"]) expect(validatePayload("settings:set-theme", { theme }).ok).toBe(true);
    expect(validatePayload("settings:set-theme", { theme: "blue" }).ok).toBe(false);
    for (const setting of ["system", "en", "pt-BR", "it", "es-ES", "fr"]) expect(validatePayload("settings:set-language", { setting }).ok).toBe(true);
    expect(validatePayload("settings:set-language", { setting: "de" }).ok).toBe(false);
  });

  it("settings:set-shortcuts takes up to 21 known actions with 1 or 2 short strings (007)", () => {
    expect(validatePayload("settings:set-shortcuts", { overrides: {} }).ok).toBe(true);
    expect(validatePayload("settings:set-shortcuts", { overrides: { del: ["F8", "F9"] } }).ok).toBe(true);
    for (const overrides of [{ nope: ["F5"] }, { del: [] }, { del: ["F1", "F2", "F3"] }, { del: ["x".repeat(41)] }, { del: "F5" }, []]) {
      expect(validatePayload("settings:set-shortcuts", { overrides }).ok, JSON.stringify(overrides)).toBe(false);
    }
  });

  it("window:minimize takes no payload, keys:set-capture a boolean (007)", () => {
    expect(validatePayload("window:minimize", undefined).ok).toBe(true);
    expect(validatePayload("window:minimize", { x: 1 }).ok).toBe(false);
    expect(validatePayload("keys:set-capture", { on: true }).ok).toBe(true);
    expect(validatePayload("keys:set-capture", { on: 1 }).ok).toBe(false);
  });
});

describe("008 channels (008 contracts/ipc.md)", () => {
  it("data:export takes exactly includeLogs: boolean", () => {
    expect(validatePayload("data:export", { includeLogs: false }).ok).toBe(true);
    expect(validatePayload("data:export", { includeLogs: true }).ok).toBe(true);
    for (const bad of [{}, { includeLogs: "yes" }, { includeLogs: true, folder: "/tmp" }, undefined, null]) {
      expect(validatePayload("data:export", bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("data:undo-import takes exactly a token string of at most 64 characters", () => {
    expect(validatePayload("data:undo-import", { token: "t".repeat(64) }).ok).toBe(true);
    for (const bad of [{ token: "t".repeat(65) }, { token: 1 }, {}, { token: "x", extra: 1 }]) {
      expect(validatePayload("data:undo-import", bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("data:import and data:end-undo-offer take no payload; no channel takes a path", () => {
    for (const channel of ["data:import", "data:end-undo-offer"] as const) {
      expect(validatePayload(channel, undefined).ok).toBe(true);
      expect(validatePayload(channel, { path: "/etc/passwd" }).ok).toBe(false);
    }
  });
});

describe("009 channels (009 contracts/ipc.md)", () => {
  it("logs:read takes a null cursor or a log file name and offset, and a level", () => {
    expect(validatePayload("logs:read", { cursor: null, level: "info" }).ok).toBe(true);
    expect(validatePayload("logs:read", { cursor: { file: "vesta-042.log", offset: 0 }, level: "trace" }).ok).toBe(true);
    for (const bad of [
      { cursor: { file: "../x.log", offset: 0 }, level: "info" },
      { cursor: { file: "vesta-1.log", offset: 0 }, level: "info" },
      { cursor: { file: "/Users/x/vesta-001.log", offset: 0 }, level: "info" },
      { cursor: { file: "vesta-001.log", offset: -1 }, level: "info" },
      { cursor: { file: "vesta-001.log", offset: 1.5 }, level: "info" },
      { cursor: { file: "vesta-001.log", offset: 0, path: "/" }, level: "info" },
      { cursor: null, level: "warning" },
      { cursor: null },
      { cursor: null, level: "info", extra: 1 },
    ]) {
      expect(validatePayload("logs:read", bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });

  it("logs:watch, settings:set-log-level and settings:set-auto-update-check take exactly their fields", () => {
    expect(validatePayload("logs:watch", { on: true, level: "debug" }).ok).toBe(true);
    expect(validatePayload("logs:watch", { on: "yes", level: "debug" }).ok).toBe(false);
    expect(validatePayload("settings:set-log-level", { level: "fatal" }).ok).toBe(true);
    expect(validatePayload("settings:set-log-level", { level: "verbose" }).ok).toBe(false);
    expect(validatePayload("settings:set-auto-update-check", { on: false }).ok).toBe(true);
    expect(validatePayload("settings:set-auto-update-check", { on: 0 }).ok).toBe(false);
  });

  it("updates:open takes only a target, never an address; the other update channels take no payload", () => {
    expect(validatePayload("updates:open", { target: "file" }).ok).toBe(true);
    expect(validatePayload("updates:open", { target: "release" }).ok).toBe(true);
    for (const bad of [{ target: "https://github.com/x" }, { url: "https://github.com/x" }, { target: "file", url: "x" }]) {
      expect(validatePayload("updates:open", bad).ok, JSON.stringify(bad)).toBe(false);
    }
    for (const channel of ["updates:check"] as const) {
      expect(validatePayload(channel, undefined).ok).toBe(true);
      expect(validatePayload(channel, { force: true }).ok).toBe(false);
    }
  });
});

describe("L1 every string field has a limit (010 FR-009, FR-010, contracts/ipc.md)", () => {
  const ID = "3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90";
  /** One valid payload per channel that takes an object; every string field below is checked at and over its limit. */
  const VALID: Record<string, Record<string, unknown>> = {
    "app:log-error": { message: "m", stack: "s", context: "c" },
    "tasks:create": { title: "t", parentId: null },
    "tasks:edit-title": { id: ID, title: "t" },
    "tasks:set-collapsed": { id: ID, collapsed: true },
    "tasks:mark-done": { id: ID },
    "tasks:delete": { id: ID },
    "tasks:restore": { id: ID },
    "tasks:delete-permanently": { id: ID },
    "tasks:reschedule": { id: ID, forMin: null },
    "tasks:history": { id: ID },
    "tasks:set-alert-override": { id: ID, minutes: null },
    "tasks:move": { id: ID, dest: { kind: "group" } },
    "alerts:tick": { visible: true },
    "reminders:create": { text: "r" },
    "reminders:edit-text": { id: ID, text: "r" },
    "reminders:set-collapsed": { collapsed: true },
    "reminders:mark-done": { id: ID },
    "reminders:delete": { id: ID },
    "reminders:restore": { id: ID },
    "reminders:delete-permanently": { id: ID },
    "reminders:move": { id: ID, beforeId: null },
    "undo:apply": { token: "abc" },
    "tasks:edit-details": { id: ID, details: "d" },
    "assets:import-bytes": { name: "a.png", bytes: new Uint8Array(1), scope: "details" },
    "assets:pick": { scope: "details" },
    "assets:import-path": { path: "/tmp/a.png", scope: "details" },
    "assets:open": { ref: `assets/${"a".repeat(64)}.png` },
    "app:open-external": { url: "https://example.com/" },
    "settings:set-panel-width": { px: 400 },
    "search:query": { seq: 1, text: "q", matchCase: false, exactPhrase: false, includeArchiveTrash: false },
    "settings:set-alert": { key: "alertPeriodMin", minutes: 1440 },
    "settings:set-theme": { theme: "dark" },
    "settings:set-language": { setting: "system" },
    "settings:set-shortcuts": { overrides: {} },
    "keys:set-capture": { on: true },
    "data:export": { includeLogs: false },
    "data:undo-import": { token: "abc" },
    "logs:read": { cursor: null, level: "info" },
    "logs:watch": { on: true, level: "info" },
    "settings:set-log-level": { level: "info" },
    "settings:set-auto-update-check": { on: true },
    "updates:open": { target: "file" },
    "settings:set-update-reminder": { on: true },
    "settings:set-update-reminder-days": { days: 30 },
    "settings:set-color-lists": { pinned: ["#ffe066ff"], recent: null, pinnedNow: null },
    "settings:set-table-rows-first": { on: true },
    "settings:set-palette": { palette: "hearth" },
    "dialog:confirm-delete-forever": { title: "t" },
    "app:open-help": { target: "readme" },
    "updates:pane-shown": { shown: true },
    "menu:set-state": {
      view: "tasks",
      target: null,
      editing: "none",
      format: null,
      remindersExpanded: true,
      panelOpen: false,
      search: { active: false, everything: false, matchCase: false, exactPhrase: false },
      modal: "none",
      busy: false,
      remindersFull: false,
      undoOffered: false,
      redoOffered: false,
      linkAtCursor: false,
    },
    "undo:redo": { token: "abc" },
    "settings:set-last-text-color": { hex: "#b9411cff" },
    "settings:set-cleanup": { which: "trash", on: true, hours: 720, commit: false },
    "clipboard:write": { text: "t", html: null },
    "assets:reveal": { ref: `assets/${"a".repeat(64)}.png` },
  };

  it("L1 covers every channel that takes a payload", () => {
    const withPayload = INVOKE_CHANNELS.filter((c) => !validatePayload(c, undefined).ok);
    expect([...withPayload].sort()).toEqual(Object.keys(VALID).sort());
    for (const [channel, payload] of Object.entries(VALID)) {
      expect(validatePayload(channel as InvokeChannel, payload).ok, channel).toBe(true);
    }
  });

  it("L1 STRING_LIMITS names the contract's limits", () => {
    expect(STRING_LIMITS).toEqual({
      "tasks:create.title": 10_000,
      "tasks:edit-title.title": 10_000,
      "reminders:create.text": 10_000,
      "reminders:edit-text.text": 10_000,
      "tasks:edit-details.details": 1_000_000,
      "app:log-error.message": 4_096,
      "app:log-error.stack": 65_536,
      "app:log-error.context": 200,
      "undo:apply.token": 64,
      "data:undo-import.token": 64,
      "assets:import-bytes.name": 255,
      "assets:import-path.path": 4_096,
      "app:open-external.url": 2_048,
      "search:query.text": 10_000,
      "dialog:confirm-delete-forever.title": 10_000,
      "undo:redo.token": 64,
      "clipboard:write.text": 1_000_000,
    });
  });

  it.each(Object.entries(STRING_LIMITS))("L1 %s accepts the limit and refuses one more", (key, limit) => {
    const [channel, field] = key.split(".") as [InvokeChannel, string];
    const base = VALID[channel] as Record<string, unknown>;
    const fill = channel === "assets:import-path" ? "/" : channel === "app:open-external" ? "https://" : "";
    const atLimit = fill + "a".repeat(limit - fill.length);
    const over = fill + "a".repeat(limit - fill.length + 1);
    expect(validatePayload(channel, { ...base, [field]: atLimit }).ok, `${key} at limit`).toBe(true);
    expect(validatePayload(channel, { ...base, [field]: over }).ok, `${key} over`).toBe(false);
  });

  it("L1 no string field of any channel accepts two million characters", () => {
    const huge = "x".repeat(2_000_001);
    for (const [channel, payload] of Object.entries(VALID)) {
      for (const field of Object.keys(payload)) {
        expect(validatePayload(channel as InvokeChannel, { ...payload, [field]: huge }).ok, `${channel}.${field}`).toBe(false);
      }
    }
  });

  it("L1 a required key supplied only through inheritance is refused (Object.hasOwn)", () => {
    const inherited = Object.create({ title: "x", parentId: null }) as Record<string, unknown>;
    expect(validatePayload("tasks:create", inherited).ok).toBe(false);
    const own = Object.assign(Object.create(null) as Record<string, unknown>, { title: "x", parentId: null });
    expect(validatePayload("tasks:create", own).ok).toBe(true);
  });

  it("Q133 the reminder channels take a switch and whole days from 7 to 365", () => {
    expect(validatePayload("settings:set-update-reminder", { on: false }).ok).toBe(true);
    expect(validatePayload("settings:set-update-reminder", { on: "no" }).ok).toBe(false);
    for (const days of [7, 30, 365]) expect(validatePayload("settings:set-update-reminder-days", { days }).ok, String(days)).toBe(true);
    for (const days of [6, 366, 30.5, "30", null]) expect(validatePayload("settings:set-update-reminder-days", { days }).ok, String(days)).toBe(false);
  });
});

describe("011 editor settings channels (contracts/ipc.md)", () => {
  const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}ff`;
  const lists = (pinned: unknown, recent: unknown, pinnedNow: unknown = null) => ({ pinned, recent, pinnedNow });

  it("FR-016 settings:set-color-lists accepts one or both lists, with an optional just-pinned color", () => {
    expect(validatePayload("settings:set-color-lists", lists(["#ffe066ff"], null)).ok).toBe(true);
    expect(validatePayload("settings:set-color-lists", lists(null, ["#ffe066ff"])).ok).toBe(true);
    expect(validatePayload("settings:set-color-lists", lists(["#000001ff"], ["#000002ff"], "#000001ff")).ok).toBe(true);
    expect(validatePayload("settings:set-color-lists", lists([], [])).ok).toBe(true);
    // 016 FR-028: a drop pins a color where it lands, so it need not be first.
    expect(validatePayload("settings:set-color-lists", lists(["#000001ff", "#000002ff"], null, "#000002ff")).ok).toBe(true);
  });

  it.each([
    ["no list", lists(null, null)],
    ["11 pinned", lists(Array.from({ length: 11 }, (_, i) => hex(i)), null)],
    ["21 recent", lists(null, Array.from({ length: 21 }, (_, i) => hex(i)))],
    ["a 6-digit item", lists(["#ffe066"], null)],
    ["a duplicate", lists(["#ffe066ff", "#ffe066ff"], null)],
    ["a color in both lists", lists(["#ffe066ff"], ["#ffe066ff"])],
    ["a just-pinned color that is not pinned", lists(["#000001ff", "#000002ff"], null, "#000003ff")],
    ["a just-pinned color without a pinned list", lists(null, ["#000001ff"], "#000001ff")],
  ])("FR-016 settings:set-color-lists refuses %s", (_label, payload) => {
    expect(validatePayload("settings:set-color-lists", payload).ok).toBe(false);
  });

  it("FR-016 settings:set-color-lists refuses a missing or extra key", () => {
    expect(validatePayload("settings:set-color-lists", { pinned: ["#ffe066ff"], recent: null }).ok).toBe(false);
    expect(validatePayload("settings:set-color-lists", { ...lists(["#ffe066ff"], null), x: 1 }).ok).toBe(false);
  });

  it("FR-020b settings:set-table-rows-first takes a boolean", () => {
    expect(validatePayload("settings:set-table-rows-first", { on: true }).ok).toBe(true);
    expect(validatePayload("settings:set-table-rows-first", { on: "yes" }).ok).toBe(false);
  });
});

describe("013 contracts/ipc.md: the menu, the delete confirmation, help and the Updates pane", () => {
  const state = {
    view: "tasks",
    target: { kind: "task", topLevel: true, stale: false },
    editing: "details",
    format: { offered: ["strong", "heading"], pressed: ["strong"], disabled: [], heading: 2, inTable: false, tableActions: [] },
    remindersExpanded: true,
    panelOpen: true,
    search: { active: false, everything: false, matchCase: false, exactPhrase: false },
    modal: "none",
    busy: false,
    remindersFull: false,
    undoOffered: false,
    redoOffered: false,
    linkAtCursor: false,
  };

  it("menu:set-state accepts a full valid state, with or without a target and a format", () => {
    expect(validatePayload("menu:set-state", state).ok).toBe(true);
    expect(validatePayload("menu:set-state", { ...state, target: null, format: null, editing: "none" }).ok).toBe(true);
  });

  it("menu:set-state rejects an unknown view, a non-boolean flag, unknown ids, too many ids and a bad heading", () => {
    expect(validatePayload("menu:set-state", { ...state, view: "inbox" }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, busy: "no" }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, modal: "sheet" }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, target: { kind: "note", topLevel: true, stale: false } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, format: { ...state.format, offered: ["strong", "rm -rf"] } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, format: { ...state.format, pressed: Array(65).fill("strong") } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, format: { ...state.format, heading: 7 } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, format: { ...state.format, heading: 1.5 } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, format: { ...state.format, tableActions: ["row-sideways"] } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, search: { active: false } }).ok).toBe(false);
    expect(validatePayload("menu:set-state", { ...state, extra: 1 }).ok).toBe(false);
  });

  it("dialog:confirm-delete-forever needs a title within the title limit", () => {
    expect(validatePayload("dialog:confirm-delete-forever", { title: "Old idea" }).ok).toBe(true);
    expect(validatePayload("dialog:confirm-delete-forever", { title: "x".repeat(STRING_LIMITS["dialog:confirm-delete-forever.title"] ?? 0) }).ok).toBe(true);
    expect(validatePayload("dialog:confirm-delete-forever", { title: "x".repeat((STRING_LIMITS["dialog:confirm-delete-forever.title"] ?? 0) + 1) }).ok).toBe(false);
    expect(validatePayload("dialog:confirm-delete-forever", { title: 3 }).ok).toBe(false);
  });

  it("app:open-help accepts only the two fixed targets, never a URL", () => {
    expect(validatePayload("app:open-help", { target: "readme" }).ok).toBe(true);
    expect(validatePayload("app:open-help", { target: "release" }).ok).toBe(true);
    expect(validatePayload("app:open-help", { target: "https://example.com" }).ok).toBe(false);
  });

  it("013 T114 updates:pane-shown takes whether the Updates pane is shown, and nothing else", () => {
    expect(validatePayload("updates:pane-shown", { shown: true }).ok).toBe(true);
    expect(validatePayload("updates:pane-shown", { shown: false }).ok).toBe(true);
    expect(validatePayload("updates:pane-shown", undefined).ok).toBe(false);
    expect(validatePayload("updates:pane-shown", { shown: "yes" }).ok).toBe(false);
    expect(validatePayload("updates:pane-shown", { shown: true, x: 1 }).ok).toBe(false);
  });
});

describe("016 channels (016 contracts/ipc.md)", () => {
  const REF = `assets/${"a".repeat(64)}.pdf`;
  it("undo:redo takes exactly a token", () => {
    expect(validatePayload("undo:redo", { token: "t" }).ok).toBe(true);
    expect(validatePayload("undo:redo", { token: 1 }).ok).toBe(false);
    expect(validatePayload("undo:redo", { token: "t", id: "x" }).ok).toBe(false);
  });
  it("settings:set-last-text-color takes an 8-digit hex color, alpha included", () => {
    expect(validatePayload("settings:set-last-text-color", { hex: "#b9411cff" }).ok).toBe(true);
    for (const hex of ["#b9411c", "b9411cff", "#B9411CFF", "red", 1, null]) {
      expect(validatePayload("settings:set-last-text-color", { hex }).ok, String(hex)).toBe(false);
    }
  });
  it("clipboard:write takes a text and an optional html of at most 1,000,000 characters each", () => {
    expect(validatePayload("clipboard:write", { text: "a", html: "<b>a</b>" }).ok).toBe(true);
    expect(validatePayload("clipboard:write", { text: "a", html: null }).ok).toBe(true);
    expect(validatePayload("clipboard:write", { text: "a", html: "x".repeat(1_000_001) }).ok).toBe(false);
    expect(validatePayload("clipboard:write", { text: 1, html: null }).ok).toBe(false);
    expect(validatePayload("clipboard:write", { text: "a" }).ok).toBe(false);
  });
  it("assets:reveal takes a stored file reference, never a path", () => {
    expect(validatePayload("assets:reveal", { ref: REF }).ok).toBe(true);
    for (const ref of ["/etc/passwd", "assets/../x", `assets/${"a".repeat(63)}`, "file:///tmp/a"]) {
      expect(validatePayload("assets:reveal", { ref }).ok, ref).toBe(false);
    }
  });
  it("menu:set-state carries redoOffered and linkAtCursor as booleans", () => {
    const base = {
      view: "tasks", target: null, editing: "none", format: null, remindersExpanded: true, panelOpen: false,
      search: { active: false, everything: false, matchCase: false, exactPhrase: false },
      modal: "none", busy: false, remindersFull: false, undoOffered: false, redoOffered: true, linkAtCursor: true,
    };
    expect(validatePayload("menu:set-state", base).ok).toBe(true);
    expect(validatePayload("menu:set-state", { ...base, redoOffered: "yes" }).ok).toBe(false);
  });
});
