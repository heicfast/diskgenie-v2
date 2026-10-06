/**
 * Unit tests for the duplicates-page decision logic (pure rules — no
 * store, no IPC). The view stays a thin renderer over these.
 */
import { describe, expect, it } from "vitest";
import {
  applyRule,
  filterGroups,
  groupKey,
  MIN_SIZE_FILTERS,
  parentFolder,
  pathDepth,
  pickKeep,
  sortGroups,
  totalsOf,
  type DupeSort,
} from "./dupesRules";
import type { DupeFile, DupeGroup } from "./dupes";

const file = (path: string, modified: number, nodeId = 0): DupeFile => ({ path, nodeId, modified });

const group = (id: number, files: DupeFile[], size: number): DupeGroup => ({
  id,
  files,
  size,
  count: files.length,
  wasted: size * (files.length - 1),
});

describe("pickKeep rules", () => {
  const files = [
    file("C:\\Users\\dev\\Backups\\2023\\a.pdf", 1_000),
    file("C:\\a.pdf", 2_000),
    file("D:\\x\\y\\a.pdf", 3_000),
  ];

  it("newest keeps the highest modified", () => {
    expect(pickKeep(files, "newest")).toBe("D:\\x\\y\\a.pdf");
  });

  it("oldest keeps the lowest modified", () => {
    expect(pickKeep(files, "oldest")).toBe("C:\\Users\\dev\\Backups\\2023\\a.pdf");
  });

  it("shallowest keeps the fewest separators", () => {
    expect(pickKeep(files, "shallowest")).toBe("C:\\a.pdf");
  });

  it("ties keep the first member (path order)", () => {
    const same = [file("b\\z.txt", 5), file("a\\z.txt", 5), file("c\\z.txt", 5)];
    expect(pickKeep(same, "newest")).toBe("b\\z.txt");
    expect(pickKeep(same, "oldest")).toBe("b\\z.txt");
    expect(pickKeep(same, "shallowest")).toBe("b\\z.txt");
  });

  it("empty groups answer an empty keep", () => {
    expect(pickKeep([], "newest")).toBe("");
  });
});

describe("applyRule over groups", () => {
  const groups = [
    group(1, [file("C:\\new.txt", 90), file("C:\\old.txt", 10)], 100),
    group(2, [file("C:\\a\\dup.bin", 50), file("C:\\dup.bin", 40)], 5),
  ];

  it("maps every group to a survivor", () => {
    const m = applyRule(groups, "newest");
    expect(m.get(groupKey(groups[0]))).toBe("C:\\new.txt");
    expect(m.get(groupKey(groups[1]))).toBe("C:\\a\\dup.bin");
    expect(m.size).toBe(2);
  });
});

describe("filtering and sorting", () => {
  const small = group(1, [file("C:\\a\\s.txt", 1), file("C:\\b\\s.txt", 1)], 5 * 1024 * 1024);
  const medium = group(2, [file("C:\\a\\m.bin", 2), file("C:\\b\\m.bin", 2)], 40 * 1024 * 1024);
  const huge = group(3, [file("C:\\a\\h.iso", 3), file("C:\\b\\h.iso", 3), file("C:\\c\\h.iso", 3)], 1024 * 1024 * 1024);

  it("size filters keep only groups clearing the floor", () => {
    expect(filterGroups([small, medium, huge], 0)).toHaveLength(3);
    expect(filterGroups([small, medium, huge], 1024 * 1024)).toHaveLength(3);
    expect(filterGroups([small, medium, huge], 100 * 1024 * 1024)).toEqual([huge]);
  });

  it("the presets are ordered and include an all-pass", () => {
    expect(MIN_SIZE_FILTERS[0].value).toBe(0);
    expect(MIN_SIZE_FILTERS[1].value).toBeLessThan(MIN_SIZE_FILTERS[2].value);
  });

  it("sorts: wasted (default) descending", () => {
    expect(sortGroups([small, medium, huge], "wasted").map((g) => g.id)).toEqual([3, 2, 1]);
  });

  it("sorts: size descending", () => {
    expect(sortGroups([medium, small, huge], "size").map((g) => g.id)).toEqual([3, 2, 1]);
  });

  it("sorts: copy count then wasted", () => {
    expect(sortGroups([medium, huge, small], "count").map((g) => g.id)).toEqual([3, 2, 1]);
  });

  it("sorts: newest group first", () => {
    const old = group(1, [file("C:\\o.bin", 10), file("C:\\o2.bin", 5)], 1);
    const fresh = group(2, [file("C:\\n.bin", 999), file("C:\\n2.bin", 3)], 1);
    expect(sortGroups([old, fresh], "newest").map((g) => g.id)).toEqual([2, 1]);
  });

  it("sorting never mutates the input", () => {
    const input = [small, medium, huge];
    sortGroups(input, "wasted");
    expect(input[0].id).toBe(1);
  });
});

describe("totals and helpers", () => {
  it("totals sum wasted and member counts", () => {
    const a = group(1, [file("a", 0), file("b", 0)], 10);
    const b = group(2, [file("c", 0), file("d", 0), file("e", 0)], 4);
    expect(totalsOf([a, b])).toEqual({ wasted: 10 + 8, files: 5, groups: 2 });
  });

  it("pathDepth counts both separators", () => {
    expect(pathDepth("C:\\a\\b\\c.txt")).toBe(3);
    expect(pathDepth("/home/dev/x.txt")).toBe(3);
    expect(pathDepth("file.txt")).toBe(0);
  });

  it("parentFolder returns the containing folder", () => {
    expect(parentFolder("C:\\Users\\dev\\photo.jpg")).toBe("C:\\Users\\dev");
    expect(parentFolder("photo.jpg")).toBe("");
  });

  it("groupKey is member-content identity (id-independent)", () => {
    const a = group(1, [file("C:\\x.bin", 1), file("C:\\y.bin", 1)], 5);
    const b = group(99, [file("C:\\x.bin", 1), file("C:\\y.bin", 1)], 5);
    expect(groupKey(a)).toBe(groupKey(b));
  });
});

describe("sort order type coverage", () => {
  it("every order is handled without throwing", () => {
    const groups = [group(1, [file("a", 1), file("b", 2)], 3)];
    for (const sort of ["wasted", "size", "count", "newest"] as DupeSort[]) {
      expect(sortGroups(groups, sort)).toHaveLength(1);
    }
  });
});
