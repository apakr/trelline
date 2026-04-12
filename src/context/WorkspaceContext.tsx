import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { v4 as uuidv4 } from "uuid";
import type {
  AppConfig,
  PanelState,
  Row,
  Task,
  Workspace,
  WorkspaceState,
  ZoomLevel,
} from "../types";
import {
  openWorkspace,
  createWorkspace as fsCreateWorkspace,
  saveWorkspace,
  saveTask,
  deleteTaskFile,
} from "../lib/fs";
import {
  loadAppConfig,
  addRecentWorkspace,
  removeRecentWorkspace,
} from "../lib/appStore";

const DEFAULT_ROW_COLOR = "#6366f1";

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface WorkspaceContextValue {
  // State
  workspaceState: WorkspaceState | null;
  appConfig: AppConfig;
  panel: PanelState;
  isLoading: boolean;
  error: string | null;

  // Workspace lifecycle
  loadWorkspace: (folderPath: string) => Promise<void>;
  createWorkspace: (folderPath: string, name: string) => Promise<void>;
  closeWorkspace: () => void;
  renameWorkspace: (name: string) => Promise<void>;
  setZoom: (zoom: ZoomLevel) => Promise<void>;
  setScrollCenterDate: (date: string) => Promise<void>;

  // Recent workspaces
  refreshAppConfig: () => Promise<void>;
  forgetRecentWorkspace: (folderPath: string) => Promise<void>;

  // Rows
  addRow: (name: string) => Promise<Row>;
  updateRow: (rowId: string, updates: Partial<Pick<Row, "name" | "color">>) => Promise<void>;
  reorderRows: (orderedIds: string[]) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;

  // Tasks
  createTask: (partial: NewTaskInput) => Promise<Task>;
  updateTask: (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // UI
  setPanel: (panel: PanelState) => void;
  clearError: () => void;
}

export interface NewTaskInput {
  title: string;
  rowId: string;
  start: string; // "YYYY-MM-DD"
  end: string;   // "YYYY-MM-DD"
  isMilestone?: boolean;
  color?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>({ recentWorkspaces: [] });
  const [panel, setPanel] = useState<PanelState>({ type: "none" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tracks scrollCenterDate out-of-band (no setState → no re-renders on scroll save).
  // Must be kept in sync when workspaces are loaded/closed and injected into every
  // saveWorkspace call so it is never overwritten by other saves.
  const scrollCenterDateRef = useRef<string | undefined>(undefined);

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  function requireState(): WorkspaceState {
    if (!workspaceState) throw new Error("No workspace loaded");
    return workspaceState;
  }

  function updateWorkspaceInState(updates: Partial<Workspace>): WorkspaceState {
    const current = requireState();
    const updated: WorkspaceState = {
      ...current,
      workspace: { ...current.workspace, ...updates },
    };
    setWorkspaceState(updated);
    return updated;
  }

  // Injects the latest scrollCenterDate into any workspace object before saving,
  // so it is never overwritten by unrelated saves (zoom change, rename, etc.).
  function withScrollCenter(workspace: import("../types").Workspace): import("../types").Workspace {
    const date = scrollCenterDateRef.current;
    return date !== undefined ? { ...workspace, scrollCenterDate: date } : workspace;
  }

  // -------------------------------------------------------------------------
  // Workspace lifecycle
  // -------------------------------------------------------------------------

  const refreshAppConfig = useCallback(async () => {
    const config = await loadAppConfig();
    setAppConfig(config);
  }, []);

  const loadWorkspace = useCallback(async (folderPath: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const state = await openWorkspace(folderPath);
      scrollCenterDateRef.current = state.workspace.scrollCenterDate;
      setWorkspaceState(state);
      setPanel({ type: "none" });
      await addRecentWorkspace({
        folderPath,
        name: state.workspace.name,
        lastOpened: state.workspace.lastOpened,
      });
      await refreshAppConfig();
    } catch (e) {
      const detail =
        e instanceof Error
          ? e.message
          : typeof e === "string"
          ? e
          : JSON.stringify(e);
      setError(`Could not open workspace at "${folderPath}": ${detail}`);
    } finally {
      setIsLoading(false);
    }
  }, [refreshAppConfig]);

  const createWorkspace = useCallback(
    async (folderPath: string, name: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const state = await fsCreateWorkspace(folderPath, name);
        scrollCenterDateRef.current = undefined;
        setWorkspaceState(state);
        setPanel({ type: "none" });
        await addRecentWorkspace({
          folderPath,
          name,
          lastOpened: state.workspace.lastOpened,
        });
        await refreshAppConfig();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to create workspace");
      } finally {
        setIsLoading(false);
      }
    },
    [refreshAppConfig]
  );

  const closeWorkspace = useCallback(() => {
    scrollCenterDateRef.current = undefined;
    setWorkspaceState(null);
    setPanel({ type: "none" });
  }, []);

  const renameWorkspace = useCallback(async (name: string) => {
    const current = requireState();
    const updated = updateWorkspaceInState({ name });
    await saveWorkspace(current.folderPath, withScrollCenter(updated.workspace));
    await addRecentWorkspace({
      folderPath: current.folderPath,
      name,
      lastOpened: updated.workspace.lastOpened,
    });
    await refreshAppConfig();
  }, [workspaceState, refreshAppConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const setZoom = useCallback(async (zoom: ZoomLevel) => {
    const current = requireState();
    const updated = updateWorkspaceInState({ zoom });
    await saveWorkspace(current.folderPath, withScrollCenter(updated.workspace));
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const forgetRecentWorkspace = useCallback(async (folderPath: string) => {
    await removeRecentWorkspace(folderPath);
    await refreshAppConfig();
  }, [refreshAppConfig]);

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  const addRow = useCallback(async (name: string): Promise<Row> => {
    const current = requireState();
    const row: Row = {
      id: `row_${uuidv4()}`,
      name,
      order: current.workspace.rows.length,
      color: DEFAULT_ROW_COLOR,
    };
    const updatedRows = [...current.workspace.rows, row];
    const next = updateWorkspaceInState({ rows: updatedRows });
    await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
    return row;
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = useCallback(
    async (rowId: string, updates: Partial<Pick<Row, "name" | "color">>) => {
      const current = requireState();
      const updatedRows = current.workspace.rows.map((r) =>
        r.id === rowId ? { ...r, ...updates } : r
      );
      const next = updateWorkspaceInState({ rows: updatedRows });
      await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
    },
    [workspaceState] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reorderRows = useCallback(async (orderedIds: string[]) => {
    const current = requireState();
    const rowMap = new Map(current.workspace.rows.map((r) => [r.id, r]));
    const updatedRows = orderedIds
      .filter((id) => rowMap.has(id))
      .map((id, index) => ({ ...rowMap.get(id)!, order: index }));
    const next = updateWorkspaceInState({ rows: updatedRows });
    await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteRow = useCallback(async (rowId: string) => {
    const current = requireState();

    // Delete all tasks belonging to this row
    const rowTasks = current.tasks.filter((t) => t.rowId === rowId);
    await Promise.all(rowTasks.map((t) => deleteTaskFile(current.folderPath, t.id)));

    // Remove dependency references to deleted tasks
    const deletedIds = new Set(rowTasks.map((t) => t.id));
    const remainingTasks = current.tasks
      .filter((t) => t.rowId !== rowId)
      .map((t) => ({
        ...t,
        dependencies: t.dependencies.filter((dep) => !deletedIds.has(dep)),
      }));

    // Save updated dependency lists for any tasks that changed
    const changedTasks = remainingTasks.filter((t) =>
      current.tasks.find((orig) => orig.id === t.id && orig.dependencies.length !== t.dependencies.length)
    );
    await Promise.all(changedTasks.map((t) => saveTask(current.folderPath, t)));

    // Re-number row order
    const updatedRows = current.workspace.rows
      .filter((r) => r.id !== rowId)
      .map((r, index) => ({ ...r, order: index }));

    const next: WorkspaceState = {
      ...current,
      workspace: { ...current.workspace, rows: updatedRows },
      tasks: remainingTasks,
    };
    setWorkspaceState(next);
    await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  const createTask = useCallback(async (input: NewTaskInput): Promise<Task> => {
    const current = requireState();
    const row = current.workspace.rows.find((r) => r.id === input.rowId);
    const now = new Date().toISOString();

    // Coerce milestone: end must equal start
    const end = input.isMilestone ? input.start : input.end;

    const task: Task = {
      id: `task_${uuidv4()}`,
      title: input.title,
      rowId: input.rowId,
      start: input.start,
      end,
      status: "not_done",
      color: input.color ?? row?.color ?? DEFAULT_ROW_COLOR,
      isMilestone: input.isMilestone ?? false,
      notes: input.notes ?? "",
      dependencies: [],
      createdAt: now,
      updatedAt: now,
    };

    setWorkspaceState({ ...current, tasks: [...current.tasks, task] });
    await saveTask(current.folderPath, task);
    return task;
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTask = useCallback(
    async (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => {
      const current = requireState();
      const existing = current.tasks.find((t) => t.id === taskId);
      if (!existing) throw new Error(`Task not found: ${taskId}`);

      let merged = { ...existing, ...updates, updatedAt: new Date().toISOString() };

      // Coerce milestone: end must equal start
      if (merged.isMilestone) {
        merged = { ...merged, end: merged.start };
      }

      const updatedTasks = current.tasks.map((t) => (t.id === taskId ? merged : t));
      setWorkspaceState({ ...current, tasks: updatedTasks });
      await saveTask(current.folderPath, merged);
    },
    [workspaceState] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const deleteTask = useCallback(async (taskId: string) => {
    const current = requireState();

    // Remove from other tasks' dependency lists
    const updatedTasks = current.tasks
      .filter((t) => t.id !== taskId)
      .map((t) => ({
        ...t,
        dependencies: t.dependencies.filter((dep) => dep !== taskId),
      }));

    // Save tasks whose dependency list changed
    const changedTasks = updatedTasks.filter((t) => {
      const orig = current.tasks.find((o) => o.id === t.id);
      return orig && orig.dependencies.length !== t.dependencies.length;
    });
    await Promise.all(changedTasks.map((t) => saveTask(current.folderPath, t)));

    setWorkspaceState({ ...current, tasks: updatedTasks });
    await deleteTaskFile(current.folderPath, taskId);

    // Close detail panel if it was showing this task
    setPanel((prev) =>
      prev.type === "task" && prev.taskId === taskId ? { type: "none" } : prev
    );
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Scroll center date persistence
  // -------------------------------------------------------------------------

  const setScrollCenterDate = useCallback(async (date: string) => {
    const { workspace, folderPath } = requireState();
    scrollCenterDateRef.current = date;
    // Write to disk only — no setState, no re-render cascade into canvas
    await saveWorkspace(folderPath, { ...workspace, scrollCenterDate: date });
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const value: WorkspaceContextValue = {
    workspaceState,
    appConfig,
    panel,
    isLoading,
    error,

    loadWorkspace,
    createWorkspace,
    closeWorkspace,
    renameWorkspace,
    setZoom,
    setScrollCenterDate,

    refreshAppConfig,
    forgetRecentWorkspace,

    addRow,
    updateRow,
    reorderRows,
    deleteRow,

    createTask,
    updateTask,
    deleteTask,

    setPanel,
    clearError: () => setError(null),
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}

/**
 * Convenience hook for when you know a workspace is loaded.
 * Throws if called outside a loaded workspace — use only in components that
 * are rendered only when workspaceState is non-null.
 */
export function useLoadedWorkspace() {
  const ctx = useWorkspace();
  if (!ctx.workspaceState) throw new Error("No workspace loaded");
  return {
    ...ctx,
    workspace: ctx.workspaceState.workspace,
    tasks: ctx.workspaceState.tasks,
    folderPath: ctx.workspaceState.folderPath,
  };
}
