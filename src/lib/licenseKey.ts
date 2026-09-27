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

/** Display grouping `XXXXX-XXXXX-XXXXX-XXXXX-XXXX` (5-char groups). */
export function formatKey(normalized: string): string {
  return normalized.replace(/(.{5})(?=.)/g, "$1-");
}

/**
 * Is the entered key COMPLETE (activatable)? Drives the dialog's
 * Later/Purchase → Activate button swap (owner decision: the Activate
 * button only appears once the full key is in).
 */
export function isCompleteKey(raw: string): boolean {
  return isValidKeyShape(normalizeKey(raw));
}
