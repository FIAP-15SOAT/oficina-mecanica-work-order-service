# ── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci

COPY tsconfig*.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# DATABASE_URL is required by prisma generate (Prisma v7 reads it via prisma.config.ts).
# Only code generation happens here — no real database is needed at build time.
ARG DATABASE_URL="postgresql://prisma:prisma@localhost:5432/prisma?schema=public"
RUN npm run prisma:generate

RUN npm run build

# ── Stage 2: Production ──────────────────────────────────────────────────────
FROM node:24-alpine AS production

WORKDIR /app

# Copy package manifests and install only production dependencies
COPY --from=builder /app/package*.json ./
RUN apk add --no-cache python3 make g++ && \
    npm ci --omit=dev && \
    apk del python3 make g++

# Copy compiled output
COPY --from=builder /app/dist ./dist

# Copy Prisma schema, migrations and config
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

# Baked at build time and surfaced as service.version in every log line.
ARG SERVICE_VERSION=dev
ENV SERVICE_VERSION=${SERVICE_VERSION}

EXPOSE 3000

CMD ["node", "--require", "./dist/src/otel.js", "dist/src/main"]

