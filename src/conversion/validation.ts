/**
 * Runtime type guards for UUID values. Cheap checks suitable for the hot path.
 */

// RFC 4122 dashed form: 8-4-4-4-12 hex chars. Case-insensitive on input.
const UUID_DASHED_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Bare 32-hex form (what we sometimes emit internally).
const UUID_HEX_RE = /^[0-9a-fA-F]{32}$/;

/**
 * Cheap check whether a value is a syntactically valid UUID string in either
 * dashed or bare hex form. Does NOT throw — returns a boolean suitable for
 * runtime type dispatch.
 */
export function isUuidString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Fast path: length pre-check before regex. The two valid lengths are 32 and 36.
  const len = value.length;
  if (len !== 32 && len !== 36) return false;
  return len === 36 ? UUID_DASHED_RE.test(value) : UUID_HEX_RE.test(value);
}

/**
 * Cheap check whether a value is a 16-byte Uint8Array. `Buffer` (Node) is a
 * subclass of Uint8Array and matches this guard as expected.
 */
export function isUuidBytes(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array && value.length === 16;
}

/**
 * Export the regexes for callers that want to compose their own validation.
 * They are frozen to prevent tampering.
 */
export const UUID_REGEX = Object.freeze({
  dashed: UUID_DASHED_RE,
  hex: UUID_HEX_RE,
});
