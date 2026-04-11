import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "./context/WorkspaceContext";
import { loadAppConfig } from "./lib/appStore";
import WorkspacePicker from "./components/WorkspacePicker";
import TimelineView from "./components/timeline/TimelineView";
import ErrorBoundary from "./components/ErrorBoundary";

export default function App() {
  const { workspaceState, loadWorkspace, refreshAppConfig } = useWorkspace();
  const [isInitializing, setIsInitializing] = useState(true);

  // Capture a stable ref to loadWorkspace so the effect below never needs to
  // re-run if the context value object changes between renders.
  const loadWorkspaceRef = useRef(loadWorkspace);
  const refreshAppConfigRef = useRef(refreshAppConfig);

  // Auto-load the last-used workspace on first mount.
  // deps=[] — runs exactly once. The useRef guard is an extra safety net
  // against React StrictMode's intentional double-invoke in development.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;

    async function tryAutoLoad() {
      try {
        const config = await loadAppConfig();
        await refreshAppConfigRef.current();
        if (config.recentWorkspaces.length > 0) {
          await loadWorkspaceRef.current(config.recentWorkspaces[0].folderPath);
        }
      } catch {
        // Non-fatal — fall through to WorkspacePicker
      } finally {
        setIsInitializing(false);
      }
    }

    tryAutoLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-bg-base)]">
        <span className="text-sm text-[var(--color-text-secondary)]">Loading…</span>
      </div>
    );
  }

  if (!workspaceState) {
    return <WorkspacePicker />;
  }

  return (
    <ErrorBoundary>
      <TimelineView />
    </ErrorBoundary>
  );
}
