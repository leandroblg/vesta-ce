/**
 * The menu bar's commands in the renderer (013 research §2, contracts/ipc.md `menu:command`): each id runs what
 * its toolbar button, context menu item, shortcut or floating-menu button runs (FR-010).
 */
import { quickDurations } from "../../domain/alert-settings";
import { isMenuCommandId, menuCommand, type MenuCommandId } from "../../domain/menu/commands";
import { menuEditor } from "../editor/active";
import { menuUndoRedo, runAction } from "../keyboard/registry";
import { openSettings } from "../keyboard/handlers";
import { removeFromTrash, selectedCard } from "../keyboard/selection";
import { reportError } from "../report";
import { actions, useVesta, type SettingsPane } from "../store/store";

/** Commands added by later tasks register here (US1, US4, US5). */
const extra = new Map<MenuCommandId, () => void>();

export function registerCommand(id: MenuCommandId, run: () => void): () => void {
  extra.set(id, run);
  return () => {
    if (extra.get(id) === run) extra.delete(id);
  };
}

/** CHK029: an open context menu or alert override closes first, as a click elsewhere would. */
function closeTransient(): void {
  const s = useVesta.getState();
  if (s.menuFor !== null) actions.openMenu(null);
  if (s.overrideFor !== null) actions.openOverride(null);
}

/** FR-015 (PRD Q182): the focused card, else the item open in the details panel. */
function targetId(): string | null {
  return selectedCard()?.id ?? useVesta.getState().panelFor;
}

/** Settings at one pane, opened as the shortcut opens it (pending edits saved first); `then` runs once it is. */
function openSettingsAt(pane: SettingsPane, then?: () => void): void {
  actions.setSettingsPane(pane);
  if (!useVesta.getState().settingsOpen) openSettings();
  then?.();
}

/** US1-9: shows the target's details; chosen again on the item already open, it closes the panel. */
function toggleDetails(): void {
  const s = useVesta.getState();
  const card = selectedCard();
  if (s.panelFor !== null && (card === null || card.id === s.panelFor)) {
    actions.closePanel();
    return;
  }
  runAction("open");
}

export function runCommand(id: unknown): void {
  if (!isMenuCommandId(id)) return;
  if (id.startsWith("fmt:")) {
    const editor = menuEditor();
    if (editor === null) return;
    const opt = id.slice(4);
    if (opt === "outdent") editor.format?.("indent", true);
    else editor.format?.(opt);
    return;
  }
  // FR-019, PRD Q183: About is modal; only About Vesta and Minimize act while it is open.
  if (useVesta.getState().aboutOpen && id !== "about" && id !== "minimize") return;
  closeTransient();
  const own = extra.get(id);
  if (own !== undefined) {
    own();
    return;
  }
  switch (id) {
    case "about":
      actions.openAbout();
      return;
    case "undo":
      menuUndoRedo(false, () => void actions.undo());
      return;
    case "redo":
      menuUndoRedo(true, () => undefined); // the list redo is the registry's (016 FR-003a)
      return;
    // 016 FR-017: the address of the one link at the editor's cursor or selection, as plain text.
    case "copyLink": {
      const href = menuEditor()?.linkAddress?.() ?? null;
      if (href !== null) {
        void window.vesta.clipboard.write({ text: href, html: null }).then(
          (r) => {
            if (!r.ok) reportError(`menu.copyLink ${r.error.code}`, r.error.message);
          },
          (err: unknown) => {
            reportError("menu.copyLink", err);
          },
        );
      }
      return;
    }
    case "settings":
      openSettings();
      return;
    case "view:tasks":
      actions.setView("tasks");
      return;
    case "view:archive":
      actions.setView("archive");
      return;
    case "view:trash":
      actions.setView("trash");
      return;
    case "showReminders":
      void actions.setRemindersCollapsed(!useVesta.getState().remindersCollapsed);
      return;
    case "showDetails":
      toggleDetails();
      return;
    // T024 (research §8): Export… and Import… open Settings at Data, where 008 shows their progress.
    case "export":
      // With the Data pane's include-logs choice (FR-003, PRD Q189); unticked when this opens Settings.
      openSettingsAt("data", () => void actions.exportData(useVesta.getState().includeLogs));
      return;
    case "import":
      openSettingsAt("data", () => void actions.importData());
      return;
    // T025, T027: actions on the target (the focused card, else the panel's item).
    case "reschedule": {
      const id = targetId();
      if (id !== null) void actions.reschedule(id);
      return;
    }
    // 015 FR-010: Edit › Postpone For, the quick duration the item names.
    case "postponeFor1":
    case "postponeFor2":
    case "postponeFor3":
    case "postponeFor4": {
      const taskId = targetId();
      const forMin = quickDurations(useVesta.getState().alertSettings)[menuCommand(id).duration ?? 0];
      if (taskId !== null) void actions.reschedule(taskId, forMin);
      return;
    }
    case "alertPeriod": {
      const id = targetId();
      if (id !== null) actions.openOverride(id);
      return;
    }
    case "deleteForever": {
      const card = selectedCard();
      if (card !== null) {
        void removeFromTrash(card, () => actions.confirmDeletePermanently(card.id));
        return;
      }
      const id = targetId();
      if (id !== null) void actions.confirmDeletePermanently(id);
      return;
    }
    // T026 (PRD Q180): the scope bar's options.
    case "searchEverything":
      actions.setIncludeArchiveTrash(!useVesta.getState().search.includeArchiveTrash);
      return;
    case "matchCase":
      actions.toggleMatchCase();
      return;
    case "exactPhrase":
      actions.toggleExactPhrase();
      return;
    // T028, T050: Show Logs and Check for Updates… open their Settings pane.
    case "showLogs":
      actions.openLogsFromNotice();
      actions.openLogViewer();
      return;
    case "checkUpdates":
      openSettingsAt("updates", () => void actions.checkForUpdates());
      return;
    // T029: fixed URLs, opened by main.
    case "help":
      void window.vesta.app.openHelp({ target: "readme" });
      return;
    case "releaseNotes":
      void window.vesta.app.openHelp({ target: "release" });
      return;
  }
  const action = menuCommand(id).action;
  if (action !== undefined) runAction(action);
}
