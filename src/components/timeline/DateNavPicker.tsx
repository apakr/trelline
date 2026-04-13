import { useState } from "react";
import {
  format,
  startOfMonth,
  startOfDay,
  addMonths,
  subMonths,
  addYears,
  subYears,
  addDays,
  subDays,
  getDaysInMonth,
  getDay,
  isSameDay,
  isSameMonth,
  isValid,
} from "date-fns";

interface DateNavPickerProps {
  initialDate: Date;
  onConfirm: (date: Date) => void;
  onCancel: () => void;
  displayFormat?: string; // date-fns format string, e.g. "yyyy-MM-dd" or "yyyy-dd-MM"
}

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Try to parse a freeform date string. Accepts YYYY-MM-DD, MM/DD/YYYY,
 *  "Jan 1 2020", "1 January 2020", and anything new Date() understands. */
function parseUserDate(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const d = new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
    return isValid(d) ? startOfDay(d) : null;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const mdyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (mdyMatch) {
    const d = new Date(+mdyMatch[3], +mdyMatch[1] - 1, +mdyMatch[2]);
    return isValid(d) ? startOfDay(d) : null;
  }

  // Fallback: let the JS engine try (handles "Jan 1, 2020", "1 January 2020", etc.)
  const d = new Date(s);
  return isValid(d) && !isNaN(d.getTime()) ? startOfDay(d) : null;
}

export default function DateNavPicker({ initialDate, onConfirm, onCancel, displayFormat = "yyyy-MM-dd" }: DateNavPickerProps) {
  const today = startOfDay(new Date());
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(initialDate));
  const [selected, setSelected]   = useState<Date>(() => startOfDay(initialDate));

  // Text input state — tracks the raw string the user is typing
  const [textValue, setTextValue]   = useState(() => format(initialDate, displayFormat));
  const [textError,  setTextError]  = useState(false);

  function applyTextDate() {
    const parsed = parseUserDate(textValue);
    if (parsed) {
      setSelected(parsed);
      setViewMonth(startOfMonth(parsed));
      setTextError(false);
    } else {
      setTextError(true);
    }
  }

  function handleTextKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      applyTextDate();
    }
    if (e.key === "Escape") onCancel();
    setTextError(false); // clear error as soon as they start typing again
  }

  function handleDayClick(d: Date) {
    const day = startOfDay(d);
    setSelected(day);
    setTextValue(format(day, displayFormat));
    setTextError(false);
  }

  // Build a 6×7 grid of dates
  const firstOfMonth = viewMonth;
  const startDow     = getDay(firstOfMonth); // 0 = Sun
  const daysInMonth  = getDaysInMonth(viewMonth);

  const cells: Date[] = [];
  for (let i = startDow - 1; i >= 0; i--) cells.push(subDays(firstOfMonth, i + 1));
  for (let d = 0; d < daysInMonth; d++) cells.push(addDays(firstOfMonth, d));
  const nextStart = addDays(firstOfMonth, daysInMonth);
  let fill = 0;
  while (cells.length < 42) cells.push(addDays(nextStart, fill++));

  return (
    <div
      className="absolute left-0 top-full z-50 mt-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-surface)] p-3 shadow-2xl"
      style={{ minWidth: 252 }}
    >
      {/* Month / year navigation */}
      <div className="mb-2 flex items-center justify-between gap-0.5">
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          title="Previous year"
          onClick={() => setViewMonth(subYears(viewMonth, 1))}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 1L4 5l4 4M5 1L1 5l4 4" />
          </svg>
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          title="Previous month"
          onClick={() => setViewMonth(subMonths(viewMonth, 1))}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7 1L3 5l4 4" />
          </svg>
        </button>

        <span className="flex-1 text-center text-xs font-semibold text-[var(--color-text-primary)]">
          {format(viewMonth, "MMMM yyyy")}
        </span>

        <button
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          title="Next month"
          onClick={() => setViewMonth(addMonths(viewMonth, 1))}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 1l4 4-4 4" />
          </svg>
        </button>
        <button
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)]"
          title="Next year"
          onClick={() => setViewMonth(addYears(viewMonth, 1))}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 1l4 4-4 4M5 1l4 4-4 4" />
          </svg>
        </button>
      </div>

      {/* Freeform date text input */}
      <div className="mb-2">
        <input
          type="text"
          value={textValue}
          onChange={(e) => { setTextValue(e.target.value); setTextError(false); }}
          onKeyDown={handleTextKeyDown}
          onBlur={applyTextDate}
          placeholder={displayFormat.toUpperCase()}
          className={[
            "w-full rounded border px-2 py-1 text-center text-xs focus:outline-none transition-colors",
            textError
              ? "border-red-500 bg-[var(--color-bg-elevated)] text-red-400"
              : "border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)] focus:border-[var(--color-accent)]",
          ].join(" ")}
        />
        {textError && (
          <p className="mt-0.5 text-center text-[10px] text-red-400">
            Enter a date like 1865-04-09 or Apr 9 1865
          </p>
        )}
      </div>

      {/* Day-of-week headers */}
      <div className="mb-1 grid grid-cols-7">
        {DOW.map((d) => (
          <div key={d} className="text-center text-[10px] font-medium text-[var(--color-text-secondary)] opacity-50">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) => {
          const inMonth    = isSameMonth(d, viewMonth);
          const isSelected = isSameDay(d, selected);
          const isToday    = isSameDay(d, today);
          return (
            <button
              key={i}
              onClick={() => handleDayClick(d)}
              className={[
                "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] transition-colors",
                isSelected
                  ? "bg-[var(--color-accent)] font-semibold text-white"
                  : isToday
                  ? "font-semibold text-[var(--color-accent)] ring-1 ring-[var(--color-accent)] ring-inset"
                  : inMonth
                  ? "text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)]"
                  : "text-[var(--color-text-secondary)] opacity-25 hover:bg-[var(--color-bg-elevated)] hover:opacity-50",
              ].join(" ")}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>

      {/* Go / Cancel */}
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(selected)}
          className="rounded bg-[var(--color-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          Go
        </button>
      </div>
    </div>
  );
}
