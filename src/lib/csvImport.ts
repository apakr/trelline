import { v4 as uuidv4 } from "uuid";
import type { Row, Task } from "../types";
import type { AsanaImportPreview } from "./asanaImport";

// ---------------------------------------------------------------------------
// RFC 4180 CSV parser — handles quoted fields with embedded commas/newlines
// ---------------------------------------------------------------------------

function parseCSV(text: string): string[][] {
  const result: string[][] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const row: string[] = [];

    while (i < len) {
      if (text[i] === '"') {
        // Quoted field
        i++;
        let field = "";
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            field += text[i++];
          }
        }
        row.push(field);
      } else {
        // Unquoted field — read until delimiter
        let field = "";
        while (i < len && text[i] !== "," && text[i] !== "\n" && text[i] !== "\r") {
          field += text[i++];
        }
        row.push(field.trim());
      }

      if (i < len && text[i] === ",") {
        i++;
      } else {
        break;
      }
    }

    // Consume newline (CRLF or LF)
    if (i < len) {
      if (text[i] === "\r" && i + 1 < len && text[i + 1] === "\n") i += 2;
      else if (text[i] === "\n" || text[i] === "\r") i++;
    }

    if (row.length > 0 && !(row.length === 1 && row[0] === "")) {
      result.push(row);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Row color palette (same order as JSON import)
// ---------------------------------------------------------------------------

const ROW_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981",
  "#3b82f6", "#ef4444", "#14b8a6", "#f97316", "#a855f7",
];

// ---------------------------------------------------------------------------
// parseAsanaCSV
// Pure function — no I/O. Throws with a user-friendly message on bad input.
// ---------------------------------------------------------------------------

