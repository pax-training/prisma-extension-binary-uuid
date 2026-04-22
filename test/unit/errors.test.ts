import { describe, expect, test } from 'vitest';

import {
  BinaryUuidError,
  InvalidConfigError,
  MalformedUuidError,
  TypeMismatchError,
  UnknownFieldError,
  UnknownModelError,
  WrongLengthUuidError,
} from '../../src/errors.js';

describe('BinaryUuidError base', () => {
  test('sets code, message, and context fields', () => {
    const err = new BinaryUuidError('BINARY_UUID_MALFORMED', 'broken', {
      model: 'User',
      field: 'id',
      operation: 'findUnique',
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BinaryUuidError);
    expect(err.code).toBe('BINARY_UUID_MALFORMED');
    expect(err.message).toBe('broken');
    expect(err.model).toBe('User');
    expect(err.field).toBe('id');
    expect(err.operation).toBe('findUnique');
    expect(err.name).toBe('BinaryUuidError');
  });

  test('context is optional; undefined fields stay undefined', () => {
    const err = new BinaryUuidError('BINARY_UUID_INVALID_CONFIG', 'msg');
    expect(err.model).toBeUndefined();
    expect(err.field).toBeUndefined();
    expect(err.operation).toBeUndefined();
  });

  test('toJSON omits sensitive context but includes safe fields', () => {
    const err = new BinaryUuidError('BINARY_UUID_MALFORMED', 'broken', {
      model: 'User',
      field: 'id',
    });
    const json = err.toJSON();
    expect(json).toEqual({
      name: 'BinaryUuidError',
      code: 'BINARY_UUID_MALFORMED',
      message: 'broken',
      model: 'User',
      field: 'id',
      operation: undefined,
    });
  });

  test('prototype chain preserved (instanceof works after JSON round-trip logic)', () => {
    const err = new BinaryUuidError('BINARY_UUID_INVALID_CONFIG', 'msg');
    expect(err instanceof BinaryUuidError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });
});

describe('MalformedUuidError', () => {
  test('includes length in message', () => {
    const err = new MalformedUuidError('nope', { model: 'User', field: 'id' });
    expect(err.code).toBe('BINARY_UUID_MALFORMED');
    expect(err.message).toContain('4 chars');
    expect(err.message).toContain('User.id');
    expect(err.name).toBe('MalformedUuidError');
    expect(err._valueDebug).toBe('nope');
  });

  test('works without context', () => {
    const err = new MalformedUuidError('bad');
    expect(err.code).toBe('BINARY_UUID_MALFORMED');
    expect(err._valueDebug).toBe('bad');
    // Without a field, the message should NOT carry an "at X.Y" suffix.
    expect(err.message).not.toContain(' at ');
  });

  test('with model but no field omits the "at" suffix', () => {
    const err = new MalformedUuidError('bad', { model: 'User' });
    expect(err.message).not.toContain(' at ');
  });

  test('with field but no model emits "?.field" placeholder', () => {
    const err = new MalformedUuidError('bad', { field: 'id' });
    expect(err.message).toContain('?.id');
  });

  test('toJSON does not leak _valueDebug', () => {
    const err = new MalformedUuidError('sensitive-uuid', { model: 'User', field: 'id' });
    const json = JSON.stringify(err.toJSON());
    expect(json).not.toContain('sensitive-uuid');
    expect(json).not.toContain('_valueDebug');
  });

  test('is catchable as BinaryUuidError', () => {
    const err = new MalformedUuidError('x');
    expect(err instanceof BinaryUuidError).toBe(true);
    expect(err instanceof MalformedUuidError).toBe(true);
  });
});

describe('WrongLengthUuidError', () => {
  test('reports actual length', () => {
    const err = new WrongLengthUuidError(15, { model: 'Post', field: 'id' });
    expect(err.code).toBe('BINARY_UUID_WRONG_LENGTH');
    expect(err.actualLength).toBe(15);
    expect(err.message).toContain('16 bytes');
    expect(err.message).toContain('15');
    expect(err.message).toContain('Post.id');
  });

  test('works without context', () => {
    const err = new WrongLengthUuidError(17);
    expect(err.message).toContain('17');
    expect(err.message).not.toContain(' at ');
  });

  test('with field but no model uses "?" placeholder', () => {
    const err = new WrongLengthUuidError(8, { field: 'id' });
    expect(err.message).toContain('?.id');
  });
});

describe('UnknownModelError', () => {
  test('names the model in message', () => {
    const err = new UnknownModelError('Ghost');
    expect(err.code).toBe('BINARY_UUID_UNKNOWN_MODEL');
    expect(err.message).toContain('Ghost');
    expect(err.model).toBe('Ghost');
  });
});

describe('UnknownFieldError', () => {
  test('names model and field', () => {
    const err = new UnknownFieldError('User', 'shoeSize');
    expect(err.code).toBe('BINARY_UUID_UNKNOWN_FIELD');
    expect(err.message).toContain('User.shoeSize');
    expect(err.model).toBe('User');
    expect(err.field).toBe('shoeSize');
  });
});

describe('InvalidConfigError', () => {
  test('prefixes message with context', () => {
    const err = new InvalidConfigError('missing fields');
    expect(err.code).toBe('BINARY_UUID_INVALID_CONFIG');
    expect(err.message).toContain('missing fields');
  });
});

describe('TypeMismatchError', () => {
  test('records actualType + context', () => {
    const err = new TypeMismatchError('number', { model: 'User', field: 'id' });
    expect(err.code).toBe('BINARY_UUID_TYPE_MISMATCH');
    expect(err.actualType).toBe('number');
    expect(err.message).toContain('number');
    expect(err.message).toContain('User.id');
  });

  test('works without context', () => {
    const err = new TypeMismatchError('boolean');
    expect(err.message).toContain('boolean');
    // No field → no "at X.Y" suffix.
    expect(err.message).not.toContain('?.');
  });

  test('with field but no model emits "?.field"', () => {
    const err = new TypeMismatchError('number', { field: 'id' });
    expect(err.message).toContain('?.id');
  });
});
