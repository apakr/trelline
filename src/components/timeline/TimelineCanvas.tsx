import { useEffect, useMemo, useRef } from "react";
import Gantt from "frappe-gantt";
import type { GanttTask } from "frappe-gantt";
import { format, addDays, addMonths, addYears } from "date-fns";
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

const TODAY = format(new Date(), "yyyy-MM-dd");

// Per-zoom range anchors — extend gantt_end to today+N so scroll-to-today
// works on any workspace. Kept short for Day to avoid rendering 1000+ columns.
const RANGE_ANCHOR: Record<ZoomLevel, string> = {
  days:   format(addMonths(new Date(), 3), "yyyy-MM-dd"),
  weeks:  format(addMonths(new Date(), 14), "yyyy-MM-dd"),
  months: format(addYears(new Date(), 3), "yyyy-MM-dd"),
};

// ── Props ──────────────────────────────────────────────────────────────────────

interface TimelineCanvasProps {
  /** Rows sorted by Row.order ascending. */
  sortedRows: Row[];
  /** All tasks in the workspace. */
  tasks: Task[];
  /** Current zoom level. */
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

  // Ref to the div that Frappe mounts into.
  const mountRef = useRef<HTMLDivElement>(null);

  // Ref to the Frappe Gantt instance.
  const ganttRef = useRef<Gantt | null>(null);

  // Stable refs for callbacks (avoid stale closures inside Frappe's listeners).
  const setPanelRef = useRef(setPanel);
  const updateTaskRef = useRef(updateTask);
  const justDraggedRef = useRef(false);

  // Keep callback refs fresh on every render.
  useEffect(() => {
    setPanelRef.current = setPanel;
    updateTaskRef.current = updateTask;
  });

  // ── Build sorted, flattened Frappe task list ────────────────────────────────

  /**
   * Returns tasks grouped by row (sorted by row.order), then sorted by start
   * within each row.  Empty rows get one invisible placeholder task so that
   * the RowPanel row-height stays in sync with Frappe's grid.
   */
  const orderedDomainTasks = useMemo<Task[]>(() => {
    const result: Task[] = [];
    for (const row of sortedRows) {
      const rowTasks = tasks
        .filter((t) => t.rowId === row.id)
        .sort((a, b) => a.start.localeCompare(b.start));

      if (rowTasks.length === 0) {
        // Phantom placeholder — visible only as a row slot in Frappe's grid.
        result.push({
          id: `__placeholder__${row.id}`,
          title: "",
          rowId: row.id,
          start: TODAY,
          end: TODAY,
          status: "not_done",
          color: "transparent",
          isMilestone: false,
          notes: "",
          dependencies: [],
          createdAt: "",
          updatedAt: "",
        });
      } else {
        result.push(...rowTasks);
      }
    }
    return result;
  }, [sortedRows, tasks]);

