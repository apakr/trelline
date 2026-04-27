import { useMemo, useRef, useEffect, useCallback, useState, useLayoutEffect } from "react";
import {
  addDays,
  addWeeks,
  addMonths,
  subDays,
  startOfWeek,
  startOfMonth,
  getDaysInMonth,
  differenceInDays,
  isBefore,
  isAfter,
  format,
  getDay,
  getWeek,
  parseISO,
  startOfDay,
} from "date-fns";
import type { Row, Task, ZoomLevel } from "../../types";
import { computeEffectiveStatus } from "../../types";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import { dateToX, xToDate, getInitialBounds, pxPerDay } from "../../lib/dateToX";
import { computeArrowPath, arrowMidpoint, wouldCreateCycle, ARROWHEAD_LEN } from "../../lib/depArrows";

// ---------------------------------------------------------------------------
// Layout constants — must match RowPanel.tsx
// ---------------------------------------------------------------------------
export const HEADER_HEIGHT = 52;
export const ROW_HEIGHT = 48;

const BAR_PAD_Y = 8;                        // vertical gap between bar and row edge
const BAR_HEIGHT = ROW_HEIGHT - BAR_PAD_Y * 2; // 32px
const MILESTONE_R = 13;                     // half-size of milestone diamond
const MAX_LABEL_OVERFLOW = 200;             // px a label may bleed past its task/milestone right edge
const LABEL_OVERFLOW_GAP = 16;             // px gap kept before the next task bar when clipping
const MIN_LABEL_WIDTH    = 24;             // px minimum available width before suppressing the label
const LABEL_CHAR_PX      = 7.5;           // approximate px-per-character at fontSize 12
const MIN_WRAP_WIDTH     = 80;            // px bar width threshold before attempting two-line title wrap

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
  renderEnd: Date,
  weekStartsOn: 0 | 1 | 6 = 1,
  scale = 1
): Column[] {
  const cols: Column[] = [];
  const px = pxPerDay(zoom, scale);

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
    // Start from the week that contains max(viewStart, renderStart)
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfWeek(anchor, { weekStartsOn });
    if (isBefore(d, viewStart)) d = startOfWeek(viewStart, { weekStartsOn });

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
  canvasScale?: number;                                // scale multiplier for pxPerDay (1.0 = 100%)
  searchHighlightTaskId?: string | null;               // task to highlight with marching ants (search confirm)
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
  canvasScale = 1,
  searchHighlightTaskId = null,
  scrollCenterDate,
  onScrollCenterDateChange,
  onCenterDateLive,
  onRegisterScrollToToday,
  onRegisterScrollToDate,
  onVerticalScroll,
}: TimelineCanvasProps) {
  const { setPanel, panel, updateTask, updateRow, batchUpdateTasks, createTask, insertLaneAndCreateTask, deleteTask, pushSnapshot, appConfig, setCanvasScale } = useLoadedWorkspace();
  const settings = appConfig.settings;
  const weekStartsOn: 0 | 1 | 6 = settings.weekStartDay === "saturday" ? 6 : settings.weekStartDay === "sunday" ? 0 : 1;
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
  const canvasWidth = totalDays * pxPerDay(zoom, canvasScale);

  // --- render window: only elements within this range exist in the DOM ---
  const BUFFER_DAYS = 180;
  const initialCenter = initialScrollCenterDateRef.current
    ? parseISO(initialScrollCenterDateRef.current)
    : today;
  const [renderStart, setRenderStart] = useState<Date>(() => subDays(initialCenter, BUFFER_DAYS));
  const [renderEnd,   setRenderEnd]   = useState<Date>(() => addDays(initialCenter, BUFFER_DAYS));

  // --- columns (filtered to render window) ---
  const columns = useMemo(
    () => buildColumns(viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd, weekStartsOn, canvasScale),
    [viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd, weekStartsOn, canvasScale]
  );

  // --- week start positions for months zoom header (filtered to render window) ---
  const monthZoomWeekStarts = useMemo(() => {
    if (zoom !== "months") return [];
    const result: Array<{ date: Date; x: number }> = [];
    const anchor = isBefore(viewStart, renderStart) ? renderStart : viewStart;
    let d = startOfWeek(anchor, { weekStartsOn });
    if (isBefore(d, viewStart)) d = startOfWeek(viewStart, { weekStartsOn });
    while (isBefore(d, viewEnd) && !isAfter(d, addDays(renderEnd, 7))) {
      result.push({ date: d, x: dateToX(d, viewStart, viewEnd, canvasWidth) });
      d = addWeeks(d, 1);
    }
    return result;
  }, [viewStart, viewEnd, canvasWidth, zoom, renderStart, renderEnd, weekStartsOn]);

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
  const todayX = dateToX(today, viewStart, viewEnd, canvasWidth) + pxPerDay(zoom, canvasScale) / 2;
  const todayVisible = todayX >= 0 && todayX <= canvasWidth;

  // --- row Y positions (variable height — collapsed rows use 1 lane height) ---
  const rowYMap = useMemo(() => {
    const map = new Map<string, number>();
    let y = HEADER_HEIGHT;
    for (const row of sortedRows) {
      map.set(row.id, y);
      y += row.collapsed ? ROW_HEIGHT : (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT;
    }
    return map;
  }, [sortedRows, rowLaneCount]);

  const gridHeight = useMemo(() => {
    return sortedRows.reduce(
      (acc, row) => acc + (row.collapsed ? ROW_HEIGHT : (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT),
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
  const prevScaleRef          = useRef(canvasScale);
  const prevCanvasWidthRef    = useRef(canvasWidth);

  // Tracks the current viewport center date in real time.
  // Updated on every scroll, after scrollToToday, and after mount scroll.
  // Used by the zoom transition so it never has to read c.scrollLeft after a
  // re-render (by which point the browser may have already clamped it).
  const currentCenterDateRef = useRef<Date>(initialCenter);

  // Keep a ref with current values so the rAF callback never reads stale closures
  const scrollStateRef = useRef({ viewStart, viewEnd, canvasWidth, zoom, canvasScale, renderStart, renderEnd });
  scrollStateRef.current = { viewStart, viewEnd, canvasWidth, zoom, canvasScale, renderStart, renderEnd };

  // Invert scroll: when enabled, route vertical wheel delta to horizontal scroll.
  // Skip when Ctrl/Cmd is held — that's handled by the scale handler below.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !settings.invertScroll) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) return;
      if (e.deltaY !== 0 && e.deltaX === 0) {
        e.preventDefault();
        el!.scrollLeft += e.deltaY;
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [settings.invertScroll]);

  // Ctrl/Cmd+scroll anywhere on the canvas adjusts the canvas scale.
  // Uses refs so the handler never has a stale closure.
  const setCanvasScaleRef = useRef(setCanvasScale);
  setCanvasScaleRef.current = setCanvasScale;
  const canvasScaleAccRef = useRef(canvasScale);
  canvasScaleAccRef.current = canvasScale;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY > 0 ? -1 : 1;
      const nextPct = Math.round(canvasScaleAccRef.current * 100) + delta;
      const clamped = Math.max(50, Math.min(200, nextPct));
      const next = clamped / 100;
      canvasScaleAccRef.current = next;
      setCanvasScaleRef.current(next);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []); // stable refs — no deps needed

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

  // ---------------------------------------------------------------------------
  // Drag-to-create state
  // ---------------------------------------------------------------------------
  const dragCreateRef = useRef<{
    anchorClientX: number;
    anchorDate: string;
    rowId: string;
    lane: number;
    active: boolean;
  } | null>(null);
  const justDragCreatedRef  = useRef(false);
  const dragCreateCleanupRef = useRef<(() => void) | null>(null);
  const [dragCreatePreview, setDragCreatePreview] = useState<{
    start: string; end: string; rowId: string; lane: number;
  } | null>(null);
  const updateTaskRef          = useRef(updateTask);
  updateTaskRef.current        = updateTask;
  const batchUpdateTasksRef    = useRef(batchUpdateTasks);
  batchUpdateTasksRef.current  = batchUpdateTasks;
  const updateRowRef           = useRef(updateRow);
  updateRowRef.current         = updateRow;
  const pushSnapshotRef        = useRef(pushSnapshot);
  pushSnapshotRef.current      = pushSnapshot;
  const deleteTaskRef          = useRef(deleteTask);
  deleteTaskRef.current        = deleteTask;
  const createTaskRef          = useRef(createTask);
  createTaskRef.current        = createTask;
  const panelRef               = useRef(panel);
  panelRef.current             = panel;

  // ---------------------------------------------------------------------------
  // Marquee selection + group drag
  // ---------------------------------------------------------------------------

  // Set of selected task IDs (empty = no selection)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const selectedTaskIdsRef = useRef<Set<string>>(new Set());
  selectedTaskIdsRef.current = selectedTaskIds;

  // Pending multi-delete confirmation: holds the tasks that will be deleted
  const [deleteConfirm, setDeleteConfirm] = useState<Task[] | null>(null);

  // Right-click context menu on a task (or group of selected tasks)
  const [taskMenu, setTaskMenu] = useState<{
    x: number; y: number; tasks: Task[];
  } | null>(null);

  // The selection rectangle being drawn (SVG coordinate space)
  const [selectionRect, setSelectionRect] = useState<{
    x1: number; y1: number; x2: number; y2: number;
  } | null>(null);

  // Overridden positions for all tasks in the active group drag
  const [groupDragOverrides, setGroupDragOverrides] = useState<Map<
    string, { start: string; end: string; rowId: string; lane: number }
  > | null>(null);
  const groupDragOverridesRef = useRef(groupDragOverrides);
  groupDragOverridesRef.current = groupDragOverrides;

  // Mutable state for the in-progress group drag (read by document listeners)
  const groupDragRef = useRef<{
    anchorOrigRowId: string;
    anchorOrigLane: number;
    startClientX: number;
    startClientY: number;
    origPositions: Map<string, { start: string; end: string; rowId: string; lane: number }>;
    hasMoved: boolean;
  } | null>(null);

  // Set after marquee mouseup to suppress the synthetic click that follows
  const justDrewMarqueeRef = useRef(false);

  // Escape clears selection; Delete triggers confirm dialog
  useEffect(() => {
    if (selectedTaskIds.size === 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setSelectedTaskIds(new Set());
        setDeleteConfirm(null);
        return;
      }
      if (e.key === "Backspace") {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
        const toDelete = [...selectedTaskIdsRef.current]
          .map(id => tasksRef.current.find(t => t.id === id))
          .filter(Boolean) as Task[];
        if (toDelete.length > 0) setDeleteConfirm(toDelete);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedTaskIds]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Dependency drag state
  // ---------------------------------------------------------------------------
  const depDragRef = useRef<{
    sourceTaskId: string;
    dotSide: "right" | "left"; // "right" = source is predecessor, "left" = source is successor
  } | null>(null);
  const depDragSnapTargetRef = useRef<string | null>(null);
  const [isDepDragging, setIsDepDragging] = useState(false);
  const [depDragPreview, setDepDragPreview] = useState<{
    x2: number; y2: number;
    snapTargetId: string | null;
  } | null>(null);

  // Arrow hover + context menu
  const [hoveredArrowKey, setHoveredArrowKey] = useState<string | null>(null);
  const [arrowMenu, setArrowMenu] = useState<{
    x: number; y: number;
    predId: string; succId: string;
  } | null>(null);

  // Close arrow menu on outside click or Escape
  useEffect(() => {
    if (!arrowMenu) return;
    function handleOutside() { setArrowMenu(null); }
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); setArrowMenu(null); } }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [arrowMenu]);

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

  // Close menu on outside click or Escape
  useEffect(() => {
    if (!laneMenu) return;
    function handleOutside() { setLaneMenu(null); }
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); setLaneMenu(null); } }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [laneMenu]);

  // Close task menu on outside click or Escape
  useEffect(() => {
    if (!taskMenu) return;
    function handleOutside() { setTaskMenu(null); }
    function handleKeyDown(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); setTaskMenu(null); } }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [taskMenu]);

  // Escape closes the delete-confirm dialog regardless of selection state
  useEffect(() => {
    if (!deleteConfirm) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") { e.preventDefault(); setDeleteConfirm(null); } }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [deleteConfirm]);

  // Document-level contextmenu listener — handles right-clicks while a panel is
  // open (the backdrop sits at z-[9] above the canvas and blocks React onContextMenu
  // on SVG elements). When no panel is open the React onContextMenu handlers on
  // each task <g> fire directly and stop propagation, so this never double-fires.
  useEffect(() => {
    function onDocumentContextMenu(e: MouseEvent) {
      // Only needed when the backdrop is covering the canvas
      if (panelRef.current.type === "none") return;
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;
      if (dragStateRef.current?.hasMoved) return;
      e.preventDefault();

      // Find which task (if any) is under the cursor
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      let taskId: string | null = null;
      for (const el of els) {
        const found = (el as Element).closest?.('[data-task-id]');
        if (found) { taskId = found.getAttribute('data-task-id'); break; }
      }

      if (taskId !== null) {
        const task = tasksRef.current.find(t => t.id === taskId);
        if (!task) return;
        const sel = selectedTaskIdsRef.current;
        const targetTasks = sel.size > 0 && sel.has(task.id)
          ? ([...sel].map(id => tasksRef.current.find(t => t.id === id)).filter(Boolean) as Task[])
          : [task];
        setLaneMenu(null);
        setArrowMenu(null);
        setTaskMenu({ x: e.clientX, y: e.clientY, tasks: targetTasks });
      } else {
        const hit = getLaneAtClientY(e.clientY);
        if (!hit) return;
        const { rowId, lane } = hit;
        const tasksInLane = tasksRef.current.filter(
          t => t.rowId === rowId && (subLaneMapRef.current.get(t.id) ?? 0) === lane
        );
        setLaneMenu({ x: e.clientX, y: e.clientY, rowId, lane, tasksInLane });
      }
    }
    document.addEventListener('contextmenu', onDocumentContextMenu);
    return () => document.removeEventListener('contextmenu', onDocumentContextMenu);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleTaskContextMenu(e: React.MouseEvent, task: Task) {
    e.preventDefault();
    e.stopPropagation(); // prevent lane menu from also opening
    if (dragStateRef.current?.hasMoved) return;
    const sel = selectedTaskIdsRef.current;
    const targetTasks =
      sel.size > 0 && sel.has(task.id)
        ? ([...sel].map(id => tasksRef.current.find(t => t.id === id)).filter(Boolean) as Task[])
        : [task];
    setLaneMenu(null);
    setArrowMenu(null);
    setTaskMenu({ x: e.clientX, y: e.clientY, tasks: targetTasks });
  }

  async function handleDuplicate(tasksToDup: Task[], withDeps: boolean) {
    setTaskMenu(null);
    for (const orig of tasksToDup) {
      const created = await createTaskRef.current({
        title: orig.title,
        rowId: orig.rowId,
        start: orig.start,
        end: orig.end,
        isMilestone: orig.isMilestone,
        color: orig.color,
        notes: orig.notes,
        lane: orig.lane,
      });
      if (withDeps && orig.dependencies.length > 0) {
        await updateTaskRef.current(created.id, { dependencies: orig.dependencies });
      }
    }
  }

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
  // Zoom / scale transition — preserve viewport center date when zoom or scale changes.
  //
  // Uses currentCenterDateRef (maintained by the scroll handler on every scroll)
  // instead of re-deriving from c.scrollLeft + prevCanvasWidthRef. The old approach
  // raced with the browser: when the canvas shrinks (e.g. days→weeks), the browser
  // clamps scrollLeft to the new max before useEffect fires, so the derived center date
  // was wrong. currentCenterDateRef is set in a rAF callback, which runs AFTER
  // useLayoutEffect, so it still holds the pre-change center date here.
  //
  // useLayoutEffect (vs useEffect) applies the scroll correction before paint,
  // eliminating the visible flash of the wrong scroll position.
  // ---------------------------------------------------------------------------
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (prevZoomRef.current !== zoom || prevScaleRef.current !== canvasScale) {
      const centerDate = currentCenterDateRef.current;
      const newCenterX = dateToX(centerDate, viewStart, viewEnd, canvasWidth);
      c.scrollLeft = Math.max(0, newCenterX - c.clientWidth / 2);
      prevZoomRef.current = zoom;
      prevScaleRef.current = canvasScale;
    }
    prevCanvasWidthRef.current = canvasWidth;
  }, [zoom, canvasScale, viewStart, viewEnd, canvasWidth]);

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
    const todayXCenter = dateToX(today, viewStart, viewEnd, canvasWidth) + pxPerDay(zoom, canvasScale) / 2;
    c.scrollLeft = Math.max(0, todayXCenter - c.clientWidth / 2);
    onCenterDateLive?.(format(today, 'yyyy-MM-dd'));
  }, [viewStart, viewEnd, canvasWidth, zoom, canvasScale]); // eslint-disable-line react-hooks/exhaustive-deps

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

      const { viewStart, viewEnd, canvasWidth, zoom, canvasScale: sc, renderStart, renderEnd } = scrollStateRef.current;

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
        pendingScrollAdjRef.current += EXTEND_DAYS * pxPerDay(zoom, sc);
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
    const { viewStart, zoom, canvasScale: sc } = scrollStateRef.current;
    const px = pxPerDay(zoom, sc);
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
        pushSnapshotRef.current();
        updateTaskRef.current(ds.taskId, baseUpdates);

      } else {
        // ── RESIZE or move with no indicator (shouldn't normally happen) ──
        pushSnapshotRef.current();
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

  // Cleanup drag-to-create if component unmounts mid-drag
  useEffect(() => {
    return () => { dragCreateCleanupRef.current?.(); };
  }, []);

  function handleBarMouseDown(
    e: React.MouseEvent,
    task: Task,
    dragType: "move" | "resizeLeft" | "resizeRight"
  ) {
    // Middle mouse and Ctrl/Cmd+left both bubble up to handleCanvasMouseDown for marquee
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;

    // If this task is part of the active selection, start a group drag instead
    if (dragType === "move" && selectedTaskIdsRef.current.size > 0 && selectedTaskIdsRef.current.has(task.id)) {
      e.preventDefault();
      e.stopPropagation();
      startGroupDrag(e, task);
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    const c = containerRef.current;
    if (!c) return;
    c.style.userSelect = "none";

    const { viewStart, zoom, canvasScale: sc } = scrollStateRef.current;
    const px             = pxPerDay(zoom, sc);
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
  // Group drag — moves all selected tasks together
  // ---------------------------------------------------------------------------
  function startGroupDrag(e: React.MouseEvent, anchorTask: Task) {
    const c = containerRef.current;
    if (!c) return;
    c.style.userSelect = "none";
    c.style.cursor = "grabbing";

    const selectedIds = selectedTaskIdsRef.current;
    const origPositions = new Map(
      [...selectedIds].map(id => {
        const t = tasksRef.current.find(t => t.id === id)!;
        return [id, { start: t.start, end: t.end, rowId: t.rowId, lane: t.lane ?? 0 }];
      })
    );

    groupDragRef.current = {
      anchorOrigRowId: anchorTask.rowId,
      anchorOrigLane: anchorTask.lane ?? 0,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPositions,
      hasMoved: false,
    };

    function onMove(ev: MouseEvent) {
      const gd = groupDragRef.current;
      if (!gd) return;

      const dx = ev.clientX - gd.startClientX;
      const { zoom, canvasScale: sc } = scrollStateRef.current;
      const dayDelta = Math.round(dx / pxPerDay(zoom, sc));

      // Use getLaneAtClientY for accurate row + lane under cursor
      const hit = getLaneAtClientY(ev.clientY);
      const sr = sortedRowsRef.current;
      const anchorOrigIdx = sr.findIndex(r => r.id === gd.anchorOrigRowId);

      let rowDelta = 0;
      let laneDelta = 0;
      if (hit) {
        const currentRowIdx = sr.findIndex(r => r.id === hit.rowId);
        rowDelta = currentRowIdx - anchorOrigIdx;
        laneDelta = hit.lane - gd.anchorOrigLane;
      }

      if (dayDelta !== 0 || rowDelta !== 0 || laneDelta !== 0) gd.hasMoved = true;

      const overrides = new Map(
        [...gd.origPositions.entries()].map(([id, orig]) => {
          const origRowIdx = sr.findIndex(r => r.id === orig.rowId);
          const newRowIdx = Math.max(0, Math.min(sr.length - 1, origRowIdx + rowDelta));
          return [id, {
            start: format(addDays(parseISO(orig.start), dayDelta), "yyyy-MM-dd"),
            end:   format(addDays(parseISO(orig.end),   dayDelta), "yyyy-MM-dd"),
            rowId: sr[newRowIdx].id,
            lane:  Math.max(0, orig.lane + laneDelta),
          }];
        })
      );
      setGroupDragOverrides(overrides);
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);

      const gd = groupDragRef.current;
      groupDragRef.current = null;
      const cont = containerRef.current;
      if (cont) { cont.style.userSelect = ""; cont.style.cursor = ""; }

      const finalOverrides = groupDragOverridesRef.current;
      setGroupDragOverrides(null);

      if (!gd?.hasMoved || !finalOverrides) return;

      justDraggedRef.current = true;
      const updates = [...finalOverrides.entries()].map(([taskId, over]) => ({
        taskId,
        changes: { start: over.start, end: over.end, rowId: over.rowId, lane: over.lane },
      }));
      batchUpdateTasksRef.current(updates);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------------------
  // Marquee selection — Ctrl+left or middle mouse draws a selection rectangle
  // ---------------------------------------------------------------------------
  function startMarquee(e: React.MouseEvent | MouseEvent) {
    const c = containerRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const startX = e.clientX - rect.left + c.scrollLeft;
    const startY = e.clientY - rect.top  + c.scrollTop;
    let endX = startX;
    let endY = startY;

    setSelectionRect({ x1: startX, y1: startY, x2: startX, y2: startY });

    function onMove(ev: MouseEvent) {
      const cont = containerRef.current;
      if (!cont) return;
      const r = cont.getBoundingClientRect();
      endX = ev.clientX - r.left + cont.scrollLeft;
      endY = ev.clientY - r.top  + cont.scrollTop;
      setSelectionRect({ x1: startX, y1: startY, x2: endX, y2: endY });
    }

    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSelectionRect(null);

      // Only suppress the synthetic click for tiny drags (essentially mis-clicks).
      // For real drags the browser doesn't fire click anyway, so don't set the flag —
      // leaving it set would eat the user's next deselect click.
      const totalMove = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
      justDrewMarqueeRef.current = totalMove < 4;

      const minX = Math.min(startX, endX);
      const maxX = Math.max(startX, endX);
      const minY = Math.min(startY, endY);
      const maxY = Math.max(startY, endY);

      // Require a minimum drag size to register as marquee (not a mis-click)
      if (maxX - minX < 4 && maxY - minY < 4) {
        setSelectedTaskIds(new Set());
        return;
      }

      const { viewStart: vs, viewEnd: ve, canvasWidth: cw } = scrollStateRef.current;
      const slm = subLaneMapRef.current;
      const rym = rowYMapRef.current;

      const hit = tasksRef.current
        .filter(task => {
          const subLane = slm.get(task.id) ?? 0;
          const rowY = rym.get(task.rowId);
          if (rowY === undefined) return false;
          const tx  = dateToX(parseISO(task.start), vs, ve, cw);
          const txEnd = dateToX(addDays(parseISO(task.end), 1), vs, ve, cw);
          const tw  = Math.max(txEnd - tx, 2);
          const ty  = rowY + subLane * ROW_HEIGHT + BAR_PAD_Y;
          return !(tx + tw < minX || tx > maxX || ty + BAR_HEIGHT < minY || ty > maxY);
        })
        .map(t => t.id);

      setSelectedTaskIds(new Set(hit));
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------------------
  // Canvas mousedown — start drag-to-create tracking
  // ---------------------------------------------------------------------------
  const DRAG_CREATE_THRESHOLD_PX = 5;

  function handleCanvasMouseDown(e: React.MouseEvent) {
    // Middle mouse or Ctrl/Cmd+left → start marquee selection
    if (e.button === 1 || (e.button === 0 && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      startMarquee(e);
      return;
    }
    if (e.button !== 0) return;
    const c = containerRef.current;
    if (!c) return;
    const svgY = e.clientY - c.getBoundingClientRect().top + c.scrollTop;
    if (svgY < HEADER_HEIGHT) return;
    const hit = getLaneAtClientY(e.clientY);
    if (!hit) return;

    // Clean up any stale drag-create from a missed mouseup
    dragCreateCleanupRef.current?.();

    const anchorDate = format(
      startOfDay(xToDate(getSvgX(e.clientX), scrollStateRef.current.viewStart, scrollStateRef.current.viewEnd, scrollStateRef.current.canvasWidth)),
      "yyyy-MM-dd"
    );
    dragCreateRef.current = { anchorClientX: e.clientX, anchorDate, rowId: hit.rowId, lane: hit.lane, active: false };
    c.style.userSelect = "none";
    c.style.cursor = "crosshair";

    function getDates(clientX: number, anchorDate: string): { start: string; end: string } {
      const cont = containerRef.current!;
      const cursorSvgX = clientX - cont.getBoundingClientRect().left + cont.scrollLeft;
      const { viewStart: vs, viewEnd: ve, canvasWidth: cw } = scrollStateRef.current;
      const cursorDay = format(startOfDay(xToDate(cursorSvgX, vs, ve, cw)), "yyyy-MM-dd");
      if (cursorDay <= anchorDate) {
        return { start: cursorDay, end: anchorDate };
      }
      return { start: anchorDate, end: cursorDay };
    }

    function hasConflict(rowId: string, start: string, end: string, lane: number): boolean {
      const slm = subLaneMapRef.current;
      return tasksRef.current.some(
        t => t.rowId === rowId && (slm.get(t.id) ?? 0) === lane && start <= t.end && end >= t.start
      );
    }

    function onMove(ev: MouseEvent) {
      const dc = dragCreateRef.current;
      if (!dc) return;
      if (Math.abs(ev.clientX - dc.anchorClientX) < DRAG_CREATE_THRESHOLD_PX) return;
      dc.active = true;
      const { start, end } = getDates(ev.clientX, dc.anchorDate);
      const lane = hasConflict(dc.rowId, start, end, dc.lane) ? dc.lane + 1 : dc.lane;
      setDragCreatePreview({ start, end, rowId: dc.rowId, lane });
    }

    async function onUp(ev: MouseEvent) {
      cleanup();
      const dc = dragCreateRef.current;
      dragCreateRef.current = null;
      setDragCreatePreview(null);
      if (!dc?.active) return; // plain click — let onClick handle it

      justDragCreatedRef.current = true;
      const { start, end } = getDates(ev.clientX, dc.anchorDate);
      const conflict = hasConflict(dc.rowId, start, end, dc.lane);
      const lane = conflict ? dc.lane + 1 : dc.lane;

      let task: Task;
      let insertedLane: { rowId: string; lane: number } | undefined;
      if (conflict) {
        // Atomically insert new lane + create task to avoid state overwrite
        task = await insertLaneAndCreateTask(dc.rowId, lane, { title: "", rowId: dc.rowId, start, end, lane });
        insertedLane = { rowId: dc.rowId, lane };
      } else {
        task = await createTask({ title: "", rowId: dc.rowId, start, end, lane });
      }
      setPanel({ type: "task", taskId: task.id, insertedLane });
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const cont = containerRef.current;
      if (cont) { cont.style.userSelect = ""; cont.style.cursor = ""; }
      dragCreateCleanupRef.current = null;
    }
    dragCreateCleanupRef.current = cleanup;
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------------------
  // Canvas click — create task on empty space
  // ---------------------------------------------------------------------------
  async function handleCanvasClick(e: React.MouseEvent) {
    if (justDraggedRef.current) { justDraggedRef.current = false; return; }
    if (justDragCreatedRef.current) { justDragCreatedRef.current = false; return; }
    if (justDrewMarqueeRef.current) { justDrewMarqueeRef.current = false; return; }
    // Click on empty canvas while tasks are selected → clear selection, don't create
    if (selectedTaskIdsRef.current.size > 0) {
      setSelectedTaskIds(new Set());
      return;
    }
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
  // Dependency helpers
  // ---------------------------------------------------------------------------

  async function handleDeleteDep(predId: string, succId: string) {
    const allTasks = tasksRef.current;
    const succTask = allTasks.find((t) => t.id === succId);
    if (!succTask) return;
    pushSnapshotRef.current();
    await updateTaskRef.current(succId, {
      dependencies: succTask.dependencies.filter((d) => d !== predId),
    });
    setHoveredArrowKey(null);
    setArrowMenu(null);
  }

  function handleDepDotMouseDown(
    e: React.MouseEvent,
    task: Task,
    dotSide: "right" | "left"
  ) {
    e.preventDefault();
    e.stopPropagation();
    if (depDragRef.current) return;

    depDragRef.current = { sourceTaskId: task.id, dotSide };
    depDragSnapTargetRef.current = null;
    setIsDepDragging(true);

    function onMove(ev: MouseEvent) {
      const c = containerRef.current;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const svgX = ev.clientX - rect.left + c.scrollLeft;
      const svgY = ev.clientY - rect.top + c.scrollTop;

      const { viewStart: vs, viewEnd: ve, canvasWidth: cw } = scrollStateRef.current;
      const SNAP_PX = 10; // fixed pixel tolerance around the target edge
      const allTasks = tasksRef.current;
      const dd = depDragRef.current!;

      let snapTargetId: string | null = null;
      for (const t of allTasks) {
        if (t.id === dd.sourceTaskId) continue;
        const rowY = rowYMapRef.current.get(t.rowId);
        if (rowY === undefined) continue;
        // Check cursor is within the specific task bar's lane (not the whole row band).
        // Using ROW_HEIGHT/2 = 24px from the bar's center Y so moving to an adjacent
        // lane or row immediately unsnaps.
        const taskSubLane = subLaneMapRef.current.get(t.id) ?? 0;
        const taskBarCenterY = rowY + taskSubLane * ROW_HEIGHT + BAR_PAD_Y + BAR_HEIGHT / 2;
        if (Math.abs(svgY - taskBarCenterY) > ROW_HEIGHT / 2) continue;

        // Target edge: left when source is pred (dragging from right dot),
        //              right when source is succ (dragging from left dot).
        const edgeX =
          dd.dotSide === "right"
            ? dateToX(parseISO(t.start), vs, ve, cw)
            : dateToX(addDays(parseISO(t.end), 1), vs, ve, cw);

        if (Math.abs(svgX - edgeX) > SNAP_PX) continue;

        const predId = dd.dotSide === "right" ? dd.sourceTaskId : t.id;
        const succId = dd.dotSide === "right" ? t.id : dd.sourceTaskId;
        const succTask = allTasks.find((tt) => tt.id === succId);
        if (!succTask) continue;
        if (succTask.dependencies.includes(predId)) continue;
        if (wouldCreateCycle(allTasks, predId, succId)) continue;

        snapTargetId = t.id;
        break;
      }

      depDragSnapTargetRef.current = snapTargetId;
      setDepDragPreview({ x2: svgX, y2: svgY, snapTargetId });
    }

    async function onUp(_ev: MouseEvent) {
      const snapTargetId = depDragSnapTargetRef.current;
      const dd = depDragRef.current;
      cleanup();
      if (!dd || !snapTargetId) return;

      const predId = dd.dotSide === "right" ? dd.sourceTaskId : snapTargetId;
      const succId = dd.dotSide === "right" ? snapTargetId : dd.sourceTaskId;
      const allTasks = tasksRef.current;
      const succTask = allTasks.find((t) => t.id === succId);
      if (!succTask) return;
      if (succTask.dependencies.includes(predId)) return;
      if (wouldCreateCycle(allTasks, predId, succId)) return;

      pushSnapshotRef.current();
      await updateTaskRef.current(succId, {
        dependencies: [...succTask.dependencies, predId],
      });
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      depDragRef.current = null;
      depDragSnapTargetRef.current = null;
      setIsDepDragging(false);
      setDepDragPreview(null);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      onContextMenu={handleContainerContextMenu}
      onMouseDown={handleCanvasMouseDown}
      onClick={handleCanvasClick}
      className="relative flex-1 overflow-auto bg-[var(--color-bg-base)]"
      style={{ minWidth: 0 }}
    >
      <svg width={canvasWidth} height={svgHeight} style={{ display: "block" }}>

        {/* ── Clip paths for task bar text ──────────────────────────────── */}
        <defs>
          {tasks.map((task) => {
            const isBeingDragged = dragOverride?.taskId === task.id;
            const groupOver = groupDragOverrides?.get(task.id);
            const isGroupDragged = !!groupOver;
            const effRowId = isBeingDragged ? dragOverride!.rowId : (groupOver?.rowId ?? task.rowId);
            const rowY = rowYMap.get(effRowId);
            if (rowY === undefined) return null;
            const subLane = isBeingDragged
              ? dragOverride!.previewLane
              : isGroupDragged
                ? groupOver!.lane
                : (subLaneMap.get(task.id) ?? 0);
            const effStart = isBeingDragged ? dragOverride!.start : (groupOver?.start ?? task.start);
            const effEnd   = isBeingDragged ? dragOverride!.end   : (groupOver?.end   ?? task.end);
            const taskStart = parseISO(effStart);
            const taskEnd   = addDays(parseISO(effEnd), 1);
            if (!isBeingDragged && !isGroupDragged && (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart))) return null;
            const x    = dateToX(parseISO(effStart),               viewStart, viewEnd, canvasWidth);
            const xEnd = dateToX(addDays(parseISO(effEnd), 1), viewStart, viewEnd, canvasWidth);
            const w = xEnd - x;
            const barY = rowY + subLane * ROW_HEIGHT + BAR_PAD_Y;

            if (task.isMilestone) {
              // Milestone label sits to the right of the diamond.
              const cx = x + w / 2;
              const labelTextX = cx + MILESTONE_R + 6;
              let labelRight = labelTextX + MAX_LABEL_OVERFLOW;
              for (const other of tasks) {
                if (other.id === task.id || other.rowId !== effRowId) continue;
                if ((subLaneMap.get(other.id) ?? 0) !== subLane) continue;
                const otherLeft = dateToX(parseISO(other.start), viewStart, viewEnd, canvasWidth);
                if (otherLeft > cx && otherLeft < labelRight) {
                  labelRight = otherLeft - LABEL_OVERFLOW_GAP;
                }
              }
              return (
                <clipPath key={task.id} id={`clip-${task.id}`}>
                  <rect
                    x={labelTextX}
                    y={barY}
                    width={Math.max(labelRight - labelTextX, 0)}
                    height={BAR_HEIGHT}
                  />
                </clipPath>
              );
            }

            // Regular task: label starts inside the bar and may bleed right.
            // labelRight begins at the bar's right edge + MAX_LABEL_OVERFLOW so that text
            // which fits within the bar is never truncated.
            let labelRight = xEnd + MAX_LABEL_OVERFLOW;
            for (const other of tasks) {
              if (other.id === task.id || other.rowId !== effRowId) continue;
              if ((subLaneMap.get(other.id) ?? 0) !== subLane) continue;
              const otherLeft = dateToX(parseISO(other.start), viewStart, viewEnd, canvasWidth);
              // Use >= so immediately-adjacent tasks (otherLeft === xEnd) are caught
              if (otherLeft >= xEnd && otherLeft < labelRight) {
                labelRight = otherLeft - LABEL_OVERFLOW_GAP;
              }
            }
            return (
              <clipPath key={task.id} id={`clip-${task.id}`}>
                <rect
                  x={x + 4}
                  y={barY}
                  width={Math.max(labelRight - (x + 4), 0)}
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
                x={col.x + offset * pxPerDay("weeks", canvasScale)} y={HEADER_HEIGHT}
                width={pxPerDay("weeks", canvasScale)} height={gridHeight - HEADER_HEIGHT}
                fill={isWeekend ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.03)"}
              />
            );
          })
        )}
        {zoom === "months" && monthZoomWeekStarts.map((ws, i) => (
          <rect
            key={`colbg-${ws.date.toISOString()}`}
            x={ws.x} y={HEADER_HEIGHT}
            width={7 * pxPerDay("months", canvasScale)} height={gridHeight - HEADER_HEIGHT}
            fill={i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.18)"}
          />
        ))}

        {/* ── Row bands ────────────────────────────────────────────────── */}
        {sortedRows.map((row) => {
          const y = rowYMap.get(row.id)!;
          const rowHeight = row.collapsed ? ROW_HEIGHT : (rowLaneCount.get(row.id) ?? 1) * ROW_HEIGHT;
          return (
            <g key={row.id}>
              {/* Collapsed fill — subtle tint over the collapsed row band */}
              {row.collapsed && (
                <rect
                  x={0} y={y} width={canvasWidth} height={ROW_HEIGHT}
                  fill="rgba(255,255,255,0.07)"
                  style={{ pointerEvents: "none" }}
                />
              )}
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
              x1={col.x + offset * pxPerDay("weeks", canvasScale)} y1={HEADER_HEIGHT}
              x2={col.x + offset * pxPerDay("weeks", canvasScale)} y2={gridHeight}
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
              x1={col.x + (i + 1) * pxPerDay("months", canvasScale)} y1={HEADER_HEIGHT}
              x2={col.x + (i + 1) * pxPerDay("months", canvasScale)} y2={gridHeight}
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

        {/* ── Marquee selection rectangle ──────────────────────────────── */}
        {selectionRect && (() => {
          const rx = Math.min(selectionRect.x1, selectionRect.x2);
          const ry = Math.min(selectionRect.y1, selectionRect.y2);
          const rw = Math.abs(selectionRect.x2 - selectionRect.x1);
          const rh = Math.abs(selectionRect.y2 - selectionRect.y1);
          return (
            <rect
              x={rx} y={ry} width={rw} height={rh}
              fill="rgba(124,106,247,0.08)"
              stroke="rgba(124,106,247,0.7)"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}

        {/* ── Dependency arrows (below task bars) ──────────────────────── */}
        {tasks.flatMap((succTask) =>
          succTask.dependencies.map((predId) => {
            const predTask = tasks.find((t) => t.id === predId);
            if (!predTask) return null;

            // Use dragOverride or groupDragOverrides for whichever endpoint is being dragged
            const predDrag  = dragOverride?.taskId === predTask.id ? dragOverride : null;
            const succDrag  = dragOverride?.taskId === succTask.id ? dragOverride : null;
            const predGroup = groupDragOverrides?.get(predTask.id);
            const succGroup = groupDragOverrides?.get(succTask.id);

            const predEffEnd   = predDrag ? predDrag.end   : (predGroup?.end   ?? predTask.end);
            const predEffRowId = predDrag ? predDrag.rowId : (predGroup?.rowId ?? predTask.rowId);
            const predEffLane  = predDrag ? predDrag.previewLane : (predGroup?.lane ?? subLaneMap.get(predTask.id) ?? 0);

            const succEffStart = succDrag ? succDrag.start : (succGroup?.start ?? succTask.start);
            const succEffRowId = succDrag ? succDrag.rowId : (succGroup?.rowId ?? succTask.rowId);
            const succEffLane  = succDrag ? succDrag.previewLane : (succGroup?.lane ?? subLaneMap.get(succTask.id) ?? 0);

            // Hide arrows where either endpoint row is collapsed
            const predRow = sortedRows.find((r) => r.id === predEffRowId);
            const succRow = sortedRows.find((r) => r.id === succEffRowId);
            if (predRow?.collapsed || succRow?.collapsed) return null;

            const predRowY = rowYMap.get(predEffRowId);
            const succRowY = rowYMap.get(succEffRowId);
            if (predRowY === undefined || succRowY === undefined) return null;

            const x1 = dateToX(addDays(parseISO(predEffEnd), 1), viewStart, viewEnd, canvasWidth);
            const y1 = predRowY + predEffLane * ROW_HEIGHT + BAR_PAD_Y + BAR_HEIGHT / 2;
            const x2 = dateToX(parseISO(succEffStart), viewStart, viewEnd, canvasWidth);
            const y2 = succRowY + succEffLane * ROW_HEIGHT + BAR_PAD_Y + BAR_HEIGHT / 2;

            const arrowKey = `${predId}->${succTask.id}`;
            const isHovered = hoveredArrowKey === arrowKey;
            const AH = ARROWHEAD_LEN;

            // Path ends at x2-AH (arrowhead base) so the triangle caps it cleanly
            const d   = computeArrowPath(x1, y1, x2 - AH, y2);
            const mid = arrowMidpoint(x1, y1, x2, y2);
            const arrowColor = isHovered ? "var(--color-accent)" : "rgba(255,255,255,0.4)";

            return (
              <g key={arrowKey}>
                {/* Wide invisible hit strip for hover / context menu */}
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHoveredArrowKey(arrowKey)}
                  onMouseLeave={() => setHoveredArrowKey(null)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setArrowMenu({ x: e.clientX, y: e.clientY, predId, succId: succTask.id });
                  }}
                />
                {/* Visible arrow line */}
                <path
                  d={d}
                  fill="none"
                  stroke={arrowColor}
                  strokeWidth={isHovered ? 2 : 1.5}
                  style={{ pointerEvents: "none" }}
                />
                {/* Arrowhead (always points right into successor's left edge) */}
                <polygon
                  points={`${x2},${y2} ${x2 - AH},${y2 - AH / 2} ${x2 - AH},${y2 + AH / 2}`}
                  fill={arrowColor}
                  style={{ pointerEvents: "none" }}
                />
                {/* × button at midpoint when hovered */}
                {isHovered && (
                  <g
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHoveredArrowKey(arrowKey)}
                    onMouseLeave={() => setHoveredArrowKey(null)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDep(predId, succTask.id);
                    }}
                  >
                    <circle
                      cx={mid.x} cy={mid.y} r={9}
                      fill="var(--color-bg-elevated)"
                      stroke="rgba(255,255,255,0.2)"
                      strokeWidth={1}
                    />
                    <path
                      d={`M ${mid.x - 3} ${mid.y - 3} L ${mid.x + 3} ${mid.y + 3} M ${mid.x + 3} ${mid.y - 3} L ${mid.x - 3} ${mid.y + 3}`}
                      stroke="rgba(255,255,255,0.65)"
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      style={{ pointerEvents: "none" }}
                    />
                  </g>
                )}
              </g>
            );
          })
        )}

        {/* ── Task bars ────────────────────────────────────────────────── */}
        {tasks.map((task) => {
          // Use drag-override row/dates when this task is being dragged
          const isBeingDragged = dragOverride?.taskId === task.id;
          const groupOver = groupDragOverrides?.get(task.id);
          const isGroupDragged = !!groupOver;
          const effRowId = isBeingDragged ? dragOverride!.rowId : (groupOver?.rowId ?? task.rowId);

          // Skip task bars for collapsed rows (unless actively being dragged)
          if (!isBeingDragged && !isGroupDragged) {
            const effRow = sortedRows.find((r) => r.id === effRowId);
            if (effRow?.collapsed) return null;
          }

          const rowY = rowYMap.get(effRowId);
          if (rowY === undefined) return null;

          // Sub-lane: use previewLane when single-dragging, groupOver.lane when group-dragging
          const subLane = isBeingDragged
            ? dragOverride!.previewLane
            : isGroupDragged
              ? groupOver!.lane
              : (subLaneMap.get(task.id) ?? 0);

          const effStart = isBeingDragged ? dragOverride!.start : (groupOver?.start ?? task.start);
          const effEnd   = isBeingDragged ? dragOverride!.end   : (groupOver?.end   ?? task.end);

          const taskStart = parseISO(effStart);
          const taskEnd   = addDays(parseISO(effEnd), 1);
          // Always render dragged tasks (single or group) even if they leave the render window
          if (!isBeingDragged && !isGroupDragged && (isAfter(taskStart, renderEnd) || isBefore(taskEnd, renderStart))) return null;

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
            // Clicking a selected task clears the selection (don't open panel)
            if (selectedTaskIdsRef.current.size > 0) {
              setSelectedTaskIds(new Set());
              return;
            }
            setPanel({ type: "task", taskId: task.id });
          }

          if (task.isMilestone) {
            const cx = x + w / 2;
            const r = MILESTONE_R;
            const isHovered = hoveredTaskId === task.id;

            const rawLabel = isDone ? `✓ ${task.title}` : task.title;
            const labelX = cx + r + 6;
            // Mirror the clip-path overflow calculation to decide whether the label
            // has any usable space (same logic as the <defs> block above).
            let labelRight = labelX + MAX_LABEL_OVERFLOW;
            for (const other of tasks) {
              if (other.id === task.id || other.rowId !== task.rowId) continue;
              if ((subLaneMap.get(other.id) ?? 0) !== subLane) continue;
              const otherLeft = dateToX(parseISO(other.start), viewStart, viewEnd, canvasWidth);
              if (otherLeft > cx && otherLeft < labelRight) {
                labelRight = otherLeft - LABEL_OVERFLOW_GAP;
              }
            }
            const msLabelAvail = labelRight - labelX;
            const showMilestoneLabel = msLabelAvail >= MIN_LABEL_WIDTH;
            const msLabel =
              rawLabel.length * LABEL_CHAR_PX > msLabelAvail
                ? rawLabel.slice(0, Math.max(0, Math.floor((msLabelAvail - LABEL_CHAR_PX * 1.5) / LABEL_CHAR_PX))) + "…"
                : rawLabel;

            const diamondPoints = `${cx},${barCenterY - r} ${cx + r},${barCenterY} ${cx},${barCenterY + r} ${cx - r},${barCenterY}`;
            const milestoneStroke = isOverdue ? "#ef4444" : task.color;

            return (
              <g
                key={task.id}
                data-task-id={task.id}
                style={{ cursor: "grab" }}
                onClick={handleClick}
                onContextMenu={(e) => handleTaskContextMenu(e, task)}
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
                {showMilestoneLabel && (
                  <text
                    x={labelX}
                    y={barCenterY + 4}
                    fontSize={12}
                    fill="white"
                    fillOpacity={0.85}
                    clipPath={`url(#clip-${task.id})`}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {msLabel}
                  </text>
                )}
                {/* Dep connector dots on milestone diamonds — hidden while selected */}
                {isHovered && !isDepDragging && !selectedTaskIds.has(task.id) && (
                  <>
                    <circle
                      cx={cx + r} cy={barCenterY} r={5}
                      fill="var(--color-bg-surface)"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth={1.5}
                      style={{ cursor: "crosshair" }}
                      onMouseDown={(e) => handleDepDotMouseDown(e, task, "right")}
                    />
                    <circle
                      cx={cx - r} cy={barCenterY} r={5}
                      fill="var(--color-bg-surface)"
                      stroke="rgba(255,255,255,0.7)"
                      strokeWidth={1.5}
                      style={{ cursor: "crosshair" }}
                      onMouseDown={(e) => handleDepDotMouseDown(e, task, "left")}
                    />
                  </>
                )}
                {isDepDragging && depDragPreview?.snapTargetId === task.id && (
                  <polygon
                    points={`${cx},${barCenterY - r - 3} ${cx + r + 3},${barCenterY} ${cx},${barCenterY + r + 3} ${cx - r - 3},${barCenterY}`}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={2}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {/* Marching ants outline on selected milestones */}
                {selectedTaskIds.has(task.id) && (
                  <polygon
                    points={diamondPoints}
                    fill="none"
                    stroke="rgba(255,255,255,0.9)"
                    strokeWidth={1.5}
                    strokeDasharray="6 4"
                    className="marching-ants"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {/* Marching ants outline — search highlight on milestone */}
                {searchHighlightTaskId === task.id && !selectedTaskIds.has(task.id) && (
                  <polygon
                    points={`${cx},${barCenterY - r - 4} ${cx + r + 4},${barCenterY} ${cx},${barCenterY + r + 4} ${cx - r - 4},${barCenterY}`}
                    fill="none"
                    stroke="rgba(250,204,21,0.9)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    className="marching-ants"
                    style={{ pointerEvents: "none" }}
                  />
                )}
              </g>
            );
          }

          const isHovered = hoveredTaskId === task.id;

          // Compute label — wraps to two lines when bar is wide enough, otherwise
          // falls back to single-line overflow with ellipsis.
          const rawTaskLabel = isDone ? `✓ ${task.title}` : task.title;
          const barInnerW = w - 16; // inner width (8px padding each side)
          const useWrap = w >= MIN_WRAP_WIDTH && rawTaskLabel.length * LABEL_CHAR_PX > barInnerW;
          let taskLabel: string;
          let taskLabel2: string | null = null;

          if (useWrap) {
            const charsPerLine = Math.floor(barInnerW / LABEL_CHAR_PX);
            const words = rawTaskLabel.split(" ");
            let line1 = "";
            for (const word of words) {
              const candidate = line1 ? line1 + " " + word : word;
              if (candidate.length <= charsPerLine) { line1 = candidate; } else { break; }
            }
            if (!line1) line1 = rawTaskLabel.slice(0, charsPerLine); // first word too long
            const rest = rawTaskLabel.slice(line1.length).trim();
            taskLabel = line1;
            if (rest) {
              taskLabel2 = rest.length > charsPerLine
                ? rest.slice(0, Math.max(0, charsPerLine - 1)) + "…"
                : rest;
            }
          } else {
            // Single line with overflow past the bar edge + ellipsis when clipped.
            // Start at xEnd (not label start) so text within the bar is never truncated.
            let taskLabelRight = xEnd + MAX_LABEL_OVERFLOW;
            for (const other of tasks) {
              if (other.id === task.id || other.rowId !== task.rowId) continue;
              if ((subLaneMap.get(other.id) ?? 0) !== subLane) continue;
              const otherLeft = dateToX(parseISO(other.start), viewStart, viewEnd, canvasWidth);
              if (otherLeft >= xEnd && otherLeft < taskLabelRight) {
                taskLabelRight = otherLeft - LABEL_OVERFLOW_GAP;
              }
            }
            const taskLabelAvail = taskLabelRight - (x + 8);
            taskLabel =
              rawTaskLabel.length * LABEL_CHAR_PX > taskLabelAvail
                ? rawTaskLabel.slice(0, Math.max(0, Math.floor((taskLabelAvail - LABEL_CHAR_PX * 1.5) / LABEL_CHAR_PX))) + "…"
                : rawTaskLabel;
          }

          return (
            <g
              key={task.id}
              data-task-id={task.id}
              style={{ cursor: "grab" }}
              onClick={handleClick}
              onContextMenu={(e) => handleTaskContextMenu(e, task)}
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
              {/* Marching ants outline — shown when this task is part of the active selection */}
              {selectedTaskIds.has(task.id) && (
                <rect
                  x={x} y={barY} width={w} height={BAR_HEIGHT} rx={4}
                  fill="none"
                  stroke="rgba(255,255,255,0.9)"
                  strokeWidth={1.5}
                  strokeDasharray="6 4"
                  className="marching-ants"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {/* Marching ants outline — shown when this task is the confirmed search result */}
              {searchHighlightTaskId === task.id && !selectedTaskIds.has(task.id) && (
                <rect
                  x={x - 2} y={barY - 2} width={w + 4} height={BAR_HEIGHT + 4} rx={5}
                  fill="none"
                  stroke="rgba(250,204,21,0.9)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  className="marching-ants"
                  style={{ pointerEvents: "none" }}
                />
              )}
              {w >= 24 && (
                useWrap ? (
                  <text
                    fontSize={12}
                    fill="white"
                    fillOpacity={0.9}
                    clipPath={`url(#clip-${task.id})`}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    <tspan x={x + 8} y={barCenterY - 2}>{taskLabel}</tspan>
                    {taskLabel2 && <tspan x={x + 8} y={barCenterY + 11}>{taskLabel2}</tspan>}
                  </text>
                ) : (
                  <text
                    x={x + 8}
                    y={barCenterY + 4}
                    fontSize={12}
                    fill="white"
                    fillOpacity={0.9}
                    clipPath={`url(#clip-${task.id})`}
                    style={{ pointerEvents: "none", userSelect: "none" }}
                  >
                    {taskLabel}
                  </text>
                )
              )}
              {/* Resize handles — disabled while task is selected */}
              {w >= 16 && !selectedTaskIds.has(task.id) && (
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
              {/* Dep connector dots — hidden while task is selected (group drag mode) */}
              {isHovered && !isDepDragging && !selectedTaskIds.has(task.id) && (
                <>
                  <circle
                    cx={x + w} cy={barCenterY} r={5}
                    fill="var(--color-bg-surface)"
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth={1.5}
                    style={{ cursor: "crosshair" }}
                    onMouseDown={(e) => handleDepDotMouseDown(e, task, "right")}
                  />
                  <circle
                    cx={x} cy={barCenterY} r={5}
                    fill="var(--color-bg-surface)"
                    stroke="rgba(255,255,255,0.7)"
                    strokeWidth={1.5}
                    style={{ cursor: "crosshair" }}
                    onMouseDown={(e) => handleDepDotMouseDown(e, task, "left")}
                  />
                </>
              )}
              {/* Snap highlight ring shown on potential drop target during dep drag */}
              {isDepDragging && depDragPreview?.snapTargetId === task.id && (
                <rect
                  x={x - 2} y={barY - 2} width={w + 4} height={BAR_HEIGHT + 4} rx={5}
                  fill="none"
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  style={{ pointerEvents: "none" }}
                />
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
          const isWeekBoundary = getDay(col.date) === weekStartsOn;
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

            {/* Row 2: Week numbers — only on the week start day */}
            {columns.map((col) => {
              if (getDay(col.date) !== weekStartsOn) return null;
              return (
                <text
                  key={`wk-${col.key}`}
                  x={col.x + 4} y={31}
                  fontSize={10}
                  fill="rgba(255,255,255,0.4)"
                  textAnchor="start"
                  style={{ userSelect: "none" }}
                >
                  {`W${getWeek(col.date, { weekStartsOn })}`}
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
                  {`W${getWeek(col.date, { weekStartsOn })}`}
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
                {`W${getWeek(ws.date, { weekStartsOn })}`}
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

        {/* ── Dep drag preview arrow ─────────────────────────────────────── */}
        {depDragPreview && depDragRef.current && (() => {
          const dd = depDragRef.current!;
          const sourceTask = tasks.find((t) => t.id === dd.sourceTaskId);
          if (!sourceTask) return null;

          const sourceSubLane = subLaneMap.get(sourceTask.id) ?? 0;
          const sourceRowY = rowYMap.get(sourceTask.rowId) ?? 0;
          const srcCenterY = sourceRowY + sourceSubLane * ROW_HEIGHT + BAR_PAD_Y + BAR_HEIGHT / 2;
          const srcX =
            dd.dotSide === "right"
              ? dateToX(addDays(parseISO(sourceTask.end), 1), viewStart, viewEnd, canvasWidth)
              : dateToX(parseISO(sourceTask.start), viewStart, viewEnd, canvasWidth);

          let endX = depDragPreview.x2;
          let endY = depDragPreview.y2;

          const snap = depDragPreview.snapTargetId
            ? tasks.find((t) => t.id === depDragPreview.snapTargetId)
            : null;
          if (snap) {
            const snapSubLane = subLaneMap.get(snap.id) ?? 0;
            const snapRowY = rowYMap.get(snap.rowId) ?? 0;
            endY = snapRowY + snapSubLane * ROW_HEIGHT + BAR_PAD_Y + BAR_HEIGHT / 2;
            endX =
              dd.dotSide === "right"
                ? dateToX(parseISO(snap.start), viewStart, viewEnd, canvasWidth)
                : dateToX(addDays(parseISO(snap.end), 1), viewStart, viewEnd, canvasWidth);
          }

          const AH = ARROWHEAD_LEN;
          const previewPath = computeArrowPath(srcX, srcCenterY, endX - AH, endY);

          return (
            <g style={{ pointerEvents: "none" }}>
              <path
                d={previewPath}
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth={2}
                strokeDasharray="5 3"
              />
              <polygon
                points={`${endX},${endY} ${endX - AH},${endY - AH / 2} ${endX - AH},${endY + AH / 2}`}
                fill="var(--color-accent)"
              />
            </g>
          );
        })()}

        {/* ── Drag-to-create preview bar ──────────────────────────────────── */}
        {dragCreatePreview && (() => {
          const { start, end, rowId, lane } = dragCreatePreview;
          const rowY = rowYMap.get(rowId) ?? 0;
          const x    = dateToX(parseISO(start),           viewStart, viewEnd, canvasWidth);
          const xEnd = dateToX(addDays(parseISO(end), 1), viewStart, viewEnd, canvasWidth);
          const barY = rowY + lane * ROW_HEIGHT + BAR_PAD_Y;
          return (
            <rect
              x={x} y={barY} width={Math.max(xEnd - x, 2)} height={BAR_HEIGHT} rx={4}
              fill="rgba(99,102,241,0.3)"
              stroke="rgba(99,102,241,0.7)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}

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
            onClick={(e) => e.stopPropagation()} // don't trigger canvas click-to-create
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
      {/* ── Arrow context menu ──────────────────────────────────────────────── */}
      {arrowMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: Math.min(arrowMenu.x, window.innerWidth - 180),
            top: arrowMenu.y + 4,
            zIndex: 999,
            width: 176,
          }}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl"
        >
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            Dependency
          </div>
          <div className="mx-2 mb-1 border-t border-[var(--color-border)]" />
          <button
            onClick={() => handleDeleteDep(arrowMenu.predId, arrowMenu.succId)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h8M4.5 4V3h3v1M5 6v3M7 6v3M3 4l.5 5.5h5L9 4" />
            </svg>
            Delete dependency
          </button>
        </div>
      )}
      {/* ── Task right-click context menu ───────────────────────────────────── */}
      {taskMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: Math.min(taskMenu.x, window.innerWidth - 228),
            top: taskMenu.y + 4,
            zIndex: 999,
            width: 224,
          }}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl"
        >
          <div className="px-3 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
            {taskMenu.tasks.length === 1
              ? (taskMenu.tasks[0].title || "Untitled")
              : `${taskMenu.tasks.length} tasks selected`}
          </div>
          <div className="mx-2 mb-1 border-t border-[var(--color-border)]" />
          <button
            onClick={() => { setDeleteConfirm(taskMenu.tasks); setTaskMenu(null); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-red-400 hover:bg-red-500/10"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 4h8M4.5 4V3h3v1M5 6v3M7 6v3M3 4l.5 5.5h5L9 4" />
            </svg>
            Delete
          </button>
          <div className="mx-2 my-1 border-t border-[var(--color-border)]" />
          <button
            onClick={() => handleDuplicate(taskMenu.tasks, true)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M1 8V2a1 1 0 0 1 1-1h6" />
            </svg>
            Duplicate
          </button>
          <button
            onClick={() => handleDuplicate(taskMenu.tasks, false)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="7" height="7" rx="1" />
              <path d="M1 8V2a1 1 0 0 1 1-1h6" />
            </svg>
            Duplicate without dependencies
          </button>
        </div>
      )}
      {/* ── Multi-select delete confirmation ─────────────────────────────────── */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setDeleteConfirm(null); }}
        >
          <div
            className="w-[380px] rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-1 text-sm font-semibold text-[var(--color-text-primary)]">
              Delete {deleteConfirm.length === 1 ? "1 task" : `${deleteConfirm.length} tasks`}?
            </h2>
            <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
              This action cannot be undone.
            </p>
            <ul className="mb-4 max-h-48 space-y-0.5 overflow-y-auto text-xs text-[var(--color-text-secondary)]">
              {deleteConfirm.map(t => (
                <li key={t.id} className="flex items-center gap-1.5">
                  <span className="text-[var(--color-text-secondary)]">•</span>
                  <span className="truncate text-[var(--color-text-primary)]">{t.title || "Untitled"}</span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)]"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const toDelete = deleteConfirm;
                  setDeleteConfirm(null);
                  setSelectedTaskIds(new Set());
                  for (const t of toDelete) {
                    await deleteTaskRef.current(t.id);
                  }
                }}
                className="rounded border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
