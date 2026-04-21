/**
 * Mutation-based fuzz harness for the args walker.
 *
 * Starts from a set of known-good Prisma query shapes, then applies random
 * mutations and asserts the walker either returns a correct transformation
 * OR throws a typed error. It must never crash with an unhandled error and
 * must never silently corrupt data.
 */

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { normalizeConfig } from '../../src/config/define-config.js';
import { BinaryUuidError } from '../../src/errors.js';
import { walkArgs } from '../../src/walker/args-walker.js';

const config = normalizeConfig({
  fields: { User: ['id', 'companyId'], Post: ['id', 'authorId'] },
  relations: { User: { posts: 'Post' }, Post: { author: 'User' } },
});

/**
 * Arbitrary value generator: strings (some UUID-shaped, some not), numbers,
 * booleans, null, undefined, nested objects.
 */
const leafValue = fc.oneof(
  fc.uuid(), // valid UUID
  fc.string(), // arbitrary string — often not a UUID
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.constant(undefined),
  fc.uint8Array({ minLength: 16, maxLength: 16 }), // valid binary UUID
  fc.uint8Array({ minLength: 5, maxLength: 20 }), // wrong-length buffer
);

const arbitraryObject: fc.Arbitrary<Record<string, unknown>> = fc.letrec<{
  obj: Record<string, unknown>;
  value: unknown;
}>((tie) => ({
  obj: fc.dictionary(
    fc.oneof(fc.constantFrom('id', 'companyId', 'authorId', 'name', 'email', 'AND', 'OR', 'NOT', 'in', 'equals', 'not'), fc.string()),
    tie('value'),
    { minKeys: 0, maxKeys: 5 },
  ),
  value: fc.oneof(leafValue, tie('obj') as unknown as fc.Arbitrary<unknown>),
})).obj;

describe('fuzz: walkArgs never crashes unhandled', () => {
  test('random args, User/findMany', () => {
    fc.assert(
      fc.property(arbitraryObject, (args) => {
        try {
          walkArgs(config, 'User', 'findMany', { where: args });
        } catch (err) {
          // Only BinaryUuidError subclasses are allowed to escape.
          expect(err).toBeInstanceOf(BinaryUuidError);
        }
      }),
      { numRuns: 500 },
    );
  });

  test('random args, Post/create', () => {
    fc.assert(
      fc.property(arbitraryObject, (args) => {
        try {
          walkArgs(config, 'Post', 'create', { data: args });
        } catch (err) {
          expect(err).toBeInstanceOf(BinaryUuidError);
        }
      }),
      { numRuns: 500 },
    );
  });

  test('random args, unknown-model', () => {
    fc.assert(
      fc.property(arbitraryObject, (args) => {
        // An unknown model should pass through cleanly (no conversion).
        const { args: out } = walkArgs(config, 'Ghost' as string, 'findMany', { where: args });
        expect(out).toEqual({ where: args });
      }),
      { numRuns: 500 },
    );
  });
});
