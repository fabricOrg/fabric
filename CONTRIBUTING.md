# Contributing

Fabric uses short-lived work branches and four promotion branches:
`dev` -> `testing` -> `staging` -> `main`. `main` represents production.

## First-time setup

```bash
pnpm install
pnpm git:setup
pnpm db:up
```

`pnpm install` activates the Husky hooks. `pnpm git:setup` configures this clone for fast-forward-only
pulls, automatic upstream tracking, stale-branch pruning, and recorded conflict resolution.

## Branches

Create branches from an up-to-date `dev`:

```bash
git switch dev
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

Keep branches short-lived and focused. Rebase onto `origin/dev` before requesting final review when
the branch is behind:

```bash
git fetch origin
git rebase origin/dev
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
2. Target `dev` from every work or Dependabot branch.
3. Promote only `dev` -> `testing` -> `staging` -> `main`.
4. Complete the pull-request template, including risk and verification.
5. Ensure `pnpm verify` passes locally.
6. Run `pnpm verify:full` for database, wallet, SMS, or API behavior changes.
7. Resolve CI failures before merge.
8. Squash merge using the Conventional Commit pull-request title.

Pre-push and CI verification skip builds and tests when every changed file is Markdown
documentation (`.md` or `.mdx`). Any code, configuration, workflow, dependency, migration, or
script change still runs the complete gate.

Database migrations must be forward-compatible and include rollback or mitigation notes. Changes to
tenant isolation, authentication, money movement, webhook trust, or PII handling require explicit
security and failure-path tests.

## Repository limitation

GitHub branch protection is unavailable for this private repository on its current organization
plan. CI and PR policy checks are configured, but an administrator can still push directly to the
promotion branches. Treat pull-request-only changes as mandatory policy until branch rules become
available.
