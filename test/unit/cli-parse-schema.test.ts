import { describe, expect, test } from 'vitest';

import { buildRegistry } from '../../cli/build-registry.js';
import { emitConfig } from '../../cli/emit-config.js';
import { emitMigrationSql } from '../../cli/emit-migration-sql.js';
import { parseSchema } from '../../cli/parse-schema.js';

const SCHEMA = `
generator client { provider = "prisma-client-js" }
datasource db { provider = "mysql" }

model User {
  id         String   @id @default(uuid()) @db.Char(36)
  email      String   @unique
  name       String?
  companyId  String?  @db.Char(36)
  company    Company? @relation(fields: [companyId], references: [id])
  posts      Post[]
  createdAt  DateTime @default(now())
}

model Post {
  id         Bytes    @id @db.Binary(16)
  title      String
  content    String?  @db.Text
  authorId   Bytes    @db.Binary(16)
  author     User     @relation(fields: [authorId], references: [id])
  publishedAt DateTime?
}

model Company {
  id         String   @id @default(uuid()) @db.Char(36)
  name       String
  users      User[]
}

// Non-UUID model — none of its fields should appear in the registry.
model Analytics {
  id    Int      @id @default(autoincrement())
  event String
  count Int
}
`;

describe('parseSchema', () => {
  test('extracts models', () => {
    const schema = parseSchema(SCHEMA);
    expect(schema.models.map((m) => m.name).sort()).toEqual([
      'Analytics',
      'Company',
      'Post',
      'User',
    ]);
  });

  test('identifies UUID-candidate fields (Char(36) + Binary(16))', () => {
    const schema = parseSchema(SCHEMA);
    const user = schema.modelByName.get('User')!;
    const idField = user.fields.find((f) => f.name === 'id')!;
    const companyIdField = user.fields.find((f) => f.name === 'companyId')!;
    expect(idField.isUuidCandidate).toBe(true);
    expect(idField.hasUuidDefault).toBe(true);
    expect(companyIdField.isUuidCandidate).toBe(true);
    expect(companyIdField.hasUuidDefault).toBe(false);
  });

  test('identifies Binary(16) fields', () => {
    const schema = parseSchema(SCHEMA);
    const post = schema.modelByName.get('Post')!;
    const idField = post.fields.find((f) => f.name === 'id')!;
    expect(idField.isUuidCandidate).toBe(true);
    expect(idField.dbType).toBe('Binary(16)');
  });

  test('identifies relation fields', () => {
    const schema = parseSchema(SCHEMA);
    const user = schema.modelByName.get('User')!;
    const companyRelation = user.fields.find((f) => f.name === 'company')!;
    expect(companyRelation.isRelation).toBe(true);
    expect(companyRelation.relationTargetModel).toBe('Company');
  });

  test('list relations (one-to-many back-refs)', () => {
    const schema = parseSchema(SCHEMA);
    const user = schema.modelByName.get('User')!;
    const posts = user.fields.find((f) => f.name === 'posts')!;
    expect(posts.type).toBe('Post');
    expect(posts.isList).toBe(true);
  });

  test('list back-references are recognised as relations even without @relation', () => {
    // The owning side declares `@relation(fields: [...], references: [...])`.
    // The back-reference (`posts Post[]`) has no `@relation` attribute because
    // the FK is on the other model. The walker still needs to see it as a
    // relation so nested writes like `{ posts: { create: [...] } }` recurse
    // into the target model and convert UUID strings on inner fields.
    const schema = parseSchema(SCHEMA);
    const user = schema.modelByName.get('User')!;
    const posts = user.fields.find((f) => f.name === 'posts')!;
    expect(posts.isRelation).toBe(true);
    expect(posts.relationTargetModel).toBe('Post');
    const company = schema.modelByName.get('Company')!;
    const users = company.fields.find((f) => f.name === 'users')!;
    expect(users.isRelation).toBe(true);
    expect(users.relationTargetModel).toBe('User');
  });

  test('optional single back-reference (Model?) without @relation is a relation', () => {
    const optionalBackref = `
model Profile {
  id     String @id @db.Char(36)
  userId String @unique @db.Char(36)
  user   User   @relation(fields: [userId], references: [id])
}
model User {
  id      String   @id @db.Char(36)
  profile Profile?
}
`;
    const parsed = parseSchema(optionalBackref);
    const user = parsed.modelByName.get('User')!;
    const profile = user.fields.find((f) => f.name === 'profile')!;
    expect(profile.isRelation).toBe(true);
    expect(profile.relationTargetModel).toBe('Profile');
  });

  test('UUID-candidate scalar fields are never reclassified as relations', () => {
    // A `Bytes @db.Binary(16)` column whose name happens to clash with a
    // model name in the schema must remain a UUID scalar, not a relation.
    const collidingNames = `
model Tenant {
  id String @id @db.Char(36)
}
model Doc {
  id     String @id @db.Char(36)
  Tenant Bytes  @db.Binary(16)
}
`;
    const parsed = parseSchema(collidingNames);
    const doc = parsed.modelByName.get('Doc')!;
    const field = doc.fields.find((f) => f.name === 'Tenant')!;
    expect(field.isRelation).toBe(false);
    expect(field.isUuidCandidate).toBe(true);
  });

  test('ignores non-UUID scalar fields', () => {
    const schema = parseSchema(SCHEMA);
    const analytics = schema.modelByName.get('Analytics')!;
    expect(analytics.fields.every((f) => !f.isUuidCandidate)).toBe(true);
  });

  test('skips @@-prefixed model-level attributes (e.g. @@map, @@index)', () => {
    const schemaWithIndexes = `
model User {
  id    String @id @db.Char(36)
  email String @unique
  @@map("users")
  @@index([email])
}
`;
    const parsed = parseSchema(schemaWithIndexes);
    const u = parsed.modelByName.get('User')!;
    // @@-attrs must NOT appear as fields, but real fields must.
    expect(u.fields.map((f) => f.name).sort()).toEqual(['email', 'id']);
  });

  test('captures @@map as model.dbName', () => {
    const parsed = parseSchema(`
model User {
  id String @id @db.Char(36)
  @@map("users")
}
`);
    expect(parsed.modelByName.get('User')!.dbName).toBe('users');
  });

  test('captures @map as field.dbName', () => {
    const parsed = parseSchema(`
model User {
  id        String  @id @db.Char(36) @map("user_id")
  companyId String? @db.Char(36) @map("company_id")
  email     String  @unique
}
`);
    const u = parsed.modelByName.get('User')!;
    expect(u.fields.find((f) => f.name === 'id')!.dbName).toBe('user_id');
    expect(u.fields.find((f) => f.name === 'companyId')!.dbName).toBe('company_id');
    // Unmapped fields stay undefined; emitters fall back to `name`.
    expect(u.fields.find((f) => f.name === 'email')!.dbName).toBeUndefined();
  });

  test('dbName is undefined when @@map / @map are absent', () => {
    const parsed = parseSchema(`
model Order {
  id String @id @db.Char(36)
}
`);
    const m = parsed.modelByName.get('Order')!;
    expect(m.dbName).toBeUndefined();
    expect(m.fields[0]!.dbName).toBeUndefined();
  });

  test("skips lines that don't match field regex (comments, blanks)", () => {
    const schemaWithJunk = `
model User {
  // some comment line
  id    String @id @db.Char(36)

  email String @unique
}
`;
    const parsed = parseSchema(schemaWithJunk);
    const u = parsed.modelByName.get('User')!;
    expect(u.fields.map((f) => f.name).sort()).toEqual(['email', 'id']);
  });

  test('handles fields with no @-attrs (regex empty group fallback)', () => {
    const bareSchema = `
model User {
  id   String @id @db.Char(36)
  bio  String
}
`;
    const parsed = parseSchema(bareSchema);
    const bio = parsed.modelByName.get('User')!.fields.find((f) => f.name === 'bio')!;
    expect(bio.dbType).toBeUndefined();
    expect(bio.isUuidCandidate).toBe(false);
  });
});

