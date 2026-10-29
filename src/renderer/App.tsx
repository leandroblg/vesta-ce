import { Announcer } from "./components/Announcer";
import { Header } from "./components/Header";
import { Notification } from "./components/Notification";
import { AssetNotice } from "./components/AssetNotice";
import { LinkContextMenu } from "./components/LinkContextMenu";
import { ArchiveView } from "./features/archive/ArchiveView";
import { RemindersSection } from "./features/reminders/RemindersSection";
import { TaskList } from "./features/tasks/TaskList";
import { DropOverlay } from "./features/tasks/drag/DropOverlay";
import { TrashView } from "./features/trash/TrashView";
import { useVesta } from "./store/store";
import { DetailsPanel } from "./features/details/DetailsPanel";
import { useEffect } from "react";
import { startSearchHighlights } from "./features/search/highlight";
import { SearchElsewhere } from "./features/search/SearchElsewhere";
import { installRegistry } from "./keyboard/registry";
import { installShortcutHandlers } from "./keyboard/handlers";
import { installCommandKeys } from "./menu/command-keys";
import { SettingsDialog } from "./features/settings/SettingsDialog";
import { AboutDialog } from "./features/about/AboutDialog";
import { startSearchAnnouncements } from "./features/search/announce";

export function App() {
  const ready = useVesta((s) => s.ready);
  const view = useVesta((s) => s.view);
  // HIG identity: on macOS the toolbar sits in the title bar (hiddenInset) and leaves room for the traffic lights.
  const isMac = useVesta((s) => s.isMac);
  // 015 FR-027a: a dialog open over the toolbar turns its drag region off.
  const modalOpen = useVesta((s) => s.settingsOpen || s.aboutOpen);
  // 007 FR-017: a language switch re-renders the whole tree (not a remount, so edits stay).
  useVesta((s) => s.language);
  // 006 FR-012: the search highlight follows the search and what the main view renders.
  useEffect(() => startSearchHighlights(document.body), []);
  // 007: every shortcut goes through one registry (research §10); 006's Cmd/Ctrl+F is its `search` action.
  useEffect(() => installRegistry(), []);
  useEffect(() => installShortcutHandlers(), []);
  // 013 FR-048: the menu commands' keys.
  useEffect(() => installCommandKeys(), []);
  // 006 FR-023: the polite result announcements.
  useEffect(() => startSearchAnnouncements(), []);
  return (
    <div
      className={`app${isMac ? " mac" : ""}${modalOpen ? " modal-open" : ""}`}
    >
      <Header />
      <div className="workspace">
        <main className="main" aria-busy={!ready}>
          {/* 018 FR-027, FR-028: the neutral target that takes the focus when the selection is cleared. */}
          <div className="main-inner" tabIndex={-1}>
            {ready && view === "tasks" && (
              <>
                <RemindersSection />
                <TaskList />
                <SearchElsewhere />
                <DropOverlay />
              </>
            )}
            {ready && view === "archive" && <ArchiveView />}
            {ready && view === "trash" && <TrashView />}
          </div>
        </main>
        {ready && <DetailsPanel />}
      </div>
      {ready && <SettingsDialog />}
      {ready && <AboutDialog />}
      <Notification />
      <AssetNotice />
      <LinkContextMenu />
      <Announcer />
    </div>
  );
}
