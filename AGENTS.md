# Development Environment

- Use `.devcontainer/devcontainer.json` for development; it builds a Node 22 Debian Bookworm image with pnpm 11.22.0, OpenCode 1.18.18, and GitHub CLI, then connects as the non-root `node` user.
- Docker access is intentionally unavailable inside the devcontainer: do not assume the Docker CLI or host socket is present.
- No application manifest or executable workflows exist yet; do not infer build, lint, test, or runtime commands.
