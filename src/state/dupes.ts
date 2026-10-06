/**
 * Duplicates-scan state (spec §10 + the session-5 state-management fix):
 * the scan lifecycle lives HERE — a module-level store with ONE
 * persistent `dupes-progress` listener attached at app boot — so tab
 * switches can no longer orphan a running multi-GB pipeline. The old
 * design kept busy/progress/result in DuplicatesView's component
 * state: leaving the tab dropped the listener and the promise's
 * landing spot, and the remount showed "Start scan" over a scan that
 * was still hashing.
 *
 * The Rust half mirrors this: `AppState.dupes_status` carries the
 * run's live snapshot + sticky result; `refresh()` pulls it so a
 * remounted view re-attaches mid-scan (progress ticks continue via
 * the persistent listener).
 *
 * Blink contract for the busy row: the engine's DTO carries a
 * monotonic `overall` fraction (weighted phases) and cumulative
 * `bytesDoneAll` — the bar and rate never reset at phase boundaries.
 */
import { create } from "zustand";
import { invoke, listen, type UnlistenFn } from "../lib/ipc";
import { EVENTS, track } from "../lib/analytics";
import { userFacingError } from "../lib/userFacingError";
// Function-level usage only (the resolve-staleness guard) — the module
// cycle scan.ts ↔ dupes.ts is init-safe (same pattern as ipc ↔
// state/license; both sides access each other inside functions).
import { useScanStore } from "./scan";

/** One member of a duplicate group (rich facts: the keep rules and
 * reveal wiring read them). */
export interface DupeFile {
  path: string;
  /** Tree node id — reveal-in-explore wiring. */
  nodeId: number;
  /** Last-write time (unix seconds; 0 = unknown). */
  modified: number;
}

export interface DupeGroup {
  id: number;
  files: DupeFile[];
  size: number;
  count: number;
  wasted: number;
}

export interface DupesResult {
  generation: number;
  groups: DupeGroup[];
  wastedTotal: number;
  files: number;
  /** The folder the scan was scoped to (session 15 "Duplicates
   * here": null = the whole tree — the groups are byte-identical
   * files fully INSIDE the scope). */
  scopePath: string | null;
}

/** The `dupes-progress` event payload (camelCase DTO from Rust). */
export interface DupesProgress {
  phase: "collect" | "screen" | "verify" | "done" | "cancelled";
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  elapsedMs: number;
  /** Cumulative across phases — the honest rate source (monotonic). */
  filesDoneAll: number;
  /** Cumulative across phases — never resets at boundaries. */
  bytesDoneAll: number;
  /** Weighted global fraction [0..1] — the bar source (monotonic). */
  overall: number;
}

/** The `dupes_status` command payload. */
export interface DupesStatusSnapshot {
  running: boolean;
  generation: number;
  progress: DupesProgress | null;
  result: DupesResult | null;
  error: string | null;
  /** The scoped folder of the run / sticky result (null = whole
   * tree) — a remounted view shows the scope it re-attached to. */
  scopePath: string | null;
}

interface DupesStore {
  running: boolean;
  /** Set the instant the user presses Cancel — the busy row shows
   * "Cancelling…" and disables the button while the engine folds
   * (its per-file probes land within one file / one 1 MiB chunk). */
  cancelling: boolean;
  progress: DupesProgress | null;
  result: DupesResult | null;
  error: string | null;
  /** The folder the CURRENT run (or sticky result) is scoped to —
   * null = whole tree (session 15 "Duplicates here"). */
  scopePath: string | null;
  /** Start (or join) a scan against `generation` — optionally scoped
   * to a folder's subtree (`node`: the inspector's launchpad, which
   * also passes the folder's PATH for the busy-row framing). */
  start: (generation: number, node?: number, scopePath?: string) => void;
  /** Ask the backend for its app-lifetime status (mount re-attach). */
  refresh: () => Promise<void>;
  /** Cooperative cancel (quiet reset — no error banner). */
  cancel: () => void;
  /** Drop a tree-stale result (new disk scan / cleanup commit). */
  invalidate: (generation: number) => void;
  /** Attach the persistent event listener (once, app boot). */
  attach: () => void;
}

let listenersAttached = false;
let unlisten: UnlistenFn | null = null;
/** Throttle: coalesce the ~200 ms engine ticks into ≤ ~9 Hz store
 * writes — the busy row re-renders on store changes only, and every
 * write carries a full object identity anyway. Phase/terminal events
 * flush immediately. */
let pending: DupesProgress | null = null;
let flushTimer: number | null = null;

