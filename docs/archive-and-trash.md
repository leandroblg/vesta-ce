# Archive, Trash and automatic cleanup

Done items go to the **Archive**, deleted items to the **Trash**. Both are views of their own, opened from the toolbar or with Cmd/Ctrl+2 and Cmd/Ctrl+3 (Cmd/Ctrl+1 returns to the tasks). Each has two divisions in the main view's order: Reminders on top, then Tasks with their subtasks.

## Archive

- Lists every done reminder, task and subtask with its completion date. Items stay until restored, deleted or removed by the Archive cleanup.
- A task that was stale when it was done looks like any other done item, with a grey "Stale" pill and its total time from creation at the right of its card.
- A done subtask whose parent is still active shows its parent's title in grey as context.
- Each entry has **Restore** and **Delete** buttons. Delete moves the item to the Trash, with the usual notification and Undo. A subtask that went to the Archive with its parent is deleted on its own with Delete/Backspace or the context menu.
- A single click on a task opens its details read-only; Enter does the same on the selected entry.

## Trash

- Lists every deleted reminder, task and subtask. While the Trash cleanup is on, each entry shows the time left before it is permanently deleted.
- Each entry has **Restore** and **Delete permanently** buttons. Permanent deletion asks for confirmation, from the button, from Delete/Backspace and from the Edit menu's **Delete Permanently…**. It cannot be undone.
- An item deleted from the Archive is restored to the Archive, with its completion date, since that is where it came from.

## Restoring

Restore from the Archive or the Trash with the **Restore** button, Shift+Enter on the selected entry, or the Edit menu. Each item can be restored on its own, including a subtask that went there with its parent.

- A restored item keeps its original creation date and returns to its original position if its neighbors still exist, otherwise to the end of its list. A stale item rejoins the stale group.
- A subtask restored into a collapsed parent expands that parent, so you see where it went. A subtask whose parent is done, deleted or gone is restored as a top-level task.
- Restoring a reminder expands a collapsed Reminders section.
- A restore shows the "… restored." notification with **Undo** for 10 seconds.

## Automatic cleanup

Two independent cleanups permanently delete old items. Each has its own switch and time in Settings → Data.

| Cleanup | Removes | Default | On by default |
| --- | --- | --- | --- |
| Archive cleanup | Items done for longer than its time | 10 years | Yes |
| Trash cleanup | Items deleted for longer than its time | 30 days | Yes |

- Each time is set as years (0 to 1000), days (0 to 364) and hours (0 to 23); a total of zero is refused. Both cleanups run when Vesta starts and once an hour while it is open, and every run that removes items is logged with their count.
- An item in the Trash is timed by its deletion date only, so a done item moved to the Trash gets the Trash's full time.
- Each cleanup also removes the subtasks that went with an item and the stored files nothing refers to any more.
- A shorter time, or turning a cleanup on, asks first when it would remove items, in a dialog saying how many; the change is saved only when confirmed. Turning the Trash cleanup off asks too, since deleted items then build up on this computer until deleted by hand.
- For one full hour after any change to a cleanup's setting, that cleanup removes nothing, even across a restart. A line under its fields counts down the time until the change takes effect.
- While a cleanup is off, it removes nothing and its fields keep their values.
