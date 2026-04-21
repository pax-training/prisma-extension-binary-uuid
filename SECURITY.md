# Security

## Reporting a vulnerability

Do **not** file a public issue for security problems. Instead, use GitHub's
private vulnerability reporting:

https://github.com/pax-training/prisma-extension-binary-uuid/security/advisories/new

Or email: security@paxtraining.com

We will acknowledge receipt within 48 hours, and provide a resolution
timeline within 5 business days.

## Scope

Issues in scope:

- Memory-safety bugs in the walker (e.g., prototype-pollution paths)
- Information disclosure via error messages
- Any path where malformed input can escape validation and reach the driver
  as raw bytes
- Bugs in the conversion primitives that could corrupt UUIDs silently

Issues NOT in scope (report upstream):

- SQL injection via Prisma Client — Prisma parameterizes all queries; if
  you find a SQLi via `$queryRaw`, report to Prisma
- Security issues in `@prisma/client`, `@prisma/adapter-mariadb`, or the
  MySQL/MariaDB server — report to those projects
- Misconfiguration on the consumer side (exposed DATABASE_URL, weak DB
  passwords, etc.)

## Supported versions

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅ current |

When 2.x ships, 1.x will receive security patches for 6 months.

## Disclosure process

1. Reporter submits via private vulnerability advisory or email
2. We acknowledge within 48 hours
3. We develop a fix in a private branch
4. We release a patched version, coordinating with the reporter on timing
5. We publish the advisory and credit the reporter (unless they request anonymity)