function flushProgress(): void {
  if (flushTimer !== null) {
    window.clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pending) {
    // `running` never changes on a tick — the invoke's resolve/reject
    // owns it (the store is the single writer, ticks only mirror).
    useDupesStore.setState({ progress: pending });
    pending = null;
  }
}

export const useDupesStore = create<DupesStore>((set, get) => ({
  running: false,
  cancelling: false,
  progress: null,
  result: null,
  error: null,
  scopePath: null,

  start: (generation, node, scopePath) => {
    if (get().running) return; // the engine also rejects ("already running")
    set({
      running: true,
      cancelling: false,
      progress: null,
      result: null,
      error: null,
      // The optimistic scope (the caller's framing) — the RESULT's
      // scopePath is authoritative (the backend normalizes a root
      // scope to null).
      scopePath: scopePath ?? null,
    });
    void invoke<DupesResult>("find_duplicates", { generation, node: node ?? null })
      .then((res) => {
        // A tree swap (fresh scan / cleanup commit) landed while the
        // engine hashed: the groups reference the OLD arena — drop them
        // instead of rendering a result for a tree that no longer
        // exists. Function-level scan-store access (init-safe cycle).
        const stillCurrent =
          res.generation === generation &&
          generation === useScanStore.getState().generation &&
          useScanStore.getState().status === "done";
        set({
          running: false,
          cancelling: false,
          progress: null,
          result: stillCurrent ? res : null,
          error: null,
          // The backend owns the framing: it normalizes a root scope
          // to null and reports the real folder path otherwise.
          scopePath: stillCurrent ? res.scopePath : null,
        });
        if (stillCurrent) {
          track(EVENTS.duplicatesScanCompleted, {
            groups: res.groups.length,
            wasted: res.wastedTotal,
            scoped: res.scopePath != null,
          });
        }
      })
      .catch((e: unknown) => {
        // Cancellation is a USER action, not a failure — quiet reset.
        // Either way the scope framing dies with the run: a retry
        // re-declares it through start()'s own arguments.
        if (!/cancel/i.test(String(e))) {
          set({ running: false, cancelling: false, progress: null, error: userFacingError(e), scopePath: null });
        } else {
          set({ running: false, cancelling: false, progress: null, error: null, scopePath: null });
        }
      });
  },

  refresh: async () => {
    try {
      const st = await invoke<DupesStatusSnapshot>("dupes_status");
      // `cancelling` survives re-attach while the backend still reports
      // running (the fold is in flight); a folded run clears it.
      const cancelling = st.running && get().cancelling;
      set({
        running: st.running,
        cancelling,
        progress: st.running ? st.progress : null,
        result: st.result,
        error: st.error,
        scopePath: st.scopePath,
      });
    } catch {
      // Command missing (older engine) — keep local state.
    }
  },

  cancel: () => {
    if (!get().running || get().cancelling) return;
    // Optimistic: the engine folds within one file / one 1 MiB chunk
    // (per-file probes), but the busy row reacts the MOMENT the user
    // clicks — "the stop button doesn't stop" is as much about the
    // missing acknowledgement as the latency.
    set({ cancelling: true });
    void invoke("cancel_duplicates").catch(() => undefined);
  },

  invalidate: (generation) => {
    const s = get();
    if (s.result && s.result.generation !== generation) {
      set({ result: null, error: null, progress: null, scopePath: null });
    }
    // A running scan against a dead tree: the backend's start_scan
    // already bumped the cancel generation; the invoke resolves on its
    // own and clears `running`. Nothing to force here.
  },

  attach: () => {
    if (listenersAttached) return;
    listenersAttached = true;
    void listen<DupesProgress>("dupes-progress", (p) => {
      if (!useDupesStore.getState().running) return; // stale tail ticks
      const terminal = p.phase === "done" || p.phase === "cancelled";
      if (terminal || pending === null) {
        pending = p;
        flushProgress();
        return;
      }
      pending = p;
      if (flushTimer === null) {
        flushTimer = window.setTimeout(flushProgress, 110);
      }
    }).then((u) => {
      unlisten = u;
    }).catch(() => undefined);
  },
}));

/** App-boot wiring (idempotent; called once from AppShell). */
export function bootstrapDupes(): void {
  useDupesStore.getState().attach();
}

/** Test seam: detach + reset between vitest cases. */
export function __resetDupesForTests(): void {
  unlisten?.();
  unlisten = null;
  listenersAttached = false;
  pending = null;
  if (flushTimer !== null) window.clearTimeout(flushTimer);
  flushTimer = null;
  useDupesStore.setState({
    running: false,
    cancelling: false,
    progress: null,
    result: null,
    error: null,
    scopePath: null,
  });
}
