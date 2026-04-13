import { useEffect, useRef, useState } from "react";
import { parseISO, startOfDay } from "date-fns";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { ZoomLevel } from "../../types";
import { useWorkspace, useLoadedWorkspace } from "../../context/WorkspaceContext";
import DateNavPicker from "./DateNavPicker";

type DateFormatOption = "YYYY-MM-DD" | "YYYY-DD-MM";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

interface TopBarProps {
  onScrollToToday?: () => void;
  centerDateInputRef?: React.RefObject<HTMLInputElement | null>;
  centerDateISORef?: React.RefObject<string>;
  onNavigateToDate?: (date: Date) => void;
}

export default function TopBar({ onScrollToToday, centerDateInputRef, centerDateISORef, onNavigateToDate }: TopBarProps) {
  const { closeWorkspace, setPanel, appConfig, updateSettings } = useWorkspace();
  const { workspace, folderPath, setZoom, renameWorkspace } = useLoadedWorkspace();
  const settings = appConfig.settings;

  // Workspace dropdown
  const [wsMenuOpen, setWsMenuOpen] = useState(false);
  const wsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wsMenuOpen) return;
    function handle(e: MouseEvent) {
      if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) {
        setWsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [wsMenuOpen]);

  // Inline rename
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Custom date picker popover
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitialDate, setPickerInitialDate] = useState<Date>(() => startOfDay(new Date()));
  const pickerContainerRef = useRef<HTMLDivElement>(null);

  // Settings popup
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);

  // Close picker when clicking outside the container
  useEffect(() => {
    if (!pickerOpen) return;
    function handleOutside(e: MouseEvent) {
      if (pickerContainerRef.current && !pickerContainerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [pickerOpen]);

  // Close settings popup when clicking outside or pressing Escape
  useEffect(() => {
    if (!settingsOpen) return;
    function handleOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [settingsOpen]);

  function openPicker() {
    // Use the ISO ref (always "yyyy-MM-dd") so parsing is unambiguous
    const isoVal = centerDateISORef?.current ?? centerDateInputRef?.current?.value ?? "";
    let date: Date;
    try {
      date = isoVal ? startOfDay(parseISO(isoVal)) : startOfDay(new Date());
      if (isNaN(date.getTime())) date = startOfDay(new Date());
    } catch {
      date = startOfDay(new Date());
    }
    setPickerInitialDate(date);
    setPickerOpen(true);
  }

  function handlePickerConfirm(date: Date) {
    setPickerOpen(false);
    onNavigateToDate?.(date);
  }

  function startRename() {
    setWsMenuOpen(false);
    setDraftName(workspace.name);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  async function commitRename() {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== workspace.name) {
      await renameWorkspace(trimmed);
    }
    setIsRenaming(false);
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitRename();
    if (e.key === "Escape") setIsRenaming(false);
  }

  return (
    <div className="flex h-[52px] flex-shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-4">
      {/* Workspace name + dropdown */}
      <div ref={wsMenuRef} className="relative flex min-w-0 flex-1 items-center gap-2">
        {isRenaming ? (
          <input
            ref={inputRef}
            className="min-w-0 flex-1 rounded bg-[var(--color-bg-elevated)] px-2 py-1 text-sm font-medium text-[var(--color-text-primary)] outline outline-1 outline-[var(--color-accent)] focus:outline-2"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleNameKeyDown}
          />
        ) : (
          <button
            className="flex min-w-0 items-center gap-1 truncate rounded px-1 py-0.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
            onClick={() => setWsMenuOpen((o) => !o)}
          >
            <span className="truncate">{workspace.name}</span>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 opacity-50">
              <path d="M2 4l3 3 3-3" />
            </svg>
          </button>
        )}

        {wsMenuOpen && (
          <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl">
            <button
              onClick={startRename}
              className="flex w-full items-center px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
            >
              Rename workspace
            </button>
            <button
              onClick={async () => {
                setWsMenuOpen(false);
                await revealItemInDir(folderPath);
              }}
              className="flex w-full items-center px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
            >
              Open in Finder
            </button>
            <div className="my-1 border-t border-[var(--color-border)]" />
            <button
              onClick={() => {
                setWsMenuOpen(false);
                closeWorkspace();
              }}
              className="flex w-full items-center px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]"
            >
              Open different workspace
            </button>
          </div>
        )}
      </div>

      {/* Date navigator — read-only display that opens custom picker */}
      <div ref={pickerContainerRef} className="relative">
        <input
          ref={centerDateInputRef}
          type="text"
          readOnly
          onClick={openPicker}
          className="w-28 cursor-pointer rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1 text-center text-xs text-[var(--color-text-secondary)] hover:border-[var(--color-accent)] hover:text-[var(--color-text-primary)] focus:outline-none transition-colors select-none"
          title="Click to navigate to a date"
        />
        {pickerOpen && (
          <DateNavPicker
            initialDate={pickerInitialDate}
            displayFormat={settings.dateFormat === "YYYY-DD-MM" ? "yyyy-dd-MM" : "yyyy-MM-dd"}
            onConfirm={handlePickerConfirm}
            onCancel={() => setPickerOpen(false)}
          />
        )}
      </div>

      {/* Zoom controls */}
      <div className="flex rounded border border-[var(--color-border)]">
        {(["days", "weeks", "months"] as ZoomLevel[]).map((z, i) => (
          <button
            key={z}
            onClick={() => setZoom(z)}
            className={[
              "px-3 py-1 text-xs font-medium transition-colors",
              i === 0 ? "rounded-l" : i === 2 ? "rounded-r" : "",
              i < 2 ? "border-r border-[var(--color-border)]" : "",
              workspace.zoom === z
                ? "bg-[var(--color-accent)] text-white"
                : "bg-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
          >
            {ZOOM_LABELS[z]}
          </button>
        ))}
      </div>

      {/* Today button */}
      <button
        onClick={onScrollToToday}
        className="rounded border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
      >
        Today
      </button>

      {/* New task button */}
      <button
        onClick={() => setPanel({ type: "newTask" })}
        className="flex items-center gap-1.5 rounded bg-[var(--color-accent)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        New Task
      </button>

      {/* Settings */}
      <div ref={settingsRef} className="relative">
        <button
          onClick={() => setSettingsOpen((o) => !o)}
          title="Settings"
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>

        {settingsOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-2 shadow-xl">
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] opacity-60">
              Settings
            </div>

            {/* Invert scroll */}
            <label className="flex cursor-pointer items-center justify-between px-3 py-2 hover:bg-[var(--color-bg-surface)]">
              <span className="text-xs text-[var(--color-text-primary)]">Invert scroll axis</span>
              <button
                role="switch"
                aria-checked={settings.invertScroll}
                onClick={() => updateSettings({ ...settings, invertScroll: !settings.invertScroll })}
                className={[
                  "relative inline-flex h-4 w-7 flex-shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none",
                  settings.invertScroll ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]",
                ].join(" ")}
              >
                <span
                  className={[
                    "pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform",
                    settings.invertScroll ? "translate-x-3" : "translate-x-0",
                  ].join(" ")}
                />
              </button>
            </label>

            {/* Date format */}
            <div className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-bg-surface)]">
              <span className="text-xs text-[var(--color-text-primary)]">Date format</span>
              <div className="flex rounded border border-[var(--color-border)] text-[10px]">
                {(["YYYY-MM-DD", "YYYY-DD-MM"] as DateFormatOption[]).map((fmt, i) => (
                  <button
                    key={fmt}
                    onClick={() => updateSettings({ ...settings, dateFormat: fmt })}
                    className={[
                      "px-2 py-0.5 font-medium transition-colors",
                      i === 0 ? "rounded-l" : "rounded-r border-l border-[var(--color-border)]",
                      settings.dateFormat === fmt
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                    ].join(" ")}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            {/* Week start day */}
            <div className="flex items-center justify-between px-3 py-2 hover:bg-[var(--color-bg-surface)]">
              <span className="text-xs text-[var(--color-text-primary)]">Week starts on</span>
              <div className="flex rounded border border-[var(--color-border)] text-[10px]">
                {(["saturday", "sunday", "monday"] as const).map((day, i, arr) => (
                  <button
                    key={day}
                    onClick={() => updateSettings({ ...settings, weekStartDay: day })}
                    className={[
                      "px-2 py-0.5 font-medium capitalize transition-colors",
                      i === 0 ? "rounded-l" : i === arr.length - 1 ? "rounded-r border-l border-[var(--color-border)]" : "border-l border-[var(--color-border)]",
                      settings.weekStartDay === day
                        ? "bg-[var(--color-accent)] text-white"
                        : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                    ].join(" ")}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Close workspace */}
      <button
        onClick={closeWorkspace}
        title="Close workspace"
        className="flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>
    </div>
  );
}
