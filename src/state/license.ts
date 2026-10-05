/**
 * License store (docs/LICENSING-ARCHITECTURE.md §6/§7): posture from
 * the Rust layer, activate/deactivate/validate actions, live
 * `license-changed` sync, and the ACTIVATION_REQUIRED /
 * LICENSE_STALE gate interception — any command error carrying the
 * marker opens the activation flow (defense in depth behind the Rust
 * command gate).
 */
import { create } from "zustand";
import { invoke } from "../lib/ipc";
import { listen } from "../lib/ipc";

import { EVENTS, track } from "../lib/analytics";

export interface LicenseStatus {
  posture: "unlicensed" | "pro" | "grace" | "degraded";
  isPro: boolean;
  tier: string;
  /** Display identity (empty before activation). */
  customerName: string;
  customerEmail: string;
  /** License expiry (unix seconds; 0 = lifetime). */
  licenseExpiresAt: number;
  graceDaysLeft: number;
  /** The purchase URL (from the Rust layer — one source of truth). */
  purchaseUrl: string;
  /** CI simulation marker (screenshots workflow only). */
  simulated: boolean;
}

/** Gate markers emitted by the Rust command layer (require_licensed). */
const GATE_ACTIVATION = "ACTIVATION_REQUIRED";
const GATE_STALE = "LICENSE_STALE";

interface LicenseState {
  status: LicenseStatus | null;
  busy: boolean;
  error: string | null;
  /** One-shot success signal for the dialog's auto-close. */
  activated: boolean;
  /** The gate event: a command refused by the license layer. */
  gate: "activation" | "stale" | null;
  load: () => Promise<void>;
  activate: (key: string) => Promise<boolean>;
  deactivate: () => Promise<void>;
  validateNow: () => Promise<void>;
  dismissGate: () => void;
  consumeActivated: () => void;
}

export const useLicenseStore = create<LicenseState>((set) => ({
  status: null,
  busy: false,
  error: null,
  activated: false,
  gate: null,
  load: async () => {
    try {
      set({ status: await invoke<LicenseStatus>("license_status") });
    } catch {
      set({ status: null });
    }
  },
  activate: async (key) => {
    set({ busy: true, error: null, activated: false });
    try {
      const status = await invoke<LicenseStatus>("activate_license", { key });
      set({ status, busy: false, activated: true });
      track(EVENTS.licenseActivated, { tier: status.tier });
      return true;
    } catch (e) {
      set({ busy: false, error: String(e) });
      track(EVENTS.licenseError, { kind: "activate" });
      return false;
    }
  },
  deactivate: async () => {
    set({ busy: true, error: null });
    try {
      await invoke("deactivate_license");
      set({
        status: await invoke<LicenseStatus>("license_status").catch(() => null),
        busy: false,
      });
    } catch (e) {
      set({ busy: false, error: String(e) });
    }
  },
  validateNow: async () => {
    set({ busy: true, error: null });
    try {
      set({ status: await invoke<LicenseStatus>("validate_now") });
    } catch (e) {
      set({ error: String(e) });
    } finally {
      set({ busy: false });
    }
  },
  dismissGate: () => set({ gate: null }),
  consumeActivated: () => set({ activated: false }),
}));

let attached = false;
/** Attach the license-changed listener + the command-gate interceptor. */
export function attachLicenseEvents(): void {
  if (attached) return;
  attached = true;
  void listen<LicenseStatus>("license-changed", (status) => {
    useLicenseStore.setState({ status });
  }).catch(() => undefined);
}

/**
 * Inspect a command error for the license gate markers and raise the
 * gate event (the App shell opens the activation flow). Call this from
 * every gated store's catch path — the Rust gate is the boundary, this
 * keeps the UX coherent when it trips.
 */
export function interceptLicenseGate(error: string): void {
  if (error.startsWith(GATE_ACTIVATION)) {
    useLicenseStore.setState({ gate: "activation" });
  } else if (error.startsWith(GATE_STALE)) {
    useLicenseStore.setState({ gate: "stale" });
  }
}
