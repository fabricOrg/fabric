# Fabric

Fabric is a multi-tenant communications platform. The first vertical slice provides authenticated
SMS sending, wallet reservation and settlement, delivery reconciliation, and customer and operator
interfaces.

## Development

Prerequisites: Node.js 22+, pnpm 11, Docker, and Docker Compose.

```bash
pnpm install
cp .env.example .env
cp apps/dashboard/.env.example apps/dashboard/.env.local
pnpm db:up
pnpm db:migrate
pnpm dev:seed
```

Run `pnpm dev:api` and `pnpm dev` in separate terminals, then open
`http://localhost:3100`. Development auth uses an encrypted local-only session and refuses to run
when `NODE_ENV=production`. When the WorkOS variables are present, the same login screen also
supports hosted WorkOS authentication with server-only sealed sessions.

After installing and authenticating the Infisical CLI, you can run the same local workflow with
secrets injected from the Fabric Services development project:

```bash
pnpm dev:seed:infisical
pnpm dev:api:infisical
pnpm dev:dashboard:infisical
```

Quality gates:

```bash
pnpm validate          # guards, lint, typecheck, unit tests
pnpm verify            # validate plus production builds
pnpm verify:full       # verify plus database and service integration tests
pnpm verify:full:infisical # same full gate with development secrets injected
pnpm test:e2e          # local authenticated dashboard journey (Chrome)
```

Architecture and product documents are indexed in [docs/README.md](docs/README.md). Development
starts with [CONTRIBUTING.md](CONTRIBUTING.md). Releases move through
[`dev` -> `testing` -> `staging` -> `main`](docs/DEPLOYMENT-ENVIRONMENTS.md).
