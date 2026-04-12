import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { format, parseISO, isValid, startOfDay } from "date-fns";
import DateNavPicker from "./DateNavPicker";

interface PanelDateFieldProps {
  label: string;
  value: string; // YYYY-MM-DD
  onChange: (dateStr: string) => void;
}

/**
 * A date field for the task panels that opens the custom calendar picker.
 * The picker is rendered via a portal so it escapes the panel's overflow-y-auto
 * scroll container without being clipped.
 *
 * Positioning: a zero-height `position:fixed` anchor is placed at the button's
 * bottom edge. DateNavPicker's own `absolute top-full` resolves to top:0 on a
 * zero-height parent, so it appears exactly at that fixed position in the viewport.
 */
export default function PanelDateField({ label, value, onChange }: PanelDateFieldProps) {
  const [open, setOpen] = useState(false);
  const [anchorTop, setAnchorTop] = useState(0);
  const [anchorLeft, setAnchorLeft] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Close when clicking outside both the trigger button and the picker
  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !pickerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  function openPicker() {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const pickerWidth = 260;
    const left = Math.min(rect.left, window.innerWidth - pickerWidth - 8);
    setAnchorTop(rect.bottom);
    setAnchorLeft(left);
    setOpen(true);
  }

  const parsed = (() => {
    if (!value) return startOfDay(new Date());
    try {
      const d = parseISO(value);
      return isValid(d) ? d : startOfDay(new Date());
    } catch {
      return startOfDay(new Date());
    }
  })();

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</label>
      <button
        ref={btnRef}
        type="button"
        onClick={openPicker}
        className="rounded border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-2 py-1.5 text-left text-sm text-[var(--color-text-primary)] transition-colors hover:border-[var(--color-accent)] focus:outline-none"
      >
        {value || "Select date"}
      </button>

      {open && createPortal(
        // Zero-height fixed anchor: DateNavPicker's `absolute top-full` resolves
        // to top:0 on a 0-height parent, placing it exactly at anchorTop.
        <div
          ref={pickerRef}
          style={{
            position: "fixed",
            top: anchorTop,
            left: anchorLeft,
            height: 0,
            width: 0,
            zIndex: 9999,
          }}
        >
          <DateNavPicker
            initialDate={parsed}
            onConfirm={(d) => {
              onChange(format(d, "yyyy-MM-dd"));
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </div>,
        document.body
      )}
    </div>
  );
}
