import { type RefObject } from "react";
import type { Row } from "../../types";

/**
 * ROW_HEIGHT: Fixed height per sub-lane in pixels.
 * Rows with multiple sub-lanes are ROW_HEIGHT * laneCount tall.
 */
export const ROW_HEIGHT = 48;

/**
 * HEADER_HEIGHT: Height of the top section of RowPanel in pixels.
 * MUST match the canvas date axis header height exactly.
 */
export const HEADER_HEIGHT = 52;

interface RowPanelProps {
  rows: Row[];
  taskCountByRowId: Map<string, number>;
  rowLaneCount: Map<string, number>;
  rowMinLaneCount: Map<string, number>;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onAddLane: (rowId: string) => void;
  onRemoveLane: (rowId: string) => void;
}

export default function RowPanel({
  rows,
  taskCountByRowId,
  rowLaneCount,
  rowMinLaneCount,
  scrollContainerRef,
  onAddRow,
  onDeleteRow,
  onAddLane,
  onRemoveLane,
}: RowPanelProps) {
  return (
    <div
      className="flex w-[220px] flex-shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-bg-surface)]"
      style={{ height: "100%" }}
    >
      {/* Header */}
      <div
        className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-3"
        style={{ height: HEADER_HEIGHT }}
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

      {/* Row list — overflow-hidden hides the scrollbar; scrollTop is driven by the canvas */}
      <div ref={scrollContainerRef} className="overflow-hidden" style={{ flex: 1 }}>
        {rows.length === 0 ? (
          <div
            className="flex items-center justify-center text-xs text-[var(--color-text-secondary)]"
            style={{ height: ROW_HEIGHT }}
          >
            No rows yet
          </div>
        ) : (
          <>
            {rows.map((row) => (
              <RowItem
                key={row.id}
                row={row}
                taskCount={taskCountByRowId.get(row.id) ?? 0}
                height={ROW_HEIGHT * (rowLaneCount.get(row.id) ?? 1)}
                laneCount={rowLaneCount.get(row.id) ?? 1}
                minLaneCount={rowMinLaneCount.get(row.id) ?? 1}
                onDelete={() => onDeleteRow(row.id)}
                onAddLane={() => onAddLane(row.id)}
                onRemoveLane={() => onRemoveLane(row.id)}
              />
            ))}
            {/* Bottom padding — matches the 2-lane blank space in the canvas */}
            <div style={{ height: ROW_HEIGHT * 2, flexShrink: 0 }} />
          </>
        )}
      </div>
    </div>
  );
}

function RowItem({
  row,
  taskCount,
  height,
  laneCount,
  minLaneCount,
  onDelete,
  onAddLane,
  onRemoveLane,
}: {
  row: Row;
  taskCount: number;
  height: number;
  laneCount: number;
  minLaneCount: number;
  onDelete: () => void;
  onAddLane: () => void;
  onRemoveLane: () => void;
}) {
  const canRemoveLane = laneCount > 1 && laneCount > minLaneCount;

  return (
    <div
      className="group relative flex flex-shrink-0 flex-col justify-between border-b border-[var(--color-border)] px-3 pt-3 pb-2"
      style={{ height }}
    >
      {/* Top: color swatch + name */}
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ background: row.color }}
        />
        <span className="truncate text-sm font-medium text-[var(--color-text-primary)]">
          {row.name}
        </span>
      </div>

      {/* Bottom: lane controls + delete */}
      <div className="flex items-center justify-between">
        {/* Lane +/- controls — always visible when lanes > 1, otherwise on hover */}
        <div className={`flex items-center gap-1 ${laneCount === 1 ? "opacity-0 group-hover:opacity-100" : "opacity-100"} transition-opacity`}>
          <span className="text-[10px] text-[var(--color-text-secondary)]">
            {laneCount} {laneCount === 1 ? "lane" : "lanes"}
          </span>
          <button
            onClick={onAddLane}
            title="Add lane"
            className="flex h-4 w-4 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M4 1v6M1 4h6" />
            </svg>
          </button>
          <button
            onClick={onRemoveLane}
            disabled={!canRemoveLane}
            title="Remove lane"
            className="flex h-4 w-4 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-30"
          >
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 4h6" />
            </svg>
          </button>
        </div>

        {/* Delete row button + task count */}
        <div className="flex items-center gap-1">
          {taskCount > 0 && (
            <span className="rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
              {taskCount}
            </span>
          )}
          <button
            onClick={taskCount > 0 ? undefined : onDelete}
            disabled={taskCount > 0}
            title={taskCount > 0 ? `Cannot delete — ${taskCount} task${taskCount > 1 ? "s" : ""} in this row` : "Delete row"}
            className="hidden rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-red-500/15 hover:text-red-400 group-hover:flex disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-text-secondary)]"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2.5 4h8M5 4V2.5h3V4M5.5 6.5v3M7.5 6.5v3M3.5 4l.5 6.5h5.5L10 4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
