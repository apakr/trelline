import { useCallback, useEffect, useMemo, useRef } from "react";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import { computeSubLanes } from "../../lib/subLanes";
import TopBar from "./TopBar";
import RowPanel from "./RowPanel";
import TimelineCanvas from "./TimelineCanvas";
import NewTaskPanel from "./NewTaskPanel";
import TaskDetailPanel from "./TaskDetailPanel";

export default function TimelineView() {
  const { workspace, tasks, addRow, updateRow, reorderRows, deleteRow, setScrollCenterDate, panel, setPanel, deleteLaneAndTask } = useLoadedWorkspace();
  const scrollToTodayRef = useRef<(() => void) | null>(null);
  const scrollToDateRef  = useRef<((date: Date) => void) | null>(null);
  const rowPanelBodyRef  = useRef<HTMLDivElement | null>(null);
  const centerDateInputRef = useRef<HTMLInputElement>(null);

  // Tracks the current canvas center date string in real time (updated on every scroll).
  // Read at panel-open time to give NewTaskPanel an accurate default start date.
  const currentCenterDateStrRef = useRef<string>(workspace.scrollCenterDate ?? "");

  // Captured once on mount — stable prop that won't re-trigger canvas effects
  const initialScrollCenterDate = useRef(workspace.scrollCenterDate);

  // Update the input display and center date ref directly (no React state → no re-renders)
  const handleCenterDateLive = useCallback((dateStr: string) => {
    currentCenterDateStrRef.current = dateStr;
    if (centerDateInputRef.current) {
      centerDateInputRef.current.value = dateStr;
    }
  }, []);

  const sortedRows = useMemo(
    () => [...workspace.rows].sort((a, b) => a.order - b.order),
    [workspace.rows]
  );

  const taskCountByRowId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sortedRows) {
      map.set(row.id, tasks.filter((t) => t.rowId === row.id).length);
    }
    return map;
  }, [sortedRows, tasks]);

  // Minimum lanes required by task overlaps (purely from task positions)
  const { subLaneMap, rowLaneCount: rowMinLaneCount } = useMemo(
    () => computeSubLanes(tasks),
    [tasks]
  );

  // Effective lane count = max(user-stored laneCount, minimum needed by overlaps)
  const rowLaneCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sortedRows) {
      map.set(row.id, Math.max(row.laneCount ?? 1, rowMinLaneCount.get(row.id) ?? 1));
    }
    return map;
  }, [sortedRows, rowMinLaneCount]);

  // Auto-increment row.laneCount when new task overlaps push the min above the stored value.
  // Never auto-decrements — rows only shrink via the manual "-" button.
  useEffect(() => {
    for (const row of sortedRows) {
      const min = rowMinLaneCount.get(row.id) ?? 1;
      if (min > (row.laneCount ?? 1)) {
        updateRow(row.id, { laneCount: min });
      }
    }
  }, [rowMinLaneCount, sortedRows, updateRow]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)]">
      <TopBar
        onScrollToToday={() => scrollToTodayRef.current?.()}
        centerDateInputRef={centerDateInputRef}
        onNavigateToDate={(date) => scrollToDateRef.current?.(date)}
      />

      <div className="relative flex flex-1 overflow-hidden">
        <RowPanel
          rows={sortedRows}
          taskCountByRowId={taskCountByRowId}
          rowLaneCount={rowLaneCount}
          rowMinLaneCount={rowMinLaneCount}
          scrollContainerRef={rowPanelBodyRef}
          onAddRow={async () => {
            const name = `Row ${sortedRows.length + 1}`;
            await addRow(name);
          }}
          onDeleteRow={deleteRow}
          onRename={(rowId, name) => updateRow(rowId, { name })}
          onReorder={reorderRows}
          onChangeColor={(rowId, color) => updateRow(rowId, { color })}
          onAddLane={(rowId) => {
            const row = sortedRows.find((r) => r.id === rowId);
            if (row) updateRow(rowId, { laneCount: (row.laneCount ?? 1) + 1 });
          }}
          onRemoveLane={(rowId) => {
            const row = sortedRows.find((r) => r.id === rowId);
            if (!row) return;
            const min = rowMinLaneCount.get(rowId) ?? 1;
            const next = Math.max(1, (row.laneCount ?? 1) - 1);
            if (next >= min) updateRow(rowId, { laneCount: next });
          }}
        />

        <TimelineCanvas
          sortedRows={sortedRows}
          tasks={tasks}
          subLaneMap={subLaneMap}
          rowLaneCount={rowLaneCount}
          zoom={workspace.zoom}
          scrollCenterDate={initialScrollCenterDate.current}
          onScrollCenterDateChange={setScrollCenterDate}
          onCenterDateLive={handleCenterDateLive}
          onRegisterScrollToToday={(fn) => { scrollToTodayRef.current = fn; }}
          onRegisterScrollToDate={(fn) => { scrollToDateRef.current = fn; }}
          onVerticalScroll={(top) => {
            if (rowPanelBodyRef.current) rowPanelBodyRef.current.scrollTop = top;
          }}
        />

        {/* Backdrop — clicking outside any open panel closes it */}
        {(panel.type === "newTask" || panel.type === "task") && (
          <div
            className="absolute inset-0 z-[9]"
            onClick={() => {
              if (panel.type === "task") {
                const task = tasks.find((t) => t.id === panel.taskId);
                if (task && !task.title.trim()) {
                  deleteLaneAndTask(panel.taskId, panel.insertedLane);
                  return; // deleteLaneAndTask closes the panel itself
                }
              }
              setPanel({ type: "none" });
            }}
          />
        )}
        {panel.type === "newTask" && (
          <NewTaskPanel defaultDate={currentCenterDateStrRef.current} />
        )}
        {panel.type === "task" && (
          <TaskDetailPanel taskId={panel.taskId} insertedLane={panel.insertedLane} />
        )}
      </div>
    </div>
  );
}