  /** Frappe GanttTask[] derived from orderedDomainTasks. */
  const ganttTasks = useMemo<GanttTask[]>(() => {
    const mapped = orderedDomainTasks.map((task) => {
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
        // Frappe 1.2.2 natively picks up the `color` field and applies it to
        // the bar rect's fill via draw_bar().
        color: isPlaceholder ? undefined : task.color,
      } as GanttTask;
    });

    // Invisible anchor — extends gantt_end to today+N for the current zoom so
    // scroll-to-today always works without rendering excessive columns.
    mapped.push({
      id: "__range_anchor__",
      name: "",
      start: RANGE_ANCHOR[zoom],
      end: RANGE_ANCHOR[zoom],
      progress: 0,
      custom_class: "placeholder-row",
    });

    return mapped;
  }, [orderedDomainTasks, zoom]);

  // ── Initialize Frappe once on mount ────────────────────────────────────────

  useEffect(() => {
    if (!mountRef.current) return;

    // Clean up any prior instance (e.g. React StrictMode double-invoke).
    mountRef.current.innerHTML = "";

    ganttRef.current = new Gantt(
      mountRef.current,
      ganttTasks,
      {
        view_modes: CUSTOM_VIEW_MODES,
        view_mode: ZOOM_TO_VIEW_MODE[zoom] as Parameters<Gantt["change_view_mode"]>[0],
        bar_height: 30,
        padding: 18,
        // Suppress the built-in popup; we open our own panel.
        custom_popup_html: null,
        on_click(task) {
          // Skip if this click is the tail of a drag operation.
          if (justDraggedRef.current) return;
          if (task.id.startsWith("__placeholder__")) return;
          setPanelRef.current({ type: "task", taskId: task.id });
        },
        on_date_change(task, startDate, endDate) {
          if (task.id.startsWith("__placeholder__")) return;
          // Suppress the immediately-following click event.
          justDraggedRef.current = true;
          setTimeout(() => {
            justDraggedRef.current = false;
          }, 200);

          const newStart = format(startDate, "yyyy-MM-dd");
          // Frappe fires endDate as new_end_date - 1 second, which means
          // for a task ending on day D (exclusive), endDate = D-1 23:59:59
          // and format gives "D-1" — the inclusive end we store.
          const newEnd = format(endDate, "yyyy-MM-dd");

          // Find the domain task to know if it's a milestone.
          const domainTask = orderedDomainTasks.find((t) => t.id === task.id);
          updateTaskRef.current(task.id, {
            start: newStart,
            end: domainTask?.isMilestone ? newStart : newEnd,
          });
        },
      } as ConstructorParameters<typeof Gantt>[2]
    );

    // Ensure initial scroll lands on today regardless of task date range.
    setTimeout(() => scrollGanttToToday(ganttRef.current!), 0);

    // ── Scroll sync: when Frappe scrolls vertically, mirror the RowPanel. ──
    const ganttContainer = mountRef.current.querySelector(
      ".gantt-container"
    ) as HTMLElement | null;

    if (ganttContainer) {
      const onScroll = () => {
        if (rowPanelBodyRef.current) {
          rowPanelBodyRef.current.scrollTop = ganttContainer.scrollTop;
        }
      };
      ganttContainer.addEventListener("scroll", onScroll, { passive: true });
      // No cleanup needed for the scroll listener because the container
      // is destroyed when mountRef.current is cleared below.
    }

    return () => {
      if (mountRef.current) {
        mountRef.current.innerHTML = "";
      }
      ganttRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track previous zoom so we can distinguish "only tasks changed" from
  // "zoom changed" — the two cases need different Frappe call sequences.
  const prevZoomRef = useRef(zoom);

  // ── Sync tasks + view mode whenever either changes ─────────────────────────

  useEffect(() => {
    if (!ganttRef.current) return;

    const zoomChanged = prevZoomRef.current !== zoom;
    prevZoomRef.current = zoom;

    if (zoomChanged) {
      // Load the new tasks (with zoom-appropriate anchor) WITHOUT rendering
      // in the old mode first — that would render e.g. 1000 day columns for
      // a 3-year anchor, crashing the WebView. setup_tasks() updates the
      // internal task list only; change_view_mode() then renders once cleanly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ganttRef.current as any).setup_tasks(ganttTasks);
      ganttRef.current.change_view_mode(
        ZOOM_TO_VIEW_MODE[zoom] as Parameters<Gantt["change_view_mode"]>[0]
      );
    } else {
      // Only tasks changed (add/edit/delete) — refresh re-renders in the
      // current mode which is correct.
      ganttRef.current.refresh(ganttTasks);
    }

    setTimeout(() => scrollGanttToToday(ganttRef.current!), 0);
  }, [ganttTasks, zoom]);

  // ── Render ─────────────────────────────────────────────────────────────────

  // Always render the mount div so Frappe initialises on first mount.
  // The empty-state message overlays it when there are no rows yet.
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

/**
 * Scroll the Frappe container so today is visible near the left-third of the
 * viewport. Uses the `.current-highlight` element's pixel position, which
 * Frappe sets precisely regardless of gantt_start/gantt_end range checks.
 */
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

