/**
 * UUIDv7 generation as 16-byte binary.
 *
 * UUIDv7 format (RFC 9562):
 *   - bytes 0-5: 48-bit Unix timestamp in milliseconds, big-endian
 *   - byte 6: version (7) in high nibble, top 4 bits of rand_a in low nibble
 *   - byte 7: low 8 bits of rand_a
 *   - byte 8: variant (10) in top 2 bits, top 6 bits of rand_b
 *   - bytes 9-15: remaining rand_b (7 bytes = 56 bits)
 *
 * Within-millisecond monotonicity: within the same ms, we increment the 12-bit
 * rand_a counter. This gives up to 4096 unique IDs per ms without resorting to
 * the clock for ordering. Beyond that, we spin to the next ms. This matches
 * the recommendation in RFC 9562 §6.2 method 1.
 */

// State for within-ms monotonicity.
let lastMs = 0;
let subMsCounter = 0;

/**
 * Generate a new UUIDv7 as a 16-byte `Uint8Array`. Timestamp-ordered within a
 * single process; cross-process ordering depends on clock sync.
 *
 * Pass `now` to force a specific timestamp (useful for tests).
 */
export function newUidV7(now?: number): Uint8Array {
  const ms = now ?? Date.now();
  let counter: number;
  if (ms === lastMs) {
    subMsCounter++;
    if (subMsCounter >= 0x1000) {
      // Overflow: spin to next ms. In practice this only happens if you're
      // generating >4096 UUIDs in the same millisecond.
      return newUidV7(ms + 1);
    }
    counter = subMsCounter;
  } else if (ms > lastMs) {
    lastMs = ms;
    subMsCounter = 0;
    counter = 0;
  } else {
    // Clock went backwards (NTP, DST, etc.). Don't emit an out-of-order UUID;
    // pin to lastMs + 1 and bump counter.
    lastMs = lastMs + 1;
    subMsCounter = 0;
    counter = 0;
  }

  const bytes = new Uint8Array(16);

  // Bytes 0-5: 48-bit timestamp, big-endian.
  // JavaScript numbers lose precision above 2^53, but Unix ms fits in 41 bits
  // until the year 2^41 ms / (1000*60*60*24*365.25) ≈ year 72083. Safe.
  bytes[0] = (lastMs / 0x10000000000) & 0xff;
  bytes[1] = (lastMs / 0x100000000) & 0xff;
  bytes[2] = (lastMs >>> 24) & 0xff;
  bytes[3] = (lastMs >>> 16) & 0xff;
  bytes[4] = (lastMs >>> 8) & 0xff;
  bytes[5] = lastMs & 0xff;

  // Byte 6: version (7 in top nibble) + top 4 bits of rand_a (counter high).
  bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
  // Byte 7: low 8 bits of rand_a (counter low).
  bytes[7] = counter & 0xff;

  // Bytes 8-15: variant (10 in top 2 bits of byte 8) + 62 bits of random.
  const rand = new Uint8Array(8);
  globalThis.crypto.getRandomValues(rand);
  bytes[8] = 0x80 | (rand[0]! & 0x3f);
  bytes[9] = rand[1]!;
  bytes[10] = rand[2]!;
  bytes[11] = rand[3]!;
  bytes[12] = rand[4]!;
  bytes[13] = rand[5]!;
  bytes[14] = rand[6]!;
  bytes[15] = rand[7]!;

  return bytes;
}

/**
 * Reset internal state. Test-only — don't call in production.
 * @internal
 */
export function _resetV7StateForTesting(): void {
  lastMs = 0;
  subMsCounter = 0;
}
