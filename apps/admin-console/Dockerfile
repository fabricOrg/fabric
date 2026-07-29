# Fabric admin-console — Next.js standalone image (mirrors apps/dashboard/Dockerfile).
# next.config sets output:"standalone" + outputFileTracingRoot at the repo root.
# Runtime env (ECS task def / AWS Secrets Manager, never baked in): WORKOS_*, *_COOKIE_PASSWORD,
# API_BASE_URL, BFF_INTERNAL_TOKEN.
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
# Non-interactive build: pnpm aborts reconciling the modules dir without a TTY unless CI is set.
ENV CI=true
RUN corepack enable

WORKDIR /workspace
# Manifests FIRST: a bare `corepack install` reads packageManager from the local package.json,
# so running it in an empty WORKDIR fails with "Couldnt find a project in the local directory".
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN corepack install
RUN pnpm fetch
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @app/admin-console... build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

COPY --from=build --chown=node:node /workspace/apps/admin-console/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/admin-console/.next/static ./apps/admin-console/.next/static
USER node

EXPOSE 3000
# Trivial liveness probe (see app/healthz/route.ts) — no SSR, decoupled from page rendering.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Force HOSTNAME=0.0.0.0 for the server process: ECS/Fargate injects HOSTNAME=the container's IP
# hostname, which Next standalone would otherwise bind to (so 127.0.0.1 checks are refused). The
# inline assignment wins over the inherited container env.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/admin-console/server.js"]
