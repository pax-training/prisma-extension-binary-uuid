import { describe, expect, test } from 'vitest';

import {
  isUuidBytes,
  isUuidString,
  newUidV4,
  newUidV4Raw,
  newUidV7,
  uidFromBin,
  uidToBin,
} from '../../src/conversion/index.js';
import { MalformedUuidError, WrongLengthUuidError } from '../../src/errors.js';

// A fixed, well-known UUID we can reason about by inspection.
const KNOWN = '550e8400-e29b-41d4-a716-446655440000';
const KNOWN_HEX = '550e8400e29b41d4a716446655440000';
const KNOWN_BYTES = new Uint8Array([
  0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x41, 0xd4, 0xa7, 0x16, 0x44, 0x66, 0x55, 0x44, 0x00, 0x00,
]);

describe('uidToBin', () => {
  test('converts dashed UUID to 16-byte Uint8Array', () => {
    const bin = uidToBin(KNOWN);
    expect(bin).toBeInstanceOf(Uint8Array);
    expect(bin.length).toBe(16);
    expect(Array.from(bin)).toEqual(Array.from(KNOWN_BYTES));
  });

  test('converts bare-hex UUID to 16-byte Uint8Array', () => {
    const bin = uidToBin(KNOWN_HEX);
    expect(Array.from(bin)).toEqual(Array.from(KNOWN_BYTES));
  });

  test('accepts uppercase', () => {
    const bin = uidToBin(KNOWN.toUpperCase());
    expect(Array.from(bin)).toEqual(Array.from(KNOWN_BYTES));
  });

  test('accepts mixed case', () => {
    const bin = uidToBin('550E8400-e29b-41D4-a716-446655440000');
    expect(Array.from(bin)).toEqual(Array.from(KNOWN_BYTES));
  });

  test('rejects non-string', () => {
    expect(() => uidToBin(123 as unknown as string)).toThrow(MalformedUuidError);
    expect(() => uidToBin(null as unknown as string)).toThrow(MalformedUuidError);
    expect(() => uidToBin(undefined as unknown as string)).toThrow(MalformedUuidError);
    expect(() => uidToBin({} as unknown as string)).toThrow(MalformedUuidError);
  });

  test('rejects wrong length', () => {
    expect(() => uidToBin('too-short')).toThrow(MalformedUuidError);
    expect(() => uidToBin('a'.repeat(31))).toThrow(MalformedUuidError);
    expect(() => uidToBin('a'.repeat(33))).toThrow(MalformedUuidError);
    expect(() => uidToBin('a'.repeat(37))).toThrow(MalformedUuidError);
  });

  test('rejects non-hex characters', () => {
    expect(() => uidToBin('550e8400-e29b-41d4-a716-44665544000Z')).toThrow(MalformedUuidError);
    expect(() => uidToBin('g'.repeat(32))).toThrow(MalformedUuidError);
  });

  test('rejects malformed dashes', () => {
    // Dashes at wrong positions.
    expect(() => uidToBin('550e8400-e29b41d4-a716-4466-55440000')).toThrow(MalformedUuidError);
    // Too many dashes.
    expect(() => uidToBin('550-e8400-e29b-41d4-a716-446655440000')).toThrow(MalformedUuidError);
  });

  test('rejects empty string', () => {
    expect(() => uidToBin('')).toThrow(MalformedUuidError);
  });

  test('all-zero UUID converts correctly', () => {
    const bin = uidToBin('00000000-0000-0000-0000-000000000000');
    expect(Array.from(bin)).toEqual(new Array(16).fill(0));
  });

  test('all-ones UUID converts correctly', () => {
    const bin = uidToBin('ffffffff-ffff-ffff-ffff-ffffffffffff');
    expect(Array.from(bin)).toEqual(new Array(16).fill(0xff));
  });
});

describe('uidFromBin', () => {
  test('converts 16-byte Uint8Array to lowercase dashed UUID', () => {
    expect(uidFromBin(KNOWN_BYTES)).toBe(KNOWN);
  });

  test('accepts Buffer (Uint8Array subclass)', () => {
    const buf = Buffer.from(KNOWN_BYTES);
    expect(uidFromBin(buf)).toBe(KNOWN);
  });

  test('always emits lowercase', () => {
    const result = uidFromBin(KNOWN_BYTES);
    expect(result).toBe(result.toLowerCase());
  });

  test('rejects wrong length', () => {
    expect(() => uidFromBin(new Uint8Array(15))).toThrow(WrongLengthUuidError);
    expect(() => uidFromBin(new Uint8Array(17))).toThrow(WrongLengthUuidError);
    expect(() => uidFromBin(new Uint8Array(0))).toThrow(WrongLengthUuidError);
  });

  test('rejects non-Uint8Array', () => {
    expect(() => uidFromBin('string' as unknown as Uint8Array)).toThrow(WrongLengthUuidError);
    expect(() => uidFromBin([1, 2, 3] as unknown as Uint8Array)).toThrow(WrongLengthUuidError);
    expect(() => uidFromBin(null as unknown as Uint8Array)).toThrow(WrongLengthUuidError);
  });

  test('all-zero bytes produce canonical zero UUID', () => {
    const bin = new Uint8Array(16);
    expect(uidFromBin(bin)).toBe('00000000-0000-0000-0000-000000000000');
  });

  test('all-ones bytes produce canonical ones UUID', () => {
    const bin = new Uint8Array(16).fill(0xff);
    expect(uidFromBin(bin)).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
  });
});

