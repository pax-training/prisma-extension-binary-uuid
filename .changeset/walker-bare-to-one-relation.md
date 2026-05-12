---
'@pax-training/prisma-extension-binary-uuid': patch
---

Walk into bare to-one relation `where` shorthand

`walkRelationFilter` previously only recursed into the operator-wrapped
relation-filter shape (`some` / `every` / `none` / `is` / `isNot`). The
**bare to-one shorthand** Prisma also accepts —

```ts
prisma.post.findFirst({
  where: { author: { id: '550e8400-...' } },
});
```

— skipped the converter entirely because none of the inner keys are in
the operator set, so the inner UUID string reached the engine
unconverted and Prisma 7 rejected it with:

> Could not convert from `base64 encoded bytes` to `PrismaValue::Bytes`.
> Expected base64 String.

The walker now detects the operator-less shape — if no key in the value
is one of the relation-filter operators, the whole object is treated as
a direct `where` against the related model and recurses through
`walkWhere`. This covers any depth of bare-to-one chaining
(`where: { a: { b: { c: { uuidField: ... } } } }`) since each layer hits
the same branch in turn.

Mixed shapes (`{ is: {...}, id: '...' }`) aren't valid Prisma input so
no special handling is needed — the operator branch wins as soon as one
operator is present.

Six new tests cover:

- bare to-one with a single UUID field
- bare to-one with a UUID FK that pivots further
- bare to-one alongside a non-UUID scalar (string left untouched)
- bare to-one combined with an operator-wrapped sibling on the same `where`
- empty bare to-one object (`{ author: {} }`) — no-op
- the existing `is`/`isNot` operator path (regression coverage)
