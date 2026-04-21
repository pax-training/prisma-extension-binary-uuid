# Migration guide: `CHAR(36)` → `BINARY(16)`

This guide walks through migrating an existing Prisma + MySQL database from
`String @db.Char(36)` UUIDs to `Bytes @db.Binary(16)` with the extension.

> **Destructive migration.** Back up your database before starting. Run in a
> maintenance window with application writes paused.

## Overview

1. Back up the database
2. Install the extension
3. Update the schema (`Char(36)` → `Binary(16)`)
4. Emit migration SQL
5. DBA reviews + runs the SQL in a maintenance window
6. `prisma db push` to recreate indexes + FKs
7. Deploy the extension-equipped application

Total downtime: typically minutes for small tables, an hour or more for
multi-million-row tables. Plan accordingly.

## Step 1 — Backup

```bash
mysqldump -u root -p mydb > backup-$(date +%Y%m%d-%H%M).sql
```

If you're on managed cloud (RDS, Aurora, PlanetScale), use their
point-in-time snapshot feature.

## Step 2 — Install

```bash
pnpm add prisma-extension-binary-uuid
```

## Step 3 — Update schema

For each UUID column, change:

```diff
-  id  String  @id @default(uuid()) @db.Char(36)
+  id  Bytes   @id @default(dbgenerated("(UUID_TO_BIN(UUID(), 1))")) @db.Binary(16)
```

Apply this to:

- Every `@id` field that's a UUID
- Every foreign-key scalar field (e.g., `authorId`)
- Every non-PK UUID field (e.g., `storageId`)

Leave non-UUID `String` fields alone.

## Step 4 — Emit migration SQL

```bash
npx prisma-extension-binary-uuid migrate-sql \
  --schema ./prisma/schema.prisma \
  --output ./migrations/uuid-to-binary.sql
```

Review the output. The SQL:

1. Disables FK checks temporarily
2. For each table+column, adds a `<col>__bin` BINARY(16) column, populates
   it with `UUID_TO_BIN(col, 1)`, drops the original column, and renames
   `<col>__bin` to `<col>`
3. Restores FK checks

Any gotcha specific to your data should surface in this review step.

## Step 5 — DBA runs the SQL

The SQL is destructive. Do not run it in a script that swallows errors.
Recommended flow:

1. Pause application writes
2. Connect to MySQL as a user with `ALTER` permission
3. Run the SQL file, watching for errors on each `ALTER TABLE`
4. Verify row counts: `SELECT COUNT(*) FROM User; SELECT COUNT(*) FROM Post;`
   — should match pre-migration counts

## Step 6 — Recreate indexes + FKs

After the migration SQL, indexes and foreign keys that referenced the old
columns have been dropped (they had to be, to change column types).
Recreate them by pushing the schema:

```bash
npx prisma db push
```

Prisma detects the columns already match and only (re)creates the missing
indexes + FKs.

## Step 7 — Deploy the application

Generate the field registry:

```bash
npx prisma-extension-binary-uuid init
```

Wire up the extension:

```ts
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
import { uuidConfig } from './uuid-config';

export const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(process.env.DATABASE_URL!),
}).$extends(createBinaryUuidExtension(uuidConfig));
```

Deploy.

## Step 8 — Verify

Hit a handful of endpoints that exercise UUID reads and writes. Check that:

- IDs in API responses are strings (not Buffer objects)
- Writes via strings succeed
- Joins return expected rows

If anything looks wrong, the most common issues are:

- Missing entries in `fields` config (CLI drift — re-run `init`)
- Missing relations map (same fix)
- Raw SQL queries that don't account for `BIN_TO_UUID` — these bypass the
  extension and need manual updates

## Rollback

If the migration fails mid-flight: restore from the backup in step 1.

If the migration succeeded but the application has issues: keep the DB as
BINARY(16), uninstall the extension, and use `Bytes` types directly in your
Prisma code. This is more painful than using the extension but keeps you
running.

## Performance tip — `UUID_TO_BIN(uuid, 1)` with swap flag

The swap flag reorders the bytes for better B-tree index locality when your
UUIDs are timestamp-ordered (v1 or v7). It's on by default in our
`migrate-sql` output and in the recommended `@default(dbgenerated(...))`.

If you're writing your own SQL, pass `1` as the second argument:

```sql
UUID_TO_BIN('550e8400-e29b-41d4-a716-446655440000', 1)
```

For strictly random (v4) UUIDs, the swap flag has no benefit but no harm.
