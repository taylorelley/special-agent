# CLAUDE.md

## Quick Reference

```bash
pnpm check          # format (oxfmt) + types (tsgo) + lint (oxlint) — runs in CI
pnpm test           # unit tests (parallel vitest) — runs in CI
pnpm protocol:check # codegen + drift check for protocol schema & Swift models — runs in CI
pnpm build          # full dist build — runs in CI
```

## CI Checks

Before pushing, run at minimum:

```bash
pnpm check && pnpm test
```

### What CI runs

| CI Job | Command | Notes |
|--------|---------|-------|
| **check** | `pnpm check` | `oxfmt --check` + `tsgo` + `oxlint --type-aware` |
| **checks (test)** | `pnpm canvas:a2ui:bundle && pnpm test` | Node + Bun test lanes |
| **checks (protocol)** | `pnpm protocol:check` | Fails if generated protocol schema or Swift models are stale |
| **build-artifacts** | `pnpm build` | Full dist build |
| **secrets** | `detect-secrets scan` | Scans for leaked secrets against `.secrets.baseline` |
| **check-docs** | `pnpm check:docs` | Only when docs files change |
| **code-analysis** | `python scripts/analyze_code_files.py` | PR-only: fails if a file exceeds 1000 LOC threshold |
| **checks-windows** | `pnpm test` | Same tests on Windows |

### Fixing common failures

- **oxfmt formatting**: run `pnpm format` to auto-fix, then re-commit
- **Lint errors**: run `pnpm lint` to see issues; `oxlint` does not auto-fix
- **Type errors**: run `pnpm tsgo` to check locally
- **Protocol drift**: run `pnpm protocol:check` — if it fails, run `pnpm protocol:gen && pnpm protocol:gen:swift` and commit the updated files
- **Tabs in workflow files**: CI rejects tabs in `.github/workflows/*.yml` — use spaces only
