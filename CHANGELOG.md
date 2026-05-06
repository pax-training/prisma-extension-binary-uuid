# Changelog

## 1.0.2

### Patch Changes

- e34216b: Walk into bare to-one relation `where` shorthand

  `walkRelationFilter` previously only recursed into the operator-wrapped
  relation-filter shape (`some` / `every` / `none` / `is` / `isNot`). The
  **bare to-one shorthand** Prisma also accepts —

  ```ts
  prisma.post.findFirst({
    where: { author: { id: '550e8400-...' } },
  });
  ```

  — skipped the converter entirely because none of the inner keys are in
  the operator set, so the inner UUID string reached the engine
  unconverted and Prisma 7 rejected it with:

  > Could not convert from `base64 encoded bytes` to `PrismaValue::Bytes`.
  > Expected base64 String.

  The walker now detects the operator-less shape — if no key in the value
  is one of the relation-filter operators, the whole object is treated as
  a direct `where` against the related model and recurses through
  `walkWhere`. This covers any depth of bare-to-one chaining
  (`where: { a: { b: { c: { uuidField: ... } } } }`) since each layer hits
  the same branch in turn.

  Mixed shapes (`{ is: {...}, id: '...' }`) aren't valid Prisma input so
  no special handling is needed — the operator branch wins as soon as one
  operator is present.

  Six new tests cover:
  - bare to-one with a single UUID field
  - bare to-one with a UUID FK that pivots further
  - bare to-one alongside a non-UUID scalar (string left untouched)
  - bare to-one combined with an operator-wrapped sibling on the same `where`
  - empty bare to-one object (`{ author: {} }`) — no-op
  - the existing `is`/`isNot` operator path (regression coverage)

## 1.0.1

### Patch Changes

- 8ef1350: Walk into compound-unique-key wrappers in `where` clauses

  `@@unique([a, b])` and `@@id([a, b])` are exposed by Prisma as
  nested-object wrappers (`where: { a_b: { a, b } }`). The walker
  previously only recognised top-level UUID fields, relations, and
  logical combinators — compound-key wrappers fell through unconverted,
  so the inner UUID strings reached the engine as plain strings against a
  `Bytes` column and Prisma rejected them with:

  > Could not convert from `base64 encoded bytes` to `PrismaValue::Bytes`.
  > Expected base64 String.

  `walkWhere` now also recurses into any plain (non-array) object value.
  The recursion keeps the same model scope, so inner keys hit the
  existing UUID-field / relation branches — no separate compound-key
  table to maintain. Inner keys that don't match any field on the model
  are still left untouched (the recursion is a no-op for them), so a
  non-UUID scalar inside a compound key (e.g. a `Date` second-half) is
  unaffected.

  Tested via four new `compound unique keys` cases plus an
  unknown-key plain-object no-op test.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-22

Published to npm as `@pax-training/prisma-extension-binary-uuid`. The
scoped package sits under the `pax-training` org so ownership is
corporate from the first publish, not tied to any individual npm user.

### Added

- Transparent `BINARY(16)` UUID storage for Prisma Client, driven by
  `createBinaryUuidExtension()` + a committed `uuidConfig.ts` declaring
  which fields on which models hold UUIDs.
- CLI with three subcommands — `init` (generate config from
  `schema.prisma`), `validate` (drift detection), `migrate-sql` (emit
  DBA-grade `CHAR(36) → BINARY(16)` migration SQL with a `--dialect`
  flag for MySQL vs MariaDB).
- UUIDv4 (default) and UUIDv7 auto-generation with within-ms
  monotonicity (RFC 9562 §6.2 method 1).
- `metrics.onQuery` hook for observability and `logger` for diagnostic
  output, both optional and zero-cost when unset.
- Strict validation on by default (`MalformedUuidError` for bad UUIDs,
  `TypeMismatchError` for wrong types); opt-in `allowBufferInput: false`
  to enforce string-only inputs.
- Verified against Prisma 5.22 / 6.19 / 7.7 via a CI compat matrix and
  against MySQL 8.0 / 8.4 / MariaDB 10.11 / 11 via a CI integration
  matrix (21 tests per target, runs on every push).
- Zero runtime dependencies. Only peer is `@prisma/client >=5 <8`.

### Supply chain

- All transitive deps with open advisories at release time are pinned to
  patched versions via `pnpm.overrides` (closes
  `@hono/node-server` / CVE-2026-39406 and the undici chain).
- Published with npm provenance via GitHub Actions OIDC.
