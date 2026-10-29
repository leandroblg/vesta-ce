/**
 * The panel's created date and time, status line and history (005 FR-006, FR-008; 015 FR-015 to FR-022, PRD Q206,
 * Q208, Q210, Q217), from 003's age format. 016 FR-008 to FR-010 (PRD Q226, Q227, Q250): the status lines show the time,
 * and the history is a timeline whose dot names nothing on its own.
 */
import { useEffect } from "react";
import { formatAge, formatDuration } from "../../../domain/age";
import { staleMomentOf } from "../../../domain/alerts";
import type { Task } from "../../../domain/task";
import { historyOf, type HistoryEntry } from "../../../domain/task-events";
import { Clock, Resched } from "../../components/icons";
import { ageUnits, formatDate, formatTime, t, type MessageKey } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { RescheduleButton } from "../tasks/RescheduleButton";

/** Date and time in the selected language, as Created shows them (FR-015, FR-016c). */
const when = (at: number) => t("createdAt", { date: formatDate(at), time: formatTime(at) });

const LABEL: Readonly<Record<HistoryEntry["kind"], MessageKey>> = {
  created: "histCreated",
  stale: "histStale",
  unstale: "histUnstale",
  rescheduled: "histRescheduled",
  override_set: "histOverrideSet",
  override_changed: "histOverrideChanged",
  override_cleared: "histOverrideCleared",
  done: "histDone",
  trashed: "histTrashed",
  restored: "histRestored",
  wasStale: "histWasStale",
};

/** One entry's words: a quick reschedule and an override name their minutes (FR-016). */
function label(e: HistoryEntry): string {
  const d = e.detail === null ? null : formatDuration(e.detail, ageUnits());
  if (e.kind === "rescheduled" && d !== null) return t("histRescheduledFor", { d });
  if ((e.kind === "override_set" || e.kind === "override_changed") && d !== null) return t(LABEL[e.kind], { d });
  return t(LABEL[e.kind]);
}

/** `readOnly` (011 FR-022b): the done or deleted date in place of the status, and no Reschedule. */
export function PanelStatus({ task, readOnly = false }: { task: Task; readOnly?: boolean }) {
  const now = useVesta((s) => s.now);
  const settings = useVesta((s) => s.alertSettings);
  const events = useVesta((s) => s.history[task.id]);
  useEffect(() => {
    void actions.loadHistory(task.id);
  }, [task.id]);
  const stale = task.staleSince !== null;
  // Rescheduled at least once: the alert base moved off the creation time (003 FR-004).
  const rescheduled = task.staleBaseAt !== task.createdAt;
  const left = Math.max(0, staleMomentOf(task, settings) - now);
  const history = events === undefined ? [] : historyOf(task, events);
  return (
    <>
      <dl className="meta-grid">
        <dt>{t("created")}</dt>
        <dd>
          <time dateTime={new Date(task.createdAt).toISOString()}>{when(task.createdAt)}</time>
        </dd>
        <dt>{t("status")}</dt>
        <dd>
          {readOnly ? (
            <>
              {/* 018 FR-012 (PRD Q281): a done item deleted from the Archive shows Done on beside Deleted on. */}
              {task.deletedAt !== null && task.keptDoneAt !== null && (
                <span className="pill">{t("doneOn", { d: when(task.keptDoneAt) })}</span>
              )}
              <span className="pill">
                {task.deletedAt !== null ? t("deletedOn", { d: when(task.deletedAt) }) : t("doneOn", { d: when(task.doneAt ?? now) })}
              </span>
            </>
          ) : stale ? (
            <span className="pill stale">
              <Clock />
              {t("staleSince", { d: when(task.staleSince ?? now) })}
            </span>
          ) : (
            <span className="pill ok">
              {t(rescheduled ? "reschedNote" : "goesStale", { t: formatAge(left, ageUnits()) })}
            </span>
          )}
        </dd>
      </dl>
      {/* 015 FR-016, 016 FR-009: the history, newest first, as a timeline: a dot per entry on one hairline, the words,
          then the date and time dimmed under them. The dots are decoration; the words name the kind. */}
      <section className="panel-history" aria-labelledby={`hist-h-${task.id}`}>
        <h3 id={`hist-h-${task.id}`}>{t("history")}</h3>
        <ol className="timeline">
          {history.map((e, i) => (
            <li key={`${e.kind}-${String(e.at)}-${String(i)}`} data-kind={e.kind}>
              <span className="dot" aria-hidden="true" />
              <span className="what">{label(e)}</span>
              {e.at !== null && <time dateTime={new Date(e.at).toISOString()}>{when(e.at)}</time>}
            </li>
          ))}
        </ol>
      </section>
      {stale && !readOnly && (
        <div>
          {/* 015 FR-011: works like the hover button (click: tolerance; hold or Shift+Enter: the durations). */}
          <RescheduleButton taskId={task.id} className="btn panel-resched">
            <Resched />
            {t("reschedule")}
          </RescheduleButton>
        </div>
      )}
    </>
  );
}
