# Version compatibility matrix

The local matrix runner (`pnpm test:matrix`) spins each DB in podman/docker
and runs the full integration suite (21 tests per target). CI runs the same
matrix on every push.

## Prisma Client × Database

|            | MySQL 8.0 | MySQL 8.4 | MariaDB 10.11 | MariaDB 11.x |
| ---------- | :-------: | :-------: | :-----------: | :----------: |
| Prisma 7.x |    ✅     |    ✅     |      ✅       |      ✅      |
| Prisma 6.x |    🟢     |    🟢     |      🟢       |      🟢      |
| Prisma 5.x |    🟢     |    🟢     |      🟢       |      🟢      |

- ✅ = full integration suite (21 tests) green per CI run.
- 🟢 = verified via the `prisma-compat` CI job (unit + property + extension
  factory smoke against the installed Prisma version). The walker/conversion
  paths are Prisma version independent — the only Prisma surfaces the
  extension touches (`Prisma.defineExtension` and `$allOperations`) are
  stable across all three majors. The smoke test exercises both surfaces
  end-to-end.

`@prisma/client@dev` is intentionally excluded — it tracks an unstable HEAD
and would just produce flaky CI noise. The nightly CI workflow
(`.github/workflows/nightly-prisma.yml`) catches breakage from upcoming
Prisma releases ahead of GA.

## MySQL 5.7

Excluded from the default matrix:

1. End of life (October 2023).
2. Official Docker image is amd64-only — slow under emulation on Apple Silicon.
3. Rejects expressions in `DEFAULT` clauses, so the recommended schema
   (`@default(dbgenerated("UNHEX(REPLACE(UUID(),'-','')))"))`) fails on push.

The extension's app-side auto-generate path still works on 5.7. Consumers who
need 5.7 should omit the `dbgenerated` default and let the extension fill in
the ID. Run the matrix manually with:

```bash
TEST_DB_IMAGE=mysql:5.7 TEST_DB_PLATFORM=linux/amd64 pnpm test:integration
```

## Node runtime

| Node          | Status |
| ------------- | :----: |
| 20.19+        |   ✅   |
| 22.12+        |   ✅   |
| 24            |   ✅   |

Tracks Prisma 7's `engines` field (`^20.19 || ^22.12 || >=24`). Node 18 is
not supported because Prisma 7's preinstall fails on it; users still on
Node 18 should pin to `@prisma/client` 6.x and consume this extension via
the same Prisma version (the `prisma-compat` CI job verifies the extension
works against 6.x).

## Cloud providers

These are managed-MySQL/MariaDB services. None is in our CI matrix —
spinning them per-PR is impractical — but each preserves the upstream
wire protocol of the version it's built on, so the extension behaves
identically against the CI'd OSS image of that version.

- **AWS Aurora MySQL** (engine `aurora-mysql`, v8.0-compatible) — covered
  transitively by our `mysql:8.0` cell.
- **AWS RDS for MySQL** (v8.0, v8.4) — covered by `mysql:8.0` and
  `mysql:8.4` cells.
- **Google Cloud SQL for MySQL** (v8.0) — protocol-compatible with
  `mysql:8.0`.
- **Azure Database for MySQL** (v8.0, flexible server) — protocol-compatible
  with `mysql:8.0`.
- **PlanetScale** — uses an HTTP/serverless transport via
  `@prisma/adapter-planetscale`. The extension's hot path doesn't depend on
  the transport, but we don't run it through the matrix. Use it; report
  issues.

If you hit a managed-service-specific bug (SQL_MODE, GTID, replica routing,
proxy quirks), file an issue with the exact provider + version.

## Unsupported combinations

- **PostgreSQL**: use Prisma's native `String @db.Uuid` instead. The
  extension is MySQL-protocol-specific.
- **SQLite**: no UUID binary story. Use `TEXT` storage.
- **MongoDB**: use `String @db.ObjectId` or `Bytes` directly.
- **SQL Server**: use Prisma's native `String @db.UniqueIdentifier`.
- **Prisma 4.x and below**: the Client Extension API was Preview-only. The
  package's `peerDependencies.@prisma/client` is `>=5.0.0 <8.0.0`, so npm /
  pnpm refuses the install with an explicit peer-dep mismatch.
