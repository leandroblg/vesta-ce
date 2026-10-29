/**
 * The import merge (008 FR-031 to FR-041, research §5). Pure: items are matched by id within their kind; the
 * strictly newer `updatedAt` wins, field for field, and a tie keeps the local version. Settings follow the same
 * rule per key. The combined tasks are then repaired so the one-level rule holds (FR-035), and every row a
 * repair changes is stamped with the import time so the repair carries over.
 */
import { CLEANUP_SETTING_KEYS, DEFAULT_CLEANUP, keepsMore, type CleanupSettingKey } from "../cleanup";
import { cleanRecent, mergePinned, rewriteColors, type PinnedEntry } from "../markdown/colors";
import { between } from "../positions";
import type { Reminder } from "../reminder";
import { sanitizeImportedOverrides } from "../shortcuts/sanitize";
import { isActive, type Task } from "../task";
import type { TaskEvent } from "../task-events";
import type { ExportAsset, ExportData, ExportSetting } from "./format";

export interface LocalData {
  tasks: readonly Task[];
  reminders: readonly Reminder[];
  settings: readonly ExportSetting[];
  assetHashes: ReadonlySet<string>;
  /** 015: the stored history events, for the id clash rule (research §6). */
  events?: readonly TaskEvent[];
}

export interface MergeCounts {
  added: number;
  updated: number;
  unchanged: number;
}

export type RepairRule = "loop" | "missingParent" | "twoLevels" | "activeUnderInactive";

export interface Repair {
  id: string;
  rule: RepairRule;
}

export interface MergePlan {
  /** Winners from the import plus every repaired row, local-only ones included. */
  taskUpserts: Task[];
  /** Winners from the import. */
  reminderUpserts: Reminder[];
  settingUpserts: ExportSetting[];
  /** Incoming files whose hash is not stored. */
  assetsToAdd: ExportAsset[];
  /** Over the incoming tasks and reminders: added + updated + unchanged = their number. */
  counts: MergeCounts;
  repairs: Repair[];
  /** Action ids whose imported remap this OS refuses (FR-033), for the log. */
  droppedShortcuts: string[];
  /** 015 FR-023: incoming history events to write; merged by id, the later `at` winning. */
  eventUpserts: TaskEvent[];
}

interface Matched<T> {
  combined: Map<string, T>;
  winners: Set<string>;
  counts: MergeCounts;
}

function match<T extends { id: string; updatedAt: number }>(mine: readonly T[], theirs: readonly T[]): Matched<T> {
  const combined = new Map(mine.map((row) => [row.id, row]));
  const winners = new Set<string>();
  const counts: MergeCounts = { added: 0, updated: 0, unchanged: 0 };
  for (const row of theirs) {
    const current = combined.get(row.id);
    if (current === undefined) counts.added += 1;
    else if (row.updatedAt > current.updatedAt) counts.updated += 1;
    else {
      counts.unchanged += 1;
      continue;
    }
    combined.set(row.id, row);
    winners.add(row.id);
  }
  return { combined, winners, counts };
}

const byIdOrder = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The tasks whose parent chain comes back to itself. */
function inLoops(tasks: ReadonlyMap<string, Task>): Set<string> {
  const looped = new Set<string>();
  for (const start of tasks.values()) {
    const seen = new Set<string>([start.id]);
    let parent = start.parentId;
    while (parent !== null) {
      if (parent === start.id) {
        looped.add(start.id);
        break;
      }
      if (seen.has(parent)) break; // a loop further up, found from its own members
      seen.add(parent);
      parent = tasks.get(parent)?.parentId ?? null;
    }
  }
  return looped;
}

