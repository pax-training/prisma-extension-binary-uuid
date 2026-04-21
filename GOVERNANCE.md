# Governance

## Maintainer

This project is currently maintained by a single author from
[PAX Training LLC](https://github.com/pax-training). External contributors
are welcome and encouraged via pull requests and issues.

## Decision-making

Technical decisions are made by the maintainer based on:

1. Alignment with the [guiding principles](CONTRIBUTING.md#principles)
2. Backward compatibility (semver strict)
3. Long-term maintenance cost
4. Community input from issues + discussions

For non-trivial design decisions, the maintainer will open a discussion
before merging, giving at least 7 days for community input.

## Adding a co-maintainer

The maintainer may invite a co-maintainer after:

- They have contributed at least 3 non-trivial PRs
- They have participated in issue triage for at least 3 months
- They agree to this governance document

## Roadmap

Public roadmap is visible via milestones:
https://github.com/pax-training/prisma-extension-binary-uuid/milestones

## Archive policy

This extension exists because Prisma does not ship native BINARY(16) UUID
support for MySQL/MariaDB (see issue
[#11414](https://github.com/prisma/prisma/issues/11414), closed as "not planned").

If Prisma ships native support in a future version, this project will:

1. Announce deprecation in a minor release with a clear migration guide
2. Publish one final major release that aligns with the new Prisma feature
3. Archive the repository (read-only) with a pinned README pointing at the
   native Prisma feature
4. Continue to release security patches for 6 months after archive

The archive is a promise we make now — users of this extension should feel
confident adopting it even though its long-term goal is to become obsolete.
