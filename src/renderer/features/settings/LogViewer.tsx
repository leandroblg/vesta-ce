/**
 * The read-only log viewer (009 FR-013 to FR-020, research §6, §12): a second modal dialog over Settings. The
 * newest entry is on top (PRD Q127); older pages load below as the user scrolls down; new entries arrive on top
 * while it is open. The level selector filters the view and sets what Debug and Trace record (PRD Q123).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { LEVELS, type LogLevel } from "../../../domain/logs/levels";
import { formatLogTime } from "../../../domain/logs/time";
import type { LogCursor, LogLine } from "../../../shared/ipc-contract";
import { Close } from "../../components/icons";
import { BANDS, useDialogGeometry } from "../../components/use-dialog-geometry";
import { t, type MessageKey } from "../../i18n/t";
import { reportError } from "../../report";
import { actions, useVesta } from "../../store/store";
import { useLogRows } from "./useLogRows";

const LEVEL_NAME: Readonly<Record<LogLevel, MessageKey>> = {
  fatal: "levelFatal",
  error: "levelError",
  warn: "levelWarn",
  info: "levelInfo",
  debug: "levelDebug",
  trace: "levelTrace",
};

interface Row {
  key: string;
  line: LogLine;
}

let nextKey = 0;
const keyed = (lines: readonly LogLine[]): Row[] => lines.map((line) => ({ key: String(nextKey++), line }));
const keyOf = (r: Row) => r.key;

function details(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

function LogRow({ line }: { line: LogLine }) {
  if (line.raw !== null) {
    return (
      <span className="lv-raw" aria-label={`${t("logsRaw")}: ${line.raw}`}>
        {line.raw}
      </span>
    );
  }
  const level = line.level ?? "info";
  return (
    <>
      {line.time !== null && <time dateTime={new Date(line.time).toISOString()}>{formatLogTime(line.time, -new Date(line.time).getTimezoneOffset())}</time>}
      <span className={`lv-level lv-${level}`}>{t(LEVEL_NAME[level])}</span> <span className="lv-event">{line.event}</span>{" "}
      <span className="lv-fields">{details(line.fields)}</span>
      {line.cut && <span className="lv-cut"> {t("logsCut")}</span>}
    </>
  );
}

export function LogViewer() {
  const open = useVesta((s) => s.logViewerOpen);
  const level = useVesta((s) => s.logLevel);
  const dialog = useRef<HTMLDialogElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  // 016 FR-037, FR-038 (PRD Q239, Q242, Q258): centered at 80 % of the window, dragged by its whole head (its controls
  // still act on a click), resized from its edges, moved and resized by the keys on the focused head.
  const geometry = useDialogGeometry({ open, modal, share: 0.8, follow: false, controls: "button, select, input, a, label" });
  const { rect, drag } = geometry;
  const [rows, setRows] = useState<Row[]>([]);
  const [older, setOlder] = useState<LogCursor | null>(null);
  const [state, setState] = useState<{ loaded: boolean; unreadable: boolean; removedOlder: boolean }>({
    loaded: false,
    unreadable: false,
    removedOlder: false,
  });
  const loadingRef = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async (cursor: LogCursor | null, at: LogLevel, reset: boolean) => {
    if (loadingRef.current && !reset) return;
    loadingRef.current = true;
    const gen = reset ? ++generation.current : generation.current;
    try {
      const r = await window.vesta.logs.read({ cursor, level: at });
      if (gen !== generation.current) return;
      if (!r.ok) {
        reportError(`logViewer.read ${r.error.code}`, r.error.message);
        setState((s) => ({ ...s, loaded: true }));
        return;
      }
      setRows((prev) => (reset ? keyed(r.value.lines) : [...prev, ...keyed(r.value.lines)]));
      setOlder(r.value.older);
      setState({ loaded: true, unreadable: r.value.unreadable, removedOlder: r.value.removedOlder });
    } catch (err) {
      reportError("logViewer.read", err);
    } finally {
      if (gen === generation.current) loadingRef.current = false;
    }
  }, []);

  // Open: show the dialog, focus the list, load from the newest end and tail new entries.
  useEffect(() => {
    const d = dialog.current;
    if (d === null) return undefined;
    if (!open) {
      if (d.open) d.close();
      return undefined;
    }
    if (!d.open) d.showModal();
    scroller.current?.focus();
    return undefined;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    if (scroller.current !== null) scroller.current.scrollTop = 0;
    // The read answers later, like the tail below: its rows arrive through the IPC reply, not this effect.
    queueMicrotask(() => void load(null, level, true));
    void window.vesta.logs.watch({ on: true, level }).catch((err: unknown) => {
      reportError("logViewer.watch", err);
    });
    const off = window.vesta.on("logs:appended", ({ lines }) => {
      setRows((prev) => [...keyed(lines), ...prev]);
      setState((s) => ({ ...s, loaded: true }));
    });
    return () => {
      off();
      void window.vesta.logs.watch({ on: false, level }).catch(() => undefined);
    };
  }, [open, level, load]);

  // Older entries load below as the user scrolls down (FR-014).
  const onScroll = () => {
    const el = scroller.current;
    if (el === null || older === null) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) void load(older, level, false);
  };
  // A page with few lines at a rare level (Fatal): keep reading while the end is in view.
  useEffect(() => {
    const el = scroller.current;
    if (!open || el === null || older === null || loadingRef.current) return;
    if (el.scrollHeight <= el.clientHeight + 200) queueMicrotask(() => void load(older, level, false));
  }, [open, older, rows.length, level, load]);

  const win = useLogRows(rows, keyOf, scroller, open);

  function close() {
    actions.closeLogViewer();
    document.getElementById("logs-open")?.focus();
  }

  const empty = state.loaded && rows.length === 0 && older === null;
  return (
    <dialog
      ref={dialog}
      className="settings-dialog log-dialog"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      aria-labelledby="logv-h"
      onCancel={(e) => {
        // Esc closes the viewer only, not Settings under it (FR-020).
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onClose={(e) => {
        e.stopPropagation();
        // Nothing is remembered: reopened, it is centered at 80 % again.
        geometry.reset();
      }}
    >
      {open && (
        <div className="modal" ref={modal}>
          <div className="modal-head" tabIndex={0} aria-describedby="logv-move-hint" onKeyDown={geometry.onHeadKeyDown} {...drag}>
            <span id="logv-move-hint" className="sr-only">
              {t("dialogMoveHint")}
            </span>
            <h2 id="logv-h">{t("logViewerTitle")}</h2>
            <label className="lv-select">
              {t("level")}
              <select
                className="sel"
                data-testid="log-level"
                value={level}
                onChange={(e) => {
                  void actions.setLogLevel(e.target.value as LogLevel);
                }}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {t(LEVEL_NAME[l])}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="iconbtn" aria-label={t("close")} title={t("close")} onClick={close}>
              <Close />
            </button>
          </div>
          <div
            ref={scroller}
            className="logview"
            tabIndex={0}
            role="region"
            aria-label={t("logsList")}
            data-testid="log-list"
            onScroll={onScroll}
          >
            {state.unreadable && rows.length === 0 ? (
              <p className="note">{t("logsUnreadable")}</p>
            ) : empty ? (
              <p className="note">{t("logsEmpty")}</p>
            ) : (
              <ol className="lv-list" aria-label={t("logsList")}>
                {win.before > 0 && <li aria-hidden="true" style={{ height: win.before }} />}
                {win.rows.map((r) => (
                  <li key={r.key} data-key={r.key} className="lv" data-level={r.line.level ?? "raw"}>
                    <LogRow line={r.line} />
                  </li>
                ))}
                {win.after > 0 && <li aria-hidden="true" style={{ height: win.after }} />}
              </ol>
            )}
            {state.removedOlder && <p className="note">{t("logsRemovedOlder")}</p>}
          </div>
        </div>
      )}
      {open && BANDS.map((b) => <div key={b} className={`rz ${b}`} data-edges={b} aria-hidden="true" {...drag} />)}
    </dialog>
  );
}
