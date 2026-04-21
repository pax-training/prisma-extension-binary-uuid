# Changesets

Every PR that changes user-facing behavior needs a changeset. Run:

```
pnpm changeset
```

Pick the bump type (patch/minor/major) and describe the change. A file will be
written to this directory; commit it as part of your PR.

On merge to `main`, the release workflow will either:

- Open or update a "Release PR" that bumps versions + updates CHANGELOG.md, or
- Publish to npm if a Release PR was already merged.

See [changesets docs](https://github.com/changesets/changesets) for details.
