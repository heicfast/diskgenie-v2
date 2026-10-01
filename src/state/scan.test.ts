/**
 * Scan store tests (session 14): the instant-restore adoption (the
 * drive-flip fix) and the unified `adoptDone` — every arrival route
 * (event, reconcile, watchdog, restore return) must run the SAME
 * adoption, including the per-id cache invalidations the reconcile
 * path used to skip (stale hover/layout entries from the previous
 * target's arena).
 *
 * Node-env shims (the store is browser-bound; vitest runs node):
 * window/localStorage for the denied-notice write, the mock backend
 * seam (`setMockBackend`) for scripted command responses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class MemStorage {
  private map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}
const shim = {
  localStorage: new MemStorage(),
  dispatchEvent: vi.fn(() => true),
  setInterval: vi.fn(() => 0),
  clearInterval: vi.fn(),
  setTimeout: (fn: () => void, _ms?: number) => {
    fn();
    return 0;
  },
};
(globalThis as Record<string, unknown>).window = shim;

// Import AFTER the shim exists.
import { emitMockEvent, setMockBackend } from "../lib/ipc";
import { useDupesStore } from "./dupes";
import { useExploreStore } from "./explore";
import { useScanStore } from "./scan";

const resetStores = (): void => {
  useScanStore.setState({
    status: "idle",
    generation: 0,
    progress: null,
    stats: null,
    error: null,
    scanTarget: "ThisPC",
    scanDurationMs: null,
    turboFallback: null,
    turboReport: null,
  });
  useDupesStore.setState({ running: false, cancelling: false, progress: null, result: null, error: null, scopePath: null });
  useExploreStore.setState({ currentFolder: 0, selectedNode: null, folderStack: [], viewPath: "", viewName: null });
};

describe("startScan instant restore (session 14 drive-flip fix)", () => {
  beforeEach(() => {
    resetStores();
    setMockBackend(null);
  });

  it("a restored result adopts done directly — no scanning state, no status poll", async () => {
    const calls: string[] = [];
    setMockBackend(async (cmd) => {
      calls.push(cmd);
      if (cmd === "start_scan") {
        return { generation: 7, restored: true, stats: [100, 90, 8, 2] };
      }
      return null;
    });
    await useScanStore.getState().startScan("D:\\");
    const s = useScanStore.getState();
    expect(s.status).toBe("done");
    expect(s.generation).toBe(7);
    expect(s.scanTarget).toBe("D:\\");
    expect(s.stats).toEqual({ logical: 100, onDisk: 90, files: 8, folders: 2 });
    // The restore path never polls get_status (the reconcile is for
    // scans that might still be running).
    expect(calls).toEqual(["start_scan"]);
  });

  it("a restore resets navigation — stale arena ids must never survive a tree swap", async () => {
    // The user drilled into folder 47 on the C: tree, then flipped to
    // D:. The restore swaps the WHOLE tree: id 47 in the D: arena is an
    // unrelated node (or nothing). Status never leaves "done" on a
    // restore, so App.tsx's [status]-transition reset cannot fire —
    // adoptDone owns it.
    useExploreStore.setState({ currentFolder: 47, selectedNode: 52, folderStack: [0, 12, 47] });
    setMockBackend(async (cmd) => {
      if (cmd === "start_scan") {
        return { generation: 15, restored: true, stats: [9, 9, 2, 1] };
      }
      return null;
    });
    await useScanStore.getState().startScan("D:\\");
    const nav = useExploreStore.getState();
    expect(nav.currentFolder).toBe(0);
    expect(nav.selectedNode).toBeNull();
    expect(nav.folderStack).toEqual([]);
  });

  it("a restored adoption retires a stale duplicates result (the unified invalidation)", async () => {
    useDupesStore.setState({
      result: { generation: 999, groups: [], wastedTotal: 0, files: 0, scopePath: null },
    });
    setMockBackend(async (cmd) => {
      if (cmd === "start_scan") {
        return { generation: 12, restored: true, stats: [10, 10, 1, 0] };
      }
      return null;
    });
    await useScanStore.getState().startScan("C:\\");
    expect(useDupesStore.getState().result).toBeNull();
  });

  it("a fresh result enters the scanning state as before", async () => {
    setMockBackend(async (cmd) => {
      if (cmd === "get_status") {
        return {
          scanning: true,
          lastDone: null,
        };
      }
      return { generation: 8, restored: false, stats: null };
    });
    await useScanStore.getState().startScan("C:\\");
    const s = useScanStore.getState();
    expect(s.status).toBe("scanning");
    expect(s.generation).toBe(8);
    expect(s.stats).toBeNull();
    // Cleanup only (the revert target depends on module-level tree
    // state earlier tests set — not asserted).
    useScanStore.getState().cancelScan();
  });
});

describe("adoptDone unification (the reconcile gap)", () => {
  beforeEach(() => {
    resetStores();
    setMockBackend(null);
  });

  it("a stale generation event is dropped; the reconcile adopts with invalidations", async () => {
    // The tiny-tree timing: scan-done fired while the store still held
    // the old generation (the event is stale-dropped), get_status
    // replays the outcome. The dupes retirement proves the reconcile
    // path now runs the SAME invalidations as the event path (the
    // session-14 latent bug: it skipped them).
    useDupesStore.setState({
      result: { generation: 999, groups: [], wastedTotal: 0, files: 0, scopePath: null },
    });
    setMockBackend(async (cmd) => {
      if (cmd === "start_scan") {
        return { generation: 20, restored: false, stats: null };
      }
      if (cmd === "get_status") {
        return {
          scanning: false,
          lastDone: { generation: 20, stats: [5, 5, 1, 0], error: null },
        };
      }
      return null;
    });
    await useScanStore.getState().startScan("C:\\");
    const s = useScanStore.getState();
    expect(s.status).toBe("done");
    expect(s.generation).toBe(20);
    expect(s.stats).toEqual({ logical: 5, onDisk: 5, files: 1, folders: 0 });
    expect(useDupesStore.getState().result).toBeNull();
    useScanStore.getState().cancelScan();
  });

  it("the scan-done event adopts when the generation matches", async () => {
    setMockBackend(async (cmd) => {
      if (cmd === "get_status") {
        return { scanning: true, lastDone: null };
      }
      return { generation: 30, restored: false, stats: null };
    });
    // Backend FIRST, then attach: `listen` routes to the mock bus only
    // while a backend is installed (the attach-once flag means a
    // registration attempted without one never retries).
    useScanStore.getState().ensureListeners();
    await new Promise((r) => setTimeout(r, 0));
    await useScanStore.getState().startScan("ThisPC");
    // The listener attach is module-global-once; scan-done routes
    // through the mock bus the listeners registered on.
    emitMockEvent("scan-done", { generation: 30, stats: [50, 40, 4, 1], error: null });
    const s = useScanStore.getState();
    expect(s.status).toBe("done");
    expect(s.stats).toEqual({ logical: 50, onDisk: 40, files: 4, folders: 1 });
    useScanStore.getState().cancelScan();
  });

  it("an error outcome lands in the error state from the event route", async () => {
    setMockBackend(async (cmd) => {
      if (cmd === "get_status") {
        return { scanning: true, lastDone: null };
      }
      return { generation: 40, restored: false, stats: null };
    });
    useScanStore.getState().ensureListeners();
    await new Promise((r) => setTimeout(r, 0));
    await useScanStore.getState().startScan("E:\\");
    emitMockEvent("scan-done", { generation: 40, stats: null, error: "The drive is not ready." });
    const s = useScanStore.getState();
    expect(s.status).toBe("error");
    expect(s.error).toBe("The drive is not ready.");
  });
});
