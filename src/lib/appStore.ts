/**
 * Persists app-level config (recent workspaces) via @tauri-apps/plugin-store.
 * Stored in the OS app data dir — outside of any workspace folder.
 */

import { load } from "@tauri-apps/plugin-store";
import type { AppConfig, AppSettings, RecentWorkspace } from "../types";
import { DEFAULT_SETTINGS } from "../types";

const STORE_PATH = "app-config.json";
const RECENT_MAX = 5;

async function getStore() {
  return load(STORE_PATH, { defaults: {}, autoSave: true });
}

export async function loadAppConfig(): Promise<AppConfig> {
  const store = await getStore();
  const recent = await store.get<RecentWorkspace[]>("recentWorkspaces");
  const settings = await store.get<AppSettings>("settings");
  return {
    recentWorkspaces: recent ?? [],
    settings: settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  const store = await getStore();
  await store.set("settings", settings);
  await store.save();
}

export async function addRecentWorkspace(entry: RecentWorkspace): Promise<void> {
  const store = await getStore();
  const existing = (await store.get<RecentWorkspace[]>("recentWorkspaces")) ?? [];

  // Remove any existing entry for the same folder, then prepend the new one
  const filtered = existing.filter((r) => r.folderPath !== entry.folderPath);
  const updated = [entry, ...filtered].slice(0, RECENT_MAX);

  await store.set("recentWorkspaces", updated);
  // Explicit save — autoSave uses a debounce and may not flush before app close
  await store.save();
}

export async function removeRecentWorkspace(folderPath: string): Promise<void> {
  const store = await getStore();
  const existing = (await store.get<RecentWorkspace[]>("recentWorkspaces")) ?? [];
  await store.set(
    "recentWorkspaces",
    existing.filter((r) => r.folderPath !== folderPath)
  );
  await store.save();
}
