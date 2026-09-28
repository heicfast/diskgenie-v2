/**
 * License key shape helpers (docs/LICENSING-ARCHITECTURE.md §3.3).
 *
 * Keys are `DB` + 20 Crockford base32 chars (no I/L/O/U — no
 * confusables), displayed as five 5-char groups. Shared by the
 * activation dialog (the "Activate" button appears only for a
 * complete key) and the unit tests; the Rust layer normalizes the
 * same way (commands/license.rs `normalize_key`) and the server
 * hashes the same normalized form.
 */

/** Crockford base32 alphabet (excludes I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Normalized length: "DB" + 20 chars. */
export const KEY_LENGTH = 22;

/** Uppercase + strip everything non-alphanumeric. */
export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/** Structural validity of a normalized key. */
export function isValidKeyShape(normalized: string): boolean {
  return (
    normalized.length === KEY_LENGTH &&
    normalized.startsWith("DB") &&
    normalized
      .slice(2)
      .split("")
      .every((c) => ALPHABET.includes(c))
  );
}

/**
 * Display grouping matching the SERVER's key format (keys.ts
 * generateKey: "DB-" + four 5-char groups). v1 grouped the 22 chars
 * as 5-5-5-5-2 ("DBXK2-M9QF3-…"), which disagreed with the purchase
 * email's "DB-EQGA0-F17AN-7HGKB-5J3VE" — normalization strips dashes
 * either way, but the dialog's auto-formatting and any future key
 * display must match what the user actually received.
 */
export function formatKey(normalized: string): string {
  if (normalized.length <= 2) return normalized;
  const body = normalized.slice(2).replace(/(.{5})(?=.)/g, "$1-");
  return `DB-${body}`;
}

/**
 * Is the entered key COMPLETE (activatable)? Drives the dialog's
 * Later/Purchase → Activate button swap (owner decision: the Activate
 * button only appears once the full key is in).
 */
export function isCompleteKey(raw: string): boolean {
  return isValidKeyShape(normalizeKey(raw));
}
