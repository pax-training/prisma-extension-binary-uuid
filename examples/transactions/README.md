# Example: Transactions

The extension works transparently inside both interactive and batch
transactions.

## Interactive transaction

```ts
import { prisma } from './prisma';
import { uuidString } from 'prisma-extension-binary-uuid';

const result = await prisma.$transaction(async (tx) => {
  // `tx` is the extended client — all UUID conversion still happens.
  const user = await tx.user.create({ data: { email: 'a@b.c' } });
  const post = await tx.post.create({
    data: { title: 'First', authorId: uuidString(user.id as unknown as string) },
  });
  return { user, post };
});
console.log(result.user.id); // string
console.log(result.post.id); // string
```

If the callback throws, the transaction rolls back and the UUIDs that were
generated during the transaction effectively never existed.

## Batch transaction

```ts
const [u1, u2] = await prisma.$transaction([
  prisma.user.create({ data: { email: 'a@b.c' } }),
  prisma.user.create({ data: { email: 'd@e.f' } }),
]);
```

Each promise in the array is intercepted individually before composition.

## Isolation levels

Pass the isolation level as the second argument to `$transaction`:

```ts
await prisma.$transaction(async (tx) => {
  // ...
}, { isolationLevel: 'Serializable' });
```

The extension doesn't interact with the isolation level — it operates at
the query layer, which is above transaction semantics.

## Long-running transactions

By default Prisma times transactions out at 5 seconds. For longer-running
workflows, raise `maxWait` and `timeout`:

```ts
await prisma.$transaction(async (tx) => {
  // ...
}, { maxWait: 10_000, timeout: 60_000 });
```
