/**
 * The unified toolbar (HIG identity review, B · Hearth; 013 FR-032, PRD Q166, Q167): the window identity
 * (the hearth mark in gold and "Vesta" in Marcellus, naming no view), the centered search box with its options, and
 * Archive and Trash with their counts (the pressed one is the current view; FR-002, FR-020). Tasks are added from
 * the list's footer row and the New task shortcut; Settings is in the menu bar. On macOS the toolbar sits in the
 * title bar (hiddenInset) and is the window's drag region except its controls (FR-033, PRD Q169).
 */
import { useMemo, useRef } from "react";
import { reminderCounts } from "../../domain/reminder-views";
import { counts } from "../../domain/tree";
import { t } from "../i18n/t";
import { actions, useVesta, type View } from "../store/store";
import { SearchBox } from "../features/search/SearchBox";
import { ArchiveIcon, Hearth, TrashIcon } from "./icons";
import { useToolbarFit } from "./toolbar-fit";

function NavButton({ view, label, count, icon }: { view: View; label: string; count: number; icon: React.ReactNode }) {
  const current = useVesta((s) => s.view);
  return (
    <button
      type="button"
      className="navbtn"
      title={label}
      aria-pressed={current === view}
      onClick={() => {
        actions.setView(current === view ? "tasks" : view);
      }}
    >
      {icon}
      <span className="lbl">{label}</span>
      <span className="n">{count}</span>
    </button>
  );
}

export function Header() {
  const rows = useVesta((s) => s.tasks);
  const reminderRows = useVesta((s) => s.reminders);
  // FR-020: the counts include the reminders each view holds.
  const n = useMemo(() => {
    const tasks = counts(Object.values(rows));
    const reminders = reminderCounts(Object.values(reminderRows));
    return { archive: tasks.archive + reminders.archive, trash: tasks.trash + reminders.trash };
  }, [rows, reminderRows]);
  // 014 FR-012 (PRD Q202): on a narrow window the toolbar gives way step by step instead of overlapping.
  const bar = useRef<HTMLElement>(null);
  useToolbarFit(bar);
  return (
    <header className="topbar" ref={bar}>
      <div className="brand">
        <Hearth flame="var(--flame)" />
        {/* 018 FR-001 (PRD Q270): Vesta CE, the edition as an exponent; screen readers hear it written out. */}
        <span className="brand-name">
          {t("appName")}
          <sup className="ed" aria-hidden="true">
            {t("editionMark")}
          </sup>
          <span className="sr-only">{t("editionName")}</span>
        </span>
      </div>
      <SearchBox />
      <nav className="nav" aria-label={t("views")}>
        <NavButton view="archive" label={t("menuArchive")} count={n.archive} icon={<ArchiveIcon />} />
        <NavButton view="trash" label={t("menuTrash")} count={n.trash} icon={<TrashIcon />} />
      </nav>
    </header>
  );
}
