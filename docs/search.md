# Search

The search box in the toolbar filters the main view as you type. Cmd/Ctrl+F focuses it, and Esc clears it.

## What it matches

- Reminders, task titles, subtask titles and details text, ignoring formatting.
- Several words match an item that contains all of them, in any order, as whole words or parts of words. Case and accents are ignored.
- By default only active items are searched.

## The scope bar

While a search is active, or while the search box's **Search options** button is pressed, a bar under the toolbar shows:

- **Search in:** **Active** (the default) or **Everything**, which extends the search to the Archive and the Trash;
- **Match case**, which makes the search case-sensitive (accents are still ignored);
- **Exact phrase**, which requires the words in the order typed;
- the result count at the right: "12 results", "No results", or "Preparing search…" the first time the index is built.

Match case and Exact phrase are off by default and not remembered across restarts. The same options are in the menu bar's Edit menu.

## How results show

- Matches are highlighted. A task or subtask found through its details shows a one-line excerpt of the details around the match under its title.
- A parent shows when any of its subtasks match, and only its matching subtasks show under it. A matching parent with no matching subtask shows alone.
- Matches inside collapsed parents or a collapsed Reminders section are shown; the collapse state returns when the search is cleared. Collapse toggles cannot be used while searching, so a search never changes a remembered state.
- An item you edit or create during a search stays shown, even if it no longer matches, until the search changes or is cleared.

## While searching

- Dragging is disabled.
- No alert blinks: for alerts, searching counts as the main view not being visible. What went stale during the search blinks when the search is cleared.
- Every other action keeps its usual effect: a restore that expands a parent, for example, shows when the search is cleared.
