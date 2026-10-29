# Your data

Everything Vesta knows is in one folder in your user account, never next to the program. Nothing is sent anywhere: the only outgoing requests are the [update check](settings.md#updates) and the YouTube videos you embed. There is no telemetry, no analytics and no crash reporting.

| System | Data folder | Logs |
| --- | --- | --- |
| macOS | `~/Library/Application Support/Vesta/` | the `logs` folder inside it |
| Linux | `~/.config/Vesta/` (or `$XDG_CONFIG_HOME/Vesta/` when set) | the `logs` folder inside it |
| Windows | `%APPDATA%\Vesta\` (paste it in File Explorer's address bar) | the `logs` folder inside it |

The folder holds the database with your tasks, reminders, Archive, Trash and settings, the copies of the files you inserted, the latest backup and the logs. Both files of a system (AppImage and `.tar.gz`, portable `.exe` and `.zip`) use the same folder. The folder and its files are readable by your account only.

There is no encryption at rest: protection rests on your operating system account and disk encryption.

## Export

Settings → Data → **Export** saves a zip file to a location you pick. It holds a JSON file with your tasks, subtasks, reminders, Archive, Trash and settings, plus every image and file they use. Tick **Include logs** to add the log files; it is off by default.

A file that is missing or damaged on disk at export time is left out: the export still completes, the message says how many files were left out, and each one is logged. The export is a complete copy of your data, readable without Vesta, and the file to keep before trying a new version or moving to another computer.

## Import

Settings → Data → **Import** reads a zip written by Export and **merges** it with your data:

- Items are matched by their internal id. When both sides have the same item, the version with the newest edit wins. Every change counts as an edit: text, done, delete, restore, move, reschedule and alert period.
- Settings follow the same rule, with three exceptions that err on the safe side: the cleanups' settings are taken only when they keep more, pinned colors are merged color by color, and an import may turn the automatic update check off but never on.
- An import brings back an item that was deleted permanently or removed by a cleanup if the export still has it. Imported items already past a cleanup's time are removed at the next hourly run while that cleanup is on.

Import checks the whole file first, then backs up your current data before writing anything; if the backup cannot be written, the import does not start. If a write fails midway, the backup is restored and the import discarded. While it runs, Settings shows its progress and cannot be closed. When it succeeds, a bottom-center notification shows the result with **Undo import** for 60 seconds, which restores the pre-import backup. The offer ends earlier when you change anything.

## Backups

Vesta backs up its database every 30 minutes while it runs and keeps the latest backup. The time of the last backup is kept across restarts.

- If a backup cannot be written, the last good one is kept, the failure is logged and a notification shows for 10 seconds.
- If the database is corrupt, or an update of its layout fails when Vesta starts, Vesta restores the latest backup and shows a notification saying so and from what time, until closed. Files the restored data no longer uses are moved to a separate folder the notification names, so you can delete them.
- If no valid backup exists, the damaged database is renamed aside and Vesta starts with an empty list, with a notification saying where the damaged file was kept.
- If the data was saved by a newer version of Vesta, the older version refuses it and changes nothing: it shows an empty list, every change fails as "Changes are not saved", export and import are refused, and a notification asks you to open the data with the newer version. See [Replace a build](installation.md#replace-a-build).

Every change you make is saved within half a second (two seconds for a typed time in a group of fields), so a crash or a forced quit can lose at most that much. After an unexpected error, Vesta saves pending edits and quits rather than continuing, and the next start says so with a link to the logs.

## Logs

Settings → Data → **Logs** (or Window → Show Logs) opens a read-only log viewer that shows every log file as one continuous log, newest entry on top. A level selector shows the chosen level and every more important one: Fatal, Error, Warn, Info (the default), Debug and Trace. Debug entries are recorded only while Debug or Trace is selected, and Trace entries only while Trace is.

Logs use at most 50 MiB, in files of 1 MiB; the oldest file is deleted when the limit is reached. They record what Vesta did, not what your tasks say, and never leave your computer unless you export them.
