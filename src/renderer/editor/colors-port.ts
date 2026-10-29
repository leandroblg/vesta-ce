// 011 FR-014, FR-016: the editors' way to the store's pinned and recent colors (one list each for text and
// highlight color). The store saves through main and puts the saved lists back after a failed save.
import { actions, useVesta } from "../store/store";
import type { ColorListsPort } from "./menu/color-picker";

export const storeColorsPort: ColorListsPort = {
  get: () => {
    const s = useVesta.getState();
    return { pinned: s.pinnedColors, recent: s.recentColors };
  },
  set: (next) => {
    void actions.setColorLists(next);
  },
  // 016 FR-019, FR-022: the Text color button's swatch, kept as a setting.
  lastTextColor: () => useVesta.getState().lastTextColor,
  setLastTextColor: (hex) => {
    void actions.setLastTextColor(hex);
  },
};
