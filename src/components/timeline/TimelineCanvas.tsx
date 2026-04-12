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
const MILESTONE_R = 13;                     // half-size of milestone diamond

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
  subLaneMap: Map<string, number>;
  rowLaneCount: Map<string, number>;
  zoom: ZoomLevel;
  scrollCenterDate?: string;                            // from workspace, used only on mount
  onScrollCenterDateChange?: (date: string) => void;   // debounced, saves to disk
  onCenterDateLive?: (dateStr: string) => void;        // fires on every scroll, updates display
  onRegisterScrollToToday?: (fn: () => void) => void;
  onRegisterScrollToDate?: (fn: (date: Date) => void) => void;
  onVerticalScroll?: (scrollTop: number) => void;
}

export default function TimelineCanvas({
  sortedRows,
  tasks,
  subLaneMap,
  rowLaneCount,
  zoom,
  scrollCenterDate,
  onScrollCenterDateChange,
  onCenterDateLive,
  onRegisterScrollToToday,
  onRegisterScrollToDate,
  onVerticalScroll,
}: TimelineCanvasProps) {
  const { setPanel, updateTask, updateRow, batchUpdateTasks, createTask } = useLoadedWorkspace();
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

  // --- row Y positions (variable height — depends on sub-lane count) ---
  const rowYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = HEADER_HEIGHT;
    for (const row of sortedRows) {
      map.set(row.id, y);
      y += (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT;
    }
    return map;
  }, [sortedRows, rowLaneCount]);

  const gridHeight = useMemo(() => {
    return sortedRows.reduce(
      (acc, row) => acc + (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT,
      HEADER_HEIGHT
    );
  }, [sortedRows, rowLaneCount]);

  // svgHeight extends 2 lanes below the last row for blank scroll padding
  const svgHeight = gridHeight + 2 * ROW_HEIGHT;

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

  // Stable refs so drag callbacks never read stale closures
  const sortedRowsRef = useRef(sortedRows);
  sortedRowsRef.current = sortedRows;
  const rowLaneCountRef = useRef(rowLaneCount);
  rowLaneCountRef.current = rowLaneCount;

  // ---------------------------------------------------------------------------
  // Drag state
  // ---------------------------------------------------------------------------
  type DragState = {
    type: "move" | "resizeLeft" | "resizeRight";
    taskId: string;
    origStart: string;      // YYYY-MM-DD at drag start
    origEnd: string;
    origRowId: string;      // row at drag start
    cursorDayOffset: number; // fractional days from task.start to cursor (move only)
    duration: number;        // origEnd - origStart in whole days (move only)
    initialClientX: number;  // viewport X at drag-begin, used for dead-zone check
    initialClientY: number;  // viewport Y at drag-begin, used for dead-zone check
    hasMoved: boolean;
    currentStart: string;    // latest snapped position, read on mouseup
    currentEnd: string;
    currentRowId: string;    // row currently under the cursor (move only)
  };
  const dragStateRef    = useRef<DragState | null>(null);
  const justDraggedRef         = useRef(false); // blocks onClick after a real drag
  const updateTaskRef          = useRef(updateTask);
  updateTaskRef.current        = updateTask;
  const batchUpdateTasksRef    = useRef(batchUpdateTasks);
  batchUpdateTasksRef.current  = batchUpdateTasks;
  const updateRowRef           = useRef(updateRow);
  updateRowRef.current         = updateRow;

  // cursor position during drag — read by the auto-scroll RAF loop
  const dragClientXRef    = useRef(0);
  const dragClientYRef    = useRef(0);
  const autoScrollRafRef  = useRef<number | null>(null);

  // Changing this state re-renders the bar at its dragged position
  const [dragOverride, setDragOverride] = useState<{
    taskId: string; start: string; end: string; rowId: string; previewLane: number;
  } | null>(null);

  // Drop indicator: highlights the target lane during a move drag.
  // targetTaskId / position are only set when the cursor lane has an overlapping task
  // (used to resolve rowOrder so the right task wins the lane on conflict).
  const [dropIndicator, setDropIndicator] = useState<{
    rowId: string;
    lane: number;
    targetTaskId?: string;
    position?: "above" | "below";
  } | null>(null);
  const dropIndicatorRef = useRef<{
    rowId: string;
    lane: number;
    targetTaskId?: string;
    position?: "above" | "below";
  } | null>(null);

  // Stable refs for drag callbacks that need current render values
  const tasksRef       = useRef(tasks);
  tasksRef.current     = tasks;
  const subLaneMapRef  = useRef(subLaneMap);
  subLaneMapRef.current = subLaneMap;
  const rowYMapRef     = useRef(rowYMap);
  rowYMapRef.current   = rowYMap;

  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Lane context menu (right-click)
  // ---------------------------------------------------------------------------
  const [laneMenu, setLaneMenu] = useState<{
    x: number;        // viewport position
    y: number;
    rowId: string;
    lane: number;
    tasksInLane: Task[];  // tasks visually rendered in this lane
  } | null>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!laneMenu) return;
    function handleOutside() { setLaneMenu(null); }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [laneMenu]);

  // Translate clientY to { rowId, lane } based on variable row heights
  function getLaneAtClientY(clientY: number): { rowId: string; lane: number } | null {
    const c = containerRef.current;
    if (!c) return null;
    const svgY = clientY - c.getBoundingClientRect().top + c.scrollTop;
    if (svgY < HEADER_HEIGHT) return null;
    const rows = sortedRowsRef.current;
    const lc = rowLaneCountRef.current;
    let y = HEADER_HEIGHT;
    for (const row of rows) {
      const totalLanes = lc.get(row.id) ?? 1;
      const rowH = totalLanes * ROW_HEIGHT;
      if (svgY < y + rowH) {
        const lane = Math.min(Math.floor((svgY - y) / ROW_HEIGHT), totalLanes - 1);
        return { rowId: row.id, lane };
      }
      y += rowH;
    }
    return null;
  }

  function handleContainerContextMenu(e: React.MouseEvent) {
    // Don't show lane menu during or right after a drag
    if (dragStateRef.current?.hasMoved) return;
    e.preventDefault();
    const hit = getLaneAtClientY(e.clientY);
    if (!hit) return;
    const { rowId, lane } = hit;
    const tasksInLane = tasks.filter(
      (t) => t.rowId === rowId && (subLaneMap.get(t.id) ?? 0) === lane
    );
    setLaneMenu({ x: e.clientX, y: e.clientY, rowId, lane, tasksInLane });
  }

  async function handleLaneAddAbove() {
    if (!laneMenu) return;
    const { rowId, lane } = laneMenu;
    setLaneMenu(null);
    const currentLanes = rowLaneCount.get(rowId) ?? 1;
    const affected = tasks
      .filter((t) => t.rowId === rowId && (t.lane ?? 0) >= lane)
      .map((t) => ({ taskId: t.id, changes: { lane: (t.lane ?? 0) + 1 } }));
    await batchUpdateTasks(affected, { rowId, laneCount: currentLanes + 1 });
  }

  async function handleLaneAddBelow() {
    if (!laneMenu) return;
    const { rowId, lane } = laneMenu;
    setLaneMenu(null);
    const currentLanes = rowLaneCount.get(rowId) ?? 1;
    const affected = tasks
      .filter((t) => t.rowId === rowId && (t.lane ?? 0) >= lane + 1)
      .map((t) => ({ taskId: t.id, changes: { lane: (t.lane ?? 0) + 1 } }));
    await batchUpdateTasks(affected, { rowId, laneCount: currentLanes + 1 });
  }

  async function handleLaneDelete() {
    if (!laneMenu || laneMenu.tasksInLane.length > 0) return;
    const { rowId, lane } = laneMenu;
    setLaneMenu(null);
    const currentLanes = rowLaneCount.get(rowId) ?? 1;
    const affected = tasks
      .filter((t) => t.rowId === rowId && (t.lane ?? 0) > lane)
      .map((t) => ({ taskId: t.id, changes: { lane: (t.lane ?? 0) - 1 } }));
    await batchUpdateTasks(affected, { rowId, laneCount: Math.max(1, currentLanes - 1) });
  }

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
    const st = e.currentTarget.scrollTop;
    const vw = containerRef.current!.clientWidth;

    // Keep RowPanel in sync with vertical scroll immediately (outside rAF)
    onVerticalScroll?.(st);

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
  // Drag helpers
  // ---------------------------------------------------------------------------
  const HANDLE_W = 6; // px — invisible resize strip on each edge

  // Convert a viewport clientX to SVG canvas X (accounts for scroll offset)
  function getSvgX(clientX: number): number {
    const c = containerRef.current;
    if (!c) return 0;
    return clientX - c.getBoundingClientRect().left + c.scrollLeft;
  }

  // Returns the rowId of whichever row the clientY is over, clamped to valid rows.
  // Returns null when the cursor is above the date-axis header.
  // Handles variable row heights (multi-lane rows are taller).
  function getRowAtClientY(clientY: number): string | null {
    const c = containerRef.current;
    if (!c) return null;
    const svgY = clientY - c.getBoundingClientRect().top + c.scrollTop;
    if (svgY < HEADER_HEIGHT) return null;
    const rows = sortedRowsRef.current;
    const laneCount = rowLaneCountRef.current;
    let y = HEADER_HEIGHT;
    for (const row of rows) {
      const h = (laneCount.get(row.id) ?? 1) * ROW_HEIGHT;
      if (svgY < y + h) return row.id;
      y += h;
    }
    return rows[rows.length - 1]?.id ?? null;
  }

  // Core position computation — called from mousemove and the auto-scroll loop.
  // svgX: canvas X. clientY: viewport Y (for row detection on move drags).
  function applyDragPosition(svgX: number, clientY: number) {
    const ds = dragStateRef.current;
    if (!ds) return;
    const { viewStart, zoom } = scrollStateRef.current;
    const px = pxPerDay(zoom);
    const origStartDays = differenceInDays(parseISO(ds.origStart), viewStart);
    const origEndDays   = differenceInDays(parseISO(ds.origEnd),   viewStart);

    let newStartDays: number;
    let newEndDays: number;

    if (ds.type === "move") {
      newStartDays = Math.round(svgX / px - ds.cursorDayOffset);
      newEndDays   = newStartDays + ds.duration;
      // Row detection: update currentRowId when cursor is over a valid row
      const hoveredRow = getRowAtClientY(clientY);
      if (hoveredRow) ds.currentRowId = hoveredRow;
    } else if (ds.type === "resizeLeft") {
      newStartDays = Math.min(Math.round(svgX / px), origEndDays);
      newEndDays   = origEndDays;
    } else {
      newEndDays   = Math.max(Math.round(svgX / px) - 1, origStartDays);
      newStartDays = origStartDays;
    }

    const newStart = format(addDays(viewStart, newStartDays), "yyyy-MM-dd");
    const newEnd   = format(addDays(viewStart, newEndDays),   "yyyy-MM-dd");
    ds.currentStart = newStart;
    ds.currentEnd   = newEnd;

    // Drop indicator: always shown when cursor is in a valid row during a move drag.
    // Cursor Y → lane index. If that lane has an overlapping task, also track
    // above/below for rowOrder resolution.
    if (ds.type === "move") {
      const c = containerRef.current;
      const rowBaseY = rowYMapRef.current.get(ds.currentRowId) ?? HEADER_HEIGHT;
      const svgY = c ? clientY - c.getBoundingClientRect().top + c.scrollTop : 0;
      const relY = Math.max(0, svgY - rowBaseY);
      const totalLanes = rowLaneCountRef.current.get(ds.currentRowId) ?? 1;
      const cursorLane = Math.min(Math.floor(relY / ROW_HEIGHT), totalLanes - 1);

      const allTasks = tasksRef.current;
      const slm = subLaneMapRef.current;
      // Tasks in the cursor's lane that overlap the dragged task's date range
      const overlappingInLane = allTasks.filter(
        (t) => t.id !== ds.taskId &&
               t.rowId === ds.currentRowId &&
               (slm.get(t.id) ?? 0) === cursorLane &&
               newStart <= t.end && newEnd >= t.start
      );

      // Snap line: show near lane boundaries regardless of overlap
      const SNAP_ZONE = 5;
      const withinLaneY = relY - cursorLane * ROW_HEIGHT;
      const snapPosition: "above" | "below" | undefined =
        withinLaneY < SNAP_ZONE ? "above" :
        withinLaneY > ROW_HEIGHT - SNAP_ZONE ? "below" :
        undefined;

      let indicator: typeof dropIndicatorRef.current;
      if (overlappingInLane.length > 0) {
        // Pick closest overlapping task for rowOrder resolution on drop
        let target = overlappingInLane[0];
        let minDist = Infinity;
        for (const t of overlappingInLane) {
          const dist = Math.abs(relY - (cursorLane * ROW_HEIGHT + ROW_HEIGHT / 2));
          if (dist < minDist) { minDist = dist; target = t; }
        }
        // snapPosition is undefined in the middle dead zone → swap on drop
        indicator = { rowId: ds.currentRowId, lane: cursorLane, targetTaskId: target.id, position: snapPosition };
      } else {
        // No overlap — snap line shows only near lane boundaries
        indicator = { rowId: ds.currentRowId, lane: cursorLane, position: snapPosition };
      }
      dropIndicatorRef.current = indicator;
      setDropIndicator(indicator);
      setDragOverride({ taskId: ds.taskId, start: newStart, end: newEnd, rowId: ds.currentRowId, previewLane: cursorLane });
    } else {
      // For resize drags, keep the task in its current lane
      const currentLane = subLaneMapRef.current.get(ds.taskId) ?? 0;
      setDragOverride({ taskId: ds.taskId, start: newStart, end: newEnd, rowId: ds.currentRowId, previewLane: currentLane });
    }
  }

  // Auto-scroll: RAF loop — scrolls when cursor is near the horizontal edge.
  const startAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current !== null) return;
    const AUTO_ZONE  = 60;
    const AUTO_SPEED = 10;

    function tick() {
      const c = containerRef.current;
      if (!c || !dragStateRef.current) { autoScrollRafRef.current = null; return; }

      const rect = c.getBoundingClientRect();
      const cx   = dragClientXRef.current;
      const fromLeft  = cx - rect.left;
      const fromRight = rect.right - cx;

      let delta = 0;
      if (fromLeft  > 0 && fromLeft  < AUTO_ZONE) delta = -AUTO_SPEED * (1 - fromLeft  / AUTO_ZONE);
      if (fromRight > 0 && fromRight < AUTO_ZONE) delta =  AUTO_SPEED * (1 - fromRight / AUTO_ZONE);

      if (delta !== 0) {
        c.scrollLeft += delta;
        applyDragPosition(getSvgX(dragClientXRef.current), dragClientYRef.current);
      }

      autoScrollRafRef.current = requestAnimationFrame(tick);
    }
    autoScrollRafRef.current = requestAnimationFrame(tick);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopAutoScrollLoop = useCallback(() => {
    if (autoScrollRafRef.current !== null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  // Document-level mousemove
  const handleDocMouseMove = useCallback((e: MouseEvent) => {
    const ds = dragStateRef.current;
    if (!ds) return;

    dragClientXRef.current = e.clientX;
    dragClientYRef.current = e.clientY;

    if (!ds.hasMoved && Math.hypot(e.clientX - ds.initialClientX, e.clientY - ds.initialClientY) < 6) return;
    ds.hasMoved = true;

    applyDragPosition(getSvgX(e.clientX), e.clientY);

    const c = containerRef.current;
    if (c) c.style.cursor = ds.type === "move" ? "grabbing" : "ew-resize";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Document-level mouseup — commits or discards
  const handleDocMouseUp = useCallback(() => {
    const ds = dragStateRef.current;
    if (ds?.hasMoved) {
      justDraggedRef.current = true;

      // Base updates applied in every committed move/resize
      const baseUpdates: Parameters<typeof updateTaskRef.current>[1] = {
        start: ds.currentStart,
        end:   ds.currentEnd,
      };
      if (ds.type === "move" && ds.currentRowId !== ds.origRowId) {
        baseUpdates.rowId = ds.currentRowId;
      }

      const indicator = dropIndicatorRef.current;

      if (ds.type === "move" && indicator?.position) {
        // ── SNAP DROP: white line was showing → insert a new lane at the boundary
        // "above" snap line = boundary is at the TOP of indicator.lane
        //   → new lane inserted at indicator.lane  (shifts existing lanes ≥ that index down)
        // "below" snap line = boundary is at the BOTTOM of indicator.lane
        //   → new lane inserted at indicator.lane + 1
        const insertLane = indicator.position === "above"
          ? indicator.lane
          : indicator.lane + 1;
        const targetRowId = ds.currentRowId;

        // Build batch: shift every other task in the row whose lane ≥ insertLane
        const batch: Array<{ taskId: string; changes: Parameters<typeof updateTaskRef.current>[1] }> = [];
        for (const t of tasksRef.current) {
          if (t.id === ds.taskId || t.rowId !== targetRowId) continue;
          if ((t.lane ?? 0) >= insertLane) {
            batch.push({ taskId: t.id, changes: { lane: (t.lane ?? 0) + 1 } });
          }
        }
        // Include the dragged task (new lane + date/row updates)
        batch.push({ taskId: ds.taskId, changes: { ...baseUpdates, lane: insertLane } });

        // Commit all lane shifts + row laneCount atomically
        const currentEffectiveLanes = rowLaneCountRef.current.get(targetRowId) ?? 1;
        batchUpdateTasksRef.current(batch, { rowId: targetRowId, laneCount: currentEffectiveLanes + 1 });

      } else if (ds.type === "move" && indicator?.targetTaskId && !indicator.position) {
        // ── SWAP DROP: cursor in the dead zone (middle of lane) over another task
        // Each task takes the other's current visual lane.
        const slm = subLaneMapRef.current;
        const draggedOriginalLane = slm.get(ds.taskId) ?? 0;
        const targetCurrentLane   = slm.get(indicator.targetTaskId) ?? 0;
        // Swap start positions; each task keeps its own duration.
        // batchUpdateTasks handles milestone coercion (end = start) automatically.
        const targetTask = tasksRef.current.find((t) => t.id === indicator.targetTaskId);
        if (targetTask) {
          const draggedDuration = differenceInDays(parseISO(ds.origEnd),      parseISO(ds.origStart));
          const targetDuration  = differenceInDays(parseISO(targetTask.end),  parseISO(targetTask.start));
          batchUpdateTasksRef.current([
            { taskId: ds.taskId, changes: {
                start: targetTask.start,
                end:   format(addDays(parseISO(targetTask.start), draggedDuration), "yyyy-MM-dd"),
                rowId: ds.currentRowId, lane: targetCurrentLane,
            }},
            { taskId: indicator.targetTaskId, changes: {
                start: ds.origStart,
                end:   format(addDays(parseISO(ds.origStart), targetDuration), "yyyy-MM-dd"),
                rowId: ds.origRowId, lane: draggedOriginalLane,
            }},
          ]);
        }

      } else if (ds.type === "move" && indicator) {
        // ── NORMAL DROP: cursor in an empty lane or middle of lane with no task
        baseUpdates.lane = indicator.lane;
        updateTaskRef.current(ds.taskId, baseUpdates);

      } else {
        // ── RESIZE or move with no indicator (shouldn't normally happen) ──
        updateTaskRef.current(ds.taskId, baseUpdates);
      }
    }

    dragStateRef.current = null;
    setDragOverride(null);
    setDropIndicator(null);
    dropIndicatorRef.current = null;
    stopAutoScrollLoop();
    const c = containerRef.current;
    if (c) { c.style.cursor = ""; c.style.userSelect = ""; }
    document.removeEventListener("mousemove", handleDocMouseMove);
    document.removeEventListener("mouseup", handleDocMouseUp);
  }, [stopAutoScrollLoop]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup if component unmounts mid-drag
  useEffect(() => {
    return () => {
      stopAutoScrollLoop();
      document.removeEventListener("mousemove", handleDocMouseMove);
      document.removeEventListener("mouseup", handleDocMouseUp);
    };
  }, [handleDocMouseMove, handleDocMouseUp, stopAutoScrollLoop]);

  function handleBarMouseDown(
    e: React.MouseEvent,
    task: Task,
    dragType: "move" | "resizeLeft" | "resizeRight"
  ) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const c = containerRef.current;
    if (!c) return;
    c.style.userSelect = "none";

    const { viewStart, zoom } = scrollStateRef.current;
    const px             = pxPerDay(zoom);
    const svgX           = getSvgX(e.clientX);
    const taskStartDays  = differenceInDays(parseISO(task.start), viewStart);
    const cursorDayOffset = svgX / px - taskStartDays;
    const duration        = differenceInDays(parseISO(task.end), parseISO(task.start));

    dragClientXRef.current = e.clientX;
    dragClientYRef.current = e.clientY;
    dragStateRef.current = {
      type: dragType,
      taskId: task.id,
      origStart: task.start,
      origEnd:   task.end,
      origRowId: task.rowId,
      cursorDayOffset,
      duration,
      initialClientX: e.clientX,
      initialClientY: e.clientY,
      hasMoved: false,
      currentStart: task.start,
      currentEnd:   task.end,
      currentRowId: task.rowId,
    };
    document.addEventListener("mousemove", handleDocMouseMove);
    document.addEventListener("mouseup",   handleDocMouseUp);
    startAutoScrollLoop();
  }

  // ---------------------------------------------------------------------------
  // Canvas click — create task on empty space
  // ---------------------------------------------------------------------------
  async function handleCanvasClick(e: React.MouseEvent) {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    const c = containerRef.current;
    if (!c) return;
    const svgY = e.clientY - c.getBoundingClientRect().top + c.scrollTop;
    if (svgY < HEADER_HEIGHT) return; // click in date axis header
    const hit = getLaneAtClientY(e.clientY);
    if (!hit) return;
    const { rowId, lane } = hit;
    const svgX = getSvgX(e.clientX);
    const { viewStart, viewEnd, canvasWidth } = scrollStateRef.current;
    const clickedDate = xToDate(svgX, viewStart, viewEnd, canvasWidth);
    const start = format(startOfDay(clickedDate), "yyyy-MM-dd");
    const end = format(addDays(parseISO(start), 6), "yyyy-MM-dd");
    const task = await createTask({ title: "", rowId, start, end, lane });
    setPanel({ type: "task", taskId: task.id });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onContextMenu={handleContainerContextMenu}
      onClick={handleCanvasClick}
      className="relative flex-1 overflow-auto bg-[var(--color-bg-base)]"
      style={{ minWidth: 0 }}
    >
      <svg width={canvasWidth} height={svgHeight} style={{ display: "block" }}>

        {/* ── Clip paths for task bar text ──────────────────────────────── */}
        <defs>
          {tasks.map((task) => {
            const isBeingDragged = dragOverride?.taskId === task.id;
            const effRowId = isBeingDragged ? dragOverride!.rowId : task.rowId;
            const rowY = rowYMap.get(effRowId);
            if (rowY === undefined) return null;
            const subLane = isBeingDragged
              ? dragOverride!.previewLane
              : (subLaneMap.get(task.id) ?? 0);
            const effStart = isBeingDragged ? dragOverride!.start : task.start;
            const effEnd   = isBeingDragged ? dragOverride!.end   : task.end;
            const taskStart = parseISO(effStart);
            const taskEnd   = addDays(parseISO(effEnd), 1);
            if (!isBeingDragged && (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart))) return null;
            const x    = dateToX(parseISO(effStart),               viewStart, viewEnd, canvasWidth);
            const xEnd = dateToX(addDays(parseISO(effEnd), 1), viewStart, viewEnd, canvasWidth);
            const w = xEnd - x;
            const barY = rowY + subLane * ROW_HEIGHT + BAR_PAD_Y;
            return (
              <clipPath key={task.id} id={`clip-${task.id}`}>
                <rect
                  x={x + 6}
                  y={barY}
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
            width={col.width} height={gridHeight - HEADER_HEIGHT}
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
                width={pxPerDay("weeks")} height={gridHeight - HEADER_HEIGHT}
                fill={isWeekend ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.03)"}
              />
            );
          })
        )}
        {zoom === "months" && monthZoomWeekStarts.map((ws, i) => (
          <rect
            key={`colbg-${ws.date.toISOString()}`}
            x={ws.x} y={HEADER_HEIGHT}
            width={7 * pxPerDay("months")} height={gridHeight - HEADER_HEIGHT}
            fill={i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.18)"}
          />
        ))}

        {/* ── Row bands ────────────────────────────────────────────────── */}
        {sortedRows.map((row) => {
          const y = rowYMap.get(row.id)!;
          const rowHeight = (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT;
          return (
            <g key={row.id}>
              <line
                x1={0} y1={y + rowHeight}
                x2={canvasWidth} y2={y + rowHeight}
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
            x2={col.x} y2={gridHeight}
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
              x2={col.x + offset * pxPerDay("weeks")} y2={gridHeight}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))
        )}
        {zoom === "months" && monthZoomWeekStarts.map((ws) => (
          <line
            key={`wksep-${ws.date.toISOString()}`}
            x1={ws.x} y1={HEADER_HEIGHT}
            x2={ws.x} y2={gridHeight}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth={1}
          />
        ))}
        {zoom === "months" && columns.flatMap((col) =>
          Array.from({ length: getDaysInMonth(col.date) - 1 }, (_, i) => (
            <line
              key={`daysub-${col.key}-${i + 1}`}
              x1={col.x + (i + 1) * pxPerDay("months")} y1={HEADER_HEIGHT}
              x2={col.x + (i + 1) * pxPerDay("months")} y2={gridHeight}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
          ))
        )}

        {/* ── Today line ───────────────────────────────────────────────── */}
        {todayVisible && (
          <line
            x1={todayX} y1={HEADER_HEIGHT}
            x2={todayX} y2={gridHeight}
            stroke="#f87171"
            strokeWidth={1.5}
          />
        )}

        {/* ── Task bars ────────────────────────────────────────────────── */}
        {tasks.map((task) => {
          // Use drag-override row/dates when this task is being dragged
          const isBeingDragged = dragOverride?.taskId === task.id;
          const effRowId = isBeingDragged ? dragOverride!.rowId : task.rowId;
          const rowY = rowYMap.get(effRowId);
          if (rowY === undefined) return null;

          // Sub-lane: use previewLane when dragging so the bar tracks the cursor lane
          const subLane = isBeingDragged
            ? dragOverride!.previewLane
            : (subLaneMap.get(task.id) ?? 0);

          const effStart = isBeingDragged ? dragOverride!.start : task.start;
          const effEnd   = isBeingDragged ? dragOverride!.end   : task.end;

          const taskStart = parseISO(effStart);
          const taskEnd   = addDays(parseISO(effEnd), 1);
          // Always render the dragged task even if it leaves the render window
          if (!isBeingDragged && (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart))) return null;

          const x    = dateToX(parseISO(effStart),               viewStart, viewEnd, canvasWidth);
          const xEnd = dateToX(addDays(parseISO(effEnd), 1), viewStart, viewEnd, canvasWidth);
          const w = Math.max(xEnd - x, 2);
          const barY = rowY + subLane * ROW_HEIGHT + BAR_PAD_Y;
          const barCenterY = barY + BAR_HEIGHT / 2;
          const status = computeEffectiveStatus(task);
          const isDone = status === "done";
          const isOverdue = status === "overdue";

          // Shared click handler — skip if this mouseup followed a real drag
          function handleClick(e: React.MouseEvent) {
            e.stopPropagation();
            if (justDraggedRef.current) { justDraggedRef.current = false; return; }
            setPanel({ type: "task", taskId: task.id });
          }

          if (task.isMilestone) {
            const cx = x + w / 2;
            const r = MILESTONE_R;
            const isHovered = hoveredTaskId === task.id;

            const rawLabel = isDone ? `✓ ${task.title}` : task.title;
            const displayLabel = rawLabel.length > 20 ? rawLabel.slice(0, 20) + "…" : rawLabel;
            const labelX = cx + r + 6;
            const labelEndX = labelX + displayLabel.length * 8;

            const hasLabelSpace = !tasks.some((other) => {
              if (other.id === task.id || other.rowId !== task.rowId) return false;
              // Only check tasks in the same sub-lane — different lanes are at different Y positions
              if ((subLaneMap.get(other.id) ?? 0) !== subLane) return false;
              const oLeft  = dateToX(parseISO(other.start), viewStart, viewEnd, canvasWidth);
              const oRight = dateToX(addDays(parseISO(other.end), 1), viewStart, viewEnd, canvasWidth);
              return oLeft < labelEndX && oRight > labelX;
            });

            const diamondPoints = `${cx},${barCenterY - r} ${cx + r},${barCenterY} ${cx},${barCenterY + r} ${cx - r},${barCenterY}`;
            const milestoneStroke = isOverdue ? "#ef4444" : task.color;

            return (
              <g
                key={task.id}
                style={{ cursor: "grab" }}
                onClick={handleClick}
                onMouseDown={(e) => handleBarMouseDown(e, task, "move")}
                onMouseEnter={() => setHoveredTaskId(task.id)}
                onMouseLeave={() => setHoveredTaskId(null)}
              >
                <polygon
                  points={diamondPoints}
                  fill={isDone ? task.color : "transparent"}
                  stroke={milestoneStroke}
                  strokeWidth={2}
                />
                {isHovered && (
                  <polygon
                    points={diamondPoints}
                    fill="none"
                    stroke="rgba(255,255,255,0.4)"
                    strokeWidth={1.5}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {hasLabelSpace && (
                  <text
                    x={labelX}
                    y={barCenterY + 4}
                    fontSize={12}
                    fill="white"
                    fillOpacity={0.85}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {displayLabel}
                  </text>
                )}
              </g>
            );
          }

          const isHovered = hoveredTaskId === task.id;

          return (
            <g
              key={task.id}
              style={{ cursor: "grab" }}
              onClick={handleClick}
              onMouseDown={(e) => handleBarMouseDown(e, task, "move")}
              onMouseEnter={() => setHoveredTaskId(task.id)}
              onMouseLeave={() => setHoveredTaskId(null)}
            >
              <rect
                x={x}
                y={barY}
                width={w}
                height={BAR_HEIGHT}
                rx={4}
                fill={task.color}
                stroke={isOverdue ? "#ef4444" : "none"}
                strokeWidth={1.5}
              />
              {isDone && (
                <rect
                  x={x} y={barY} width={w} height={BAR_HEIGHT} rx={4}
                  fill="rgba(0,0,0,0.28)"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {isHovered && (
                <rect
                  x={x} y={barY} width={w} height={BAR_HEIGHT} rx={4}
                  fill="none"
                  stroke="rgba(255,255,255,0.35)"
                  strokeWidth={1.5}
                  style={{ pointerEvents: "none" }}
                />
              )}
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
              {/* Invisible edge strips for resize — only when bar is wide enough */}
              {w >= 16 && (
                <>
                  <rect
                    x={x} y={barY} width={HANDLE_W} height={BAR_HEIGHT}
                    fill="transparent"
                    style={{ cursor: "ew-resize" }}
                    onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, task, "resizeLeft"); }}
                  />
                  <rect
                    x={x + w - HANDLE_W} y={barY} width={HANDLE_W} height={BAR_HEIGHT}
                    fill="transparent"
                    style={{ cursor: "ew-resize" }}
                    onMouseDown={(e) => { e.stopPropagation(); handleBarMouseDown(e, task, "resizeRight"); }}
                  />
                </>
              )}
            </g>
          );
        })}

        {/* ── Drop indicator — lane highlight (above task bars, below header) */}
        {dropIndicator && (() => {
          const rY = rowYMap.get(dropIndicator.rowId);
          if (rY === undefined) return null;
          const laneY = rY + dropIndicator.lane * ROW_HEIGHT;
          const snapLineY = dropIndicator.position === "above"
            ? laneY
            : laneY + ROW_HEIGHT;
          return (
            <>
              {/* Accent lane rect — always visible during move drag */}
              <rect
                x={0} y={laneY}
                width={canvasWidth} height={ROW_HEIGHT}
                fill="var(--color-accent)"
                fillOpacity={0.18}
                stroke="var(--color-accent)"
                strokeWidth={1.5}
                style={{ pointerEvents: "none" }}
              />
              {/* Bright snap line — appears near lane boundaries */}
              {dropIndicator.position && (
                <line
                  x1={0} y1={snapLineY}
                  x2={canvasWidth} y2={snapLineY}
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={2.5}
                  style={{ pointerEvents: "none" }}
                />
              )}
            </>
          );
        })()}

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

      {/* ── Lane context menu ─────────────────────────────────────────────── */}
      {laneMenu && (() => {
        const isEmpty = laneMenu.tasksInLane.length === 0;
        // Position the menu, keeping it inside the viewport
        const menuW = 210;
        const left = Math.min(laneMenu.x, window.innerWidth - menuW - 8);
        const top  = laneMenu.y + 4;
        return (
          <div
            onMouseDown={(e) => e.stopPropagation()} // don't close on click inside
            style={{ position: "fixed", left, top, zIndex: 999, width: menuW }}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl"
          >
            {/* Header */}
            <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
              Lane {laneMenu.lane + 1}
            </div>
            <div className="mx-2 mb-1 border-t border-[var(--color-border)]" />

            {/* Add above */}
            <button
              onClick={handleLaneAddAbove}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 2v8M2 6h8" />
              </svg>
              Add lane above
            </button>

            {/* Add below */}
            <button
              onClick={handleLaneAddBelow}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M6 2v8M2 6h8" />
              </svg>
              Add lane below
            </button>

            <div className="mx-2 my-1 border-t border-[var(--color-border)]" />

            {/* Delete */}
            {isEmpty ? (
              <button
                onClick={handleLaneDelete}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M2 4h8M4.5 4V3h3v1M5 6v3M7 6v3M3 4l.5 5.5h5L9 4" />
                </svg>
                Delete lane
              </button>
            ) : (
              <div className="px-3 py-1.5">
                <div className="flex items-center gap-1.5 text-sm text-[var(--color-text-secondary)]">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <circle cx="6" cy="6" r="5" />
                    <path d="M6 4v3M6 8.5v.5" />
                  </svg>
                  Lane not empty
                </div>
                <div className="mt-1 space-y-0.5">
                  {laneMenu.tasksInLane.map((t) => (
                    <div key={t.id} className="truncate pl-4 text-xs text-[var(--color-text-secondary)]">
                      • {t.title}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
