# Timeline App — Product Requirements Document

## Overview

A standalone desktop application (Tauri + React) that replicates Asana's Timeline view exactly. Single-user, fully offline, data stored as JSON files on the local filesystem. The app feels like a polished native desktop product — not a web app in a window.

The timeline canvas is built entirely from scratch using SVG and React. No third-party Gantt library is used. This is a deliberate decision: Gantt libraries impose constraints on layout, interaction, and rendering that conflict with exactly replicating Asana's behavior. Every pixel, every interaction, every animation is custom-built.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | Tauri (Rust) | Lightweight native app, direct filesystem access, no Electron bloat |
| Frontend | React + TypeScript | Component model fits complex interactive UI |
| Timeline rendering | Custom SVG (React) | Full control over layout, interaction, and behavior — no library compromises |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Date math | date-fns | Already installed, handles all date arithmetic |
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
  "scrollCenterDate": "2026-05-01",
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
│  [App name]  [Workspace name ▾]   [Today] [+ New Task] [⚙]  │  ← Top bar
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

The canvas is a custom SVG rendered by React. It has two horizontal sections: a fixed left panel (row labels) and a scrollable right section (the date axis + task bars). Vertical scroll moves both sections together. Horizontal scroll moves only the right section.

- **Date axis** runs left to right across the top of the scrollable section
- **Vertical red line** marks today's date; scrolls off screen when the user pans away from today
- **Rows** run horizontally across the full canvas height
- **Task bars** appear on their respective row, spanning their start→end dates
- **Multiple tasks per row** — tasks that do not overlap in time appear side by side on the same row; overlapping tasks stack into sub-lanes within the row, and the row height expands to fit
- **Milestones** render as a diamond (◆) shape; stored and treated as a 1-day task

### Canvas Rendering — Virtual Rendering + Extend-on-Demand

The canvas uses two complementary mechanisms to handle arbitrarily large date ranges without performance issues:

**Virtual rendering:** Only SVG elements within the visible viewport plus a buffer (~1.5x viewport width on each side) exist in the DOM at any time. Elements outside this render window are not created. When the user scrolls far enough to approach the buffer edge, the render window shifts and old elements are removed.

**Extend-on-demand:** The total canvas date range (`viewStart`/`viewEnd`) starts from task bounds + padding. When the user scrolls close to either edge, the range extends outward by a chunk (~500 days), growing the scrollbar. Left-side extension simultaneously adjusts `scrollLeft` by `newDays * pxPerDay` so the viewport does not jump.

**Scroll position persistence:** The center date of the viewport is saved to `workspace.json` as `scrollCenterDate` (debounced). Reopening a workspace restores the scroll position.

**Correctness requirements:**
- Task bars that partially overlap the render window boundary still render
- Dependency arrows that cross the render window boundary compute positions correctly
- Zoom changes immediately recompute the render window

### Zoom Levels

Three zoom levels toggled via a control in the top bar:
- **Days** — each column = 1 day
- **Weeks** — each column = 1 week (default)
- **Months** — each column = 1 month

Zoom level is persisted per workspace in `workspace.json`.

**Zoom transition behavior:** When switching zoom levels, the viewport stays centered on whatever date range is currently visible — it does not jump to today. The visible date at the center of the viewport before switching should remain the center after switching.

### Today Button

A **[Today]** button in the top bar scrolls the canvas back to today's date when clicked, centering the viewport on today. This is the only way to return to today after panning away.

### Task Bars

**Appearance:**
- Rounded rectangle with task title truncated inside
- Minimum task length: 1 day. Tasks cannot be shorter than 1 day.
- Color is per-task (user-defined, defaults to row color)
- Status affects appearance:
  - `not_done` — full color
  - `done` — desaturated/muted with a checkmark icon on the bar
  - `overdue` — red tint/border, computed automatically

**Drag snapping:** All drag interactions (move and resize) snap to whole day boundaries regardless of zoom level. A task always starts and ends on a whole day.

**Interactions:**
- **Drag bar** — moves task left/right, snapping to day boundaries, updating start and end dates. Connected dependency arrows follow visually but connected tasks do NOT move.
- **Drag left edge** — changes start date only, snaps to day boundaries. Cannot drag past the end date (minimum 1 day length enforced).
- **Drag right edge** — changes end date only, snaps to day boundaries. Cannot drag past the start date.
- **Click** — opens the Task Detail Panel (right sidebar)
- **Hover** — shows connector dots on left and right edges for drawing dependency arrows

### Overlapping Tasks Within a Row

When two or more tasks in the same row overlap in time, they stack into sub-lanes vertically within the row. Row height expands to accommodate all sub-lanes.

- **Stacking order:** The task that was created first occupies the top sub-lane. Tasks added later go below. This order is fixed by creation time unless the user manually changes it.
- **Manual reorder:** The user can drag a task bar up or down within a row to change its sub-lane position. Dragging it above the top sub-lane moves it to position 1; dragging below the bottom creates a new sub-lane.
- Sub-lane order is stored per-row and persisted.

### Dependency Arrows

Dependency arrows follow the Asana finish-to-start model:
- An arrow always goes from the **right edge** of the predecessor task to the **left edge** of the successor task
- Direction is always left-to-right (predecessor finishes → successor starts)
- Arrows work across rows

**Creating a dependency:**
- Hover a task bar → small circular connector dots appear on the left and right edges
- Drag from the **right** connector dot of task A and drop onto task B → creates a dependency (A must finish before B starts), arrow draws from A's right edge to B's left edge
- Drag from the **left** connector dot of task B and drop onto task A → same result, same arrow direction
- A live preview arrow follows the cursor while dragging

**Removing a dependency:**
- Click an existing arrow line → a small delete button appears on the arrow; click it to remove

**Visual:**
- Arrows render on an SVG layer beneath the task bars
- Arrow is stored in the source task's `dependencies` array (holds target task IDs)
- Arrow is purely visual/informational — no auto-shifting or scheduling logic

### Row Management (Left Panel)

- Rows listed vertically on the left, fixed width, does not scroll horizontally
- **Drag to reorder** rows (reorders the entire row and all its tasks together)
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

The app should feel like a **refined, modern productivity tool** — clean and calm like Linear or Notion, not cluttered. Dark mode preferred as default.

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

1. **Do not use any Gantt or timeline library** (no Frappe Gantt, no vis-timeline, no dhtmlx). The timeline canvas is custom SVG + React only.
2. The core of the canvas is a coordinate function: `dateToX(date, viewStart, viewEnd, canvasWidth) → pixels`. Every rendered element uses this function. Build and validate this first before rendering anything.
3. All file I/O through Tauri fs plugin — no Node fs, no fetch, no backend
4. Store last opened workspace path in Tauri's local app config using `@tauri-apps/plugin-store`
5. One React context (`WorkspaceContext`) holds all in-memory state; persists to disk on every mutation
6. Task IDs generated with `uuid v4`, prefixed `task_`
7. Row IDs generated with `uuid v4`, prefixed `row_`
8. Keep components small and focused — structure:
   - `TimelineView` — main layout shell
   - `RowPanel` — fixed left sidebar with row labels
   - `TimelineCanvas` — custom SVG canvas (date axis, grid, task bars, arrows)
   - `TaskDetailPanel` — right sidebar
   - `WorkspacePicker` — initial screen
   - `TopBar` — zoom controls, workspace name, new task button
9. Write TypeScript types for all data structures before writing components
10. Build the canvas in layers, in this order: coordinate system → date axis → grid → row bands → task bars → scroll/zoom → drag interactions → dependency arrows → drag-to-create links
