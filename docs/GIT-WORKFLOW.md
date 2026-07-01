# Git workflow — worktrees, linear history, merge queue

The team shares **one repository** but must not share **one working tree** — concurrent edits to a
single tree collide (shared index races, lint-gate cross-blocking). So each active lane gets its own
**git worktree**: a separate directory with its own working files and index, all sharing the one
`.git` object store and history.

## Branches & history
- `main` = release line. `dev` = integration trunk. Lanes branch off `dev`.
- **Linear history — no merge commits.** Repo enforces `merge.ff=only` + `pull.rebase=true`.
  Rebase your branch onto `dev` before it lands; the integrator ff-merges.
- **Branch names** are validated (`enforce:branch-name`): `<type>/<ticket>-<slug>` where
  `type ∈ {feature,fix,chore,docs,refactor,test}` and `ticket ∈ {f<n>[-<n>], e<n>, ops}`.
  e.g. `feature/e3-ledger-double-entry`, `chore/ops-db-tooling`, `docs/ops-pi1-reconcile`.

## Worktrees (current lanes)
| Worktree dir | Branch | Lane / owner |
|---|---|---|
| `D:/work/jojo-projects` | `dev` | integration (fifi) — **do not develop here** |
| `D:/work/jojo-worktrees/ledger` | `feature/e3-ledger-double-entry` | ledger schema + `packages/db/test/` invariant gate (newton, +adams) |
| `D:/work/jojo-worktrees/db-tooling` | `chore/ops-db-tooling` | drizzle-kit bump + journal wiring (pascal) |
| `D:/work/jojo-worktrees/ui-tokens` | `chore/ops-ui-tokens` | `@app/ui` token seam (edison) |
| `D:/work/jojo-wt-ops-doc-reconcile` | `feature/ops-doc-reconcile` | PI-1 doc reconciliation (pascal) |

Need a lane? Ask the integrator: `git worktree add D:/work/jojo-worktrees/<name> -b <type>/<ticket>-<slug> dev`.

## Migrating WIP out of the shared main tree (one-time)
If your in-flight work is still sitting uncommitted in `D:/work/jojo-projects`, move it into your
worktree — don't commit it in the shared tree:
```sh
# from the main tree — read-only, safe even if others are working:
cd D:/work/jojo-projects
git diff HEAD -- <your/files...> > /tmp/<lane>.patch      # tracked edits
#   ...and copy any untracked files you created to your worktree dir

# in your worktree — its own index, no race:
cd D:/work/jojo-worktrees/<lane>
git apply /tmp/<lane>.patch                                # (or place the copied files)
git add <your/files...> && git commit -m "<type>(<ticket>): ..."
```
Until everyone has migrated, **the main tree is not reset** — nothing is lost. Do all *new* work in
your worktree.

## Deliver → merge queue
1. In your worktree: commit small, Conventional Commits. `pnpm install` once (wires husky; pre-commit
   lints only *staged* files — pre-push runs full `pnpm verify`).
2. Rebase onto latest `dev`: `git fetch && git rebase dev` (resolve locally).
3. Post **"ready to merge: `<branch>` @ `<sha>`"** on the a2a board and @mention the integrator (fifi).
4. Integrator reviews the diff (code-review gate — money/PII/tenant/security paths get scrutiny),
   then `git merge --ff-only <branch>` into `dev` and removes the worktree.
5. Merges are serialized by the integrator (the "queue") so ff-merges never race. If your rebase went
   stale (someone merged first), rebase again and re-post.

Clean up a finished lane: `git worktree remove <dir>` (integrator does this after merge).
