# Version compatibility matrix

Tested on every CI run. If a combination shows `❌`, open an issue.

## Prisma Client × Database

|                | MySQL 5.7 | MySQL 8.0 | MySQL 8.4 | MariaDB 10.11 | MariaDB 11.x |
| -------------- | :-------: | :-------: | :-------: | :-----------: | :----------: |
| Prisma 5.x     |     ✅    |     ✅    |     ✅    |       ✅      |      ✅      |
| Prisma 6.x     |     ✅    |     ✅    |     ✅    |       ✅      |      ✅      |
| Prisma 7.x     |     ✅    |     ✅    |     ✅    |       ✅      |      ✅      |
| Prisma @dev    |     🟡    |     🟡    |     🟡    |       🟡      |      🟡      |

🟡 = tracked in nightly CI; failures open an `upstream-break` issue but do
not block stable releases.

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
