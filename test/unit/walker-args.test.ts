/**
 * Args-walker unit tests. Exercises every Prisma query shape we support.
 *
 * These tests mock Prisma's interface entirely — they don't touch a database.
 * Integration tests cover the DB round-trip.
 */

import { beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../../src/config/define-config.js';
import type { BinaryUuidConfig, NormalizedConfig } from '../../src/config/types.js';
import { uidFromBin } from '../../src/conversion/index.js';
import { MalformedUuidError, TypeMismatchError } from '../../src/errors.js';
import { walkArgs } from '../../src/walker/args-walker.js';

// A two-model schema with a relation. Exercises both field-level UUID
// conversion and relation-pivoting.
const BASE_CONFIG: BinaryUuidConfig = {
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
};

let config: NormalizedConfig;

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174000';

beforeEach(() => {
  config = normalizeConfig(BASE_CONFIG);
});

function walk(model: string, operation: string, args: unknown) {
  return walkArgs(config, model, operation, args);
}

describe('scalar where', () => {
  test('direct scalar equality converts string to binary', () => {
    const { args, converted } = walk('User', 'findUnique', { where: { id: UUID_A } });
    const w = (args as { where: { id: Uint8Array } }).where;
    expect(w.id).toBeInstanceOf(Uint8Array);
    expect(uidFromBin(w.id)).toBe(UUID_A);
    expect(converted).toBe(1);
  });

  test('equals operator converts', () => {
    const { args } = walk('User', 'findFirst', { where: { id: { equals: UUID_A } } });
    const inner = (args as { where: { id: { equals: Uint8Array } } }).where.id.equals;
    expect(uidFromBin(inner)).toBe(UUID_A);
  });

  test('not operator (scalar) converts', () => {
    const { args } = walk('User', 'findFirst', { where: { id: { not: UUID_A } } });
    const inner = (args as { where: { id: { not: Uint8Array } } }).where.id.not;
    expect(uidFromBin(inner)).toBe(UUID_A);
  });

  test('in operator converts each array element', () => {
    const { args, converted } = walk('User', 'findMany', {
      where: { id: { in: [UUID_A, UUID_B] } },
    });
    const inner = (args as { where: { id: { in: Uint8Array[] } } }).where.id.in;
    expect(inner.every((b) => b instanceof Uint8Array)).toBe(true);
    expect(uidFromBin(inner[0]!)).toBe(UUID_A);
    expect(uidFromBin(inner[1]!)).toBe(UUID_B);
    expect(converted).toBe(2);
  });

  test('notIn operator converts each array element', () => {
    const { args } = walk('User', 'findMany', {
      where: { id: { notIn: [UUID_A, UUID_B] } },
    });
    const inner = (args as { where: { id: { notIn: Uint8Array[] } } }).where.id.notIn;
    expect(inner.every((b) => b instanceof Uint8Array)).toBe(true);
  });

  test('null value in UUID field is preserved', () => {
    const { args, converted } = walk('User', 'findFirst', { where: { id: null } });
    expect((args as { where: { id: null } }).where.id).toBeNull();
    expect(converted).toBe(0);
  });

  test('not: null is preserved', () => {
    const { args } = walk('User', 'findFirst', { where: { id: { not: null } } });
    expect((args as { where: { id: { not: null } } }).where.id.not).toBeNull();
  });

  test('non-UUID fields are left alone', () => {
    const { args, converted } = walk('User', 'findMany', {
      where: { name: 'Alice', id: UUID_A },
    });
    const w = args as { where: { name: string; id: Uint8Array } };
    expect(w.where.name).toBe('Alice');
    expect(w.where.id).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(1);
  });

  test('Uint8Array value passes through (idempotency)', () => {
    const bytes = new Uint8Array(16).fill(0x55);
    const { args, converted } = walk('User', 'findUnique', { where: { id: bytes } });
    expect((args as { where: { id: Uint8Array } }).where.id).toBe(bytes);
    expect(converted).toBe(0);
  });
});

describe('logical combinators', () => {
  test('AND as array recurses each clause', () => {
    const { args } = walk('User', 'findMany', {
      where: { AND: [{ id: UUID_A }, { companyId: UUID_B }] },
    });
    const and = (args as { where: { AND: Array<{ id?: Uint8Array; companyId?: Uint8Array }> } })
      .where.AND;
    expect(and[0]!.id).toBeInstanceOf(Uint8Array);
    expect(and[1]!.companyId).toBeInstanceOf(Uint8Array);
  });

  test('OR as array recurses each clause', () => {
    const { args } = walk('User', 'findMany', {
      where: { OR: [{ id: UUID_A }, { id: UUID_B }] },
    });
    const or = (args as { where: { OR: Array<{ id: Uint8Array }> } }).where.OR;
    expect(or[0]!.id).toBeInstanceOf(Uint8Array);
    expect(or[1]!.id).toBeInstanceOf(Uint8Array);
  });

  test('NOT as single object recurses', () => {
    const { args } = walk('User', 'findMany', { where: { NOT: { id: UUID_A } } });
    const not = (args as { where: { NOT: { id: Uint8Array } } }).where.NOT;
    expect(not.id).toBeInstanceOf(Uint8Array);
  });

  test('deeply nested AND[OR[NOT[AND]]]', () => {
    const { args, converted } = walk('User', 'findMany', {
      where: {
        AND: [{ OR: [{ NOT: { AND: [{ id: UUID_A }] } }] }],
      },
    });
    expect(converted).toBe(1);
    // Navigate: AND[0].OR[0].NOT.AND[0].id
    const and = (
      args as {
        where: {
          AND: Array<{ OR: Array<{ NOT: { AND: Array<{ id: Uint8Array }> } }> }>;
        };
      }
    ).where.AND;
    const id = and[0]!.OR[0]!.NOT.AND[0]!.id;
    expect(id).toBeInstanceOf(Uint8Array);
  });
});

describe('relation filters', () => {
  test('some pivots to target model scope', () => {
    const { args, converted } = walk('User', 'findMany', {
      where: { posts: { some: { authorId: UUID_A } } },
    });
    const inner = (
      args as {
        where: { posts: { some: { authorId: Uint8Array } } };
      }
    ).where.posts.some.authorId;
    expect(inner).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(1);
  });

  test('every pivots', () => {
    const { args } = walk('User', 'findMany', {
      where: { posts: { every: { authorId: UUID_A } } },
    });
    const inner = (
      args as {
        where: { posts: { every: { authorId: Uint8Array } } };
      }
    ).where.posts.every.authorId;
    expect(inner).toBeInstanceOf(Uint8Array);
  });

  test('none pivots', () => {
    const { args } = walk('User', 'findMany', {
      where: { posts: { none: { authorId: UUID_A } } },
    });
    expect(
      (args as { where: { posts: { none: { authorId: Uint8Array } } } }).where.posts.none.authorId,
    ).toBeInstanceOf(Uint8Array);
  });

  test('is pivots (to-one)', () => {
    const { args } = walk('Post', 'findFirst', {
      where: { author: { is: { id: UUID_A } } },
    });
    expect(
      (args as { where: { author: { is: { id: Uint8Array } } } }).where.author.is.id,
    ).toBeInstanceOf(Uint8Array);
  });

  test('isNot pivots', () => {
    const { args } = walk('Post', 'findFirst', {
      where: { author: { isNot: { id: UUID_A } } },
    });
    expect(
      (args as { where: { author: { isNot: { id: Uint8Array } } } }).where.author.isNot.id,
    ).toBeInstanceOf(Uint8Array);
  });
});

describe('data (create / update)', () => {
  test('top-level scalar on create', () => {
    const { args, converted } = walk('User', 'create', {
      data: { id: UUID_A, name: 'Alice', companyId: UUID_B },
    });
    const data = (
      args as {
        data: { id: Uint8Array; companyId: Uint8Array; name: string };
      }
    ).data;
    expect(data.id).toBeInstanceOf(Uint8Array);
    expect(data.companyId).toBeInstanceOf(Uint8Array);
    expect(data.name).toBe('Alice');
    expect(converted).toBe(2);
  });

  test('set on update', () => {
    const { args } = walk('User', 'update', {
      where: { id: UUID_A },
      data: { companyId: { set: UUID_B } },
    });
    const data = (args as { data: { companyId: { set: Uint8Array } } }).data;
    expect(data.companyId.set).toBeInstanceOf(Uint8Array);
  });

  test('auto-generates id on create when omitted', () => {
    const { args, converted } = walk('User', 'create', { data: { name: 'Bob' } });
    const data = (args as { data: { id: Uint8Array; name: string } }).data;
    expect(data.id).toBeInstanceOf(Uint8Array);
    expect(data.id.length).toBe(16);
    expect(data.name).toBe('Bob');
    expect(converted).toBe(1); // The generated id.
  });

  test('honors provided id on create', () => {
    const { args } = walk('User', 'create', { data: { id: UUID_A, name: 'Bob' } });
    const data = (args as { data: { id: Uint8Array } }).data;
    expect(data.id).toBeInstanceOf(Uint8Array);
    expect(uidFromBin(data.id)).toBe(UUID_A);
  });

  test('createMany auto-gens per row', () => {
    const { args } = walk('User', 'createMany', {
      data: [{ name: 'A' }, { name: 'B', id: UUID_A }, { name: 'C' }],
    });
    const rows = (args as { data: Array<{ id: Uint8Array; name: string }> }).data;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.id).toBeInstanceOf(Uint8Array);
    }
    // Row 2 had explicit id.
    expect(uidFromBin(rows[1]!.id)).toBe(UUID_A);
    // Row 1 and 3 were auto-generated — unique.
    expect(uidFromBin(rows[0]!.id)).not.toBe(uidFromBin(rows[2]!.id));
  });
});

