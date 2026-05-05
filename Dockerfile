# --- Build stage: install deps, compile Vite bundle (main + sandbox entries) ---
FROM oven/bun:1.3-alpine AS build
WORKDIR /app

# Cache npm/bun deps separately from source
COPY package.json bun.lock* package-lock.json* ./
RUN bun install --no-save

COPY . .
RUN bun run build

# --- Runtime: bun-only, no source map / dev tooling ---
FROM oven/bun:1.3-alpine AS runtime
WORKDIR /app

# Server source is interpreted at runtime (Bun reads .ts directly).
COPY --from=build /app/src ./src
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules

ENV NODE_ENV=production \
    PORT=8080 \
    DIST_DIR=dist

EXPOSE 8080
CMD ["bun", "run", "src/server/server.ts"]
