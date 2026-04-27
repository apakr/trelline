# trelline

A lightweight, offline-first timeline app for planning projects. Inspired by Asana's Timeline view — built as a native desktop app so your data stays on your machine.

No subscriptions. No accounts. No cloud. Your tasks are plain JSON files in a folder you control.

---

## Features

- **Custom SVG timeline canvas** — task bars, drag-to-move, drag-to-resize, all snapping to day boundaries
- **Dependency arrows** — draw finish-to-start dependencies between tasks across any row
- **Sub-lanes** — overlapping tasks stack automatically within a row; drag to reorder
- **Milestones** — render as diamonds on the canvas
- **Zoom levels** — Days, Weeks, Months; scroll position persists per workspace
- **Canvas scale** — 50–200% zoom via Ctrl+scroll, Ctrl+`+`/`-`, or the scale picker in the top bar
- **Undo / redo** — Ctrl+Z / Ctrl+Y
- **Asana import** — import a project directly from an Asana JSON export; sections become rows, tasks/milestones/notes/completion status are all carried over
- **Marquee select** — Ctrl + drag or Middle Mouse Button + drag to select multiple tasks, move or delete as a group
- **Rich text task notes** — full formatting via Tiptap editor
- **Row management** — add, rename, reorder, delete rows; collapsible rows
- **Canvas search** — find tasks by name
- **Settings** — scroll direction, date format, week start day
- **Fully offline** — no network requests, no backend, no database process

---

## Download

Grab the latest installer for your platform from the [Releases](https://github.com/apakr/trelline/releases) page.

| Platform | Format |
|---|---|
| Linux | `.deb`, `.AppImage` |
| Windows | `.msi`, `.exe` |
| macOS (Apple Silicon + Intel) | `.dmg` |

---

## Build from source

**Prerequisites:** [Node.js](https://nodejs.org/) 18+, [Rust](https://rustup.rs/) (stable), and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your OS.

```bash
git clone https://github.com/apakr/trelline.git
cd trelline
npm install
npm run tauri build
```

The compiled installer will be in `src-tauri/target/release/bundle/`.

To run in development mode with hot-reload:

```bash
npm run tauri dev
```

---

## Data format

A workspace is just a folder on your filesystem:

```
my-workspace/
  workspace.json      # rows, zoom level, scroll position
  tasks/
    task_<uuid>.json  # one file per task
```

All files are human-readable JSON. You can open them in any text editor, back them up with any tool, or version-control them with git.

---

## Tech stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri 2 (Rust) |
| Frontend | React 19 + TypeScript |
| Timeline rendering | Custom SVG — no Gantt library |
| Styling | Tailwind CSS |
| Data | JSON files via `@tauri-apps/plugin-fs` |

---

## Status

Early release. Core functionality is complete. Known gaps: no auto-updater, no export. Feedback and issues welcome.
