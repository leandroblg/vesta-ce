/**
 * The color theme (HIG identity review): Hearth (Vesta's identity), System, Ubuntu and Minimalist. A
 * pop-up button, like Language; each theme changes colors only and has a light and a dark rendering.
 */
import { PALETTES, isPaletteSetting, type PaletteSetting } from "../../../domain/settings";
import { t, type MessageKey } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";

const LABEL: Readonly<Record<PaletteSetting, MessageKey>> = {
  hearth: "paletteHearth",
  system: "paletteSystem",
  ubuntu: "paletteUbuntu",
  minimal: "paletteMinimal",
};

export function PaletteSelect() {
  const palette = useVesta((s) => s.palette);
  return (
    <div className="srow">
      <div className="srow-l">
        <label htmlFor="set-palette">{t("theme")}</label>
      </div>
      <div className="srow-c">
        <select
          id="set-palette"
          className="sel"
          data-testid="palette"
          value={palette}
          aria-describedby="set-palette-help"
          onChange={(e) => {
            const next = e.target.value;
            if (isPaletteSetting(next)) void actions.setPalette(next);
          }}
        >
          {PALETTES.map((p) => (
            <option key={p} value={p}>
              {t(LABEL[p])}
            </option>
          ))}
        </select>
        <p className="help" id="set-palette-help">
          {t("paletteHelp")}
        </p>
      </div>
    </div>
  );
}
