// 013 T094 (FR-048, PRD Q186): a Format command is a shortcut action exactly when the editor does not also make it
// from typed markdown; the list of exceptions is checked against the details editor's own input rules.
import { describe, expect, it } from "vitest";
import * as commonmark from "@milkdown/kit/preset/commonmark";
import * as gfm from "@milkdown/kit/preset/gfm";
import { FORMAT_OPTION_IDS, FORMAT_SHORTCUT_IDS, INPUT_RULE_FORMATS } from "../../../src/domain/menu/commands";
import { checklistInputRule, markInputRule, presetFor } from "../../../src/renderer/editor/create-editor";

const RULES: Record<string, unknown> = { ...commonmark, ...gfm, markInputRule, checklistInputRule };

describe("013 FR-048 the Format shortcut actions and the editor's input rules", () => {
  const details = presetFor("details").flat(3);

  it.each(Object.entries(INPUT_RULE_FORMATS))("%s comes from typed markdown: %s is in the details editor", (_id, rule) => {
    const plugin = RULES[rule];
    expect(plugin, rule).toBeDefined();
    const parts = Array.isArray(plugin) ? (plugin as unknown[]).flat(3) : [plugin];
    for (const part of parts) expect(details, rule).toContain(part);
  });

  it("every other Format command is a shortcut action, and no command with an input rule is", () => {
    const all = FORMAT_OPTION_IDS.map((o) => `fmt:${o}`);
    for (const id of all) {
      const typed = id in INPUT_RULE_FORMATS;
      const own = id === "fmt:indent" || id === "fmt:outdent";
      expect((FORMAT_SHORTCUT_IDS as readonly string[]).includes(id), id).toBe(!typed && !own);
    }
    expect(FORMAT_SHORTCUT_IDS).toEqual([
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
});
