# Fabric customer dashboard (apps/dashboard) — Next.js standalone image.
# next.config sets output:"standalone" + outputFileTracingRoot at the repo root, so the build emits a
# self-contained server under apps/dashboard/.next/standalone (traced monorepo node_modules included).
# Runtime env (set by the ECS task definition, values from AWS Secrets Manager — never baked in):
#   API_BASE_URL, BFF_INTERNAL_TOKEN, WORKOS_* , *_COOKIE_PASSWORD, WORKOS_REDIRECT_URI…
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
RUN corepack enable

WORKDIR /workspace
COPY . .
RUN corepack install
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @app/dashboard... build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# Standalone server (traced monorepo layout) + the static assets it references.
COPY --from=build --chown=node:node /workspace/apps/dashboard/.next/standalone ./
COPY --from=build --chown=node:node /workspace/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node

EXPOSE 3000
# Trivial liveness probe (see app/healthz/route.ts) — no SSR, decoupled from page rendering.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Force HOSTNAME=0.0.0.0 for the server process: ECS/Fargate injects HOSTNAME=the container's IP
# hostname, which Next standalone would otherwise bind to (so 127.0.0.1 checks are refused). The
# inline assignment wins over the inherited container env.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node apps/dashboard/server.js"]
