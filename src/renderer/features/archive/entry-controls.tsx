/**
 * Controls shared by every Archive and Trash entry, task or reminder (001 FR-032 to FR-034, 002 FR-016):
 * Restore, Delete permanently with a confirming second click, and the time left before the Trash cleanup removes it.
 */
import { useState, type MouseEvent } from "react";
import { DAY_MS, timeLeft } from "../../../domain/cleanup";
import { formatAge } from "../../../domain/age";
import { Restore } from "../../components/icons";
import { rendererClock } from "../../clock";
import { ageUnits, t } from "../../i18n/t";
import { actions, useVesta } from "../../store/store";
import { inCardArea } from "../tasks/card-area";

/**
 * 018 FR-019 (PRD Q278): the time left under the Trash cleanup, from the deletion date: whole days while at least one
 * is left, then the age label's form; nothing while the Trash cleanup is off.
 */
export function TimeLeft({ deletedAt }: { deletedAt: number }) {
  const trash = useVesta((s) => s.cleanup.trash);
  const left = timeLeft(deletedAt, rendererClock.now(), trash);
  if (left === null) return null;
  // Whole days, rounded up, while at least one is left (an item deleted now shows the full time); under a day, the
  // age label's form.
  return (
    <span className="days">
      {left >= DAY_MS ? t("daysLeft", { count: Math.ceil(left / DAY_MS) }) : t("timeLeft", { t: formatAge(left, ageUnits()) })}
    </span>
  );
}

/** `label`: the item's text, for the accessible name. */
export function RestoreButton({ label, onRestore }: { label: string; onRestore: () => void }) {
  return (
    <button type="button" className="btn" data-ctl="restore" aria-label={t("restoreItem", { t: label })} onClick={onRestore}>
      <Restore />
      {t("restore")}
    </button>
  );
}

/**
 * 018 FR-009 (PRD Q272): an Archive entry's Delete button, beside Restore. It moves the entry to the Trash and is
 * undoable, so it is a plain button, not a danger one (research §4).
 */
export function DeleteButton({ label, onDelete }: { label: string; onDelete: () => void }) {
  return (
    <button type="button" className="btn" data-ctl="delete" aria-label={t("deleteItem", { t: label })} onClick={onDelete}>
      {t("deleteBtn")}
    </button>
  );
}

/**
 * A Trash entry's Delete permanently button: a first click arms it, a second deletes (007 FR-031a). The Delete keys
 * and the menu's Delete Permanently… ask in a dialog instead (013 FR-018, PRD Q187).
 */
export function DeleteForever({ label, onDelete }: { label: string; onDelete: () => Promise<unknown> }) {
  const [armed, setArmed] = useState(false);
  const name = armed ? t("confirmDelItem", { t: label }) : t("delForeverItem", { t: label });
  return (
    <button
      type="button"
      className="btn danger"
      data-ctl="delforever"
      aria-label={name}
      onBlur={() => {
        setArmed(false);
      }}
      onClick={() => {
        if (!armed) {
          setArmed(true);
          return;
        }
        void onDelete();
      }}
    >
      {armed ? t("confirmDel") : t("delForever")}
    </button>
  );
}

/**
 * 011 FR-022b: an Archive or Trash row is itself the keyboard selection (Enter opens a task's details read-only,
 * Shift+Enter restores), and a click in a task row's area, outside its buttons, opens the read-only panel.
 */
export function entryRowProps(id: string, kind: "task" | "rem"): { tabIndex: number; onClick?: (e: MouseEvent<HTMLLIElement>) => void } {
  if (kind === "rem") return { tabIndex: -1 };
  return {
    tabIndex: -1,
    onClick: (e) => {
      if (inCardArea(e.target, e.clientX, e.currentTarget)) actions.openPanel(id);
    },
  };
}
