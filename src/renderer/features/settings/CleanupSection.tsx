/**
 * 018 Settings → Data → Automatic cleanup (FR-014 to FR-020d; PRD Q273, Q277–Q279, Q282, Q287): two independent
 * cleanups, each a checkbox, its years, days and hours, a help line, the limits line, and while the hour after a change
 * runs, a countdown to the moment it takes effect (not announced every second).
 */
import { useEffect } from "react";
import { t } from "../../i18n/t";
import { useSecondTicker } from "../../hooks/useSecondTicker";
import { actions, useVesta } from "../../store/store";
import { CleanupFields } from "./CleanupFields";

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

function Group({ which }: { which: "archive" | "trash" }) {
  const c = useVesta((s) => s.cleanup[which]);
  const now = useSecondTicker(c.deadline !== null);
  const left = c.deadline === null ? 0 : c.deadline - now;
  const id = `cleanup-${which}`;
  return (
    <fieldset className="cleanup-group" aria-labelledby={`${id}-h`} data-testid={id}>
      <legend id={`${id}-h`}>{t(which === "archive" ? "cleanupArchive" : "cleanupTrash")}</legend>
      <label className="chk">
        <input
          type="checkbox"
          data-testid={`${id}-on`}
          checked={c.on}
          onChange={(e) => {
            void actions.setCleanup(which, e.target.checked, c.hours, true);
          }}
        />
        {t(which === "archive" ? "cleanupArchiveOn" : "cleanupTrashOn")}
      </label>
      <CleanupFields
        hours={c.hours}
        disabled={!c.on}
        labelledBy={`${id}-h`}
        describedBy={`${id}-help ${id}-limits`}
        send={(hours, commit) => actions.setCleanup(which, c.on, hours, commit)}
      />
      <p className="help" id={`${id}-help`}>
        {t(which === "archive" ? "cleanupArchiveHelp" : "cleanupTrashHelp")}
      </p>
      <p className="help" id={`${id}-limits`}>
        {t("cleanupLimits")}
      </p>
      {c.deadline !== null && left > 0 && (
        <p className="note cleanup-countdown" data-testid={`${id}-countdown`}>
          {t("cleanupCountdown", { t: mmss(left) })}
        </p>
      )}
    </fieldset>
  );
}

export function CleanupSection() {
  const shown = useVesta((s) => s.settingsOpen && s.settingsPane === "data");
  useEffect(() => {
    if (shown) void actions.refreshCleanupStatus();
  }, [shown]);
  return (
    <section className="sset" aria-labelledby="set-cleanup-h" data-testid="cleanup-section">
      <h3 id="set-cleanup-h">{t("cleanupHeading")}</h3>
      <Group which="archive" />
      <Group which="trash" />
    </section>
  );
}
