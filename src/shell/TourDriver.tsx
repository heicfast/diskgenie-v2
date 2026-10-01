/**
 * Tour driver (dev hook §15 extension, CI-only): DISKBYTES_TOUR=1 (or
 * ?tour=1 in browser-dev) auto-cycles through every tab, every mode,
 * popovers and dialogs with ~2.6 s dwell so CI screenshot passes can
 * capture every state of the real app without interactive automation.
 * It sets window.__DB_TOUR_STATE after each step for the harness.
 *
 * Session 17 — the tour PROGRAMS (DISKBYTES_TOUR_MODE):
 *  * "ui" (default): the full sweep + the responsive window steps
 *    (window-min at the 1280×760 design floor, window-full, restore).
 *  * "license": the live-key lifecycle for the macOS license E2E —
 *    entry state → malformed-key rejection → unknown-key rejection →
 *    REAL activation (DISKBYTES_TOUR_LICENSE_KEY, minted per-run by
 *    the admin API) → success → Pro status card → Validate now →
 *    the unlocked app. Every state goes through the REAL store path
 *    (invoke activate_license → server → Ed25519 verify → Keychain).
 *  * "bench": the benchmark program — first scan (auto via
 *    DISKBYTES_SCAN), a re-scan of the SAME target (the flip-cache
 *    restore), then the duplicates pipeline. The harness parses the
 *    [bench] stderr lines + samples memory.
 */
import { useEffect } from "react";
import { useViewStore } from "../state/view";
import { useVizUiStore, MODES } from "../state/vizUi";
import { useScanStore } from "../state/scan";
import { useExploreStore } from "../state/explore";
import { useCleanupStore } from "../state/cleanup";
import { useLicenseStore } from "../state/license";

interface TourHooks {
  tour: boolean;
  tourMode: string | null;
  tourLicenseKey: string | null;
  scan: string | null;
}

interface Step {
  name: string;
  apply: () => void;
  /** Dwell multiplier (× DWELL_MS). Theme flips need ≥2 capture passes:
   * the CI harness samples every 2.6 s, so a 1× dwell can fall entirely
   * between captures — round 16's tour never captured dark mode at all
   * (all 26 frames light). 3× guarantees ≥2 samples per theme. */
  dwell?: number;
}

const DWELL_MS = 2600;

/** The license-tour key fill: the dialog's input listens for this event
 * (its formatting + completeness logic stays the single source). */
function tourFillKey(key: string) {
  window.dispatchEvent(new CustomEvent("db-tour-license-key", { detail: { key } }));
}

/** Window control for the responsive tour steps (mock-safe: the dynamic
 * import resolves only inside the real Tauri webview). */
async function setTourWindow(w: number, h: number) {
  try {
    const { getCurrentWindow, LogicalSize } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setFullscreen(false);
    await win.setSize(new LogicalSize(w, h));
    await win.center();
  } catch {
    /* plain browser (mock) — the layout tests drive viewport sizes */
  }
}

async function setTourFullscreen(on: boolean) {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* plain browser (mock) */
  }
}

