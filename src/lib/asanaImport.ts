import { v4 as uuidv4 } from "uuid";
import type { Row, Task } from "../types";

// ---------------------------------------------------------------------------
// Asana JSON shapes (only the fields we need)
// ---------------------------------------------------------------------------

interface AsanaTaskRaw {
  gid: string;
  name?: string | null;
  notes?: string | null;
  start_on?: string | null;
  due_on?: string | null;
  completed?: boolean;
  resource_subtype?: string;
  memberships?: Array<{
    project: { gid: string; name: string };
    section: { gid: string; name: string };
  }>;
  subtasks?: AsanaTaskRaw[];
}

export interface AsanaImportPreview {
  projectName: string;
  rows: Row[];
  tasks: Task[];
  warnings: string[];
  /** Number of dependency links successfully resolved and imported. */
  depImportedCount: number;
  /** Human-readable descriptions of dependency references that could not be resolved. */
  depWarnings: string[];
}

// ---------------------------------------------------------------------------
// Row color palette — cycles if there are more sections than colors
// ---------------------------------------------------------------------------

const ROW_COLORS = [
  "#6366f1",
  "#8b5cf6",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#3b82f6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#a855f7",
];

// ---------------------------------------------------------------------------
// parseAsanaExport
// Pure function — no I/O. Throws with a user-friendly message on bad input.
// ---------------------------------------------------------------------------