export function parseAsanaCSV(csvText: string): AsanaImportPreview {
  const csvRows = parseCSV(csvText);
  if (csvRows.length < 2) throw new Error("CSV file is empty or has no task rows.");

  const headers = csvRows[0];
  const col = (name: string) => headers.findIndex(h => h.trim() === name);

  const C = {
    name:        col("Name"),
    section:     col("Section/Column"),
    startDate:   col("Start Date"),
    dueDate:     col("Due Date"),
    notes:       col("Notes"),
    completedAt: col("Completed At"),
    parentTask:  col("Parent task"),
    blockedBy:   col("Blocked By (Dependencies)"),
    projects:    col("Projects"),
  };

  if (C.name === -1) {
    throw new Error(
      'This doesn\'t look like a valid Asana CSV export. Could not find a "Name" column.'
    );
  }

  function get(row: string[], idx: number): string {
    return idx >= 0 && idx < row.length ? row[idx].trim() : "";
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // Project name — first non-empty "Projects" cell
  // -------------------------------------------------------------------------

  let projectName = "Imported from Asana";
  if (C.projects >= 0) {
    for (let r = 1; r < csvRows.length; r++) {
      const p = get(csvRows[r], C.projects);
      if (p) { projectName = p; break; }
    }
  }

  // -------------------------------------------------------------------------
  // First pass: collect raw task data, build name → section lookup for
  // subtask section inheritance
  // -------------------------------------------------------------------------

  interface RawRow {
    name: string;
    section: string;
    startDate: string | null;
    dueDate: string | null;
    notes: string;
    completed: boolean;
    parentTask: string;
    blockedBy: string;
    isSubtask: boolean;
  }

  const rawRows: RawRow[] = [];
  const topLevelSectionByName = new Map<string, string>(); // task name → section

  for (let r = 1; r < csvRows.length; r++) {
    const row = csvRows[r];
    const name = get(row, C.name);
    if (!name) continue;

    const section    = get(row, C.section);
    const parentTask = get(row, C.parentTask);
    const isSubtask  = !!parentTask;

    if (!isSubtask && section) topLevelSectionByName.set(name, section);

    rawRows.push({
      name,
      section,
      startDate:   get(row, C.startDate)   || null,
      dueDate:     get(row, C.dueDate)      || null,
      notes:       get(row, C.notes),
      completed:   !!get(row, C.completedAt),
      parentTask,
      blockedBy:   get(row, C.blockedBy),
      isSubtask,
    });
  }

  if (rawRows.length === 0) throw new Error("No tasks found in this CSV.");

  // Resolve each task's section key (inherit parent's section for subtasks)
  const allTasks = rawRows.map(rt => {
    let sectionKey = rt.section;
    if (!sectionKey) {
      sectionKey = rt.isSubtask
        ? (topLevelSectionByName.get(rt.parentTask) ?? "__uncategorized__")
        : "__uncategorized__";
    }
    return { ...rt, sectionKey };
  });

  // -------------------------------------------------------------------------
  // Build rows from unique sections in order of first appearance
  // -------------------------------------------------------------------------

  const sectionOrder: string[] = [];
  const sectionDisplay = new Map<string, string>();

  for (const t of allTasks) {
    if (!sectionDisplay.has(t.sectionKey)) {
      sectionOrder.push(t.sectionKey);
      sectionDisplay.set(
        t.sectionKey,
        t.sectionKey === "__uncategorized__" ? "Uncategorized" : t.sectionKey
      );
    }
  }

  // Move "Uncategorized" to the end
  const uncatIdx = sectionOrder.indexOf("__uncategorized__");
  if (uncatIdx > 0) {
    sectionOrder.splice(uncatIdx, 1);
    sectionOrder.push("__uncategorized__");
  }

  const sectionToRowId = new Map<string, string>();
  const trellineRows: Row[] = sectionOrder.map((key, index) => {
    const rowId = `row_${uuidv4()}`;
    sectionToRowId.set(key, rowId);
    return {
      id: rowId,
      name: sectionDisplay.get(key)!,
      order: index,
      color: ROW_COLORS[index % ROW_COLORS.length],
      laneCount: 1,
    };
  });

  // -------------------------------------------------------------------------
  // Resolve dates and group by section
  // -------------------------------------------------------------------------

  interface SortedTask {
    name: string;
    notes: string;
    completed: boolean;
    blockedBy: string;
    sectionKey: string;
    start: string;
    end: string;
    missingDate: boolean;
  }

  const bySection = new Map<string, SortedTask[]>();
  for (const key of sectionOrder) bySection.set(key, []);

  let missingDateCount = 0;

  for (const t of allTasks) {
    let start: string, end: string, missingDate = false;

    if (!t.startDate && !t.dueDate) {
      missingDate = true;
      start = end = today;
    } else if (!t.startDate) {
      start = end = t.dueDate!;
    } else if (!t.dueDate) {
      start = end = t.startDate;
    } else {
      start = t.startDate;
      end   = t.dueDate;
    }

    if (missingDate) missingDateCount++;
    bySection.get(t.sectionKey)!.push({
      name: t.name, notes: t.notes, completed: t.completed,
      blockedBy: t.blockedBy, sectionKey: t.sectionKey,
      start, end, missingDate,
    });
  }

  for (const group of bySection.values()) {
    group.sort((a, b) => a.start.localeCompare(b.start));
  }

  // -------------------------------------------------------------------------
  // Build Task objects
  //
  // Pack tasks into as few lanes as possible: non-overlapping tasks share the
  // same lane, a new lane is only opened when tasks genuinely overlap in date.
  // -------------------------------------------------------------------------

  const tasks: Task[] = [];
  const nameToId    = new Map<string, string>(); // exact title → taskId (first match wins)
  const nameLowerId = new Map<string, string>(); // lowercase   → taskId (first match wins)
  const taskBlockedBy = new Map<string, string>(); // taskId → raw "Blocked By" cell

  for (const [sectionKey, group] of bySection) {
    const rowId = sectionToRowId.get(sectionKey)!;
    const row   = trellineRows.find(r => r.id === rowId)!;
    const laneRanges: { start: string; end: string }[][] = [];

    group.forEach((t, sortedIdx) => {
      let lane = 0;
      while (true) {
        if (lane >= laneRanges.length) laneRanges.push([]);
        const conflict = laneRanges[lane].some(
          o => t.start <= o.end && t.end >= o.start
        );
        if (!conflict) break;
        lane++;
      }
      laneRanges[lane].push({ start: t.start, end: t.end });

      const taskId = `task_${uuidv4()}`;
      if (!nameToId.has(t.name)) nameToId.set(t.name, taskId);
      if (!nameLowerId.has(t.name.toLowerCase())) nameLowerId.set(t.name.toLowerCase(), taskId);
      if (t.blockedBy) taskBlockedBy.set(taskId, t.blockedBy);

      tasks.push({
        id: taskId,
        title: t.name,
        rowId,
        start: t.start,
        end:   t.end,
        status:      t.completed ? "done" : "not_done",
        color:       row.color,
        isMilestone: false,
        notes:       t.notes,
        dependencies: [],
        rowOrder: sortedIdx,
        lane,
        createdAt: now,
        updatedAt: now,
      });
    });

    row.laneCount = Math.max(1, laneRanges.length);
  }

  // -------------------------------------------------------------------------
  // Dependency resolution — "Blocked By" cell contains task name(s)
  //
  // Strategy: try the entire cell value as one name first (handles names that
  // contain commas). If that fails, fall back to comma-splitting. Warn about
  // anything that can't be matched to a task in this project.
  // -------------------------------------------------------------------------

  function resolveDepName(raw: string): string | null {
    return nameToId.get(raw) ?? nameLowerId.get(raw.toLowerCase()) ?? null;
  }

  let depImportedCount = 0;
  const depWarnings: string[] = [];

  for (const task of tasks) {
    const raw = taskBlockedBy.get(task.id);
    if (!raw) continue;

    const fullMatch = resolveDepName(raw);
    if (fullMatch) {
      if (fullMatch !== task.id && !task.dependencies.includes(fullMatch)) {
        task.dependencies.push(fullMatch);
        depImportedCount++;
      }
    } else {
      // Try comma-separated parts
      let anyPartResolved = false;
      for (const part of raw.split(",")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const id = resolveDepName(trimmed);
        if (id) {
          if (id !== task.id && !task.dependencies.includes(id)) {
            task.dependencies.push(id);
            depImportedCount++;
          }
          anyPartResolved = true;
        } else {
          depWarnings.push(
            `"${trimmed}" (referenced by "${task.title}") — no matching task found in this project.`
          );
        }
      }
      // If nothing at all resolved and we didn't already add individual warnings, add one
      if (!anyPartResolved && depWarnings.every(w => !w.includes(`referenced by "${task.title}"`))) {
        depWarnings.push(
          `"${raw}" (referenced by "${task.title}") — no matching task found in this project.`
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // Warnings
  // -------------------------------------------------------------------------

  const warnings: string[] = [];
  const subtaskCount = allTasks.filter(t => t.isSubtask).length;

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

  return { projectName, rows: trellineRows, tasks, warnings, depImportedCount, depWarnings };
}
