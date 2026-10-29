import { describe, expect, it } from "vitest";
import { MENU_COMMANDS, type MenuCommandId } from "../../../../src/domain/menu/commands";
import { enablement } from "../../../../src/domain/menu/enablement";
import { initialCommandState, type CommandState, type Editing, type FormatSnapshot, type Modal, type Target, type ViewName } from "../../../../src/domain/menu/state";

/**
 * The oracle: data-model.md "MenuItemStates", row by row, then the two sentences under the table, which override
 * every row (analysis L1): Settings, About or busy disable every item that changes an item or a setting; About
 * disables every custom item except About Vesta and Minimize (PRD Q183).
 */
const CHANGING = new Set<string>([
  "newTask", "newSub", "newRem", "import", "undo", "done", "reschedule", "alertPeriod", "trash", "restore",
  "deleteForever", "showReminders",
]);

function oracle(id: MenuCommandId, s: CommandState, shown: boolean): { enabled: boolean; checked?: boolean } {
  const t = s.target;
  const modalOk = s.modal === "none" || s.modal === "transient";
  const blocking = s.modal === "settings" || s.modal === "about";
  const selectionBase = shown && s.editing === "none";
  let enabled: boolean;
  let checked: boolean | undefined;
  const f = s.format;
  const fmtOk = (opt: string) => shown && f !== null && f.offered.includes(opt as never) && !f.disabled.includes(opt as never);
  if (id.startsWith("fmt:")) {
    const opt = id.slice(4);
    if (opt.startsWith("heading-")) {
      enabled = fmtOk("heading");
      checked = f !== null && f.heading === Number(opt.slice(8));
    } else if (["row-above", "row-below", "col-left", "col-right", "row-delete", "col-delete", "table-delete"].includes(opt)) {
      enabled = shown && f !== null && f.inTable && f.tableActions.includes(opt as never);
    } else if (opt === "table") {
      enabled = fmtOk("table") && f !== null && !f.inTable;
    } else {
      enabled = fmtOk(opt);
      checked = f !== null && f.pressed.includes(opt as never);
    }
  } else {
    switch (id) {
      case "about":
      case "help":
      case "releaseNotes":
        enabled = true;
        break;
      case "minimize":
        enabled = shown;
        break;
      case "settings":
      case "checkUpdates":
      case "showLogs":
        enabled = s.modal !== "about";
        break;
      case "newTask":
        enabled = !blocking && !s.busy;
        break;
      case "newRem":
        enabled = !blocking && !s.busy && !s.remindersFull;
        break;
      case "newSub":
        enabled = selectionBase && s.view === "tasks" && t !== null && t.kind === "task" && t.topLevel;
        break;
      case "export":
      case "import":
        enabled = !s.busy && s.modal !== "about";
        break;
      case "undo":
        enabled = s.modal !== "about" && (s.undoOffered || s.editing !== "none");
        break;
      case "redo":
        enabled = s.modal !== "about" && (s.redoOffered || s.editing !== "none");
        break;
      case "copyLink":
        enabled = s.modal !== "about" && s.linkAtCursor;
        break;
      case "find":
        enabled = !blocking;
        break;
      case "searchEverything":
        enabled = !blocking;
        checked = s.search.everything;
        break;
      case "matchCase":
        enabled = !blocking;
        checked = s.search.matchCase;
        break;
      case "exactPhrase":
        enabled = !blocking;
        checked = s.search.exactPhrase;
        break;
      case "done":
        enabled = selectionBase && modalOk && s.view === "tasks" && t !== null;
        break;
      // 018 FR-009: Move to Trash also acts on a selected Archive entry.
      case "trash":
        enabled = selectionBase && modalOk && (s.view === "tasks" || s.view === "archive") && t !== null;
        break;
      case "reschedule":
      case "postponeFor1":
      case "postponeFor2":
      case "postponeFor3":
      case "postponeFor4":
        enabled = selectionBase && modalOk && s.view === "tasks" && t !== null && t.kind !== "reminder";
        break;
      case "alertPeriod":
        enabled = selectionBase && modalOk && s.view === "tasks" && t !== null && t.kind !== "reminder";
        break;
      case "restore":
        enabled = selectionBase && s.view !== "tasks" && t !== null;
        break;
      case "deleteForever":
        enabled = selectionBase && s.view === "trash" && t !== null;
        break;
      case "view:tasks":
      case "view:archive":
      case "view:trash":
        enabled = !blocking;
        checked = s.view === id.slice(5);
        break;
      case "showReminders":
        enabled = !s.search.active && s.view === "tasks";
        checked = s.remindersExpanded;
        break;
      case "showDetails":
        enabled = selectionBase && t !== null && t.kind !== "reminder";
        checked = s.panelOpen;
        break;
      default:
        throw new Error(`no oracle row for ${id}`);
    }
  }
  if ((blocking || s.busy) && (CHANGING.has(id) || id.startsWith("fmt:"))) enabled = false;
  if (s.modal === "about" && id !== "about" && id !== "minimize") enabled = false;
  return checked === undefined ? { enabled } : { enabled, checked };
}

