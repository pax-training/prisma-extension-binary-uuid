/**
 * UUIDv4 generation as 16-byte binary.
 *
 * Uses Node's built-in `crypto.randomUUID()` (cryptographically strong, no
 * dependencies) and converts to binary via our own primitives so generation
 * and storage both use the same byte layout.
 */

import { randomUUID } from 'node:crypto';

import { uidToBin } from './uuid-binary.js';

/**
 * Generate a new UUIDv4 as a 16-byte `Uint8Array`. Two allocations (one string
 * from crypto.randomUUID, one Uint8Array from uidToBin). If you're in a
 * performance-critical hot loop and want a single allocation, call
 * `newUidV4Raw()` which uses crypto.getRandomValues directly.
 */
export function newUidV4(): Uint8Array {
  return uidToBin(randomUUID());
}

/**
 * Single-allocation UUIDv4 generation. Uses `crypto.getRandomValues()` and
 * sets the version + variant bits manually. Functionally identical to
 * `newUidV4()` but without the intermediate string.
 */
export function newUidV4Raw(): Uint8Array {
  const bytes = new Uint8Array(16);
  // Node's global crypto is available in Node 18+.
  globalThis.crypto.getRandomValues(bytes);
  // Set version to 4 (high nibble of byte 6).
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  // Set variant to RFC 4122 (high two bits of byte 8 = 10).
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
}
