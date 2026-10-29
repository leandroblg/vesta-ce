/** The shortcut map: stored overrides over the platform defaults (007 FR-020, FR-033, FR-036, FR-038). */
import { SHORTCUT_ACTIONS, actionById, isActionId, viewsOf, type ActionId, type ActionView } from "./actions";
import { canAssign } from "./assign";
import type { Combo } from "./combo";

/** Only the actions whose combinations differ from the defaults (research §7). */
export type ShortcutOverrides = Partial<Record<ActionId, readonly Combo[]>>;
export type ShortcutMap = Record<ActionId, readonly Combo[]>;

export interface OverrideIssue {
  /** The stored key; null when the whole value was unreadable. */
  action: string | null;
  kind: "unreadable" | "unknown" | "invalid" | "conflict";
}

export function effectiveMap(overrides: ShortcutOverrides, isMac: boolean): ShortcutMap {
  const map = {} as ShortcutMap;
  for (const a of SHORTCUT_ACTIONS) map[a.id] = overrides[a.id] ?? a.defaults(isMac);
  return map;
}

/** The action that holds `combo` and can act in `view`; global, close and undo actions act in every view. */
export function actionFor(combo: Combo, map: ShortcutMap, view: ActionView): ActionId | null {
  for (const a of SHORTCUT_ACTIONS) {
    if (map[a.id].includes(combo) && viewsOf(a).includes(view)) return a.id;
  }
  return null;
}

/** `overrides` without the entry of `action`. */
function without(overrides: ShortcutOverrides, action: ActionId): ShortcutOverrides {
  return Object.fromEntries(Object.entries(overrides).filter(([id]) => id !== action));
}

const sameList = (a: readonly Combo[], b: readonly Combo[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/** Gives `action` the one combination `combo`; an override equal to the defaults is removed (FR-033). */
export function assign(overrides: ShortcutOverrides, action: ActionId, combo: Combo, isMac: boolean): ShortcutOverrides {
  const rest = without(overrides, action);
  return sameList([combo], actionById(action).defaults(isMac)) ? rest : { ...rest, [action]: [combo] };
}

/**
 * A stored map → a map that only holds valid, conflict-free entries. Damaged entries are dropped one by one
 * (FR-038). A conflict drops the override of the later action in FR-020 order; an override that conflicts
 * with another action's default is dropped too, so the result never needs a default to give way.
 */
export function normalizeOverrides(raw: unknown, isMac: boolean): { overrides: ShortcutOverrides; issues: OverrideIssue[] } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { overrides: {}, issues: [{ action: null, kind: "unreadable" }] };
  }
  const issues: OverrideIssue[] = [];
  let kept: ShortcutOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isActionId(key)) {
      issues.push({ action: key, kind: "unknown" });
      continue;
    }
    const valid =
      Array.isArray(value) &&
      value.length >= 1 &&
      value.length <= 2 &&
      value.every((c): c is string => typeof c === "string") &&
      new Set(value).size === value.length;
    if (!valid) {
      issues.push({ action: key, kind: "invalid" });
      continue;
    }
    kept[key] = value;
  }
  // Rules first (against the defaults only), then conflicts, the earlier action in FR-020 order winning.
  const order = SHORTCUT_ACTIONS.map((a) => a.id).filter((id) => kept[id] !== undefined);
  for (const id of order) {
    const combos = kept[id] ?? [];
    const others = effectiveMap({}, isMac);
    others[id] = [];
    const refused = combos.some((c) => {
      const check = canAssign(id, c, others, isMac);
      return !check.ok && check.reason !== "inUse";
    });
    if (refused) {
      kept = without(kept, id);
      issues.push({ action: id, kind: "invalid" });
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    const map = effectiveMap(kept, isMac);
    for (const id of SHORTCUT_ACTIONS.map((a) => a.id)) {
      const combos = kept[id];
      if (combos === undefined) continue;
      const conflict = SHORTCUT_ACTIONS.some((other) => {
        if (other.id === id || !combos.some((c) => map[other.id].includes(c))) return false;
        if (!viewsOf(other).some((v) => viewsOf(actionById(id)).includes(v))) return false;
        const otherOverridden = kept[other.id] !== undefined;
        const otherEarlier = order.indexOf(other.id) < order.indexOf(id);
        return !otherOverridden || otherEarlier;
      });
      if (conflict) {
        kept = without(kept, id);
        issues.push({ action: id, kind: "conflict" });
        changed = true;
        break;
      }
    }
  }
  return { overrides: kept, issues };
}
