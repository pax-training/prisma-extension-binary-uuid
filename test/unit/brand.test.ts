import { describe, expect, test } from 'vitest';

import { asString, uuidString } from '../../src/index.js';

describe('uuidString', () => {
  test('returns the input unchanged at runtime', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(uuidString(uuid)).toBe(uuid);
  });

  test('identity for empty string (runtime validation happens in the walker)', () => {
    // uuidString is deliberately a no-op at runtime — bad input is caught
    // with full model+field context inside the args walker, not here.
    expect(uuidString('')).toBe('');
  });

  test('accepts dashed and bare-hex forms unchanged', () => {
    const dashed = '550e8400-e29b-41d4-a716-446655440000';
    const bare = '550e8400e29b41d4a716446655440000';
    expect(uuidString(dashed)).toBe(dashed);
    expect(uuidString(bare)).toBe(bare);
  });
});

describe('asString', () => {
  test('returns the input unchanged', () => {
    const s = 'abc-123';
    expect(asString(s)).toBe(s);
  });

  test('works on a uuidString-branded value', () => {
    const branded = uuidString('550e8400-e29b-41d4-a716-446655440000');
    expect(asString(branded)).toBe(branded);
  });
});
