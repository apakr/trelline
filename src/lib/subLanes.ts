import type { Task } from "../types";

export interface SubLaneResult {
  /** taskId → 0-based sub-lane index within the task's row */
  subLaneMap: Map<string, number>;
  /** rowId → total number of sub-lanes in that row (minimum 1) */
  rowLaneCount: Map<string, number>;
}

/**
 * Assigns tasks to sub-lanes within each row.
 *
 * Each task has a preferred `lane` (set when the user last dropped it).
 * The algorithm tries to honour that preference, only bumping a task to a
 * higher-numbered lane when the preferred one is occupied by a conflicting task.
 *
 * Sort order: (lane, rowOrder, id) — tasks with a lower preferred lane get first
 * pick, so they can claim their intended slot before tasks with higher preferred
 * lanes fill the space.
 *
 * Two tasks overlap when their date ranges intersect:
 *   a.start <= b.end  &&  a.end >= b.start
 * (YYYY-MM-DD strings compare correctly lexicographically)
 */
export function computeSubLanes(tasks: Task[]): SubLaneResult {
  const subLaneMap = new Map<string, number>();
  const rowLaneCount = new Map<string, number>();

  // Group tasks by rowId
  const byRow = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!byRow.has(task.rowId)) byRow.set(task.rowId, []);
    byRow.get(task.rowId)!.push(task);
  }

  for (const [rowId, rowTasks] of byRow) {
    // Sort so tasks with lower preferred lane claim their slot first.
    // Within the same preferred lane, lower rowOrder wins (higher priority).
    const sorted = [...rowTasks].sort((a, b) => {
      const aLane = a.lane ?? 0;
      const bLane = b.lane ?? 0;
      if (aLane !== bLane) return aLane - bLane;
      if (a.rowOrder !== b.rowOrder) return a.rowOrder - b.rowOrder;
      return a.id.localeCompare(b.id);
    });

    // lanes[i] holds the date ranges of tasks already placed in lane i
    const lanes: Array<{ start: string; end: string }[]> = [];

    for (const task of sorted) {
      const preferredLane = task.lane ?? 0;

      // Pre-extend the lanes array so preferredLane is a valid index
      while (lanes.length <= preferredLane) lanes.push([]);

      // Try preferred lane first, then climb until a conflict-free slot is found
      let assigned = -1;
      for (let i = preferredLane; ; i++) {
        if (i >= lanes.length) lanes.push([]);
        const conflict = lanes[i].some(
          (other) => task.start <= other.end && task.end >= other.start
        );
        if (!conflict) {
          lanes[i].push({ start: task.start, end: task.end });
          assigned = i;
          break;
        }
      }

      subLaneMap.set(task.id, assigned);
    }

    rowLaneCount.set(rowId, Math.max(1, lanes.length));
  }

  return { subLaneMap, rowLaneCount };
}
