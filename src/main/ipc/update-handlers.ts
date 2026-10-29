/**
 * 009 handlers for the update check (contracts/ipc.md): check now, the automatic-check setting, Settings opened,
 * and opening a checked release address in the default browser (FR-021, FR-021a, FR-024a, FR-024b).
 */
import type Database from "better-sqlite3";
import type { Clock } from "../../domain/clock";
import { hostOnly } from "../../domain/logs/redact";
import { DomainError } from "../../domain/task";
import { checkReleaseUrl, type RepoRef } from "../../domain/updates/releases";
import type { ShellLike } from "../assets/open";
import { saveAutoUpdateCheck, saveUpdateReminder, saveUpdateReminderDays } from "../db/settings-repo";
import type { Logger } from "../log";
import type { UpdateScheduler } from "../updates/scheduler";
import type { AsyncHandlers, Handlers } from "./handlers";

export interface UpdateHandlerDeps {
  db: () => Database.Database;
  clock: Clock;
  scheduler: () => UpdateScheduler;
  shell: Pick<ShellLike, "openExternal">;
  repo: RepoRef;
  log: Pick<Logger, "warn">;
}

export function buildUpdateHandlers(deps: UpdateHandlerDeps): { handlers: Handlers; asyncHandlers: AsyncHandlers } {
  return {
    handlers: {
      // A user setting: its `settings:` name ends a pending Undo import offer (008 FR-037b; analysis M1).
      "settings:set-auto-update-check": ({ on }) => {
        saveAutoUpdateCheck(deps.db(), on, deps.clock.now());
        return deps.scheduler().setAuto(on);
      },
      // 010 Q133 (FR-034, FR-035): the reminder switch and period are user settings; the scheduler applies them at once.
      "settings:set-update-reminder": ({ on }) => {
        saveUpdateReminder(deps.db(), on, deps.clock.now());
        deps.scheduler().setReminder(on);
        return null;
      },
      "settings:set-update-reminder-days": ({ days }) => {
        saveUpdateReminderDays(deps.db(), days, deps.clock.now());
        deps.scheduler().setReminderDays(days);
        return null;
      },
      // 013 FR-024 (PRD Q176): the Updates pane is shown; the mark and the Dock badge go.
      "updates:pane-shown": (req) => deps.scheduler().updatesShown(req.shown),
      "updates:open": ({ target }) => {
        const links = deps.scheduler().links();
        const url = target === "file" ? links.file : links.release;
        if (url === null) throw new DomainError("INVALID", "no release address to open");
        // Checked when the list was read; checked again before the browser gets it (FR-024b).
        if (!checkReleaseUrl(url, deps.repo, target === "file" ? "file" : "page")) {
          deps.log.warn("update.link-refused", { ...hostOnly(url) });
          throw new DomainError("INVALID", "refused release address");
        }
        void deps.shell.openExternal(url);
        return null;
      },
    },
    asyncHandlers: {
      "updates:check": () => deps.scheduler().checkNow(),
    },
  };
}
