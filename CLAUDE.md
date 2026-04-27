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

This is a **Tauri 2 + React 19 desktop app** — a Timeline tool modeled exactly on Asana's Timeline view. Offline, single-user. There is no server; all persistence goes through Tauri's `fs` plugin writing JSON files to the local filesystem.

**Frontend** (`src/`): React + TypeScript, built with Vite. Communicates with Rust via Tauri's `invoke()` IPC calls.

**Backend** (`src-tauri/`): Rust + Tauri 2. Exposes IPC commands to the frontend. All real file I/O goes through `@tauri-apps/plugin-fs`.

### Timeline Canvas

**The timeline canvas is custom SVG — no third-party Gantt library is used.** Do not introduce Frappe Gantt, vis-timeline, or any other Gantt/timeline library. The canvas is built in `TimelineCanvas.tsx` using React + SVG directly.

The foundation of the canvas is a coordinate function:
```ts
dateToX(date, viewStart, viewEnd, canvasWidth): number
```
Every rendered element — bars, grid lines, arrows, the date axis, the today line — derives its position from this function.

**The canvas uses virtual rendering + extend-on-demand:**
- `viewStart`/`viewEnd` = the total canvas date range. Starts from task bounds + padding; grows as the user scrolls past the edge.
- `renderStart`/`renderEnd` = the window of SVG elements actually in the DOM = visible viewport + ~1.5x buffer. Only elements within this window are created; elements outside are not rendered.
- A `requestAnimationFrame`-batched scroll handler triggers a React re-render only when scroll crosses a buffer boundary.
- Left-side extension adjusts `scrollLeft` by `newDays * pxPerDay` to prevent jumping.
- `scrollCenterDate` is saved to `workspace.json` (debounced) and restored on open.

### Component tree
```
App
├── WorkspacePicker        — first-launch / no workspace screen
└── TimelineView           — main layout shell
    ├── TopBar             — zoom controls, workspace name, "+ New Task"
    ├── RowPanel           — fixed left sidebar: row labels, drag-to-reorder, "+ Add Row"
    ├── TimelineCanvas     — custom SVG canvas: date axis, grid, task bars, dependency arrows
    └── TaskDetailPanel    — right sidebar, opens on task click
```

### Canvas scale
The `canvasScale` multiplier (stored in `workspace.json`) controls `pxPerDay`. It ranges from 0.5–2.0 (50–200%) in 10% steps. Three ways to change it:
- **Ctrl+scroll** on the canvas — fine 1% increments via `localScaleRef` accumulator in `TopBar`
- **Ctrl+`+` / Ctrl+`-`** keyboard shortcut — 10% steps, handled in `TopBar`'s global `keydown` listener
- **Scale picker dropdown** in `TopBar` — click/type a percentage or pick from preset list

Scale changes are atomic via a `setCanvasScaleRef` indirection that avoids stale closures overwriting `workspace.zoom`.

### Asana import
Users can import a project from an Asana JSON export (`Project → (Your Project Name) → Export / Print → JSON`). Entry points:
- **WorkspacePicker** — "Import from Asana (JSON)" button creates a brand-new workspace from the file
- **TopBar workspace dropdown** — "Import from Asana" appends rows/tasks into the currently open workspace (undoable)

**Mapping rules:**
- Asana sections → Trelline rows (one row per section; tasks with no section → "Uncategorized" row)
- `start_on` / `due_on` → `start` / `end`; missing `start_on` falls back to `due_on`; fully missing dates → today
- `resource_subtype: "milestone"` → `isMilestone: true`, `start = end = due_on`
- `completed: true` → `status: "done"`
- `notes` → `notes`
- Subtasks are flattened into their parent's row as regular tasks
- Dependencies are **not** imported — Asana's JSON export does not include dependency links
- Tasks within each row are sorted by start date; each is assigned a unique `lane` index so they render one-per-lane, mirroring Asana's per-task rows within sections

**Key files:** `src/lib/asanaImport.ts` (pure parser), `src/components/AsanaImportModal.tsx` (multi-step UI), `src/lib/fs.ts → bulkCreateWorkspace`, `WorkspaceContext → importAsanaIntoWorkspace`.

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

File I/O is handled through a set of async helpers (`openWorkspace`, `saveTask`, `deleteTask`, `saveWorkspace`, `createWorkspace`, `bulkCreateWorkspace`) — all going through `@tauri-apps/plugin-fs`. Last-opened workspace path is stored in Tauri's app local data dir via `@tauri-apps/plugin-store`.

### IDs
- Task IDs: `uuid v4` prefixed with `task_`
- Row IDs: `uuid v4` prefixed with `row_`
- `overdue` status is computed at render time (end date passed + status is `not_done`); it is **never written to disk**

### Installed dependencies
- `tailwindcss` — styling
- `date-fns` — date manipulation
- `uuid` — ID generation
- `@tauri-apps/plugin-fs` — file I/O
- `@tauri-apps/plugin-dialog` — folder picker
- `@tauri-apps/plugin-store` — persistent app config

## Key Files
- `SPEC.md` — full product requirements, data schemas, UI layout, and feature details. Read this before implementing any feature.
- `src/components/timeline/TimelineCanvas.tsx` — custom SVG canvas, the core of the app
- `src/context/WorkspaceContext.tsx` — all state and disk persistence
- `src/types/index.ts` — Task, Row, ZoomLevel, WorkspaceState types
- `src/lib/asanaImport.ts` — pure Asana JSON parser (no I/O); call `parseAsanaExport(raw)` to get rows/tasks/warnings
- `src/components/AsanaImportModal.tsx` — multi-step Asana import UI (file select → preview → import)
- `src-tauri/tauri.conf.json` — app config (identifier: `com.allen.timeline_app`, window size, CSP)
- `src-tauri/src/lib.rs` — Rust IPC command handlers
