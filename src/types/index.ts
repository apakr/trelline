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
  laneCount: number; // user-controlled minimum number of sub-lanes (never auto-decremented)
  collapsed?: boolean; // when true, row renders at 1-lane height and task bars are hidden
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
  rowOrder: number;        // sort key for sub-lane stacking within a row (lower = higher/earlier lane)
  lane: number;            // preferred sub-lane index within the row (user's last drop position)
  createdAt: string;       // ISO 8601
  updatedAt: string;       // ISO 8601
}

export interface Workspace {
  id: string;              // "workspace_<uuid>"
  name: string;
  rows: Row[];
  zoom: ZoomLevel;
  canvasScale?: number;    // scale multiplier for pxPerDay (1.0 = 100%); default 1
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

export interface AppSettings {
  invertScroll: boolean;
  dateFormat: "YYYY-MM-DD" | "YYYY-DD-MM";
  weekStartDay: "monday" | "saturday" | "sunday";
  tutorialCompleted: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  invertScroll: false,
  dateFormat: "YYYY-MM-DD",
  weekStartDay: "monday",
  tutorialCompleted: false,
};

export interface AppConfig {
  recentWorkspaces: RecentWorkspace[]; // most recent first, capped at 5
  settings: AppSettings;
}

// ---------------------------------------------------------------------------
// UI state types
// ---------------------------------------------------------------------------

export type PanelState =
  | { type: "none" }
  | { type: "task"; taskId: string; insertedLane?: { rowId: string; lane: number } }
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
