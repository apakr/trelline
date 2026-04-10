# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run the full desktop app in dev mode (React hot-reload + Rust recompile)
npm run tauri dev

# Run only the React frontend (no Tauri shell)
npm run dev

# Type-check + build frontend
npm run build

# Run Tauri CLI commands directly
npm run tauri -- <subcommand>
```

## Architecture

This is a **Tauri 2 + React 19 desktop app** — a Timeline/Gantt tool (offline, single-user). There is no server; all persistence goes through Tauri's `fs` plugin writing JSON files to the local filesystem.

**Frontend** (`src/`): React + TypeScript, built with Vite. Communicates with Rust via Tauri's `invoke()` IPC calls.

**Backend** (`src-tauri/`): Rust + Tauri 2. Exposes IPC commands to the frontend. Currently only has a demo `greet` command; all real file I/O will live here.

### Planned component tree (from SPEC.md)
```
App
├── WorkspacePicker        — first-launch / no workspace screen
└── TimelineView           — main layout shell
    ├── TopBar             — zoom controls, workspace name, "+ New Task"
    ├── RowPanel           — left sidebar: row list, drag-to-reorder, "+ Add Row"
    ├── TimelineCanvas     — Frappe Gantt wrapper + SVG dependency arrow overlay
    └── TaskDetailPanel    — right sidebar, opens on task click
```

### State management
One React context — `WorkspaceContext` — holds all in-memory workspace + task state. Every mutation writes to disk immediately via Tauri fs plugin (no batching, no undo).

### Data layer
Workspaces are plain folders on the filesystem:
```
my-workspace/
  workspace.json      # workspace metadata + rows + zoom level
  tasks/
    task_<uuid>.json  # one file per task
```

File I/O is handled through a set of async helpers (`openWorkspace`, `saveTask`, `deleteTask`, `saveWorkspace`, `createWorkspace`) — all going through `@tauri-apps/plugin-fs`. Last-opened workspace path is stored in Tauri's app local data dir via `@tauri-apps/plugin-store`.

### IDs
- Task IDs: `uuid v4` prefixed with `task_`
- Row IDs: `uuid v4` prefixed with `row_`
- `overdue` status is computed at render time (end date passed + status is `not_done`); it is **never written to disk**

### Dependencies to install before building features
These are specified in SPEC.md but not yet installed:
- `frappe-gantt` — Gantt bar rendering + drag interactions
- `tailwindcss` — styling
- `date-fns` — date manipulation
- `uuid` — ID generation
- `@tauri-apps/plugin-fs` — file I/O
- `@tauri-apps/plugin-dialog` — folder picker
- `@tauri-apps/plugin-store` — persistent app config

## Key Files
- `SPEC.md` — full product requirements, data schemas, UI layout, and feature details. Read this before implementing any feature.
- `src-tauri/tauri.conf.json` — app config (identifier: `com.allen.timeline_app`, window size, CSP)
- `src-tauri/src/lib.rs` — Rust IPC command handlers
