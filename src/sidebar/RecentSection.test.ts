/**
 * Recents normalization + dedupe tests (session 13): the twin
 * "This PC"/"ThisPC" rows after an elevated --scan relaunch were the
 * owner's report — ONE normalization point and case-insensitive
 * identity kill them. Node-env shims stand in for the browser
 * storage/event surface pushRecent touches.
 */
import { beforeEach, describe, expect, it } from "vitest";

// window/localStorage shims (the module under test is browser-bound;
// the vitest environment is node).
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
const listeners: ((e: { type: string }) => void)[] = [];
const shim = {
  localStorage: new MemStorage(),
  dispatchEvent: (e: Event) => {
    for (const l of listeners) l(e);
    return true;
  },
};
(globalThis as Record<string, unknown>).window = shim;

// Import AFTER the shim exists (module init reads window lazily, but
// the pushRecent path touches it immediately).
import { pushRecent, recentTargetLabel } from "./RecentSection";

const stored = (): string[] => JSON.parse(shim.localStorage.getItem("diskgenie.recent") ?? "[]");

describe("recentTargetLabel", () => {
  it("normalizes every This-PC spelling to one label", () => {
    expect(recentTargetLabel("ThisPC")).toBe("This PC");
    expect(recentTargetLabel("This PC")).toBe("This PC");
    expect(recentTargetLabel(" thispc ")).toBe("This PC");
    expect(recentTargetLabel("THIS PC")).toBe("This PC");
  });

  it("leaves real paths untouched", () => {
    expect(recentTargetLabel("C:\\")).toBe("C:\\");
    expect(recentTargetLabel("D:\\Games")).toBe("D:\\Games");
  });
});

describe("pushRecent (session 13 dedupe)", () => {
  beforeEach(() => shim.localStorage.clear());

  it("the ThisPC/This PC pair collapses to one row", () => {
    pushRecent("ThisPC");
    pushRecent("This PC");
    expect(stored()).toEqual(["This PC"]);
  });

  it("identity is case-insensitive for paths", () => {
    pushRecent("C:\\Users\\Dev");
    pushRecent("c:\\users\\dev");
    // One row; the most-recent push's spelling is the one kept.
    expect(stored()).toEqual(["c:\\users\\dev"]);
  });

  it("caps the list at 2 with most-recent-first", () => {
    pushRecent("C:\\");
    pushRecent("D:\\");
    pushRecent("E:\\");
    expect(stored()).toEqual(["E:\\", "D:\\"]);
  });

  it("re-push moves an existing entry to the front", () => {
    pushRecent("C:\\");
    pushRecent("D:\\");
    pushRecent("C:\\");
    expect(stored()).toEqual(["C:\\", "D:\\"]);
  });
});
