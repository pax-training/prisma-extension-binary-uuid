/**
 * UUID ↔ 16-byte binary conversion primitives.
 *
 * Performance note: these run once per UUID value on both the read and write
 * side. For a query that touches 10,000 rows with 3 UUID fields each, that's
 * 30,000 conversions. We keep them allocation-minimal and branch-free on the
 * hot path.
 */

import { MalformedUuidError, WrongLengthUuidError } from '../errors.js';

import { UUID_REGEX } from './validation.js';

// Lookup table for byte → 2-char hex. Constructed once at module load; saves
// a toString(16) call per byte on the read side.
const BYTE_TO_HEX: readonly string[] = (() => {
  const out = new Array<string>(256);
  for (let i = 0; i < 256; i++) {
    out[i] = i.toString(16).padStart(2, '0');
  }
  return Object.freeze(out);
})();

// Reverse lookup: hex char code → nibble. -1 for invalid. The 256-entry table
// avoids a conditional per char on the write side.
const HEX_CHAR_TO_NIBBLE: Int8Array = (() => {
  const out = new Int8Array(256).fill(-1);
  for (let i = 0; i < 10; i++) out[0x30 + i] = i; // '0'-'9'
  for (let i = 0; i < 6; i++) {
    out[0x41 + i] = 10 + i; // 'A'-'F'
    out[0x61 + i] = 10 + i; // 'a'-'f'
  }
  return out;
})();

/**
 * Convert a UUID string (with or without dashes, any case) to a 16-byte
 * `Uint8Array`. Throws `MalformedUuidError` on any parse failure.
 *
 * Strict by design — callers must pass canonical UUIDs.
 */
export function uidToBin(uuid: string): Uint8Array {
  if (typeof uuid !== 'string') {
    throw new MalformedUuidError(String(uuid));
  }

  const len = uuid.length;
  if (len !== 32 && len !== 36) {
    throw new MalformedUuidError(uuid);
  }
  if (len === 36 ? !UUID_REGEX.dashed.test(uuid) : !UUID_REGEX.hex.test(uuid)) {
    throw new MalformedUuidError(uuid);
  }

  const out = new Uint8Array(16);
  let srcIdx = 0;
  let dstIdx = 0;
  const hasDashes = len === 36;

  while (dstIdx < 16) {
    // Skip dashes when we know they're at positions 8, 13, 18, 23.
    if (hasDashes && (srcIdx === 8 || srcIdx === 13 || srcIdx === 18 || srcIdx === 23)) {
      srcIdx++;
      continue;
    }
    const hi = HEX_CHAR_TO_NIBBLE[uuid.charCodeAt(srcIdx)] as number;
    const lo = HEX_CHAR_TO_NIBBLE[uuid.charCodeAt(srcIdx + 1)] as number;
    // Both regex and lookup-table paths agree on validity, so unexpected -1
    // here would be a logic error rather than untrusted input.
    out[dstIdx] = (hi << 4) | lo;
    srcIdx += 2;
    dstIdx++;
  }

  return out;
}

/**
 * Convert a 16-byte `Uint8Array` (or `Buffer`, a subclass) to a lowercase
 * dashed UUID string. Throws `WrongLengthUuidError` if the input isn't 16 bytes.
 */
export function uidFromBin(bin: Uint8Array): string {
  if (!(bin instanceof Uint8Array)) {
    throw new WrongLengthUuidError(-1);
  }
  if (bin.length !== 16) {
    throw new WrongLengthUuidError(bin.length);
  }

  // Single allocation; use the precomputed byte→hex lookup.
  // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return (
    BYTE_TO_HEX[bin[0]!]! +
    BYTE_TO_HEX[bin[1]!]! +
    BYTE_TO_HEX[bin[2]!]! +
    BYTE_TO_HEX[bin[3]!]! +
    '-' +
    BYTE_TO_HEX[bin[4]!]! +
    BYTE_TO_HEX[bin[5]!]! +
    '-' +
    BYTE_TO_HEX[bin[6]!]! +
    BYTE_TO_HEX[bin[7]!]! +
    '-' +
    BYTE_TO_HEX[bin[8]!]! +
    BYTE_TO_HEX[bin[9]!]! +
    '-' +
    BYTE_TO_HEX[bin[10]!]! +
    BYTE_TO_HEX[bin[11]!]! +
    BYTE_TO_HEX[bin[12]!]! +
    BYTE_TO_HEX[bin[13]!]! +
    BYTE_TO_HEX[bin[14]!]! +
    BYTE_TO_HEX[bin[15]!]!
  );
}

/**
 * Re-export of the cheap validators so consumers can import them from the
 * conversion module rather than reaching into validation directly.
 */
export { isUuidString, isUuidBytes } from './validation.js';
