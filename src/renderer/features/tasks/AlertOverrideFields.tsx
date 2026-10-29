/**
 * The alert override fields (003 FR-034 to FR-039), shared by the anchored popover and the details panel
 * (005 FR-007): the Use global default checkbox, days, hours and minutes, validation, and every valid change
 * applied at once.
 */
import { formatDuration } from "../../../domain/age";
import type { Task } from "../../../domain/task";
import { ageUnits, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { DurationFields } from "../settings/DurationFields";

interface Props {
  task: Task;
  /** The legend inside the fieldset; the popover shows its own heading instead. */
  legend: string;
  legendClassName?: string;
}

export function AlertOverrideFields({ task, legend, legendClassName }: Props) {
  const global = useVesta((s) => s.alertSettings.alertPeriodMin);
  const useGlobal = task.alertOverrideMin === null;

  function onUseGlobal(checked: boolean) {
    // Unticking stores the values shown at once (Q96): the task stops following the global default.
    void actions.setAlertOverride(task.id, checked ? null : global);
  }

  return (
    <>
      <label className="chk ovchk">
        <input
          type="checkbox"
          checked={useGlobal}
          onChange={(e) => {
            onUseGlobal(e.target.checked);
          }}
        />
        {t("ovDefault", { t: formatDuration(global, ageUnits()) })}
      </label>
      <DurationFields
        limits="alertPeriodMin"
        legend={legend}
        legendClassName={legendClassName}
        value={task.alertOverrideMin ?? global}
        disabled={useGlobal}
        onValid={(minutes) => void actions.setAlertOverride(task.id, minutes)}
      />
    </>
  );
}
