/**
 * The Reminders section above the task list (FR-001 to FR-003, FR-006, FR-007, FR-007a): heading with
 * the active count and the collapse toggle, the reminder cards, then the empty card, or the
 * "Maximum reminders reached" card while 200 or more reminders are active.
 */
import { useEffect, useMemo, useRef } from "react";
import { activeReminders, atReminderLimit } from "../../../domain/reminder-views";
import { searchView } from "../../../domain/search/view";
import { useVirtualRows } from "../search/useVirtualRows";
import { Caret } from "../../components/icons";
import { t } from "../../i18n/t";
import { NEW_REMINDER, actions, useVesta } from "../../store/store";
import { NewCard } from "../tasks/NewCard";
import { attachDrag } from "../tasks/drag/controller";
import { ReminderCard } from "./ReminderCard";

export function RemindersSection() {
  const rows = useVesta((s) => s.reminders);
  const collapsed = useVesta((s) => s.remindersCollapsed);
  const all = useMemo(() => Object.values(rows), [rows]);
  const list = useMemo(() => activeReminders(all), [all]);
  const full = useMemo(() => atReminderLimit(all), [all]);
  const listRef = useRef<HTMLUListElement>(null);
  const active = useVesta((s) => s.search.active);
  // Filter only once results have arrived (session.applied): the first keystroke keeps the list as it is.
  const filtering = useVesta((s) => s.search.active && s.search.session.applied);
  const matches = useVesta((s) => s.search.session.matches);
  const pinned = useVesta((s) => s.search.session.pinned);
  const slow = useVesta((s) => s.search.session.slow);
  const query = useVesta((s) => s.search.text.trim());
  // 006 FR-005, FR-007, FR-010: while searching, only matches, shown even in a collapsed section.
  const view = useMemo(
    () => searchView({ active: filtering, tree: [], reminders: list, allTasks: [], allReminders: [], matches, pinned, includeArchiveTrash: false }),
    [filtering, list, matches, pinned],
  );
  const open = !collapsed || active;
  // 006 SC-001: a filtered list of more than 100 reminders renders only those near the viewport.
  const v = useVirtualRows(view.reminders, (r) => r.id, filtering, listRef);

  useEffect(() => {
    const el = listRef.current;
    return el === null ? undefined : attachDrag(el, "rem");
  }, [open]);

  return (
    <section className="reminders" aria-labelledby="rem-h">
      <div className="sec-head">
        <h2 className="sec-title" id="rem-h">
          {active ? (
            // 006 FR-008: the header shows its count but does not collapse while searching.
            <span className="sec-toggle inert">
              <Caret />
              <span>{t("reminders")}</span>
              <span className="count">{list.length}</span>
            </span>
          ) : (
            <button
              type="button"
              className="sec-toggle"
              aria-expanded={!collapsed}
              aria-controls="rem-list"
              onClick={() => void actions.setRemindersCollapsed(!collapsed)}
            >
              <Caret />
              <span>{t("reminders")}</span>
              <span className="count">{list.length}</span>
            </button>
          )}
        </h2>
      </div>
      {open && (
        <ul
          className="list"
          id="rem-list"
          aria-label={t("reminders")}
          ref={listRef}
          data-list="rem"
          tabIndex={-1}
        >
          {v.before > 0 && <li className="vspacer" aria-hidden="true" style={{ height: v.before }} />}
          {v.rows.map((r, i) => (
            <ReminderCard
              key={r.id}
              reminder={r}
              highlight={filtering && matches.has(r.id)}
              setPos={v.virtual ? { pos: v.start + i + 1, size: v.total } : null}
            />
          ))}
          {v.after > 0 && <li className="vspacer" aria-hidden="true" style={{ height: v.after }} />}
          {view.remindersNoMatches && !slow && <li className="no-matches">{t("noMatches", { q: query })}</li>}
          {list.length === 0 && !active && (
            <li className="empty-state small" data-testid="empty-reminders">
              <span>{t("emptyRem")}</span>
            </li>
          )}
          {full ? (
            <li className="row newcard max" data-kind="rem-max">
              {t("maxReminders")}
            </li>
          ) : (
            <NewCard editingKey={NEW_REMINDER} kind="rem" placeholder={t("newRemPh")} onCreate={actions.createReminder} />
          )}
        </ul>
      )}
    </section>
  );
}
