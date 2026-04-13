import type { Task } from "../types";

// Arrowhead length in px — shared between path computation and rendering.
// The path ends at x2-ARROWHEAD_LEN so the triangle caps it cleanly.
export const ARROWHEAD_LEN = 6;

const OVER = 20; // how far right to exit past x1 in the same-Y arch
const PRE  = 20; // how far left  to extend past x2 in the same-Y arch
const R    = 7;  // rounded-corner radius on same-Y arch turns

/**
 * Returns an SVG path `d` string for a finish-to-start dependency arrow.
 *   (x1, y1) = right-edge center of the predecessor bar (exit point)
 *   (x2, y2) = left-edge center of the successor bar   (entry point)
 *
 * The path ends at (x2 - ARROWHEAD_LEN, y2) — i.e. at the BASE of the
 * arrowhead triangle — so the arrowhead always caps it cleanly regardless
 * of the approach angle.  Pass (x2 - ARROWHEAD_LEN) as x2 when calling if
 * you want the path to stop exactly at the arrowhead back.
 *
 * Forward arrows (x2 meaningfully right of x1) use an S-curve.
 * Backward / overlap arrows use a proper Z-shaped elbow routing:
 *   exit right → travel vertically → re-enter from the left.
 */
export function computeArrowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): string {
  const dy = y2 - y1;

  // ── Forward ──────────────────────────────────────────────────────────────
  if (x2 >= x1 + 12) {
    const cx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
  }

  // ── Backward / tight overlap: Z-shaped elbow ─────────────────────────────
  // Route: exit right past x1 → travel vertically to midY → go left past x2
  //        → travel vertically to y2 → enter rightward into x2.
  // This guarantees the last segment always arrives at (x2, y2) going rightward
  // so the arrowhead always aligns.

  const loopX = x1 + OVER;  // right side of the arch
  const preX  = x2 - PRE;   // left side of the arch

  if (Math.abs(dy) < 4) {
    // Same row — arch above both bars instead of the Z route
    const archY = y1 - 24;
    return [
      `M ${x1} ${y1}`,
      `L ${loopX - R} ${y1}`,
      `Q ${loopX} ${y1}  ${loopX} ${y1 - R}`,
      `L ${loopX} ${archY + R}`,
      `Q ${loopX} ${archY}  ${loopX - R} ${archY}`,
      `L ${preX + R} ${archY}`,
      `Q ${preX} ${archY}  ${preX} ${archY + R}`,
      `L ${preX} ${y2 - R}`,
      `Q ${preX} ${y2}  ${preX + R} ${y2}`,
      `L ${x2} ${y2}`,
    ].join(" ");
  }

  // Different rows — mirrored S-curve.
  // Control points swing outward to the right from each endpoint, so both
  // tangents point rightward and the arrowhead always aligns cleanly.
  const SWING = 120;
  return `M ${x1} ${y1} C ${x1 + SWING} ${y1}, ${x2 - SWING} ${y2}, ${x2} ${y2}`;
}

/**
 * Returns a point near the visual middle of the arrow path for placing
 * interactive elements (e.g. an × delete button).
 */
export function arrowMidpoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): { x: number; y: number } {
  if (x2 >= x1 + 12) {
    return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
  }
  if (Math.abs(y2 - y1) < 4) {
    return { x: (x1 + x2) / 2, y: y1 - 24 };
  }
  // Mirrored S-curve: geometric midpoint lies on the curve
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}

/**
 * Returns true if adding an arrow predId → succId would create a cycle.
 * task.dependencies contains the IDs of a task's predecessors.
 */
export function wouldCreateCycle(
  tasks: Task[],
  predId: string,
  succId: string
): boolean {
  if (predId === succId) return true;
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const visited = new Set<string>();
  const queue = [predId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const task = taskMap.get(id);
    if (!task) continue;
    for (const dep of task.dependencies) {
      if (dep === succId) return true;
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return false;
}
