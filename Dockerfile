FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --ignore-scripts

COPY tsup.config.ts tsconfig.json ./
COPY src ./src
RUN bun run build

FROM node:22-slim AS runtime

WORKDIR /app

COPY package.json ./
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

CMD ["node", "build/index.js", "--transport", "http"]
