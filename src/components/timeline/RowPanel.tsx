import { useRef, useState, useEffect, type RefObject } from "react";
import type { Row } from "../../types";

export const ROW_HEIGHT = 48;
export const HEADER_HEIGHT = 52;

interface RowPanelProps {
  rows: Row[];
  taskCountByRowId: Map<string, number>;
  rowLaneCount: Map<string, number>;
  rowMinLaneCount: Map<string, number>;
  scrollContainerRef?: RefObject<HTMLDivElement | null>;
  onAddRow: () => void;
  onDeleteRow: (rowId: string) => void;
  onRename: (rowId: string, name: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onChangeColor: (rowId: string, color: string) => void;
  onAddLane: (rowId: string) => void;
  onRemoveLane: (rowId: string) => void;
  onToggleCollapse: (rowId: string) => void;
}

export default function RowPanel({
  rows,
  taskCountByRowId,
  rowLaneCount,
  rowMinLaneCount,
  scrollContainerRef,
  onAddRow,
  onDeleteRow,
  onRename,
  onReorder,
  onChangeColor,
  onAddLane,
  onRemoveLane,
  onToggleCollapse,
}: RowPanelProps) {
  // ── Inline rename ──────────────────────────────────────────────────────────
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  function startEdit(rowId: string, currentName: string) {
    setEditingRowId(rowId);
    setEditingName(currentName);
    setContextMenu(null);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  function commitEdit(rowId: string) {
    const trimmed = editingName.trim();
    if (trimmed) onRename(rowId, trimmed);
    setEditingRowId(null);
  }

  function handleEditKeyDown(e: React.KeyboardEvent, rowId: string) {
    if (e.key === "Enter") commitEdit(rowId);
    if (e.key === "Escape") setEditingRowId(null);
  }

  // ── Context menu ───────────────────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<{ rowId: string; x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function handleMouseDown(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  function handleContextMenu(e: React.MouseEvent, rowId: string) {
    e.preventDefault();
    setContextMenu({ rowId, x: e.clientX, y: e.clientY });
  }

  // ── Color picker ───────────────────────────────────────────────────────────
  const colorInputRef = useRef<HTMLInputElement>(null);
  const colorTargetRowIdRef = useRef<string | null>(null);

  function openColorPicker(rowId: string) {
    const row = rows.find((r) => r.id === rowId);
    if (!row || !colorInputRef.current) return;
    colorTargetRowIdRef.current = rowId;
    colorInputRef.current.value = row.color;
    setContextMenu(null);
    colorInputRef.current.click();
  }

  // ── Drag to reorder ────────────────────────────────────────────────────────
  const draggingIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const [dragState, setDragState] = useState<{ draggingId: string; dropIndex: number } | null>(null);

  function startDrag(e: React.MouseEvent, rowId: string) {
    e.preventDefault();
    draggingIdRef.current = rowId;

    function onMouseMove(ev: MouseEvent) {
      const container = scrollContainerRef?.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const y = ev.clientY - rect.top + container.scrollTop;

      // Find which gap the cursor is nearest to (use effective height)
      let accumulated = 0;
      let idx = 0;
      for (const row of rows) {
        const h = row.collapsed ? ROW_HEIGHT : ROW_HEIGHT * (rowLaneCount.get(row.id) ?? 1);
        if (y < accumulated + h / 2) break;
        accumulated += h;
        idx++;
      }
      dropIndexRef.current = idx;
      setDragState({ draggingId: rowId, dropIndex: idx });
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      const dragId = draggingIdRef.current;
      const di = dropIndexRef.current;

      if (dragId !== null && di !== null) {
        const fromIndex = rows.findIndex((r) => r.id === dragId);
        const reordered = [...rows];
        const [removed] = reordered.splice(fromIndex, 1);
        const insertAt = di > fromIndex ? di - 1 : di;
        reordered.splice(insertAt, 0, removed);
        onReorder(reordered.map((r) => r.id));
      }

      draggingIdRef.current = null;
      dropIndexRef.current = null;
      setDragState(null);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  // Calculate Y offset of the drop indicator line (use effective height)
  function dropIndicatorY(dropIndex: number): number {
    let y = 0;
    for (let i = 0; i < Math.min(dropIndex, rows.length); i++) {
      const row = rows[i];
      y += row.collapsed ? ROW_HEIGHT : ROW_HEIGHT * (rowLaneCount.get(row.id) ?? 1);
    }
    return y;
  }

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

      {/* Row list */}
      <div ref={scrollContainerRef} className="relative overflow-hidden" style={{ flex: 1 }}>
        {rows.length === 0 ? (
          <div
            className="flex items-center justify-center text-xs text-[var(--color-text-secondary)]"
            style={{ height: ROW_HEIGHT }}
          >
            No rows yet
          </div>
        ) : (
          <>
            {rows.map((row) => {
              const effectiveHeight = row.collapsed ? ROW_HEIGHT : ROW_HEIGHT * (rowLaneCount.get(row.id) ?? 1);
              const isDragging = dragState?.draggingId === row.id;
              return (
                <div
                  key={row.id}
                  style={{ opacity: isDragging ? 0.4 : 1 }}
                  onContextMenu={(e) => handleContextMenu(e, row.id)}
                >
                  {editingRowId === row.id ? (
                    // ── Inline rename ──
                    <div
                      className="flex flex-shrink-0 items-start border-b border-[var(--color-border)] px-3 pt-3"
                      style={{ height: effectiveHeight }}
                    >
                      <input
                        ref={editInputRef}
                        autoFocus
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onBlur={() => commitEdit(row.id)}
                        onKeyDown={(e) => handleEditKeyDown(e, row.id)}
                        className="w-full rounded border border-[var(--color-accent)] bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-sm text-[var(--color-text-primary)] focus:outline-none"
                      />
                    </div>
                  ) : (
                    <RowItem
                      row={row}
                      taskCount={taskCountByRowId.get(row.id) ?? 0}
                      height={effectiveHeight}
                      laneCount={rowLaneCount.get(row.id) ?? 1}
                      minLaneCount={rowMinLaneCount.get(row.id) ?? 1}
                      onDelete={() => onDeleteRow(row.id)}
                      onAddLane={() => onAddLane(row.id)}
                      onRemoveLane={() => onRemoveLane(row.id)}
                      onDoubleClickName={() => startEdit(row.id, row.name)}
                      onDragStart={(e) => startDrag(e, row.id)}
                      onToggleCollapse={() => onToggleCollapse(row.id)}
                    />
                  )}
                </div>
              );
            })}

            {/* Drop indicator line */}
            {dragState && (
              <div
                className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-[var(--color-accent)]"
                style={{ top: dropIndicatorY(dragState.dropIndex) }}
              />
            )}

            {/* Bottom padding — matches 2-lane blank space in the canvas */}
            <div style={{ height: ROW_HEIGHT * 2, flexShrink: 0 }} />
          </>
        )}
      </div>

      {/* Hidden color input — programmatically triggered from context menu */}
      <input
        ref={colorInputRef}
        type="color"
        className="sr-only"
        onChange={(e) => {
          if (colorTargetRowIdRef.current) {
            onChangeColor(colorTargetRowIdRef.current, e.target.value);
          }
        }}
      />

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={() => {
              const row = rows.find((r) => r.id === contextMenu.rowId);
              if (row) startEdit(row.id, row.name);
            }}
            className="flex w-full items-center px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
          >
            Rename
          </button>
          <button
            onClick={() => openColorPicker(contextMenu.rowId)}
            className="flex w-full items-center px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
          >
            Change color
          </button>
          <div className="my-1 border-t border-[var(--color-border)]" />
          {(() => {
            const rowId = contextMenu.rowId;
            const count = taskCountByRowId.get(rowId) ?? 0;
            return (
              <button
                onClick={() => {
                  if (count > 0) return;
                  setContextMenu(null);
                  onDeleteRow(rowId);
                }}
                disabled={count > 0}
                title={count > 0 ? `Cannot delete — ${count} task${count > 1 ? "s" : ""} in this row` : undefined}
                className="flex w-full items-center px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--color-bg-surface)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                Delete row
              </button>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ── Row item ──────────────────────────────────────────────────────────────────

function RowItem({
  row,
  taskCount,
  height,
  laneCount,
  minLaneCount,
  onDelete,
  onAddLane,
  onRemoveLane,
  onDoubleClickName,
  onDragStart,
  onToggleCollapse,
}: {
  row: Row;
  taskCount: number;
  height: number;
  laneCount: number;
  minLaneCount: number;
  onDelete: () => void;
  onAddLane: () => void;
  onRemoveLane: () => void;
  onDoubleClickName: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  onToggleCollapse: () => void;
}) {
  const canRemoveLane = laneCount > 1 && laneCount > minLaneCount;
  const collapsed = row.collapsed ?? false;

  return (
    <div
      className="group relative flex flex-shrink-0 flex-col justify-between border-b border-[var(--color-border)] px-3 pb-2"
      style={{ height, paddingTop: collapsed ? 0 : 12 }}
    >
      {/* Top: collapse toggle + grip + color swatch + name */}
      <div className="flex min-w-0 items-center gap-1.5" style={{ marginTop: collapsed ? "auto" : 0, marginBottom: collapsed ? "auto" : 0 }}>
        {/* Collapse chevron */}
        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand row" : "Collapse row"}
          className="flex-shrink-0 text-[var(--color-text-secondary)] opacity-40 hover:opacity-100 transition-opacity"
        >
          <svg
            width="10" height="10" viewBox="0 0 10 10"
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ transform: collapsed ? "rotate(-90deg)" : "none", transition: "transform 150ms ease" }}
          >
            <path d="M2 4l3 3 3-3" />
          </svg>
        </button>

        {/* Drag grip */}
        <div
          onMouseDown={onDragStart}
          title="Drag to reorder"
          className="flex-shrink-0 cursor-grab text-[var(--color-text-secondary)] opacity-40 hover:opacity-100 active:cursor-grabbing"
        >
          <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
            <circle cx="3" cy="3"  r="1.2" />
            <circle cx="7" cy="3"  r="1.2" />
            <circle cx="3" cy="7"  r="1.2" />
            <circle cx="7" cy="7"  r="1.2" />
            <circle cx="3" cy="11" r="1.2" />
            <circle cx="7" cy="11" r="1.2" />
          </svg>
        </div>

        <span
          className="mt-0.5 h-2.5 w-2.5 flex-shrink-0 rounded-full"
          style={{ background: row.color }}
        />
        <span
          className="truncate text-sm font-medium text-[var(--color-text-primary)] cursor-default select-none"
          onDoubleClick={onDoubleClickName}
          title="Double-click to rename"
        >
          {row.name}
        </span>

        {/* Task count badge shown when collapsed */}
        {collapsed && taskCount > 0 && (
          <span className="ml-auto flex-shrink-0 rounded bg-[var(--color-bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]">
            {taskCount}
          </span>
        )}
      </div>

      {/* Bottom: lane controls + delete — hidden when collapsed */}
      {!collapsed && (
        <div className="flex items-center justify-between">
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
      )}
    </div>
  );
}
