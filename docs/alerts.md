# Aging alerts and rescheduling

A task or subtask becomes **stale** when the time since its creation passes its alert period. Vesta then flags it inside the window: it blinks three times in the ember color, keeps an ember tint with a stripe at its left edge, shows a "Stale" pill and its age, and blinks again at every re-blink interval. It stays stale until you reschedule it.

Alerts are visual and in-app only. There is no sound, badge, tray icon or system notification, and nothing happens while the window is hidden.

## Settings

All four live in Settings → Alerts.

| Setting | Default | Range | Scope |
| --- | --- | --- | --- |
| Alert period | 24 h | 1 hour to 9999 days | Global default, with a per-task override |
| Re-blink interval | 4 h | 30 minutes to 30 days | Global |
| Reschedule tolerance | 24 h | 1 hour to 30 days | Global |
| Quick reschedule durations | 1 h, 2 h, 4 h, 6 h | 1 hour to 30 days each | Global; four values |

Each time is entered as days, hours and minutes. A value above a field's maximum becomes that maximum as you type; a total below the minimum shows an error line until corrected. A typed time is saved when the focus leaves its group of fields, on Enter, or two seconds after the last keystroke, so you can type days, hours and minutes in turn.

## How a task goes stale

1. **Age** is the time since the task was created. Editing the title or the details does not reset it.
2. The **effective period** is the task's own alert period if it has one, otherwise the global default.
3. When the age passes the effective period, the task becomes stale: ember tint, ember stripe, three blinks, then the tint stays.
4. **Stale is sticky.** Dragging the task out of the stale group or marking it done keeps the mark. Only **Reschedule** clears it, with one exception: a stale task that has never been rescheduled stops being stale when its alert period is changed to one that has not yet passed, and goes stale again when it does.
5. Every re-blink interval, the task blinks three more times. A re-blink that comes due while the main view is not visible plays once when it next is; missed re-blinks never pile up.
6. A task that became stale while Vesta was closed, the window hidden, another view shown or a search active blinks once when the main view is next visible.
7. Subtasks are evaluated on their own. A collapsed parent shows an indicator while a hidden subtask is stale, and blinks once in its place when it goes stale or re-blinks; an expanded parent never blinks for its subtasks.
8. With the system's "reduce motion" setting on, blinking is replaced by a steady outline in the stale color, shown for as long as the blinks would last.
9. The stale state is never shown by color alone: the "Stale" pill and the age label with a clock icon are always there, and the ember color keeps text readable in every theme.

## Alert period of one task

Context menu → **Alert Period…** opens a small panel at the card with the task's own days, hours and minutes fields and a **Use global default** checkbox. The details panel offers the same. Every change applies at once; there are no Save or Cancel buttons. Ticking **Use global default** removes the task's own period; unticking it gives the task a period equal to the values shown.

Changing the global default or a task's own period updates every task that is not yet stale. A stale task that was never rescheduled is evaluated again, as rule 4 says; a rescheduled task is not affected.

## Rescheduling

**Reschedule** restarts a task's clock without touching its creation date or its age label.

- A stale task shows a **Reschedule** hover button at the right of its card. The context menu, the Edit menu and the details panel offer Reschedule for every task, stale or not; rescheduling a task that is not stale makes it go stale once the tolerance has passed since the reschedule.
- A plain reschedule clears the stale mark at once. The task becomes stale again once the **reschedule tolerance** (24 hours by default) has passed, if it is still open.
- **Quick durations**: press and hold the Reschedule button for about half a second, or open **Postpone For** in the context menu, to choose one of four durations (1, 2, 4 and 6 hours by default) instead of the tolerance. With the keyboard focus on the button, Shift+Enter opens the durations and Enter reschedules by the tolerance.
- Every reschedule can be undone from the bottom-center notification for 10 seconds, and an undone reschedule redone from the notification that follows.
- Each reschedule is recorded in the task's history with its duration, for example "Rescheduled for 1d".

## Ordering

- Stale top-level tasks are pinned as a group at the top of the list, oldest first. No task can be placed above the group.
- When a task goes stale it moves into the group at the position its age gives it, with its subtasks.
- Manual order wins once you drag: a stale task you drag keeps the position you drop it at, in or out of the group, and is no longer sorted by age. Dropping it back in the group's area sorts it by age again.
- After a reschedule, a task you had positioned by hand stays put; one sorted by age moves to the top of the non-stale tasks.
- Subtasks are never sorted: they keep their manual order under their parent.

## Age label

Each stale task and subtask shows its age since creation at the right end of its last line, in two units: `12d 3h`, `5h 40m`, `40m`. It stays current. The unit letters follow the selected language.

| Language | Days | Hours | Minutes | Example |
| --- | --- | --- | --- | --- |
| English | d | h | m | 12d 3h |
| Portuguese (Brazil) | d | h | min | 12d 3h |
| Italian | g | h | min | 12g 3h |
| Spanish (Spain) | d | h | min | 12d 3h |
| French | j | h | min | 12j 3h |

## History

The details panel shows the task's events as a dated timeline, newest first: created, became stale, no longer stale, rescheduled (with the duration), alert period set, changed or cleared, marked done, moved to the Trash, restored. Undoing an action removes the events it recorded. In the Archive, a task that was stale shows a grey "Stale" pill and its total time from creation.
