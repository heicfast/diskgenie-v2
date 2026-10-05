/**
 * Platform detection (cross-platform doc §4 Option A): the SAME frontend
 * runs on Windows (WebView2) and macOS (WKWebView). Chrome differences
 * are gated on this flag — never a code fork.
 */
export type Platform = "windows" | "macos" | "other";

declare global {
  interface Window {
    __DB_PLATFORM__?: Platform;
  }
}

function detect(): Platform {
  if (typeof window !== "undefined") {
    const injected = window.__DB_PLATFORM__;
    if (injected === "windows" || injected === "macos" || injected === "other") {
      return injected;
    }
  }
  // Host-safe: unit tests import this module transitively (the Recent
  // row → ROOT_VIEW_LABEL) under a plain Node environment, where the
  // navigator global does not exist before Node 21 (CI's vitest node is
  // 20). An unknown host answers "other" — the same semantics as an
  // unrecognized browser, not a crash at import time.
  const ua = typeof navigator === "undefined" ? "" : navigator.userAgent;
  if (ua.includes("Macintosh")) return "macos";
  if (ua.includes("Windows")) return "windows";
  return "other";
}

export const PLATFORM: Platform = detect();

export const IS_MAC = PLATFORM === "macos";
export const IS_WINDOWS = PLATFORM === "windows";

/** macOS modifier in labels (⌘) vs Windows (Ctrl). */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

/** Recycle Bin (Windows) vs Trash (macOS) — BuildPrompt §9 / Mac prompt §8. */
export const BIN_NAME = IS_MAC ? "Trash" : "Recycle Bin";

/** The primary file manager verb. */
export const REVEAL_NAME = IS_MAC ? "Reveal in Finder" : "Show in Explorer";

/** CTA copy on the sidebar ink button (spec §6.1 / Mac prompt §5.1). */
export const SCAN_THIS_PC = IS_MAC ? "Scan Full Mac" : "Scan This PC";

/** The synthetic whole-machine view's display name — the ROOT of a
 * This-PC scan, the Recents row, the storage card's aggregate label,
 * the inspector's virtual-root title. The Windows convention is "This
 * PC"; the Mac vocabulary matches the "Scan Full Mac" CTA (Mac prompt
 * §5.1). The command-seam identity stays "ThisPC" on both platforms —
 * this is the DISPLAY label only. */
export const ROOT_VIEW_LABEL = IS_MAC ? "Full Mac" : "This PC";

/** The machine noun for hero copy ("Map every byte on your …"). */
export const MACHINE_NOUN = IS_MAC ? "Mac" : "PC";

/** Who owns protected/system items in the inspector's copy ("… manages
 * this item"): macOS on Mac (SIP/Full-Disk-Access denials), Windows
 * on Windows (ACL-protected system files). */
export const SYSTEM_OWNER = IS_MAC ? "macOS" : "Windows";
