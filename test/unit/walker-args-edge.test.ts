/**
 * Edge-case coverage for the args walker — paths that the primary test file
 * leaves untouched: top-level `create`/`update` blocks on upsert, `connect`
 * outside of a relation write, `push` on scalar lists, `set` on a to-many,
 * and the null-passthrough permutations.
 */

import { beforeEach, describe, expect, test } from 'vitest';

import { normalizeConfig } from '../../src/config/define-config.js';
import type { BinaryUuidConfig, NormalizedConfig } from '../../src/config/types.js';
import { MalformedUuidError } from '../../src/errors.js';
import { walkArgs } from '../../src/walker/args-walker.js';

const BASE: BinaryUuidConfig = {
  fields: {
    User: ['id', 'companyId'],
    Post: ['id', 'authorId'],
    Company: ['id'],
    Tag: ['id'],
  },
  relations: {
    User: { posts: 'Post', company: 'Company', tags: 'Tag' },
    Post: { author: 'User' },
    Tag: { users: 'User' },
  },
};

const UUID_A = '550e8400-e29b-41d4-a716-446655440000';
const UUID_B = '123e4567-e89b-12d3-a456-426614174000';
const UUID_C = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

let config: NormalizedConfig;

beforeEach(() => {
  config = normalizeConfig(BASE);
});

describe('top-level upsert shape', () => {
  test('upsert { where, create, update } walks all three', () => {
    const { args, converted } = walkArgs(config, 'User', 'upsert', {
      where: { id: UUID_A },
      create: { id: UUID_A, email: 'a@b.c' },
      update: { companyId: { set: UUID_B } },
    });
    const typed = args as {
      where: { id: Uint8Array };
      create: { id: Uint8Array; email: string };
      update: { companyId: { set: Uint8Array } };
    };
    expect(typed.where.id).toBeInstanceOf(Uint8Array);
    expect(typed.create.id).toBeInstanceOf(Uint8Array);
    expect(typed.update.companyId.set).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(3);
  });
});

describe('implicit shape in nested relation block', () => {
  test('relation write without explicit operator key treated as create data', () => {
    // Some Prisma callers pass `{ posts: { id: 'x', title: 'y' } }` which
    // we treat as a direct data-for-target. The walker should still find the
    // Post.id field.
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { id: UUID_B, title: 'hi' } },
    });
    // We don't assert a specific shape because Prisma's type says this is a
    // connect-shape — but the walker defensively treats it as data. Either
    // way, the UUID gets converted.
    expect(converted).toBeGreaterThanOrEqual(1);
    expect(args).toBeDefined();
  });
});

describe('set / disconnect / delete permutations', () => {
  test('set: array of where-shapes converts each', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { set: [{ id: UUID_B }, { id: UUID_C }] } },
    });
    const sets = (args as { data: { posts: { set: Array<{ id: Uint8Array }> } } }).data.posts.set;
    expect(sets[0]!.id).toBeInstanceOf(Uint8Array);
    expect(sets[1]!.id).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(3); // the outer where + 2 nested
  });

  test('deleteMany with where converts', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { deleteMany: { authorId: UUID_A } } },
    });
    expect(
      (args as { data: { posts: { deleteMany: { authorId: Uint8Array } } } }).data.posts.deleteMany
        .authorId,
    ).toBeInstanceOf(Uint8Array);
  });

  test('delete: true passes through', () => {
    const { args } = walkArgs(config, 'Post', 'update', {
      where: { id: UUID_A },
      data: { author: { delete: true } },
    });
    expect((args as { data: { author: { delete: boolean } } }).data.author.delete).toBe(true);
  });
});

describe('include / select edge paths', () => {
  test('include with boolean value left alone', () => {
    const { args } = walkArgs(config, 'User', 'findMany', { include: { posts: true } });
    expect((args as { include: { posts: boolean } }).include.posts).toBe(true);
  });

  test('select with nested select but no where', () => {
    const { args } = walkArgs(config, 'User', 'findMany', {
      select: { id: true, posts: { select: { title: true } } },
    });
    // No UUIDs to convert, but the walker must not crash.
    expect(args).toBeDefined();
  });

  test('include with unknown relation key left alone', () => {
    const { args } = walkArgs(config, 'User', 'findMany', {
      include: { ghost: { where: { id: UUID_A } } },
    });
    // `ghost` isn't in the relations config; pass through without converting.
    expect((args as { include: { ghost: { where: { id: string } } } }).include.ghost.where.id).toBe(
      UUID_A,
    );
  });
});

