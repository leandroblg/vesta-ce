# Formatting

Every text in Vesta is edited in place, in a what-you-see-is-what-you-get editor: formatting appears as you type, and markdown shortcuts such as `**bold**`, `# Heading` or `- ` for a list convert instantly. Titles and reminders get a text scope; a task's details get the full scope.

| Feature | Titles and reminders | Details |
| --- | --- | --- |
| Bold, italic, underline, strikethrough, inline code, links | Yes | Yes |
| Text color and highlight, with a color picker | Yes | Yes |
| Font size and headings | Yes | Yes |
| Emojis | Yes | Yes |
| Inline images, scaled to the text height | Yes | — |
| Line breaks and dividers | — | Yes |
| Bulleted and numbered lists, quotes | — | Yes |
| Checklists | — | Yes |
| Tables | — | Yes |
| Images and links to local files | — | Yes |
| Code blocks with syntax highlighting | — | Yes |
| Collapsible sections | — | Yes |
| Footnotes | — | Yes |
| YouTube video embeds | — | Yes |
| Inline HTML | — | Yes |

All formatting survives restart, export and import.

## The floating menu

While you edit, a menu floats above the text with the options of the scope you are in. Its label says what a change applies to:

- with text selected, the menu sits above the selection and acts on it ("Selection");
- with nothing selected in a title or reminder, it acts on the whole title or reminder;
- with nothing selected in the details, it acts on the block holding the cursor, and the label names it: "Paragraph", "Heading", "List item", "Quote", "Code block" or "Table cell".

The options come in one fixed order: the text formats (Bold, Italic, Underline, Strikethrough, Code, Text color, Highlight, Increase and Decrease font size, Heading), then the lists and lines (Bulleted list, Numbered list, Checklist, Indent, Quote, Code block, Divider, Table), then the insertions (Link, Insert file or image). A scope leaves out what it lacks. Table options appear on an extra row while the cursor is in a table. The same commands are in the menu bar's Format menu.

Every format button turns its format off again when the whole range already has it, and each action is one Undo step. Some buttons do more on a long press (about half a second) or Shift+Enter when focused: Text color and Highlight open their color picker, Table opens a size grid, Quote nests one level deeper, Code block merges the selected blocks with the code blocks around them, Indent moves list items one level up.

## Writing details

- Enter starts a new paragraph; Shift+Enter breaks the line inside it.
- **Checklist** gives each paragraph or list item in the range a checkbox, and removes the checkboxes when every item already has one. Typing `[]`, `[ ]`, `[x]` or `[X]` followed by a space at the start of a line does the same, `x` making the item checked. Checklists in the details are independent of the task's done state.
- **Indent** moves the selected list items one level deeper; Shift+Indent, Cmd/Ctrl+] and Cmd/Ctrl+[ move them deeper or back. Tab always moves the keyboard focus, so the editor never traps it.
- **Increase and Decrease font size** step each part of the range along a ladder from 0.75 to 2.5 times the surrounding size.
- **Table** inserts a 3-column table with a header row and two body rows. Holding the button opens a size grid up to 20 × 20, with fields for any size up to 100 × 100. In a table, handles at the end of a row and the top of a column, and the extra menu row, add or remove rows and columns or delete the whole table. A table always keeps its header and one body row.
- A **divider**, a horizontal rule, separates sections of the details.
- Without internet, a YouTube embed shows a placeholder with its link.

## Colors

**Text color** and **Highlight** share one picker, opened by a long press or Shift+Enter on either button. A plain click on Text color applies the color currently shown on the button, the last one picked; a plain click on Highlight toggles the default highlight.

The picker offers a **Remove** entry, a grid of 100 preset colors, a row of up to 10 **pinned** colors, two rows of the 20 most recent colors, and **Custom color…**, which opens the system color selector. Pin a color by dragging it onto the pinned row or with Shift+Enter; pinned colors can be reordered and unpinned, and are shared by text and highlight.

A chosen color is drawn exactly as chosen wherever it stays readable in the active theme; otherwise it is drawn lighter or darker, keeping its hue, until it is. Only the drawing changes, never the stored color, so your text looks right in every theme and mode. The picker marks a color that would be adjusted in the current theme.

## Links

**Link** replaces the floating menu with two fields, **Link text** and **Link**, and the buttons Apply, Remove link and Cancel. The text is prefilled with your selection, and both fields with the link's own values when the cursor is inside a link, so it edits that link in place. Remove link is the only way to unlink text.

Vesta accepts safe addresses only: web addresses (`http://`, `https://`), mail addresses (`mailto:`) and references to files Vesta stores. A typed local path or `file:` link is copied into Vesta's data first, after confirmation, so the link points at Vesta's copy. Any other address is refused with a line under the field.

Cmd/Ctrl+click opens a link; a plain click places the cursor. A right-click on a link offers **Copy**, **Copy Link** and **Open Link**, and on a stored file **Show in Finder** (Show in File Explorer on Windows, Show in Folder on Linux). Cmd/Ctrl+Shift+C copies the address of the link at the cursor.

## Files and images

Insert a file with the paperclip button, by dropping it onto the details, or by pasting it. Vesta keeps **its own copy** of every inserted or linked file, so it keeps showing even if the original is moved or deleted; the original file name is what you see. The copies live in Vesta's [data folder](data.md) and go into every export.

- Files up to 100 MB can be inserted or linked; larger files are refused with a message.
- A file named by a typed path or `file:` link is copied only after you confirm it in a dialog that names the file and its folder. A file inside Vesta's own data folder is refused.
- A stored file opens with its default application only when it is a document, image, audio or video type: png, jpg, jpeg, gif, webp, pdf, txt, md, csv, json, mp3, wav, mp4, mov, docx, xlsx and pptx. Any other type is shown in the file manager instead, so a click never runs a program.
- Images in the details show at their size; inline images in titles and reminders are scaled to the height of their line.
