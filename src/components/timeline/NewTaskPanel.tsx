import { useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { useLoadedWorkspace } from "../../context/WorkspaceContext";

interface NewTaskPanelProps {
  defaultDate: string; // YYYY-MM-DD — the current canvas center date
}

export default function NewTaskPanel({ defaultDate }: NewTaskPanelProps) {
  const { workspace, createTask, setPanel } = useLoadedWorkspace();
  const rows = workspace.rows.slice().sort((a, b) => a.order - b.order);

  const safeDefault = defaultDate || format(new Date(), "yyyy-MM-dd");

  const [title, setTitle] = useState("");
  const [rowId, setRowId] = useState(rows[0]?.id ?? "");
  const [startDate, setStartDate] = useState(safeDefault);
  const [endDate, setEndDate] = useState(() => {
    try {
      const d = parseISO(safeDefault);
      return format(addDays(d, 7), "yyyy-MM-dd");
    } catch {
      return safeDefault;
    }
  });
  const [isMilestone, setIsMilestone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !rowId) return;
    setSubmitting(true);
    try {
      await createTask({
        title: title.trim(),
        rowId,
        start: startDate,
        end: isMilestone ? startDate : endDate,
        isMilestone,
      });
      setPanel({ type: "none" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 z-10 flex w-80 flex-col border-l border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-xl">
      {/* Header */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">New Task</span>
        <button
          onClick={() => setPanel({ type: "none" })}
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Title */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task name"
            autoFocus
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        {/* Row */}
        {rows.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">Row</label>
            <select
              value={rowId}
              onChange={(e) => setRowId(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            >
              {rows.map((row) => (
                <option key={row.id} value={row.id}>{row.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Milestone toggle */}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={isMilestone}
            onChange={(e) => setIsMilestone(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <span className="text-sm text-[var(--color-text-primary)]">Milestone</span>
        </label>

        {/* Start date */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--color-text-secondary)]">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>

        {/* End date — hidden when milestone */}
        {!isMilestone && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent)] focus:outline-none"
            />
          </div>
        )}

        <div className="mt-auto pt-2">
          <button
            type="submit"
            disabled={!title.trim() || !rowId || submitting}
            className="w-full rounded bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create Task
          </button>
        </div>
      </form>
    </div>
  );
}
