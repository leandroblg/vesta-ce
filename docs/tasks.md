# Tasks, subtasks and reminders

A task is a formatted title plus optional details. A subtask is a task nested one level under another task, with the same properties: its own details, its own alert period and its own age. Reminders are formatted one-liners with a done checkbox and nothing else.

## Actions

| Action | How | Applies to |
| --- | --- | --- |
| Add | Type in the empty card at the end of the list, or Cmd/Ctrl+N (task), Cmd/Ctrl+Shift+N (subtask of the selected task), Cmd/Ctrl+Shift+R (reminder) | Task, subtask, reminder |
| Mark done | The checkbox at the left of the card, or Cmd/Ctrl+Enter; the item moves to the Archive | Task, subtask, reminder |
| Reschedule | The hover button (stale items only), the context menu or the Edit menu, stale or not; see [Aging alerts](alerts.md#rescheduling) | Task, subtask |
| Edit the title | The hover **Edit** button, F2, or a double-click on the card; the title is edited in place. Enter saves, a click outside saves, Esc discards; an empty title brings the last saved one back | Task, subtask, reminder |
| Open the details | A single click on the card, Enter, or context menu → **Show Details** | Task, subtask |
| Add a subtask | Context menu → **New Subtask**, or Cmd/Ctrl+Shift+N | Top-level task |
| Alert period of one task | Context menu → **Alert Period…**, or the details panel | Task, subtask |
| Delete | Context menu → **Move to Trash**, the hover **Delete** button (reminders), or Delete/Backspace; the item moves to the Trash | Task, subtask, reminder |
| Reorder | Drag and drop, or Alt+Up and Alt+Down | Task, subtask, reminder |
| Move, promote, demote | Drag a subtask to another parent or to the top level, or Alt+Left and Alt+Right | Task, subtask |
| Restore | From the Archive or the Trash | Task, subtask, reminder |

The **context menu** opens from the menu button at the right of a hovered card, or from a right-click. It offers New Subtask (top-level tasks only), Show Details, Reschedule, Postpone For (a submenu with four quick durations), Alert Period…, and Move to Trash. The same commands are in the menu bar's Edit menu, so the keyboard reaches them.

## Subtasks

- One level only: a subtask cannot have subtasks.
- A subtask can be marked done or deleted on its own; it then leaves its parent.
- A parent marked done or deleted takes its remaining subtasks with it. Restoring the parent restores the subtasks that went with it.
- Subtasks can be moved between parents and promoted to the top level, and top-level tasks can be demoted into subtasks. Demoting a task that has subtasks moves them too, as siblings under the new parent. Moving keeps each item's creation date and stale state.
- Subtasks keep their manual order under their parent; a stale subtask never moves its parent.

## Drag and drop

Where you drop a dragged task decides whether it becomes a subtask or a top-level task. A drop indicator shows the resulting position and indent before you release.

| Drop position | Result |
| --- | --- |
| Among the subtasks of a task | Subtask of that task, at that position |
| In the gap under a task's last subtask, closer to the subtask | Last subtask of that task |
| In the gap under a task's last subtask, closer to the next task | Top-level task at that position |
| Between two top-level tasks | Top-level task at that position |
| Onto the middle of a task's card | Subtask of that task: first if it has none, otherwise last |
| Onto the middle of a subtask's card | Subtask of the same parent, right after it |

A dragged task that has subtasks and lands as a subtask moves its subtasks too, as siblings. Dragging is disabled while a search is active.

Stale tasks have their own ordering rule: see [Aging alerts](alerts.md#ordering).

## Undo

Marking done, moving to the Trash, restoring and rescheduling each show a notification at the bottom center of the window, "“Renew passport” moved to the Archive." and the like, with an **Undo** button.

- The notification lasts 10 seconds; the countdown keeps running while the pointer is over it. A small close button appears on hover to dismiss it early.
- **Undo** puts the item back where it was, with its subtasks if it is a parent. Undoing a restore puts the item back in the Archive or the Trash with its original date, so its Trash countdown is unchanged.
- Undoing a reschedule puts back the task's stale mark, position and history, and the notification then offers **Redo** for another 10 seconds.
- Only the latest action can be undone: a new done, delete, restore or reschedule replaces the notification.
- Cmd/Ctrl+Z undoes and Cmd/Ctrl+Shift+Z redoes while the notification shows, except while the cursor is in a text field, where they act on the text as usual.

When a change cannot be saved, a **"Changes are not saved"** notification takes the same spot and stays until closed. The view returns to the last saved state, the error is written to the [logs](data.md#logs), and you can repeat the action.
