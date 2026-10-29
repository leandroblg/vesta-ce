# Vesta CE

**Nothing goes cold.**

Vesta is a desktop task organizer that works offline, needs no account and keeps everything on your computer. It shows one view: free-text reminders on top, your task list below. A task that has been open longer than you want is flagged inside the window with a calm visual alert, never with a notification. Every text you type, titles included, is formatted live in markdown.

This repository holds the code of Vesta Community Edition (Vesta CE), free software under the GNU Affero General Public License, version 3, and its user documentation. It runs on macOS, Linux and Windows.

**Status:** beta (`0.1.0-beta.1`). It works, but it has not been released yet, so expect rough edges. Beta builds are handed out by hand for Linux and Windows; the first release will ship for the three platforms through GitHub Releases.

## Why Vesta

Most task apps ask you to sign up, sync to a cloud and push notifications at you. Vesta is for people who want a private, local list that nudges them only while they are looking at it.

- **No account, local first.** Fully usable offline. The only network requests are the optional update check and YouTube videos you embed in a task's details.
- **One view.** Everything important is on the main screen; a side panel holds a task's details.
- **Calm alerts.** A stale task blinks in an ember color a few times and keeps a tint. No sound, badge, tray icon or system notification.
- **Formatting everywhere.** Bold, headings, colors, emojis and images in titles; lists, tables, checklists, code, footnotes, files and more in details.
- **Your data is yours.** One folder in your user account, exported to a zip whenever you want, imported back on any computer.

Out of scope, on purpose: accounts, sync, sharing, deadlines, calendars, recurring tasks, OS notifications, multiple lists, tags, mobile and web versions.

## Get started

1. [Install and run](docs/installation.md): the files for each platform, the first-run warnings of the beta, and how to replace a build.
2. Type in the empty card at the end of the task list and press Enter. That is your first task; click it to open its details.
3. Leave it open for a day with the default settings and it goes stale: it blinks, keeps an ember tint and moves to the top. **Reschedule** calms it down.

## User manual

| Page | What it covers |
| --- | --- |
| [The main view](docs/main-view.md) | The toolbar, the Reminders section, the task list, the details panel, notifications |
| [Tasks, subtasks and reminders](docs/tasks.md) | Every action, nesting rules, drag and drop, Undo |
| [Aging alerts and rescheduling](docs/alerts.md) | How a task goes stale, the alert settings, Reschedule and quick durations, ordering, the age label, history |
| [Archive, Trash and automatic cleanup](docs/archive-and-trash.md) | Done and deleted items, restoring, the two cleanups |
| [Formatting](docs/formatting.md) | The two formatting scopes, the floating menu, colors, links, files and images |
| [Search](docs/search.md) | What the search matches, the scope bar, how results show |
| [Keyboard shortcuts and menu bar](docs/shortcuts.md) | Every default shortcut, how to change one, the menus |
| [Settings, themes and languages](docs/settings.md) | The five panes, appearance and themes, languages, the update check, About |
| [Your data](docs/data.md) | Where it lives, export, import, backups, recovery, logs, privacy |
| [Getting help](docs/support.md) | Common situations and how to report a problem |

Defaults worth knowing: a task goes stale after 24 hours, re-blinks every 4 hours and is calmed for 24 hours by a reschedule; the Archive is cleaned after 10 years and the Trash after 30 days; every one of them can be changed in Settings.

## Build from source

Requirements: Node.js 24 or later and npm.

```sh
npm install
npm run dev          # run the app with live reload
npm run lint
npm run typecheck
npm test             # unit tests
npm run test:e2e     # end-to-end tests (builds first)
npm run build
npm run package:mac  # or package:linux, package:win
```

Stack: Electron, TypeScript, React, SQLite (better-sqlite3) and the Milkdown editor. Domain logic lives in `src/domain` as pure TypeScript with an injectable clock; `src/main` is the Electron main process, `src/renderer` the window, `src/preload` the bridge between them and `src/shared` the contracts both sides use.

## License and name

Vesta CE is licensed under the GNU Affero General Public License, version 3 (`LICENSE`). The license covers the code only. Vesta's name, its logo (the hearth mark), its visual identity and the vesta.tools domain are reserved; `TRADEMARKS.md` says what the names "Vesta CE" and "Vesta Community Edition" may be used for.

Copyright © 2026 Leandro Gonçalves.
