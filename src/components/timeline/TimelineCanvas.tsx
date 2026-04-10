import { useEffect, useMemo, useRef, useState } from "react";
import Gantt from "frappe-gantt";
import type { GanttTask } from "frappe-gantt";
import {
  format,
  addDays,
  addMonths,
  addYears,
  subMonths,
  subYears,
  differenceInDays,
  differenceInMonths,
} from "date-fns";
import type { Row, Task, ZoomLevel } from "../../types";
import { computeEffectiveStatus } from "../../types";
import { useWorkspace } from "../../context/WorkspaceContext";
import "frappe-gantt/dist/frappe-gantt.css";
import "./gantt.css";

// ── Constants ──────────────────────────────────────────────────────────────────

const ZOOM_TO_VIEW_MODE: Record<ZoomLevel, string> = {
  days: "Day",
  weeks: "Week",
  months: "Month",
};

// upper_text for Day and Week: show "Month Year" when year changes, "Month" otherwise.
function yearAwareUpperText(n: Date, t: Date | null): string {
  if (!t || n.getFullYear() !== t.getFullYear()) return format(n, "MMMM yyyy");
  if (n.getMonth() !== t.getMonth()) return format(n, "MMMM");
  return "";
}

// lower_text for Week: replicates Frappe's built-in "Apr 1 – Apr 7" formatter.
function weekLowerText(n: Date, t: Date | null): string {
  const end = addDays(n, 6);
  const startFmt = !t || n.getMonth() !== t.getMonth() ? "d MMM" : "d";
  const endFmt = end.getMonth() !== n.getMonth() ? "d MMM" : "d";
  return `${format(n, startFmt)} – ${format(end, endFmt)}`;
}

// Custom view modes passed to Frappe so we control upper/lower text formatting.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CUSTOM_VIEW_MODES: any[] = [
  {
    name: "Day",
    padding: "7d",
    date_format: "YYYY-MM-DD",
    step: "1d",
    lower_text: (n: Date, t: Date | null) =>
      !t || n.getDate() !== t.getDate() ? format(n, "d") : "",
    upper_text: yearAwareUpperText,
    thick_line: (n: Date) => n.getDay() === 1,
  },
  {
    name: "Week",
    padding: "1m",
    step: "7d",
    date_format: "YYYY-MM-DD",
    column_width: 140,
    lower_text: weekLowerText,
    upper_text: yearAwareUpperText,
    thick_line: (n: Date) => n.getDate() >= 1 && n.getDate() <= 7,
    upper_text_frequency: 4,
  },
  {
    name: "Month",
    padding: "2m",
    step: "1m",
    column_width: 120,
    date_format: "YYYY-MM",
    lower_text: "MMMM",
    upper_text: (n: Date, t: Date | null) =>
      !t || n.getFullYear() !== t.getFullYear() ? format(n, "yyyy") : "",
    thick_line: (n: Date) => n.getMonth() % 3 === 0,
    snap_at: "7d",
  },
];

// ── Window management ──────────────────────────────────────────────────────────

