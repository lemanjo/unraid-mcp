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

FROM node:22.23.2-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS runtime

LABEL org.opencontainers.image.title="Unraid MCP" \
      org.opencontainers.image.description="Model Context Protocol server for the official Unraid GraphQL API" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production
ENV MCP_TRANSPORT=stdio
ENV MCP_PORT=3000

WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD if [ "$MCP_TRANSPORT" = "http" ]; then node -e "const { SocketAddress } = require('node:net'); let raw = process.env.MCP_HOST || '127.0.0.1'; if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1); let host = raw; if (raw === '0.0.0.0') host = '127.0.0.1'; else if (raw.includes(':')) { const normalized = new SocketAddress({ address: raw, family: 'ipv6' }).address; host = normalized === '::' ? '::1' : normalized === '::ffff:0.0.0.0' ? '127.0.0.1' : normalized; } const authority = host.includes(':') ? '[' + host + ']' : host; fetch('http://' + authority + ':' + (process.env.MCP_PORT || '3000') + '/health').then(async (response) => { await response.body?.cancel(); if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"; else exit 0; fi

STOPSIGNAL SIGTERM

ENTRYPOINT ["node", "/app/dist/index.js"]
