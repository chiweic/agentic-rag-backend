# Multi-stage Dockerfile for the Next.js frontend.
#
# - `deps` layer caches node_modules so code edits don't re-install.
# - `builder` runs `next build`; requires next.config.ts's
#   `output: "standalone"` so .next/standalone is produced.
# - `runner` is the minimal production image: copies just the
#   standalone output + static assets + public dir. No npm / no
#   node_modules in the final layer.
#
# Built on the server with:
#   docker build -t backend-v2-frontend ./frontend
#
# Run directly (without compose):
#   docker run -d --name frontend --restart unless-stopped \
#     -p 3000:3000 --env-file ./frontend/.env.local \
#     backend-v2-frontend
#
# See docs/deploy.md §A1 for the full deploy flow.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env must be present for any values inlined into the
# client bundle (e.g. NEXT_PUBLIC_*). Keep them in frontend/.env.local
# or pass via `docker build --build-arg` + ARG declarations here.
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# Minimal runtime: just the standalone server + static files. No
# node_modules because Next.js already inlined the dependencies it
# actually uses at build time.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

# server.js is the standalone server Next.js emits. It reads
# HOSTNAME / PORT from env and listens accordingly.
CMD ["node", "server.js"]
