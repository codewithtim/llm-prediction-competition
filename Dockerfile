FROM oven/bun:1.3 AS base
WORKDIR /app

# Install backend dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production --ignore-scripts

# Build UI
FROM base AS ui-build
COPY ui/package.json ui/bun.lock ./ui/
RUN cd ui && bun install --frozen-lockfile
COPY ui/ ./ui/
COPY src/shared/ ./src/shared/
RUN cd ui && bun run build

# Release stage
FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=ui-build /app/ui/dist ./ui/dist

RUN mkdir -p /app/data

EXPOSE 3000
CMD ["bun", "run", "src/index.ts"]
