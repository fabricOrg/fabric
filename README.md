# Fabric

Fabric is a multi-tenant communications platform. The first vertical slice provides authenticated
SMS sending, wallet reservation and settlement, delivery reconciliation, and customer and operator
interfaces.

## Development

Prerequisites: Node.js 22+, pnpm 11, Docker, and Docker Compose.

```bash
pnpm install
pnpm db:up
pnpm dev
```

Quality gates:

```bash
pnpm validate          # guards, lint, typecheck, unit tests
pnpm verify            # validate plus production builds
pnpm verify:full       # verify plus database and service integration tests
```

Architecture and product documents are indexed in [docs/README.md](docs/README.md). Development
starts with [CONTRIBUTING.md](CONTRIBUTING.md).
