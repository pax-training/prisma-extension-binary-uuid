/**
 * Unit tests for the extension factory: end-to-end behavior of the query
 * interceptor, driven through a stubbed `query` function so we don't need a
 * real Prisma runtime.
 */

import { describe, expect, test, vi } from 'vitest';

import { uidFromBin, uidToBin } from '../../src/conversion/index.js';
import { BINARY_UUID_EXTENSION_MARKER, createBinaryUuidExtension } from '../../src/extension.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174000';

/**
 * Capture the raw extension spec by invoking the factory's returned closure
 * against a stub client. `Prisma.defineExtension(obj)` returns
 * `(client) => client.$extends(obj)` — so to recover the spec we hand it a
 * `$extends` that just records its argument.
 */
type SpecShape = {
  name: string;
  query: {
    $allModels: {
      $allOperations: (ctx: {
        model: string | undefined;
        operation: string;
        args: unknown;
        query: (args: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
  };
  client: { $binaryUuidExtensionMarker: symbol };
};

function captureSpec(config: Parameters<typeof createBinaryUuidExtension>[0]): SpecShape {
  const factory = createBinaryUuidExtension(config) as unknown as (client: {
    $extends: (ext: unknown) => unknown;
  }) => unknown;
  let captured: unknown;
  const stub = {
    $extends: (ext: unknown): unknown => {
      captured = ext;
      return stub;
    },
  };
  factory(stub);
  if (captured === undefined) {
    throw new Error('extension factory did not call client.$extends');
  }
  return captured as SpecShape;
}

function getHandler(
  config: Parameters<typeof createBinaryUuidExtension>[0],
): SpecShape['query']['$allModels']['$allOperations'] {
  return captureSpec(config).query.$allModels.$allOperations;
}

const BASE_CONFIG = {
  fields: { User: ['id'], Post: ['id', 'authorId'] },
  relations: { User: { posts: 'Post' }, Post: { author: 'User' } },
};

describe('createBinaryUuidExtension — basic wiring', () => {
  test('returns a Prisma extension spec with our name', () => {
    const spec = captureSpec(BASE_CONFIG);
    expect(spec.name).toBe('prisma-extension-binary-uuid');
  });

  test('spec carries the version marker symbol on its client surface', () => {
    const spec = captureSpec(BASE_CONFIG);
    expect(spec.client.$binaryUuidExtensionMarker).toBe(BINARY_UUID_EXTENSION_MARKER);
  });

  test('marker symbol is registered via Symbol.for (same identity across imports)', () => {
    expect(BINARY_UUID_EXTENSION_MARKER).toBe(Symbol.for('prisma-extension-binary-uuid.v1'));
  });
});

describe('extension handler — arg + result conversion', () => {
  test('converts string UUID in where.id to binary, converts binary back in result', async () => {
    const handler = getHandler(BASE_CONFIG);
    const downstream = vi.fn(async (args: unknown) => {
      const typed = args as { where: { id: Uint8Array } };
      // Prove the handler converted the string to binary BEFORE passing to Prisma.
      expect(typed.where.id).toBeInstanceOf(Uint8Array);
      return { id: typed.where.id, name: 'Alice' };
    });

    const result = await handler({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: downstream,
    });

    expect(downstream).toHaveBeenCalledOnce();
    // Result came back as a string.
    expect((result as { id: string }).id).toBe(UUID_A);
    expect((result as { name: string }).name).toBe('Alice');
  });

  test('auto-generates id on create when caller omits it', async () => {
    const handler = getHandler(BASE_CONFIG);
    const downstream = vi.fn(async (args: unknown) => {
      const typed = args as { data: { id: Uint8Array; email: string } };
      expect(typed.data.id).toBeInstanceOf(Uint8Array);
      expect(typed.data.id.length).toBe(16);
      return { id: typed.data.id, email: typed.data.email };
    });

    const result = await handler({
      model: 'User',
      operation: 'create',
      args: { data: { email: 'a@b.c' } },
      query: downstream,
    });

    // The generated UUID round-trips as a string.
    expect(typeof (result as { id: string }).id).toBe('string');
    expect((result as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test('unknown model passes through untouched', async () => {
    const handler = getHandler(BASE_CONFIG);
    const downstream = vi.fn(async (args: unknown) => args);
    const args = { where: { id: UUID_A } };
    await handler({ model: undefined, operation: 'findUnique', args, query: downstream });
    expect(downstream).toHaveBeenCalledWith(args); // unchanged
  });
});

describe('extension handler — metrics hook', () => {
  test('invokes onQuery with counts + duration', async () => {
    const onQuery = vi.fn();
    const handler = getHandler({
      ...BASE_CONFIG,
      options: { metrics: { onQuery } },
    });

    await handler({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: async () => ({ id: uidToBin(UUID_B) }),
    });

    expect(onQuery).toHaveBeenCalledOnce();
    const call = onQuery.mock.calls[0]![0] as {
      model: string;
      operation: string;
      durationMs: number;
      argsConverted: number;
      resultConverted: number;
    };
    expect(call.model).toBe('User');
    expect(call.operation).toBe('findUnique');
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
    expect(call.argsConverted).toBe(1);
    expect(call.resultConverted).toBe(1);
  });

  test('a thrown metrics callback must not break the query', async () => {
    const errors: unknown[] = [];
    const handler = getHandler({
      ...BASE_CONFIG,
      options: {
        metrics: {
          onQuery: () => {
            throw new Error('metrics-boom');
          },
        },
        logger: {
          error: (msg, ctx) => {
            errors.push({ msg, ctx });
          },
        },
      },
    });

    // Query must still resolve successfully.
    const out = await handler({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: async () => ({ id: uidToBin(UUID_B) }),
    });
    expect((out as { id: string }).id).toBe(UUID_B);
    // And the logger saw the thrown error.
    expect(errors).toHaveLength(1);
    expect(String((errors[0] as { msg: string }).msg)).toContain('metrics');
  });

  test('handler does not time the query when no metrics hook is provided', async () => {
    const handler = getHandler(BASE_CONFIG);
    const spy = vi.spyOn(performance, 'now');
    await handler({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: async () => ({ id: uidToBin(UUID_B) }),
    });
    // performance.now should NOT be called because onQuery is undefined.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('logger sees stringified non-Error thrown from metrics callback', async () => {
    const errors: unknown[] = [];
    const handler = getHandler({
      ...BASE_CONFIG,
      options: {
        metrics: {
          onQuery: () => {
            throw 'plain-string-not-an-Error';
          },
        },
        logger: {
          error: (msg, ctx) => {
            errors.push({ msg, ctx });
          },
        },
      },
    });

    await handler({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: async () => ({ id: uidToBin(UUID_B) }),
    });

    expect(errors).toHaveLength(1);
    expect((errors[0] as { ctx: { error: string } }).ctx.error).toBe('plain-string-not-an-Error');
  });
});

describe('idempotency', () => {
  test('applying the extension twice still produces correct output', async () => {
    const outer = getHandler(BASE_CONFIG);
    const inner = getHandler(BASE_CONFIG);

    const result = await outer({
      model: 'User',
      operation: 'findUnique',
      args: { where: { id: UUID_A } },
      query: async (args1: unknown) => {
        // Re-run through the inner handler with the (already-converted) args.
        return inner({
          model: 'User',
          operation: 'findUnique',
          args: args1,
          query: async (args2: unknown) => {
            // Deepest call sees binary id.
            const w = (args2 as { where: { id: Uint8Array } }).where;
            expect(w.id).toBeInstanceOf(Uint8Array);
            return { id: w.id };
          },
        });
      },
    });

    // End-to-end still returns a string.
    expect((result as { id: string }).id).toBe(UUID_A);
  });
});

// Quick helper so the test file exercises the conversion module itself (part
// of our coverage target is that the extension truly uses the conversion
// primitives, not some stub).
describe('binary ↔ string conversion inside the extension chain', () => {
  test('round-trips through uidToBin/uidFromBin', () => {
    const bin = uidToBin(UUID_A);
    expect(uidFromBin(bin)).toBe(UUID_A);
  });
});