describe('nested writes', () => {
  test('create with author.connect', () => {
    const { args } = walk('Post', 'create', {
      data: { title: 'Hello', author: { connect: { id: UUID_A } } },
    });
    const connect = (args as { data: { author: { connect: { id: Uint8Array } } } }).data.author
      .connect;
    expect(connect.id).toBeInstanceOf(Uint8Array);
  });

  test('connectOrCreate converts both where and create', () => {
    const { args } = walk('Post', 'create', {
      data: {
        title: 'Hello',
        author: {
          connectOrCreate: {
            where: { id: UUID_A },
            create: { id: UUID_B, name: 'Alice' },
          },
        },
      },
    });
    const coc = (
      args as {
        data: {
          author: {
            connectOrCreate: {
              where: { id: Uint8Array };
              create: { id: Uint8Array; name: string };
            };
          };
        };
      }
    ).data.author.connectOrCreate;
    expect(coc.where.id).toBeInstanceOf(Uint8Array);
    expect(coc.create.id).toBeInstanceOf(Uint8Array);
  });

  test('upsert nested converts where, create, and update', () => {
    const { args } = walk('User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          upsert: {
            where: { id: UUID_B },
            create: { id: UUID_B, title: 'new' },
            update: { title: 'updated' },
          },
        },
      },
    });
    const upsert = (
      args as {
        data: {
          posts: {
            upsert: {
              where: { id: Uint8Array };
              create: { id: Uint8Array };
              update: { title: string };
            };
          };
        };
      }
    ).data.posts.upsert;
    expect(upsert.where.id).toBeInstanceOf(Uint8Array);
    expect(upsert.create.id).toBeInstanceOf(Uint8Array);
  });

  test('disconnect: { id: x } converts', () => {
    const { args } = walk('User', 'update', {
      where: { id: UUID_A },
      data: { posts: { disconnect: { id: UUID_B } } },
    });
    expect(
      (args as { data: { posts: { disconnect: { id: Uint8Array } } } }).data.posts.disconnect.id,
    ).toBeInstanceOf(Uint8Array);
  });

  test('disconnect: true passes through', () => {
    const { args } = walk('Post', 'update', {
      where: { id: UUID_A },
      data: { author: { disconnect: true } },
    });
    expect((args as { data: { author: { disconnect: boolean } } }).data.author.disconnect).toBe(
      true,
    );
  });

  test('deeply nested create with 3 levels of relations', () => {
    const { args, converted } = walk('Company', 'create', {
      data: {
        name: 'Acme',
        users: {
          create: {
            name: 'Alice',
            posts: {
              create: [{ title: 'First' }, { title: 'Second' }],
            },
          },
        },
      },
    });
    // Expect auto-gen IDs at Company, User, and both Posts = 4 generations.
    expect(converted).toBeGreaterThanOrEqual(4);
    const data = args as {
      data: {
        id: Uint8Array;
        users: { create: { id: Uint8Array; posts: { create: Array<{ id: Uint8Array }> } } };
      };
    };
    expect(data.data.id).toBeInstanceOf(Uint8Array);
    expect(data.data.users.create.id).toBeInstanceOf(Uint8Array);
    expect(data.data.users.create.posts.create[0]!.id).toBeInstanceOf(Uint8Array);
    expect(data.data.users.create.posts.create[1]!.id).toBeInstanceOf(Uint8Array);
  });

  test('createMany inside relation.createMany', () => {
    const { args } = walk('User', 'create', {
      data: {
        name: 'Alice',
        posts: { createMany: { data: [{ title: 'A' }, { title: 'B' }] } },
      },
    });
    const data = args as {
      data: { posts: { createMany: { data: Array<{ id: Uint8Array; title: string }> } } };
    };
    for (const row of data.data.posts.createMany.data) {
      expect(row.id).toBeInstanceOf(Uint8Array);
    }
  });
});

