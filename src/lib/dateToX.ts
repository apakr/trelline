import {
  addDays,
  subDays,
  differenceInDays,
  parseISO,
  startOfDay,
  isBefore,
  isAfter,
} from "date-fns";
import type { Task, ZoomLevel } from "../types";

// ---------------------------------------------------------------------------
// Pixels per day at each zoom level
// ---------------------------------------------------------------------------

const PX_PER_DAY_MAP: Record<ZoomLevel, number> = {
  days: 40,    // 40px / day  → columns are clearly readable
  weeks: 17,   // ~119px / week
  months: 8,   // ~240px / month
};

export function pxPerDay(zoom: ZoomLevel): number {
  return PX_PER_DAY_MAP[zoom];
}

// ---------------------------------------------------------------------------
// Core coordinate transforms
// ---------------------------------------------------------------------------

/**
 * Convert a Date to a pixel X position on the canvas.
 * Returns values outside [0, canvasWidth] for dates outside the view range
 * (useful for rendering partial bars at edges).
 */
export function dateToX(
  date: Date,
  viewStart: Date,
  viewEnd: Date,
  canvasWidth: number
): number {
  const total = viewEnd.getTime() - viewStart.getTime();
  if (total === 0) return 0;
  const offset = date.getTime() - viewStart.getTime();
  return (offset / total) * canvasWidth;
}

/**
 * Convert a pixel X position back to a Date.
 */
export function xToDate(
  x: number,
  viewStart: Date,
  viewEnd: Date,
  canvasWidth: number
): Date {
  const total = viewEnd.getTime() - viewStart.getTime();
  if (canvasWidth === 0) return new Date(viewStart);
  const offset = (x / canvasWidth) * total;
  return new Date(viewStart.getTime() + offset);
}

// ---------------------------------------------------------------------------
// View bounds — what date range to render
// ---------------------------------------------------------------------------

export interface ViewBounds {
  viewStart: Date;
  viewEnd: Date;
  totalDays: number;
  canvasWidth: number;
}

export function getViewBounds(tasks: Task[], zoom: ZoomLevel): ViewBounds {
  const today = startOfDay(new Date());
  const px = pxPerDay(zoom);
  const pad = zoom === "months" ? 60 : 28; // padding in days on each side

  // Minimum visible span so the canvas never looks empty
  const minDays = zoom === "days" ? 60 : zoom === "weeks" ? 84 : 365;

  let rawStart: Date;
  let rawEnd: Date;

  if (tasks.length > 0) {
    const starts = tasks.map((t) => parseISO(t.start));
    const ends = tasks.map((t) => parseISO(t.end));
    const minStart = starts.reduce((a, b) => (isBefore(a, b) ? a : b));
    const maxEnd = ends.reduce((a, b) => (isAfter(a, b) ? a : b));

    // Include today so the today line is always visible in the initial view
    const earliest = isBefore(minStart, today) ? minStart : today;
    const latest = isAfter(maxEnd, today) ? maxEnd : today;

    rawStart = subDays(earliest, pad);
    rawEnd = addDays(latest, pad);
  } else {
    // No tasks — center on today
    rawStart = subDays(today, Math.floor(minDays / 4));
    rawEnd = addDays(today, Math.ceil((minDays * 3) / 4));
  }

  // Enforce minimum span
  if (differenceInDays(rawEnd, rawStart) < minDays) {
    rawEnd = addDays(rawStart, minDays);
  }

  const viewStart = startOfDay(rawStart);
  const viewEnd = startOfDay(rawEnd);
  const totalDays = differenceInDays(viewEnd, viewStart);
  const canvasWidth = totalDays * px;

  return { viewStart, viewEnd, totalDays, canvasWidth };
}