const VIEWS: ViewName[] = ["tasks", "archive", "trash"];
const TARGETS: (Target | null)[] = [
  null,
  { kind: "task", topLevel: true, stale: false },
  { kind: "task", topLevel: true, stale: true },
  { kind: "subtask", topLevel: false, stale: true },
  { kind: "reminder", topLevel: true, stale: false },
];
const EDITING: Editing[] = ["none", "text", "title", "reminder", "details"];
const MODALS: Modal[] = ["none", "settings", "about", "transient"];
const SNAPS: (FormatSnapshot | null)[] = [
  null,
  { offered: ["strong", "emphasis", "mark", "heading"], pressed: ["strong"], disabled: [], heading: 0, inTable: false, tableActions: [] },
  {
    offered: ["strong", "bullet", "indent", "outdent", "table", "heading", "check"],
    pressed: ["bullet"],
    disabled: ["indent"],
    heading: 2,
    inTable: false,
    tableActions: [],
  },
  { offered: ["strong", "table", "heading"], pressed: [], disabled: [], heading: 0, inTable: true, tableActions: ["row-below", "col-left", "table-delete"] },
];

function* states(): Generator<[CommandState, boolean]> {
  for (const view of VIEWS)
    for (const target of TARGETS)
      for (const editing of EDITING)
        for (const modal of MODALS)
          for (const busy of [false, true])
            for (const active of [false, true])
              for (const remindersFull of [false, true])
                for (const shown of [true, false]) {
                  const formats = editing === "title" || editing === "reminder" || editing === "details" ? SNAPS.slice(1) : [null];
                  for (const format of formats)
                    yield [
                      {
                        view,
                        target,
                        editing,
                        format,
                        remindersExpanded: !active,
                        panelOpen: target !== null && target.kind !== "reminder" && remindersFull,
                        search: { active, everything: busy, matchCase: active, exactPhrase: !active },
                        modal,
                        busy,
                        remindersFull,
                        undoOffered: active,
                        redoOffered: !active,
                        linkAtCursor: busy,
                      },
                      shown,
                    ];
                }
}

