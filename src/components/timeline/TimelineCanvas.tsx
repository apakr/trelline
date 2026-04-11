/**
 * TimelineCanvas — Custom SVG Timeline
 *
 * This is a stub. The canvas has not been built yet.
 * See CANVAS_INTEGRATION_NOTES.md in this directory for build order and
 * integration details with RowPanel and WorkspaceContext.
 * See SPEC.md (root) for full feature requirements.
 *
 * Build order (from SPEC.md / CLAUDE.md):
 *   1. Coordinate system — dateToX() utility
 *   2. Date axis header + grid lines
 *   3. Row bands
 *   4. Task bars (static)
 *   5. Horizontal scroll + zoom switching
 *   6. Task click → setPanel({ type: "task", taskId })
 *   7. Task drag (move) + edge drag (resize) → updateTask()
 *   8. Dependency arrows (SVG bezier curves, cross-row)
 *   9. Drag-to-create dependency links
 *
 * Context hooks to wire up when building:
 *   const { setPanel, updateTask } = useWorkspace();
 */

import type { Row, Task, ZoomLevel } from "../../types";

export interface TimelineCanvasProps {
  sortedRows: Row[];
  tasks: Task[];
  zoom: ZoomLevel;
}

export default function TimelineCanvas({ sortedRows, tasks, zoom }: TimelineCanvasProps) {
  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--color-bg-surface)]">
      <p className="text-sm text-[var(--color-text-secondary)]">
        Timeline canvas — not yet built&nbsp;&nbsp;
        <span className="opacity-50">
          ({sortedRows.length} rows · {tasks.length} tasks · {zoom})
        </span>
      </p>
    </div>
  );
}
