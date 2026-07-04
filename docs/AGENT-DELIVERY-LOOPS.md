# Agent delivery loops

Fabric work is delivered as small vertical slices. The lead agent owns the end-to-end contract and
keeps specialist work inside existing module boundaries. Agents do not create parallel versions of
the same abstraction or edit overlapping files concurrently.

## Loop topology

1. **Lead loop:** select one user-visible outcome, read its stories and architecture, define
   acceptance evidence, assign file ownership, and keep the critical path local.
2. **Database loop:** implement schema and repositories with Drizzle, preserve RLS and financial
   invariants, and add migration/integration evidence. Raw SQL is limited to centralized primitives
   Drizzle cannot express, such as transaction-local tenant context.
3. **Backend loop:** implement validated contracts, authorization, services, and structured errors.
   Controllers remain thin and business persistence goes through `@app/db` repositories.
4. **Frontend loop:** implement the BFF and user workflow against shared contracts. Browser code
   never receives provider credentials, API keys, database URLs, or identity tokens.
5. **Security loop:** review trust boundaries, tenant pinning, permissions, CSRF, secrets, PII, and
   safe failures. Money, tenancy, and authentication changes cannot pass without this gate.
6. **Quality loop:** map acceptance criteria to unit, integration, API, and browser evidence,
   including negative and cross-tenant cases.
7. **Integration loop:** rebase on `dev`, run the full quality gates, exercise the local journey,
   open a PR, wait for CI, squash merge, and remove the worktree.

## Iteration contract

Each loop repeats:

`inspect -> decide -> implement -> test -> review -> integrate -> reassess`

The next iteration starts only after the current slice has evidence at every affected boundary.
External payment and SMS calls remain feature-flagged and disabled until their explicit human gate.

## Parallelism rules

- Parallel work must have disjoint write sets and a stable contract agreed by the lead loop.
- The lead keeps immediate blockers on the critical path instead of delegating them.
- Database and contract changes land before dependent backend and frontend work.
- Specialist findings are integrated once; another agent does not duplicate the same audit.
- Any discovered invariant or security defect interrupts feature work and becomes the next fix.
