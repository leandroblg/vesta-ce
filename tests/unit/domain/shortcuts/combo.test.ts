import { describe, expect, it } from "vitest";
import { SHORTCUT_ACTIONS, actionById } from "../../../../src/domain/shortcuts/actions";
import { fromKeyEvent, label, spoken, type KeyNames } from "../../../../src/domain/shortcuts/combo";

const key = (k: string, code: string, mods: Partial<{ meta: boolean; ctrl: boolean; alt: boolean; shift: boolean }> = {}) => ({
  key: k,
  code,
  metaKey: mods.meta ?? false,
  ctrlKey: mods.ctrl ?? false,
  altKey: mods.alt ?? false,
  shiftKey: mods.shift ?? false,
});

const NAMES: KeyNames = {
  cmd: "Cmd",
  ctrl: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  option: "Option",
  enter: "Enter",
  esc: "Esc",
  delete: "Delete",
  backspace: "Backspace",
  tab: "Tab",
  space: "Space",
  home: "Home",
  end: "End",
  pageUp: "Page Up",
  pageDown: "Page Down",
  insert: "Insert",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
};

const SPOKEN: KeyNames = { ...NAMES, cmd: "Command", ctrl: "Control" };

describe("SHORTCUT_ACTIONS (007 FR-020, data-model)", () => {
  it("holds the 23 actions in FR-020 order, 012 adding the indent keys, then 013's menu commands (FR-048)", () => {
    expect(SHORTCUT_ACTIONS.map((a) => a.id)).toEqual([
      "newTask",
      "newSub",
      "newRem",
      "search",
      "up",
      "down",
      "open",
      "edit",
      "done",
      "del",
      "moveUp",
      "moveDown",
      "promote",
      "demote",
      "collapse",
      "expand",
      "close",
      "settings",
      "undo",
      "restore",
      "minimize",
      "indentItem",
      "outdentItem",
      "copyLink",
      "about",
      "checkUpdates",
      "export",
      "import",
      "searchEverything",
      "matchCase",
      "exactPhrase",
      "reschedule",
      "postponeFor1",
      "postponeFor2",
      "postponeFor3",
      "postponeFor4",
      "alertPeriod",
      "deleteForever",
      "view:tasks",
      "view:archive",
      "view:trash",
      "showReminders",
      "showLogs",
      "help",
      "releaseNotes",
      "fmt:underline",
      "fmt:color",
      "fmt:bg",
      "fmt:size-up",
      "fmt:size-down",
      "fmt:row-above",
      "fmt:row-below",
      "fmt:col-left",
      "fmt:col-right",
      "fmt:row-delete",
      "fmt:col-delete",
      "fmt:table-delete",
      "fmt:link",
      "fmt:insert",
    ]);
  });

  it("has the data-model defaults, kinds and views", () => {
    const d = (id: Parameters<typeof actionById>[0], isMac = false) => actionById(id).defaults(isMac);
    expect(d("newTask")).toEqual(["Mod+N"]);
    expect(d("newSub")).toEqual(["Mod+Shift+N"]);
    expect(d("newRem")).toEqual(["Mod+Shift+R"]);
    expect(d("search")).toEqual(["Mod+F"]);
    expect(d("open")).toEqual(["Enter"]);
    expect(d("edit")).toEqual(["F2"]);
    expect(d("done")).toEqual(["Mod+Enter"]);
    expect(d("del")).toEqual(["Delete", "Backspace"]);
    expect(d("promote")).toEqual(["Alt+ArrowLeft"]);
    expect(d("close")).toEqual(["Escape"]);
    expect(d("settings")).toEqual(["Mod+,"]);
    expect(d("undo")).toEqual(["Mod+Z"]);
    expect(d("restore")).toEqual(["Shift+Enter"]); // 011 FR-022b
    expect(actionById("restore").views).toEqual(["archive", "trash"]);
    expect(actionById("open").views).toEqual(["main", "archive", "trash"]); // 011 FR-022b
    expect(actionById("del").views).toEqual(["main", "archive"]); // 013 PRD Q187, 018 FR-009
    expect(actionById("minimize").kind).toBe("global");
    expect(d("minimize", true)).toEqual(["Mod+M"]);
    expect(d("minimize", false)).toEqual([]);
    expect(SHORTCUT_ACTIONS.filter((a) => a.kind === "global").map((a) => a.id)).toEqual([
      "newTask",
      "newSub",
      "newRem",
      "search",
      "settings",
      "minimize",
    ]);
  });
});