describe('buildRegistry', () => {
  test('produces a complete config', () => {
    const schema = parseSchema(SCHEMA);
    const { config, stats } = buildRegistry(schema);

    expect(config.fields['User']).toEqual(['id', 'companyId']);
    expect(config.fields['Post']).toEqual(['id', 'authorId']);
    expect(config.fields['Company']).toEqual(['id']);
    expect(config.fields['Analytics']).toBeUndefined();

    expect(config.autoGenerate!['User']).toEqual(['id']);
    // Post.id is @id but has no @default(uuid()) — auto-gen from id-by-name fallback.
    expect(config.autoGenerate!['Post']).toEqual(['id']);
    expect(config.autoGenerate!['Company']).toEqual(['id']);

    expect(config.relations!['User']?.['company']).toBe('Company');
    expect(config.relations!['Post']?.['author']).toBe('User');
    // Back-references (no @relation attribute) are now registered too —
    // required for nested-write walkers to recurse into to-many writes.
    expect(config.relations!['User']?.['posts']).toBe('Post');
    expect(config.relations!['Company']?.['users']).toBe('User');

    expect(stats.models).toBe(3);
    expect(stats.uuidFields).toBe(5);
  });
});

describe('emitConfig', () => {
  test('produces deterministic output', () => {
    const schema = parseSchema(SCHEMA);
    const { config } = buildRegistry(schema);
    const emitted1 = emitConfig(config);
    const emitted2 = emitConfig(config);
    expect(emitted1).toBe(emitted2);
  });

  test('output is parseable TypeScript with expected shape', () => {
    const schema = parseSchema(SCHEMA);
    const { config } = buildRegistry(schema);
    const emitted = emitConfig(config);
    expect(emitted).toContain(
      "import { defineBinaryUuidConfig } from '@pax-training/prisma-extension-binary-uuid';",
    );
    expect(emitted).toContain('export const uuidConfig = defineBinaryUuidConfig({');
    expect(emitted).toContain("User: ['companyId', 'id']"); // alphabetized
    expect(emitted).toContain("Post: ['authorId', 'id']");
  });

  test('emits autoGenerate block when supplied', () => {
    const emitted = emitConfig({
      fields: { User: ['id'], Post: ['id'] },
      autoGenerate: { User: ['id'], Post: ['id'] },
    });
    expect(emitted).toContain('autoGenerate:');
    expect(emitted).toContain("User: ['id']");
    expect(emitted).toContain("Post: ['id']");
  });

  test('omits autoGenerate block when empty', () => {
    const emitted = emitConfig({
      fields: { User: ['id'] },
      autoGenerate: {},
    });
    expect(emitted).not.toContain('autoGenerate:');
  });

  test('emits relations block when supplied', () => {
    const emitted = emitConfig({
      fields: { User: ['id'], Post: ['id'] },
      relations: { User: { posts: 'Post' }, Post: { author: 'User' } },
    });
    expect(emitted).toContain('relations:');
    expect(emitted).toContain("posts: 'Post'");
    expect(emitted).toContain("author: 'User'");
  });

  test('omits relations block when empty', () => {
    const emitted = emitConfig({
      fields: { User: ['id'] },
      relations: {},
    });
    expect(emitted).not.toContain('relations:');
  });
});

