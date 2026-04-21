# Quick start

This page gets you from zero to a working extension in 10 minutes.

## Prerequisites

- Node.js 18+
- A Prisma project with MySQL or MariaDB
- `@prisma/client` 5.x, 6.x, or 7.x

## Installation

```bash
pnpm add prisma-extension-binary-uuid
```

## Step 1 — Flip your schema

Change every UUID column from `CHAR(36)` / `VarChar(36)` to `Binary(16)`:

```diff
 model User {
-  id        String   @id @default(uuid()) @db.Char(36)
+  id        Bytes    @id @default(dbgenerated("(UUID_TO_BIN(UUID(), 1))")) @db.Binary(16)
   email     String   @unique
-  companyId String?  @db.Char(36)
+  companyId Bytes?   @db.Binary(16)
   company   Company? @relation(fields: [companyId], references: [id])
 }
```

The `@default(dbgenerated("(UUID_TO_BIN(UUID(), 1))"))` lets the database
auto-generate IDs on insert. If you prefer application-generated IDs, omit
the default — the extension's auto-gen path kicks in based on your
`autoGenerate` config.

## Step 2 — Generate the UUID field registry

```bash
npx prisma-extension-binary-uuid init --schema ./prisma/schema.prisma --out ./src/uuid-config.ts
```

Review the generated file. Commit it to version control.

Add a CI check to catch drift:

```bash
npx prisma-extension-binary-uuid validate
```

Put that in your `lint` step so a schema change that adds a UUID field
without updating the config fails the build.

## Step 3 — Apply the extension

```ts
// src/prisma.ts
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
import { uuidConfig } from './uuid-config';

const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
export const prisma = new PrismaClient({ adapter })
  .$extends(createBinaryUuidExtension(uuidConfig));
```

## Step 4 — Query as usual

```ts
import { uuidString } from 'prisma-extension-binary-uuid';

// String in, string out:
const user = await prisma.user.findUnique({
  where: { id: uuidString('550e8400-e29b-41d4-a716-446655440000') },
});
console.log(user?.id); // '550e8400-...' — still a string

// Auto-generated IDs come back as strings:
const newUser = await prisma.user.create({ data: { email: 'a@b.c' } });
console.log(newUser.id); // '<new-uuid>'
```

## Common gotchas

- **TypeScript insists on `Uint8Array` for UUID fields**: wrap the string
  with `uuidString()`. Runtime no-op, type-level brand match.
- **Existing data is in `CHAR(36)` format**: use
  `npx prisma-extension-binary-uuid migrate-sql` to emit migration SQL.
- **Raw queries bypass the extension**: `$queryRaw` and `$executeRaw` don't
  go through the extension. If you use raw SQL for UUID columns, handle
  `UUID_TO_BIN` / `BIN_TO_UUID` yourself.

## Next steps

- [Config reference](config-reference.md)
- [Edge cases](edge-cases.md)
- [Performance](performance.md)
