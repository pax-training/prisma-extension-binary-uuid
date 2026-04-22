# Edge cases

This page catalogs every non-obvious query shape and how the extension
handles it. Each section is also a named test in the integration suite.

## Scalar queries

### Direct equality

`where: { id: 'abc-...' }` → string converted to binary, binary converted back on result.

### `equals` / `not`

`where: { id: { equals: 'abc-...' } }` → same treatment.
`where: { id: { not: 'abc-...' } }` → same.
`where: { id: { not: null } }` → null preserved, no conversion.

### `in` / `notIn`

`where: { id: { in: [...] } }` → every array element converted.
`where: { id: { not: { in: [...] } } }` → nested `not`, still handled.

### Null values

`where: { id: null }` → null passes through unchanged.
`data: { companyId: null }` → null passes through.

## Logical combinators

### AND / OR / NOT

Both single-object and array forms are supported. Model scope is preserved
across the combinator.

```ts
where: {
  AND: [{ id: 'a' }, { name: 'Alice' }],
  OR: [{ id: 'b' }, { id: 'c' }],
  NOT: { id: 'd' }, // single-object NOT
}
```

### Arbitrary nesting

`where: { AND: [{ OR: [{ NOT: { AND: [{ id: 'a' }] } }] }] }` — fully
recursive. Tested to arbitrary depth.

## Relation filters

### `some` / `every` / `none`

`where: { posts: { some: { authorId: 'abc' } } }` — the walker pivots to the
target model's scope when it hits a relation filter.

### `is` / `isNot`

`where: { post: { is: { authorId: 'abc' } } }` — to-one relation filters.

## Nested writes

### Connect

`data: { author: { connect: { id: 'abc' } } }` — walker descends into the
connect clause using the relation's target model.

### ConnectOrCreate

`data: { author: { connectOrCreate: { where: { id: 'abc' }, create: { id: 'abc', name: 'x' } } } }`
— both the `where` and the `create` are walked.

### Upsert

`data: { posts: { upsert: { where: {...}, create: {...}, update: {...} } } }`
— all three clauses are walked.

### CreateMany inside a relation

`data: { posts: { createMany: { data: [{ title: 'a' }, { title: 'b' }] } } }`
— walker handles the array and auto-generates IDs for any row missing one.

### Disconnect / Delete / DeleteMany / Set

All where-shape clauses are walked.
`disconnect: true` (the boolean form) passes through unchanged.

### Deeply nested

`create` with 3+ levels of relations works correctly, with per-row auto-gen
at every level.

## Cursor pagination

`cursor: { id: 'abc' }` — the cursor value is converted to binary.
Commonly missed by custom walkers; we have a dedicated test.

## Aggregations

### Count

`prisma.user.count()` — returns a number, no walking needed.
`prisma.user.count({ where: { id: 'abc' } })` — where clause is walked.

### `aggregate`

`prisma.user.aggregate({ _max: { id: true } })` — result's `_max.id`
is a binary from the DB; the result walker converts it back to string.

### `groupBy`

`prisma.user.groupBy({ by: ['companyId'] })` — grouped rows contain UUID
values in the grouped fields; walker converts them.

## Include / Select

### Include with nested where

`include: { posts: { where: { authorId: 'abc' } } }` — walker pivots to Post
scope for the nested where.

### Select with nested select

`select: { id: true, posts: { where: { published: true }, select: { id: true } } }`
— same nested walker logic.

## Non-UUID Bytes fields

A `Bytes` field that ISN'T a UUID (e.g., `avatar`, `embedding`, `yjsState`)
is left alone by the walker. The extension only touches fields present in
the registry.

## Raw queries

`$queryRaw` and `$executeRaw` BYPASS the extension. If you need to use raw
SQL for UUID columns, use MySQL's `BIN_TO_UUID()` / `UUID_TO_BIN()`
functions explicitly:

```ts
await prisma.$queryRaw`
  SELECT BIN_TO_UUID(id, 1) AS id, name
  FROM User
  WHERE id = UUID_TO_BIN(${userId}, 1)
`;
```

## Transactions

### Interactive

```ts
await prisma.$transaction(async (tx) => {
  await tx.user.create({ data: { email: 'a@b.c' } });
  await tx.post.create({ data: { title: 'Hi', authorId: '...' } });
});
```

The `tx` client inherits the extension.

### Batch

```ts
await prisma.$transaction([
  prisma.user.create({ data: {...} }),
  prisma.post.create({ data: {...} }),
]);
```

Each promise is intercepted individually before composition.

## Error conditions

### Malformed UUID string

`where: { id: 'not-a-uuid' }` → throws `MalformedUuidError` with model+field
context before the query reaches the DB.

### Wrong-type input

`where: { id: 42 }` → throws `TypeMismatchError` in strict mode (default).
Passes through in lax mode (set `options.strictValidation: false`).

### Wrong-length Buffer

Passing a `Uint8Array` that's not exactly 16 bytes in an input position
→ in strict mode, the walker validates via `isUuidBytes()` and treats it
as a type mismatch.

### Unknown model in registry

Config references a model Prisma doesn't know → throws `UnknownModelError`
at extension init time. Never at query time.

## Composition with other extensions

The extension is idempotent: applying it twice is safe. It's also
order-tolerant when composed with other extensions — as long as its
`$allOperations` hook sees raw inputs (pre-transformation) and produces
walked inputs, downstream extensions get the same shape regardless of
ordering.

Tested combos:

- With `prisma-extension-nested-operations`
- With Prisma's built-in Accelerate extension
- With custom audit-logging extensions
