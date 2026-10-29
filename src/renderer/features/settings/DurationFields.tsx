/**
 * Days, hours and minutes fields for a duration (003 FR-035 to FR-037; 007 FR-005 to FR-007, research §8):
 * a labelled group, every field named inside it, the limits of its setting, an error announced politely, and
 * Invalid input stays local and is dropped when the fields unmount.
 * 018 FR-037 (PRD Q288, Q289): every group saves its valid entry when the focus leaves the group or Enter is pressed,
 * or 2 s after the last keystroke or move between its fields; a pending one is saved when the fields close or before
 * quitting. This replaces 012's 500 ms and the save at every keystroke of the tolerance and the quick durations.
 */
import { useEffect, useId, useState } from "react";
import { formatRange } from "../../../domain/age";
import { ALERT_LIMITS, clampField, fieldMax, splitMinutes, validDuration, type AlertSettingKey } from "../../../domain/alert-settings";
import { ageUnits, t } from "../../i18n/t";
import { useTimeGroupSave } from "./useTimeGroupSave";

type Field = "days" | "hours" | "minutes";
const FIELDS: readonly Field[] = ["days", "hours", "minutes"];

// An empty field counts as 0 (007 edge case); anything else must be a whole number.
const parse = (raw: string) => (raw.trim() === "" ? 0 : /^\d+$/.test(raw.trim()) ? Number(raw) : Number.NaN);

interface Props {
  /** Which limits apply (FR-006); the override uses the alert period's. */
  limits: AlertSettingKey;
  legend: string;
  legendClassName?: string;
  /** The value shown, in minutes. */
  value: number;
  disabled?: boolean;
  /** A help line under the fields, tied by aria-describedby. */
  help?: string;
  /** Called with every valid total that differs from `value`; resolving false (a failed save) shows `value` again (FR-039). */
  onValid: (minutes: number) => unknown;
  className?: string;
}

function asFields(minutes: number): Record<Field, string> {
  const s = splitMinutes(minutes);
  return { days: String(s.days), hours: String(s.hours), minutes: String(s.minutes) };
}

/** Applies a valid entry; a failed save (false) shows the saved value again (FR-039). */
function commit(minutes: number, saved: number, apply: (minutes: number) => unknown, show?: (fields: Record<Field, string>) => void): void {
  void Promise.resolve(apply(minutes)).then((ok) => {
    if (ok === false) show?.(asFields(saved));
  });
}

export function DurationFields({ limits, legend, legendClassName, value, disabled = false, help, onValid, className }: Props) {
  const [fields, setFields] = useState<Record<Field, string>>(() => asFields(value));
  const { saver, groupProps } = useTimeGroupSave<number>((minutes) => {
    commit(minutes, value, onValid, setFields);
  });
  // 012 FR-026a: ticking Use global default disables the fields; a typed value still pending must not set the
  // override again afterwards.
  useEffect(() => {
    if (disabled) saver.cancel();
  }, [disabled, saver]);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  // A new value from outside (the setting saved, the global default changed) replaces a valid entry; an
  // invalid one stays until it is fixed or the fields close. Derived during render, as React recommends.
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    if (error === null) setFields(asFields(value));
  }

  function message(next: Record<Field, string>, result: "min" | "range"): string {
    const { min, max } = ALERT_LIMITS[limits];
    if (result === "min") return min === 60 ? t("min1h") : t("rangeErr", { r: formatRange(min, max, ageUnits()) });
    const bad = FIELDS.find((f) => !(parse(next[f]) >= 0 && parse(next[f]) <= fieldMax(limits, f)));
    return bad === undefined ? t("rangeErr", { r: formatRange(min, max, ageUnits()) }) : t("rangeErr", { r: `0–${String(fieldMax(limits, bad))}` });
  }

  function onField(field: Field, raw: string) {
    // 016 FR-031, FR-032 (PRD Q237): above a field's maximum the value becomes that maximum at once, with no error.
    const next = clampField(limits, field, raw, fields);
    setFields(next);
    const result = validDuration(limits, parse(next.days), parse(next.hours), parse(next.minutes));
    if (typeof result !== "number") {
      saver.cancel();
      setError(message(next, result));
      return;
    }
    setError(null);
    if (result === value) {
      saver.cancel();
      return;
    }
    saver.offer(result);
  }

  const shown = disabled ? asFields(value) : fields;
  const helpId = help === undefined ? undefined : `${id}-help`;
  const errId = `${id}-err`;
  const legendId = `${id}-legend`;
  // The Settings row (HIG direction A): the label on the left names the group; the fields and help sit on the right.
  const asRow = className !== undefined;
  const body = (
    <>
      <fieldset className="dhm" disabled={disabled} aria-describedby={[helpId, errId].filter(Boolean).join(" ")} aria-labelledby={asRow ? legendId : undefined} {...groupProps}>
        {!asRow && <legend className={legendClassName}>{legend}</legend>}
        {FIELDS.map((f) => (
          <label key={f}>
            {t(f)}
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={fieldMax(limits, f)}
              value={shown[f]}
              aria-invalid={error !== null}
              onChange={(e) => {
                onField(f, e.target.value);
              }}
            />
          </label>
        ))}
      </fieldset>
      {help !== undefined && (
        <p className="help" id={helpId}>
          {help}
        </p>
      )}
      <p className="ov-err err" id={errId} role="status" aria-live="polite">
        {error}
      </p>
    </>
  );
  if (!asRow) return body;
  return (
    <div className={className}>
      <div className="srow-l" id={legendId}>
        {legend}
      </div>
      <div className="srow-c">{body}</div>
    </div>
  );
}
