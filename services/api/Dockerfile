FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HUSKY=0
RUN corepack enable

WORKDIR /workspace
RUN corepack install
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN pnpm fetch --prod
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm --filter @app/api... build
RUN pnpm --filter @app/api deploy --prod --legacy /runtime

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /runtime /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
