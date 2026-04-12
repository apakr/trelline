import { useEffect, useRef, useState } from "react";
import { parseISO, startOfDay } from "date-fns";
import type { ZoomLevel } from "../../types";
import { useWorkspace, useLoadedWorkspace } from "../../context/WorkspaceContext";
import DateNavPicker from "./DateNavPicker";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

interface TopBarProps {
  onScrollToToday?: () => void;
  centerDateInputRef?: React.RefObject<HTMLInputElement | null>;
  onNavigateToDate?: (date: Date) => void;
}

export default function TopBar({ onScrollToToday, centerDateInputRef, onNavigateToDate }: TopBarProps) {
  const { closeWorkspace, setPanel } = useWorkspace();
  const { workspace, setZoom, renameWorkspace } = useLoadedWorkspace();

  const [isRenaming, setIsRenaming] = useState(false);
  const [draftName, setDraftName] = useState(workspace.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // Custom date picker popover
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerInitialDate, setPickerInitialDate] = useState<Date>(() => startOfDay(new Date()));
  const pickerContainerRef = useRef<HTMLDivElement>(null);

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

  function openPicker() {
    const rawVal = centerDateInputRef?.current?.value ?? "";
    let date: Date;
    try {
      date = rawVal ? startOfDay(parseISO(rawVal)) : startOfDay(new Date());
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
      {/* Workspace name */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
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
            className="min-w-0 truncate rounded px-1 py-0.5 text-left text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
            onClick={startRename}
            title="Click to rename workspace"
          >
            {workspace.name}
          </button>
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

      {/* Close workspace */}
      <button
        onClick={closeWorkspace}
        title="Close workspace"
        className="ml-1 flex h-7 w-7 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 2l10 10M12 2L2 12" />
        </svg>
      </button>
    </div>
  );
}
