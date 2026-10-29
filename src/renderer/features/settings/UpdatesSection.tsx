/**
 * Settings → Updates (009 FR-021a, FR-021b, FR-025, FR-025a): Check for updates, the automatic-check switch and
 * its note, the latest result, and for a newer version its release notes and the two download links. The
 * links never carry an address: main opens the ones it checked (FR-024b).
 */
import { useEffect, useRef, useState } from "react";
import { REMINDER_DAYS_MAX, REMINDER_DAYS_MIN } from "../../../domain/limits";
import { Markdown } from "../../markdown/Markdown";
import { formatDate, formatTime, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

export const UPDATES_HEADING_ID = "set-updates-h";

/** 010 Q133 (FR-034): the reminder switch and period, offered only while automatic checks are off. */
function ReminderControls() {
  const on = useVesta((s) => s.updateReminder);
  const days = useVesta((s) => s.updateReminderDays);
  // The typed text, kept only while it belongs to the current stored value (no effect needed).
  const [draft, setDraft] = useState<{ days: number; text: string }>({ days, text: String(days) });
  const text = draft.days === days ? draft.text : String(days);
  const [before, after] = t("remindEvery", { n: "\u0000" }).split("\u0000");
  const commit = (text: string) => {
    const value = Number(text);
    if (Number.isInteger(value) && value >= REMINDER_DAYS_MIN && value <= REMINDER_DAYS_MAX) void actions.setUpdateReminderDays(value);
  };
  return (
    <div className="data-row" data-testid="update-reminder-row">
      <label className="chk">
        <input
          type="checkbox"
          data-testid="update-reminder"
          checked={on}
          onChange={(e) => {
            void actions.setUpdateReminder(e.target.checked);
          }}
        />
        {t("remindCheck")}
      </label>
      <label className="chk">
        {before}
        <input
          type="number"
          data-testid="update-reminder-days"
          min={REMINDER_DAYS_MIN}
          max={REMINDER_DAYS_MAX}
          step={1}
          value={text}
          disabled={!on}
          aria-describedby="update-reminder-help"
          onChange={(e) => {
            setDraft({ days, text: e.target.value });
            commit(e.target.value);
          }}
          onBlur={() => {
            setDraft({ days, text: String(days) });
          }}
        />
        {after}
      </label>
      <span className="note" id="update-reminder-help">
        {t("remindHelp")}
      </span>
    </div>
  );
}

function statusText(): string {
  const { update, appVersion } = useVesta.getState();
  if (update.checking) return t("checking");
  const r = update.result;
  switch (r.kind) {
    case "none":
      return "";
    case "upToDate":
      return `${t("upToDate", { v: appVersion })} ${t("lastCheck", { d: `${formatDate(r.checkedAt)} ${formatTime(r.checkedAt)}` })}`;
    case "available":
      return t("updateAvailable", { v: r.version });
    case "failed":
      // An automatic failure shows nothing (FR-026).
      return r.manual ? t("updateFailed") : "";
  }
}

export function UpdatesSection() {
  const update = useVesta((s) => s.update);
  const auto = useVesta((s) => s.autoUpdateCheck);
  useVesta((s) => s.language);
  useVesta((s) => s.appVersion);
  const section = useVesta((s) => s.settingsSection);
  const heading = useRef<HTMLHeadingElement>(null);

  // Opened from the update notice: the section comes into view with its heading focused (FR-024).
  useEffect(() => {
    if (section !== "updates") return;
    // After the dialog has opened (its showModal runs in the parent's effect, after this one).
    const frame = requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start" });
      heading.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [section]);

  const result = update.result;
  const failed = result.kind === "failed" && result.manual;
  return (
    <section className="sset" aria-labelledby={UPDATES_HEADING_ID} data-testid="updates-section">
      <h3 id={UPDATES_HEADING_ID} ref={heading} tabIndex={-1}>
        {t("updates")}
      </h3>
      <div className="data-row">
        <button
          type="button"
          className="btn"
          data-testid="update-check"
          disabled={update.checking}
          onClick={() => {
            void actions.checkForUpdates();
          }}
        >
          {t("checkUpdates")}
        </button>
        <label className="chk">
          <input
            type="checkbox"
            data-testid="auto-update"
            checked={auto}
            onChange={(e) => {
              void actions.setAutoUpdateCheck(e.target.checked);
            }}
          />
          {t("autoCheck")}
        </label>
      </div>
      <p className="note">{auto ? t("updatesNoteAuto") : t("updatesNoteManual")}</p>
      {!auto && <ReminderControls />}
      <p className={failed ? "data-status err" : "data-status"} role="status" aria-live="polite" data-testid="update-status">
        {statusText()}
      </p>
      {result.kind === "available" && (
        <div className="update-release">
          <div className="data-row">
            {result.hasFile && (
              <button
                type="button"
                className="btn"
                data-testid="update-download"
                onClick={() => {
                  actions.openUpdateLink("file");
                }}
              >
                {t("downloadFor", { system: result.system })}
              </button>
            )}
            <button
              type="button"
              className="btn"
              data-testid="update-all"
              onClick={() => {
                actions.openUpdateLink("release");
              }}
            >
              {t("allDownloads")}
            </button>
          </div>
          <div className="release-notes" role="region" aria-label={t("releaseNotes")} data-testid="release-notes">
            {result.notes.trim() === "" ? <p className="note">{t("noReleaseNotes")}</p> : <Markdown md={result.notes} scope="release" />}
          </div>
        </div>
      )}
    </section>
  );
}
