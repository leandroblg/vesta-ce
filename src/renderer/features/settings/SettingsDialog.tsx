/**
 * Settings (007 FR-001 to FR-008, research §8; HIG identity review): a native modal dialog laid out like a
 * macOS settings window (direction A · System): a toolbar of panes at the top, the pane's name as its title, and
 * forms whose labels sit on the left and controls on the right. Every change applies at once. The panes hold the
 * PRD A6 sections: General (appearance, theme, language, table sizes), Alerts, Shortcuts, Data (export and import,
 * logs) and Updates; About is a window of its own (013 FR-025, FR-027). The last pane shown is the one that opens
 * next time; a notice opens its own pane.
 */
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import type {
  AlertSettingKey,
  QUICK_RESCHEDULE_KEYS,
} from "../../../domain/alert-settings";
import { BANDS, useDialogGeometry } from "../../components/use-dialog-geometry";
import {
  Bell,
  Close,
  Download,
  Drive,
  Keyboard,
  Sliders,
} from "../../components/icons";
import { t, type MessageKey } from "../../i18n/t";
import { focusCard } from "../../keyboard/selection";
import { actions, useVesta, type SettingsPane } from "../../store/store";
import { CleanupSection } from "./CleanupSection";
import { DataSection } from "./DataSection";
import { DurationFields } from "./DurationFields";
import { LanguageSelect } from "./LanguageSelect";
import { LogsSection } from "./LogsSection";
import { UpdatesSection } from "./UpdatesSection";
import { ShortcutTable } from "./ShortcutTable";
import { SEARCH_INPUT_ID } from "../search/SearchBox";
import { ThemeGroup } from "./ThemeGroup";
import { PaletteSelect } from "./PaletteSelect";
import { TableOrderSetting } from "./TableOrderSetting";

const PANES: readonly {
  id: SettingsPane;
  label: MessageKey;
  icon: React.ReactNode;
}[] = [
  { id: "general", label: "paneGeneral", icon: <Sliders /> },
  { id: "alerts", label: "alerts", icon: <Bell /> },
  { id: "shortcuts", label: "paneShortcuts", icon: <Keyboard /> },
  { id: "data", label: "paneData", icon: <Drive /> },
  { id: "updates", label: "updates", icon: <Download /> },
];

/** The element that had focus before Settings opened (research §8, CHK022). */
let opener: HTMLElement | null = null;

export function rememberOpener(): void {
  opener =
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null;
}

function restoreFocus(): void {
  const back = opener;
  opener = null;
  if (back?.isConnected === true) {
    back.focus();
    return;
  }
  // The opener is gone (an inline editor the opening closed): its card, else the search box (013: no cogwheel).
  const card = useVesta.getState().settingsReturnFocus;
  if (card !== null && card !== "cog") focusCard(card);
  else document.getElementById(SEARCH_INPUT_ID)?.focus();
}

/** 018 FR-037 (PRD Q288): each group saves on leaving it, on Enter, or 2 s after the last edit (DurationFields). */
const ALERTS: readonly {
  key: AlertSettingKey;
  legend: MessageKey;
  help: MessageKey;
}[] = [
  {
    key: "alertPeriodMin",
    legend: "alertDefault",
    help: "alertDefaultHelp",
  },
  {
    key: "reblinkIntervalMin",
    legend: "reblink",
    help: "reblinkHelp",
  },
  { key: "rescheduleToleranceMin", legend: "tolerance", help: "toleranceHelp" },
];

function Alerts() {
  const settings = useVesta((s) => s.alertSettings);
  return (
    <section className="sset" aria-labelledby="set-alerts-h">
      <h3 id="set-alerts-h">{t("alerts")}</h3>
      {ALERTS.map((a) => (
        <DurationFields
          key={a.key}
          className="srow"
          limits={a.key}
          legend={t(a.legend)}
          help={t(a.help)}
          value={settings[a.key]}
          onValid={(minutes) => actions.setAlertSetting(a.key, minutes)}
        />
      ))}
    </section>
  );
}

/** 015 FR-012 (PRD Q207, Q221): the four quick reschedule durations, each a group of time fields (018 FR-037). */
const QUICK: readonly {
  key: (typeof QUICK_RESCHEDULE_KEYS)[number];
  legend: MessageKey;
}[] = [
  { key: "quickReschedule1Min", legend: "quickFirst" },
  { key: "quickReschedule2Min", legend: "quickSecond" },
  { key: "quickReschedule3Min", legend: "quickThird" },
  { key: "quickReschedule4Min", legend: "quickFourth" },
];

