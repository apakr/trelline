import type { Row } from "../../types";

/** Height of one Frappe task row in pixels (bar_height=30 + padding=18). */
export const FRAPPE_ROW_HEIGHT = 48;

/** Height of Frappe's sticky header in pixels (upper=45 + lower=30 + 10). */
export const FRAPPE_HEADER_HEIGHT = 85;

interface RowPanelProps {
  rows: Row[];
  /** Number of real tasks per row (0 → row still occupies one slot). */
  taskCountByRowId: Map<string, number>;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  onAddRow: () => void;
}

export default function RowPanel({
  rows,
  taskCountByRowId,
  bodyRef,
  onAddRow,
}: RowPanelProps) {
  return (
    <div
      className="flex w-[220px] flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      style={{ height: "100%" }}
    >
      {/* Header — must be exactly FRAPPE_HEADER_HEIGHT px to align with Frappe's date header */}
      <div
        className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3"
        style={{ height: FRAPPE_HEADER_HEIGHT }}
      >
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
          Rows
        </span>
        <button
          onClick={onAddRow}
          title="Add row"
          className="flex h-6 items-center gap-1 rounded px-2 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Add
        </button>
      </div>

      {/* Body — overflow:hidden; scrollTop is driven externally by scroll-sync */}
      <div
        ref={bodyRef}
        className="overflow-hidden"
        style={{ flex: 1 }}
      >
        {rows.length === 0 ? (
          <div
            className="flex items-center justify-center text-xs text-[var(--color-text-secondary)]"
            style={{ height: FRAPPE_ROW_HEIGHT }}
          >
            No rows yet
          </div>
        ) : (
          rows.map((row) => {
            const count = Math.max(1, taskCountByRowId.get(row.id) ?? 0);
            const rowHeightPx = count * FRAPPE_ROW_HEIGHT;
            return (
              <RowItem
                key={row.id}
                row={row}
                taskCount={taskCountByRowId.get(row.id) ?? 0}
                height={rowHeightPx}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function RowItem({
  row,
  taskCount,
  height,
}: {
  row: Row;
  taskCount: number;
  height: number;
}) {
  return (
    <div
      className="group relative flex flex-shrink-0 items-start border-b border-[var(--color-border)] px-3 pt-3"
      style={{ height }}
    >
      {/* Color swatch + name */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ background: row.color }}
        />
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {row.name}
        </span>
      </div>

      {/* Task count badge */}
      {taskCount > 0 && (
        <span className="absolute right-3 top-3 rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
          {taskCount}
        </span>
      )}
    </div>
  );
}
