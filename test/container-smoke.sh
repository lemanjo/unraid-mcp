#!/usr/bin/env bash
set -euo pipefail

image="${1:?container image is required}"
container_id="$(docker run --detach \
  --env MCP_ALLOWED_HOSTS=localhost \
  --env MCP_AUTH_TOKEN=ci-smoke-token-not-valid-outside-run \
  --env MCP_HOST=0.0.0.0 \
  --env MCP_TRANSPORT=http \
  --env UNRAID_API_KEY=ci-smoke-key \
  --env UNRAID_URL=https://example.invalid \
  --health-interval=1s \
  --health-retries=3 \
  --health-start-period=0s \
  --health-timeout=5s \
  "$image")"

cleanup() {
  docker rm --force "$container_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..20}; do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$container_id")"
  case "$status" in
    healthy)
      exit 0
      ;;
    unhealthy)
      break
      ;;
  esac
  sleep 1
done

docker logs "$container_id" >&2
exit 1