function QuickDurations() {
  const settings = useVesta((s) => s.alertSettings);
  return (
    <section className="sset" aria-labelledby="set-quick-h">
      <h3 id="set-quick-h">{t("quickDurations")}</h3>
      <p className="help">{t("quickHelp")}</p>
      {QUICK.map((q) => (
        <DurationFields
          key={q.key}
          className="srow"
          limits={q.key}
          legend={t(q.legend)}
          value={settings[q.key]}
          onValid={(minutes) => actions.setAlertSetting(q.key, minutes)}
        />
      ))}
    </section>
  );
}

/** The toolbar of panes: one Tab stop, arrows move between panes (WAI-ARIA tabs). */
function PaneTabs({
  pane,
  onPick,
}: {
  pane: SettingsPane;
  onPick: (p: SettingsPane) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  // 013 FR-024 (PRD Q167, Q176): the update mark moved here from the cogwheel; its name says so too.
  const mark = useVesta((s) => s.update.mark);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = PANES.findIndex((p) => p.id === pane);
    const step =
      e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowLeft"
          ? -1
          : e.key === "Home"
            ? -i
            : e.key === "End"
              ? PANES.length - 1 - i
              : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = PANES[(i + step + PANES.length) % PANES.length];
    if (next === undefined) return;
    onPick(next.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-pane="${next.id}"]`)
      ?.focus();
  }
  return (
    <div
      className="set-tabs"
      role="tablist"
      aria-label={t("settings")}
      ref={list}
      onKeyDown={onKeyDown}
    >
      {PANES.map((p) => (
        <button
          key={p.id}
          type="button"
          role="tab"
          id={`set-tab-${p.id}`}
          className="set-tab"
          data-pane={p.id}
          aria-selected={pane === p.id}
          aria-controls={`set-pane-${p.id}`}
          aria-label={
            p.id === "updates" && mark ? t("updatesTabMark") : undefined
          }
          data-mark={p.id === "updates" && mark ? "" : undefined}
          tabIndex={pane === p.id ? 0 : -1}
          onClick={() => {
            onPick(p.id);
          }}
        >
          {p.icon}
          <span>{t(p.label)}</span>
          {p.id === "updates" && mark && (
            <span
              className="tab-mark"
              aria-hidden="true"
              data-testid="updates-mark"
            />
          )}
        </button>
      ))}
    </div>
  );
}

/** What the head, the title and the visible pane need at their natural height (015 FR-026, research §10). */
function naturalHeight(modal: HTMLElement): number {
  const head =
    modal.querySelector<HTMLElement>(".modal-head")?.offsetHeight ?? 0;
  const title =
    modal.querySelector<HTMLElement>(".pane-title")?.offsetHeight ?? 0;
  const body = modal.querySelector<HTMLElement>(".modal-body");
  if (body === null) return head + title;
  const style = getComputedStyle(body);
  const pane =
    body.querySelector<HTMLElement>(".pane:not([hidden])")?.offsetHeight ?? 0;
  return (
    head +
    title +
    parseFloat(style.paddingTop) +
    parseFloat(style.paddingBottom) +
    pane
  );
}

export function SettingsDialog() {
  const open = useVesta((s) => s.settingsOpen);
  const pane = useVesta((s) => s.settingsPane);
  // A capture in progress keeps the dialog open: Esc belongs to the capture (FR-035).
  const capturing = useVesta((s) => s.capture !== null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  // 015 FR-025 to FR-027b, 016 FR-036, FR-038 (PRD Q236, Q246, Q258): its place and size follow the window and the
  // pane, or what the user did since it opened; nothing of that is kept after it closes.
  const geometry = useDialogGeometry({
    open,
    modal,
    share: 0.6,
    follow: true,
    content: naturalHeight,
    observe: ".modal-head, .pane-title, .pane",
    controls: ".set-tab, .iconbtn",
  });
  const { rect, drag } = geometry;

  // 013 FR-024 (PRD Q176): showing the Updates pane is what makes a newer version seen; while it stays shown, a
  // version found is seen at once, so main is told when it goes too (T114).
  useEffect(() => {
    if (!open || pane !== "updates") return;
    actions.updatesPaneShown(true);
    return () => {
      actions.updatesPaneShown(false);
    };
  }, [open, pane]);

  useEffect(() => {
    const d = dialog.current;
    if (d === null) return;
    if (open && !d.open) {
      d.showModal();
      // 009 FR-024: opened from the update notice, the Updates section takes the focus instead.
      // 010: likewise for the Logs section, from the abnormal-exit notice.
      if (useVesta.getState().settingsSection === null)
        heading.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  // Every close goes through the store first, so the state is right at once (a quick reopen is not lost);
  // the effect above then closes the element, and its close event puts the focus back.
  function onClose() {
    // FR-027b: reopened, it takes the open place and size again.
    geometry.reset();
    // The event is queued: if Settings was opened again meanwhile, it is open now and nothing is undone.
    if (dialog.current?.open === true) return;
    // A close the browser did on its own (an Esc it would not let the page keep) still reaches the store.
    if (useVesta.getState().settingsOpen) actions.closeSettings();
    restoreFocus();
  }

  function onBackdrop(e: MouseEvent<HTMLDialogElement>) {
    // A click on the dialog element itself lands on its backdrop: the content is inside .modal. A drag that ended
    // outside it is not a click on the backdrop.
    if (geometry.takeDragged()) return;
    if (e.target === dialog.current) actions.closeSettings();
  }

  const title = PANES.find((p) => p.id === pane) ?? PANES[0];
  return (
    <dialog
      ref={dialog}
      className="settings-dialog"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      aria-labelledby="set-h"
      onClose={onClose}
      onCancel={(e) => {
        // Esc: a capture keeps it (FR-035); otherwise close through the store.
        e.preventDefault();
        if (!capturing) actions.closeSettings();
      }}
      onClick={onBackdrop}
    >
      {open && (
        <div className="modal" ref={modal}>
          {/* 016 FR-038 (Q254, Q258): the head takes the focus; its arrow keys move and resize the dialog. */}
          <div
            className="modal-head"
            tabIndex={0}
            aria-describedby="set-move-hint"
            onKeyDown={geometry.onHeadKeyDown}
            {...drag}
          >
            <span id="set-move-hint" className="sr-only">
              {t("dialogMoveHint")}
            </span>
            <h2 id="set-h" className="sr-only" ref={heading} tabIndex={-1}>
              {t("settings")}
            </h2>
            {/* 018 FR-035 (PRD Q285): the close button at the head's upper left, first in the Tab order. */}
            <button
              type="button"
              className="iconbtn"
              aria-label={t("close")}
              title={t("close")}
              onClick={() => {
                actions.closeSettings();
              }}
            >
              <Close />
            </button>
            <PaneTabs
              pane={pane}
              onPick={(p) => {
                actions.setSettingsPane(p);
              }}
            />
          </div>
          {/* 015 FR-026a (PRD Q219): the pane's name sits under the toolbar and never scrolls. */}
          <h2
            className="pane-title"
            aria-hidden="true"
            {...drag}
          >
            {title === undefined ? "" : t(title.label)}
          </h2>
          <div
            className="modal-body"
            role="tabpanel"
            id={`set-pane-${pane}`}
            aria-labelledby={`set-tab-${pane}`}
          >
            {/* Every pane stays in the page; the hidden ones keep their state and their headings (PRD A6 order). */}
            <div className="pane" hidden={pane !== "general"}>
              <section className="sset" aria-labelledby="set-appearance-h">
                <h3 id="set-appearance-h">{t("appearance")}</h3>
                <ThemeGroup />
                <PaletteSelect />
                <LanguageSelect />
                <TableOrderSetting />
              </section>
            </div>
            <div className="pane" hidden={pane !== "alerts"}>
              <Alerts />
              <QuickDurations />
            </div>
            <div className="pane" hidden={pane !== "shortcuts"}>
              <ShortcutTable />
            </div>
            <div className="pane" hidden={pane !== "data"}>
              <DataSection />
              {/* 018 FR-014: Export and import, Automatic cleanup, Logs. */}
              <CleanupSection />
              <LogsSection />
            </div>
            <div className="pane" hidden={pane !== "updates"}>
              <UpdatesSection />
            </div>
          </div>
        </div>
      )}
      {open &&
        BANDS.map((b) => (
          <div
            key={b}
            className={`rz ${b}`}
            data-edges={b}
            aria-hidden="true"
            {...drag}
          />
        ))}
    </dialog>
  );
}
