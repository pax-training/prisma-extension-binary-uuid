---
'@pax-training/prisma-extension-binary-uuid': patch
---

`migrate-sql`: honor Prisma's `@@map("table")` and `@map("column")` attributes
so emitted DDL targets the real database identifiers. Previously the CLI used
the schema-side model and field names verbatim, so a schema with `@@map` or
`@map` would produce SQL pointing at non-existent identifiers (or, worse, at a
coincidentally similarly-named table). The runtime extension was unaffected;
only the `migrate-sql` output is changed.

The temp `__bin` column is also now created as `NULL` regardless of the final
field nullability — the original nullability is reasserted on the subsequent
`CHANGE COLUMN` after `UPDATE` has populated the rows. If the migration is
interrupted between `ADD` and `UPDATE`, rows now contain detectable `NULL`s
instead of MySQL's implicit zero-byte default for `BINARY NOT NULL` (which
would otherwise look like valid UUIDs and survive a half-applied migration).
