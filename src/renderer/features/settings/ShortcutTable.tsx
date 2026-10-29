/**
 * The keyboard shortcuts (007 FR-033 to FR-037, research §9 and §11): every action with its combinations,
 * Change to capture a new one (keys come from main while capturing), refusals with their reason, the double
 * Esc, and Reset to defaults. The status is announced politely.
 */
import { useEffect, useRef, useState } from "react";
import { actionById, type ActionId } from "../../../domain/shortcuts/actions";
import { menuCommand, type MenuCommandId } from "../../../domain/menu/commands";
import { rowLabel, shortcutGroups } from "../../../domain/menu/groups";
import { canAssign, type Refusal } from "../../../domain/shortcuts/assign";
import { ESC_WINDOW_MS, captureStep, type CaptureState } from "../../../domain/shortcuts/capture";
import { fromKeyEvent, label, spoken, type Combo } from "../../../domain/shortcuts/combo";
import { assign, effectiveMap } from "../../../domain/shortcuts/map";
import type { CapturedKey } from "../../../shared/ipc-contract";
import { rendererClock } from "../../clock";
import { keyNames, spokenKeyNames, t, type MessageKey } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

/** 013 FR-048: an action's name in the table, its status and its refusals: the menu label without the ellipsis. */
export function actionLabel(id: ActionId): string {
  return rowLabel(t(actionById(id).labelKey as MessageKey));
}

/** "⇧⌘N" with "Command Shift N" for screen readers (CHK028); "None" when the action has no combination. */
export function Keys({ combos }: { combos: readonly Combo[] }) {
  const isMac = useVesta((s) => s.isMac);
  if (combos.length === 0) return <span className="kbd-none">{t("keyNone")}</span>;
  return (
    <>
      {combos.map((c) => (
        <kbd key={c} aria-label={spoken(c, isMac, spokenKeyNames(isMac))}>
          {label(c, isMac, keyNames(isMac))}
        </kbd>
      ))}
    </>
  );
}

/** A Format item's label as Settings names it: Heading {n} for a level, Heading for "None", no ellipsis. */
function menuItemLabel(id: MenuCommandId): string {
  const level = /^fmt:heading-(\d)$/.exec(id)?.[1];
  if (level !== undefined) return level === "0" ? t("menuHeading") : t("menuHeadingN", { n: level });
  return rowLabel(t(menuCommand(id).labelKey as MessageKey));
}

function refusalText(r: Refusal, isMac: boolean): string {
  const names = keyNames(useVesta.getState().isMac);
  const mod = isMac ? names.cmd : names.ctrl;
  const alt = isMac ? names.option : names.alt;
  switch (r.reason) {
    case "inUse":
      return t("refInUse", { a: actionLabel(r.by) });
    case "tab":
      return t("refTab");
    // 013 FR-014: a combination a menu item holds is refused naming that item, as one an action holds.
    case "editing":
    case "app":
      return t("refInUse", { a: t(r.item) });
    // 013 FR-048: the editor's own Format keys, named by the Format item that shows them.
    case "editor":
      return t("refInUse", { a: menuItemLabel(r.by) });
    case "printable":
      return t("refPrintable", { mod, alt });
    case "globalNeedsMod":
      return t("refGlobalNeedsMod", { mod });
    case "invalid":
      return t("refInvalid");
  }
}

const toKeyLike = (k: CapturedKey) => ({ key: k.key, code: k.code, metaKey: k.meta, ctrlKey: k.control, altKey: k.alt, shiftKey: k.shift });