function repair(tasks: Map<string, Task>, now: number): { changed: Set<string>; repairs: Repair[] } {
  const changed = new Set<string>();
  const repairs: Repair[] = [];
  const toTop: Task[] = [];
  const set = (task: Task, patch: Partial<Task>, rule: RepairRule) => {
    tasks.set(task.id, { ...task, ...patch, updatedAt: now });
    changed.add(task.id);
    repairs.push({ id: task.id, rule });
  };
  const sorted = () => [...tasks.values()].sort(byIdOrder);

  // 1. Loops.
  const looped = inLoops(tasks);
  for (const t of sorted()) {
    if (!looped.has(t.id)) continue;
    toTop.push(t);
    set(t, { parentId: null }, "loop");
  }
  // 2. Missing parents.
  for (const t of sorted()) {
    if (t.parentId === null || tasks.has(t.parentId)) continue;
    toTop.push(t);
    set(t, { parentId: null }, "missingParent");
  }
  // 3. Two levels: under the grandparent, right after the former parent; repeated until none is left.
  for (let moved = true; moved; ) {
    moved = false;
    for (const t of sorted()) {
      const parent = t.parentId === null ? undefined : tasks.get(t.parentId);
      if (parent?.parentId == null) continue;
      const after = [...tasks.values()]
        .filter((s) => s.parentId === parent.parentId && s.id !== t.id && s.position > parent.position)
        .reduce<number | null>((min, s) => (min === null || s.position < min ? s.position : min), null);
      set(t, { parentId: parent.parentId, position: between(parent.position, after) }, "twoLevels");
      moved = true;
    }
  }
  // 4. Active under an inactive parent.
  for (const t of sorted()) {
    const parent = t.parentId === null ? undefined : tasks.get(t.parentId);
    if (parent === undefined || !isActive(t) || isActive(parent)) continue;
    toTop.push(t);
    set(t, { parentId: null }, "activeUnderInactive");
  }

  // Active rows made top level go after the last active top-level task, in their former order.
  const placed = new Set(toTop.map((t) => t.id));
  let last = Math.max(
    0,
    ...[...tasks.values()].filter((t) => t.parentId === null && isActive(t) && !placed.has(t.id)).map((t) => t.position),
  );
  const ordered = [...new Map(toTop.map((t) => [t.id, t])).values()].sort((a, b) => a.position - b.position || byIdOrder(a, b));
  for (const before of ordered) {
    const row = tasks.get(before.id);
    if (row === undefined || !isActive(row) || row.parentId !== null) continue;
    last += 1;
    tasks.set(row.id, { ...row, position: last });
  }
  return { changed, repairs };
}

function isCleanupKey(key: string): key is CleanupSettingKey {
  return (CLEANUP_SETTING_KEYS as readonly string[]).includes(key);
}

/** A cleanup row missing locally counts as its default. */
function defaultOf(key: CleanupSettingKey): boolean | number {
  const which = key.startsWith("archive") ? "archive" : "trash";
  return key.endsWith("On") ? DEFAULT_CLEANUP[which].on : DEFAULT_CLEANUP[which].hours;
}

function mergeSettings(
  mine: readonly ExportSetting[],
  theirs: readonly ExportSetting[],
  isMac: boolean,
): { upserts: ExportSetting[]; droppedShortcuts: string[] } {
  const local = new Map(mine.map((s) => [s.key, s]));
  const upserts: ExportSetting[] = [];
  let droppedShortcuts: string[] = [];
  for (const s of theirs) {
    // 010 FR-013 (L14, PRD Q130): an import may turn the automatic update check off, never on. The check is the one
    // setting that makes Vesta contact the network on its own, and an export is the only input not made by the
    // user's own hands on this computer; a file may lower network use but never add to it.
    if (s.key === "autoUpdateCheck" && s.value === true) continue;
    const current = local.get(s.key);
    // 011 FR-017 (PRD Q145): pinned colors merge color by color, whatever the row times.
    if (s.key === "pinnedColors") {
      const mineEntries = (current?.value ?? []) as PinnedEntry[];
      const merged = mergePinned(mineEntries, s.value as PinnedEntry[]);
      if (JSON.stringify(merged) !== JSON.stringify(mineEntries)) {
        upserts.push({ key: "pinnedColors", value: merged, updatedAt: Math.max(current?.updatedAt ?? 0, s.updatedAt) });
      }
      continue;
    }
    if (current !== undefined && s.updatedAt <= current.updatedAt) continue;
    // 018 FR-016a (PRD Q280): an import may only make a cleanup keep more: a switch turned off, a longer time.
    if (isCleanupKey(s.key) && !keepsMore(s.key, (current?.value ?? defaultOf(s.key)) as boolean | number, s.value as boolean | number)) continue;
    if (s.key === "shortcuts") {
      const { kept, dropped } = sanitizeImportedOverrides(s.value, isMac);
      droppedShortcuts = dropped;
      upserts.push({ ...s, value: kept });
    } else {
      upserts.push(s);
    }
  }
  cleanRecentAfterMerge(local, upserts);
  return { upserts, droppedShortcuts };
}

