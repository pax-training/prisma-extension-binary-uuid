# Contributing

Thanks for considering a contribution. This document describes how the
project is developed and what to expect when you file an issue or open a PR.

## Principles

1. **Stable surfaces only.** The extension uses Prisma's public Client
   Extension API. We don't reach into `index.d.ts` internals or runtime DMMF.
   If a change would require us to, please raise it as an issue first — we'll
   likely decline.
2. **Explicit over inferred.** The UUID field registry is declared in
   user-land code. We don't auto-parse `schema.prisma` at runtime.
3. **Fail loud.** Malformed input throws with typed errors that include
   model + field context. We never silently pass through ambiguous values.
4. **Semver strict.** Breaking changes always bump major.
5. **Test parity across DB versions.** Every PR runs against MySQL 5.7 /
   8.0 / 8.4 and MariaDB 10.11 / 11 in CI. Broken combos block merge.

## Setup

```bash
git clone https://github.com/pax-training/prisma-extension-binary-uuid
cd prisma-extension-binary-uuid
pnpm install
pnpm prisma generate   # generates the dev-time Prisma client stub
pnpm test              # unit + property tests
```

Integration tests require a container runtime (Docker or Podman):

```bash
pnpm test:integration
```

If you don't have a runtime configured, set `TESTCONTAINERS_SKIP=1` and the
integration suites will skip gracefully.

## Development loop

```bash
pnpm test:watch        # re-run unit tests on change
pnpm typecheck         # tsc --noEmit
pnpm lint              # eslint
pnpm build             # tsup ESM + CJS output
```

## Changesets

Every user-facing change needs a changeset:

```bash
pnpm changeset
```

Pick the bump type (patch/minor/major), write a one-line description, and
commit the file alongside your code change.

## Pull request checklist

- [ ] Tests added or updated (unit + integration + property as applicable)
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] Changeset committed
- [ ] Documentation updated (README, API docs, examples as applicable)

## Scope discipline

This extension does exactly one thing: transparent binary UUID storage for
Prisma + MySQL/MariaDB. We decline features outside this scope, including
but not limited to:

- Encryption at rest
- Audit logging
- Multi-tenancy
- Other UUID formats (ULID, KSUID, Snowflake, etc.)
- Database drivers other than MySQL-protocol

The right home for those features is a separate extension. Prisma extensions
compose well; you don't need us to bundle them.

## Reporting bugs

Use the bug report template. Include:

- Package version
- Prisma Client version
- Database version
- Minimal reproduction (stripped to smallest that triggers the bug)
- Expected vs. actual behavior

## Security issues

Do NOT file security issues on the public tracker. See [SECURITY.md](SECURITY.md).

## Code of conduct

Everyone participating is expected to follow our
[Code of Conduct](CODE_OF_CONDUCT.md).