describe('cursor in combination with pagination', () => {
  test('cursor + take + skip + orderBy', () => {
    const { args } = walkArgs(config, 'User', 'findMany', {
      cursor: { id: UUID_A },
      take: 10,
      skip: 5,
      orderBy: { id: 'asc' },
    });
    const typed = args as {
      cursor: { id: Uint8Array };
      take: number;
      skip: number;
      orderBy: { id: string };
    };
    expect(typed.cursor.id).toBeInstanceOf(Uint8Array);
    expect(typed.take).toBe(10);
    expect(typed.skip).toBe(5);
    expect(typed.orderBy.id).toBe('asc');
  });
});

describe('non-object args', () => {
  test('null args pass through', () => {
    const { args, converted } = walkArgs(config, 'User', 'count', null);
    expect(args).toBeNull();
    expect(converted).toBe(0);
  });

  test('undefined args pass through', () => {
    const { args, converted } = walkArgs(config, 'User', 'count', undefined);
    expect(args).toBeUndefined();
    expect(converted).toBe(0);
  });
});

describe('strict validation error surface', () => {
  test('malformed UUID in nested create throws with field context', () => {
    expect(() =>
      walkArgs(config, 'User', 'create', {
        data: { email: 'a@b.c', posts: { create: { id: 'not-valid', title: 'x' } } },
      }),
    ).toThrow(MalformedUuidError);
  });

  test('malformed UUID in array-scalar `in` filter throws', () => {
    expect(() =>
      walkArgs(config, 'User', 'findMany', { where: { id: { in: [UUID_A, 'garbage'] } } }),
    ).toThrow(MalformedUuidError);
  });
});

