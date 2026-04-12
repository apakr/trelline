import { useCallback, useMemo, useRef } from "react";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import TopBar from "./TopBar";
import RowPanel from "./RowPanel";
import TimelineCanvas from "./TimelineCanvas";

export default function TimelineView() {
  const { workspace, tasks, addRow, deleteRow, setScrollCenterDate } = useLoadedWorkspace();
  const scrollToTodayRef = useRef<(() => void) | null>(null);
  const scrollToDateRef  = useRef<((date: Date) => void) | null>(null);
  const centerDateInputRef = useRef<HTMLInputElement>(null);

  // Captured once on mount — stable prop that won't re-trigger canvas effects
  const initialScrollCenterDate = useRef(workspace.scrollCenterDate);

  // Update the input value directly (no React state → no re-renders)
  const handleCenterDateLive = useCallback((dateStr: string) => {
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)]">
      <TopBar
        onScrollToToday={() => scrollToTodayRef.current?.()}
        centerDateInputRef={centerDateInputRef}
        onNavigateToDate={(date) => scrollToDateRef.current?.(date)}
      />

      <div className="flex flex-1 overflow-hidden">
        <RowPanel
          rows={sortedRows}
          taskCountByRowId={taskCountByRowId}
          onAddRow={async () => {
            const name = `Row ${sortedRows.length + 1}`;
            await addRow(name);
          }}
          onDeleteRow={deleteRow}
        />

        <TimelineCanvas
          sortedRows={sortedRows}
          tasks={tasks}
          zoom={workspace.zoom}
          scrollCenterDate={initialScrollCenterDate.current}
          onScrollCenterDateChange={setScrollCenterDate}
          onCenterDateLive={handleCenterDateLive}
          onRegisterScrollToToday={(fn) => { scrollToTodayRef.current = fn; }}
          onRegisterScrollToDate={(fn) => { scrollToDateRef.current = fn; }}
        />
      </div>
    </div>
  );
}
