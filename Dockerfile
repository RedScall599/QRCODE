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

# Copy only the package manifests and install production dependencies.
# Installing only production deps (`--omit=dev`) keeps the image small and
# avoids shipping dev-only packages into production.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built Next.js output and necessary runtime assets from the builder stage.
# - `.next` contains the compiled application server and client bundles.
# - `public` contains static assets like images and favicon.
# - `prisma` contains runtime Prisma artifacts (schema, generated client files).
# - `next.config.js` may be required at runtime for certain Next.js behaviors.
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.js ./next.config.js

# Expose the port the application listens on. Next.js default is 3000.
EXPOSE 3000

# Start the application using the package.json `start` script. The start
# script should run Next.js in production mode (for example: `next start`).
CMD ["npm", "run", "start"]