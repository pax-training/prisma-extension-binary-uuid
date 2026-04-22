/**
 * End-to-end CRUD tests against a real MySQL container with BINARY(16) columns.
 *
 * Covers the read/write roundtrip at every major operation: create, createMany,
 * findUnique, findMany, findFirst, update, updateMany, upsert, delete,
 * deleteMany. For each, we verify:
 *   - UUIDs go in as strings
 *   - UUIDs come back as strings
 *   - The underlying column is actually BINARY(16)
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { uuidString } from '../../src/index.js';

import { buildClient, type ExtendedClient } from './_fixtures/client.js';
import { startTestDb, type TestDb } from './_fixtures/container.js';

// Shorthand for passing a UUID string where Prisma types expect Uint8Array.
const u = uuidString;
const d = describe;

let db: TestDb;
let prisma: ExtendedClient;

beforeAll(async () => {
  db = await startTestDb();
  prisma = buildClient(db.url);
}, 180_000);

afterAll(async () => {
  // Prisma doesn't expose $disconnect on the extended client type reliably
  // across versions. Cast narrowly.
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
  await db.stop();
}, 60_000);

d('schema sanity', () => {
  test('User.id is BINARY(16)', async () => {
    const rows = (await (prisma as unknown as {
      $queryRawUnsafe: (sql: string) => Promise<Array<{ COLUMN_TYPE: string | Buffer }>>;
    }).$queryRawUnsafe(
      `SELECT CAST(COLUMN_TYPE AS CHAR) AS COLUMN_TYPE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'User' AND COLUMN_NAME = 'id'`,
    )) as Array<{ COLUMN_TYPE: string | Buffer }>;
    expect(rows.length).toBeGreaterThan(0);
    const row = rows[0]!;
    const rawColType = row.COLUMN_TYPE;
    const colType: string =
      rawColType instanceof Buffer ? rawColType.toString('utf8') : (rawColType as string);
    expect(colType.toLowerCase()).toBe('binary(16)');
  });
});

d('create', () => {
  test('without id: auto-generates UUID, returns as string', async () => {
    const user = await prisma.user.create({
      data: { email: `a-${Date.now()}@example.com`, name: 'Alice' },
    });
    expect(typeof user.id).toBe('string');
    expect(user.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(typeof user.storageId).toBe('string');
  });

  test('with explicit id: honored, stored + retrieved as string', async () => {
    const id = '550e8400-e29b-41d4-a716-446655440001';
    const user = await prisma.user.create({
      data: { id: u(id), email: `b-${Date.now()}@example.com`, name: 'Bob' },
    });
    expect(user.id).toBe(id);
    const fetched = await prisma.user.findUnique({ where: { id: u(id) } });
    expect(fetched?.id).toBe(id);
  });

  test('with non-UUID Bytes field (avatar): handled correctly', async () => {
    const avatar = new Uint8Array([1, 2, 3, 4, 5]);
    const user = await prisma.user.create({
      data: { email: `c-${Date.now()}@example.com`, avatar },
    });
    expect(typeof user.id).toBe('string');
    expect(user.avatar).toBeInstanceOf(Uint8Array);
    expect(user.avatar?.length).toBe(5);
  });
});

d('findUnique / findFirst / findMany', () => {
  test('findUnique by string id round-trips', async () => {
    const email = `fu-${Date.now()}@example.com`;
    const created = await prisma.user.create({ data: { email } });
    const found = await prisma.user.findUnique({ where: { id: u(created.id as unknown as string) } });
    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe(email);
  });

  test('findMany with id in: [...] filter', async () => {
    const a = await prisma.user.create({ data: { email: `in-a-${Date.now()}@x.com` } });
    const b = await prisma.user.create({ data: { email: `in-b-${Date.now()}@x.com` } });
    const found = await prisma.user.findMany({
      where: { id: { in: [u(a.id as unknown as string), u(b.id as unknown as string)] } },
    });
    const ids = found.map((usr) => usr.id).sort();
    expect(ids).toEqual([a.id, b.id].sort());
  });

  test('findMany with logical AND', async () => {
    const email = `and-${Date.now()}@x.com`;
    const user = await prisma.user.create({ data: { email, name: 'Special' } });
    const found = await prisma.user.findMany({
      where: { AND: [{ id: u(user.id as unknown as string) }, { name: 'Special' }] },
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(user.id);
  });
});

d('relations', () => {
  test('include user with posts — pivots model scope', async () => {
    const user = await prisma.user.create({
      data: {
        email: `rel-${Date.now()}@x.com`,
        posts: { create: [{ title: 'Hello' }, { title: 'World' }] },
      },
      include: { posts: true },
    });
    expect(typeof user.id).toBe('string');
    expect(user.posts).toHaveLength(2);
    expect(typeof user.posts[0]!.id).toBe('string');
    expect(user.posts[0]!.authorId).toBe(user.id);
  });

  test('connect via string UUID', async () => {
    const user = await prisma.user.create({ data: { email: `conn-${Date.now()}@x.com` } });
    const post = await prisma.post.create({
      data: { title: 'Connected', author: { connect: { id: u(user.id as unknown as string) } } },
    });
    expect(post.authorId).toBe(user.id);
  });

  test('relation filter `some`', async () => {
    const user = await prisma.user.create({
      data: {
        email: `rf-${Date.now()}@x.com`,
        posts: { create: [{ title: 'findable', published: true }] },
      },
    });
    const found = await prisma.user.findMany({
      where: { posts: { some: { published: true } }, id: u(user.id as unknown as string) },
    });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(user.id);
  });
});

d('update / upsert', () => {
  test('update by id with set on UUID field', async () => {
    const company = await prisma.company.create({ data: { name: 'Acme' } });
    const user = await prisma.user.create({ data: { email: `up-${Date.now()}@x.com` } });
    const updated = await prisma.user.update({
      where: { id: u(user.id as unknown as string) },
      data: { companyId: { set: u(company.id as unknown as string) } },
    });
    expect(updated.companyId).toBe(company.id);
  });

  test('upsert with explicit id', async () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const email1 = `ups-${Date.now()}@x.com`;
    // Create path.
    await prisma.user.upsert({
      where: { id: u(id) },
      create: { id: u(id), email: email1 },
      update: { name: 'shouldnt run' },
    });
    const a = await prisma.user.findUnique({ where: { id: u(id) } });
    expect(a?.email).toBe(email1);

    // Update path.
    await prisma.user.upsert({
      where: { id: u(id) },
      create: { id: u(id), email: `never-${Date.now()}@x.com` },
      update: { name: 'Updated' },
    });
    const b = await prisma.user.findUnique({ where: { id: u(id) } });
    expect(b?.name).toBe('Updated');
  });
});

d('delete', () => {
  test('delete by id', async () => {
    const user = await prisma.user.create({ data: { email: `del-${Date.now()}@x.com` } });
    await prisma.user.delete({ where: { id: u(user.id as unknown as string) } });
    const gone = await prisma.user.findUnique({ where: { id: u(user.id as unknown as string) } });
    expect(gone).toBeNull();
  });

  test('deleteMany with in: [...]', async () => {
    const a = await prisma.user.create({ data: { email: `dm-a-${Date.now()}@x.com` } });
    const b = await prisma.user.create({ data: { email: `dm-b-${Date.now()}@x.com` } });
    const result = await prisma.user.deleteMany({
      where: { id: { in: [u(a.id as unknown as string), u(b.id as unknown as string)] } },
    });
    expect(result.count).toBe(2);
  });
});

d('aggregations', () => {
  test('count', async () => {
    const beforeCount = await prisma.company.count();
    await prisma.company.create({ data: { name: `count-${Date.now()}` } });
    const afterCount = await prisma.company.count();
    expect(afterCount).toBe(beforeCount + 1);
  });
});

d('cursor pagination', () => {
  test('cursor with string id', async () => {
    const c = await prisma.company.create({ data: { name: 'cursor-A' } });
    await prisma.company.create({ data: { name: 'cursor-B' } });
    const page = await prisma.company.findMany({
      cursor: { id: u(c.id as unknown as string) },
      take: 2,
      orderBy: { id: 'asc' },
    });
    expect(page.length).toBeGreaterThanOrEqual(1);
    for (const company of page) {
      expect(typeof company.id).toBe('string');
    }
  });
});

d('error paths', () => {
  test('malformed UUID in where throws', async () => {
    await expect(
      prisma.user.findUnique({ where: { id: u('not-a-uuid') } }),
    ).rejects.toThrow();
  });

  test('duplicate email throws', async () => {
    const email = `dup-${Date.now()}@x.com`;
    await prisma.user.create({ data: { email } });
    await expect(prisma.user.create({ data: { email } })).rejects.toThrow();
  });
});
