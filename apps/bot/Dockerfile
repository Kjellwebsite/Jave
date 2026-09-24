# JAVE bot — self-contained esbuild bundle on a slim Node runtime.
# Build from the repository root:  docker build -f apps/bot/Dockerfile -t jave-bot .

FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY apps/bot ./apps/bot
RUN pnpm install --frozen-lockfile --filter @jave/bot... --filter @jave/database
RUN pnpm --filter @jave/bot build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV JAVE_MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
# Bundled bot + migrations. Release step: node dist/migrate.mjs
COPY --from=build /repo/apps/bot/dist ./dist
COPY --from=build /repo/packages/database/drizzle ./drizzle
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOT_HEALTH_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.mjs"]
