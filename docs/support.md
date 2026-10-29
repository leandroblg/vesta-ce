# Getting help and reporting a problem

Vesta is maintained in the open. Read this page before reporting, since the most common beta questions are answered here or in [Install and run](installation.md).

## Common situations

| What you see | What it means | What to do |
| --- | --- | --- |
| "Windows protected your PC" | The beta build is not signed | Click **More info**, then **Run anyway**. Once only |
| The AppImage does not start | Your system cannot mount it | Use the `.tar.gz`, or run the AppImage with `--appimage-extract-and-run` |
| `sandbox.disabled` in the log | Your Linux system blocks Chromium's sandbox | Nothing to do; Vesta runs without it. See [Linux](installation.md#linux) |
| The `.tar.gz` build does not start on Linux | Same cause | Start it with `./vesta --no-sandbox` |
| "This data was saved by a newer version of Vesta" | You started an older version on newer data | Quit, start the newer version. Nothing was changed |
| "A backup was restored" | The database was damaged at start | Check your recent edits; the last 30 minutes at most may be missing |
| "Changes are not saved" | A change could not be written | The view shows the last saved state; repeat the action. The cause is in the logs |
| "Vesta closed after an unexpected problem" | Vesta quit after an error, after saving pending edits | Open the logs from the notification and report the problem |
| A task blinks although you did nothing | It passed its alert period | That is the aging alert. See [Aging alerts](alerts.md) |

## Before reporting

- Note the version, from About Vesta (Vesta menu on macOS, Help menu elsewhere).
- Export your data with **Include logs** ticked (Settings → Data → Export), or copy the `logs` folder from the [data folder](data.md). The logs record what Vesta did, not what your tasks say, but read them before sending if you want to be sure.
- Try to reproduce the problem once, and note the steps.

## Report

During the beta, send your report to the person who gave you the build. After the release, open an issue in the repository. Include:

- what you did, step by step, and what you expected;
- what happened instead; a screenshot helps;
- your system and the file you ran (AppImage or `.tar.gz`, `.zip` or portable `.exe`);
- the version;
- the log files, or the export with logs;
- on Linux, whether the log mentions `sandbox.disabled`.

## Your data is yours

If you stop using Vesta, your data stays in the [data folder](data.md) and in any export you made. The export's JSON file is plain text, readable by any tool. Deleting the data folder removes everything Vesta kept.
