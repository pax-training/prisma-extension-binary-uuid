# Changelog

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
