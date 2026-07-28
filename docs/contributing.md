# Contributing

## Merge-conflict marker guard

Unresolved git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>` at line start)
must never be committed. A scanner fails closed in CI and can block local commits.

### CI

GitHub Actions job **merge-conflict markers** runs:

```bash
node scripts/check-merge-markers.cjs
```

It scans all **tracked** files in the monorepo (skips `node_modules` / `dist`).

### Local pre-commit

Hooks live in `.githooks/` (tracked). Enable once per clone:

```bash
git config core.hooksPath .githooks
```

The `pre-commit` hook runs the same scanner against **staged** files only.

### Manual check

```bash
node scripts/check-merge-markers.cjs
node scripts/check-merge-markers.cjs --staged
```
