/**
 * An imported shortcut set on this OS (008 FR-033, research §5). Sets are stored with the OS-neutral `Mod`, so
 * they keep their meaning across OSes; a remap this OS refuses (a reserved combination, or one another action
 * holds here by default) is dropped and its action falls back to its default. This is 007's normalization,
 * which already applies exactly those rules, reporting the dropped action ids for the log.
 */
import { normalizeOverrides, type ShortcutOverrides } from "./map";

export function sanitizeImportedOverrides(raw: unknown, isMac: boolean): { kept: ShortcutOverrides; dropped: string[] } {
  const { overrides, issues } = normalizeOverrides(raw, isMac);
  const dropped = issues.map((i) => i.action).filter((a): a is string => a !== null);
  return { kept: overrides, dropped: [...new Set(dropped)] };
}
