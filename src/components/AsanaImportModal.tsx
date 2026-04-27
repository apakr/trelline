import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parseAsanaExport } from "../lib/asanaImport";
import { bulkCreateWorkspace } from "../lib/fs";
import { useWorkspace } from "../context/WorkspaceContext";
import type { AsanaImportPreview } from "../lib/asanaImport";

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function AsanaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="6" r="4" />
      <circle cx="6" cy="17" r="4" />
      <circle cx="18" cy="17" r="4" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2L14.5 13.5H1.5L8 2z" />
      <path d="M8 6.5v3" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 8l4 4 7-7" />
    </svg>
  );
}

function FileJsonIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M10 12.5c0 .83-.67 1.5-1.5 1.5S7 13.33 7 12.5V11" />
      <path d="M14 11v1.5c0 .83.67 1.5 1.5 1.5" />
      <path d="M11 11v4" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AsanaImportModalProps {
  /** "new" = creates a brand-new workspace; "into-current" = appends to open workspace */
  mode: "new" | "into-current";
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Step = "fileSelect" | "preview" | "importing";

export default function AsanaImportModal({ mode, onClose }: AsanaImportModalProps) {
  const { loadWorkspace, importAsanaIntoWorkspace } = useWorkspace();

  const [step, setStep] = useState<Step>("fileSelect");
  const [parseError, setParseError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AsanaImportPreview | null>(null);
  const [workspaceName, setWorkspaceName] = useState("");
  const [isPicking, setIsPicking] = useState(false);

  // -------------------------------------------------------------------------
  // Step 1 — pick and parse the JSON file
  // -------------------------------------------------------------------------

  async function handlePickFile() {
    setParseError(null);
    setIsPicking(true);
    try {
      const filePath = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
        title: "Select Asana JSON Export",
      });
      if (!filePath) return; // user cancelled

      const raw = JSON.parse(await readTextFile(filePath as string));
      const result = parseAsanaExport(raw);

      setPreview(result);
      setWorkspaceName(result.projectName);
      setStep("preview");
    } catch (e) {
      setParseError(
        e instanceof Error ? e.message : "Failed to read or parse the file."
      );
    } finally {
      setIsPicking(false);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2 — confirm and import
  // -------------------------------------------------------------------------

  async function handleImport() {
    if (!preview) return;
    setImportError(null);
    setStep("importing");

    try {
      if (mode === "new") {
        const folderPath = await open({
          directory: true,
          multiple: false,
          title: "Choose a Folder for the New Workspace",
        });
        if (!folderPath) {
          // User cancelled folder picker — go back to preview
          setStep("preview");
          return;
        }
        const name = workspaceName.trim() || preview.projectName;
        await bulkCreateWorkspace(folderPath as string, name, preview.rows, preview.tasks);
        await loadWorkspace(folderPath as string);
        onClose();
      } else {
        await importAsanaIntoWorkspace(preview.rows, preview.tasks);
        onClose();
      }
    } catch (e) {
      setImportError(
        e instanceof Error ? e.message : "Import failed. Please try again."
      );
      setStep("preview");
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const sectionCount = preview?.rows.length ?? 0;
  const taskCount = preview?.tasks.length ?? 0;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative mx-4 w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-[var(--color-accent)]">
              <AsanaIcon />
            </span>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Import from Asana
            </h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-elevated)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M1 1l8 8M9 1L1 9" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">

          {/* ── STEP: fileSelect ── */}
          {step === "fileSelect" && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
                Export your Asana project as JSON{" "}
                <span className="text-[var(--color-text-primary)]">
                  Project → (Your Project Name) → Export / Print → JSON
                </span>
                , then select the file below.
              </p>

              <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                Asana sections become rows. Tasks, milestones, notes, and completion status are all carried over.
              </p>

              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 flex flex-col gap-2">
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  <span className="font-medium text-[var(--color-text-primary)]">No dependencies:</span>{" "}
                  Asana does not include dependency links in JSON exports, so dependency arrows will not be imported.
                </p>
                <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                  <span className="font-medium text-[var(--color-text-primary)]">Subtasks:</span>{" "}
                  Trelline doesn't have subtasks. Any subtasks from Asana will be imported as regular tasks and placed below their parent task in the same row.
                </p>
              </div>

              {parseError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                  <WarningIcon />
                  <span>{parseError}</span>
                </div>
              )}

              <button
                onClick={handlePickFile}
                disabled={isPicking}
                className="flex items-center justify-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-colors"
              >
                <FileJsonIcon />
                {isPicking ? "Reading file…" : "Select Asana JSON File"}
              </button>

              <div className="flex justify-end pt-1">
                <button
                  onClick={onClose}
                  className="text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: preview ── */}
          {step === "preview" && preview && (
            <div className="flex flex-col gap-4">

              {/* Success badge */}
              <div className="flex items-center gap-2 text-xs text-emerald-400">
                <CheckIcon />
                <span>Parsed successfully</span>
              </div>

              {/* Workspace name (editable in "new" mode only) */}
              {mode === "new" && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-[var(--color-text-secondary)]">
                    Workspace name
                  </label>
                  <input
                    autoFocus
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleImport(); }}
                    className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors"
                  />
                </div>
              )}

              {/* Stats */}
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-text-secondary)]">Rows (from sections)</span>
                  <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{sectionCount}</span>
                </div>
                <div className="my-2 border-t border-[var(--color-border)]" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--color-text-secondary)]">Tasks</span>
                  <span className="font-semibold tabular-nums text-[var(--color-text-primary)]">{taskCount}</span>
                </div>
              </div>

              {/* Warnings */}
              {preview.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-3">
                  <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-amber-400">
                    <WarningIcon />
                    <span>Notes</span>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {preview.warnings.map((w, i) => (
                      <li key={i} className="text-xs text-amber-300/90">
                        • {w}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {importError && (
                <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                  <WarningIcon />
                  <span>{importError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => { setStep("fileSelect"); setPreview(null); }}
                  className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImport}
                  className="flex-1 rounded-md bg-[var(--color-accent)] px-3 py-2 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                >
                  {mode === "new" ? "Choose Folder & Import" : "Import into workspace"}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: importing ── */}
          {step === "importing" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">
                {mode === "new" ? "Creating workspace…" : "Importing tasks…"}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
