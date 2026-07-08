# Fabric admin-console — Next.js standalone image (mirrors apps/dashboard/Dockerfile).
# next.config sets output:"standalone" + outputFileTracingRoot at the repo root.
# Runtime env (ECS task def / AWS Secrets Manager, never baked in): WORKOS_*, *_COOKIE_PASSWORD,
# API_BASE_URL, BFF_INTERNAL_TOKEN.
FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
RUN corepack enable

WORKDIR /workspace
COPY . .
RUN corepack install
RUN pnpm install --frozen-lockfile
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
# No /health route; the public /login page returns 200 unauthenticated.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3   CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/admin-console/server.js"]
