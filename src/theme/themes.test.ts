/**
 * Theme registry tests (session 16): the five-palette system — family
 * mapping (the scheme attribute + the canvas' dark branches depend on
 * it), storage validation (unknown ids fall back to light), the
 * attribute pairing contract (data-theme + data-scheme are written
 * TOGETHER — CanvasViz's repaint observer and every dark-family CSS
 * rule rely on it), and the pre-mount script's inline mirror staying
 * in sync with the registry.
 *
 * Node-env shims (the registry is browser-bound; vitest runs node):
 * a document root carrying the two attributes + localStorage.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
// Vite raw import (the vite/client types declare `*?raw`): the test
// reads index.html as the bundler sees it — no node:fs needed under
// the app tsconfig (DOM-only types).
import indexHtml from "../../index.html?raw";

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

const attrs = new Map<string, string>();
const docShim = {
  documentElement: {
    getAttribute: (k: string): string | null => attrs.get(k) ?? null,
    setAttribute: (k: string, v: string): void => {
      attrs.set(k, v);
    },
  },
};
const storage = new MemStorage();
vi.stubGlobal("document", docShim);
vi.stubGlobal("window", { localStorage: storage });
vi.stubGlobal(
  "matchMedia",
  vi.fn(() => ({ matches: false })),
);

// Import AFTER the shims exist.
import {
  THEME_IDS,
  THEME_LIST,
  applyThemeAttributes,
  currentDomTheme,
  familyOf,
  nativeThemeFor,
  persistTheme,
  readSavedTheme,
  validateThemeId,
} from "./themes";

const reset = (): void => {
  attrs.clear();
  storage.clear();
};

beforeEach(reset);

describe("theme registry", () => {
  it("ships five themes in picker order (light, dark + the three new palettes)", () => {
    expect([...THEME_IDS]).toEqual(["light", "dark", "ember", "tide", "blossom"]);
    expect(THEME_LIST.map((t) => t.id)).toEqual([...THEME_IDS]);
    expect(THEME_LIST.every((t) => t.label.length > 0)).toBe(true);
  });

  it("maps every theme to the correct family", () => {
    expect(familyOf("light")).toBe("light");
    expect(familyOf("blossom")).toBe("light");
    expect(familyOf("dark")).toBe("dark");
    expect(familyOf("ember")).toBe("dark");
    expect(familyOf("tide")).toBe("dark");
  });

  it("native window theme follows the family", () => {
    for (const id of THEME_IDS) {
      expect(nativeThemeFor(id)).toBe(familyOf(id));
    }
  });
});

describe("storage validation", () => {
  it("accepts every shipped id", () => {
    for (const id of THEME_IDS) {
      expect(validateThemeId(id)).toBe(id);
    }
  });

  it("rejects unknown, null, and legacy values back to light", () => {
    expect(validateThemeId(null)).toBe("light");
    expect(validateThemeId(undefined)).toBe("light");
    expect(validateThemeId("")).toBe("light");
    expect(validateThemeId("sepia")).toBe("light");
    expect(validateThemeId("DARK")).toBe("light"); // case-sensitive on purpose
    expect(validateThemeId("dark ")).toBe("light"); // whitespace is not trimmed
  });

  it("reads the persisted choice and falls back to light", () => {
    expect(readSavedTheme()).toBe("light");
    storage.setItem("diskgenie.theme", "ember");
    expect(readSavedTheme()).toBe("ember");
    storage.setItem("diskgenie.theme", "bogus");
    expect(readSavedTheme()).toBe("light");
  });

  it("persists under the long-standing key", () => {
    persistTheme("tide");
    expect(storage.getItem("diskgenie.theme")).toBe("tide");
  });
});

describe("attribute pairing contract", () => {
  it("applyThemeAttributes writes data-theme AND data-scheme together", () => {
    applyThemeAttributes("ember");
    expect(attrs.get("data-theme")).toBe("ember");
    expect(attrs.get("data-scheme")).toBe("dark");
    applyThemeAttributes("blossom");
    expect(attrs.get("data-theme")).toBe("blossom");
    expect(attrs.get("data-scheme")).toBe("light");
    applyThemeAttributes("light");
    expect(attrs.get("data-theme")).toBe("light");
    expect(attrs.get("data-scheme")).toBe("light");
  });

  it("currentDomTheme validates what the DOM carries (tour flips included)", () => {
    applyThemeAttributes("tide");
    expect(currentDomTheme()).toBe("tide");
    // The CI tour writes attributes directly; a foreign value must not
    // leak into state as-is.
    attrs.set("data-theme", "not-a-theme");
    expect(currentDomTheme()).toBe("light");
    expect(currentDomTheme()).toBe("light");
  });
});

describe("index.html pre-mount mirror", () => {
  // The inline <head> script duplicates the id list + family map so
  // the first paint lands on the saved palette before React mounts.
  // If the registry changes, the mirror must change with it — this
  // pins the exact literals the script embeds.
  it("mirrors the registry's ids and dark-family membership", () => {
    const html = indexHtml;
    expect(html).toContain('["light", "dark", "ember", "tide", "blossom"]');
    expect(html).toContain(
      'theme === "dark" || theme === "ember" || theme === "tide" ? "dark" : "light"',
    );
    // Every theme's first-paint background is present (no white flash
    // on a saved custom palette).
    for (const literal of ["#f5f5f7", "#1e1e20", "#201a15", "#101722", "#fbf1ee"]) {
      expect(html).toContain(literal);
    }
  });
});
