# Example: Multi-tenant schemas

If your application uses a tenant-per-schema or tenant-per-database pattern,
each tenant's Prisma Client needs its own extension instance (the extension
is bound to a config at creation time, and configs can differ per tenant).

## Shared schema shape, per-tenant connection

Most common pattern: all tenants share the same schema shape but connect
to different physical databases. Build a client factory:

```ts
// lib/prisma-factory.ts
import { PrismaClient } from '@prisma/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { createBinaryUuidExtension } from 'prisma-extension-binary-uuid';
import { uuidConfig } from './uuid-config';

const clients = new Map<string, ReturnType<typeof createClient>>();

function createClient(url: string) {
  const adapter = new PrismaMariaDb(url);
  return new PrismaClient({ adapter }).$extends(createBinaryUuidExtension(uuidConfig));
}

export function getPrismaForTenant(tenantId: string): ReturnType<typeof createClient> {
  const cached = clients.get(tenantId);
  if (cached) return cached;
  const url = resolveTenantUrl(tenantId);
  const client = createClient(url);
  clients.set(tenantId, client);
  return client;
}
```

Each tenant gets its own Prisma Client + its own extension instance, but
they share the single `uuidConfig` since the schema shape is identical.

## Per-tenant config variation (rare)

If different tenants have different UUID columns (e.g., some have custom
fields that others don't), build a per-tenant config:

```ts
const baseConfig = defineBinaryUuidConfig({
  /* shared fields */
});

function buildTenantClient(tenantId: string, extraFields?: Record<string, string[]>) {
  const config = extraFields
    ? defineBinaryUuidConfig({
        ...baseConfig,
        fields: { ...baseConfig.fields, ...extraFields },
      })
    : baseConfig;
  // ... rest of client setup
}
```

## Cross-tenant UUID collisions

UUIDs are statistically unique across tenants. No special handling needed
at the extension layer — the usual tenant-scoping on your `where` clauses
prevents cross-tenant access.
