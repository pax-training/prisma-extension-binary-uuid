/**
 * Walker overhead microbenchmarks.
 *
 * The walker runs on every query. We want to keep its overhead well under
 * the cost of the database round-trip so that adoption has zero perf cost
 * in the absence of other wins.
 *
 * Target: sub-microsecond per scalar UUID conversion, sub-5ms for a 1000-row
 * findMany with 3 UUID fields per row.
 */

import { bench, describe } from 'vitest';

import { uidFromBin, uidToBin } from '../../src/conversion/index.js';
import { normalizeConfig } from '../../src/config/define-config.js';
import { walkArgs } from '../../src/walker/args-walker.js';
import { walkResult } from '../../src/walker/result-walker.js';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const BYTES = uidToBin(UUID);

const config = normalizeConfig({
  fields: {
    User: ['id', 'companyId'],
    Post: ['id', 'authorId'],
  },
  relations: {
    User: { posts: 'Post' },
    Post: { author: 'User' },
  },
});

describe('conversion primitives', () => {
  bench('uidToBin (dashed)', () => {
    uidToBin(UUID);
  });

  bench('uidFromBin', () => {
    uidFromBin(BYTES);
  });
});

describe('walkArgs', () => {
  bench('findUnique by id', () => {
    walkArgs(config, 'User', 'findUnique', { where: { id: UUID } });
  });

  bench('findMany with in [10]', () => {
    walkArgs(config, 'User', 'findMany', {
      where: { id: { in: new Array(10).fill(UUID) } },
    });
  });

  bench('nested create 3 levels deep', () => {
    walkArgs(config, 'User', 'create', {
      data: {
        email: 'a@b.c',
        posts: {
          create: [
            { title: 'A', author: { connect: { id: UUID } } },
            { title: 'B' },
          ],
        },
      },
    });
  });
});

describe('walkResult', () => {
  bench('findUnique (single row, 2 UUID fields)', () => {
    walkResult(config, 'User', 'findUnique', { id: BYTES, companyId: BYTES, name: 'a' });
  });

  bench('findMany 1000 rows, 2 UUID fields each', () => {
    const rows = new Array(1000).fill({ id: BYTES, companyId: BYTES, name: 'a' });
    walkResult(config, 'User', 'findMany', rows);
  });

  bench('findMany 100 rows with 5 nested posts each', () => {
    const posts = new Array(5).fill({ id: BYTES, authorId: BYTES, title: 't' });
    const rows = new Array(100).fill({ id: BYTES, companyId: BYTES, name: 'a', posts });
    walkResult(config, 'User', 'findMany', rows);
  });
});
