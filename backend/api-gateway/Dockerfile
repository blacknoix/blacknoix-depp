# Multi-stage production image for api-gateway.
# Build context MUST be backend/api-gateway:
#   docker build -t depp-api-gateway:local -f backend/api-gateway/Dockerfile backend/api-gateway
#
# This Dockerfile is source packaging only (ADR-0013). It does not by itself
# prove local image verification, registry publication, scan/SBOM/provenance,
# database readiness, staging, Kubernetes, or IdP outcomes.

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
