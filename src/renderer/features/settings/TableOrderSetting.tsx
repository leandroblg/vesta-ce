/** 011 FR-020b: the order of the table size fields and size text (Rows before columns). */
import { t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

export function TableOrderSetting() {
  const on = useVesta((s) => s.tableRowsFirst);
  return (
    <div className="srow">
      <div className="srow-l">{t("fmTable")}</div>
      <div className="srow-c">
        <label className="chk">
          <input
            type="checkbox"
            data-testid="table-rows-first"
            checked={on}
            onChange={(e) => {
              void actions.setTableRowsFirst(e.target.checked);
            }}
          />
          {t("tableRowsFirst")}
        </label>
      </div>
    </div>
  );
}
