// HIG identity (§7): the system font for everything people read; Marcellus for the wordmark only.
import "@fontsource/marcellus/400.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/markdown.css";
import "./styles/details.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startAlertDriver } from "./alerts/driver";
import { flushAll } from "./store/flush";
import { reportError } from "./report";
import { actions, notify, useVesta } from "./store/store";
import { installTestHooks } from "./test-hooks";
import { runCommand } from "./menu/run-command";
import { startPublishingState } from "./menu/publish-state";
import { reportMissingKeys } from "./i18n/t";
import { loadEditor } from "./editor/load";
import { spikeHooks } from "./editor/spike-hooks";
import { paintAll, watchThemeForPaint } from "./markdown/paint";
import type { NotificationEvent } from "../domain/notifications";

// 011 FR-009: colored spans are repainted for the theme whenever it changes.
watchThemeForPaint();

// FR-040: every error in the window reaches the local log.
window.addEventListener("error", (e) => {
  reportError("window.error", e.error ?? e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  reportError("window.unhandledrejection", e.reason);
});

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
// The alert driver starts once the rows are loaded, and ticks at once (003 FR-018).
void actions.loadInitial().then(() => {
  // Unpackaged builds: a string that falls back to English or to its key goes to the log (research §1).
  if (useVesta.getState().testHooks) {
    reportMissingKeys((key, lang) => {
      void window.vesta.app.logError({ message: `i18n.missing ${lang} ${key}`, stack: null, context: "i18n" });
    });
  }
  // The editors load in the background, so the first panel or inline edit opens at once (SC-003).
  setTimeout(() => {
    void loadEditor().catch(() => undefined);
  }, 0);
  // Unpackaged builds only: the e2e switch for "moving disabled" (004 research §8) and the 005 editor hooks.
  installTestHooks(
    useVesta.getState(),
    window,
    {
      ...spikeHooks((on) => {
        actions.setMovingDisabled(on);
      }),
      paintAllMs: (theme) => {
        const t0 = performance.now();
        paintAll(document.body, theme);
        return performance.now() - t0;
      },
      showNotice: (event) => {
        notify(event as NotificationEvent);
      },
    },
  );
  startAlertDriver();
});

window.vesta.on("notice:backup-failed", ({ lastBackupAt }) => {
  notify({ type: "showInfo", kind: "backupFailed", lastBackupAt });
});
window.vesta.on("notice:data-damaged", () => {
  notify({ type: "showSticky", kind: "dataDamaged" });
});

window.vesta.on("tasks:purged", ({ removals, reminderRemovals }) => {
  actions.removeRows(removals);
  actions.removeReminderRows(reminderRemovals);
});

// 006: a background index fill ended; a search that waited on it runs again (FR-025).
window.vesta.on("search:indexed", () => {
  actions.searchIndexed();
});

// 006 FR-011: moving is off while a search is active. Only a change of that state touches the switch, so
// 004's test hook keeps working while no search starts or ends.
useVesta.subscribe((state, prev) => {
  if (state.search.active !== prev.search.active) actions.setMovingDisabled(state.search.active);
});

// 013 research §2: a menu bar item was clicked; the same handlers as the toolbar, context menu and keys run it.
window.vesta.on("menu:command", ({ id }) => {
  runCommand(id);
});
// 013 research §3: the menu's enabled and checked states follow the store and the focus.
startPublishingState();

// 009: the update check's state changed in main (contracts/ipc.md).
window.vesta.on("updates:state", (state) => {
  actions.applyUpdateState(state);
});

// 010 Q133 (FR-033): a reminder to check for updates is due.
window.vesta.on("updates:reminder", () => {
  actions.showReminder();
});

// 007 FR-015: Use system language and the OS language changed.
window.vesta.on("settings:language", ({ language }) => {
  actions.applyLanguage(language);
});

// Window closing or app quitting: commit open edits, then tell main it may go on (FR-039a).
window.vesta.on("app:flush", () => {
  void flushAll()
    .catch((err: unknown) => {
      reportError("flush", err);
    })
    .finally(() => void window.vesta.app.flushDone());
});
