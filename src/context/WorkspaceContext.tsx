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
  AppSettings,
  PanelState,
  Row,
  Task,
  Workspace,
  WorkspaceState,
  ZoomLevel,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";
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
  saveSettings,
} from "../lib/appStore";

const DEFAULT_ROW_COLOR = "#6366f1";

// Snapshot stored in undo/redo stacks — captures only the mutable data that
// users expect Ctrl+Z to restore (rows + tasks). Zoom, scroll, name etc. are
// intentionally excluded.
type UndoSnapshot = { rows: Row[]; tasks: Task[] };

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
  setCanvasScale: (scale: number) => Promise<void>;
  setScrollCenterDate: (date: string) => Promise<void>;

  // Recent workspaces
  refreshAppConfig: () => Promise<void>;
  forgetRecentWorkspace: (folderPath: string) => Promise<void>;
  updateSettings: (settings: AppSettings) => Promise<void>;

  // Rows
  addRow: (name: string) => Promise<Row>;
  updateRow: (rowId: string, updates: Partial<Pick<Row, "name" | "color" | "laneCount" | "collapsed">>) => Promise<void>;
  reorderRows: (orderedIds: string[]) => Promise<void>;
  deleteRow: (rowId: string) => Promise<void>;

  // Tasks
  createTask: (partial: NewTaskInput) => Promise<Task>;
  updateTask: (taskId: string, updates: Partial<Omit<Task, "id" | "createdAt">>) => Promise<void>;
  batchUpdateTasks: (
    updates: Array<{ taskId: string; changes: Partial<Omit<Task, "id" | "createdAt">> }>,
    rowUpdate?: { rowId: string; laneCount: number }
  ) => Promise<void>;
  /** Atomically inserts a new lane (shifting tasks ≥ insertAtLane up) and creates a task. */
  insertLaneAndCreateTask: (rowId: string, insertAtLane: number, taskInput: NewTaskInput) => Promise<Task>;
  /** Atomically undoes a lane insertion (if any) and deletes the task in one state update. */
  deleteLaneAndTask: (taskId: string, insertedLane?: { rowId: string; lane: number }) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;

  // Undo / redo
  canUndo: boolean;
  canRedo: boolean;
  pushSnapshot: () => void;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

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
  lane?: number;
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspaceState, setWorkspaceState] = useState<WorkspaceState | null>(null);
  const [appConfig, setAppConfig] = useState<AppConfig>({ recentWorkspaces: [], settings: DEFAULT_SETTINGS });
  const [panel, setPanel] = useState<PanelState>({ type: "none" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<UndoSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<UndoSnapshot[]>([]);

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
  // Undo / redo
  // -------------------------------------------------------------------------

  // Capture the current rows+tasks as an undo point and push it onto the stack.
  // Also clears the redo stack — any new action kills the redo branch.
  const pushSnapshot = useCallback(() => {
    if (!workspaceState) return;
    const snap: UndoSnapshot = {
      rows: workspaceState.workspace.rows,
      tasks: workspaceState.tasks,
    };
    setUndoStack(prev => [...prev.slice(-49), snap]);
    setRedoStack([]);
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  // Writes a snapshot's tasks/rows back to disk, diffing against the state
  // that was current at the time undo/redo was triggered.
  async function syncSnapshotToDisk(snap: UndoSnapshot, state: WorkspaceState) {
    const currentMap = new Map(state.tasks.map(t => [t.id, t]));
    const snapMap    = new Map(snap.tasks.map(t => [t.id, t]));
    const ops: Promise<void>[] = [];

    // Tasks present in the snapshot: re-save if missing or changed
    for (const t of snap.tasks) {
      const cur = currentMap.get(t.id);
      if (!cur || cur.updatedAt !== t.updatedAt) {
        ops.push(saveTask(state.folderPath, t));
      }
    }
    // Tasks in current state that the snapshot doesn't have: delete
    for (const [id] of currentMap) {
      if (!snapMap.has(id)) {
        ops.push(deleteTaskFile(state.folderPath, id));
      }
    }
    // Rows are in workspace.json
    ops.push(saveWorkspace(state.folderPath, withScrollCenter({ ...state.workspace, rows: snap.rows })));
    await Promise.all(ops);
  }

  const undo = useCallback(async () => {
    if (!workspaceState || undoStack.length === 0) return;
    const snap = undoStack[undoStack.length - 1];
    const current: UndoSnapshot = {
      rows: workspaceState.workspace.rows,
      tasks: workspaceState.tasks,
    };
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev.slice(-49), current]);
    const next: WorkspaceState = {
      ...workspaceState,
      workspace: { ...workspaceState.workspace, rows: snap.rows },
      tasks: snap.tasks,
    };
    setWorkspaceState(next);
    // Close the detail panel if the task it was showing no longer exists
    setPanel(prev =>
      prev.type === "task" && !snap.tasks.find(t => t.id === prev.taskId)
        ? { type: "none" }
        : prev
    );
    await syncSnapshotToDisk(snap, workspaceState);
  }, [workspaceState, undoStack]); // eslint-disable-line react-hooks/exhaustive-deps

  const redo = useCallback(async () => {
    if (!workspaceState || redoStack.length === 0) return;
    const snap = redoStack[redoStack.length - 1];
    const current: UndoSnapshot = {
      rows: workspaceState.workspace.rows,
      tasks: workspaceState.tasks,
    };
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev.slice(-49), current]);
    const next: WorkspaceState = {
      ...workspaceState,
      workspace: { ...workspaceState.workspace, rows: snap.rows },
      tasks: snap.tasks,
    };
    setWorkspaceState(next);
    setPanel(prev =>
      prev.type === "task" && !snap.tasks.find(t => t.id === prev.taskId)
        ? { type: "none" }
        : prev
    );
    await syncSnapshotToDisk(snap, workspaceState);
  }, [workspaceState, redoStack]); // eslint-disable-line react-hooks/exhaustive-deps

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
      setUndoStack([]);
      setRedoStack([]);
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
    setUndoStack([]);
    setRedoStack([]);
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

  const setCanvasScale = useCallback(async (scale: number) => {
    const current = requireState();
    const updated = updateWorkspaceInState({ canvasScale: scale });
    await saveWorkspace(current.folderPath, withScrollCenter(updated.workspace));
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const forgetRecentWorkspace = useCallback(async (folderPath: string) => {
    await removeRecentWorkspace(folderPath);
    await refreshAppConfig();
  }, [refreshAppConfig]);

  const updateSettings = useCallback(async (settings: AppSettings) => {
    await saveSettings(settings);
    setAppConfig((prev) => ({ ...prev, settings }));
  }, []);

  // -------------------------------------------------------------------------
  // Rows
  // -------------------------------------------------------------------------

  const addRow = useCallback(async (name: string): Promise<Row> => {
    pushSnapshot();
    const current = requireState();
    const row: Row = {
      id: `row_${uuidv4()}`,
      name,
      order: current.workspace.rows.length,
      color: DEFAULT_ROW_COLOR,
      laneCount: 1,
    };
    const updatedRows = [...current.workspace.rows, row];
    const next = updateWorkspaceInState({ rows: updatedRows });
    await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
    return row;
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateRow = useCallback(
    async (rowId: string, updates: Partial<Pick<Row, "name" | "color" | "laneCount" | "collapsed">>) => {
      pushSnapshot();
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
    pushSnapshot();
    const current = requireState();
    const rowMap = new Map(current.workspace.rows.map((r) => [r.id, r]));
    const updatedRows = orderedIds
      .filter((id) => rowMap.has(id))
      .map((id, index) => ({ ...rowMap.get(id)!, order: index }));
    const next = updateWorkspaceInState({ rows: updatedRows });
    await saveWorkspace(current.folderPath, withScrollCenter(next.workspace));
  }, [workspaceState]); // eslint-disable-line react-hooks/exhaustive-deps

  const deleteRow = useCallback(async (rowId: string) => {
    pushSnapshot();
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
    pushSnapshot();
    const current = requireState();
    const row = current.workspace.rows.find((r) => r.id === input.rowId);
    const now = new Date().toISOString();

    // Coerce milestone: end must equal start
    const end = input.isMilestone ? input.start : input.end;

    // New tasks go to the bottom of their row's stacking order
    const rowOrders = current.tasks.filter(t => t.rowId === input.rowId).map(t => t.rowOrder);
    const rowOrder = rowOrders.length > 0 ? Math.max(...rowOrders) + 1 : 0;

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
      rowOrder,
      lane: input.lane ?? 0,
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

  /**
   * Updates multiple tasks atomically — all changes are applied to state in one
   * setWorkspaceState call, then written to disk in parallel.
   * Use this instead of sequential updateTask calls to avoid stale-closure races.
   */
  /**
   * Updates multiple tasks AND optionally a row's laneCount in one atomic
   * setWorkspaceState call. Avoids the stale-closure overwrite that happens
   * when batchUpdateTasks + updateRow are called sequentially (the second
   * call reads old state and discards the first call's changes).
   */
  const batchUpdateTasks = useCallback(
    async (
      updates: Array<{ taskId: string; changes: Partial<Omit<Task, "id" | "createdAt">> }>,
      rowUpdate?: { rowId: string; laneCount: number }
    ) => {
      if (updates.length === 0 && !rowUpdate) return;
      pushSnapshot();
      const current = requireState();
      const now = new Date().toISOString();
      const updateMap = new Map(updates.map((u) => [u.taskId, u.changes]));

      const updatedTasks = current.tasks.map((t) => {
        const changes = updateMap.get(t.id);
        if (!changes) return t;
        let merged = { ...t, ...changes, updatedAt: now };
        if (merged.isMilestone) merged = { ...merged, end: merged.start };
        return merged;
      });

      const updatedRows = rowUpdate
        ? current.workspace.rows.map((r) =>
            r.id === rowUpdate.rowId ? { ...r, laneCount: rowUpdate.laneCount } : r
          )
        : current.workspace.rows;

      const next: WorkspaceState = {
        ...current,
        workspace: { ...current.workspace, rows: updatedRows },
        tasks: updatedTasks,
      };
      setWorkspaceState(next);

      await Promise.all([
        ...updatedTasks.filter((t) => updateMap.has(t.id)).map((t) => saveTask(current.folderPath, t)),
        ...(rowUpdate ? [saveWorkspace(current.folderPath, withScrollCenter(next.workspace))] : []),
      ]);
    },
    [workspaceState] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const insertLaneAndCreateTask = useCallback(
    async (rowId: string, insertAtLane: number, taskInput: NewTaskInput): Promise<Task> => {
      pushSnapshot();
      const current = requireState();
      const now = new Date().toISOString();

      // Shift tasks at lanes >= insertAtLane up by 1
      const shiftedTasks = current.tasks.map((t) => {
        if (t.rowId !== rowId || (t.lane ?? 0) < insertAtLane) return t;
        return { ...t, lane: (t.lane ?? 0) + 1, updatedAt: now };
      });

      // Increment laneCount for the row
      const updatedRows = current.workspace.rows.map((r) =>
        r.id === rowId ? { ...r, laneCount: (r.laneCount ?? 1) + 1 } : r
      );

      // Build new task
      const row = current.workspace.rows.find((r) => r.id === rowId);
      const rowOrders = current.tasks.filter((t) => t.rowId === rowId).map((t) => t.rowOrder);
      const rowOrder = rowOrders.length > 0 ? Math.max(...rowOrders) + 1 : 0;
      const end = taskInput.isMilestone ? taskInput.start : taskInput.end;
      const task: Task = {
        id: `task_${uuidv4()}`,
        title: taskInput.title,
        rowId: taskInput.rowId,
        start: taskInput.start,
        end,
        status: "not_done",
        color: taskInput.color ?? row?.color ?? DEFAULT_ROW_COLOR,
        isMilestone: taskInput.isMilestone ?? false,
        notes: taskInput.notes ?? "",
        dependencies: [],
        rowOrder,
        lane: taskInput.lane ?? 0,
        createdAt: now,
        updatedAt: now,
      };

      const next: WorkspaceState = {
        ...current,
        workspace: { ...current.workspace, rows: updatedRows },
        tasks: [...shiftedTasks, task],
      };
      setWorkspaceState(next);

      await Promise.all([
        ...current.tasks
          .filter((t) => t.rowId === rowId && (t.lane ?? 0) >= insertAtLane)
          .map((orig) => {
            const updated = shiftedTasks.find((s) => s.id === orig.id)!;
            return saveTask(current.folderPath, updated);
          }),
        saveTask(current.folderPath, task),
        saveWorkspace(current.folderPath, withScrollCenter(next.workspace)),
      ]);

      return task;
    },
    [workspaceState] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * Atomically deletes a task and, if a lane was inserted for it, undoes that
   * insertion — all in one setWorkspaceState call to avoid stale-closure overwrites.
   */
  const deleteLaneAndTask = useCallback(
    async (taskId: string, insertedLane?: { rowId: string; lane: number }) => {
      pushSnapshot();
      const current = requireState();
      const now = new Date().toISOString();

      // Undo lane insertion: shift tasks at lane > insertedLane.lane back down
      let updatedTasks = current.tasks;
      let updatedRows = current.workspace.rows;
      if (insertedLane) {
        updatedTasks = updatedTasks.map((t) => {
          if (t.rowId !== insertedLane.rowId || (t.lane ?? 0) <= insertedLane.lane) return t;
          return { ...t, lane: (t.lane ?? 0) - 1, updatedAt: now };
        });
        updatedRows = updatedRows.map((r) =>
          r.id === insertedLane.rowId
            ? { ...r, laneCount: Math.max(1, (r.laneCount ?? 1) - 1) }
            : r
        );
      }

      // Remove task and clean up dependency refs
      updatedTasks = updatedTasks
        .filter((t) => t.id !== taskId)
        .map((t) => ({ ...t, dependencies: t.dependencies.filter((d) => d !== taskId) }));

      const next: WorkspaceState = {
        ...current,
        workspace: { ...current.workspace, rows: updatedRows },
        tasks: updatedTasks,
      };
      setWorkspaceState(next);

      const tasksWithChangedDeps = updatedTasks.filter((t) => {
        const orig = current.tasks.find((o) => o.id === t.id);
        return orig && orig.dependencies.length !== t.dependencies.length;
      });
      const shiftedTasks = insertedLane
        ? updatedTasks.filter(
            (t) => t.rowId === insertedLane.rowId && (t.lane ?? 0) >= insertedLane.lane
          )
        : [];

      await Promise.all([
        deleteTaskFile(current.folderPath, taskId),
        ...tasksWithChangedDeps.map((t) => saveTask(current.folderPath, t)),
        ...shiftedTasks.map((t) => saveTask(current.folderPath, t)),
        ...(insertedLane ? [saveWorkspace(current.folderPath, withScrollCenter(next.workspace))] : []),
      ]);

      setPanel((prev) =>
        prev.type === "task" && prev.taskId === taskId ? { type: "none" } : prev
      );
    },
    [workspaceState] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const deleteTask = useCallback(async (taskId: string) => {
    pushSnapshot();
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
    setCanvasScale,
    setScrollCenterDate,

    refreshAppConfig,
    forgetRecentWorkspace,
    updateSettings,

    addRow,
    updateRow,
    reorderRows,
    deleteRow,

    createTask,
    updateTask,
    batchUpdateTasks,
    insertLaneAndCreateTask,
    deleteLaneAndTask,
    deleteTask,

    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    pushSnapshot,
    undo,
    redo,

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
