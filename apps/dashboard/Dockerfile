# Fabric customer dashboard (apps/dashboard) — Next.js standalone image.
# next.config sets output:"standalone" + outputFileTracingRoot at the repo root, so the build emits a
# self-contained server under apps/dashboard/.next/standalone (traced monorepo node_modules included).
# Runtime env (set by the ECS task definition, values from AWS Secrets Manager — never baked in):
#   API_BASE_URL, DASHBOARD_API_KEY, BFF_INTERNAL_TOKEN, WORKOS_* , *_COOKIE_PASSWORD, WORKOS_REDIRECT_URI…
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
# No /health route on the dashboard; the login page is public and returns 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "apps/dashboard/server.js"]