interface WindowBounds {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

/** Initial rendered date window per zoom level, centered around today. */
function defaultWindow(zoom: ZoomLevel): WindowBounds {
  const now = new Date();
  switch (zoom) {
    case "days":
      return {
        start: format(subMonths(now, 3), "yyyy-MM-dd"),
        end: format(addMonths(now, 3), "yyyy-MM-dd"),
      };
    case "weeks":
      return {
        start: format(subMonths(now, 6), "yyyy-MM-dd"),
        end: format(addMonths(now, 14), "yyyy-MM-dd"),
      };
    case "months":
      return {
        start: format(subYears(now, 1), "yyyy-MM-dd"),
        end: format(addYears(now, 3), "yyyy-MM-dd"),
      };
  }
}

/** Returns a new date extended by one step in the given direction. */
function extendBound(date: string, zoom: ZoomLevel, dir: "left" | "right"): string {
  const d = new Date(date + "T00:00:00");
  switch (zoom) {
    case "days":
      return format(dir === "left" ? subMonths(d, 3) : addMonths(d, 3), "yyyy-MM-dd");
    case "weeks":
      return format(dir === "left" ? subMonths(d, 6) : addMonths(d, 6), "yyyy-MM-dd");
    case "months":
      return format(dir === "left" ? subYears(d, 1) : addYears(d, 1), "yyyy-MM-dd");
  }
}

/**
 * Pixel offset introduced by extending the window start from oldStart to newStart
 * (newStart is earlier). Used to correct scrollLeft after a left extension.
 */
function leftExtensionPixels(
  oldStart: string,
  newStart: string,
  zoom: ZoomLevel,
  columnWidth: number
): number {
  const old = new Date(oldStart + "T00:00:00");
  const neo = new Date(newStart + "T00:00:00");
  let columns: number;
  switch (zoom) {
    case "days":   columns = differenceInDays(old, neo); break;
    case "weeks":  columns = Math.round(differenceInDays(old, neo) / 7); break;
    case "months": columns = differenceInMonths(old, neo); break;
    default:       columns = 0;
  }
  return columns * columnWidth;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface TimelineCanvasProps {
  /** Rows sorted by Row.order ascending. */
  sortedRows: Row[];
  /** All tasks in the workspace. */
  tasks: Task[];
  /** Current zoom level — fixed for the lifetime of this component instance.
   *  The parent renders <TimelineCanvas key={zoom} …> so any zoom change fully
   *  remounts this component, giving us a clean Gantt with no stale state. */
  zoom: ZoomLevel;
  /** Ref to the RowPanel body div — used to drive vertical scroll sync. */
  rowPanelBodyRef: React.RefObject<HTMLDivElement | null>;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function TimelineCanvas({
  sortedRows,
  tasks,
  zoom,
  rowPanelBodyRef,
}: TimelineCanvasProps) {
  const { setPanel, updateTask } = useWorkspace();

  const mountRef = useRef<HTMLDivElement>(null);
  const ganttRef = useRef<Gantt | null>(null);

  const setPanelRef = useRef(setPanel);
  const updateTaskRef = useRef(updateTask);
  const justDraggedRef = useRef(false);
  const allTasksRef = useRef(tasks);

  // ── Window state ───────────────────────────────────────────────────────────
  // zoom is fixed for this component's lifetime (key={zoom} forces remount on change).
  const [viewWindow, setViewWindow] = useState<WindowBounds>(() => defaultWindow(zoom));

  const viewWindowRef = useRef(viewWindow);
  const zoomRef = useRef(zoom);
  const isExtendingRef = useRef(false);
  const pendingLeftRef = useRef<{ scrollLeft: number; oldStart: string } | null>(null);

  // Blocks scroll-edge extension during init and during Frappe re-renders.
  const scrollGuardRef = useRef(true);

  // Skip first sync-effect run — init already rendered Frappe correctly.
  const isMountedRef = useRef(false);

  useEffect(() => {
    setPanelRef.current = setPanel;
    updateTaskRef.current = updateTask;
    viewWindowRef.current = viewWindow;
    zoomRef.current = zoom;
    allTasksRef.current = tasks;
  });

  // ── Build Frappe task list ─────────────────────────────────────────────────

  const ganttTasks = useMemo<GanttTask[]>(() => {
    const placeholderDate = viewWindow.start;
    const domainTasks: Task[] = [];

    for (const row of sortedRows) {
      // Only include tasks that overlap the current window so that out-of-window
      // tasks never extend gantt_start/gantt_end beyond our anchor tasks.
      const rowTasks = tasks
        .filter((t) => t.rowId === row.id)
        .filter((t) => t.start <= viewWindow.end && t.end >= viewWindow.start)
        .sort((a, b) => a.start.localeCompare(b.start));

      if (rowTasks.length === 0) {
        domainTasks.push({
          id: `__placeholder__${row.id}`,
          title: "",
          rowId: row.id,
          start: placeholderDate,
          end: placeholderDate,
          status: "not_done",
          color: "transparent",
          isMilestone: false,
          notes: "",
          dependencies: [],
          createdAt: "",
          updatedAt: "",
        });
      } else {
        domainTasks.push(...rowTasks);
      }
    }

    const mapped: GanttTask[] = domainTasks.map((task) => {
      const isPlaceholder = task.id.startsWith("__placeholder__");
      const effectiveStatus = isPlaceholder
        ? ("not_done" as const)
        : computeEffectiveStatus(task);

      const classes = [
        isPlaceholder ? "placeholder-row" : "",
        task.isMilestone ? "task-milestone" : "",
        effectiveStatus === "done" ? "task-done" : "",
        effectiveStatus === "overdue" ? "task-overdue" : "",
      ]
        .filter(Boolean)
        .join(" ");

      return {
        id: task.id,
        name: task.title,
        start: task.start,
        end: task.end,
        progress: 0,
        dependencies: task.dependencies.join(","),
        custom_class: classes || undefined,
        color: isPlaceholder ? undefined : task.color,
      } as GanttTask;
    });

    // Invisible anchor tasks that pin gantt_start / gantt_end exactly to our
    // viewWindow, preventing unbounded column counts.
    mapped.push(
      { id: "__window_start__", name: "", start: viewWindow.start, end: viewWindow.start, progress: 0, custom_class: "placeholder-row" },
      { id: "__window_end__",   name: "", start: viewWindow.end,   end: viewWindow.end,   progress: 0, custom_class: "placeholder-row" }
    );

    return mapped;
  }, [sortedRows, tasks, viewWindow]);

  // ── Initialize Frappe once on mount ────────────────────────────────────────

  useEffect(() => {
    if (!mountRef.current) return;
    mountRef.current.innerHTML = "";

    ganttRef.current = new Gantt(
      mountRef.current,
      ganttTasks,
      {
        view_modes: CUSTOM_VIEW_MODES,
        // NOTE: Frappe's setup_options() overrides view_mode to view_modes[0]
        // (Day) when view_modes is provided. We correct the mode immediately
        // after construction via change_view_mode() below.
        view_mode: ZOOM_TO_VIEW_MODE[zoom] as Parameters<Gantt["change_view_mode"]>[0],
        bar_height: 30,
        padding: 18,
        // Disable Frappe's built-in infinite scrolling extension — we manage
        // date-range extension ourselves via viewWindow state. Leaving it on
        // creates conflicts (Frappe mutates gantt_start/gantt_end directly and
        // calls render() from a mousewheel handler, racing with our React state).
        infinite_padding: false,
        scroll_to: "today",
        custom_popup_html: null,
        on_click(task) {
          if (justDraggedRef.current) return;
          if (task.id.startsWith("__placeholder__") || task.id.startsWith("__window_")) return;
          setPanelRef.current({ type: "task", taskId: task.id });
        },
        on_date_change(task, startDate, endDate) {
          if (task.id.startsWith("__placeholder__") || task.id.startsWith("__window_")) return;
          justDraggedRef.current = true;
          setTimeout(() => { justDraggedRef.current = false; }, 200);

          const newStart = format(startDate, "yyyy-MM-dd");
          const newEnd = format(endDate, "yyyy-MM-dd");
          const domainTask = allTasksRef.current.find((t: Task) => t.id === task.id);
          updateTaskRef.current(task.id, {
            start: newStart,
            end: domainTask?.isMilestone ? newStart : newEnd,
          });
        },
      } as ConstructorParameters<typeof Gantt>[2]
    );

    // Fix view_mode: Frappe's setup_options always overrides it to view_modes[0].
    // Calling change_view_mode right after construction sets the correct mode.
    ganttRef.current.change_view_mode(
      ZOOM_TO_VIEW_MODE[zoom] as Parameters<Gantt["change_view_mode"]>[0]
    );

    // Scroll to today, then enable scroll-edge extension.
    setTimeout(() => {
      if (ganttRef.current) {
        scrollGanttToToday(ganttRef.current);
      }
      scrollGuardRef.current = false;
    }, 0);

    // ── Scroll handler ──────────────────────────────────────────────────────
    const ganttContainer = mountRef.current.querySelector(
      ".gantt-container"
    ) as HTMLElement | null;

    if (ganttContainer) {
      ganttContainer.addEventListener("scroll", () => {
        if (rowPanelBodyRef.current) {
          rowPanelBodyRef.current.scrollTop = ganttContainer.scrollTop;
        }

        if (scrollGuardRef.current || isExtendingRef.current || !ganttRef.current) return;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colWidth: number = (ganttRef.current as any).config?.column_width ?? 45;
        const threshold = colWidth * 3;
        const { scrollLeft, clientWidth, scrollWidth } = ganttContainer;

        if (scrollLeft < threshold) {
          isExtendingRef.current = true;
          const win = viewWindowRef.current;
          const newStart = extendBound(win.start, zoomRef.current, "left");
          pendingLeftRef.current = { scrollLeft, oldStart: win.start };
          setViewWindow({ ...win, start: newStart });
        } else if (scrollLeft + clientWidth > scrollWidth - threshold) {
          isExtendingRef.current = true;
          const win = viewWindowRef.current;
          setViewWindow({ ...win, end: extendBound(win.end, zoomRef.current, "right") });
        }
      }, { passive: true });
    }

    return () => {
      if (mountRef.current) mountRef.current.innerHTML = "";
      ganttRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync tasks + window whenever ganttTasks changes ───────────────────────
  // zoom is FIXED for this component's lifetime (remount handles zoom changes),
  // so this effect only needs to handle task edits and window extensions.

  useEffect(() => {
    if (!ganttRef.current) return;

    // Skip first run — init already rendered with the correct tasks and mode.
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = ganttRef.current as any;
    const container = g.$container as HTMLElement;

    // Guard against spurious scroll events during re-render.
    scrollGuardRef.current = true;
    const savedScrollLeft = container.scrollLeft;

    // Suppress Frappe's scroll_to so it doesn't override our restored position.
    const prevScrollTo = g.options.scroll_to;
    g.options.scroll_to = "start"; // scroll to 0, overridden immediately below
    g.setup_tasks(ganttTasks);
    ganttRef.current!.change_view_mode(
      ZOOM_TO_VIEW_MODE[zoom] as Parameters<Gantt["change_view_mode"]>[0]
    );
    g.options.scroll_to = prevScrollTo;

    // Restore scroll position (with left-extension correction if needed).
    if (pendingLeftRef.current) {
      const { oldStart } = pendingLeftRef.current;
      pendingLeftRef.current = null;
      const addedPixels = leftExtensionPixels(
        oldStart, viewWindow.start, zoom, g.config?.column_width ?? 45
      );
      container.scrollLeft = savedScrollLeft + addedPixels;
    } else {
      container.scrollLeft = savedScrollLeft;
    }

    scrollGuardRef.current = false;
    isExtendingRef.current = false;
  }, [ganttTasks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="gantt-wrapper relative flex-1 overflow-hidden bg-[var(--color-bg-surface)]">
      {sortedRows.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-[var(--color-text-secondary)]">
          Add a row to get started
        </div>
      )}
      <div ref={mountRef} className="h-full w-full" />
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scrollGanttToToday(gantt: Gantt) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const container = (gantt as any).$container as HTMLElement;
  if (!container) return;

  const todayLine = container.querySelector(".current-highlight") as HTMLElement | null;
  if (todayLine) {
    const left = parseFloat(todayLine.style.left || "0");
    container.scrollLeft = Math.max(0, left - container.clientWidth / 3);
  }
}
