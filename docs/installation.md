# Install and run

Vesta runs directly from the downloaded file. There is no installer, nothing is written outside your user account, and Vesta never asks for administrator or root rights, neither to run nor to update.

Builds are published on the repository's GitHub Releases page. During the beta they are handed out by hand instead, for Linux and Windows only; a macOS build has to be signed and checked by Apple before it can run on a Mac, and that happens with the first release.

| Platform | Files | How to run |
| --- | --- | --- |
| macOS | `.zip` containing the app (Apple Silicon and Intel) | Unzip and open the app. It can live in any folder; `~/Applications` is a good place |
| Linux (x86_64) | `.AppImage` (primary) and `.tar.gz` | See below. Both run from your home folder; there is no `.deb` or `.rpm` |
| Windows (x64) | `.zip` (recommended) and portable `.exe` | See below. Neither installs anything |

## Check the download

Every release and handout carries a `SHA256SUMS` file with a fingerprint for each file. Checking it proves the files arrived complete and unchanged.

- **Linux**: in the folder with the files, run `sha256sum -c --ignore-missing SHA256SUMS`. Every line it prints must end in `OK`; files you did not download are skipped.
- **Windows**: in PowerShell, in the folder with the files, run `Get-FileHash .\Vesta-<version>-win-x64.zip` (or the `.exe`) and compare the code it prints with the line for that file in `SHA256SUMS`. Upper or lower case does not matter.
- **macOS**: in Terminal, run `shasum -a 256 -c --ignore-missing SHA256SUMS` in the folder with the files.

If a fingerprint does not match, do not run the file: download it again.

## Linux

- **AppImage**: one file. Make it executable once, with `chmod +x Vesta-<version>-linux-x86_64.AppImage` or from your file manager (Properties → Permissions → allow executing), then double-click it or run it from a terminal.
- **.tar.gz**: a folder in an archive. Unpack it anywhere in your home folder with `tar -xzf Vesta-<version>-linux-x86_64.tar.gz`, then run `./vesta` inside the folder it made.

**If the AppImage does not start**, your system cannot mount it. Use the `.tar.gz` instead, or run the AppImage with `--appimage-extract-and-run`. Neither needs root.

**On some systems Vesta runs without Chromium's sandbox.** Vesta is built on Chromium, which normally keeps the window that shows your tasks in a sandbox, an extra wall between that window and the rest of your computer. Some distributions, such as Ubuntu 24.04 and later, block what that sandbox needs unless an administrator sets it up. On those systems only, Vesta starts without it rather than not starting at all, and writes `sandbox.disabled` in its log each time. Everything else that protects you still applies, and Vesta never opens web pages inside its window, but that extra wall is missing. If the `.tar.gz` build does not start on such a system, start it with `./vesta --no-sandbox`.

## Windows

- **.zip**: right-click → Extract All, then open `Vesta.exe` in the extracted folder. This is the better choice for daily use.
- **Portable .exe**: one file; double-click it. It unpacks itself every time it starts, so it opens more slowly.

**"Windows protected your PC"**: SmartScreen shows this for programs that are not signed, because it does not know who made them. Click **More info**, then **Run anyway**. You only see this the first time.

Microsoft Defender may also warn about the files unpacked from the `.zip`. If a warning keeps coming back, or Defender removes a file, [report it](support.md) rather than turning protection off.

## macOS

Unzip the archive and open the app. On the first release the app is signed and notarized, so macOS opens it without a warning. Closing the window hides it: Vesta keeps running in the Dock until you quit it with Cmd+Q or the Quit menu item, and clicking the Dock icon brings the window back.

## Replace a build

Your data lives in [one folder in your user account](data.md), never next to the program, so replacing the program keeps everything.

1. Quit Vesta. On Windows, check it is gone from the taskbar.
2. Replace the old file with the new one, or unpack the new archive. You can also switch between the two files of your system; both use the same data folder.
3. Start the new build. Your tasks, reminders, settings and stored files are all there. If the new version stores data differently, it updates your data on its first start, after making a backup.

Before moving to a new beta, export your data first: Settings → Data → **Export**. If something goes wrong, Settings → Data → **Import** brings everything back.

**Never go back to an older version** after a newer one has opened your data. The older one cannot read the newer data: it shows an empty list and the message "This data was saved by a newer version of Vesta", and it changes nothing. Your data is safe; quit it and start the newer version again.

## Updates

Vesta asks GitHub Releases for the latest version when it starts and once a day while open, and tells you when a newer one exists, with its release notes and a link to the file for your system. The download and the replacement are manual, as above. The automatic check can be turned off in Settings → Updates; see [Settings](settings.md#updates).
