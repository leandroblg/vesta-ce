/**
 * One task card (FR-006 to FR-010): collapse toggle (parents only), title as plain text,
 * hover/focus buttons Edit and the menu (rightmost), and the drag handle (004: drag/controller.ts).
 */
import { memo, useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { formatAge } from "../../../domain/age";
import { quickDurations } from "../../../domain/alert-settings";
import type { Task } from "../../../domain/task";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import { Alert, Bell, Caret, Clock, Close, Dots, Edit, Grip, Panel, Resched, Sub } from "../../components/icons";
import { flushAll } from "../../store/flush";
import { ageUnits, t } from "../../i18n/t";
import { actions, newSubKey, useVesta } from "../../store/store";
import { AlertOverridePanel } from "./AlertOverridePanel";
import { InlineTitleEditor } from "./InlineTitleEditor";
import { plain } from "../../markdown/plain";
import { Markdown } from "../../markdown/Markdown";
import { Excerpt } from "../search/Excerpt";
import { inCardArea, pressTracker } from "./card-area";
import { postponeItems, RescheduleButton } from "./RescheduleButton";

/** About the system double-click time (prototype value, 005 FR-001). */
const DOUBLE_CLICK_MS = 230;

interface Props {
  task: Task;
  isSub: boolean;
  hasSubs: boolean;
  /** At least one active subtask is stale: the parent shows the marker, collapsed or expanded (003 FR-014). */
  staleSub: boolean;
  /** An auto-sorted stale task, shown in the stale group (004 FR-013). */
  inGroup: boolean;
  /** 006 FR-013: the details excerpt while it shows because of its details. */
  excerpt?: string | null;
  /** 006 FR-006, FR-012: the task itself matches the search, so its title is highlighted. */
  highlight?: boolean;
  /** 006 T056: a row of a virtualized list tells screen readers its position and the total. */
  setPos?: { pos: number; size: number } | null;
}

/** Memoized: a drag or a tick re-renders only the cards whose row or flags changed (004 SC-004). */
export const TaskCard = memo(function TaskCard({ task, isSub, hasSubs, staleSub, inGroup, excerpt = null, highlight = false, setPos = null }: Props) {
  // 007: re-render on a language switch, which memo would skip (research §4).
  useVesta((s) => s.language);
  const editing = useVesta((s) => s.editingKey === task.id);
  // 016 FR-016c (Q257): a click on an unsafe link in the title starts editing on it.
  const onUnsafeLink = useCallback((index: number) => {
    actions.editUnsafeLink(task.id, index);
  }, [task.id]);
  const menuOpen = useVesta((s) => s.menuFor === task.id);
  const overrideOpen = useVesta((s) => s.overrideFor === task.id);
  const dragging = useVesta((s) => s.drag?.id === task.id);
  const movingDisabled = useVesta((s) => s.movingDisabled);
  const self = useRef<HTMLLIElement>(null);
  const refocus = useVesta((s) => (s.focusAfterMove?.id === task.id ? s.focusAfterMove.ctl : null));
  // After a keyboard move, the same control has focus again, also when the card was remounted (004 FR-024).
  useEffect(() => {
    if (refocus === null) return;
    self.current?.querySelector<HTMLElement>(`[data-ctl="${refocus}"]`)?.focus();
    actions.setFocusAfterMove(null);
  }, [refocus]);
  const menuButton = useRef<HTMLButtonElement>(null);
  const stale = task.staleSince !== null;
  // 015 FR-006, FR-006a (PRD Q207, Q209): while the hover button's row of quick durations is open, the buttons stay.
  const [holdOpen, setHoldOpen] = useState(false);
  const alertSettings = useVesta((s) => s.alertSettings);
  const now = useVesta((s) => s.now);
  const episode = useVesta((s) => s.episodes[task.id]);
  // An episode on the row being edited waits for the edit to close (spec edge case).
  // 006: while searching, the list's `searching` class hides the collapse toggle (FR-008) and any blink (FR-005a),
  // so cards need not re-render when a search starts (SC-001).
  const blinking = episode !== undefined && !editing;
  const closeMenu = useCallback(() => {
    actions.openMenu(null);
  }, []);
  // 005 FR-001: a single click opens the panel once no second click follows within the double-click time.
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClick = () => {
    if (clickTimer.current !== null) clearTimeout(clickTimer.current);
    clickTimer.current = null;
  };
  useEffect(() => cancelClick, []);
  // 011 FR-022 to FR-024: the whole card area responds like the title did.
  const press = useRef(pressTracker()).current;
  const onAreaClick = (e: ReactMouseEvent<HTMLLIElement>) => {
    if (editing || !inCardArea(e.target, e.clientX, e.currentTarget) || press.moved(e)) return;
    if (e.detail > 1) return;
    cancelClick();
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      actions.openPanel(task.id);
    }, DOUBLE_CLICK_MS);
  };
  const onAreaDoubleClick = (e: ReactMouseEvent<HTMLLIElement>) => {
    if (editing || !inCardArea(e.target, e.clientX, e.currentTarget) || press.moved(e)) return;
    cancelClick();
    actions.startEditing(task.id);
  };

  const items: MenuItem[] = [];
  if (!isSub) {
    items.push({
      key: "sub",
      label: t("menuNewSubtask"),
      icon: <Sub />,
      onSelect: () => {
        void (async () => {
          if (task.collapsed) await actions.setCollapsed(task.id, false);
          actions.startEditing(newSubKey(task.id));
        })();
      },
    });
  }
  // 005 FR-001: Show Details opens the panel; 013 FR-012 (PRD Q174): the menu bar's labels, in every language.
  items.push({
    key: "details",
    label: t("menuShowDetails"),
    icon: <Panel />,
    onSelect: () => {
      actions.openPanel(task.id);
    },
  });
  // 015 FR-001 (PRD Q203): Reschedule for every active task and subtask, stale or not; the hover button stays stale-only.
  items.push({ key: "resched", label: t("menuReschedule"), icon: <Resched />, onSelect: () => void actions.reschedule(task.id) });
  // 015 FR-010 (PRD Q207, Q220, Q221): Postpone For opens the quick durations as a row on the menu's left.
  items.push({
    key: "postponeFor",
    label: t("menuPostponeFor"),
    icon: <Clock />,
    onSelect: () => undefined,
    submenu: postponeItems(task.id, quickDurations(alertSettings)),
  });
  items.push({
    key: "ov",
    label: t("menuAlertPeriod"),
    icon: <Bell />,
    onSelect: () => {
      actions.openOverride(task.id);
    },
  });
  items.push({
    key: "del",
    label: t("menuMoveToTrash"),
    icon: <Close />,
    danger: true,
    separatorBefore: true,
    onSelect: () => void actions.delete(task.id),
  });

  const classes = [
    "row",
    isSub ? "sub" : "",
    stale ? "stale" : "",
    blinking ? "blink" : "",
    editing ? "editing" : "",
    menuOpen || overrideOpen || holdOpen ? "menu-open" : "",
    dragging ? "dragging" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const style = blinking ? ({ "--blinks": String(episode.blinks) } as CSSProperties) : undefined;

  return (
    <li
      ref={self}
      className={classes}
      style={style}
      aria-describedby="drag-handle-hint drag-hint"
      data-kind="task"
      data-id={task.id}
      data-parent={task.parentId ?? undefined}
      data-expanded={hasSubs && !task.collapsed ? "1" : undefined}
      data-group={inGroup ? "1" : undefined}
      aria-posinset={setPos?.pos}
      aria-setsize={setPos?.size}
      aria-label={stale ? t("staleRow", { t: plain(task.titleMd) }) : undefined}
      onPointerDown={(e) => {
        press.down(e);
      }}
      onClick={onAreaClick}
      onDoubleClick={onAreaDoubleClick}
    >
      <input
        type="checkbox"
        className="cb"
        data-ctl="cb"
        checked={false}
        aria-label={t("markDone", { t: plain(task.titleMd) })}
        onChange={() => {
          // An open inline edit is saved first, then the item is marked done (spec edge case).
          void flushAll().then(() => actions.markDone(task.id));
        }}
      />
      {hasSubs ? (
        <button
          type="button"
          className="twisty"
          data-ctl="twisty"
          aria-expanded={!task.collapsed}
          aria-label={task.collapsed ? t("expand") : t("collapse")}
          title={task.collapsed ? t("expand") : t("collapse")}
          onClick={() => void actions.setCollapsed(task.id, !task.collapsed)}
        >
          <Caret />
        </button>
      ) : (
        <span className="twisty-sp" />
      )}
      <div className="title-wrap">
        {editing ? (
          <InlineTitleEditor
            value={task.titleMd}
            label={plain(task.titleMd)}
            onSave={(text) => actions.editTitle(task.id, text)}
          />
        ) : (
          <div className="title-main">
            <div className="title" data-hl={highlight ? "" : undefined}>
              <Markdown md={task.titleMd} scope="title" onUnsafeLink={onUnsafeLink} />
            </div>
            {staleSub && (
              <span className="stale-sub">
                <Alert />
                {t("staleSub")}
              </span>
            )}
            {excerpt !== null && <Excerpt text={excerpt} />}
          </div>
        )}
      </div>
      {/* 014 FR-001 to FR-004 (PRD Q197, Q199, Q201): a zone reserved for the buttons and the drag handle, the same
          width on every task card; at rest it shows a stale card's tag and age, which hide while the buttons show. */}
      <div className="zone">
        <div className="zone-stack">
          {!editing && (
            <div className="actions">
              {stale && (
                <RescheduleButton taskId={task.id} className="act icon resched" label={t("reschedule")} onOpenChange={setHoldOpen}>
                  <Resched />
                </RescheduleButton>
              )}
              <button
                type="button"
                className="act icon"
                data-ctl="edit"
                aria-label={t("edit")}
                title={t("edit")}
                onClick={() => {
                  actions.startEditing(task.id);
                }}
              >
                <Edit />
              </button>
              <button
                ref={menuButton}
                type="button"
                className="act icon"
                data-ctl="more"
                aria-label={t("more")}
                title={t("more")}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => {
                  actions.openMenu(menuOpen ? null : task.id);
                }}
              >
                <Dots />
              </button>
            </div>
          )}
          {stale && !editing && (
            <span className="age">
              <Clock />
              <span className="tag">{t("stale")}</span>
              <span className="v">{formatAge(now - task.createdAt, ageUnits())}</span>
            </span>
          )}
        </div>
        <span className={movingDisabled ? "grip off" : "grip"} title={t("drag")} aria-hidden="true">
          <Grip />
        </span>
      </div>
      {overrideOpen && <AlertOverridePanel task={task} anchorRef={menuButton} />}
      {menuOpen && (
        <ContextMenu label={t("taskActions", { t: plain(task.titleMd) })} items={items} anchorRef={menuButton} onClose={closeMenu} />
      )}
    </li>
  );
});
