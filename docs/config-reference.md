# Config reference

Every option on the `BinaryUuidConfig` object.

```ts
import { defineBinaryUuidConfig } from 'prisma-extension-binary-uuid';

export const uuidConfig = defineBinaryUuidConfig({
  fields: { /* ... */ },
  autoGenerate: { /* ... */ },
  relations: { /* ... */ },
  version: 'v4',
  generate: undefined,
  options: { /* ... */ },
});
```

## `fields` (required)

`Record<string, string[]>` — model name → list of field names that hold UUIDs.

```ts
fields: {
  User: ['id', 'companyId'],
  Post: ['id', 'authorId'],
}
```

Every UUID column in your schema must appear here. The CLI
(`prisma-extension-binary-uuid init`) generates this automatically from
`schema.prisma`.

## `autoGenerate` (optional)

`Record<string, string[]>` — model name → list of fields that should be
auto-populated with a new UUID when the caller doesn't supply one.

Default: every field named `id` in `fields`.

Use this for non-PK auto-generated UUID fields, like `storageId`:

```ts
autoGenerate: {
  User: ['id', 'storageId'],
  Post: ['id'],
}
```

Auto-gen runs on `create`, `createMany`, `upsert.create`, and
`connectOrCreate.create` operations.

## `relations` (optional but strongly recommended)

`Record<string, Record<string, string>>` — relation-field → target-model map
for each model.

```ts
relations: {
  User: { company: 'Company', posts: 'Post' },
  Post: { author: 'User' },
  Company: { users: 'User' },
}
```

Required for nested-write walking. Without this, queries like
`data.author.connect.id` won't have their UUID converted, and the DB will
reject the query.

The CLI generates this from `schema.prisma`.

## `version` (optional)

`'v4' | 'v7'` — UUID version for auto-generated values.

- `v4` (default) — random. Standard UUIDv4 per RFC 4122.
- `v7` — timestamp-ordered. Better index locality for append-heavy tables.
  Uses RFC 9562 §6.2 method 1 for within-millisecond monotonicity.

```ts
version: 'v7',
```

## `generate` (optional)

`() => Uint8Array` — custom UUID generator. Overrides `version` if supplied.

Useful for:

- Injecting test fixtures (deterministic UUIDs)
- Using a platform-specific generator
- Combining a custom timestamp with v7

```ts
generate: () => customGenerator().toBinary(),
```

## `options.strictValidation` (optional)

`boolean`, default `true`. When true, malformed UUID strings throw
`MalformedUuidError` before the query hits the DB. When false, they pass
through and the DB raises the error.

Only disable if you have strict upstream validation and want to save the
double-check cost.

## `options.allowBufferInput` (optional)

`boolean`, default `true`. When true, the walker accepts `Uint8Array` in
input positions without error. When false, it throws `TypeMismatchError` —
useful if you want to enforce string-only inputs.

## `options.logger` (optional)

Optional `{ debug?, warn?, error? }` callback object for diagnostic output.
Called with a message and optional context object.

```ts
options: {
  logger: {
    debug: (msg, ctx) => console.debug(msg, ctx),
    error: (msg, ctx) => console.error(msg, ctx),
  }
}
```

## `options.metrics` (optional)

Optional `{ onQuery? }` callback for per-query metrics.

```ts
options: {
  metrics: {
    onQuery: (info) => {
      // info: { model, operation, durationMs, argsConverted, resultConverted }
      otelTracer.record(info);
    }
  }
}
```

The callback runs synchronously after the query completes. It must not throw
— if it does, the extension logs but discards the error and the query still
returns normally.

## Exported types

```ts
import type {
  BinaryUuidConfig,
  BinaryUuidOptions,
  BinaryUuidLogger,
  BinaryUuidMetrics,
  UuidFieldMap,
  RelationTargetMap,
  UuidVersion,
} from 'prisma-extension-binary-uuid';
```
