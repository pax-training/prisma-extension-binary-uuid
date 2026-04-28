---
'@pax-training/prisma-extension-binary-uuid': patch
---

Walk into compound-unique-key wrappers in `where` clauses

`@@unique([a, b])` and `@@id([a, b])` are exposed by Prisma as
nested-object wrappers (`where: { a_b: { a, b } }`). The walker
previously only recognised top-level UUID fields, relations, and
logical combinators — compound-key wrappers fell through unconverted,
so the inner UUID strings reached the engine as plain strings against a
`Bytes` column and Prisma rejected them with:

> Could not convert from `base64 encoded bytes` to `PrismaValue::Bytes`.
> Expected base64 String.

`walkWhere` now also recurses into any plain (non-array) object value.
The recursion keeps the same model scope, so inner keys hit the
existing UUID-field / relation branches — no separate compound-key
table to maintain. Inner keys that don't match any field on the model
are still left untouched (the recursion is a no-op for them), so a
non-UUID scalar inside a compound key (e.g. a `Date` second-half) is
unaffected.

Tested via four new `compound unique keys` cases plus an
unknown-key plain-object no-op test.
