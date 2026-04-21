/**
 * Transaction-level tests. Ensures the extension works correctly inside both
 * interactive transactions (`$transaction(async tx => ...)`) and batched
 * transactions (`$transaction([p1, p2, ...])`).
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { buildClient, type ExtendedClient } from './_fixtures/client.js';
import { shouldSkipIntegration, startTestDb, type TestDb } from './_fixtures/container.js';

const skipReason = shouldSkipIntegration();
if (skipReason !== null) {
  console.warn(`[integration] ${skipReason}`);
}
const d = skipReason === null ? describe : describe.skip;

let db: TestDb;
let prisma: ExtendedClient;

beforeAll(async () => {
  db = await startTestDb();
  prisma = buildClient(db.url);
}, 180_000);

afterAll(async () => {
  await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
  await db.stop();
}, 60_000);

d('interactive transaction', () => {
  test('tx client has the extension applied — strings in, strings out', async () => {
    const result = await (prisma as unknown as {
      $transaction: <T>(fn: (tx: ExtendedClient) => Promise<T>) => Promise<T>;
    }).$transaction(async (tx) => {
      const user = await tx.user.create({ data: { email: `itx-${Date.now()}@x.com` } });
      const post = await tx.post.create({
        data: { title: 'Tx post', authorId: user.id },
      });
      return { user, post };
    });
    expect(typeof result.user.id).toBe('string');
    expect(result.post.authorId).toBe(result.user.id);
  });

  test('rolling back restores pre-tx state', async () => {
    const email = `rb-${Date.now()}@x.com`;
    await expect(
      (prisma as unknown as {
        $transaction: <T>(fn: (tx: ExtendedClient) => Promise<T>) => Promise<T>;
      }).$transaction(async (tx) => {
        await tx.user.create({ data: { email } });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const found = await prisma.user.findUnique({ where: { email } });
    expect(found).toBeNull();
  });
});

d('batch transaction', () => {
  test('array of promises all with extension applied', async () => {
    const email1 = `btx-a-${Date.now()}@x.com`;
    const email2 = `btx-b-${Date.now()}@x.com`;
    const [u1, u2] = await (prisma as unknown as {
      $transaction: (ops: unknown[]) => Promise<Array<{ id: string }>>;
    }).$transaction([
      prisma.user.create({ data: { email: email1 } }),
      prisma.user.create({ data: { email: email2 } }),
    ]);
    expect(typeof u1!.id).toBe('string');
    expect(typeof u2!.id).toBe('string');
  });
});
