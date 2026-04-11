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
// Initial view bounds — zoom-independent, used once on canvas mount
// ---------------------------------------------------------------------------

export interface InitialBounds {
  viewStart: Date;
  viewEnd: Date;
}

export function getInitialBounds(tasks: Task[]): InitialBounds {
  const today = startOfDay(new Date());
  const pad = 180;    // generous padding so user can scroll before extend-on-demand fires
  const minDays = 365;

  let rawStart: Date;
  let rawEnd: Date;

  if (tasks.length > 0) {
    const starts = tasks.map((t) => parseISO(t.start));
    const ends = tasks.map((t) => parseISO(t.end));
    const minStart = starts.reduce((a, b) => (isBefore(a, b) ? a : b));
    const maxEnd = ends.reduce((a, b) => (isAfter(a, b) ? a : b));

    // Include today so the today line is always in the initial range
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

  return {
    viewStart: startOfDay(rawStart),
    viewEnd: startOfDay(rawEnd),
  };
}
