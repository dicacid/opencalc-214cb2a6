# syntax=docker/dockerfile:1

# TanStack Start + Nitro emits a Node server in .output, not a static dist/.
# Render injects PORT and reaches the container on 0.0.0.0.

FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock bunfig.toml .npmrc tsconfig.json vite.config.ts ./
COPY public ./public
COPY src ./src

RUN bun install --frozen-lockfile --registry https://registry.npmjs.org
RUN bun run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=10000

COPY --from=build /app/.output ./.output

EXPOSE 10000
USER node
CMD ["node", ".output/server/index.mjs"]
