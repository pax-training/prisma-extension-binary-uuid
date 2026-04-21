# How it works

A deep dive for the curious.

## The problem in one paragraph

Prisma's generated types for a `Bytes @db.Binary(16)` field declare the
runtime type as `Uint8Array`. Application code typically holds UUIDs as
strings. Without this extension, every place you pass a UUID to Prisma
would need to convert to `Uint8Array` first — thousands of call sites for
a typical app. The extension does that conversion automatically at the
single point where Prisma hands off to the database driver, and does the
reverse conversion when results come back.

## Prisma Client Extensions

Prisma 5.x added a public extension API:

```ts
prisma.$extends({
  name: 'my-extension',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // transform args before the DB call
        const transformed = transformArgs(args);
        // execute
        const raw = await query(transformed);
        // transform result after
        return transformResult(raw);
      }
    }
  }
});
```

The `$allOperations` hook fires for every `findUnique`, `findMany`,
`create`, etc. across every model. Arguments and results can be reshaped
freely.

## The two halves

### Write-side (args walker)

On every query, the extension walks the full `args` tree looking for
UUID-typed values in UUID field positions. Every such string is converted
to a 16-byte `Uint8Array` via a lookup-table-based parser.

The walker knows about every Prisma query shape:

- Scalar operators (`equals`, `not`, `in`, `notIn`, `lt`, etc.)
- Relation filter operators (`some`, `every`, `none`, `is`, `isNot`)
- Logical combinators (`AND`, `OR`, `NOT`)
- Nested write operators (`create`, `connect`, `upsert`, etc.)
- Cursor, order-by, distinct, aggregation shapes
- `include` / `select` with nested `where` clauses

As it descends through relations, it tracks the current model scope using
the `relations` config so it knows which fields to treat as UUIDs at each
nesting level.

### Read-side (result walker)

After the query returns, the extension walks the result tree. Every
`Uint8Array` value sitting under a UUID field (per the config) is
converted to a lowercase dashed UUID string.

The walker handles:

- Single objects (`findUnique`)
- Arrays (`findMany`)
- Nested included relations (recurses into their model scope)
- Aggregation results (`_min`, `_max`, etc.)
- `null` / `undefined` / missing relations

Non-UUID `Bytes` fields (like `avatar` or `embedding`) are left untouched.

## The field registry

The config's `fields` and `relations` maps tell the walker everything it
needs. At extension init, we normalize them into:

- `Map<ModelName, Set<FieldName>>` for O(1) "is this field a UUID?"
- `Map<ModelName, Map<RelationField, TargetModel>>` for model-scope pivots
- `Map<ModelName, Set<FieldName>>` for auto-generate fields

The walker uses Sets and Maps exclusively so the hot path stays O(fields)
per call.

## Auto-generation

On `create`, `createMany`, `upsert.create`, and `connectOrCreate.create`,
the walker checks every field in the model's `autoGenerate` set. If the
caller didn't supply a value, the walker calls the configured generator
(`newUidV4()` by default) and injects the result.

For `createMany`, the walker iterates per-row.

If you also have a DB-side default via `@default(dbgenerated("..."))`, the
extension's auto-gen path is a no-op when the field is omitted (because
Prisma's generated types mark it optional). Having both is redundant but
harmless — the DB-side default wins when the extension doesn't provide a
value.

## Idempotency

- **Input passthrough**: if the walker encounters a `Uint8Array` where a
  string UUID would go, it passes through. This means double-applying the
  extension, or manually pre-converting, is safe.
- **Output passthrough**: if the walker encounters a string where binary
  would be expected on a result, it passes through.
- **Marker symbol**: the extended client carries a `Symbol.for(...)` marker
  that consumers can use to detect whether the extension is in the chain.

## TypeScript surface

The extension operates at the query level, not the type level. Prisma's
generated types still show UUID fields as `Uint8Array` (because that's
what the schema says they are).

Two approaches for consumer type ergonomics:

1. **`uuidString()` brand helper**: wraps a string in a branded type that
   satisfies both `string` and `Uint8Array<ArrayBuffer>` at the type
   level. Explicit, opt-in, minimal overhead. Documented as the default
   recommendation.

2. **Type-mapped wrapper client**: a higher-order function that returns a
   client with UUID fields reshaped to `string` in input + output
   positions. Complex generics; not shipped in v1.0 but planned for v2.

## What the extension deliberately doesn't do

- **Schema parsing at runtime**: we don't `require('prisma-internals')` or
  parse `schema.prisma` in the hot path. The config is an explicit
  commitable file. The CLI generates it; you commit it.
- **Code generation**: no codegen step. The extension works against the
  stock Prisma Client.
- **Index.d.ts patching**: no post-processing of generated types. We
  stay on the public API.
- **Driver-level hooks**: we don't subclass or patch the adapter. The
  conversion happens in the Prisma Client layer, above the adapter.

Each of these "we don't do X" is deliberate — they're all places where a
future Prisma change could break us silently. Staying on the public
`$allOperations` API means we break only when Prisma breaks that hook,
which they've committed to keeping stable across majors.
