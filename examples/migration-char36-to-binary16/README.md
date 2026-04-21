# Example: Migrating an existing CHAR(36) database

End-to-end walkthrough of migrating a production database from `CHAR(36)`
UUIDs to `BINARY(16)` with zero data loss.

See [../../docs/migration-guide.md](../../docs/migration-guide.md) for the
full runbook.

## Summary of steps

1. **Backup** — mysqldump or managed-cloud snapshot.
2. **Update schema** — flip every `String @db.Char(36)` to `Bytes @db.Binary(16)`.
3. **Emit migration SQL**:
   ```bash
   npx prisma-extension-binary-uuid migrate-sql --output migration.sql
   ```
4. **DBA runs SQL** — in a maintenance window with FK checks relaxed.
5. **Recreate indexes/FKs** — `npx prisma db push`.
6. **Install + wire extension**:
   ```bash
   pnpm add prisma-extension-binary-uuid
   npx prisma-extension-binary-uuid init
   ```
7. **Deploy** — the application code that imports `prisma.ts` with the
   extension applied.

## Why this example exists

Migrations on live databases are scary. The point of this example is to
show that each step is reversible (via backup) and that the migration SQL
is plain, reviewable SQL — not magic.