export function TourDriver() {
  useEffect(() => {
    let timer: number | null = null;
    let disposed = false;
    void (async () => {
      const hooks = await import("../lib/ipc").then(({ invoke }) =>
        invoke<TourHooks>("get_dev_hooks").catch(() => ({ tour: false, tourMode: null, tourLicenseKey: null, scan: null })),
      );
      if (!hooks?.tour || disposed) return;

      const waitScanDone = async (maxPolls = 60): Promise<void> => {
        for (let i = 0; i < maxPolls; i++) {
          if (useScanStore.getState().status === "done") return;
          await new Promise((r) => window.setTimeout(r, 500));
        }
      };

      const tourMode = (hooks.tourMode ?? "ui").toLowerCase();
      if (tourMode === "license") {
        // The unlicensed boot: the auto-scan is REFUSED by the license
        // gate, so waitScanDone would burn 30 s for nothing — skip it.
        await runLicenseTour(hooks);
        return;
      }
      if (tourMode === "bench") {
        await waitScanDone();
        await runBenchTour();
        return;
      }
      await waitScanDone();

      const steps: Step[] = [];
      // every Explore mode
      for (const mode of MODES) {
        steps.push({
          name: `explore-${mode.replace(/\s+/g, "-").toLowerCase()}`,
          apply: () => {
            useViewStore.getState().setTab("explore");
            useVizUiStore.getState().setMode(mode);
          },
        });
      }
      // color modes on treemap
      for (const color of ["by-folder", "by-type", "by-age"] as const) {
        steps.push({
          name: `treemap-color-${color}`,
          apply: () => {
            useViewStore.getState().setTab("explore");
            useVizUiStore.getState().setMode("Treemap");
            useVizUiStore.getState().setColorMode(color);
          },
        });
      }
      // theme flips — 3× dwell (see Step.dwell): guarantees the CI
      // 2.6 s capture cadence samples each theme at least twice.
      // Session 16: ALL five themes (the two shipped + the three
      // picker palettes) — both attributes together, exactly like
      // useTheme/applyThemeAttributes writes them (data-scheme drives
      // the canvas tone family + the dark-family CSS).
      const themeSteps: [string, string, string][] = [
        ["light", "light-theme", "light"],
        ["dark", "dark-theme", "dark"],
        ["ember", "ember-theme", "dark"],
        ["tide", "tide-theme", "dark"],
        ["blossom", "blossom-theme", "light"],
      ];
      for (const [id, name, scheme] of themeSteps) {
        steps.push({
          name,
          dwell: 3,
          apply: () => {
            document.documentElement.setAttribute("data-theme", id);
            document.documentElement.setAttribute("data-scheme", scheme);
          },
        });
      }
      // the other tabs
      for (const t of ["duplicates", "applications", "monitor", "snapshots"] as const) {
        steps.push({
          name: `tab-${t}`,
          apply: () => useViewStore.getState().setTab(t),
        });
      }
      // duplicates: RUN the scan (10× dwell = 26 s — the Windows
      // runner's real-time Defender charges ~0.6 s per first-open of
      // the freshly-staged tree, so the real pipeline lands at ~25 s;
      // the dwell must cover it so the RESULT state gets captured,
      // not just the busy row). Switch to the tab,
      // then fire once the view is mounted + subscribed (poll — a fixed
      // delay races the veil swap's mount). The busy row and the group
      // cards are what production screenshots must show — the empty
      // state alone verified nothing about the pipeline.
      steps.push({
        name: "duplicates-run",
        dwell: 10,
        apply: () => {
          useViewStore.getState().setTab("duplicates");
          const fire = () => window.dispatchEvent(new CustomEvent("db-tour-dupes-run"));
          let tries = 0;
          const waitMount = () => {
            const h1 = document.querySelector(".db-main-col h1");
            const heading = [...document.querySelectorAll(".db-main-col h1")].map((h) => h.textContent);
            const mounted = heading.includes("Duplicates") || h1?.textContent === "Duplicates";
            if (mounted || tries > 40) fire();
            else {
              tries += 1;
              window.setTimeout(waitMount, 50);
            }
          };
          window.setTimeout(waitMount, 120);
        },
      });
      // LICENSE COVERAGE (session-10 licensing): the Pro status card
      // (name/email/active-till/thank-you — on the simulated license),
      // the activation dialog's empty state (Later + Purchase Licence
      // buttons), its complete-key state (the Activate button), and the
      // locked app (Activation Gate). Order: status card first (still
      // PRO from boot), then the dialog empty/key states, then flip
      // OFF for the locked-app capture.
      steps.push({
        name: "license-status-card",
        dwell: 2,
        apply: () => {
          useViewStore.getState().setTab("explore");
          window.dispatchEvent(new CustomEvent("db-tour-open-license"));
        },
      });
      steps.push({
        name: "license-dialog-empty",
        apply: () => {
          window.dispatchEvent(new CustomEvent("db-tour-close-license"));
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("db-tour-open-license"));
          }, 150);
          // flip to unlicensed for the entry state
          void import("../lib/ipc").then(({ invoke }) =>
            invoke("license_sim_set", { mode: "unlicensed" }).catch(() => undefined),
          );
        },
      });
      steps.push({
        name: "license-dialog-key",
        apply: () => {
          window.dispatchEvent(new CustomEvent("db-tour-close-license"));
          window.setTimeout(() => {
            window.dispatchEvent(new CustomEvent("db-tour-open-license"));
            window.dispatchEvent(new CustomEvent("db-tour-license-key", { detail: { key: "DB-7XK2M-9QF3P-8NR4T-2VW6Y" } }));
          }, 150);
        },
      });
      // The locked app: dialog closed, still unlicensed → the
      // Activation Gate renders in place of every gated tab.
      steps.push({
        name: "license-locked-explore",
        dwell: 2,
        apply: () => {
          window.dispatchEvent(new CustomEvent("db-tour-close-license"));
          useViewStore.getState().setTab("explore");
        },
      });
      steps.push({
        name: "license-locked-duplicates",
        apply: () => {
          useViewStore.getState().setTab("duplicates");
        },
      });
      // Restore the simulated PRO state so the remaining steps (queue)
      // capture the working app.
      steps.push({
        name: "license-restore-pro",
        apply: () => {
          void import("../lib/ipc").then(({ invoke }) =>
            invoke("license_sim_set", { mode: "pro" }).catch(() => undefined),
          );
        },
      });
      steps.push({
        name: "license-pro-restored",
        apply: () => {
          useViewStore.getState().setTab("explore");
          window.dispatchEvent(new CustomEvent("db-tour-open-license"));
        },
      });
      // queue with one item (stage the current folder)
      steps.push({
        name: "cleanup-queue",
        apply: () => {
          const folder = useExploreStore.getState().currentFolder;
          useCleanupStore.getState().stage({ id: folder, path: "C:\\Users\\dev\\Downloads", size: 41_900_000_000, reason: "Downloads — Quick win" });
          window.dispatchEvent(new CustomEvent("db-open-queue"));
        },
      });
      // ── Responsive window extremes (session 17) ──────────────────
      // window-min: the 1280×760 design floor — the smallest window
      // the app supports; every column must hold layout there.
      // window-full: fullscreen — the largest. 3× dwell each so the
      // 2.6 s capture cadence lands ≥2 samples per state.
      steps.push({
        name: "window-min",
        dwell: 3,
        apply: () => {
          void setTourWindow(1280, 760);
          window.dispatchEvent(new CustomEvent("db-tour-close-license"));
        },
      });
      steps.push({
        name: "window-full",
        dwell: 3,
        apply: () => {
          void setTourFullscreen(true);
        },
      });
      steps.push({
        name: "window-restore",
        dwell: 2,
        apply: () => {
          void setTourWindow(1440, 860);
        },
      });

      let i = 0;
      const advance = () => {
        if (disposed || i >= steps.length) return;
        window.dispatchEvent(new CustomEvent("db-tour-step"));
        const step = steps[i];
        step.apply();
        (window as unknown as Record<string, unknown>).__DB_TOUR_STATE = { step: i, name: step.name, total: steps.length };
        i += 1;
        if (i < steps.length) timer = window.setTimeout(advance, DWELL_MS * (step.dwell ?? 1));
        else (window as unknown as Record<string, unknown>).__DB_TOUR_DONE = true;
      };
      advance();
    })();

    // license/queue open events (dialog state lives in App)
    const onLicense = () => window.dispatchEvent(new CustomEvent("db-open-license"));
    window.addEventListener("db-tour-open-license", onLicense);
    const onQueue = () => window.dispatchEvent(new CustomEvent("db-open-queue"));
    window.addEventListener("db-tour-open-queue", onQueue);
    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("db-tour-open-license", onLicense);
      window.removeEventListener("db-tour-open-queue", onQueue);
    };
  }, []);
  return null;
}

