import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspace } from "../context/WorkspaceContext";
import AsanaImportModal from "./AsanaImportModal";
import type { RecentWorkspace } from "../types";

// ---------------------------------------------------------------------------
// Icons (inline SVG — no icon lib dependency)
// ---------------------------------------------------------------------------

function FolderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.5 3.5A1 1 0 0 1 2.5 2.5H6l1.5 1.5H13.5A1 1 0 0 1 14.5 5v7a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1V3.5z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function AsanaIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="6" r="4" />
      <circle cx="6" cy="17" r="4" />
      <circle cx="18" cy="17" r="4" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 3.5V6l1.5 1.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helper: format lastOpened relative date
// ---------------------------------------------------------------------------

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 14) return "last week";
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RecentWorkspaceRow({
  entry,
  onOpen,
  onForget,
}: {
  entry: RecentWorkspace;
  onOpen: (path: string) => void;
  onForget: (path: string) => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-[var(--color-bg-elevated)] transition-colors">
      <button
        className="flex flex-1 items-center gap-3 text-left min-w-0"
        onClick={() => onOpen(entry.folderPath)}
      >
        <span className="text-[var(--color-accent)] shrink-0">
          <FolderIcon />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">
            {entry.name}
          </span>
          <span className="block truncate text-xs text-[var(--color-text-secondary)] mt-0.5">
            {entry.folderPath}
          </span>
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] shrink-0 ml-2">
          <ClockIcon />
          {formatRelativeDate(entry.lastOpened)}
        </span>
      </button>
      <button
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onForget(entry.folderPath);
        }}
        title="Remove from recents"
      >
        <CloseIcon />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkspacePicker() {
  const {
    appConfig,
    loadWorkspace,
    createWorkspace,
    forgetRecentWorkspace,
    isLoading,
    error,
    clearError,
  } = useWorkspace();

  const [mode, setMode] = useState<"idle" | "new">("idle");
  const [newName, setNewName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const displayError = localError ?? error;

  // -------------------------------------------------------------------------

  async function handleOpenFolder() {
    clearError();
    setLocalError(null);
    const folder = await open({
      directory: true,
      multiple: false,
      title: "Open Workspace Folder",
    });
    if (!folder) return; // user cancelled
    await loadWorkspace(folder as string);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      setLocalError("Please enter a workspace name.");
      return;
    }
    clearError();
    setLocalError(null);

    const folder = await open({
      directory: true,
      multiple: false,
      title: "Choose a Folder for the Workspace",
    });
    if (!folder) return; // user cancelled

    await createWorkspace(folder as string, name);
  }

  function handleCancelNew() {
    setMode("idle");
    setNewName("");
    setLocalError(null);
    clearError();
  }

  // -------------------------------------------------------------------------

  return (
    <div className="flex h-full items-center justify-center bg-[var(--color-bg-base)]">
      <div className="w-full max-w-md px-4">
        {/* Wordmark */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-text-primary)]">
            Timeline
          </h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Plan and track your projects on a visual timeline.
          </p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-surface)] overflow-hidden">

          {/* Recent workspaces */}
          {appConfig.recentWorkspaces.length > 0 && mode === "idle" && (
            <div className="border-b border-[var(--color-border)]">
              <p className="px-4 pt-3 pb-1.5 text-xs font-medium uppercase tracking-wider text-[var(--color-text-secondary)]">
                Recent
              </p>
              <div className="px-1 pb-2">
                {appConfig.recentWorkspaces.map((entry) => (
                  <RecentWorkspaceRow
                    key={entry.folderPath}
                    entry={entry}
                    onOpen={loadWorkspace}
                    onForget={forgetRecentWorkspace}
                  />
                ))}
              </div>
            </div>
          )}

          {/* New workspace form */}
          {mode === "new" && (
            <div className="border-b border-[var(--color-border)] px-4 py-4">
              <p className="mb-3 text-sm font-medium text-[var(--color-text-primary)]">
                New Workspace
              </p>
              <label className="block mb-1 text-xs text-[var(--color-text-secondary)]">
                Workspace name
              </label>
              <input
                autoFocus
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") handleCancelNew();
                }}
                placeholder="e.g. Annual Conference Plan"
                className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm text-[var(--color-text-primary)] placeholder-[var(--color-text-secondary)] outline-none focus:border-[var(--color-accent)] transition-colors"
              />
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleCreate}
                  disabled={isLoading}
                  className="flex-1 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {isLoading ? "Creating…" : "Choose Folder & Create"}
                </button>
                <button
                  onClick={handleCancelNew}
                  className="rounded-md border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Primary actions */}
          {mode === "idle" && (
            <div className="flex flex-col gap-2 p-3">
              <div className="flex gap-2">
                <button
                  onClick={handleOpenFolder}
                  disabled={isLoading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-colors"
                >
                  <FolderIcon />
                  {isLoading ? "Opening…" : "Open Folder"}
                </button>
                <button
                  onClick={() => { clearError(); setMode("new"); }}
                  disabled={isLoading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[var(--color-accent)] px-3 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  <PlusIcon />
                  New Workspace
                </button>
              </div>
              <button
                onClick={() => { clearError(); setImportModalOpen(true); }}
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] disabled:opacity-50 transition-colors"
              >
                <AsanaIcon />
                Import from Asana (JSON)
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {displayError && (
          <p className="mt-3 text-center text-sm text-red-400">{displayError}</p>
        )}
      </div>

      {importModalOpen && (
        <AsanaImportModal mode="new" onClose={() => setImportModalOpen(false)} />
      )}
    </div>
  );
}
