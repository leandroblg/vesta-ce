# Vesta

Local-first desktop task organizer (Electron, TypeScript, SQLite, Milkdown), AGPL-3.0.

This repository holds the code, `README.md` and the user documentation in `docs/` (installation, user manual, support). The development documentation (PRD, engineering constitution, build runbook, security audit, tester guide, feature specs, prototypes) is maintained outside it; `CLAUDE.local.md`, when present, says where it is. Never add development documentation to this repository, and never let a tracked file name where it lives. `docs/` is written for users: it describes what Vesta does, in plain language, and never cites the PRD, its decisions or feature numbers.

## Working rules

- Work happens one Spec Kit feature at a time, on the branch the `before_specify` hook creates. Never create feature branches by hand.
- Stay inside the current feature's scope. Anything for a later feature goes into that feature's notes, not into code.
- Commits are GPG-signed. If signing fails with "Inappropriate ioctl for device", stop and ask the user to unlock the key in their terminal.
- Domain logic lives in `src/domain` as pure TypeScript with an injectable clock, tested first (constitution IV).

## Commands

Defined in `package.json`: `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run build`. The beta handout, `npm run package:beta -- --guide <path>`, takes the tester guide's path because the guide is not kept here.
