# ==========================================
# Multi-stage Bun build for CapyLLM
# ==========================================

# Stage 1: Build Frontend
FROM oven/bun:1-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package.json ./
RUN bun install

COPY frontend/ ./
RUN bun run build

# Stage 2: Server Dependencies & App
FROM oven/bun:1-alpine AS runner
WORKDIR /app

# Install curl for healthcheck and deployment monitoring
RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV PORT=3000
ENV CAPY_DB_PATH=/data/capyllm.db

# Copy backend dependencies
COPY package.json bun.lock ./
RUN bun install --production

# Copy backend sources
COPY src ./src
COPY drizzle ./drizzle
COPY drizzle.config.ts ./
COPY tsconfig.json ./
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Copy built frontend from stage 1
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

# Expose port and persistent volume for SQLite
EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
