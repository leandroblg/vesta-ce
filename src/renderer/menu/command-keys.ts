/**
 * 013 FR-048 (PRD Q186, Q187): the keys of the menu commands. Each runs its command through the same router as the
 * menu bar, and only where its menu item is enabled now (FR-015, FR-016, FR-019), so a key and a click never differ.
 */
import { enablement } from "../../domain/menu/enablement";
import { commandState } from "../../domain/menu/state";
import { isMenuCommandId } from "../../domain/menu/commands";
import { SHORTCUT_ACTIONS } from "../../domain/shortcuts/actions";
import { registerHandler } from "../keyboard/registry";
import { gatherInput } from "./publish-state";
import { runCommand } from "./run-command";

/** The actions FR-048 added: the menu commands' own ids (the older actions keep their handlers). */
const SELECTION_COMMANDS = new Set<string>(["reschedule", "postponeFor1", "postponeFor2", "postponeFor3", "postponeFor4", "alertPeriod", "deleteForever"]);
const COMMAND_ACTIONS = SHORTCUT_ACTIONS.filter((a) => a.kind === "command" || a.kind === "format" || SELECTION_COMMANDS.has(a.id));

export function installCommandKeys(): () => void {
  const off = COMMAND_ACTIONS.map((a) =>
    registerHandler(a.id, () => {
      const id = a.id;
      if (!isMenuCommandId(id)) return false;
      if (!enablement(commandState(gatherInput()), true)[id].enabled) return false;
      runCommand(id);
      return true;
    }),
  );
  return () => {
    for (const f of off) f();
  };
}