describe('cursor pagination', () => {
  test('cursor id converts', () => {
    const { args } = walk('User', 'findMany', { cursor: { id: UUID_A }, take: 10 });
    expect((args as { cursor: { id: Uint8Array } }).cursor.id).toBeInstanceOf(Uint8Array);
  });
});

describe('include / select', () => {
  test('include with nested where converts', () => {
    const { args } = walk('User', 'findMany', {
      include: { posts: { where: { authorId: UUID_A } } },
    });
    expect(
      (args as { include: { posts: { where: { authorId: Uint8Array } } } }).include.posts.where
        .authorId,
    ).toBeInstanceOf(Uint8Array);
  });

  test('select with nested where converts', () => {
    const { args } = walk('User', 'findMany', {
      select: { id: true, posts: { where: { authorId: UUID_A } } },
    });
    expect(
      (args as { select: { posts: { where: { authorId: Uint8Array } } } }).select.posts.where
        .authorId,
    ).toBeInstanceOf(Uint8Array);
  });
});

describe('error handling', () => {
  test('malformed UUID string throws', () => {
    expect(() => walk('User', 'findUnique', { where: { id: 'not-a-uuid' } })).toThrow(
      MalformedUuidError,
    );
  });

  test('wrong type for UUID field throws in strict mode (default)', () => {
    expect(() => walk('User', 'findUnique', { where: { id: 42 as unknown as string } })).toThrow(
      TypeMismatchError,
    );
  });

  test('wrong type passes through when strictValidation disabled', () => {
    const lax = normalizeConfig({ ...BASE_CONFIG, options: { strictValidation: false } });
    const { args } = walkArgs(lax, 'User', 'findUnique', {
      where: { id: 42 as unknown as string },
    });
    expect((args as { where: { id: number } }).where.id).toBe(42);
  });
});

describe('unknown model / no model', () => {
  test('$executeRaw-style args with no model passes through', () => {
    const { args, converted } = walk(undefined as unknown as string, 'findMany', {
      where: { id: UUID_A },
    });
    // Since model is undefined the walker returns args unchanged.
    expect(args).toEqual({ where: { id: UUID_A } });
    expect(converted).toBe(0);
  });
});
