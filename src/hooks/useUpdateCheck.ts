import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

interface UpdateInfo {
  updateAvailable: boolean;
  latestVersion: string;
}

const RELEASES_API = "https://api.github.com/repos/apakr/trelline/releases/latest";

function parseVersion(tag: string): number[] {
  return tag.replace(/^v/, "").split(".").map(Number);
}

function isNewer(latest: string, current: string): boolean {
  const l = parseVersion(latest);
  const c = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((l[i] ?? 0) > (c[i] ?? 0)) return true;
    if ((l[i] ?? 0) < (c[i] ?? 0)) return false;
  }
  return false;
}

export function useUpdateCheck(): UpdateInfo {
  const [info, setInfo] = useState<UpdateInfo>({ updateAvailable: false, latestVersion: "" });

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const current = await getVersion();
        const res = await fetch(RELEASES_API, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (!res.ok) return;
        const data = await res.json();
        const tag: string = data.tag_name ?? "";
        if (!cancelled && tag && isNewer(tag, current)) {
          setInfo({ updateAvailable: true, latestVersion: tag.replace(/^v/, "") });
        }
      } catch {
        // silently swallow — offline or rate-limited
      }
    }
    check();
    return () => { cancelled = true; };
  }, []);

  return info;
}