export function parseAsanaExport(raw: unknown): AsanaImportPreview {
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("data" in raw) ||
    !Array.isArray((raw as { data: unknown }).data)
  ) {
    throw new Error(
      'This doesn\'t look like a valid Asana JSON export. Expected a file with a top-level "data" array.'
    );
  }

  const data = (raw as { data: AsanaTaskRaw[] }).data;
  const warnings: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // -------------------------------------------------------------------------
  // Detect project name from first task that has a membership
  // -------------------------------------------------------------------------

  let projectName = "Imported from Asana";
  for (const task of data) {
    if (task.memberships && task.memberships.length > 0) {
      projectName = task.memberships[0].project.name;
      break;
    }
  }

  // -------------------------------------------------------------------------
  // Flatten all tasks (including subtasks recursively)
  // Subtasks inherit their parent's section when they have no membership.
  // -------------------------------------------------------------------------

  interface FlatTask {
    name: string;
    notes: string;
    start_on: string | null;
    due_on: string | null;
    completed: boolean;
    resource_subtype: string;
    sectionGid: string;
    sectionName: string;
    isSubtask: boolean;
  }

  const flatTasks: FlatTask[] = [];

  function collect(
    task: AsanaTaskRaw,
    inheritedSectionGid: string,
    inheritedSectionName: string,
    isSubtask: boolean
  ) {
    const mem = task.memberships?.[0];
    const sectionGid = mem?.section.gid ?? inheritedSectionGid;
    const sectionName = mem?.section.name ?? inheritedSectionName;

    flatTasks.push({
      name: task.name?.trim() || "(unnamed task)",
      notes: task.notes ?? "",
      start_on: task.start_on ?? null,
      due_on: task.due_on ?? null,
      completed: task.completed ?? false,
      resource_subtype: task.resource_subtype ?? "default_task",
      sectionGid,
      sectionName,
      isSubtask,
    });

    if (task.subtasks && task.subtasks.length > 0) {
      for (const sub of task.subtasks) {
        collect(sub, sectionGid, sectionName, true);
      }
    }
  }

  for (const task of data) {
    collect(task, "__uncategorized__", "Uncategorized", false);
  }

  if (flatTasks.length === 0) {
    throw new Error("No tasks found in this Asana export.");
  }

  // -------------------------------------------------------------------------
  // Build unique rows from sections (preserve order of first appearance).
  // "Uncategorized" is moved to the end.
  // -------------------------------------------------------------------------

  const sectionGidsOrdered: string[] = [];
  const sectionNameMap = new Map<string, string>();

  for (const ft of flatTasks) {
    if (!sectionNameMap.has(ft.sectionGid)) {
      sectionGidsOrdered.push(ft.sectionGid);
      sectionNameMap.set(ft.sectionGid, ft.sectionName);
    }
  }

  // Move "__uncategorized__" to end
  const uncatIdx = sectionGidsOrdered.indexOf("__uncategorized__");
  if (uncatIdx > 0) {
    sectionGidsOrdered.splice(uncatIdx, 1);
    sectionGidsOrdered.push("__uncategorized__");
  }

  const sectionToRowId = new Map<string, string>();
  const rows: Row[] = sectionGidsOrdered.map((gid, index) => {
    const rowId = `row_${uuidv4()}`;
    sectionToRowId.set(gid, rowId);
    return {
      id: rowId,
      name: sectionNameMap.get(gid)!,
      order: index,
      color: ROW_COLORS[index % ROW_COLORS.length],
      laneCount: 1,
    };
  });

  // -------------------------------------------------------------------------
  // Resolve dates for every flat task so we can sort before building objects
  // -------------------------------------------------------------------------

  interface ResolvedTask extends FlatTask {
    resolvedStart: string;
    resolvedEnd: string;
    missingDate: boolean;
  }

  const resolvedTasks: ResolvedTask[] = flatTasks.map((ft) => {
    const isMilestone = ft.resource_subtype === "milestone";
    let resolvedStart: string;
    let resolvedEnd: string;
    let missingDate = false;

    if (isMilestone) {
      const date = ft.due_on ?? today;
      if (!ft.due_on) missingDate = true;
      resolvedStart = date;
      resolvedEnd = date;
    } else if (!ft.start_on && !ft.due_on) {
      missingDate = true;
      resolvedStart = today;
      resolvedEnd = today;
    } else if (!ft.start_on) {
      resolvedStart = ft.due_on!;
      resolvedEnd = ft.due_on!;
    } else if (!ft.due_on) {
      resolvedStart = ft.start_on;
      resolvedEnd = ft.start_on;
    } else {
      resolvedStart = ft.start_on;
      resolvedEnd = ft.due_on;
    }

    return { ...ft, resolvedStart, resolvedEnd, missingDate };
  });

  // -------------------------------------------------------------------------
  // Group by section, sort each group chronologically by start date.
  // This preserves the left-to-right visual order from Asana's timeline and
  // determines the per-row lane assignment (each task gets its own lane).
  // -------------------------------------------------------------------------

  const tasksBySection = new Map<string, ResolvedTask[]>();
  for (const gid of sectionGidsOrdered) {
    tasksBySection.set(gid, []);
  }
  for (const rt of resolvedTasks) {
    tasksBySection.get(rt.sectionGid)!.push(rt);
  }
  for (const group of tasksBySection.values()) {
    group.sort((a, b) => a.resolvedStart.localeCompare(b.resolvedStart));
  }

  // -------------------------------------------------------------------------
  // Build Task objects.
  //
  // Pack tasks into as few lanes as possible: non-overlapping tasks share the
  // same lane, a new lane is only opened when tasks genuinely overlap in date.
  // -------------------------------------------------------------------------

  let missingDateCount = 0;
  const subtaskCount = flatTasks.filter((t) => t.isSubtask).length;
  const now = new Date().toISOString();
  const tasks: Task[] = [];

  for (const [sectionGid, group] of tasksBySection) {
    const rowId = sectionToRowId.get(sectionGid)!;
    const row = rows.find((r) => r.id === rowId)!;

    const laneRanges: { start: string; end: string }[][] = [];

    group.forEach((rt, sortedIdx) => {
      if (rt.missingDate) missingDateCount++;

      let assignedLane = 0;
      while (true) {
        if (assignedLane >= laneRanges.length) {
          laneRanges.push([]);
        }
        const conflict = laneRanges[assignedLane].some(
          (other) => rt.resolvedStart <= other.end && rt.resolvedEnd >= other.start
        );
        if (!conflict) break;
        assignedLane++;
      }
      laneRanges[assignedLane].push({ start: rt.resolvedStart, end: rt.resolvedEnd });

      tasks.push({
        id: `task_${uuidv4()}`,
        title: rt.name,
        rowId,
        start: rt.resolvedStart,
        end: rt.resolvedEnd,
        status: rt.completed ? "done" : "not_done",
        color: row.color,
        isMilestone: rt.resource_subtype === "milestone",
        notes: rt.notes,
        dependencies: [],
        rowOrder: sortedIdx,
        lane: assignedLane,
        createdAt: now,
        updatedAt: now,
      });
    });

    row.laneCount = Math.max(1, laneRanges.length);
  }

  if (missingDateCount > 0) {
    warnings.push(
      `${missingDateCount} task${missingDateCount !== 1 ? "s" : ""} had no date — placed at today.`
    );
  }
  if (subtaskCount > 0) {
    warnings.push(
      `${subtaskCount} subtask${subtaskCount !== 1 ? "s" : ""} flattened into their parent's row.`
    );
  }

  return { projectName, rows, tasks, warnings, depImportedCount: 0, depWarnings: [] };
}
