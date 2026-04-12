import { useState, useEffect, useRef } from "react";
import type { TaskStatus } from "../../types";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";
import PanelDateField from "./PanelDateField";
import RichTextEditor from "./RichTextEditor";

interface TaskDetailPanelProps {
  taskId: string;
}

export default function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const { workspace, tasks, updateTask, deleteTask, setPanel } = useLoadedWorkspace();
  const rows = workspace.rows.slice().sort((a, b) => a.order - b.order);
  const task = tasks.find((t) => t.id === taskId);

  // Set to true when Escape closes the panel — blur handlers check this to skip saving
  const skipSaveRef = useRef(false);

  // Local draft state for the title (blur-saved); notes save on every keystroke
  const [draftTitle, setDraftTitle] = useState(task?.title ?? "");

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        skipSaveRef.current = true;
        setPanel({ type: "none" });
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset title draft when switching to a different task
  useEffect(() => {
    if (task) setDraftTitle(task.title);
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  async function handleTitleBlur() {
    if (skipSaveRef.current) return;
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(task!.title);
      return;
    }
    if (trimmed !== task!.title) {
      await updateTask(taskId, { title: trimmed });
    }
  }

  async function handleDelete() {
    await deleteTask(taskId);
    setPanel({ type: "none" });
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 z-10 flex w-[480px] flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">Task</span>
        <button
          onClick={() => setPanel({ type: "none" })}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>

      {/* Fields */}
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Title */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Title</label>
          <input
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={handleTitleBlur}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Status</label>
          <select
            value={task.status}
            onChange={(e) => updateTask(taskId, { status: e.target.value as TaskStatus })}
            style={{ colorScheme: "dark" }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          >
            <option value="not_done">Not Done</option>
            <option value="done">Done</option>
          </select>
        </div>

        {/* Row */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Row</label>
          <select
            value={task.rowId}
            onChange={(e) => updateTask(taskId, { rowId: e.target.value })}
            style={{ colorScheme: "dark" }}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          >
            {rows.map((row) => (
              <option key={row.id} value={row.id}>{row.name}</option>
            ))}
          </select>
        </div>

        {/* Color */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Color</label>
          <input
            type="color"
            value={task.color}
            onChange={(e) => updateTask(taskId, { color: e.target.value })}
            className="h-8 w-full cursor-pointer rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-1 py-0.5"
          />
        </div>

        {/* Milestone toggle */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={task.isMilestone}
            onChange={(e) => updateTask(taskId, { isMilestone: e.target.checked })}
            className="accent-[var(--color-accent)]"
          />
          <span className="text-sm text-[var(--color-text-primary)]">Milestone</span>
        </label>

        {/* Start date */}
        <PanelDateField
          label="Start Date"
          value={task.start}
          onChange={(dateStr) => updateTask(taskId, { start: dateStr })}
        />

        {/* End date — hidden if milestone */}
        {!task.isMilestone && (
          <PanelDateField
            label="End Date"
            value={task.end}
            onChange={(dateStr) => updateTask(taskId, { end: dateStr })}
          />
        )}

        {/* Description */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Description</label>
          <RichTextEditor
            value={task.notes}
            onChange={(md) => updateTask(taskId, { notes: md })}
          />
        </div>
      </div>

      {/* Delete */}
      <div className="flex-shrink-0 border-t border-[var(--color-border)] p-4">
        <button
          onClick={handleDelete}
          className="w-full rounded border border-red-500/50 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
        >
          Delete Task
        </button>
      </div>
    </div>
  );
}