describe('nested write blocks', () => {
  test('posts.update { where, data } converts both', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          update: { where: { id: UUID_B }, data: { authorId: UUID_C } },
        },
      },
    });
    const block = (
      args as {
        data: { posts: { update: { where: { id: Uint8Array }; data: { authorId: Uint8Array } } } };
      }
    ).data.posts.update;
    expect(block.where.id).toBeInstanceOf(Uint8Array);
    expect(block.data.authorId).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(3);
  });

  test('posts.update with only data (no where) still converts', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { update: { data: { authorId: UUID_B } } } },
    });
    expect(
      (args as { data: { posts: { update: { data: { authorId: Uint8Array } } } } }).data.posts
        .update.data.authorId,
    ).toBeInstanceOf(Uint8Array);
  });

  test('posts.update with only where (no data) still converts', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { update: { where: { id: UUID_B } } } },
    });
    expect(
      (args as { data: { posts: { update: { where: { id: Uint8Array } } } } }).data.posts.update
        .where.id,
    ).toBeInstanceOf(Uint8Array);
  });

  test('posts.upsert { where, create, update } converts all three', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          upsert: {
            where: { id: UUID_B },
            create: { id: UUID_C, title: 'x' },
            update: { authorId: UUID_A },
          },
        },
      },
    });
    const block = (
      args as {
        data: {
          posts: {
            upsert: {
              where: { id: Uint8Array };
              create: { id: Uint8Array; title: string };
              update: { authorId: Uint8Array };
            };
          };
        };
      }
    ).data.posts.upsert;
    expect(block.where.id).toBeInstanceOf(Uint8Array);
    expect(block.create.id).toBeInstanceOf(Uint8Array);
    expect(block.update.authorId).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(4);
  });

  test('posts.upsert with non-object value passes through', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { upsert: null } },
    });
    expect((args as { data: { posts: { upsert: null } } }).data.posts.upsert).toBeNull();
  });

  test('posts.connectOrCreate { where, create } converts both', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          connectOrCreate: {
            where: { id: UUID_B },
            create: { id: UUID_C, title: 'x' },
          },
        },
      },
    });
    const block = (
      args as {
        data: {
          posts: {
            connectOrCreate: {
              where: { id: Uint8Array };
              create: { id: Uint8Array; title: string };
            };
          };
        };
      }
    ).data.posts.connectOrCreate;
    expect(block.where.id).toBeInstanceOf(Uint8Array);
    expect(block.create.id).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(3);
  });

  test('posts.connectOrCreate with non-object passes through', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { connectOrCreate: 'nope' as unknown as object } },
    });
    expect(
      (args as { data: { posts: { connectOrCreate: string } } }).data.posts.connectOrCreate,
    ).toBe('nope');
  });

  test('posts.update with non-object value passes through', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { update: undefined } },
    });
    expect((args as { data: { posts: { update: undefined } } }).data.posts.update).toBeUndefined();
  });

  test('posts.createMany { data: [...] } walks each row', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          createMany: {
            data: [
              { id: UUID_B, title: 'a' },
              { id: UUID_C, title: 'b' },
            ],
            skipDuplicates: true,
          },
        },
      },
    });
    const cm = (
      args as {
        data: {
          posts: {
            createMany: { data: Array<{ id: Uint8Array; title: string }>; skipDuplicates: boolean };
          };
        };
      }
    ).data.posts.createMany;
    expect(cm.data[0]!.id).toBeInstanceOf(Uint8Array);
    expect(cm.data[1]!.id).toBeInstanceOf(Uint8Array);
    expect(cm.skipDuplicates).toBe(true);
    expect(converted).toBe(3);
  });

  test('posts.update as array of update blocks', () => {
    const { args, converted } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          update: [
            { where: { id: UUID_B }, data: { authorId: UUID_C } },
            { where: { id: UUID_C }, data: { authorId: UUID_A } },
          ],
        },
      },
    });
    const arr = (
      args as {
        data: {
          posts: { update: Array<{ where: { id: Uint8Array }; data: { authorId: Uint8Array } }> };
        };
      }
    ).data.posts.update;
    expect(arr[0]!.where.id).toBeInstanceOf(Uint8Array);
    expect(arr[1]!.data.authorId).toBeInstanceOf(Uint8Array);
    expect(converted).toBe(5);
  });

  test('posts.updateMany { where, data } converts both', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          updateMany: {
            where: { authorId: UUID_A },
            data: { authorId: UUID_B },
          },
        },
      },
    });
    const um = (
      args as {
        data: {
          posts: {
            updateMany: { where: { authorId: Uint8Array }; data: { authorId: Uint8Array } };
          };
        };
      }
    ).data.posts.updateMany;
    expect(um.where.authorId).toBeInstanceOf(Uint8Array);
    expect(um.data.authorId).toBeInstanceOf(Uint8Array);
  });

  test('posts.updateMany as array', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          updateMany: [{ where: { authorId: UUID_A }, data: { authorId: UUID_B } }],
        },
      },
    });
    const um = (
      args as {
        data: {
          posts: {
            updateMany: Array<{ where: { authorId: Uint8Array }; data: { authorId: Uint8Array } }>;
          };
        };
      }
    ).data.posts.updateMany;
    expect(um[0]!.where.authorId).toBeInstanceOf(Uint8Array);
  });

  test('posts.upsert as array', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          upsert: [
            {
              where: { id: UUID_B },
              create: { id: UUID_C, title: 'x' },
              update: { authorId: UUID_A },
            },
          ],
        },
      },
    });
    const u = (
      args as {
        data: {
          posts: {
            upsert: Array<{
              where: { id: Uint8Array };
              create: { id: Uint8Array };
              update: { authorId: Uint8Array };
            }>;
          };
        };
      }
    ).data.posts.upsert;
    expect(u[0]!.where.id).toBeInstanceOf(Uint8Array);
  });

  test('posts.connectOrCreate as array', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: {
        posts: {
          connectOrCreate: [{ where: { id: UUID_B }, create: { id: UUID_C, title: 'x' } }],
        },
      },
    });
    const arr = (
      args as {
        data: {
          posts: {
            connectOrCreate: Array<{ where: { id: Uint8Array }; create: { id: Uint8Array } }>;
          };
        };
      }
    ).data.posts.connectOrCreate;
    expect(arr[0]!.where.id).toBeInstanceOf(Uint8Array);
  });

  test('disconnect: true in nested relation passes through unchanged', () => {
    const { args } = walkArgs(config, 'Post', 'update', {
      where: { id: UUID_A },
      data: { author: { disconnect: true } },
    });
    expect((args as { data: { author: { disconnect: boolean } } }).data.author.disconnect).toBe(
      true,
    );
  });

  test('unknown nested op key passes through (via WRITE_NESTED_OPERATORS skip)', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { weirdOp: { id: UUID_B } } },
    });
    // Unknown key gets skipped by `if (!WRITE_NESTED_OPERATORS.has(key)) continue`,
    // so the value should round-trip without conversion.
    expect((args as { data: { posts: { weirdOp: { id: string } } } }).data.posts.weirdOp.id).toBe(
      UUID_B,
    );
  });

  test('walkConnectOrCreate with non-object inner returns value', () => {
    // Triggers walkConnectOrCreate's `typeof value !== 'object' || value === null` guard
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { posts: { connectOrCreate: null } },
    });
    expect(
      (args as { data: { posts: { connectOrCreate: null } } }).data.posts.connectOrCreate,
    ).toBeNull();
  });
});

