import { useState, useEffect } from "react";
import type { TaskStatus } from "../../types";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";

interface TaskDetailPanelProps {
  taskId: string;
}

export default function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const { workspace, tasks, updateTask, deleteTask, setPanel } = useLoadedWorkspace();
  const rows = workspace.rows.slice().sort((a, b) => a.order - b.order);
  const task = tasks.find((t) => t.id === taskId);

  // Local draft state for blur-saved fields
  const [draftTitle, setDraftTitle] = useState(task?.title ?? "");
  const [draftStart, setDraftStart] = useState(task?.start ?? "");
  const [draftEnd, setDraftEnd] = useState(task?.end ?? "");
  const [draftNotes, setDraftNotes] = useState(task?.notes ?? "");

  // Reset drafts when switching to a different task
  useEffect(() => {
    if (task) {
      setDraftTitle(task.title);
      setDraftStart(task.start);
      setDraftEnd(task.end);
      setDraftNotes(task.notes);
    }
  }, [taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!task) return null;

  async function handleTitleBlur() {
    const trimmed = draftTitle.trim();
    if (!trimmed) {
      setDraftTitle(task!.title);
      return;
    }
    if (trimmed !== task!.title) {
      await updateTask(taskId, { title: trimmed });
    }
  }

  async function handleStartBlur() {
    if (draftStart && draftStart !== task!.start) {
      await updateTask(taskId, { start: draftStart });
    } else {
      setDraftStart(task!.start);
    }
  }

  async function handleEndBlur() {
    if (draftEnd && draftEnd !== task!.end) {
      await updateTask(taskId, { end: draftEnd });
    } else {
      setDraftEnd(task!.end);
    }
  }

  async function handleNotesBlur() {
    if (draftNotes !== task!.notes) {
      await updateTask(taskId, { notes: draftNotes });
    }
  }

  async function handleDelete() {
    await deleteTask(taskId);
    setPanel({ type: "none" });
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 z-10 flex w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl">
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
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Start Date</label>
          <input
            type="date"
            value={draftStart}
            onChange={(e) => setDraftStart(e.target.value)}
            onBlur={handleStartBlur}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        {/* End date — hidden if milestone */}
        {!task.isMilestone && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">End Date</label>
            <input
              type="date"
              value={draftEnd}
              onChange={(e) => setDraftEnd(e.target.value)}
              onBlur={handleEndBlur}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
        )}

        {/* Notes */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Notes</label>
          <textarea
            value={draftNotes}
            onChange={(e) => setDraftNotes(e.target.value)}
            onBlur={handleNotesBlur}
            rows={4}
            className="resize-none rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
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
