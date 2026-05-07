---
'@pax-training/prisma-extension-binary-uuid': patch
---

CLI: register to-many back-references as relations

The `init` CLI builds a registry of relations the runtime walker uses
to recurse into nested writes. Previously, only fields with the
explicit `@relation` attribute (the *owning* side, where the FK lives)
were registered. **Virtual back-references** — typically `Model[]`
to-many lists, occasionally optional `Model?` singles — were silently
dropped because Prisma puts the `@relation` block on the other side
of the relationship, not on the back-ref.

Concretely:

```prisma
model UsersRoles {
  id          Bytes                  @id @db.Binary(16)
  permissions UsersRolePermissions[] // ← back-ref, no @relation here
}

model UsersRolePermissions {
  id     Bytes      @id @db.Binary(16)
  roleId Bytes      @db.Binary(16)
  role   UsersRoles @relation(fields: [roleId], references: [id])
}
```

The owning `UsersRolePermissions.role` was registered. The back-ref
`UsersRoles.permissions` was not. So a perfectly normal nested write —

```ts
prisma.usersRoles.create({
  data: {
    id: randomUUID(),
    permissions: { create: [{ id: randomUUID(), permission: '...' }] },
  },
});
```

— never had the inner `id` strings converted, and Prisma 7 rejected
the call with:

> Invalid value for argument `id`: Could not convert from `base64
> encoded bytes` to `PrismaValue::Bytes`. Expected base64 String.

The parser now does a two-pass scan: it first collects every model
name in the schema, then on the field pass it treats any field whose
type matches a model name AND has no `@db.*` mapping as a relation,
even when no `@relation` attribute is present. UUID-candidate scalar
fields (`Bytes @db.Binary(16)` / `String @db.Char(36)`) are excluded
from the heuristic, so a column that happens to share a name with a
model can never be reclassified as a relation.

Three new tests cover:

- to-many back-references (`User.posts`, `Company.users`)
- optional single back-references (`User.profile`)
- name-collision safety (a `Tenant Bytes @db.Binary(16)` UUID column
  in a schema that also declares a `model Tenant` stays a UUID scalar)

Re-running `prisma-extension-binary-uuid init` after upgrading will
emit the additional relation entries; runtime nested writes through
back-references now convert as expected.