describe("013 SC-004 enablement over the finite matrix (data-model MenuItemStates)", () => {
  it("every item's enabled and checked state equals the table in every combination", () => {
    let n = 0;
    for (const [s, shown] of states()) {
      const got = enablement(s, shown);
      for (const c of MENU_COMMANDS) {
        const want = oracle(c.id, s, shown);
        const have = got[c.id];
        if (have.enabled !== want.enabled || (want.checked !== undefined && have.checked !== want.checked))
          throw new Error(`${c.id} ${JSON.stringify({ s, shown })}: got ${JSON.stringify(have)}, want ${JSON.stringify(want)}`);
        n++;
      }
    }
    expect(n).toBeGreaterThan(100_000);
  });

  const base: CommandState = {
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
  };
  const task: Target = { kind: "task", topLevel: true, stale: false };

  it("016 FR-017 Copy Link: enabled exactly while the editor's selection or cursor lies inside one safe link", () => {
    expect(enablement({ ...base, linkAtCursor: true, editing: "details" }, true).copyLink.enabled).toBe(true);
    expect(enablement({ ...base, linkAtCursor: false, editing: "details" }, true).copyLink.enabled).toBe(false);
    expect(enablement({ ...base, linkAtCursor: true, editing: "details", modal: "about" }, true).copyLink.enabled).toBe(false);
  });

  it("016 FR-003a Redo: enabled while a redo notice shows or an editor has the focus, otherwise disabled", () => {
    expect(enablement({ ...base, redoOffered: true }, true).redo.enabled).toBe(true);
    expect(enablement({ ...base, editing: "details" }, true).redo.enabled).toBe(true);
    expect(enablement({ ...base }, true).redo.enabled).toBe(false);
    expect(enablement({ ...base, undoOffered: true }, true).redo.enabled).toBe(false);
  });

  it("015 FR-002 Reschedule on every active task or subtask, stale or not; never on a reminder, the Archive or the Trash", () => {
    expect(enablement({ ...base, target: task }, true).reschedule.enabled).toBe(true);
    expect(enablement({ ...base, target: { ...task, stale: true } }, true).reschedule.enabled).toBe(true);
    expect(enablement({ ...base, target: { kind: "subtask", topLevel: false, stale: false } }, true).reschedule.enabled).toBe(true);
    expect(enablement({ ...base, target: { kind: "reminder", topLevel: true, stale: true } }, true).reschedule.enabled).toBe(false);
    expect(enablement({ ...base, target: null }, true).reschedule.enabled).toBe(false);
    expect(enablement({ ...base, view: "archive", target: task }, true).reschedule.enabled).toBe(false);
    expect(enablement({ ...base, view: "trash", target: task }, true).reschedule.enabled).toBe(false);
    expect(enablement({ ...base, modal: "about", target: task }, true).reschedule.enabled).toBe(false);
    for (const target of [task, { kind: "reminder", topLevel: true, stale: false } as Target, null]) {
      const e = enablement({ ...base, target }, true);
      for (const n of [1, 2, 3, 4] as const) expect(e[`postponeFor${n}`].enabled).toBe(e.reschedule.enabled);
    }
  });

  it("FR-015 Restore only in the Archive and Trash, Delete Permanently only in the Trash", () => {
    const e = (view: ViewName) => enablement({ ...base, view, target: task }, true);
    expect([e("tasks").restore.enabled, e("archive").restore.enabled, e("trash").restore.enabled]).toEqual([false, true, true]);
    expect([e("tasks").deleteForever.enabled, e("archive").deleteForever.enabled, e("trash").deleteForever.enabled]).toEqual([false, false, true]);
  });

  it("018 FR-009 Move to Trash acts on a selected entry in the Archive too, never in the Trash or with nothing selected", () => {
    const e = (view: ViewName, target: Target | null) => enablement({ ...base, view, target }, true);
    expect([e("tasks", task).trash.enabled, e("archive", task).trash.enabled, e("trash", task).trash.enabled]).toEqual([true, true, false]);
    expect(e("archive", { kind: "reminder", topLevel: true, stale: false }).trash.enabled).toBe(true);
    expect([e("tasks", null).trash.enabled, e("archive", null).trash.enabled]).toEqual([false, false]);
  });

  it("FR-016 Format enabled only while editing and only for offered, not-disabled ids", () => {
    expect(enablement(base, true)["fmt:strong"].enabled).toBe(false);
    const snap = SNAPS[2] as FormatSnapshot;
    const e = enablement({ ...base, editing: "details", format: snap }, true);
    expect(e["fmt:strong"].enabled).toBe(true);
    expect(e["fmt:indent"].enabled).toBe(false);
    expect(e["fmt:outdent"].enabled).toBe(true);
    expect(e["fmt:bullet"].checked).toBe(true);
    expect(e["fmt:heading-2"].checked).toBe(true);
    expect(e["fmt:link"].enabled).toBe(false);
  });

  it("FR-019 Settings or About open disables item-changing commands", () => {
    for (const modal of ["settings", "about"] as const) {
      const e = enablement({ ...base, modal, target: task }, true);
      expect([e.newTask.enabled, e.done.enabled, e.trash.enabled, e.import.enabled && modal === "about"]).toEqual([false, false, false, false]);
    }
  });

  it("FR-019 Q183 while About is open every custom item except About Vesta and Minimize is disabled", () => {
    const e = enablement({ ...base, modal: "about", target: task, undoOffered: true }, true);
    for (const c of MENU_COMMANDS) expect(e[c.id].enabled, c.id).toBe(c.id === "about" || c.id === "minimize");
  });

  it("FR-020 hidden window disables selection and Format items", () => {
    const e = enablement({ ...base, target: task, editing: "details", format: SNAPS[1] as FormatSnapshot }, false);
    expect([e.done.enabled, e.trash.enabled, e.newSub.enabled, e["fmt:strong"].enabled, e.minimize.enabled]).toEqual([false, false, false, false, false]);
    expect(e.newTask.enabled).toBe(true);
  });

  it("FR-021 Show Reminders disabled while searching", () => {
    expect(enablement({ ...base, search: { ...base.search, active: true } }, true).showReminders.enabled).toBe(false);
    expect(enablement(base, true).showReminders.enabled).toBe(true);
  });

  it("(OD3, Q181) selection items disabled while text is being edited", () => {
    for (const editing of ["text", "title", "reminder", "details"] as const) {
      const e = enablement({ ...base, editing, target: { ...task, stale: true }, panelOpen: true }, true);
      for (const id of ["done", "trash", "reschedule", "alertPeriod", "newSub", "showDetails"] as const) expect(e[id].enabled, `${editing} ${id}`).toBe(false);
    }
  });
});

describe("013 convergence T103 T104 T108", () => {
  const base = initialCommandState();
  const task = { kind: "task", topLevel: true, stale: false } as const;
  it("New Subtask only in the Tasks view (FR-015)", () => {
    for (const view of ["archive", "trash"] as const) expect(enablement({ ...base, view, target: task }, true).newSub.enabled, view).toBe(false);
    expect(enablement({ ...base, view: "tasks", target: task }, true).newSub.enabled).toBe(true);
  });
  it("Show Details is disabled on a focused reminder even with a panel open (US1-9)", () => {
    const e = enablement({ ...base, target: { kind: "reminder", topLevel: true, stale: false }, panelOpen: true }, true);
    expect(e.showDetails).toEqual({ enabled: false, checked: true });
    expect(enablement({ ...base, target: null, panelOpen: false }, true).showDetails.enabled).toBe(false);
  });
  it("Export… stays enabled while Settings is open; Import… does not (FR-019, data model)", () => {
    const e = enablement({ ...base, modal: "settings" }, true);
    expect([e.export.enabled, e.import.enabled]).toEqual([true, false]);
    expect(enablement({ ...base, busy: true }, true).export.enabled).toBe(false);
  });
});
