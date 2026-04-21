# Example: Next.js App Router

Using the extension in a Next.js 14+ project with the App Router.

## Setup

Place your extended Prisma client in a file that's only imported from
server code (Server Components, Server Actions, Route Handlers):

```ts
// lib/prisma.ts
import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
import { uuidConfig } from './uuid-config';

declare global {
  // eslint-disable-next-line no-var
  var _prisma: ReturnType<typeof createClient> | undefined;
}

function createClient() {
  const adapter = new PrismaMariaDb(process.env.DATABASE_URL!);
  return new PrismaClient({ adapter }).$extends(createBinaryUuidExtension(uuidConfig));
}

export const prisma = global._prisma ?? createClient();
if (process.env.NODE_ENV !== 'production') global._prisma = prisma;
```

The `globalThis` caching pattern is standard Next.js — it avoids creating a
new client on every hot-reload in dev.

## Server Action example

```ts
// app/users/actions.ts
'use server';
import { prisma } from '@/lib/prisma';
import { uuidString } from 'prisma-extension-binary-uuid';

export async function getUser(id: string) {
  return prisma.user.findUnique({ where: { id: uuidString(id) } });
}

export async function createUser(input: { email: string; name: string }) {
  return prisma.user.create({ data: input });
}
```

## URL encoding

If you use short IDs in URLs (e.g., base64url-encoded), do the
encode/decode at the URL boundary. The extension still takes the fully-
expanded UUID string as input.

```ts
// /app/users/[encodedId]/page.tsx
import { decodeBase64Url } from '@/lib/id-encoding';
import { uuidString } from 'prisma-extension-binary-uuid';

export default async function UserPage({ params }: { params: { encodedId: string } }) {
  const uuid = decodeBase64Url(params.encodedId);
  const user = await prisma.user.findUnique({ where: { id: uuidString(uuid) } });
  // ...
}
```
