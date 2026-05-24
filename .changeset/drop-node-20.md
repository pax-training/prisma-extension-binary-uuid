---
'@pax-training/prisma-extension-binary-uuid': minor
---

Drop Node 20 support. The minimum supported Node version is now 22.13.

Node 20 reached end-of-life on 2026-04-30 and the project's pinned
`packageManager` (pnpm 11.x) already required Node ≥ 22.13 for any
contributor to install dependencies. The published `engines.node` now
matches that reality; CI no longer runs against Node 20.

Users still on Node 20 should pin to `1.0.x`, which remains installable
but unmaintained.