// App listens for these to open the overlays during a tour.
declare global {
  interface Window {
    __DB_TOUR_STATE?: { step: number; name: string; total: number };
    __DB_TOUR_DONE?: boolean;
  }
}

// ── The license program (macOS license E2E) ──────────────────────────
// Every activation goes through useLicenseStore.activate — the REAL
// store path the Activate button drives (invoke activate_license →
// live worker → Ed25519 verify → Keychain persist). The malformed +
// unknown-key steps capture the error states; the real-key step captures
// busy → success → auto-close. The dialog must be OPEN for each state.
async function runLicenseTour(hooks: TourHooks) {
  const steps: Step[] = [
    {
      // The boot state itself (dialog auto-opened by the unlicensed
      // boot path) — nothing to apply, just ensure explore is the tab.
      name: "license-entry",
      dwell: 2,
      apply: () => {
        useViewStore.getState().setTab("explore");
        window.dispatchEvent(new CustomEvent("db-tour-open-license"));
      },
    },
    {
      // A malformed key (rejected by Rust-side normalize before any
      // network — the instant typed error).
      name: "license-bad-format",
      dwell: 2,
      apply: () => {
        tourFillKey("DB-123-INVALID");
        window.setTimeout(() => void useLicenseStore.getState().activate("DB-123-INVALID"), 700);
      },
    },
    {
      // Well-formed but unknown to the server — the network rejection
      // path with its typed copy.
      name: "license-unknown-key",
      dwell: 3,
      apply: () => {
        tourFillKey("DBAAAAABBBBBCCCCCDDDDD");
        window.setTimeout(() => void useLicenseStore.getState().activate("DBAAAAABBBBBCCCCCDDDDD"), 700);
      },
    },
    {
      // The REAL minted key (DISKBYTES_TOUR_LICENSE_KEY): busy →
      // success → the dialog closes itself (~1.6 s after success).
      // 6× = 15.6 s covers the RTT + the auto-close dwell.
      name: "license-real-activate",
      dwell: 6,
      apply: () => {
        const key = hooks.tourLicenseKey;
        if (!key) return; // no key minted — the step no-ops
        tourFillKey(key);
        window.setTimeout(() => void useLicenseStore.getState().activate(key), 700);
      },
    },
    {
      // The Pro status card: name/email/tier from the REAL server.
      name: "license-real-status",
      dwell: 3,
      apply: () => {
        window.dispatchEvent(new CustomEvent("db-tour-open-license"));
      },
    },
    {
      // Validate now — the 24 h revalidation path, live.
      name: "license-real-validate",
      dwell: 4,
      apply: () => {
        void useLicenseStore.getState().validateNow();
      },
    },
    {
      // The unlocked app: gate lifted, a REAL scan of the staged tree
      // runs (the boot auto-scan was refused while unlicensed).
      name: "license-unlocked-explore",
      dwell: 8,
      apply: () => {
        window.dispatchEvent(new CustomEvent("db-tour-close-license"));
        useViewStore.getState().setTab("explore");
        if (hooks.scan) void useScanStore.getState().startScan(hooks.scan);
      },
    },
    {
      name: "license-unlocked-monitor",
      dwell: 3,
      apply: () => {
        useViewStore.getState().setTab("monitor");
      },
    },
  ];
  let i = 0;
  const advance = () => {
    const step = steps[i];
    if (!step) {
      (window as unknown as Record<string, unknown>).__DB_TOUR_DONE = true;
      return;
    }
    window.dispatchEvent(new CustomEvent("db-tour-step"));
    step.apply();
    (window as unknown as Record<string, unknown>).__DB_TOUR_STATE = { step: i, name: step.name, total: steps.length };
    i += 1;
    window.setTimeout(advance, DWELL_MS * (step.dwell ?? 1));
  };
  advance();
}

// ── The bench program (macOS benchmark) ─────────────────────────────
// The first scan auto-starts at boot (DISKBYTES_SCAN, licensed via
// the sim) — the real walk, timed by the [bench] scan-done line. This
// program then probes the flip-cache RESTORE (re-scan of the SAME
// target — instant, [bench] scan-restored) and the duplicates
// pipeline, then ends so the harness knows the window is closed.
async function runBenchTour() {
  const target = useScanStore.getState().scanTarget;
  void useScanStore.getState().startScan(target); // cache-restore probe
  await new Promise((r) => window.setTimeout(r, 4000));
  useViewStore.getState().setTab("duplicates");
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("db-tour-dupes-run"));
  }, 400);
  await new Promise((r) => window.setTimeout(r, 12_000));
  (window as unknown as Record<string, unknown>).__DB_TOUR_STATE = { step: 2, name: "bench-done", total: 3 };
  (window as unknown as Record<string, unknown>).__DB_TOUR_DONE = true;
}
