ARG VARIANT=22-bookworm
FROM mcr.microsoft.com/devcontainers/typescript-node:${VARIANT}

ARG PNPM_VERSION=11.22.0
ARG OPENCODE_VERSION=1.18.18
RUN su node -c "umask 0002 && npm install --global pnpm@${PNPM_VERSION} opencode-ai@${OPENCODE_VERSION}" \
    && npm cache clean --force > /dev/null 2>&1
