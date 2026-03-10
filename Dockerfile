##
# Multi-stage Dockerfile for building and running a Next.js + Prisma app
#
# Goals:
# - Keep the final runtime image small and secure
# - Leverage Docker layer caching for faster rebuilds
# - Generate the Prisma client during the build stage so the runtime
#   image does not need development tooling or devDependencies
##

# -------------------------
# Builder stage
# -------------------------
# Use an official Node image with Alpine for a small build environment.
FROM node:20-alpine AS builder

# Set a working directory for all subsequent commands in this stage.
WORKDIR /app

# Copy dependency manifests first to take advantage of Docker layer caching.
# If package.json/package-lock.json don't change, Docker will reuse the
# node_modules layer and skip re-installing dependencies on subsequent builds.
COPY package.json package-lock.json ./

# Copy the Prisma schema before running npm ci. The postinstall script runs
# `prisma generate` automatically after install — it needs schema.prisma to
# exist or it will fail with "schema file not found".
COPY prisma ./prisma

# Use `npm ci` for reproducible installs in CI/containers (faster and deterministic).
RUN npm ci

# Copy the rest of the source code into the image. This is placed AFTER
# dependency installation so that code changes don't force re-installing deps.
COPY . .

# Generate the Prisma client BEFORE building. The Next.js build imports the
# generated client at src/lib/prisma.js, so the client files must exist under
# src/generated/prisma/client before `npm run build` runs — otherwise the
# build fails with "module not found".
RUN npx prisma generate

# Build the Next.js application into the `.next` directory. This produces
# optimized production assets (server bundles, static pages, client assets).
RUN npm run build


# -------------------------
# Runtime stage
# -------------------------
# Use a separate, minimal image for running the built app. This keeps the
# runtime footprint small and reduces the attack surface by excluding build tools.
FROM node:20-alpine AS runner

# Working directory in the runtime image
WORKDIR /app

# Ensure Node runs in production mode by default. Some libraries optimize
# behavior based on NODE_ENV (, disabling verbose logs or dev-only checks).
ENV NODE_ENV=production

# Standalone output bundles only the exact server files needed to run the app.
# No npm install required — all dependencies are already included by Next.js.
COPY --from=builder /app/.next/standalone ./
# Static assets (images, fonts, etc.) must be copied separately into the
# location the standalone server expects: .next/static
COPY --from=builder /app/.next/static ./.next/static
# Public folder (favicon, uploaded images at runtime, etc.)
COPY --from=builder /app/public ./public

# Prisma: schema + migrations for `prisma migrate deploy` at startup
COPY --from=builder /app/prisma ./prisma
# prisma.config.ts needed for --config flag in migrate commands
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Generated Prisma client — required at runtime by src/lib/prisma.js
COPY --from=builder /app/src/generated ./src/generated
# Smoke tests — needed so `npm test` works inside the container in CI
COPY --from=builder /app/src/tests ./src/tests
# package.json is needed for `npm test` to resolve the test script
COPY --from=builder /app/package.json ./package.json

# Expose the port the application listens on. Next.js default is 3000.
EXPOSE 3000

# Run the standalone server directly with Node — no npm, no shell wrapper,
# which is faster and produces cleaner process signals (SIGTERM handled properly).
CMD ["node", "server.js"]