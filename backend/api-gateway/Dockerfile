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

# CVE-2026-59873: remove the shipped npm package-manager tree.
#
# Trivy reports CRITICAL tar@7.5.11 at
# usr/local/lib/node_modules/npm/node_modules/tar/package.json — inside npm's
# bundled dependencies, not the application's /app/node_modules and not an OS
# package. Nothing at runtime uses npm: ENTRYPOINT is the inherited
# docker-entrypoint.sh (no package-manager references, ends in exec "$@"), CMD is
# ["node","dist/index.js"], and /app/dist contains no child_process usage.
#
# This REMOVES the vulnerable shipped tree. It does NOT upgrade tar to 7.5.19.
# Must run as root, so it precedes USER node. yarn is left in place: it is not
# implicated by this advisory and is out of scope for this change.
RUN set -eux; \
    rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack; \
    rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