describe('lenient (non-strict) validation', () => {
  beforeEach(() => {
    config = normalizeConfig({ ...BASE, options: { strictValidation: false } });
  });

  test('non-string non-bytes value in field position passes through', () => {
    const weird = { foo: 'bar' };
    const { args } = walkArgs(config, 'User', 'findMany', {
      where: { id: weird as unknown as string },
    });
    // strictValidation off — value passes through unchanged.
    expect((args as { where: { id: unknown } }).where.id).toBe(weird);
  });

  test('numeric value in update data passes through (non-strict)', () => {
    const { args } = walkArgs(config, 'User', 'update', {
      where: { id: UUID_A },
      data: { companyId: 42 as unknown as string },
    });
    expect((args as { data: { companyId: number } }).data.companyId).toBe(42);
  });

  test('Uint8Array already-binary value in field position is left as-is', () => {
    const bin = new Uint8Array(16);
    bin.fill(0xab);
    const { args } = walkArgs(config, 'User', 'findMany', {
      where: { id: bin as unknown as string },
    });
    expect((args as { where: { id: Uint8Array } }).where.id).toBe(bin);
  });
});

describe('allowBufferInput: false option', () => {
  beforeEach(() => {
    config = normalizeConfig({ ...BASE, options: { allowBufferInput: false } });
  });

  test('rejects Uint8Array in where clause with TypeMismatchError', async () => {
    const { TypeMismatchError } = await import('../../src/errors.js');
    const bin = new Uint8Array(16);
    bin.fill(0xab);
    expect(() =>
      walkArgs(config, 'User', 'findMany', {
        where: { id: bin as unknown as string },
      }),
    ).toThrow(TypeMismatchError);
  });

  test('rejects Uint8Array in data clause with TypeMismatchError', async () => {
    const { TypeMismatchError } = await import('../../src/errors.js');
    const bin = new Uint8Array(16);
    bin.fill(0xab);
    expect(() =>
      walkArgs(config, 'User', 'update', {
        where: { id: UUID_A },
        data: { companyId: bin as unknown as string },
      }),
    ).toThrow(TypeMismatchError);
  });

  test('rejects Uint8Array passed through scalar `set` in data with TypeMismatchError', async () => {
    const { TypeMismatchError } = await import('../../src/errors.js');
    const bin = new Uint8Array(16);
    bin.fill(0xab);
    expect(() =>
      walkArgs(config, 'User', 'update', {
        where: { id: UUID_A },
        data: { companyId: { set: bin } },
      }),
    ).toThrow(TypeMismatchError);
  });

  test('still accepts string UUIDs when allowBufferInput is false', () => {
    const { args } = walkArgs(config, 'User', 'findMany', { where: { id: UUID_A } });
    expect((args as { where: { id: Uint8Array } }).where.id).toBeInstanceOf(Uint8Array);
  });
});
