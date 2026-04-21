# Why Prisma doesn't ship this

Short version: they explicitly decided not to.

## The tracker

- [#6275 — Support `BIN_TO_UUID` and `UUID_TO_BIN` in MySQL](https://github.com/prisma/prisma/issues/6275)
  — open since March 2021, closed without a shipped feature.
- [#11414 — New binary equivalent for `uuid()`](https://github.com/prisma/prisma/issues/11414)
  — **closed as "not planned"**. The Prisma team explicitly decided against
  adding this.
- [Discussion #22602 — What is the recommended way to use `BIN_TO_UUID()` in Prisma?](https://github.com/prisma/prisma/discussions/22602)
  — maintainer recommendation is `$queryRaw`.

## Why they declined

Two reasons, based on the public discussion:

1. **MySQL has no native UUID type.** PostgreSQL does (`uuid`), so Prisma
   can map `String @db.Uuid` transparently there. On MySQL, there's no
   column type to target — just `BINARY(16)` + explicit conversion via
   `UUID_TO_BIN` / `BIN_TO_UUID`. Supporting this natively would require
   injecting conversion functions into every generated query, which is
   intrusive at a layer Prisma doesn't want to modify.

2. **The workaround has an official answer.** Prisma's recommendation is to
   drop to `$queryRaw` for hot paths. This trades type safety for storage
   efficiency and is perfectly valid for small sets of queries. It scales
   poorly for typed codebases with hundreds or thousands of queries — which
   is why this extension exists.

## Why this extension still fits the Prisma ecosystem

Prisma's Client Extension API, shipped in 5.x, is explicitly designed for
cases where framework-level support isn't justified but a library-level
solution is. Examples from Prisma's own docs include:

- Row-level security (like Supabase)
- Soft deletes
- Audit logging
- Encryption at rest

Transparent binary UUID storage fits the same pattern: cross-cutting
query transformation with a narrow, well-defined contract.

We use only the public extension API (`$allOperations` hook), no internal
types, no codegen modification. The extension will continue to work as long
as Prisma's public extension contract is honored — which is something they
commit to across minor versions.

## What would make this obsolete

Prisma ships one of:

1. A `@db.UuidBinary` attribute that maps `String` → `BINARY(16)` with
   transparent conversion in the generated query path
2. A `@db.Uuid` attribute for MySQL similar to the PostgreSQL one
3. Driver-level UUID-to-binary conversion in `@prisma/adapter-mariadb`

If any of these lands, this extension will:

1. Announce deprecation
2. Publish a migration guide to the native feature
3. Archive the repo (see [GOVERNANCE.md](../GOVERNANCE.md#archive-policy))

Until then — `$queryRaw` is the Prisma-official workaround, this extension
is the type-safe workaround, and `CHAR(36)` is the no-workaround default.
All three are valid; pick based on your constraints.