describe('isUuidString', () => {
  test('accepts dashed UUID', () => {
    expect(isUuidString(KNOWN)).toBe(true);
  });
  test('accepts bare-hex UUID', () => {
    expect(isUuidString(KNOWN_HEX)).toBe(true);
  });
  test('accepts uppercase', () => {
    expect(isUuidString(KNOWN.toUpperCase())).toBe(true);
  });
  test('rejects non-string', () => {
    expect(isUuidString(123)).toBe(false);
    expect(isUuidString(null)).toBe(false);
    expect(isUuidString(undefined)).toBe(false);
    expect(isUuidString({})).toBe(false);
    expect(isUuidString(new Uint8Array(16))).toBe(false);
  });
  test('rejects wrong length', () => {
    expect(isUuidString('short')).toBe(false);
    expect(isUuidString('a'.repeat(31))).toBe(false);
    expect(isUuidString('a'.repeat(33))).toBe(false);
    expect(isUuidString('a'.repeat(37))).toBe(false);
  });
  test('rejects malformed', () => {
    expect(isUuidString('g'.repeat(32))).toBe(false);
    expect(isUuidString('550e8400_e29b_41d4_a716_446655440000')).toBe(false);
  });
});

describe('isUuidBytes', () => {
  test('accepts 16-byte Uint8Array', () => {
    expect(isUuidBytes(new Uint8Array(16))).toBe(true);
  });
  test('accepts Buffer', () => {
    expect(isUuidBytes(Buffer.alloc(16))).toBe(true);
  });
  test('rejects wrong-length Uint8Array', () => {
    expect(isUuidBytes(new Uint8Array(15))).toBe(false);
    expect(isUuidBytes(new Uint8Array(17))).toBe(false);
  });
  test('rejects non-Uint8Array', () => {
    expect(isUuidBytes('string')).toBe(false);
    expect(isUuidBytes([1, 2, 3])).toBe(false);
    expect(isUuidBytes(null)).toBe(false);
  });
});

describe('newUidV4', () => {
  test('returns 16-byte Uint8Array', () => {
    const bin = newUidV4();
    expect(bin).toBeInstanceOf(Uint8Array);
    expect(bin.length).toBe(16);
  });

  test('has v4 version bits', () => {
    const bin = newUidV4();
    // Byte 6 high nibble must be 0x4.
    expect(bin[6]! & 0xf0).toBe(0x40);
    // Byte 8 high two bits must be 10 (RFC 4122 variant).
    expect(bin[8]! & 0xc0).toBe(0x80);
  });

  test('is random (100 calls all unique)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(uidFromBin(newUidV4()));
    }
    expect(seen.size).toBe(100);
  });

  test('roundtrips through uidFromBin → uidToBin', () => {
    const bin = newUidV4();
    const str = uidFromBin(bin);
    const back = uidToBin(str);
    expect(Array.from(back)).toEqual(Array.from(bin));
  });
});

describe('newUidV4Raw', () => {
  test('returns 16-byte Uint8Array with correct version/variant', () => {
    const bin = newUidV4Raw();
    expect(bin.length).toBe(16);
    expect(bin[6]! & 0xf0).toBe(0x40);
    expect(bin[8]! & 0xc0).toBe(0x80);
  });
});

describe('newUidV7', () => {
  test('returns 16-byte Uint8Array', () => {
    const bin = newUidV7();
    expect(bin.length).toBe(16);
  });

  test('has v7 version bits', () => {
    const bin = newUidV7();
    expect(bin[6]! & 0xf0).toBe(0x70);
    expect(bin[8]! & 0xc0).toBe(0x80);
  });

  test('timestamp bytes match provided ms', () => {
    const ms = 0x123456789abc;
    const bin = newUidV7(ms);
    // Bytes 0-5 big-endian should encode the timestamp.
    expect(bin[0]).toBe(0x12);
    expect(bin[1]).toBe(0x34);
    expect(bin[2]).toBe(0x56);
    expect(bin[3]).toBe(0x78);
    expect(bin[4]).toBe(0x9a);
    expect(bin[5]).toBe(0xbc);
  });

  test('sequential ids are monotonically ordered', () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) {
      ids.push(uidFromBin(newUidV7()));
    }
    const sorted = [...ids].sort();
    expect(ids).toEqual(sorted);
  });

  test('within-ms uniqueness (10,000 calls in tight loop)', () => {
    const seen = new Set<string>();
    const fixedMs = Date.now();
    for (let i = 0; i < 10_000; i++) {
      seen.add(uidFromBin(newUidV7(fixedMs)));
    }
    expect(seen.size).toBe(10_000);
  });
});
