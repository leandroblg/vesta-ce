/** Bottom-center notification slot (FR-025 to FR-028, FR-040 to FR-042a). */
import { useEffect, useState } from "react";
import { visible, type Notice } from "../../domain/notifications";
import { rendererClock } from "../clock";
import { formatDate, formatTime, t } from "../i18n/t";
import { actions, useVesta } from "../store/store";
import { Alert, ArchiveIcon, Close, Resched, Restore, TrashIcon } from "./icons";

function message(n: Notice): string {
  switch (n.type) {
    case "undo":
      return t(
        n.kind === "done" ? "toastDone" : n.kind === "delete" ? "toastTrash" : n.kind === "reschedule" ? "toastRescheduled" : "toastRestored",
        { t: n.title === "" ? t("untitled") : n.title },
      );
    case "redo":
      return t("toastReschedUndone", { t: n.title === "" ? t("untitled") : n.title });
    case "importUndo":
      return t("importMerged", { a: n.counts.added, u: n.counts.updated, s: n.counts.unchanged });
    case "update":
      return t("updateAvailable", { v: n.version });
    case "importResult":
      return t(n.kind === "undone" ? "importUndone" : "undoFailed");
    case "reminder":
      return t("reminderNotice");
    case "info":
      return n.lastBackupAt === null
        ? t("noticeBackupFailedNone")
        : t("noticeBackupFailed", { date: formatDate(n.lastBackupAt), time: formatTime(n.lastBackupAt) });
    case "sticky":
      switch (n.kind) {
        case "saveFailed":
          return t("saveFail");
        case "folderNotWritable":
          return t("noticeFolder", { path: n.path });
        case "dataDamaged":
          return t("noticeDamaged");
        case "unrecoverable":
          return t("noticeUnrecoverable", { path: n.damagedPath });
        case "backupRestored": {
          const restored = t("noticeRestored", { date: formatDate(n.backupAt), time: formatTime(n.backupAt) });
          return n.moved === null ? restored : `${restored} ${t("noticeMoved", { n: n.moved.count, path: n.moved.folder })}`;
        }
        case "abnormalExit":
          return t("noticeAbnormalExit", { logs: t("noticeAbnormalExitLogs") });
        case "newerData":
          return t("noticeNewerData");
      }
  }
}

/** 010 FR-026 (L16): the abnormal-exit text with its "logs" word as a link to Settings → Logs. */
function AbnormalExitMessage() {
  const [before, after] = t("noticeAbnormalExit", { logs: "\u0000" }).split("\u0000");
  return (
    <span>
      {before}
      <button
        type="button"
        className="undo-link"
        data-testid="abnormal-exit-logs"
        onClick={() => {
          actions.openLogsFromNotice();
        }}
      >
        {t("noticeAbnormalExitLogs")}
      </button>
      {after}
    </span>
  );
}

export function Notification() {
  const notice = useVesta((s) => visible(s.notifications));
  const hasTimer = notice !== null && notice.type !== "sticky" && notice.type !== "update" && notice.type !== "reminder";
  // The Undo import countdown (008 FR-037b): plain text, hidden from the live region (analysis A1).
  const [now, setNow] = useState(() => rendererClock.now());

  useEffect(() => {
    if (!hasTimer) return;
    const id = window.setInterval(() => {
      actions.tick();
      setNow(rendererClock.now());
    }, 250);
    return () => {
      window.clearInterval(id);
    };
  }, [hasTimer]);

  if (notice === null) return null;
  const sticky = notice.type === "sticky";
  return (
    <div className="toast-root">
      <div
        className={sticky ? "toast err" : "toast"}
        role={sticky ? "alert" : "status"}
        data-testid="notification"
        data-kind={notice.type === "importUndo" || notice.type === "redo" || notice.type === "update" || notice.type === "reminder" ? notice.type : notice.kind}
      >
        <span className="toast-icon">
          {sticky ? (
            <Alert />
          ) : notice.type === "undo" ? (
            notice.kind === "done" ? <ArchiveIcon /> : notice.kind === "delete" ? <TrashIcon /> : notice.kind === "reschedule" ? <Resched /> : <Restore />
          ) : notice.type === "redo" ? (
            <Resched />
          ) : null}
        </span>
        {notice.type === "sticky" && notice.kind === "abnormalExit" ? <AbnormalExitMessage /> : <span>{message(notice)}</span>}
        {notice.type === "undo" && (
          <button type="button" className="undo-link" onClick={() => void actions.undo()}>
            {t("undoLink")}
          </button>
        )}
        {notice.type === "redo" && (
          <button type="button" className="undo-link redo-link" onClick={() => void actions.redo()}>
            {t("redoLink")}
          </button>
        )}
        {notice.type === "importUndo" && (
          <>
            <span className="toast-countdown" aria-hidden="true" data-testid="undo-countdown">
              {t("undoImportIn", { count: Math.max(0, Math.ceil((notice.deadline - now) / 1000)) })}
            </span>
            <button type="button" className="undo-link" data-testid="undo-import" onClick={() => void actions.undoImport()}>
              {t("undoImport")}
            </button>
          </>
        )}
        {notice.type === "reminder" && (
          <button
            type="button"
            className="undo-link"
            data-testid="reminder-view"
            onClick={() => {
              actions.openUpdatesFromNotice();
            }}
          >
            {t("reminderView")}
          </button>
        )}
        {notice.type === "update" && (
          <button type="button" className="undo-link" data-testid="update-view" onClick={() => {
              actions.openUpdatesFromNotice();
            }}>
            {t("updateView")}
          </button>
        )}
        <button type="button" className="toast-x" aria-label={t("close")} title={t("close")} onClick={() => {
            actions.closeNotification();
          }}>
          <Close />
        </button>
      </div>
    </div>
  );
}
