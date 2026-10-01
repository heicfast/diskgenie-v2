/**
 * Session-17 tests: the macOS testing/benchmarking surface — the tour
 * PROGRAM contract and the REAL license-store paths the mac license
 * E2E workflow drives end-to-end on the live worker.
 *
 * - mock `get_dev_hooks` parity: the three session-17 fields
 *   (`tourMode`, `tourLicenseKey`, `window`) parse from the launch
 *   parameters exactly like the Rust env hook reads them — the browser
 *   dev mirror of the workflow's `DISKBYTES_TOUR_MODE` etc.
 * - license store (previously UNCOVERED — the exact paths the license
 *   tour drives): malformed key → typed error, posture unchanged;
 *   well-formed key → pro + the activated flag the dialog's success
 *   body keys on; `consumeActivated` re-arms; the gate interceptor
 *   maps the ACTIVATION_REQUIRED marker prefix; the sim flip emits
 *   `license-changed` so `attachLicenseEvents` stays the one sync.
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
const listeners: ((e: { type: string; detail?: unknown }) => void)[] = [];
const shim = {
  localStorage: new MemStorage(),
  dispatchEvent: vi.fn((e: Event) => {
    for (const l of listeners) l(e as unknown as { type: string; detail?: unknown });
    return true;
  }),
  addEventListener: vi.fn((_t: string, fn: (e: { type: string }) => void) => {
    listeners.push(fn);
  }),
  setInterval: vi.fn(() => 0),
  clearInterval: vi.fn(),
  setTimeout: (fn: () => void, _ms?: number) => {
    fn();
    return 0;
  },
};
(globalThis as Record<string, unknown>).window = shim;

// Import AFTER the shim exists.
import { setMockBackend, listen } from "../lib/ipc";
import { useLicenseStore, interceptLicenseGate } from "./license";
import { commands } from "../mock/commands";

const setHooksSearch = (search: string): void => {
  (globalThis as Record<string, unknown>).location = { search };
};

beforeEach(() => {
  setHooksSearch("");
  useLicenseStore.setState({
    status: null,
    busy: false,
    error: null,
    activated: false,
    gate: null,
  });
  setMockBackend(null);
});

describe("dev-hook tour program contract (session 17)", () => {
  it("parses tourMode/tourLicenseKey/window from the launch parameters", () => {
    setHooksSearch("?tour=1&tourMode=license&tourLicenseKey=DBT5R95YRKFQ6TW9XMX9YC&window=1280x760");
    const hooks = commands.get_dev_hooks({}) as Record<string, unknown>;
    expect(hooks.tour).toBe(true);
    expect(hooks.tourMode).toBe("license");
    expect(hooks.tourLicenseKey).toBe("DBT5R95YRKFQ6TW9XMX9YC");
    expect(hooks.window).toBe("1280x760");
  });

  it("defaults the program fields to null (the ui sweep)", () => {
    setHooksSearch("?tour=1");
    const hooks = commands.get_dev_hooks({}) as Record<string, unknown>;
    expect(hooks.tour).toBe(true);
    expect(hooks.tourMode).toBeNull();
    expect(hooks.tourLicenseKey).toBeNull();
    expect(hooks.window).toBeNull();
  });
});

describe("license store activation paths (the mac license E2E drives these)", () => {
  it("rejects a malformed key with a typed error and keeps the posture", async () => {
    useLicenseStore.setState({
      status: {
        posture: "unlicensed", isPro: false, tier: "", customerName: "", customerEmail: "",
        licenseExpiresAt: 0, graceDaysLeft: 0, purchaseUrl: "https://x", simulated: false,
      },
    });
    setMockBackend(async (_cmd, args) =>
      commands.activate_license({ key: String((args as { key?: string }).key ?? "") } as never) as never);
    const ok = await useLicenseStore.getState().activate("DB-123-INVALID");
    expect(ok).toBe(false);
    const s = useLicenseStore.getState();
    expect(s.error).toBeTruthy();
    expect(s.activated).toBe(false);
    expect(s.status?.posture).toBe("unlicensed");
  });

  it("activates a well-formed key: pro posture + the activated flag", async () => {
    setMockBackend(async (_cmd, args) =>
      commands.activate_license({ key: String((args as { key?: string }).key ?? "") } as never) as never);
    const ok = await useLicenseStore.getState().activate("DBT5R95YRKFQ6TW9XMX9YC");
    expect(ok).toBe(true);
    const s = useLicenseStore.getState();
    expect(s.activated).toBe(true);
    expect(s.status?.posture).toBe("pro");
    expect(s.status?.isPro).toBe(true);
    expect(s.error).toBeNull();
    // The success body is transient: the dialog auto-close consumes it.
    useLicenseStore.getState().consumeActivated();
    expect(useLicenseStore.getState().activated).toBe(false);
    // The posture SURVIVES the consume — the status card is next.
    expect(useLicenseStore.getState().status?.posture).toBe("pro");
  });

  it("maps the ACTIVATION_REQUIRED marker prefix to the gate (the refused boot scan)", () => {
    interceptLicenseGate("ACTIVATION_REQUIRED — Activate DiskBytes Pro to use this.");
    expect(useLicenseStore.getState().gate).toBe("activation");
    useLicenseStore.getState().dismissGate();
    expect(useLicenseStore.getState().gate).toBeNull();
    // A non-gate error never trips it.
    interceptLicenseGate("scan failed: root not found");
    expect(useLicenseStore.getState().gate).toBeNull();
  });

  it("the sim flip emits license-changed (the one status sync)", async () => {
    const seen: string[] = [];
    setMockBackend(async (_cmd, args) => commands.license_sim_set(args as never) as never);
    const un = await listen("license-changed", () => seen.push("fired"));
    void commands.license_sim_set({ mode: "pro" });
    await new Promise((r) => setTimeout(r, 90));
    expect(seen).toContain("fired");
    un();
  });
});
