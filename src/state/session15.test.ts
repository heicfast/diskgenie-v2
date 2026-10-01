/**
 * Session-15 tests: the view-location single source of truth (the
 * sidebar drive-flip fix) and the scoped duplicates run (the Focus
 * slot's replacement).
 *
 * - explore store: `viewPath` / `viewName` are written by exactly ONE
 *   resolver (the App shell) and cleared with navigation resets —
 *   the drive chips and the storage card derive everything from them.
 * - dupes store: `start` carries the scope node (the inspector's
 *   launchpad), adopts the RESULT's authoritative scopePath, and
 *   clears the framing on cancel/failure.
 * - mock parity: `disk_storage(path)` answers per-volume (the exact
 *   defect the owner reported — one shape for every drive), and
 *   `find_duplicates(node)` filters to groups fully inside the scope.
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
  // Real intervals (fast: the mock's step counter advances 200 ms of
  // engine time PER CALL, so a 1 ms real cadence finishes a ~1 s run
  // in a handful of real ticks) — the dupes ticker must actually fire
  // for the direct registry tests.
  setInterval: (fn: () => void, _ms?: number) => globalThis.setInterval(fn, 1),
  clearInterval: (id: number) => globalThis.clearInterval(id),
  setTimeout: (fn: () => void, _ms?: number) => {
    fn();
    return 0;
  },
};
(globalThis as Record<string, unknown>).window = shim;

// Import AFTER the shim exists.
import { setMockBackend } from "../lib/ipc";
import { useDupesStore } from "./dupes";
import { useExploreStore } from "./explore";
import { useScanStore } from "./scan";
import { commands } from "../mock/commands";

const resetStores = (): void => {
  useScanStore.setState({
    status: "done",
    generation: 7,
    progress: null,
    stats: { logical: 100, onDisk: 90, files: 8, folders: 2 },
    error: null,
    scanTarget: "ThisPC",
    scanDurationMs: 1000,
    turboFallback: null,
    turboReport: null,
  });
  useDupesStore.setState({
    running: false,
    cancelling: false,
    progress: null,
    result: null,
    error: null,
    scopePath: null,
  });
  useExploreStore.setState({
    currentFolder: 0,
    selectedNode: null,
    folderStack: [],
    viewPath: "",
    viewName: null,
  });
};

beforeEach(() => {
  resetStores();
  setMockBackend(null);
});

describe("explore store view location (session 15)", () => {
  it("holds the resolved path/name and resetNavigation clears them", () => {
    // The ONE resolver writes both fields together.
    useExploreStore.setState({ viewPath: "D:\\Games", viewName: "Games" });
    expect(useExploreStore.getState().viewPath).toBe("D:\\Games");
    expect(useExploreStore.getState().viewName).toBe("Games");
    // A tree swap resets navigation — the old path describes a dead
    // arena, so it must not survive into the new tree's view.
    useExploreStore.getState().resetNavigation();
    expect(useExploreStore.getState().viewPath).toBe("");
    expect(useExploreStore.getState().viewName).toBeNull();
  });

  it("openFolder navigation does NOT guess the path (the resolver owns it)", () => {
    useExploreStore.setState({ viewPath: "C:\\Users", viewName: "Users" });
    useExploreStore.getState().openFolder(4);
    // The id changed; the path stays until the resolver lands the new
    // one — never a locally-derived guess that could disagree with
    // node_details.
    expect(useExploreStore.getState().currentFolder).toBe(4);
    expect(useExploreStore.getState().viewPath).toBe("C:\\Users");
  });
});

describe("dupes store scoped runs (session 15)", () => {
  it("start passes the scope node; the result's scopePath is authoritative", async () => {
    const seen: Record<string, unknown>[] = [];
    setMockBackend(async (cmd, args) => {
      if (cmd === "find_duplicates") {
        seen.push(args as Record<string, unknown>);
        return {
          generation: 7,
          groups: [],
          wastedTotal: 0,
          files: 10,
          scopePath: "C:\\Users\\dev\\Pictures",
        };
      }
      return null;
    });
    useDupesStore.getState().start(7, 42, "C:\\Users\\dev");
    // The optimistic framing lands immediately (the busy row shows it).
    expect(useExploreStore.getState().viewPath).toBe("");
    expect(useDupesStore.getState().scopePath).toBe("C:\\Users\\dev");
    await vi.waitFor(() => {
      expect(useDupesStore.getState().running).toBe(false);
    });
    expect(seen[0]?.node).toBe(42);
    // The RESULT's framing wins (the backend normalized/owned it).
    expect(useDupesStore.getState().scopePath).toBe("C:\\Users\\dev\\Pictures");
    expect(useDupesStore.getState().result?.scopePath).toBe("C:\\Users\\dev\\Pictures");
  });

  it("a whole-tree run sends node null and adopts scopePath null", async () => {
    const seen: Record<string, unknown>[] = [];
    setMockBackend(async (cmd, args) => {
      if (cmd === "find_duplicates") {
        seen.push(args as Record<string, unknown>);
        return { generation: 7, groups: [], wastedTotal: 0, files: 10, scopePath: null };
      }
      return null;
    });
    useDupesStore.getState().start(7);
    await vi.waitFor(() => {
      expect(useDupesStore.getState().running).toBe(false);
    });
    expect(seen[0]?.node).toBeNull();
    expect(useDupesStore.getState().scopePath).toBeNull();
  });

  it("failure clears the scope framing (a retry re-declares it)", async () => {
    setMockBackend(async (cmd) => {
      if (cmd === "find_duplicates") throw "engine failed";
      return null;
    });
    useDupesStore.getState().start(7, 42, "C:\\Users\\dev");
    await vi.waitFor(() => {
      expect(useDupesStore.getState().running).toBe(false);
    });
    expect(useDupesStore.getState().error).toBeTruthy();
    expect(useDupesStore.getState().scopePath).toBeNull();
  });

  it("refresh adopts the backend's scope for a re-attached view", async () => {
    setMockBackend(async (cmd) => {
      if (cmd === "dupes_status") {
        return {
          running: false,
          generation: 7,
          progress: null,
          result: {
            generation: 7,
            groups: [],
            wastedTotal: 0,
            files: 1,
            scopePath: "D:\\Games",
          },
          error: null,
          scopePath: "D:\\Games",
        };
      }
      return null;
    });
    await useDupesStore.getState().refresh();
    expect(useDupesStore.getState().scopePath).toBe("D:\\Games");
    expect(useDupesStore.getState().result?.scopePath).toBe("D:\\Games");
  });
});

describe("mock disk_storage path parity (session 15)", () => {
  type Storage = { label: string; total: number; free: number; usedPct: number };

  it("answers the C: volume for a C: view path", () => {
    const c = commands.disk_storage({ path: "C:\\Users\\dev" }) as Storage;
    expect(c.label).toBe("Local Disk (C:)");
    expect(c.usedPct).toBeCloseTo(0.880, 2);
  });

  it("answers the D: volume for a D: view path — the flip changes the card", () => {
    const d = commands.disk_storage({ path: "D:\\Games" }) as Storage;
    expect(d.label).toBe("Games (D:)");
    expect(d.total).toBeGreaterThan(1_000_000_000_000);
    expect(d.usedPct).toBeGreaterThan(0.5);
    expect(d.usedPct).toBeLessThan(0.7);
  });

  it("aggregates for the whole-PC view path (no root matches the label)", () => {
    const agg = commands.disk_storage({ path: "This PC" }) as Storage;
    expect(agg.label).toBe("This PC");
    expect(agg.total).toBeGreaterThan(2_000_000_000_000);
  });

  it("keeps the standing default without a path", () => {
    const plain = commands.disk_storage({}) as Storage;
    expect(plain.label).toBe("Local Disk (C:)");
  });
});

describe("mock find_duplicates scope parity (session 15)", () => {
  beforeEach(() => {
    // The Rust command is license-gated; the mock mirrors the gate —
    // flip the simulated license so the run can start.
    commands.license_sim_set({ mode: "pro" });
  });

  it("a whole-tree run returns the full dataset with scopePath null", async () => {
    const res = (await commands.find_duplicates({})) as {
      groups: { paths: string[] }[];
      scopePath: string | null;
    };
    expect(res.scopePath).toBeNull();
    expect(res.groups.length).toBeGreaterThan(0);
  });

  it("a scoped run keeps only groups fully inside the folder", async () => {
    // Documents owns the one fully-internal group in the dataset
    // (report-233.pdf + Work\report-233.pdf, both under Documents).
    // Resolved through the mock's own resolver — no hardcoded ids.
    const docs = commands.resolve_path({ generation: 1, path: "C:\\Users\\dev\\Documents" });
    expect(typeof docs).toBe("number");
    const res = (await commands.find_duplicates({ node: docs })) as {
      groups: { paths: string[] }[];
      scopePath: string | null;
    };
    expect(res.scopePath).toBe("C:\\Users\\dev\\Documents");
    expect(res.groups.length).toBe(1);
    for (const p of res.groups[0]?.paths ?? []) {
      expect(p.toLowerCase().startsWith("c:\\users\\dev\\documents")).toBe(true);
    }
  });

  it("a scope with no INTERNAL duplicates answers empty — copies outside don't count", async () => {
    // The photo-402 group spans Pictures + Downloads: from Pictures'
    // perspective the third copy is OUTSIDE the scope, so the internal
    // scan finds nothing — the honest "duplicates here" semantic (the
    // whole-tree scan is where cross-boundary groups appear).
    const pictures = commands.resolve_path({ generation: 1, path: "C:\\Users\\dev\\Pictures" });
    const res = (await commands.find_duplicates({ node: pictures })) as {
      groups: unknown[];
      scopePath: string | null;
    };
    expect(res.scopePath).toBe("C:\\Users\\dev\\Pictures");
    expect(res.groups).toEqual([]);
  });

  it("a file node rejects like the Rust command", async () => {
    const drive = commands.resolve_path({ generation: 1, path: "C:\\" });
    const view = commands.get_folder_view({
      generation: 1,
      node: drive as number,
      filter: "pagefile",
    }) as { files: { id: number }[] };
    const fileId = view.files[0]?.id ?? -1;
    expect(fileId).toBeGreaterThan(0);
    await expect(commands.find_duplicates({ node: fileId })).rejects.toMatch(/folder/);
  });
});
