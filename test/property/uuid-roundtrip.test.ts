/**
 * Property-based tests for conversion primitives. Run 1,000+ random UUIDs per
 * property per CI run; catches byte-ordering / padding / case-handling bugs
 * that hand-picked examples miss.
 */

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { newUidV4, newUidV7, uidFromBin, uidToBin } from '../../src/conversion/index.js';

const uuidArb = fc.uuid();
const bytesArb = fc.uint8Array({ minLength: 16, maxLength: 16 });

describe('conversion roundtrip properties', () => {
  test('uidFromBin ∘ uidToBin = lowercase identity (string → bin → string)', () => {
    fc.assert(
      fc.property(uuidArb, (uuid) => {
        expect(uidFromBin(uidToBin(uuid))).toBe(uuid.toLowerCase());
      }),
      { numRuns: 2_000 },
    );
  });

  test('uidToBin ∘ uidFromBin = identity (bytes → string → bytes)', () => {
    fc.assert(
      fc.property(bytesArb, (bytes) => {
        expect(Array.from(uidToBin(uidFromBin(bytes)))).toEqual(Array.from(bytes));
      }),
      { numRuns: 2_000 },
    );
  });

  test('uppercase and lowercase input produce the same bytes', () => {
    fc.assert(
      fc.property(uuidArb, (uuid) => {
        const lo = uidToBin(uuid.toLowerCase());
        const hi = uidToBin(uuid.toUpperCase());
        expect(Array.from(lo)).toEqual(Array.from(hi));
      }),
      { numRuns: 1_000 },
    );
  });

  test('dashed and bare-hex forms produce the same bytes', () => {
    fc.assert(
      fc.property(uuidArb, (uuid) => {
        const dashed = uidToBin(uuid);
        const bare = uidToBin(uuid.replace(/-/g, ''));
        expect(Array.from(dashed)).toEqual(Array.from(bare));
      }),
      { numRuns: 1_000 },
    );
  });

  test('output of newUidV4 always roundtrips', () => {
    for (let i = 0; i < 1_000; i++) {
      const bin = newUidV4();
      const str = uidFromBin(bin);
      const back = uidToBin(str);
      expect(Array.from(back)).toEqual(Array.from(bin));
    }
  });

  test('output of newUidV7 always roundtrips', () => {
    for (let i = 0; i < 1_000; i++) {
      const bin = newUidV7();
      const str = uidFromBin(bin);
      const back = uidToBin(str);
      expect(Array.from(back)).toEqual(Array.from(bin));
    }
  });

  test('byte-by-byte lexical ordering is preserved through string conversion', () => {
    fc.assert(
      fc.property(bytesArb, bytesArb, (a, b) => {
        const strA = uidFromBin(a);
        const strB = uidFromBin(b);
        // Compare bytes lexically.
        let byteCmp = 0;
        for (let i = 0; i < 16; i++) {
          if (a[i]! < b[i]!) {
            byteCmp = -1;
            break;
          }
          if (a[i]! > b[i]!) {
            byteCmp = 1;
            break;
          }
        }
        const strCmp = strA < strB ? -1 : strA > strB ? 1 : 0;
        expect(strCmp).toBe(byteCmp);
      }),
      { numRuns: 1_000 },
    );
  });
});
