/**
 * 018 FR-014, FR-015, FR-037 (PRD Q273, Q237, Q288, Q289): a cleanup's years, days and hours. A value above a field's
 * maximum becomes that maximum while typing; a zero total shows the error line and saves nothing; the fields send their
 * total by the rules of cleanup-fields-logic.ts. Disabled while the cleanup is off, keeping their values.
 */
import { useEffect, useId, useRef, useState } from "react";
import { clampCleanupField, splitHours, validCleanup, type CleanupField } from "../../../domain/cleanup";
import { t } from "../../i18n/t";
import { createCleanupFieldsLogic, type CleanupFieldsLogic, type CleanupSend } from "./cleanup-fields-logic";

const FIELDS: readonly CleanupField[] = ["years", "days", "hours"];
type Shown = Record<CleanupField, string>;
const asShown = (hours: number): Shown => {
  const p = splitHours(hours);
  return { years: String(p.years), days: String(p.days), hours: String(p.hours) };
};
const parse = (raw: string) => (raw.trim() === "" ? 0 : /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN);

export function CleanupFields({
  hours,
  disabled,
  describedBy,
  labelledBy,
  send,
}: {
  hours: number;
  disabled: boolean;
  describedBy: string;
  labelledBy: string;
  send: CleanupSend;
}) {
  const [shown, setShown] = useState<Shown>(() => asShown(hours));
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  // The saved value shown again (a refusal, a cancelled dialog or a change from elsewhere).
  const [synced, setSynced] = useState(hours);
  if (hours !== synced) {
    setSynced(hours);
    setShown(asShown(hours));
    setError(null);
  }
  // The latest props for the logic's callbacks, which run after the render that set them.
  const latest = useRef({ send, hours });
  useEffect(() => {
    latest.current = { send, hours };
  });
  const logic = useRef<CleanupFieldsLogic | null>(null);
  logic.current ??= createCleanupFieldsLogic(
    (h, commit) => latest.current.send(h, commit),
    () => {
      setShown(asShown(latest.current.hours));
      setError(null);
    },
  );
  useEffect(
    () => () => {
      logic.current?.close();
    },
    [],
  );
  useEffect(() => {
    if (disabled) logic.current?.cancel();
  }, [disabled]);

  function onField(field: CleanupField, raw: string) {
    const n = parse(raw);
    const value = Number.isNaN(n) ? raw : String(clampCleanupField(field, n));
    const next = { ...shown, [field]: value };
    setShown(next);
    const parts = { years: parse(next.years), days: parse(next.days), hours: parse(next.hours) };
    if (Object.values(parts).some((v) => Number.isNaN(v))) {
      logic.current?.cancel();
      setError(t("cleanupLimits"));
      return;
    }
    const total = validCleanup(parts);
    if (total === "min") {
      setError(t("min1h"));
      logic.current?.typed("min");
      return;
    }
    setError(null);
    if (total === hours) logic.current?.cancel();
    else logic.current?.typed(total);
  }

  return (
    <>
      <fieldset
        className="dhm"
        disabled={disabled}
        aria-labelledby={labelledBy}
        aria-describedby={`${describedBy} ${errId}`}
        onFocus={(e) => {
          if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) logic.current?.moved();
        }}
        onBlur={(e) => {
          const to = e.relatedTarget;
          if (to instanceof Node && e.currentTarget.contains(to)) return;
          // 018 Q282: going to Settings' head (its Close button) is closing Settings, which drops a time waiting for
          // its confirmation; the fields' unmount then sends one that needs none.
          if (to instanceof Element && to.closest(".modal-head") !== null) return;
          logic.current?.left();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) logic.current?.enter();
        }}
      >
        {FIELDS.map((f) => (
          <label key={f}>
            {t(f)}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={f === "years" ? 1000 : f === "days" ? 364 : 23}
              value={disabled ? asShown(hours)[f] : shown[f]}
              aria-invalid={error !== null}
              onChange={(e) => {
                onField(f, e.target.value);
              }}
            />
          </label>
        ))}
      </fieldset>
      <p className="ov-err err" id={errId} role="status" aria-live="polite">
        {error}
      </p>
    </>
  );
}
