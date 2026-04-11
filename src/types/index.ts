// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export type ZoomLevel = "days" | "weeks" | "months";

/** Written to disk. "overdue" is never stored — it is computed at render time. */
export type TaskStatus = "not_done" | "done";

/** Computed at render time: if status is not_done and end < today → overdue. */
export type EffectiveStatus = TaskStatus | "overdue";

export interface Row {
  id: string;       // "row_<uuid>"
  name: string;
  order: number;
  color: string;    // hex, e.g. "#a78bfa"
}

export interface Task {
  id: string;              // "task_<uuid>"
  title: string;
  rowId: string;
  start: string;           // "YYYY-MM-DD"
  end: string;             // "YYYY-MM-DD"
  status: TaskStatus;
  color: string;           // hex; defaults to parent row color
  isMilestone: boolean;
  notes: string;
  dependencies: string[];  // array of task IDs
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export interface Workspace {
  id: string;              // "workspace_<uuid>"
  name: string;
  rows: Row[];
  zoom: ZoomLevel;
  scrollCenterDate?: string; // YYYY-MM-DD, center of viewport when last closed
  lastOpened: string;      // ISO 8601
}

// ---------------------------------------------------------------------------
// In-memory app state
// ---------------------------------------------------------------------------

/** Full workspace loaded into memory — workspace metadata + all its tasks. */
export interface WorkspaceState {
  workspace: Workspace;
  tasks: Task[];
  /** Absolute filesystem path to the workspace folder. */
  folderPath: string;
}

// ---------------------------------------------------------------------------
// App config (persisted via plugin-store, outside the workspace folder)
// ---------------------------------------------------------------------------

export interface RecentWorkspace {
  folderPath: string;
  name: string;
  lastOpened: string; // ISO 8601
}

export interface AppConfig {
  recentWorkspaces: RecentWorkspace[]; // most recent first, capped at 5
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export type PanelState =
  | { type: "none" }
  | { type: "task"; taskId: string }
  | { type: "newTask" };

// ---------------------------------------------------------------------------
// Utility: compute effective status
// ---------------------------------------------------------------------------

export function computeEffectiveStatus(task: Task): EffectiveStatus {
  if (task.status === "done") return "done";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(task.end + "T00:00:00");
  if (end < today) return "overdue";
  return "not_done";
}
