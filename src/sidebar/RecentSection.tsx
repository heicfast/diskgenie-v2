/**
 * Sidebar §2 (spec §6.4): the last 2 scanned paths in localStorage,
 * one click navigates into the current tree (no rescan) when the path
 * is inside it — a fresh scan only when it isn't (senior-UX: recents
 * are destinations first, scan targets second).
 */
import { useEffect, useState } from "react";
import { Clock3Icon } from "../components/Icon";
import { SectionCaption } from "../components/buttons";
import { invoke } from "../lib/ipc";
import { useExploreStore } from "../state/explore";
import { useScanStore } from "../state/scan";
import { useViewStore } from "../state/view";

const KEY = "diskgenie.recent";
const MAX = 2;
/** RecentSection listens for this after every push so the list updates
 * live in the same page (no focus/reload needed). */
const RECENTS_EVENT = "diskgenie.recents-changed";

/** ONE normalization point for scan-target labels (session 13): the
 * This-PC target is "ThisPC" at the command seam, "This PC" as a
 * display label — both spellings landed in Recents as two
 * near-identical rows after an elevated --scan relaunch (the raw
 * hook value vs the scanning-transition's normalized one). Every
 * entry is display-shaped BEFORE the dedupe, so any spelling of the
 * same target collapses to one row. */
import { ROOT_VIEW_LABEL } from "../lib/platform";

export function recentTargetLabel(path: string): string {
  return /^this ?pc$/i.test(path.trim()) ? ROOT_VIEW_LABEL : path;
}

/** Case-insensitive recents identity (Windows paths; "C:\A" and
 * "c:\a" are the same destination). */
const sameTarget = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();
export function pushRecent(path: string): void {
  try {
    const label = recentTargetLabel(path);
    const list: string[] = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    const next = [label, ...list.filter((p) => !sameTarget(recentTargetLabel(p), label))].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(RECENTS_EVENT));
  } catch {
    /* storage unavailable — Recent simply stays empty */
  }
}

export function RecentSection() {
  const [recent, setRecent] = useState<string[]>([]);
  const startScan = useScanStore((s) => s.startScan);
  const status = useScanStore((s) => s.status);
  const generation = useScanStore((s) => s.generation);
  const openFolder = useExploreStore((s) => s.openFolder);
  const setTab = useViewStore((s) => s.setTab);

  useEffect(() => {
    const read = () => {
      try {
        setRecent(JSON.parse(window.localStorage.getItem(KEY) ?? "[]"));
      } catch {
        setRecent([]);
      }
    };
    read();
    const onFocus = () => read();
    const onRecents = () => read();
    window.addEventListener("focus", onFocus);
    window.addEventListener(RECENTS_EVENT, onRecents);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(RECENTS_EVENT, onRecents);
    };
  }, []);

  if (recent.length === 0) return null;

  /** Navigate into the current tree when possible; scan otherwise.
   * The whole-machine row (ROOT_VIEW_LABEL) navigates to the tree
   * ROOT when the standing scan already IS the whole-PC scan (the
   * session-13 report: the row restarted a full rescan every click,
   * even seconds after the scan finished). */
  const open = async (p: string) => {
    setTab("explore");
    const label = recentTargetLabel(p);
    if (label === ROOT_VIEW_LABEL) {
      if (status === "done" && /^this ?pc$/i.test(useScanStore.getState().scanTarget)) {
        useExploreStore.getState().resetNavigation();
        return;
      }
      void startScan("ThisPC");
      return;
    }
    if (status === "done") {
      try {
        const id = await invoke<number | null>("resolve_path", { generation, path: p });
        if (id != null) {
          openFolder(id);
          return;
        }
      } catch {
        /* fall through to a fresh scan */
      }
    }
    void startScan(p);
  };

  return (
    <>
      <SectionCaption>Recent</SectionCaption>
      <div className="db-recent-list">
        {recent.map((p) => (
          <button
            key={p}
            type="button"
            className="db-recent"
            title={status === "done" ? `Go to ${p}` : `Scan ${p}`}
            onClick={() => void open(p)}
          >
            <Clock3Icon size={13} />
            <span>{p}</span>
          </button>
        ))}
      </div>
    </>
  );
}
