# Timeline App — Product Requirements Document

## Overview

A standalone desktop application (Tauri + React) that replicates and extends Asana's Timeline view. Single-user, fully offline, data stored as JSON files on the local filesystem. The app feels like a polished native desktop product — not a web app in a window.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri (Rust) | Lightweight native app, direct filesystem access, no Electron bloat |
| Frontend | React + TypeScript | Component model fits complex interactive UI |
| Gantt rendering | Frappe Gantt | MIT licensed, handles bar rendering, drag-to-move, drag-to-resize |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Data | JSON files (one per task) | Portable, human-readable, no database process needed |

---

## Data Model

### Workspace
A workspace is a folder on the filesystem. Opening a workspace means pointing the app at a folder. The folder contains:

```
my-workspace/
  workspace.json
  tasks/
    task_<id>.json
    task_<id>.json
    ...
```

**workspace.json**
```json
{
  "id": "workspace_abc",
  "name": "Annual Conference Plan",
  "rows": [
    { "id": "row_1", "name": "Foundational", "order": 0, "color": "#a78bfa" },
    { "id": "row_2", "name": "Travel + Lodging", "order": 1, "color": "#34d399" }
  ],
  "zoom": "weeks",
  "lastOpened": "2026-04-07T10:00:00Z"
}
```

**task_<id>.json**
```json
{
  "id": "task_abc123",
  "title": "Finalize event name",
  "rowId": "row_1",
  "start": "2026-05-01",
  "end": "2026-05-03",
  "status": "not_done",
  "color": "#a78bfa",
  "isMilestone": false,
  "notes": "Check with stakeholders before finalizing.",
  "dependencies": ["task_xyz789"],
  "createdAt": "2026-04-01T09:00:00Z",
  "updatedAt": "2026-04-07T10:00:00Z"
}
```

**Task status values:** `not_done` | `done` | `overdue` (overdue is computed automatically — if `end` date has passed and status is still `not_done`, the app renders it as overdue; it is never written to the file)

---

## Application Structure

### Screens

1. **Workspace Picker** — shown only on first launch or when no last workspace is remembered. Simple screen listing recent workspaces with an "Open Folder" button.
2. **Timeline View** — the main screen. Opens directly to the last used workspace on subsequent launches.

### Layout — Timeline View

```
┌─────────────────────────────────────────────────────────────┐
│  [App name]  [Workspace name ▾]          [+ New Task] [⚙]  │  ← Top bar
├──────────┬──────────────────────────────────────────────────┤
│          │  Apr 26  27  28  29  30 │ May 1   2   3   4   5  │  ← Date axis
│  Row nav │─────────────────────────────────────────────────  │
│          │                                                    │
│ Foundati │   ████████████  ◆  ████                           │  ← Task bars
│ Travel   │         ████████████████                          │
│ Vendors  │                  ██████████████                   │
│          │                                                    │
│ [+ Row]  │                                                    │
└──────────┴──────────────────────────────────────────────────┘
                          ↑ current date line (vertical)
```

---

## Features

### Timeline Canvas

- **Date axis** runs left to right across the top
- **Vertical red line** marks today's date, always visible, updates in real time
- **Rows** run horizontally, listed on the left panel
- **Task bars** appear on their respective row, spanning their start→end dates
- **Milestones** render as a diamond (◆) shape on a single day

### Zoom Levels
Three zoom levels toggled via a control in the top bar:
- **Days** — each column = 1 day
- **Weeks** — each column = 1 week (default)
- **Months** — each column = 1 month

Zoom level is persisted per workspace in `workspace.json`.

### Task Bars

**Appearance:**
- Rounded rectangle with task title truncated inside
- Color is per-task (user-defined, defaults to row color)
- Status affects appearance:
  - `not_done` — full color
  - `done` — desaturated/muted with a checkmark icon on the bar
  - `overdue` — red tint/border, computed automatically

**Interactions:**
- **Drag bar** — moves task left/right, updating start and end dates. Connected arrow lines follow visually but connected tasks do NOT move.
- **Drag left edge** — changes start date only
- **Drag right edge** — changes end date only
- **Click** — opens the Task Detail Panel (right sidebar)
- **Hover** — shows connector dots on left and right edges for drawing dependency arrows

### Dependency Arrows

