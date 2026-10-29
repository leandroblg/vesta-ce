/** Settings → Logs (009 FR-012, FR-013): a button that opens the read-only viewer, and the privacy note. */
import { useEffect, useRef } from "react";
import { t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { LogViewer } from "./LogViewer";

export const LOGS_OPEN_ID = "logs-open";

export function LogsSection() {
  const section = useVesta((s) => s.settingsSection);
  const heading = useRef<HTMLHeadingElement>(null);

  // 010 FR-026 (L16): opened from the abnormal-exit notice, the section comes into view with its heading focused.
  useEffect(() => {
    if (section !== "logs") return;
    const frame = requestAnimationFrame(() => {
      heading.current?.scrollIntoView({ block: "start" });
      heading.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [section]);

  return (
    <section className="sset" aria-labelledby="set-logs-h" data-testid="logs-section">
      <h3 id="set-logs-h" ref={heading} tabIndex={-1}>
        {t("logs")}
      </h3>
      <div className="data-row">
        <button
          type="button"
          className="btn"
          id={LOGS_OPEN_ID}
          data-testid="logs-open"
          onClick={() => {
            actions.openLogViewer();
          }}
        >
          {t("logsOpen")}
        </button>
      </div>
      <p className="note">{t("logsNote")}</p>
      <LogViewer />
    </section>
  );
}
