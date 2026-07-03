# Contributing

Fabric uses trunk-based development. `main` is the only long-lived branch; all work reaches it
through a short-lived pull request and a squash merge.

## First-time setup

```bash
pnpm install
pnpm git:setup
pnpm db:up
```

`pnpm install` activates the Husky hooks. `pnpm git:setup` configures this clone for fast-forward-only
pulls, automatic upstream tracking, stale-branch pruning, and recorded conflict resolution.

## Branches

Create branches from an up-to-date `main`:

```bash
git switch main
git pull --ff-only
git switch -c feature/f5-2-provider-attempts
```

Allowed prefixes are `feature`, `fix`, `chore`, `ci`, `docs`, `refactor`, `test`, `build`, and
`perf`. The scope must be a feature (`f5-2`), epic (`e5`), GitHub issue (`gh-123`), or `ops`.
Dependabot branches are the only automated exception.

Examples:

```text
feature/f5-2-provider-attempts
fix/gh-123-webhook-signature
ci/ops-cache-pnpm
docs/e5-provider-runbook
```

Keep branches short-lived and focused. Rebase onto `origin/main` before requesting final review when
the branch is behind:

```bash
git fetch origin
git rebase origin/main
```

## Commits

Commits and pull-request titles use Conventional Commits:

```text
feat(f5-2): persist provider attempts
fix(webhooks): verify signatures against raw bytes
ci: run database invariants on pull requests
```

Use `!` for a breaking change and explain it in the commit body. Do not add generated co-author
trailers. Local hooks reject invalid branch names, commit headers, formatting, and architecture
violations.

## Pull requests

1. Keep one behavior change per pull request.
2. Complete the pull-request template, including risk and verification.
3. Ensure `pnpm verify` passes locally.
4. Run `pnpm verify:full` for database, wallet, SMS, or API behavior changes.
5. Resolve CI failures before merge.
6. Squash merge using the Conventional Commit pull-request title.

Database migrations must be forward-compatible and include rollback or mitigation notes. Changes to
tenant isolation, authentication, money movement, webhook trust, or PII handling require explicit
security and failure-path tests.

## Repository limitation

GitHub branch protection is unavailable for this private repository on its current organization
plan. CI and PR policy checks are configured, but an administrator can still push directly to
`main`. Treat pull-request-only changes as mandatory policy until branch rules become available.
