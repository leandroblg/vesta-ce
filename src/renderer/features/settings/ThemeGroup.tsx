/**
 * The appearance choice (007 FR-009 to FR-011, research §8; HIG identity review: "System" replaces "Follow OS"):
 * native radio buttons in a row, one Tab stop, arrows change it (HIG Toggles: radio buttons for mutually
 * exclusive options). The palette (Theme) is a separate setting: PaletteSelect.
 */
import type { ThemeSetting } from "../../../domain/settings";
import { t, type MessageKey } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

const OPTIONS: readonly { value: ThemeSetting; label: MessageKey }[] = [
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
  { value: "system", label: "followOs" },
];

export function ThemeGroup() {
  const theme = useVesta((s) => s.theme);
  return (
    <div className="srow">
      <div className="srow-l" id="set-appearance-l">
        {t("appearance")}
      </div>
      <div className="srow-c">
        <div className="radios seg" role="radiogroup" aria-labelledby="set-appearance-l" aria-describedby="set-appearance-help">
          {OPTIONS.map((o) => (
            <label key={o.value} className={theme === o.value ? "radio on" : "radio"}>
              <input
                type="radio"
                name="theme"
                value={o.value}
                checked={theme === o.value}
                onChange={() => {
                  void actions.setTheme(o.value);
                }}
              />
              {t(o.label)}
            </label>
          ))}
        </div>
        <p className="help" id="set-appearance-help">
          {t("appearanceHelp")}
        </p>
      </div>
    </div>
  );
}
