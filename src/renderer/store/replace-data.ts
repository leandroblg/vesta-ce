/**
 * Replacing the renderer's data after an import or Undo import (008 FR-040, research §8). Pure: the store
 * applies the patch in one update, then the language, the search and an alert tick.
 */
import type { Reminder } from "../../domain/reminder";
import { isActive, type Task } from "../../domain/task";
import { fitsView, type PanelView } from "./panel-view";
import type { DataSnapshot, Lang } from "../../shared/ipc-contract";

export interface ReplaceInput {
  panelFor: string | null;
  /** The view the panel was opened in (011 FR-022b); the main view when absent. */
  view?: PanelView;
  overrideFor: string | null;
  editingKey: string | null;
  menuFor: string | null;
  searchActive: boolean;
}

export interface ReplacePatch {
  tasks: Record<string, Task>;
  reminders: Record<string, Reminder>;
  remindersCollapsed: boolean;
  now: number;
  alertSettings: DataSnapshot["alertSettings"];
  panelWidth: number;
  theme: DataSnapshot["theme"];
  palette: DataSnapshot["palette"];
  languageSetting: DataSnapshot["languageSetting"];
  shortcuts: DataSnapshot["shortcuts"];
  logLevel: DataSnapshot["logLevel"];
  autoUpdateCheck: boolean;
  updateReminder: boolean;
  updateReminderDays: number;
  pinnedColors: string[];
  recentColors: string[];
  tableRowsFirst: boolean;
  lastTextColor: string;
  panelFor: string | null;
  overrideFor: string | null;
  editingKey: string | null;
  menuFor: string | null;
}

export function planReplace(s: ReplaceInput, snap: DataSnapshot): { patch: ReplacePatch; language: Lang; requery: boolean } {
  const tasks: Record<string, Task> = {};
  for (const row of snap.tasks) tasks[row.id] = row;
  const reminders: Record<string, Reminder> = {};
  for (const row of snap.reminders) reminders[row.id] = row;
  const activeTask = (id: string | null) => {
    const row = id === null ? undefined : tasks[id];
    return row !== undefined && isActive(row) ? id : null;
  };
  // An inline editor or menu stays open only while its item still exists; "new:…" keys are not items.
  const exists = (key: string | null) =>
    key === null || key.startsWith("new:") || tasks[key] !== undefined || reminders[key] !== undefined ? key : null;
  return {
    patch: {
      tasks,
      reminders,
      remindersCollapsed: snap.remindersCollapsed,
      now: snap.now,
      alertSettings: snap.alertSettings,
      panelWidth: snap.panelWidth,
      theme: snap.theme,
      palette: snap.palette,
      languageSetting: snap.languageSetting,
      shortcuts: snap.shortcuts,
      logLevel: snap.logLevel,
      autoUpdateCheck: snap.autoUpdateCheck,
      updateReminder: snap.updateReminder,
      updateReminderDays: snap.updateReminderDays,
      pinnedColors: snap.pinnedColors,
      recentColors: snap.recentColors,
      tableRowsFirst: snap.tableRowsFirst,
      lastTextColor: snap.lastTextColor,
      panelFor: s.panelFor !== null && tasks[s.panelFor] !== undefined && fitsView(tasks[s.panelFor] as Task, s.view ?? "tasks") ? s.panelFor : null,
      overrideFor: activeTask(s.overrideFor),
      editingKey: exists(s.editingKey),
      menuFor: exists(s.menuFor),
    },
    language: snap.language,
    requery: s.searchActive,
  };
}