describe('emitMigrationSql', () => {
  test('emits ALTER TABLE statements for CHAR(36) columns', () => {
    const schema = parseSchema(SCHEMA);
    const sql = emitMigrationSql(schema);
    // Temp column is always NULL on ADD; final nullability comes from the
    // CHANGE COLUMN after UPDATE has populated it.
    expect(sql).toContain('ALTER TABLE `User` ADD COLUMN `id__bin` BINARY(16) NULL AFTER `id`');
    expect(sql).toContain('ALTER TABLE `User` CHANGE COLUMN `id__bin` `id` BINARY(16) NOT NULL');
    expect(sql).toContain('UPDATE `User` SET `id__bin` = UUID_TO_BIN(`id`, 1)');
    expect(sql).toContain('ALTER TABLE `User` DROP COLUMN `id`');
    expect(sql).toContain('FOREIGN_KEY_CHECKS = 0');
  });

  test('temp __bin column is always NULL on ADD, even for NOT NULL fields', () => {
    // Crash-safety property: if the migration is interrupted between ADD and
    // UPDATE, the rows must contain obviously-bad NULLs rather than the
    // implicit zero-byte default that MySQL would supply for `BINARY NOT NULL`
    // — zeros look like valid UUIDs and would silently survive a half-applied
    // migration. The final CHANGE COLUMN reasserts the original nullability.
    const schema = parseSchema(`
model User {
  id   String  @id @db.Char(36)
  alt  String  @db.Char(36)
  opt  String? @db.Char(36)
}
`);
    const sql = emitMigrationSql(schema);
    const addLines = sql.split('\n').filter((l) => /ADD COLUMN .*__bin/.test(l));
    expect(addLines.length).toBe(3);
    for (const line of addLines) {
      expect(line).toContain('BINARY(16) NULL AFTER');
      expect(line).not.toContain('BINARY(16) NOT NULL');
    }
    // Final NOT NULL is reasserted on the non-nullable fields only.
    expect(sql).toContain('CHANGE COLUMN `id__bin` `id` BINARY(16) NOT NULL');
    expect(sql).toContain('CHANGE COLUMN `alt__bin` `alt` BINARY(16) NOT NULL');
    expect(sql).toContain('CHANGE COLUMN `opt__bin` `opt` BINARY(16) NULL');
  });

  test('uses @@map table name and @map column name in emitted SQL', () => {
    // @@map renames the table; @map renames the column. The runtime walker
    // operates on Prisma names, but raw migration SQL must target the
    // database-side identifiers or it errors with "Unknown table/column" —
    // or, worse, mutates a coincidentally similarly-named table.
    const mapped = parseSchema(`
model User {
  id        String  @id @db.Char(36) @map("user_id")
  companyId String? @db.Char(36) @map("company_id")
  email     String  @unique
  @@map("users")
}
`);
    const sql = emitMigrationSql(mapped);

    // Table name is the @@map target, not the model name.
    expect(sql).toContain(
      'ALTER TABLE `users` ADD COLUMN `user_id__bin` BINARY(16) NULL AFTER `user_id`',
    );
    expect(sql).toContain('UPDATE `users` SET `user_id__bin` = UUID_TO_BIN(`user_id`, 1)');
    expect(sql).toContain('ALTER TABLE `users` DROP COLUMN `user_id`');
    expect(sql).toContain(
      'ALTER TABLE `users` CHANGE COLUMN `user_id__bin` `user_id` BINARY(16) NOT NULL',
    );
    // Nullable @map'd field uses the DB column name too.
    expect(sql).toContain('`company_id__bin` BINARY(16) NULL');

    // The Prisma-side names must never appear as identifiers in a DDL
    // statement (only in the `-- Model:` comment header for traceability).
    const ddlLines = sql.split('\n').filter((l) => /^\s*(ALTER|UPDATE)/.test(l));
    for (const line of ddlLines) {
      expect(line).not.toContain('`User`');
      expect(line).not.toContain('`id`');
      expect(line).not.toContain('`companyId`');
    }
  });

  test('header comment includes both names when @@map is present', () => {
    const mapped = parseSchema(`
model AuditLog {
  id String @id @db.Char(36)
  @@map("audit_logs")
}
`);
    const sql = emitMigrationSql(mapped);
    expect(sql).toContain('-- Model: AuditLog -> audit_logs');
  });

  test('falls back to schema-side name when @map / @@map are absent', () => {
    // Regression guard: the schema-name path must still work for the common
    // case where no mapping attributes are present.
    const unmapped = parseSchema(`
model Order {
  id String @id @db.Char(36)
}
`);
    const sql = emitMigrationSql(unmapped);
    expect(sql).toContain('-- Model: Order');
    expect(sql).not.toContain('-> ');
    expect(sql).toContain('ALTER TABLE `Order` ADD COLUMN `id__bin`');
  });

  test('skips already-Binary(16) columns', () => {
    const schema = parseSchema(SCHEMA);
    const sql = emitMigrationSql(schema);
    expect(sql).toContain('skipping Post.id (already BINARY(16))');
    expect(sql).toContain('skipping Post.authorId (already BINARY(16))');
  });

  test('swap-flag is configurable', () => {
    const schema = parseSchema(SCHEMA);
    const sql = emitMigrationSql(schema, { swapFlag: 0 });
    expect(sql).toContain('UUID_TO_BIN(`id`, 0)');
    expect(sql).not.toContain('UUID_TO_BIN(`id`, 1)');
  });

  test('honors nullability on the final CHANGE COLUMN', () => {
    // ADD COLUMN is always NULL (see crash-safety test above). The original
    // nullability is restored when the temp column is renamed into place.
    const schema = parseSchema(SCHEMA);
    const sql = emitMigrationSql(schema);
    expect(sql).toContain(
      'ALTER TABLE `User` CHANGE COLUMN `companyId__bin` `companyId` BINARY(16) NULL',
    );
    expect(sql).toContain('ALTER TABLE `User` CHANGE COLUMN `id__bin` `id` BINARY(16) NOT NULL');
  });
});
