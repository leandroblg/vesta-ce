/**
 * The application menu's live state (013 research §3, §6): the last command state the renderer sent, whether the
 * window is shown, and the menu built from them. A state change sets `enabled` and `checked` in place; a language,
 * shortcut or window change rebuilds the menu and applies the last state again.
 */
import type { Menu } from "electron";
import { enablement } from "../domain/menu/enablement";
import { initialCommandState, type CommandState } from "../domain/menu/state";
import { applyState, type MenuOptions } from "./menu";

export interface MenuControllerDeps {
  /** Builds the menu from the options and installs it as the application menu. */
  install: (options: MenuOptions) => Pick<Menu, "getMenuItemById">;
  /** The options that change with the language and the shortcuts, read at each rebuild. */
  options: () => Omit<MenuOptions, "windowShown" | "states">;
}

export class MenuController {
  private state: CommandState = initialCommandState();
  private shown = true;
  private menu: Pick<Menu, "getMenuItemById"> | null = null;

  constructor(private readonly deps: MenuControllerDeps) {}

  get windowShown(): boolean {
    return this.shown;
  }

  get commandState(): CommandState {
    return this.state;
  }

  rebuild(): void {
    const states = enablement(this.state, this.shown);
    this.menu = this.deps.install({ ...this.deps.options(), windowShown: this.shown, states });
  }

  setState(state: CommandState): void {
    this.state = state;
    applyState(this.menu, enablement(state, this.shown));
  }

  /** The window was shown or hidden (FR-020): the menu is rebuilt, since registered accelerators change. */
  setWindowShown(shown: boolean): void {
    if (shown === this.shown) return;
    this.shown = shown;
    this.rebuild();
  }
}
