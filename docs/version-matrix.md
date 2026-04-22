# Version compatibility matrix

Tested locally and on every CI run. The local matrix runner
(`pnpm test:matrix`) spins each DB in podman/docker and runs the full
integration suite (21 tests per target).

## Prisma Client × Database

|              | MySQL 8.0 | MySQL 8.4 | MariaDB 10.11 | MariaDB 11.x |
| ------------ | :-------: | :-------: | :-----------: | :----------: |
| Prisma 7.x   |     ✅    |     ✅    |       ✅      |      ✅      |
| Prisma 6.x   |     🟡    |     🟡    |       🟡      |      🟡      |
| Prisma 5.x   |     🟡    |     🟡    |       🟡      |      🟡      |
| Prisma @dev  |     🟡    |     🟡    |       🟡      |      🟡      |

✅ = green in our local + CI matrix as of latest run.
🟡 = expected to work; explicit cross-version test pending.

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

| Node | Status |
| ---- | :----: |
| 18   |   ✅   |
| 20   |   ✅   |
| 22   |   ✅   |

Node 17 and below are not supported (we use `crypto.randomUUID`).

## Cloud providers

- **AWS Aurora MySQL** (engine `aurora-mysql`, v8.0-compatible): ✅
- **AWS RDS for MySQL** (v5.7, v8.0, v8.4): ✅
- **Google Cloud SQL for MySQL**: ✅ (not in CI matrix, but protocol-compatible)
- **PlanetScale**: ⚠️ with `@prisma/adapter-planetscale`. Not in CI matrix.
  Reports welcome.
- **Azure Database for MySQL**: ✅ (v8.0, flexible server)

## Unsupported combinations

- **PostgreSQL**: use Prisma's native `String @db.Uuid` instead. The
  extension is MySQL-protocol-specific.
- **SQLite**: no UUID binary story. Use `TEXT` storage.
- **MongoDB**: use `String @db.ObjectId` or `Bytes` directly.
- **SQL Server**: use Prisma's native `String @db.UniqueIdentifier`.
- **Prisma 4.x and below**: the Client Extension API wasn't GA. The
  extension detects this at init time and throws with a clear message.
