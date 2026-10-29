/**
 * Settings → Export and import (008 FR-001 to FR-003, research §10). One polite status region carries the export
 * result and the import outcomes that keep Settings open; a merged import closes Settings and shows the
 * importUndo notice instead (PRD Q121).
 */
import { localDate } from "../../../domain/export/file-name";
import type { ImportRefusal } from "../../../shared/ipc-contract";
import { rendererClock } from "../../clock";
import { t, type MessageKey } from "../../i18n/t";
import { actions, useVesta, type DataMessage } from "../../store/store";

const DAMAGED: Readonly<Record<Extract<ImportRefusal, { kind: "damaged" }>["cause"], MessageKey>> = {
  checksum: "importDamagedChecksum",
  missingFile: "importDamagedMissing",
  sizeMismatch: "importDamagedSize",
  tooLarge: "importDamagedTooLarge",
  invalidField: "importDamagedField",
  dataTooLarge: "importDamagedData",
  tooManyFiles: "importDamagedTooMany",
  tooLargeTotal: "importDamagedTooLargeTotal",
};

function messageText(m: DataMessage): string {
  switch (m.kind) {
    case "exportWritten": {
      const done = t("exportDone", { file: m.fileName, folder: m.folder });
      return m.skippedFiles === 0 ? done : `${done} ${t("exportSkipped", { count: m.skippedFiles })}`;
    }
    case "exportFailed":
      return t("exportFailed");
    case "refused":
      if (m.refusal.kind === "notVesta") return t("importNotVesta");
      if (m.refusal.kind === "newerVersion") return t("importNewer");
      // 010 L10: not enough free space on the data folder's disk.
      if (m.refusal.kind === "noSpace") return t("importNoSpace");
      return t(DAMAGED[m.refusal.cause], { where: m.refusal.where });
    case "notStarted":
      return t("importNotStarted");
    case "dataRefused":
      return t("dataRefusedNewer");
    case "failedRestored":
      return t("importFailedRestored");
  }
}

const isError = (m: DataMessage) => m.kind !== "exportWritten";

function today(): string {
  const now = rendererClock.now();
  return localDate(now, new Date(now).getTimezoneOffset());
}

export function DataSection() {
  const op = useVesta((s) => s.dataOp);
  const message = useVesta((s) => s.dataMessage);
  // Unticked each time Settings opens (FR-015); kept in the store so File › Export… uses it too (013 FR-003).
  const includeLogs = useVesta((s) => s.includeLogs);
  const busy = op !== "idle";
  const status = op === "exporting" ? t("exporting") : op === "importing" ? t("importing") : message === null ? "" : messageText(message);

  return (
    <section className="sset data-section" aria-labelledby="set-data-h" aria-busy={busy}>
      <h3 id="set-data-h">{t("data")}</h3>
      <div className="data-row">
        <button
          type="button"
          className="btn"
          data-testid="export"
          disabled={busy}
          onClick={() => {
            void actions.exportData(includeLogs);
          }}
        >
          {t("export")}
        </button>
        <label className="chk">
          <input
            type="checkbox"
            data-testid="include-logs"
            checked={includeLogs}
            disabled={busy}
            onChange={(e) => {
              actions.setIncludeLogs(e.target.checked);
            }}
          />
          {t("includeLogs")}
        </label>
      </div>
      <p className="note">{t("exportNote", { d: today() })}</p>
      <div className="data-row">
        <button
          type="button"
          className="btn"
          data-testid="import"
          disabled={busy}
          onClick={() => {
            void actions.importData();
          }}
        >
          {t("import")}
        </button>
      </div>
      <p
        className={message !== null && !busy && isError(message) ? "data-status err" : "data-status"}
        role="status"
        aria-live="polite"
        data-testid="data-status"
      >
        {status}
      </p>
    </section>
  );
}
