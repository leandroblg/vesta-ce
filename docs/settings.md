# Settings, themes and languages

Settings opens from the menu bar (Vesta → Settings… on macOS, File → Settings… on Windows and Linux) or with Cmd/Ctrl+,. It is a dialog laid out like a settings window: a toolbar of panes on top, the pane's name as the title, labels on the left and controls on the right. The last pane shown opens next time. The dialog can be moved by its toolbar and resized from its edges while it is open.

| Pane | Settings |
| --- | --- |
| **General** | Appearance, theme, language, order of table sizes |
| **Alerts** | Alert period, re-blink interval, reschedule tolerance, the four quick reschedule durations |
| **Shortcuts** | Every keyboard shortcut |
| **Data** | Export, import, the Archive and Trash cleanups, the log viewer |
| **Updates** | Check for updates, automatic checks and the reminder |

The Alerts and Shortcuts panes are described in [Aging alerts](alerts.md#settings) and [Keyboard shortcuts](shortcuts.md#changing-a-shortcut); the Data pane in [Your data](data.md) and [Archive, Trash and automatic cleanup](archive-and-trash.md#automatic-cleanup).

## Appearance and theme

**Appearance** is Light, Dark or System. The default, System, follows the operating system and switches at once when it changes.

**Theme** is a palette that changes colors only; the layout, type and components are the same in every theme. Each theme has a light and a dark rendering, and every text meets WCAG AA contrast in both.

| Theme | Colors |
| --- | --- |
| **Hearth** (default) | Vesta's own identity: warm neutrals, ember and gold |
| **System** | The platform's greys and blue |
| **Ubuntu** | Yaru's warm greys, orange and aubergine |
| **Minimalist** | Black, white and one grey; color only where it carries meaning |

The theme is stored and exported with the other settings.

## Language

Vesta ships in English, Portuguese (Brazil), Italian, Spanish (Spain) and French. Dates, times and the age label's units follow the selected language.

The default, **Use system language**, picks the first language in the system's list of preferred languages that Vesta supports, ignoring regional variants, and switches at once when the system language changes. Any other language falls back to English. Once you pick a language, Vesta keeps it whatever the system says, until you select Use system language again.

| System language | Vesta language |
| --- | --- |
| Any English | English |
| Any Portuguese | Portuguese (Brazil) |
| Any Spanish | Spanish (Spain) |
| Any French | French |
| Any Italian | Italian |
| Anything else | English |

## Table sizes

When inserting a table, Vesta writes sizes as columns × rows. A setting in General puts rows before columns in the size fields and the size text.

## Updates

Vesta asks GitHub Releases for the latest version when it starts and once a day while open, and sends nothing about you or your data. A **Check for updates** button checks at any time.

- When a newer version exists, a bottom-center notification says so, a mark shows on the Updates tab and, on macOS, on the Dock icon. The Updates pane shows the release notes, a link to the file for your system and an **All downloads** link to the release page. The download and the replacement are manual; see [Install and run](installation.md#replace-a-build).
- **Check for updates automatically**, on by default, turns the automatic checks off. The button still works.
- While automatic checks are off, a **Remind me to check for updates** checkbox, on by default, shows a reminder every 30 days (7 to 365) inviting a check. The reminder makes no request.
- After a failed check, Vesta tries again every hour until one succeeds.
- Pre-releases are never offered. A beta is offered the release with the same number once it is published.

## About Vesta

**About Vesta** (Vesta menu on macOS, Help menu on Windows and Linux) is a window of its own showing the app icon, the name with the edition, the version, and two buttons: **License**, which opens the name and identity notice above the full AGPL-3.0 text, and **Third-Party Licenses**, which lists the license notices of the bundled packages.
