/**
 * 013 handlers (contracts/ipc.md): the renderer's command state for the menu, the native confirmation of Delete
 * Permanently (FR-018, PRD Q175), and Vesta Help and Release Notes on fixed URLs only (FR-008).
 */
import type { CommandState } from "../../domain/menu/state";
import type { AsyncHandlers, Handlers } from "./handlers";

export interface MenuHandlerDeps {
  setMenuState: (state: CommandState) => void;
  /** Resolves true when the user chose Delete Permanently. */
  confirmDeleteForever: (title: string) => Promise<boolean>;
  /** The two fixed addresses, built from the release repository. */
  helpUrls: () => { readme: string; release: string };
  openExternal: (url: string) => Promise<void>;
  log: { warn: (event: string, fields?: Record<string, unknown>) => void };
}

export function buildMenuHandlers(deps: MenuHandlerDeps): { handlers: Handlers; asyncHandlers: AsyncHandlers } {
  return {
    handlers: {
      "menu:set-state": (state) => {
        deps.setMenuState(state);
        return null;
      },
      "app:open-help": ({ target }) => {
        const urls = deps.helpUrls();
        // CHK038: a failure is logged; the browser reports its own errors.
        deps.openExternal(target === "readme" ? urls.readme : urls.release).catch((err: unknown) => {
          deps.log.warn("help.open-failed", { kind: target, message: err instanceof Error ? err.message : String(err) });
        });
        return null;
      },
    },
    asyncHandlers: {
      "dialog:confirm-delete-forever": async ({ title }) => ({ confirmed: await deps.confirmDeleteForever(title) }),
    },
  };
}