export function ShortcutTable() {
  const overrides = useVesta((s) => s.shortcuts);
  const isMac = useVesta((s) => s.isMac);
  const capture = useVesta((s) => s.capture);
  const map = effectiveMap(overrides, isMac);
  const [status, setStatus] = useState("");
  const machine = useRef<CaptureState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const table = useRef<HTMLTableElement>(null);

  function stop(message: string | null) {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    machine.current = { kind: "idle" };
    void window.vesta.keys.setCapture({ on: false });
    actions.setCapture(null);
    if (message !== null) setStatus(message);
  }

  async function take(action: ActionId, combo: Combo) {
    const s = useVesta.getState();
    const current = effectiveMap(s.shortcuts, s.isMac);
    const check = canAssign(action, combo, current, s.isMac);
    if (!check.ok) {
      // Refused: the mapping stays and the capture goes on, so another combination can be tried (US5-5).
      machine.current = { kind: "listening" };
      setStatus(refusalText(check, s.isMac));
      return;
    }
    stop(null);
    const saved = await actions.setShortcuts(assign(s.shortcuts, action, combo, s.isMac));
    if (saved) setStatus(t("capAssigned", { a: actionLabel(action), k: label(combo, s.isMac, keyNames(s.isMac)) }));
  }

  function step(action: ActionId, input: { key: Combo } | { tick: true }) {
    const [next, out] = captureStep(machine.current, input, rendererClock.now());
    machine.current = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    if (next.kind === "escPending") {
      timer.current = setTimeout(() => {
        step(action, { tick: true });
      }, ESC_WINDOW_MS);
    }
    if (out.kind === "cancel") stop(t("capCancelled"));
    else if (out.kind === "combo") void take(action, out.combo);
  }

  // Keys arrive from main while capturing (research §11); a click elsewhere or a window blur ends it.
  useEffect(() => {
    if (capture === null) return;
    const { action } = capture;
    const offKeys = window.vesta.on("keys:captured", (k) => {
      const combo = fromKeyEvent(toKeyLike(k), useVesta.getState().isMac);
      if (combo !== null) step(action, { key: combo });
    });
    // Keys main did not stop reach the page instead: those injected by tools such as the DevTools protocol
    // (end-to-end tests). A real key-down is stopped in main while capturing, so it never arrives twice.
    const onPageKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const combo = fromKeyEvent(e, useVesta.getState().isMac);
      if (combo !== null) step(action, { key: combo });
    };
    window.addEventListener("keydown", onPageKey, true);
    const onPointer = (e: PointerEvent) => {
      const row = table.current?.querySelector(`[data-action="${action}"]`);
      if (!(e.target instanceof Node) || row?.contains(e.target) !== true) stop(t("capCancelled"));
    };
    const onBlur = () => {
      stop(t("capCancelled"));
    };
    document.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("blur", onBlur);
    return () => {
      offKeys();
      window.removeEventListener("keydown", onPageKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("blur", onBlur);
    };
    // step and stop read the store and refs; re-subscribing on every render would drop a pending Esc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capture]);

  // Closing Settings ends a capture.
  useEffect(
    () => () => {
      if (useVesta.getState().capture !== null) {
        void window.vesta.keys.setCapture({ on: false });
        actions.setCapture(null);
      }
    },
    [],
  );

  function start(action: ActionId) {
    if (timer.current !== null) clearTimeout(timer.current);
    machine.current = { kind: "listening" };
    actions.setCapture({ action });
    void window.vesta.keys.setCapture({ on: true });
    setStatus(t("capStarted", { a: actionLabel(action) }));
  }

  return (
    <section className="sset" aria-labelledby="set-shortcuts-h">
      <h3 id="set-shortcuts-h">{t("shortcuts")}</h3>
      <table className="sc-table" ref={table}>
        {shortcutGroups(isMac).map((group) => (
          <tbody key={group.labelKey} aria-labelledby={`sc-g-${group.labelKey}`}>
            <tr className="sc-group">
              <th colSpan={3} scope="rowgroup" id={`sc-g-${group.labelKey}`}>
                {t(group.labelKey as MessageKey)}
              </th>
            </tr>
          {group.actions.map((id) => {
            const a = actionById(id);
            const name = actionLabel(id);
            const capturing = capture?.action === a.id;
            return (
              <tr key={a.id} data-action={a.id} className={capturing ? "capturing" : undefined}>
                <td>{name}</td>
                <td className="sc-keys">
                  {capturing ? (
                    <span className="sc-capture">
                      {t("pressKeys")}
                      <span className="note">{t("escTwice")}</span>
                    </span>
                  ) : (
                    <Keys combos={map[a.id]} />
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    aria-label={t("changeFor", { a: name })}
                    aria-pressed={capturing}
                    onClick={() => {
                      if (!capturing) start(a.id);
                    }}
                  >
                    {t("change")}
                  </button>
                </td>
              </tr>
            );
          })}
          </tbody>
        ))}
      </table>
      <p className="sc-status" role="status" aria-live="polite">
        {status}
      </p>
      <div>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void actions.setShortcuts({}).then((ok) => {
              if (ok) setStatus(t("resetDefaults"));
            });
          }}
        >
          {t("resetDefaults")}
        </button>
      </div>
    </section>
  );
}
