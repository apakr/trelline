import { useMemo, useRef } from "react";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import TopBar from "./TopBar";
import RowPanel from "./RowPanel";
import TimelineCanvas from "./TimelineCanvas";

export default function TimelineView() {
  const { workspace, tasks, addRow } = useLoadedWorkspace();

  // Ref to the RowPanel body — passed to TimelineCanvas for scroll sync.
  const rowPanelBodyRef = useRef<HTMLDivElement>(null);

  // Sort rows by their order field.
  const sortedRows = useMemo(
    () => [...workspace.rows].sort((a, b) => a.order - b.order),
    [workspace.rows]
  );

  // Count of real tasks per row (used by RowPanel for height calculation).
  const taskCountByRowId = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of sortedRows) {
      map.set(row.id, tasks.filter((t) => t.rowId === row.id).length);
    }
    return map;
  }, [sortedRows, tasks]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--color-bg-base)]">
      <TopBar />

      {/* Main body: RowPanel + TimelineCanvas side by side */}
      <div className="flex flex-1 overflow-hidden">
        <RowPanel
          rows={sortedRows}
          taskCountByRowId={taskCountByRowId}
          bodyRef={rowPanelBodyRef}
          onAddRow={async () => {
            const name = `Row ${sortedRows.length + 1}`;
            await addRow(name);
          }}
        />

        <TimelineCanvas
          sortedRows={sortedRows}
          tasks={tasks}
          zoom={workspace.zoom}
          rowPanelBodyRef={rowPanelBodyRef}
        />
      </div>
    </div>
  );
}
