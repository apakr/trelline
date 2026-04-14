import { useEffect, useRef, useState } from "react";
import { parseISO, startOfDay } from "date-fns";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Task, ZoomLevel } from "../../types";
import { useWorkspace, useLoadedWorkspace } from "../../context/WorkspaceContext";
import DateNavPicker from "./DateNavPicker";

type DateFormatOption = "YYYY-MM-DD" | "YYYY-DD-MM";

const ZOOM_LABELS: Record<ZoomLevel, string> = {
  days: "Days",
  weeks: "Weeks",
  months: "Months",
};

// ---------------------------------------------------------------------------
// Scale presets: 10% – 200% in 10% steps
// ---------------------------------------------------------------------------
const SCALE_PRESETS = Array.from({ length: 20 }, (_, i) => (i + 1) * 0.1);

function scaleLabel(scale: number) {
  return `${Math.round(scale * 100)}%`;
}

// ---------------------------------------------------------------------------
// Fuzzy-ish search: returns tasks ranked by relevance to `query`
// ---------------------------------------------------------------------------
function searchTasks(tasks: Task[], query: string): Task[] {
  if (!query.trim()) return [];
  const q = query.toLowerCase();
  const scored: { task: Task; score: number }[] = [];
  for (const task of tasks) {
    const titleLow = task.title.toLowerCase();
    const notesLow = (task.notes ?? "").toLowerCase();
    let score = 0;
    if (titleLow === q) score += 100;
    else if (titleLow.startsWith(q)) score += 60;
    else if (titleLow.includes(q)) score += 30;
    if (notesLow.includes(q)) score += 10;
    if (score > 0) scored.push({ task, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5).map((s) => s.task);
}

// Highlight `query` occurrences in `text`, returning JSX spans
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-400/30 text-[var(--color-text-primary)] rounded-sm px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

interface TopBarProps {
  onScrollToToday?: () => void;
  centerDateInputRef?: React.RefObject<HTMLInputElement | null>;
  centerDateISORef?: React.RefObject<string>;
  onNavigateToDate?: (date: Date) => void;
  onSearchPreview?: (date: Date | null) => void;
  onSearchConfirm?: (taskId: string, date: Date) => void;
  onSearchCancel?: (anchorDate: Date) => void;
  onSearchClear?: () => void;
}

export default function TopBar({ onScrollToToday, centerDateInputRef, centerDateISORef, onNavigateToDate, onSearchPreview, onSearchConfirm, onSearchCancel, onSearchClear }: TopBarProps) {
  const { closeWorkspace, setPanel, appConfig, updateSettings } = useWorkspace();
  const { workspace, tasks, folderPath, setZoom, setCanvasScale, renameWorkspace } = useLoadedWorkspace();
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

  // Scale dropdown
  const currentScale = workspace.canvasScale ?? 1;
  const [scaleOpen, setScaleOpen] = useState(false);
  const [scaleDraft, setScaleDraft] = useState(scaleLabel(currentScale));
  const scaleRef = useRef<HTMLDivElement>(null);
  const scaleInputRef = useRef<HTMLInputElement>(null);

  // Mutable accumulator for ctrl+scroll — avoids stale React-state reads on rapid ticks.
  // Kept in sync with workspace scale except during an active ctrl+scroll sequence.
  const localScaleRef = useRef(currentScale);
  localScaleRef.current = currentScale;

  // Sync scaleDraft when workspace loads a different workspace (id change only)
  const prevWorkspaceIdRef = useRef(workspace.id);
  if (prevWorkspaceIdRef.current !== workspace.id) {
    prevWorkspaceIdRef.current = workspace.id;
    localScaleRef.current = workspace.canvasScale ?? 1;
    // Can't call setState here during render; schedule it
    setTimeout(() => setScaleDraft(scaleLabel(workspace.canvasScale ?? 1)), 0);
  }

  // Close scale dropdown on outside click
  useEffect(() => {
    if (!scaleOpen) return;
    function handle(e: MouseEvent) {
      if (scaleRef.current && !scaleRef.current.contains(e.target as Node)) {
        setScaleOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [scaleOpen]);

  function commitScaleDraft() {
    const raw = scaleDraft.replace("%", "").trim();
    const pct = parseFloat(raw);
    if (!isNaN(pct) && pct >= 10 && pct <= 200) {
      const rounded = Math.round(pct / 10) * 10;
      const next = rounded / 100;
      localScaleRef.current = next;
      setCanvasScale(next);
      setScaleDraft(scaleLabel(next));
    } else {
      // Invalid input — revert to last known good value
      setScaleDraft(scaleLabel(localScaleRef.current));
    }
    setScaleOpen(false);
  }

  // Ctrl+scroll on the scale widget nudges by 1% per tick.
  // Uses localScaleRef so rapid ticks accumulate correctly without stale state.
  function handleScaleWheel(e: React.WheelEvent) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY > 0 ? -1 : 1;
    const nextPct = Math.round(localScaleRef.current * 100) + delta;
    const clamped = Math.max(10, Math.min(200, nextPct));
    const next = clamped / 100;
    localScaleRef.current = next;          // update ref immediately for next tick
    setScaleDraft(scaleLabel(next));       // update input display synchronously
    setCanvasScale(next);
  }

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<Task[]>([]);
  const [searchFocusIdx, setSearchFocusIdx] = useState(0);
  const searchAnchorDateRef = useRef<Date | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live search: update results as query changes
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setSearchFocusIdx(0);
      return;
    }
    const results = searchTasks(tasks, searchQuery);
    setSearchResults(results);
    setSearchFocusIdx(0);
    // Preview: scroll to top result
    if (results.length > 0) {
      const top = results[0];
      onSearchPreview?.(parseISO(top.start));
    } else {
      onSearchPreview?.(null);
    }
  }, [searchQuery, tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  function openSearch() {
    // Save anchor date when search starts
    const isoVal = centerDateISORef?.current ?? "";
    try {
      searchAnchorDateRef.current = isoVal ? startOfDay(parseISO(isoVal)) : startOfDay(new Date());
    } catch {
      searchAnchorDateRef.current = startOfDay(new Date());
    }
    setSearchOpen(true);
  }

  function cancelSearch() {
    setSearchQuery("");
    setSearchOpen(false);
    setSearchResults([]);
    searchInputRef.current?.blur();
    if (searchAnchorDateRef.current) {
      onSearchCancel?.(searchAnchorDateRef.current);
      searchAnchorDateRef.current = null;
    }
  }

  function confirmResult(task: Task) {
    setSearchQuery("");
    setSearchOpen(false);
    setSearchResults([]);
    onSearchConfirm?.(task.id, parseISO(task.start));
    searchAnchorDateRef.current = null;
  }

  // Close search on outside click (unless clicking on a result)
  useEffect(() => {
    if (!searchOpen) return;
    function handle(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        cancelSearch();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [searchOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSearchKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      cancelSearch();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchFocusIdx((i) => Math.min(i + 1, searchResults.length - 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchFocusIdx((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter" && searchResults.length > 0) {
      confirmResult(searchResults[searchFocusIdx]);
      return;
    }
  }

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
      {/* Left group: workspace name + search */}
      <div className="flex min-w-0 flex-1 items-center gap-3">

      {/* Workspace name + dropdown */}
      <div ref={wsMenuRef} className="relative flex flex-shrink-0 items-center gap-2">
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

      {/* Search bar */}
      <div ref={searchRef} className="relative min-w-0 w-56">
        <div className="relative flex items-center">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 text-[var(--color-text-secondary)] pointer-events-none">
            <circle cx="7" cy="7" r="5" />
            <path d="M11 11l3 3" />
          </svg>
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search tasks…"
            value={searchQuery}
            onFocus={openSearch}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] pl-7 pr-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:outline-none focus:border-[var(--color-accent)] transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(""); onSearchClear?.(); }}
              className="absolute right-2 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M1 1l8 8M9 1L1 9" />
              </svg>
            </button>
          )}
        </div>
        {searchOpen && searchQuery.trim() && (
          <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[280px] overflow-hidden rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] shadow-xl">
            {searchResults.length === 0 ? (
              <div className="px-3 py-2 text-xs text-[var(--color-text-secondary)]">No results</div>
            ) : (
              searchResults.map((task, idx) => (
                <button
                  key={task.id}
                  onMouseDown={(e) => { e.preventDefault(); confirmResult(task); }}
                  onMouseEnter={() => setSearchFocusIdx(idx)}
                  className={[
                    "flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors",
                    idx === searchFocusIdx
                      ? "bg-[var(--color-bg-surface)]"
                      : "hover:bg-[var(--color-bg-surface)]",
                  ].join(" ")}
                >
                  <span className="text-[13px] font-semibold text-[var(--color-text-primary)] truncate">
                    {highlightMatch(task.title, searchQuery)}
                  </span>
                  {task.notes && (
                    <span className="text-[11px] text-[var(--color-text-secondary)] truncate">
                      {highlightMatch(task.notes.slice(0, 120), searchQuery)}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        )}
      </div>

      </div>{/* end left group */}

      {/* Scale dropdown — left of date navigator */}
      <div ref={scaleRef} className="relative" onWheel={handleScaleWheel}>
        <div
          className="flex items-center rounded border border-[var(--color-border)] overflow-hidden"
          onClick={() => { setScaleOpen((o) => !o); setTimeout(() => { scaleInputRef.current?.select(); }, 0); }}
        >
          <input
            ref={scaleInputRef}
            type="text"
            value={scaleDraft}
            onChange={(e) => setScaleDraft(e.target.value)}
            onBlur={commitScaleDraft}
            onKeyDown={(e) => { if (e.key === "Enter") commitScaleDraft(); if (e.key === "Escape") { setScaleDraft(scaleLabel(currentScale)); setScaleOpen(false); } }}
            className="w-14 bg-[var(--color-bg-elevated)] px-2 py-1 text-center text-xs text-[var(--color-text-primary)] focus:outline-none cursor-pointer"
            title="Canvas zoom scale"
          />
          <div className="border-l border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1 py-1">
            <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--color-text-secondary)]">
              <path d="M2 4l3 3 3-3" />
            </svg>
          </div>
        </div>
        {scaleOpen && (
          <div
            className="absolute right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] py-1 shadow-xl"
            style={{ minWidth: "80px" }}
            onWheel={(e) => {
              if (e.ctrlKey) return; // let ctrl+scroll bubble up to the widget handler
              e.stopPropagation();
              // Reduce scroll speed to 1/3
              const el = e.currentTarget;
              el.scrollTop += e.deltaY / 3;
              e.preventDefault();
            }}
          >
            {SCALE_PRESETS.map((s) => (
              <button
                key={s}
                onMouseDown={(e) => { e.preventDefault(); localScaleRef.current = s; setScaleDraft(scaleLabel(s)); setCanvasScale(s); setScaleOpen(false); }}
                className={[
                  "flex w-full items-center justify-center px-3 py-1 text-xs font-medium transition-colors",
                  Math.abs(s - currentScale) < 0.005
                    ? "bg-[var(--color-accent)] text-white"
                    : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)]",
                ].join(" ")}
              >
                {scaleLabel(s)}
              </button>
            ))}
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
