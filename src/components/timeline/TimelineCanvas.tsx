import { useMemo } from "react";
import {
  addDays,
  addWeeks,
  addMonths,
  startOfISOWeek,
  startOfMonth,
  isBefore,
  format,
  getDay,
  getISOWeek,
  parseISO,
  startOfDay,
} from "date-fns";
import type { Row, Task, ZoomLevel } from "../../types";
import { computeEffectiveStatus } from "../../types";
import { dateToX, getViewBounds, pxPerDay } from "../../lib/dateToX";

// ---------------------------------------------------------------------------
// Layout constants — must match RowPanel.tsx
// ---------------------------------------------------------------------------
export const HEADER_HEIGHT = 52;
export const ROW_HEIGHT = 48;

const BAR_PAD_Y = 8;                        // vertical gap between bar and row edge
const BAR_HEIGHT = ROW_HEIGHT - BAR_PAD_Y * 2; // 32px
const MILESTONE_R = 9;                      // half-size of milestone diamond

// ---------------------------------------------------------------------------
// Column descriptor for the date axis
// ---------------------------------------------------------------------------
interface Column {
  key: string;
  date: Date;
  x: number;
  width: number;
  label: string;
  isWeekend?: boolean;
}

function buildColumns(
  viewStart: Date,
  viewEnd: Date,
  canvasWidth: number,
  zoom: ZoomLevel
): Column[] {
  const cols: Column[] = [];
  const px = pxPerDay(zoom);

  if (zoom === "days") {
    let d = startOfDay(viewStart);
    while (isBefore(d, viewEnd)) {
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      const dow = getDay(d); // 0 = Sun, 6 = Sat
      cols.push({ key: d.toISOString(), date: d, x, width: px, label: format(d, "d"), isWeekend: dow === 0 || dow === 6 });
      d = addDays(d, 1);
    }
  } else if (zoom === "weeks") {
    let d = startOfISOWeek(viewStart); // Monday
    while (isBefore(d, viewEnd)) {
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      cols.push({ key: d.toISOString(), date: d, x, width: 7 * px, label: format(d, "MMM d") });
      d = addWeeks(d, 1);
    }
  } else {
    // months
    let d = startOfMonth(viewStart);
    while (isBefore(d, viewEnd)) {
      const nextMonth = addMonths(d, 1);
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      const xEnd = dateToX(nextMonth, viewStart, viewEnd, canvasWidth);
      cols.push({ key: d.toISOString(), date: d, x, width: xEnd - x, label: format(d, "MMM yyyy") });
      d = nextMonth;
    }
  }

  return cols;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export interface TimelineCanvasProps {
  sortedRows: Row[];
  tasks: Task[];
  zoom: ZoomLevel;
}

export default function TimelineCanvas({ sortedRows, tasks, zoom }: TimelineCanvasProps) {
  // --- coordinate system ---
  const { viewStart, viewEnd, canvasWidth } = useMemo(
    () => getViewBounds(tasks, zoom),
    [tasks, zoom]
  );

  const columns = useMemo(
    () => buildColumns(viewStart, viewEnd, canvasWidth, zoom),
    [viewStart, viewEnd, canvasWidth, zoom]
  );

  // --- today line ---
  const today = startOfDay(new Date());
  const todayX = dateToX(today, viewStart, viewEnd, canvasWidth);
  const todayVisible = todayX >= 0 && todayX <= canvasWidth;

  // --- row Y positions ---
  const rowYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = HEADER_HEIGHT;
    for (const row of sortedRows) {
      map.set(row.id, y);
      y += ROW_HEIGHT;
    }
    return map;
  }, [sortedRows]);

  const svgHeight = HEADER_HEIGHT + sortedRows.length * ROW_HEIGHT;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      className="relative flex-1 overflow-auto bg-[var(--color-bg-base)]"
      style={{ minWidth: 0 }}
    >
      <svg width={canvasWidth} height={svgHeight} style={{ display: "block" }}>

        {/* ── Clip paths for task bar text ──────────────────────────────── */}
        <defs>
          {tasks.map((task) => {
            const rowY = rowYMap.get(task.rowId);
            if (rowY === undefined) return null;
            const x = dateToX(parseISO(task.start), viewStart, viewEnd, canvasWidth);
            const xEnd = dateToX(addDays(parseISO(task.end), 1), viewStart, viewEnd, canvasWidth);
            const w = xEnd - x;
            return (
              <clipPath key={task.id} id={`clip-${task.id}`}>
                <rect
                  x={x + 6}
                  y={rowY + BAR_PAD_Y}
                  width={Math.max(w - 12, 0)}
                  height={BAR_HEIGHT}
                />
              </clipPath>
            );
          })}
        </defs>

        {/* ── Column backgrounds (days zoom: weekday/weekend shading) ─── */}
        {zoom === "days" && columns.map((col) => (
          <rect
            key={`colbg-${col.key}`}
            x={col.x}
            y={HEADER_HEIGHT}
            width={col.width}
            height={svgHeight - HEADER_HEIGHT}
            fill={col.isWeekend ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.03)"}
          />
        ))}

        {/* ── Row bands ────────────────────────────────────────────────── */}
        {sortedRows.map((row) => {
          const y = rowYMap.get(row.id)!;
          return (
            <g key={row.id}>
              <line
                x1={0} y1={y + ROW_HEIGHT}
                x2={canvasWidth} y2={y + ROW_HEIGHT}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
              />
            </g>
          );
        })}

        {/* ── Grid lines (vertical, one per column boundary) ───────────── */}
        {columns.map((col) => (
          <line
            key={col.key}
            x1={col.x} y1={HEADER_HEIGHT}
            x2={col.x} y2={svgHeight}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        ))}

        {/* ── Today line ───────────────────────────────────────────────── */}
        {todayVisible && (
          <line
            x1={todayX} y1={HEADER_HEIGHT}
            x2={todayX} y2={svgHeight}
            stroke="#f87171"
            strokeWidth={1.5}
          />
        )}

        {/* ── Task bars ────────────────────────────────────────────────── */}
        {tasks.map((task) => {
          const rowY = rowYMap.get(task.rowId);
          if (rowY === undefined) return null;

          const x = dateToX(parseISO(task.start), viewStart, viewEnd, canvasWidth);
          const xEnd = dateToX(addDays(parseISO(task.end), 1), viewStart, viewEnd, canvasWidth);
          const w = Math.max(xEnd - x, 2); // always at least 2px wide
          const barY = rowY + BAR_PAD_Y;
          const barCenterY = barY + BAR_HEIGHT / 2;
          const status = computeEffectiveStatus(task);
          const isDone = status === "done";
          const isOverdue = status === "overdue";

          if (task.isMilestone) {
            const cx = x + w / 2;
            const r = MILESTONE_R;
            return (
              <g key={task.id}>
                <polygon
                  points={`${cx},${barCenterY - r} ${cx + r},${barCenterY} ${cx},${barCenterY + r} ${cx - r},${barCenterY}`}
                  fill={task.color}
                  fillOpacity={isDone ? 0.45 : 1}
                  stroke={isOverdue ? "#ef4444" : "none"}
                  strokeWidth={1.5}
                />
              </g>
            );
          }

          return (
            <g key={task.id}>
              <rect
                x={x}
                y={barY}
                width={w}
                height={BAR_HEIGHT}
                rx={4}
                fill={task.color}
                fillOpacity={isDone ? 0.45 : 1}
                stroke={isOverdue ? "#ef4444" : "none"}
                strokeWidth={1.5}
              />
              {w >= 24 && (
                <text
                  x={x + 8}
                  y={barCenterY + 4}
                  fontSize={12}
                  fill="white"
                  fillOpacity={0.9}
                  clipPath={`url(#clip-${task.id})`}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {isDone ? `✓ ${task.title}` : task.title}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Date axis (rendered last — sits on top of grid lines) ─────── */}
        <rect
          x={0} y={0}
          width={canvasWidth}
          height={HEADER_HEIGHT}
          fill="var(--color-bg-surface)"
        />

        {/* ── Header column borders (days zoom only) ───────────────────── */}
        {zoom === "days" && columns.map((col) => {
          const isMonthBoundary = col.date.getDate() === 1;
          const isWeekBoundary = getDay(col.date) === 1;
          if (!isMonthBoundary && !isWeekBoundary) return null;
          return (
            <line
              key={`hborder-${col.key}`}
              x1={col.x}
              y1={isMonthBoundary ? 0 : 18}
              x2={col.x}
              y2={isMonthBoundary ? 18 : 36}
              stroke={isMonthBoundary ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}
              strokeWidth={1}
            />
          );
        })}

        {zoom === "days" ? (
          <>
            {/* Row 1: Month / year — only on the 1st of each month */}
            {columns.map((col) => {
              if (col.date.getDate() !== 1) return null;
              const isJanuary = col.date.getMonth() === 0;
              const label = isJanuary
                ? format(col.date, "MMMM yyyy")
                : format(col.date, "MMMM");
              return (
                <text
                  key={`mo-${col.key}`}
                  x={col.x + 4}
                  y={13}
                  fontSize={10}
                  fontWeight={500}
                  fill="rgba(255,255,255,0.65)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {label}
                </text>
              );
            })}

            <line x1={0} y1={18} x2={canvasWidth} y2={18} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 2: Week numbers — only on Mondays */}
            {columns.map((col) => {
              if (getDay(col.date) !== 1) return null; // 1 = Monday
              return (
                <text
                  key={`wk-${col.key}`}
                  x={col.x + 4}
                  y={31}
                  fontSize={10}
                  fill="rgba(255,255,255,0.4)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {`W${getISOWeek(col.date)}`}
                </text>
              );
            })}

            <line x1={0} y1={36} x2={canvasWidth} y2={36} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 3: Day numbers */}
            {columns.map((col) => (
              <text
                key={`lbl-${col.key}`}
                x={col.x + col.width / 2}
                y={47}
                fontSize={11}
                fill="rgba(255,255,255,0.45)"
                textAnchor="middle"
                style={{ userSelect: "none" }}
              >
                {col.label}
              </text>
            ))}
          </>
        ) : (
          /* Weeks / months zoom — single centered label */
          columns.map((col) => {
            if (col.width < 20) return null;
            return (
              <text
                key={`lbl-${col.key}`}
                x={col.x + col.width / 2}
                y={HEADER_HEIGHT / 2 + 5}
                fontSize={11}
                fill="rgba(255,255,255,0.45)"
                textAnchor="middle"
                style={{ userSelect: "none" }}
              >
                {col.label}
              </text>
            );
          })
        )}

        {/* Today indicator dot on date axis */}
        {todayVisible && (
          <circle cx={todayX} cy={HEADER_HEIGHT} r={3} fill="#f87171" />
        )}

        {/* Date axis bottom border */}
        <line
          x1={0} y1={HEADER_HEIGHT}
          x2={canvasWidth} y2={HEADER_HEIGHT}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />

      </svg>
    </div>
  );
}
