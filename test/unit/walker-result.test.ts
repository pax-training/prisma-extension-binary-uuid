import { beforeEach, describe, expect, test } from 'vitest';

import { uidToBin } from '../../src/conversion/index.js';
import { normalizeConfig } from '../../src/config/define-config.js';
import type { NormalizedConfig } from '../../src/config/types.js';
import { walkResult } from '../../src/walker/result-walker.js';

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174000';
const UUID_C = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let config: NormalizedConfig;

beforeEach(() => {
  config = normalizeConfig({
    fields: {
      User: ['id', 'companyId'],
      Post: ['id', 'authorId'],
      Company: ['id'],
    },
    relations: {
      User: { posts: 'Post', company: 'Company' },
      Post: { author: 'User' },
      Company: { users: 'User' },
    },
  });
});

function walk(model: string, operation: string, result: unknown) {
  return walkResult(config, model, operation, result);
}

describe('scalar result', () => {
  test('single object with UUID fields converts to strings', () => {
    const input = { id: uidToBin(UUID_A), companyId: uidToBin(UUID_B), name: 'Alice' };
    const { result, converted } = walk('User', 'findUnique', input);
    expect(result).toEqual({ id: UUID_A, companyId: UUID_B, name: 'Alice' });
    expect(converted).toBe(2);
  });

  test('null result passes through', () => {
    const { result, converted } = walk('User', 'findUnique', null);
    expect(result).toBeNull();
    expect(converted).toBe(0);
  });

  test('undefined result passes through', () => {
    const { result, converted } = walk('User', 'findUnique', undefined);
    expect(result).toBeUndefined();
    expect(converted).toBe(0);
  });

  test('non-UUID Uint8Array field is left alone', () => {
    // Imagine a model with a 'avatar' Bytes field storing an image.
    const input = { id: uidToBin(UUID_A), avatar: new Uint8Array([1, 2, 3, 4, 5]) };
    const { result } = walk('User', 'findUnique', input);
    const r = result as { id: string; avatar: Uint8Array };
    expect(r.id).toBe(UUID_A);
    expect(r.avatar).toBeInstanceOf(Uint8Array);
    expect(r.avatar.length).toBe(5);
  });

  test('null UUID field is preserved', () => {
    const input = { id: uidToBin(UUID_A), companyId: null };
    const { result } = walk('User', 'findUnique', input);
    const r = result as { id: string; companyId: null };
    expect(r.id).toBe(UUID_A);
    expect(r.companyId).toBeNull();
  });
});

describe('array result', () => {
  test('findMany returns array of converted objects', () => {
    const input = [
      { id: uidToBin(UUID_A), name: 'Alice' },
      { id: uidToBin(UUID_B), name: 'Bob' },
    ];
    const { result, converted } = walk('User', 'findMany', input);
    const r = result as Array<{ id: string; name: string }>;
    expect(r[0]!.id).toBe(UUID_A);
    expect(r[1]!.id).toBe(UUID_B);
    expect(converted).toBe(2);
  });

  test('empty array returns empty', () => {
    const { result, converted } = walk('User', 'findMany', []);
    expect(result).toEqual([]);
    expect(converted).toBe(0);
  });
});

describe('nested relations', () => {
  test('user with include posts pivots model scope', () => {
    const input = {
      id: uidToBin(UUID_A),
      name: 'Alice',
      posts: [
        { id: uidToBin(UUID_B), title: 'P1', authorId: uidToBin(UUID_A) },
        { id: uidToBin(UUID_C), title: 'P2', authorId: uidToBin(UUID_A) },
      ],
    };
    const { result, converted } = walk('User', 'findUnique', input);
    const r = result as {
      id: string;
      posts: Array<{ id: string; authorId: string }>;
    };
    expect(r.id).toBe(UUID_A);
    expect(r.posts[0]!.id).toBe(UUID_B);
    expect(r.posts[0]!.authorId).toBe(UUID_A);
    expect(r.posts[1]!.id).toBe(UUID_C);
    expect(converted).toBe(5);
  });

  test('to-one relation converts', () => {
    const input = {
      id: uidToBin(UUID_A),
      title: 'Hello',
      authorId: uidToBin(UUID_B),
      author: { id: uidToBin(UUID_B), name: 'Alice' },
    };
    const { result } = walk('Post', 'findUnique', input);
    const r = result as { id: string; authorId: string; author: { id: string } };
    expect(r.id).toBe(UUID_A);
    expect(r.authorId).toBe(UUID_B);
    expect(r.author.id).toBe(UUID_B);
  });

  test('null relation is preserved', () => {
    const input = { id: uidToBin(UUID_A), title: 'Hello', author: null };
    const { result } = walk('Post', 'findUnique', input);
    expect((result as { author: null }).author).toBeNull();
  });

  test('3-level deep relation chain', () => {
    const input = {
      id: uidToBin(UUID_A),
      name: 'Acme',
      users: [
        {
          id: uidToBin(UUID_B),
          companyId: uidToBin(UUID_A),
          name: 'Alice',
          posts: [{ id: uidToBin(UUID_C), authorId: uidToBin(UUID_B), title: 'Hi' }],
        },
      ],
    };
    const { result } = walk('Company', 'findUnique', input);
    const r = result as {
      id: string;
      users: Array<{ id: string; companyId: string; posts: Array<{ id: string; authorId: string }> }>;
    };
    expect(r.id).toBe(UUID_A);
    expect(r.users[0]!.id).toBe(UUID_B);
    expect(r.users[0]!.companyId).toBe(UUID_A);
    expect(r.users[0]!.posts[0]!.id).toBe(UUID_C);
    expect(r.users[0]!.posts[0]!.authorId).toBe(UUID_B);
  });
});

describe('aggregation results', () => {
  test('_max over UUID field converts', () => {
    const input = { _max: { id: uidToBin(UUID_A), name: 'Zed' }, _count: { _all: 5 } };
    const { result } = walk('User', 'aggregate', input);
    const r = result as { _max: { id: string; name: string }; _count: { _all: number } };
    expect(r._max.id).toBe(UUID_A);
    expect(r._max.name).toBe('Zed');
    expect(r._count._all).toBe(5);
  });

  test('_min + _max both convert', () => {
    const input = { _min: { id: uidToBin(UUID_A) }, _max: { id: uidToBin(UUID_B) } };
    const { result } = walk('User', 'aggregate', input);
    const r = result as { _min: { id: string }; _max: { id: string } };
    expect(r._min.id).toBe(UUID_A);
    expect(r._max.id).toBe(UUID_B);
  });
});

describe('idempotency', () => {
  test('already-string UUID passes through', () => {
    const input = { id: UUID_A, name: 'Alice' };
    const { result, converted } = walk('User', 'findUnique', input);
    expect(result).toEqual(input);
    expect(converted).toBe(0);
  });
});

describe('unknown model', () => {
  test('undefined model returns result unchanged', () => {
    const input = { id: uidToBin(UUID_A) };
    const { result, converted } = walk(undefined as unknown as string, 'findMany', input);
    expect(result).toBe(input);
    expect(converted).toBe(0);
  });
});
