import { describe, expect, it } from "vitest";
import { formatKey, isCompleteKey, isValidKeyShape, KEY_LENGTH, normalizeKey } from "./licenseKey";

// A structurally valid key: "DB" + 20 Crockford chars = 22 normalized.
const GOOD_KEY = "DBXK2M9QF3P8NR4T2VW6Y4";
const GOOD_KEY_DASHED = "DB-XK2M9-QF3P8-NR4T2-VW6Y4";

describe("licenseKey", () => {
  it("normalizes messy input", () => {
    expect(normalizeKey(` ${GOOD_KEY_DASHED} `)).toBe(GOOD_KEY);
    expect(normalizeKey("db.xk2m9 qf3p8nr4t2vw6y4")).toBe(GOOD_KEY);
    expect(normalizeKey("")).toBe("");
  });

  it("accepts complete keys, rejects partial/confusable ones", () => {
    expect(isCompleteKey(GOOD_KEY_DASHED)).toBe(true);
    expect(isCompleteKey(GOOD_KEY.toLowerCase())).toBe(true);
    // Wrong length (21 normalized).
    expect(isCompleteKey("DB-XK2M9-QF3P8-NR4T2-VW6")).toBe(false);
    // Confusable letters excluded by the alphabet.
    expect(isCompleteKey("DB" + "ILOU".repeat(5))).toBe(false);
    // Wrong prefix.
    expect(isCompleteKey("AB" + "X".repeat(20))).toBe(false);
    expect(isCompleteKey("")).toBe(false);
  });

  it("shape check mirrors normalization", () => {
    expect(isValidKeyShape(normalizeKey(GOOD_KEY_DASHED))).toBe(true);
    expect(isValidKeyShape("DBXK2M9QF3P8")).toBe(false);
  });

  it("formats display groups like the server (DB- + 4×5)", () => {
    // The purchase email shows DB-XK2M9-QF3P8-NR4T2-VW6Y4 — the
    // display form must match what the user received.
    expect(formatKey(GOOD_KEY)).toBe(GOOD_KEY_DASHED);
    expect(formatKey("DB")).toBe("DB");
    expect(formatKey("DBXK2")).toBe("DB-XK2");
    // Paste-with-dashes normalizes back to the same display form.
    expect(formatKey(normalizeKey(GOOD_KEY_DASHED))).toBe(GOOD_KEY_DASHED);
  });

  it("key length is the wire constant", () => {
    expect(KEY_LENGTH).toBe(22);
  });
});
