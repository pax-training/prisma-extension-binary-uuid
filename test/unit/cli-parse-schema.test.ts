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
    expect(sql).toContain('ALTER TABLE `User` ADD COLUMN `id__bin` BINARY(16) NOT NULL');
    expect(sql).toContain('UPDATE `User` SET `id__bin` = UUID_TO_BIN(`id`, 1)');
    expect(sql).toContain('ALTER TABLE `User` DROP COLUMN `id`');
    expect(sql).toContain('FOREIGN_KEY_CHECKS = 0');
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

  test('handles nullable fields', () => {
    const schema = parseSchema(SCHEMA);
    const sql = emitMigrationSql(schema);
    expect(sql).toContain('`companyId__bin` BINARY(16) NULL');
    expect(sql).toContain('`id__bin` BINARY(16) NOT NULL');
  });
});
