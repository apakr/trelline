import { useMemo } from "react";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import TopBar from "./TopBar";
import RowPanel from "./RowPanel";
import TimelineCanvas from "./TimelineCanvas";

export default function TimelineView() {
  const { workspace, tasks, addRow, deleteRow } = useLoadedWorkspace();

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
      <TopBar />

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
        />
      </div>
    </div>
  );
}
