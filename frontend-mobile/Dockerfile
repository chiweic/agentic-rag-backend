# Multi-stage Dockerfile for the mobile-web frontend (m.changpt.org).
#
# Same shape as frontend/Dockerfile — see that file for the layer rationale
# (deps cache, builder produces .next/standalone, runner ships only the
# standalone server + static assets, no node_modules in the final layer).
#
# Build:
#   docker build -t backend-v2-frontend-mobile ./frontend-mobile
#
# Run via docker-compose.yml in this directory.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