/** 011 FR-017: after the merge, the recent list drops colors that are pinned or preset (PRD Q145). */
function cleanRecentAfterMerge(local: ReadonlyMap<string, ExportSetting>, upserts: ExportSetting[]): void {
  const pick = (key: string) => upserts.find((u) => u.key === key) ?? local.get(key);
  const pinned = ((pick("pinnedColors")?.value ?? []) as PinnedEntry[]).map((e) => e.hex);
  const recent = pick("recentColors");
  if (recent === undefined) return;
  const cleaned = cleanRecent(recent.value as string[], pinned);
  if (cleaned.length === (recent.value as string[]).length) return;
  const at = upserts.findIndex((u) => u.key === "recentColors");
  const row: ExportSetting = { key: "recentColors", value: cleaned, updatedAt: recent.updatedAt };
  if (at >= 0) upserts[at] = row;
  else upserts.push(row);
}

export function mergeImport(local: LocalData, incoming: ExportData, ctx: { now: number; isMac: boolean }): MergePlan {
  const tasks = match(local.tasks, incoming.tasks);
  const reminders = match(local.reminders, incoming.reminders);
  const { changed, repairs } = repair(tasks.combined, ctx.now);
  const upsertIds = new Set([...tasks.winners, ...changed]);
  const settings = mergeSettings(local.settings, incoming.settings, ctx.isMac);
  return {
    taskUpserts: [...tasks.combined.values()].filter((t) => upsertIds.has(t.id)),
    reminderUpserts: [...reminders.combined.values()].filter((r) => reminders.winners.has(r.id)),
    settingUpserts: settings.upserts,
    assetsToAdd: incoming.assets.filter((a) => !local.assetHashes.has(a.sha256)),
    counts: {
      added: tasks.counts.added + reminders.counts.added,
      updated: tasks.counts.updated + reminders.counts.updated,
      unchanged: tasks.counts.unchanged + reminders.counts.unchanged,
    },
    repairs,
    droppedShortcuts: settings.droppedShortcuts,
    eventUpserts: mergeEvents(local, incoming, tasks.combined),
  };
}

/**
 * 015 FR-023 (research §6): an incoming event is kept when its task is in the result, whichever side's row won
 * (events are facts, not state); one whose id is stored is kept only with a later `at`; one whose task is in
 * neither side is dropped.
 */
function mergeEvents(local: LocalData, incoming: ExportData, tasks: ReadonlyMap<string, Task>): TaskEvent[] {
  const stored = new Map((local.events ?? []).map((e) => [e.id, e]));
  return (incoming.taskEvents ?? []).filter((e) => {
    if (!tasks.has(e.taskId)) return false;
    const mine = stored.get(e.id);
    return mine === undefined || e.at > mine.at;
  });
}

/**
 * 011 FR-015 (contracts/import-rules.md): imported markdown carries colors in 8 digits before it is written, as
 * stored text does after the first start; `updatedAt` is not changed. Rows without a change keep their identity.
 */
export function rewritePlanColors(plan: MergePlan): MergePlan {
  return {
    ...plan,
    taskUpserts: plan.taskUpserts.map((t) => {
      const titleMd = rewriteColors(t.titleMd);
      const detailsMd = rewriteColors(t.detailsMd);
      return titleMd === t.titleMd && detailsMd === t.detailsMd ? t : { ...t, titleMd, detailsMd };
    }),
    reminderUpserts: plan.reminderUpserts.map((r) => {
      const textMd = rewriteColors(r.textMd);
      return textMd === r.textMd ? r : { ...r, textMd };
    }),
  };
}
