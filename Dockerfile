FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS build

ARG PNPM_VERSION=11.22.0

WORKDIR /app

RUN corepack enable \
    && corepack prepare "pnpm@${PNPM_VERSION}" --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN pnpm build \
    && pnpm prune --prod

FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167 AS runtime

LABEL org.opencontainers.image.title="Unraid MCP" \
      org.opencontainers.image.description="Model Context Protocol server for the official Unraid GraphQL API" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000

WORKDIR /app

COPY --from=build --chown=65532:65532 /app/package.json ./package.json
COPY --from=build --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=build --chown=65532:65532 /app/dist ./dist

USER 65532:65532

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "if ((process.env.MCP_TRANSPORT || 'stdio') !== 'http') process.exit(0); const { SocketAddress } = require('node:net'); let raw = process.env.MCP_HOST || '127.0.0.1'; if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1); let host = raw; if (raw === '0.0.0.0') host = '127.0.0.1'; else if (raw.includes(':')) { const normalized = new SocketAddress({ address: raw, family: 'ipv6' }).address; host = normalized === '::' ? '::1' : normalized === '::ffff:0.0.0.0' ? '127.0.0.1' : normalized; } const authority = host.includes(':') ? '[' + host + ']' : host; fetch('http://' + authority + ':' + (process.env.MCP_PORT || '3000') + '/health').then(async (response) => { await response.body?.cancel(); if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

STOPSIGNAL SIGTERM

ENTRYPOINT ["/nodejs/bin/node", "/app/dist/index.js"]
