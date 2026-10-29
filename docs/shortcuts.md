# Keyboard shortcuts and menu bar

Vesta is fully usable from the keyboard. Every shortcut can be changed, every menu command can be given one, and the menu bar on every platform carries every command.

## Default shortcuts

Cmd on macOS, Ctrl on Windows and Linux. Where Vesta names the Enter key, macOS reads Return.

| Action | Default |
| --- | --- |
| New task | Cmd/Ctrl+N |
| New subtask of the selected task | Cmd/Ctrl+Shift+N |
| New reminder | Cmd/Ctrl+Shift+R |
| Focus search | Cmd/Ctrl+F |
| Move selection | Up / Down |
| Open details of the selected item (read-only in the Archive and Trash) | Enter |
| Edit the title of the selected item | F2 |
| Mark done | Cmd/Ctrl+Enter |
| Move to Trash (main view) | Delete / Backspace |
| Move item up / down | Alt+Up / Alt+Down |
| Promote / demote the selected item | Alt+Left / Alt+Right |
| Collapse / expand | Left / Right |
| Close panel, cancel edit or clear the selection | Esc |
| Settings | Cmd/Ctrl+, |
| Undo the last done, delete, restore or reschedule, while its notification shows | Cmd/Ctrl+Z |
| Redo an undone reschedule, while its notification shows | Cmd/Ctrl+Shift+Z |
| Copy Link, the address of the link at the cursor | Cmd/Ctrl+Shift+C |
| Restore the selected item (Archive and Trash) | Shift+Enter |
| Indent / outdent list items (details) | Cmd/Ctrl+] / Cmd/Ctrl+[ |
| Minimize window | Cmd+M on macOS; none on Windows and Linux |
| Show Tasks / Archive / Trash | Cmd/Ctrl+1 / Cmd/Ctrl+2 / Cmd/Ctrl+3 |
| Delete permanently (Trash; asks for confirmation) | Delete / Backspace; also Option+Cmd+Backspace on macOS, Shift+Delete on Windows and Linux |
| Every other menu command | none; any free combination can be assigned |

Shortcuts that act on the selected item (the arrows, Enter, F2, Delete) work only while no text is being edited, so typing is never taken as a command. The Archive and the Trash have the same keyboard selection as the main view.

Inside an editor, the usual text keys apply: Cmd/Ctrl+B, I and so on for the formats, Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z for typing undo and redo, Cmd/Ctrl+' to nest a quote.

## Changing a shortcut

In Settings → Shortcuts, press **Change** next to an action, then the new combination. Any key can be captured, Esc included; pressing Esc twice within a second cancels the capture. A combination already used by another action in the same view is refused with a message naming that action. The window's and the system's own combinations (Cmd/Ctrl+Q, Cmd/Ctrl+W, Cmd+H and Option+Cmd+H on macOS, Alt+F4 on Windows and Linux) cannot be assigned.

The actions are grouped under the menu names, plus a **Lists** group for the actions with no menu command. A changed shortcut shows at once beside its menu item.

## Menu bar

On macOS the menus are in the system menu bar. On Windows and Linux they sit inside the window; Alt or F10 opens them and the arrow keys move through them. Labels follow the selected language.

| Menu | Commands |
| --- | --- |
| **Vesta** (macOS) | About Vesta, Settings…, Check for Updates…, Services, Hide, Hide Others, Show All, Quit Vesta |
| **File** | New Task, New Subtask, New Reminder, Export…, Import…; on macOS Close Window, on Windows and Linux Settings…, Check for Updates…, Quit |
| **Edit** | Undo, Redo, Cut, Copy, Copy Link, Paste, Select All, Find, Search Everything, Match Case, Exact Phrase, Mark as Done, Reschedule, Postpone For, Alert Period…, Move to Trash, Restore, Delete Permanently… |
| **Format** | Bold, Italic, Underline, Strikethrough, Code, Highlight, Text Color…, Highlight Color…, Increase and Decrease Font Size, Heading, Bulleted List, Numbered List, Checklist, Indent, Outdent, Quote, Code Block, Divider, Table, Link…, Insert File or Image… |
| **View** | Tasks, Archive, Trash, Show Reminders, Show Details |
| **Window** | Minimize, Zoom (macOS), Show Logs, Bring All to Front (macOS), Close (Windows and Linux) |
| **Help** | Vesta Help (this documentation), Release Notes, and on Windows and Linux About Vesta |

An item that acts on the selected item is disabled while nothing is selected or while text is being edited. Format items are enabled only while a title, reminder or details is being edited, and show the active formats with a check mark. Export… and Import… open Settings at Data and start there; Show Logs opens the log viewer.
