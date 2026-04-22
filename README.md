# prisma-extension-binary-uuid

**Transparent `BINARY(16)` UUID storage for Prisma + MySQL / MariaDB.** Store
UUIDs as 16 bytes at the database layer; keep `string` IDs throughout your
application code.

[![CI](https://github.com/pax-training/prisma-extension-binary-uuid/actions/workflows/ci.yml/badge.svg)](https://github.com/pax-training/prisma-extension-binary-uuid/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/prisma-extension-binary-uuid.svg)](https://www.npmjs.com/package/prisma-extension-binary-uuid)

## Why this exists

Prisma stores UUIDs as `CHAR(36)` by default on MySQL — 36 bytes per value,
54 bytes per index entry. For large tables this adds up, and MySQL has no
native `uuid` type to give you both compact storage and transparent string
access.

The Prisma team explicitly
[declined to ship native binary UUID support](https://github.com/prisma/prisma/issues/11414)
for MySQL, recommending raw SQL as the workaround. For a typed codebase with
thousands of queries, raw SQL isn't practical.

This extension fills that gap. It intercepts every Prisma query via the
official Client Extension API, converts `string` UUIDs to `Uint8Array`
before writes, and converts back after reads. Your application code sees
strings everywhere; the database stores 16 bytes.

## Install

```bash
pnpm add prisma-extension-binary-uuid
# or: npm install prisma-extension-binary-uuid
# or: yarn add prisma-extension-binary-uuid
```

## Quick start

**1. Declare your UUID columns in the schema**:

```prisma
model User {
  id        Bytes    @id @default(dbgenerated("(UUID_TO_BIN(UUID(), 1))")) @db.Binary(16)
  email     String   @unique @db.VarChar(255)
  companyId Bytes?   @db.Binary(16)
  company   Company? @relation(fields: [companyId], references: [id])
}
```

> **MariaDB note:** `UUID_TO_BIN` is MySQL-only. For MariaDB, use the
> portable form `dbgenerated("(UNHEX(REPLACE(UUID(),'-','')))")` instead —
> it works on both servers but loses MySQL's bit-swap optimization for
> primary-key clustering. If you want the bit-swap on MariaDB, omit the
> `dbgenerated` default and let the extension's `autoGenerate` path fill in
> a UUIDv7 (timestamp-ordered) at the application layer.

**2. Generate the UUID field registry** (one-time, or re-run when schema changes):

```bash
npx prisma-extension-binary-uuid init
```

This emits `src/uuid-config.ts` from your schema.

**3. Apply the extension to your Prisma Client**:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
import { uuidConfig } from './uuid-config';

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
}).$extends(createBinaryUuidExtension(uuidConfig));
```

**4. Use string UUIDs in your application code**:

```ts
import { uuidString } from 'prisma-extension-binary-uuid';

const user = await prisma.user.findUnique({
  where: { id: uuidString(userIdFromSession) },
});
console.log(user?.id); // 'e1a76f3c-...' — string, not Uint8Array
```

## How it works

On every query, the extension walks the arguments and results:

- **Write side**: string UUIDs in `where`, `data`, `cursor`, nested relations,
  and every operator (`in`, `not`, `AND`/`OR`/`NOT`, `some`/`every`/`none`,
  etc.) are converted to 16-byte `Uint8Array` before hitting the driver.
- **Read side**: `Uint8Array` values at known UUID fields are converted back
  to lowercase dashed strings.

The extension uses Prisma's public `$allOperations` hook — no internal APIs,
no codegen modifications.

See [docs/how-it-works.md](docs/how-it-works.md) for the full breakdown.

## Supported versions

| Prisma Client | MySQL 8.0 | MySQL 8.4 | MariaDB 10.11 | MariaDB 11.x |
| ------------- | --------- | --------- | ------------- | ------------ |
| 5.x (latest)  | ✅\*      | ✅\*      | ✅\*          | ✅\*         |
| 6.x (latest)  | ✅\*      | ✅\*      | ✅\*          | ✅\*         |
| 7.x (latest)  | ✅        | ✅        | ✅            | ✅           |

Databases × Prisma 7.x are verified via the full integration suite
(`pnpm test:matrix`, 21 tests on a real podman/docker container per target).
Prisma 5.x and 6.x are verified via the `prisma-compat` CI job — unit +
property + extension-factory smoke tests against the installed client — and
share the same conversion / walker code paths as 7.x. The \* marks
Prisma-version-specific verification that covers API surface compat; full
CRUD across 5.x/6.x is covered transitively because the walker is Prisma
version independent (it uses only `Prisma.defineExtension` and
`$allOperations`, which are stable across 5→7).

MySQL 5.7 works against the extension itself but is excluded from the
default matrix because it reached EOL October 2023 and rejects expression
DEFAULTs; [full matrix](docs/version-matrix.md) explains how to opt in.

AWS Aurora MySQL 8.0 is protocol-compatible with MySQL 8.0 and works with no
extra configuration.

## Migration guide

Migrating an existing database from `CHAR(36)` to `BINARY(16)`:

```bash
npx prisma-extension-binary-uuid migrate-sql --output ./migrations/uuid-to-binary.sql
```

Review the emitted SQL with your DBA and run it in a maintenance window.
Full walkthrough: [docs/migration-guide.md](docs/migration-guide.md).

## Comparison to alternatives

| Approach                                                   | Disk savings                    | Type safety      | Maintenance burden              |
| ---------------------------------------------------------- | ------------------------------- | ---------------- | ------------------------------- |
| `String @db.Char(36)` (Prisma default)                     | Baseline                        | ✅ full          | Zero                            |
| `$queryRaw` with `BIN_TO_UUID()` (Prisma's recommendation) | ~55%                            | ❌ lost          | High (every query rewritten)    |
| `Bytes @db.Binary(16)` with manual conversion              | ~55%                            | ⚠️ mixed         | High (every call site converts) |
| **This extension**                                         | **~55%**                        | **✅ preserved** | **Low (config file)**           |
| Change ID strategy to CUID2/Snowflake                      | ~30% (CUID2) / ~75% (Snowflake) | ✅ full          | Medium (application refactor)   |

## Trade-offs

**Gains**:

- ~20 bytes saved per UUID per row
- Index entries shrink from 54 bytes to 18 bytes per UUID (~67% smaller)
- Faster JOINs on UUID-heavy schemas
- Same `string` type surface as before — no application refactor

**Costs**:

- Small runtime overhead per query (<50µs for typical shapes; see
  [docs/performance.md](docs/performance.md))
- Extension must be kept in sync with Prisma's extension API across
  major versions (we track nightly releases in CI)
- `create` inputs for UUID fields require a small type cast OR the
  `uuidString()` helper (see docs)

## Examples

- [`examples/minimal`](examples/minimal) — 20-line quickstart
- [`examples/nextjs-app-router`](examples/nextjs-app-router) — Next.js integration
- [`examples/aurora`](examples/aurora) — AWS Aurora MySQL with IAM auth
- [`examples/transactions`](examples/transactions) — interactive + batch transactions
- [`examples/migration-char36-to-binary16`](examples/migration-char36-to-binary16) — end-to-end migration

## Documentation

- [Quick start](docs/quick-start.md)
- [Config reference](docs/config-reference.md)
- [Migration guide](docs/migration-guide.md)
- [Edge cases](docs/edge-cases.md)
- [Performance](docs/performance.md)
- [Why Prisma doesn't ship this](docs/why-prisma-doesnt-ship-this.md)
- [Version compatibility matrix](docs/version-matrix.md)

## Archive plan

If Prisma ships native `BINARY(16)` UUID support for MySQL, this project
will archive with a migration guide pointing to the native feature. See
[GOVERNANCE.md](GOVERNANCE.md#archive-policy) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

[Apache-2.0](LICENSE). Copyright © 2026 PAX Training LLC.