describe("fromKeyEvent (research §9)", () => {
  it("maps Cmd on macOS and Ctrl elsewhere to Mod", () => {
    expect(fromKeyEvent(key("n", "KeyN", { meta: true }), true)).toBe("Mod+N");
    expect(fromKeyEvent(key("n", "KeyN", { ctrl: true }), false)).toBe("Mod+N");
  });

  it("keeps Ctrl on macOS apart from Mod", () => {
    expect(fromKeyEvent(key("n", "KeyN", { ctrl: true }), true)).toBe("Ctrl+N");
  });

  it("takes the character from the key's code when Shift or Alt changes it", () => {
    expect(fromKeyEvent(key("<", "Comma", { meta: true, shift: true }), true)).toBe("Mod+Shift+,");
    expect(fromKeyEvent(key("˜", "KeyN", { alt: true }), true)).toBe("Alt+N");
  });

  it("names special keys", () => {
    expect(fromKeyEvent(key("ArrowUp", "ArrowUp", { alt: true }), false)).toBe("Alt+ArrowUp");
    expect(fromKeyEvent(key("F2", "F2"), false)).toBe("F2");
    expect(fromKeyEvent(key(" ", "Space"), false)).toBe("Space");
    expect(fromKeyEvent(key("Escape", "Escape"), false)).toBe("Escape");
  });

  it("uses the layout's character without Shift or Alt", () => {
    // French AZERTY: the comma is on the M position.
    expect(fromKeyEvent(key(",", "KeyM", { ctrl: true }), false)).toBe("Mod+,");
  });

  it("ignores a press of modifiers only", () => {
    expect(fromKeyEvent(key("Shift", "ShiftLeft", { shift: true }), false)).toBeNull();
    expect(fromKeyEvent(key("Meta", "MetaLeft", { meta: true }), true)).toBeNull();
  });

  it("writes the modifiers in the order Mod, Ctrl, Shift, Alt", () => {
    expect(fromKeyEvent(key("Ω", "KeyZ", { meta: true, alt: true, shift: true, ctrl: true }), true)).toBe("Mod+Ctrl+Shift+Alt+Z");
  });
});

describe("label and spoken (research §9, FR-033)", () => {
  it("uses symbols on macOS and words joined by + elsewhere", () => {
    expect(label("Mod+Shift+N", true, NAMES)).toBe("⇧⌘N"); // Apple order: ⌃⌥⇧⌘
    expect(label("Alt+ArrowUp", true, NAMES)).toBe("⌥↑");
    expect(label("Mod+Shift+N", false, NAMES)).toBe("Ctrl+Shift+N");
    expect(label("Mod+Shift+N", false, { ...NAMES, shift: "Maj" })).toBe("Ctrl+Maj+N");
    expect(label("Delete", false, { ...NAMES, delete: "Suppr" })).toBe("Suppr");
  });

  it("reads combinations in words", () => {
    expect(spoken("Mod+Shift+N", true, SPOKEN)).toBe("Command Shift N");
    expect(spoken("Mod+Shift+N", false, SPOKEN)).toBe("Control Shift N");
    expect(spoken("Alt+ArrowUp", true, SPOKEN)).toBe("Option Up");
  });
});

describe("011 US6 Return on macOS", () => {
  it("FR-031 Mark done reads ⌘↩ on macOS and Ctrl+Enter elsewhere", () => {
    expect(label("Mod+Enter", true, NAMES)).toBe("⌘↩");
    expect(label("Mod+Enter", false, NAMES)).toBe(`${NAMES.ctrl}+${NAMES.enter}`);
    expect(label("Shift+Enter", true, NAMES)).toBe("⇧↩");
  });

  it("FR-031 spoken uses the names it is given (the caller passes Return on macOS)", () => {
    expect(spoken("Mod+Enter", true, { ...SPOKEN, enter: "Return" })).toBe("Command Return");
    expect(spoken("Mod+Enter", false, SPOKEN)).toBe(`Control ${SPOKEN.enter}`);
  });
});
