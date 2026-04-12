import { useMemo, useRef, useEffect, useCallback, useState, useLayoutEffect } from "react";
import {
  addDays,
  addWeeks,
  addMonths,
  subDays,
  startOfISOWeek,
  startOfMonth,
  getDaysInMonth,
  differenceInDays,
  isBefore,
  isAfter,
  format,
  getDay,
  getISOWeek,
  parseISO,
  startOfDay,
} from "date-fns";
import type { Row, Task, ZoomLevel } from "../../types";
import { computeEffectiveStatus } from "../../types";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import { dateToX, xToDate, getInitialBounds, pxPerDay } from "../../lib/dateToX";

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
  isWeekend?: boolean;    // days zoom
  isMonthStart?: boolean; // weeks zoom
}

function buildColumns(
  viewStart: Date,
  viewEnd: Date,
  canvasWidth: number,
  zoom: ZoomLevel,
  renderStart: Date,
  renderEnd: Date
): Column[] {
  const cols: Column[] = [];
  const px = pxPerDay(zoom);

  if (zoom === "days") {
    // Start from the later of viewStart and renderStart
    let d = startOfDay(isBefore(viewStart, renderStart) ? renderStart : viewStart);
    while (isBefore(d, viewEnd) && !isAfter(d, renderEnd)) {
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      const dow = getDay(d); // 0 = Sun, 6 = Sat
      cols.push({ key: d.toISOString(), date: d, x, width: px, label: format(d, "d"), isWeekend: dow === 0 || dow === 6 });
      d = addDays(d, 1);
    }
  } else if (zoom === "weeks") {
    // Start from the ISO week that contains max(viewStart, renderStart)
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfISOWeek(anchor);
    if (isBefore(d, viewStart)) d = startOfISOWeek(viewStart);

    let prevMonth = d.getMonth() - 1; // force first column to check for month start
    const seenMonths = new Set<number>();
    const monthKey = (date: Date) => date.getFullYear() * 12 + date.getMonth();

    while (isBefore(d, viewEnd) && !isAfter(d, addDays(renderEnd, 7))) {
      if (isAfter(d, renderEnd)) break;
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      const isMonthStart = d.getMonth() !== prevMonth;
      prevMonth = d.getMonth();
      const endOfWeek = addDays(d, 6);
      const startLabel = seenMonths.has(monthKey(d)) ? format(d, "d") : format(d, "MMM d");
      seenMonths.add(monthKey(d));
      const endLabel = seenMonths.has(monthKey(endOfWeek)) ? format(endOfWeek, "d") : format(endOfWeek, "MMM d");
      seenMonths.add(monthKey(endOfWeek));
      const label = `${startLabel} – ${endLabel}`;
      cols.push({ key: d.toISOString(), date: d, x, width: 7 * px, label, isMonthStart });
      d = addWeeks(d, 1);
    }
  } else {
    // months — start from the month containing max(viewStart, renderStart)
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfMonth(anchor);
    if (isBefore(d, viewStart)) d = startOfMonth(viewStart);

    while (isBefore(d, viewEnd) && !isAfter(d, addMonths(renderEnd, 1))) {
      if (isAfter(d, renderEnd)) break;
      const nextMonth = addMonths(d, 1);
      const x = dateToX(d, viewStart, viewEnd, canvasWidth);
      const xEnd = dateToX(nextMonth, viewStart, viewEnd, canvasWidth);
      cols.push({ key: d.toISOString(), date: d, x, width: xEnd - x, label: format(d, "MMM") });
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
  scrollCenterDate?: string;                            // from workspace, used only on mount
  onScrollCenterDateChange?: (date: string) => void;   // debounced, saves to disk
  onCenterDateLive?: (dateStr: string) => void;        // fires on every scroll, updates display
  onRegisterScrollToToday?: (fn: () => void) => void;
  onRegisterScrollToDate?: (fn: (date: Date) => void) => void;
}

export default function TimelineCanvas({
  sortedRows,
  tasks,
  zoom,
  scrollCenterDate,
  onScrollCenterDateChange,
  onCenterDateLive,
  onRegisterScrollToToday,
  onRegisterScrollToDate,
}: TimelineCanvasProps) {
  const { setPanel } = useLoadedWorkspace();
  const today = startOfDay(new Date());

  // Capture scrollCenterDate at mount only — never changes after that
  const initialScrollCenterDateRef = useRef(scrollCenterDate);

  // --- viewStart/viewEnd as state (grow via extend-on-demand) ---
  // If scrollCenterDate falls outside the task-derived bounds (user had scrolled
  // far away), extend the initial range to include it so columns render on open.
  const [viewStart, setViewStart] = useState<Date>(() => {
    const { viewStart } = getInitialBounds(tasks);
    if (initialScrollCenterDateRef.current) {
      const center = parseISO(initialScrollCenterDateRef.current);
      if (isBefore(center, viewStart)) return subDays(center, 200);
    }
    return viewStart;
  });
  const [viewEnd, setViewEnd] = useState<Date>(() => {
    const { viewEnd } = getInitialBounds(tasks);
    if (initialScrollCenterDateRef.current) {
      const center = parseISO(initialScrollCenterDateRef.current);
      if (isAfter(center, viewEnd)) return addDays(center, 200);
    }
    return viewEnd;
  });

  // canvasWidth derived from state
  const totalDays   = differenceInDays(viewEnd, viewStart);
  const canvasWidth = totalDays * pxPerDay(zoom);

  // --- render window: only elements within this range exist in the DOM ---
  const BUFFER_DAYS = 180;
  const initialCenter = initialScrollCenterDateRef.current
    ? parseISO(initialScrollCenterDateRef.current)
    : today;
  const [renderStart, setRenderStart] = useState<Date>(() => subDays(initialCenter, BUFFER_DAYS));
  const [renderEnd,   setRenderEnd]   = useState<Date>(() => addDays(initialCenter, BUFFER_DAYS));

  // --- columns (filtered to render window) ---
  const columns = useMemo(
    () => buildColumns(viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd),
    [viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd]
  );

  // --- week start positions for months zoom header (filtered to render window) ---
  const monthZoomWeekStarts = useMemo(() => {
    if (zoom !== "months") return [];
    const result: Array<{ date: Date; x: number }> = [];
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfISOWeek(anchor);
    if (isBefore(d, viewStart)) d = startOfISOWeek(viewStart);
    while (isBefore(d, viewEnd) && !isAfter(d, addDays(renderEnd, 7))) {
      result.push({ date: d, x: dateToX(d, viewStart, viewEnd, canvasWidth) });
      d = addWeeks(d, 1);
    }
    return result;
  }, [viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd]);

  // --- month start positions for weeks zoom (filtered to render window) ---
  const weekZoomMonthStarts = useMemo(() => {
    if (zoom !== "weeks") return [];
    const result: Array<{ date: Date; x: number }> = [];
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfMonth(anchor);
    if (isBefore(d, viewStart)) d = startOfMonth(viewStart);
    while (isBefore(d, viewEnd) && !isAfter(d, addMonths(renderEnd, 1))) {
      result.push({ date: d, x: dateToX(d, viewStart, viewEnd, canvasWidth) });
      d = addMonths(d, 1);
    }
    return result;
  }, [viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd]);

  // --- today line ---
  const todayX = dateToX(today, viewStart, viewEnd, canvasWidth) + pxPerDay(zoom) / 2;
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
  // Scroll refs
  // ---------------------------------------------------------------------------
  const containerRef          = useRef<HTMLDivElement>(null);
  const pendingScrollAdjRef   = useRef(0);          // left-extension compensation (px)
  const pendingNavigateDateRef = useRef<Date | null>(null); // navigate-to-date after view extends
  const rafRef                = useRef<number | null>(null);
  const saveCenterTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevZoomRef           = useRef(zoom);

  // Tracks the current viewport center date in real time.
  // Updated on every scroll, after scrollToToday, and after mount scroll.
  // Used by the zoom transition so it never has to read c.scrollLeft after a
  // re-render (by which point the browser may have already clamped it).
  const currentCenterDateRef = useRef<Date>(initialCenter);

  // Keep a ref with current values so the rAF callback never reads stale closures
  const scrollStateRef = useRef({ viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd });
  scrollStateRef.current = { viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd };

  // ---------------------------------------------------------------------------
  // useLayoutEffect — runs after any view-bounds change.
  // Priority 1: navigate to a pending date (after view extended to include it).
  // Priority 2: compensate scrollLeft for left-side extension.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    if (pendingNavigateDateRef.current !== null) {
      const targetDate = pendingNavigateDateRef.current;
      pendingNavigateDateRef.current = null;
      pendingScrollAdjRef.current = 0; // discard left-extension adj — we're jumping anyway
      const c = containerRef.current;
      const centerX = dateToX(targetDate, viewStart, viewEnd, canvasWidth);
      c.scrollLeft = Math.max(0, centerX - c.clientWidth / 2);
      currentCenterDateRef.current = targetDate;
      onCenterDateLive?.(format(targetDate, 'yyyy-MM-dd'));
    } else if (pendingScrollAdjRef.current !== 0) {
      containerRef.current.scrollLeft += pendingScrollAdjRef.current;
      pendingScrollAdjRef.current = 0;
    }
  }, [viewStart, viewEnd]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Zoom transition — preserve viewport center date when zoom changes.
  // Uses currentCenterDateRef (updated continuously) instead of reading
  // c.scrollLeft, which the browser clamps before this effect ever fires.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (prevZoomRef.current !== zoom) {
      const centerDate = currentCenterDateRef.current;
      const newCenterX = dateToX(centerDate, viewStart, viewEnd, canvasWidth);
      c.scrollLeft = Math.max(0, newCenterX - c.clientWidth / 2);
      prevZoomRef.current = zoom;
    }
  }, [zoom, viewStart, viewEnd, canvasWidth]);

  // ---------------------------------------------------------------------------
  // Initial scroll — restore saved center date or default to today
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const centerDate = initialScrollCenterDateRef.current
      ? parseISO(initialScrollCenterDateRef.current)
      : today;
    currentCenterDateRef.current = centerDate;
    const centerX = dateToX(centerDate, viewStart, viewEnd, canvasWidth);
    c.scrollLeft = Math.max(0, centerX - c.clientWidth / 2);
    onCenterDateLive?.(format(centerDate, 'yyyy-MM-dd'));
  }, []); // mount only — eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // scrollToToday
  // ---------------------------------------------------------------------------
  const scrollToToday = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    currentCenterDateRef.current = today;
    const todayXCenter = dateToX(today, viewStart, viewEnd, canvasWidth) + pxPerDay(zoom) / 2;
    c.scrollLeft = Math.max(0, todayXCenter - c.clientWidth / 2);
    onCenterDateLive?.(format(today, 'yyyy-MM-dd'));
  }, [viewStart, viewEnd, canvasWidth, zoom]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onRegisterScrollToToday?.(scrollToToday);
  }, [scrollToToday, onRegisterScrollToToday]);

  // ---------------------------------------------------------------------------
  // scrollToDate — jump to any date; extends view bounds if needed
  // ---------------------------------------------------------------------------
  const scrollToDate = useCallback((date: Date) => {
    const c = containerRef.current;
    if (!c) return;
    const { viewStart, viewEnd, canvasWidth } = scrollStateRef.current;
    if (isBefore(date, viewStart) || isAfter(date, viewEnd)) {
      // Date outside current range — extend view, then scroll in useLayoutEffect
      pendingNavigateDateRef.current = date;
      if (isBefore(date, viewStart)) setViewStart(subDays(date, 200));
      if (isAfter(date, viewEnd))   setViewEnd(addDays(date, 200));
    } else {
      // Date within range — scroll directly
      const centerX = dateToX(date, viewStart, viewEnd, canvasWidth);
      c.scrollLeft = Math.max(0, centerX - c.clientWidth / 2);
      currentCenterDateRef.current = date;
      onCenterDateLive?.(format(date, 'yyyy-MM-dd'));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onRegisterScrollToDate?.(scrollToDate);
  }, [scrollToDate, onRegisterScrollToDate]);

  // ---------------------------------------------------------------------------
  // Scroll handler — rAF batched
  // ---------------------------------------------------------------------------
  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const sl = e.currentTarget.scrollLeft;
    const vw = containerRef.current!.clientWidth;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;

      const { viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd } = scrollStateRef.current;

      const bufferPx = vw * 1.5;
      const safeZone = bufferPx * 0.5; // inner zone where no re-render is needed

      // Update render window if scroll has moved past the safe zone
      const rsX = dateToX(renderStart, viewStart, viewEnd, canvasWidth);
      const reX = dateToX(renderEnd,   viewStart, viewEnd, canvasWidth);
      if (sl - safeZone < rsX || sl + vw + safeZone > reX) {
        const newRS = xToDate(Math.max(0,          sl - bufferPx),       viewStart, viewEnd, canvasWidth);
        const newRE = xToDate(Math.min(canvasWidth, sl + vw + bufferPx), viewStart, viewEnd, canvasWidth);
        setRenderStart(newRS);
        setRenderEnd(newRE);
      }

      // Extend left
      const EXTEND_DAYS = 500;
      const EXTEND_THRESHOLD = vw;
      if (sl < EXTEND_THRESHOLD) {
        pendingScrollAdjRef.current += EXTEND_DAYS * pxPerDay(zoom);
        setViewStart(prev => subDays(prev, EXTEND_DAYS));
      }

      // Extend right
      if (sl > canvasWidth - vw - EXTEND_THRESHOLD) {
        setViewEnd(prev => addDays(prev, EXTEND_DAYS));
      }

      // Always keep center date ref current
      const centerDate = xToDate(sl + vw / 2, viewStart, viewEnd, canvasWidth);
      currentCenterDateRef.current = centerDate;
      onCenterDateLive?.(format(centerDate, 'yyyy-MM-dd'));

      // Debounced save of scroll center date
      if (saveCenterTimerRef.current) clearTimeout(saveCenterTimerRef.current);
      saveCenterTimerRef.current = setTimeout(() => {
        onScrollCenterDateChange?.(format(currentCenterDateRef.current, 'yyyy-MM-dd'));
      }, 1000);
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="relative flex-1 overflow-auto bg-[var(--color-bg-base)]"
      style={{ minWidth: 0 }}
    >
      <svg width={canvasWidth} height={svgHeight} style={{ display: "block" }}>

        {/* ── Clip paths for task bar text ──────────────────────────────── */}
        <defs>
          {tasks.map((task) => {
            const rowY = rowYMap.get(task.rowId);
            if (rowY === undefined) return null;
            // Only create clip paths for tasks in the render window
            const taskStart = parseISO(task.start);
            const taskEnd   = addDays(parseISO(task.end), 1);
            if (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart)) return null;
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

        {/* ── Column backgrounds ───────────────────────────────────────── */}
        {zoom === "days" && columns.map((col) => (
          <rect
            key={`colbg-${col.key}`}
            x={col.x} y={HEADER_HEIGHT}
            width={col.width} height={svgHeight - HEADER_HEIGHT}
            fill={col.isWeekend ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.03)"}
          />
        ))}
        {zoom === "weeks" && columns.flatMap((col) =>
          [0, 1, 2, 3, 4, 5, 6].map((offset) => {
            const dow = getDay(addDays(col.date, offset));
            const isWeekend = dow === 0 || dow === 6;
            return (
              <rect
                key={`colbg-${col.key}-${offset}`}
                x={col.x + offset * pxPerDay("weeks")} y={HEADER_HEIGHT}
                width={pxPerDay("weeks")} height={svgHeight - HEADER_HEIGHT}
                fill={isWeekend ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.03)"}
              />
            );
          })
        )}
        {zoom === "months" && monthZoomWeekStarts.map((ws, i) => (
          <rect
            key={`colbg-${ws.date.toISOString()}`}
            x={ws.x} y={HEADER_HEIGHT}
            width={7 * pxPerDay("months")} height={svgHeight - HEADER_HEIGHT}
            fill={i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.18)"}
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

        {/* ── Day subdivisions within weeks / months zoom columns ─────── */}
        {zoom === "weeks" && columns.flatMap((col) =>
          [1, 2, 3, 4, 5, 6].map((offset) => (
            <line
              key={`daysub-${col.key}-${offset}`}
              x1={col.x + offset * pxPerDay("weeks")} y1={HEADER_HEIGHT}
              x2={col.x + offset * pxPerDay("weeks")} y2={svgHeight}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))
        )}
        {zoom === "months" && monthZoomWeekStarts.map((ws) => (
          <line
            key={`wksep-${ws.date.toISOString()}`}
            x1={ws.x} y1={HEADER_HEIGHT}
            x2={ws.x} y2={svgHeight}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        ))}
        {zoom === "months" && columns.flatMap((col) =>
          Array.from({ length: getDaysInMonth(col.date) - 1 }, (_, i) => (
            <line
              key={`daysub-${col.key}-${i + 1}`}
              x1={col.x + (i + 1) * pxPerDay("months")} y1={HEADER_HEIGHT}
              x2={col.x + (i + 1) * pxPerDay("months")} y2={svgHeight}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))
        )}

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

          // Overlap check — render if any part of the task is in the render window
          const taskStart = parseISO(task.start);
          const taskEnd   = addDays(parseISO(task.end), 1);
          if (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart)) return null;

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
              <g key={task.id} style={{ cursor: "pointer" }} onClick={() => setPanel({ type: "task", taskId: task.id })}>
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
            <g key={task.id} style={{ cursor: "pointer" }} onClick={() => setPanel({ type: "task", taskId: task.id })}>
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

        {/* ── Header column borders ────────────────────────────────────── */}
        {zoom === "days" && columns.map((col) => {
          const isMonthBoundary = col.date.getDate() === 1;
          const isWeekBoundary = getDay(col.date) === 1;
          if (!isMonthBoundary && !isWeekBoundary) return null;
          return (
            <line
              key={`hborder-${col.key}`}
              x1={col.x} y1={isMonthBoundary ? 0 : 18}
              x2={col.x} y2={isMonthBoundary ? 18 : 36}
              stroke={isMonthBoundary ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.1)"}
              strokeWidth={1}
            />
          );
        })}
        {zoom === "weeks" && (
          <>
            {weekZoomMonthStarts.map((ms) => (
              <line key={`hborder-mo-${ms.date.toISOString()}`} x1={ms.x} y1={0} x2={ms.x} y2={26} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            ))}
            {columns.map((col) => (
              <line key={`hborder-wk-${col.key}`} x1={col.x} y1={26} x2={col.x} y2={HEADER_HEIGHT} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
            ))}
          </>
        )}
        {zoom === "months" && (
          <>
            {columns.map((col) => col.date.getMonth() !== 0 ? null : (
              <line key={`hborder-yr-${col.key}`} x1={col.x} y1={0} x2={col.x} y2={18} stroke="rgba(255,255,255,0.2)" strokeWidth={1} />
            ))}
            {columns.map((col) => (
              <line key={`hborder-mo-${col.key}`} x1={col.x} y1={18} x2={col.x} y2={36} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
            ))}
            {monthZoomWeekStarts.map((ws) => (
              <line key={`hborder-wk-${ws.date.toISOString()}`} x1={ws.x} y1={36} x2={ws.x} y2={HEADER_HEIGHT} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
            ))}
          </>
        )}

        {/* ── Header labels ────────────────────────────────────────────── */}
        {zoom === "days" ? (
          <>
            {/* Row 1: Month / year — only on the 1st of each month */}
            {columns.map((col) => {
              if (col.date.getDate() !== 1) return null;
              const isJanuary = col.date.getMonth() === 0;
              return (
                <text
                  key={`mo-${col.key}`}
                  x={col.x + 4} y={13}
                  fontSize={10} fontWeight={500}
                  fill="rgba(255,255,255,0.65)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {isJanuary ? format(col.date, "MMMM yyyy") : format(col.date, "MMMM")}
                </text>
              );
            })}
            <line x1={0} y1={18} x2={canvasWidth} y2={18} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 2: Week numbers — only on Mondays */}
            {columns.map((col) => {
              if (getDay(col.date) !== 1) return null;
              return (
                <text
                  key={`wk-${col.key}`}
                  x={col.x + 4} y={31}
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
                x={col.x + col.width / 2} y={47}
                fontSize={11}
                fill="rgba(255,255,255,0.45)"
                textAnchor="middle"
                style={{ userSelect: "none" }}
              >
                {col.label}
              </text>
            ))}
          </>
        ) : zoom === "weeks" ? (
          <>
            {/* Row 1: Month name — at exact 1st-of-month x positions */}
            {weekZoomMonthStarts.map((ms) => (
              <text
                key={`mo-${ms.date.toISOString()}`}
                x={ms.x + 4} y={17}
                fontSize={10} fontWeight={500}
                fill="rgba(255,255,255,0.65)"
                textAnchor="start"
                style={{ userSelect: "none" }}
              >
                {ms.date.getMonth() === 0 ? format(ms.date, "MMMM yyyy") : format(ms.date, "MMMM")}
              </text>
            ))}
            <line x1={0} y1={26} x2={canvasWidth} y2={26} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 2: W# on the left + date range after it */}
            {columns.map((col) => (
              <g key={`lbl-${col.key}`}>
                <text
                  x={col.x + 4} y={42}
                  fontSize={9}
                  fill="rgba(255,255,255,0.3)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {`W${getISOWeek(col.date)}`}
                </text>
                <text
                  x={col.x + col.width / 2} y={42}
                  fontSize={10}
                  fill="rgba(255,255,255,0.45)"
                  textAnchor="middle"
                  style={{ userSelect: "none" }}
                >
                  {col.label}
                </text>
              </g>
            ))}
          </>
        ) : (
          <>
            {/* Row 1: Year — y=0 to y=18 */}
            {columns.map((col) => {
              if (col.date.getMonth() !== 0) return null;
              return (
                <text
                  key={`yr-${col.key}`}
                  x={col.x + 4} y={13}
                  fontSize={10} fontWeight={500}
                  fill="rgba(255,255,255,0.65)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {format(col.date, "yyyy")}
                </text>
              );
            })}
            <line x1={0} y1={18} x2={canvasWidth} y2={18} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 2: Month abbreviations — y=18 to y=36 */}
            {columns.map((col) => {
              if (col.width < 20) return null;
              return (
                <text
                  key={`lbl-${col.key}`}
                  x={col.x + col.width / 2} y={29}
                  fontSize={10}
                  fill="rgba(255,255,255,0.45)"
                  textAnchor="middle"
                  style={{ userSelect: "none" }}
                >
                  {col.label}
                </text>
              );
            })}
            <line x1={0} y1={36} x2={canvasWidth} y2={36} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

            {/* Row 3: Week numbers — y=36 to y=52 */}
            {monthZoomWeekStarts.map((ws) => (
              <text
                key={`wk-${ws.date.toISOString()}`}
                x={ws.x + 4} y={47}
                fontSize={9}
                fill="rgba(255,255,255,0.3)"
                textAnchor="start"
                style={{ userSelect: "none" }}
              >
                {`W${getISOWeek(ws.date)}`}
              </text>
            ))}
          </>
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
