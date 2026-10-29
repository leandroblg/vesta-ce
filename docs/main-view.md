# The main view

Vesta has one home screen. From top to bottom: the toolbar, a collapsible **Reminders** section and the **Task list**. Clicking a task opens its **details panel** on the right, and the list stays visible and usable. The Archive and the Trash are separate views reached from the toolbar.

```
+------------------------------------------------------------------+
| ◉ Vesta              [⌕ Search          ≡]   [Archive] [Trash]   |
+------------------------------------------------------------------+
| v Reminders                                                      |
|  [ ] Call the bank before **Friday**                             |
|  [ ] Pick up _dry cleaning_                                      |
|  [ + new reminder...                                         ]   |
+------------------------------------------------------------------+
| Tasks                                                            |
|  [ ] > Renew passport                  (stale)  (!)    12d 3h    |
|  [ ] v Prepare quarterly report                                  |
|        [ ] Gather sales numbers                                  |
|        [ ] Draft summary                                         |
|  [ ] Fix bike                                                    |
|  [ + new task...                                             ]   |
+------------------------------------------------------------------+
```

## Toolbar

The window identity at the left, the search box in the middle and the **Archive** and **Trash** buttons at the right. On macOS the toolbar sits in the title bar beside the traffic lights, and any empty part of it moves the window. Settings has no toolbar button: it opens from the menu bar or with Cmd/Ctrl+,.

Vesta has a complete menu bar on every platform, the system menu bar on macOS and the window's own on Windows and Linux. Every button, context menu item, search option and formatting option is also a menu command, so everything can be done from the menus and the keyboard. See [Keyboard shortcuts and menu bar](shortcuts.md).

## Reminders

Reminders are formatted one-liners for things that need no tracking: no alert, no deadline, no details, no subtasks. Each has a done checkbox at its left. Hovering a reminder shows **Edit** and **Delete** buttons.

- The section can be collapsed and expanded; it starts expanded and remembers its state across restarts.
- A done reminder moves to the Reminders division of the Archive; a deleted one to the Reminders division of the Trash. Both can be restored.
- Up to 200 reminders can be active at once. At the limit, the empty card at the end of the list reads "Maximum reminders reached" until fewer are active. Undo, restore and import are never refused because of the limit.

## Task list

The list shows every active top-level task, with its subtasks indented beneath. Each row is a card: the done checkbox at the left, a collapse toggle for parents with subtasks, the formatted title and a drag handle at the right.

- Rows grow as tall as their title needs: titles wrap, and headings, font sizes and inline images set the height.
- Under the pointer, or when a button has the keyboard focus, a card shows its buttons at its right end: **Reschedule** (stale tasks only), **Edit** and the **menu** button that opens the context menu.
- Every parent can be collapsed; it starts expanded and remembers its state. A collapsed parent shows an indicator while one of its hidden subtasks is stale.
- Order: stale tasks first, oldest on top, then your manual order. See [Aging alerts](alerts.md#ordering).
- An empty card at the end of the list, "New task…", creates a top-level task: type and press Enter. An empty card left without text creates nothing.
- When the list is empty, a short prompt names the New task shortcut.

A selected card, selected with the keyboard or open in the details panel, is filled with the accent color. A click outside every card and outside the panel clears the selection and closes the panel. Esc clears it when the panel is closed.

## Details panel

A single click on a task or subtask, or **Show Details** in the context menu, opens the panel at the right with:

- the **title**, editable;
- the **details**, a full document with the [complete formatting scope](formatting.md);
- the **alert period** of this task, with a **Use global default** checkbox (see [Aging alerts](alerts.md#alert-period-of-one-task));
- the **created** date and time, and the status with its date and time: "Stale since", and in the read-only panel "Done on" or "Deleted on";
- the **history**, a dated timeline of what happened to the task: created, became stale, rescheduled, alert period changed, marked done, moved to the Trash, restored.

Changes to the title and details save on their own half a second after you stop typing; there is no Save button. A green **Saved** shows at the panel's upper right for three seconds after each save. If a save fails, a red **Changes not saved** stays there until the panel is closed or a later save succeeds. An empty title is never saved: the last saved title comes back.

The panel closes with its close button, Esc, or a click anywhere outside it. Clicking another task switches the panel to that task; clicking a reminder closes it, since reminders have no details. If the panel's task is marked done or deleted, the panel closes.

The panel's width can be dragged and is remembered. On narrow windows it overlays the list instead of sitting beside it. In the Archive and the Trash, a click on a task opens the same panel read-only: title, details, dates and history, nothing editable.

## Notifications

Vesta shows its messages inside the window, at the bottom center, never as system notifications:

- **"… moved to the Archive."**, **"… moved to the Trash."**, **"… restored."** and **"… rescheduled."**, each with an **Undo** button, for 10 seconds. See [Tasks](tasks.md#undo).
- **"Changes are not saved"** when a change could not be written; it stays until closed. The view returns to the last saved state and you can repeat the action.
- A newer version is available, a backup was restored, or an import finished. See [Your data](data.md).

## Closing the window

On macOS, closing the window hides it and Vesta keeps running in the Dock until you quit it (Cmd+Q or Vesta → Quit Vesta). Clicking the Dock icon or launching Vesta again brings the window back. On Windows and Linux, closing the window quits Vesta.
