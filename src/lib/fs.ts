/**
 * All filesystem I/O for the app. Every function is async and goes through
 * the Tauri fs plugin — no Node fs, no fetch.
 */

import {
  readTextFile,
  writeTextFile,
  readDir,
  mkdir,
  remove,
  exists,
} from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import { v4 as uuidv4 } from "uuid";
import type { Task, Workspace, WorkspaceState, ZoomLevel } from "../types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function workspaceJsonPath(folderPath: string): Promise<string> {
  return join(folderPath, "workspace.json");
}

async function tasksDirPath(folderPath: string): Promise<string> {
  return join(folderPath, "tasks");
}

async function taskFilePath(folderPath: string, taskId: string): Promise<string> {
  return join(folderPath, "tasks", `${taskId}.json`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads workspace.json + all tasks/*.json from an existing workspace folder.
 * Throws if workspace.json is missing or malformed.
 */
export async function openWorkspace(folderPath: string): Promise<WorkspaceState> {
  const wsPath = await workspaceJsonPath(folderPath);

  if (!(await exists(wsPath))) {
    throw new Error(`Not a valid workspace — workspace.json not found in: ${folderPath}`);
  }

  const workspace: Workspace = JSON.parse(await readTextFile(wsPath));

  // Read all task files
  const tasksDir = await tasksDirPath(folderPath);
  const tasks: Task[] = [];

  if (await exists(tasksDir)) {
    const entries = await readDir(tasksDir);
    for (const entry of entries) {
      if (entry.name?.endsWith(".json")) {
        const taskPath = await join(tasksDir, entry.name);
        try {
          const task: Task = JSON.parse(await readTextFile(taskPath));
          tasks.push(task);
        } catch {
          // Skip malformed task files — don't crash the whole workspace open
          console.warn(`Skipping malformed task file: ${entry.name}`);
        }
      }
    }
  }

  // Update lastOpened in memory (caller is responsible for saving if desired)
  workspace.lastOpened = new Date().toISOString();

  return { workspace, tasks, folderPath };
}

/**
 * Creates a new workspace folder with workspace.json and an empty tasks/ dir.
 * The folderPath directory must already exist (user selected it via dialog).
 */
export async function createWorkspace(
  folderPath: string,
  name: string,
  zoom: ZoomLevel = "weeks"
): Promise<WorkspaceState> {
  const workspace: Workspace = {
    id: `workspace_${uuidv4()}`,
    name,
    rows: [],
    zoom,
    lastOpened: new Date().toISOString(),
  };

  const tasksDir = await tasksDirPath(folderPath);
  if (!(await exists(tasksDir))) {
    await mkdir(tasksDir, { recursive: true });
  }

  const wsPath = await workspaceJsonPath(folderPath);
  await writeTextFile(wsPath, JSON.stringify(workspace, null, 2));

  return { workspace, tasks: [], folderPath };
}

/**
 * Writes workspace.json to disk.
 */
export async function saveWorkspace(
  folderPath: string,
  workspace: Workspace
): Promise<void> {
  const wsPath = await workspaceJsonPath(folderPath);
  await writeTextFile(wsPath, JSON.stringify(workspace, null, 2));
}

/**
 * Writes a single task file (task_<id>.json). Creates tasks/ dir if missing.
 */
export async function saveTask(folderPath: string, task: Task): Promise<void> {
  const tasksDir = await tasksDirPath(folderPath);
  if (!(await exists(tasksDir))) {
    await mkdir(tasksDir, { recursive: true });
  }
  const filePath = await taskFilePath(folderPath, task.id);
  await writeTextFile(filePath, JSON.stringify(task, null, 2));
}

/**
 * Deletes a task file from disk. Silent no-op if the file doesn't exist.
 */
export async function deleteTaskFile(
  folderPath: string,
  taskId: string
): Promise<void> {
  const filePath = await taskFilePath(folderPath, taskId);
  if (await exists(filePath)) {
    await remove(filePath);
  }
}
