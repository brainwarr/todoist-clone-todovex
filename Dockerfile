# Multi-stage build for the Todovex Next.js frontend (standalone output).
#
# NEXT_PUBLIC_CONVEX_URL is inlined into the client bundle at BUILD time, so it
# must be passed as a build arg = the externally-reachable Convex backend URL
# (e.g. http://narishima.7811.net:30012). See scripts/build-todovex.sh.

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_CONVEX_URL
ENV NEXT_PUBLIC_CONVEX_URL=$NEXT_PUBLIC_CONVEX_URL
# Regenerate Convex codegen so `api`/`internal` include the vendored changes
# (users, agentApi, seed). Non-fatal: the deploy step also refreshes _generated.
RUN npx convex codegen || echo "convex codegen skipped"
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN addgroup -g 1001 nodejs && adduser -u 1001 -G nodejs -S nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
