/** The current combination of an action, as shown in hints and descriptions (007 FR-037). */
import type { ActionId } from "../../domain/shortcuts/actions";
import { label, spoken } from "../../domain/shortcuts/combo";
import { effectiveMap } from "../../domain/shortcuts/map";
import { keyNames, spokenKeyNames, t } from "../i18n/t";
import { useVesta } from "../store/store";

/** Re-renders with the map, the platform and the language. */
export function useComboLabel(action: ActionId, how: "shown" | "spoken" = "shown"): string {
  const shortcuts = useVesta((s) => s.shortcuts);
  const isMac = useVesta((s) => s.isMac);
  useVesta((s) => s.language);
  const combo = effectiveMap(shortcuts, isMac)[action][0];
  if (combo === undefined) return t("keyNone");
  return how === "spoken" ? spoken(combo, isMac, spokenKeyNames(isMac)) : label(combo, isMac, keyNames(isMac));
}