- Hover a task bar → small circular connector dots appear on left and right edges
- Drag from a connector dot to another task → draws a curved arrow line between them
- Arrow is purely visual/informational, no logic or auto-shifting
- Arrow is stored as a dependency reference in the source task's JSON file (`dependencies` array holds target task IDs)
- Click an arrow line → shows a delete option
- Arrows render on a canvas layer beneath the task bars

### Row Management (Left Panel)

- Rows listed vertically on the left
- **Drag to reorder** rows
- **Double-click** row name to rename inline
- **Right-click** row → context menu with: Rename, Change color, Delete
- **[+ Add Row]** button at the bottom of the row list
- Deleting a row asks for confirmation if it contains tasks; tasks are deleted with the row

### Task Creation

- **[+ New Task] button** in top bar → opens a lightweight creation popover asking for: title, row, start date, end date, milestone toggle
- **Click empty space on a row** in the timeline → creates a task starting at the clicked date on that row, immediately opens detail panel

### Task Detail Panel (Right Sidebar)

Opens when a task is clicked. Contains:
- **Title** — editable inline
- **Row** — dropdown to move task to a different row
- **Start date / End date** — date pickers
- **Status** — toggle: Not Done / Done (overdue is automatic)
- **Milestone** — checkbox toggle
- **Color picker** — per-task color
- **Notes** — multiline freeform text area
- **Delete task** — button at bottom with confirmation
- Panel closes via X button or clicking outside

### Workspace Management

- **Workspace name** in top bar is clickable → dropdown with: Rename workspace, Open different workspace, Open workspace in Finder/Explorer
- App remembers last opened workspace path and opens it automatically on next launch (stored in Tauri's local app config, not in the workspace folder itself)
- Multiple workspaces are just different folders — user manages them via the filesystem

---

## Visual Design Direction

The app should feel like a **refined, modern productivity tool** — clean and calm like Linear or Notion, not cluttered. Dark mode preferred as default with light mode option.

- Neutral dark background (e.g. `#0f0f11`) with subtle surface layers
- Task bars use vivid accent colors against the dark canvas for contrast
- Typography: clean, legible, slightly compact — something like DM Sans or Geist
- Current date line: bright red/coral, always prominent
- Subtle grid lines on the timeline canvas
- Smooth animations on panel open/close, row reorder, zoom transitions
- Row left panel: slightly lighter surface than the canvas

---

## File I/O via Tauri

All reads/writes go through Tauri's `fs` plugin (no backend server). Key operations:

- `openWorkspace(folderPath)` — reads `workspace.json` + all `tasks/*.json`
- `saveTask(task)` — writes a single `task_<id>.json` file
- `deleteTask(id)` — deletes the file
- `saveWorkspace(workspace)` — writes `workspace.json`
- `createWorkspace(folderPath, name)` — creates folder structure and initial `workspace.json`

All file operations are async. The app holds workspace state in memory (React state/context) and writes to disk on every change.

---

## Out of Scope (v1)

- Assignees / avatars
- Subtasks / checklists
- Tags
- Unscheduled tasks tray
- Multi-window support
- Undo/redo
- Export (PDF, image)
- Search
- Keyboard shortcuts (beyond standard OS ones)
- Light/dark mode toggle (dark only for v1)

---

## Claude Code Instructions

When building this project:

1. Scaffold with `npm create tauri-app` using the React + TypeScript template
2. Install dependencies: `frappe-gantt`, `tailwindcss`, `date-fns`, `uuid`, `@tauri-apps/plugin-fs`, `@tauri-apps/plugin-dialog`
3. Build the timeline canvas as a custom React component layered on top of Frappe Gantt — use Frappe for bar rendering and drag interactions, build the arrow/dependency layer as a separate SVG overlay
4. All file I/O through Tauri fs plugin — no Node fs, no fetch, no backend
5. Store last opened workspace path in Tauri's app local data dir using `@tauri-apps/plugin-store`
6. One React context (`WorkspaceContext`) holds all in-memory state; persists to disk on every mutation
7. Task IDs generated with `uuid v4`, prefixed `task_`
8. Row IDs generated with `uuid v4`, prefixed `row_`
9. Keep components small and focused — suggested structure:
   - `TimelineView` — main layout shell
   - `RowPanel` — left sidebar with row list
   - `TimelineCanvas` — the Frappe Gantt wrapper + arrow SVG layer
   - `TaskDetailPanel` — right sidebar
   - `WorkspacePicker` — initial screen
   - `TopBar` — zoom controls, workspace name, new task button
10. Write TypeScript types for all data structures before writing components
