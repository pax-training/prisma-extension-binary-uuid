# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-04-22

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
