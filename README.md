# Unraid MCP

A local [Model Context Protocol](https://modelcontextprotocol.io/) server that lets AI clients inspect and manage an Unraid server through Unraid's official GraphQL API.

> **AI-assisted development disclosure:** This project was designed, researched, implemented, documented, and tested with substantial assistance from AI coding agents. It is not an official Unraid project. Review the source, permissions, and security settings yourself before granting it access to an Unraid server, especially before enabling mutation tools.

The MCP is read-only by default. Mutating tools are omitted entirely until explicitly enabled through environment variables, and permanent, credential, security, and other high-risk actions use a second gate plus an explicit per-call confirmation.

## Requirements

- Node.js 22 or later
- pnpm 11
- Unraid 7.2 or later, where the API is built into the OS
- An Unraid API key

Unraid 7.0-7.1 can expose API v4 through the Unraid Connect plugin, but Unraid documents that combination as limited support. The stable monitoring tools use version-aware fixed-document fallbacks for older API v4 releases. The complete extended tool catalog targets API v4.37.1 and rejects calls clearly when the server cannot confirm that version.

## Unraid Setup

1. Open **Settings > Management Access > API Keys** in the Unraid WebGUI.
2. Create a key for this MCP.
3. Start with the `VIEWER` role for read-only access.
4. Store the generated key in `UNRAID_API_KEY`; never put it in source control or command-line arguments.

The equivalent Unraid terminal command is:

```bash
unraid-api apikey --create --name "Unraid MCP read only" --roles VIEWER --json
```

For mutation access, prefer fine-grained permissions over `ADMIN`. Select only the resources used by the tools you plan to enable, such as `ARRAY`, `DOCKER`, `VMS`, and `NOTIFICATIONS`, with `READ_ANY`, `UPDATE_ANY`, and only where needed `DELETE_ANY`.

The GraphQL Sandbox is not required for this MCP. Leave it disabled outside development because enabling it also enables schema introspection.

## Install

```bash
pnpm install --frozen-lockfile
pnpm build
```

Dependencies are exact-version pinned and installs are lockfile-frozen. pnpm also rejects releases published less than seven days ago (including packages with missing publish times), verifies package/store integrity, blocks undeclared lifecycle scripts, and refuses package trust downgrades. The version-specific trust exception for `undici-types@6.21.0` is required by the pinned `@types/node`; age, integrity, and lockfile checks still apply to it. To intentionally update a dependency after reviewing it and waiting through the quarantine period, use an exact version and explicitly permit the lockfile change:

```bash
pnpm update --exact --no-frozen-lockfile package-name@x.y.z
pnpm verify
pnpm audit
```

Review both `package.json` and `pnpm-lock.yaml` before accepting the update. Do not add automated dependency-update jobs without preserving these controls.

Set configuration in the environment that launches the MCP:

```bash
export UNRAID_URL="https://tower.local"
export UNRAID_API_KEY="your-api-key"
node /absolute/path/to/unraid-mcp/dist/index.js
```

`UNRAID_URL` may be the WebGUI origin, in which case `/graphql` is added, or the exact GraphQL endpoint. Configure the final HTTPS URL directly; redirects are rejected so the API key cannot be forwarded to another origin.

## Container Image

Versioned release images are published to [Docker Hub](https://hub.docker.com/r/lemanjo/unraid-mcp) for `linux/amd64` and `linux/arm64`. Pin a version or image digest for deployments rather than relying on the mutable `latest` tag:

```bash
docker pull lemanjo/unraid-mcp:0.2.0
```

Every direct push or merged pull request to `main` publishes an unreleased development image as `lemanjo/unraid-mcp:nightly` after the container smoke test and vulnerability scan pass. The same image also receives an immutable `sha-<full-commit-sha>` tag. Pull requests are built and scanned but are not published before merge. Use a versioned release for production; the `nightly` tag moves whenever `main` is updated.

The final image uses a digest-pinned Distroless Node.js runtime. It runs without a shell, package manager, npm, or other build tooling and as a numeric non-root user. Container builds are scanned with Trivy and fail before registry login when a fixable critical or high vulnerability is present.

Build the production image on your Unraid server or another Docker host:

```bash
docker build --tag unraid-mcp:0.2.0 .
```

### Local stdio container

The default transport is stdio. `--env NAME` forwards values from the launching environment without putting secrets in the image or command arguments:

```bash
export UNRAID_URL="https://tower.local"
export UNRAID_API_KEY="your-api-key"

docker run --rm -i \
  --env UNRAID_URL \
  --env UNRAID_API_KEY \
  unraid-mcp:0.2.0
```

Forward any optional configuration the same way, for example `--env UNRAID_ALLOW_MUTATIONS`. For a custom CA file, mount it read-only and configure its container path:

```bash
docker run --rm -i \
  --env UNRAID_URL \
  --env UNRAID_API_KEY \
  --env UNRAID_CA_CERT_PATH=/certs/unraid-ca.pem \
  --volume /host/path/unraid-ca.pem:/certs/unraid-ca.pem:ro \
  unraid-mcp:0.2.0
```

In stdio mode the image does not listen on a port. The AI host launches it with `docker run --rm -i` and owns its lifetime.

### Mapped appdata files

The MCP can list and read UTF-8 configuration files from explicitly named bind mounts. Map only the narrow application directory needed, read-only by default. Build the current source as `unraid-mcp:local`; the JSON values in `MCP_FILE_ROOTS` are paths inside the MCP container:

```bash
docker build --tag unraid-mcp:local .
export MCP_FILE_ROOTS='{"plex":"/mnt/appdata/plex"}'

docker run --rm -i \
  --env UNRAID_URL \
  --env UNRAID_API_KEY \
  --env MCP_FILE_ROOTS \
  --mount type=bind,src=/mnt/user/appdata/plex,dst=/mnt/appdata/plex,readonly \
  unraid-mcp:local
```

This registers root discovery, non-recursive directory listing, and bounded text-file reading tools. The model sees only the `plex` alias and relative paths, never the host or container root path. Absolute paths, traversal, symbolic links, special files, invalid UTF-8, and files over `MCP_MAX_FILE_BYTES` are rejected.

To allow overwriting existing files, the alias must also be in `MCP_WRITABLE_FILE_ROOTS`, the separate write gate must be enabled, and the bind mount must be read-write:

```bash
export MCP_FILE_ROOTS='{"plex":"/mnt/appdata/plex"}'
export MCP_ALLOW_FILE_WRITES=true
export MCP_WRITABLE_FILE_ROOTS=plex

docker run --rm -i \
  --user "$(stat -c '%u:%g' /mnt/user/appdata/plex)" \
  --env UNRAID_URL \
  --env UNRAID_API_KEY \
  --env MCP_FILE_ROOTS \
  --env MCP_ALLOW_FILE_WRITES \
  --env MCP_WRITABLE_FILE_ROOTS \
  --mount type=bind,src=/mnt/user/appdata/plex,dst=/mnt/appdata/plex \
  unraid-mcp:local
```

The default image user is numeric UID/GID `65532:65532`; `PUID` and `PGID` variables do not change it. Use `--user`, `--group-add`, or host ACLs to grant only the required access. Do not use `--privileged` or root as a permissions workaround.

Writes are deliberately overwrite-only: the MCP cannot create, delete, rename, or make directories. A write requires the current SHA-256, normally obtained from a prior read, and a confirmation bound to the alias, relative path, and revision. Symlinks, hard-linked files, overlapping roots, and kernel/device pseudo-filesystems are rejected. Writes use the securely opened existing file descriptor, preserving its inode, ownership, and ordinary permission bits; the kernel may clear special mode bits or file capabilities. They are not atomic against crashes or external writers, a failed write can leave partial content, and the SHA-256 is only best-effort optimistic concurrency against non-cooperating processes. Cancellation is honored before mutation starts but not after bytes begin changing.

### Always-on remote HTTP container

Use authenticated Streamable HTTP when the container runs on a different machine from the AI client. Generate a persistent MCP token on a trusted machine:

```bash
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export UNRAID_URL="https://tower.local"
export UNRAID_API_KEY="your-unraid-api-key"
export MCP_ALLOWED_HOSTS="mcp-server.example,192.168.1.20"
```

Start the remote container:

```bash
docker network create unraid-mcp-backend

docker run -d \
  --name unraid-mcp \
  --restart unless-stopped \
  --network unraid-mcp-backend \
  --env MCP_TRANSPORT=http \
  --env MCP_HOST=0.0.0.0 \
  --env MCP_PORT=3000 \
  --env MCP_ALLOWED_HOSTS \
  --env MCP_AUTH_TOKEN \
  --env UNRAID_URL \
  --env UNRAID_API_KEY \
  unraid-mcp:0.2.0
```

`MCP_ALLOWED_HOSTS` is mandatory when binding an IPv4 or IPv6 wildcard address. List every hostname or IP address clients or a reverse proxy will place in the HTTP `Host` header. Entries do not include ports, and IPv6 entries use brackets. Localhost values are always included for health checks.

If `MCP_AUTH_TOKEN` is omitted, the server generates a cryptographically random 256-bit token and prints it once during startup:

```bash
docker logs unraid-mcp
```

Look for `Generated MCP auth token:`. Anyone who can read that log can access the MCP, and a new token is generated after every process restart when the variable remains unset. Set `MCP_AUTH_TOKEN` explicitly for stable production deployments. The MCP token is separate from `UNRAID_API_KEY`; remote AI clients need only the MCP token.

The HTTP listener is intentionally plain HTTP. The example does not publish its port; join a Caddy, Nginx, or Traefik container to `unraid-mcp-backend` and proxy to `http://unraid-mcp:3000`. For a host-installed proxy, Docker 28 or newer can publish `127.0.0.1:3000:3000`; older Docker versions, including some Unraid releases, may expose localhost-published ports to the same layer-2 network, so use the private network or an explicit firewall rule instead. Do not expose port `3000` directly to the internet. The container health check calls `GET /health`; MCP traffic uses `/mcp`.

The built-in authentication throttle identifies the immediate TCP peer. Behind a reverse proxy, configure authentication rate limiting at the proxy as well because all proxied clients may share one peer address. Do not forward an untrusted `Host` value; either preserve the external hostname and include it in `MCP_ALLOWED_HOSTS`, or rewrite it to a fixed allowlisted hostname.

### Local Docker client configuration

An OpenCode configuration that launches the image through a Docker daemon is:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "unraid": {
      "type": "local",
      "command": [
        "docker",
        "run",
        "--rm",
        "-i",
        "--env",
        "UNRAID_URL",
        "--env",
        "UNRAID_API_KEY",
        "unraid-mcp:0.2.0"
      ],
      "enabled": true,
      "environment": {
        "UNRAID_URL": "{env:UNRAID_URL}",
        "UNRAID_API_KEY": "{env:UNRAID_API_KEY}"
      }
    }
  }
}
```

The Docker daemon used by the AI host must have access to the image. Restart OpenCode after changing its configuration.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `UNRAID_URL` | Yes | | WebGUI origin or exact GraphQL endpoint |
| `UNRAID_API_KEY` | Yes | | Value sent only in the `x-api-key` request header |
| `UNRAID_CA_CERT` | No | | PEM CA certificate supplied inline; escaped `\n` is accepted |
| `UNRAID_CA_CERT_PATH` | No | | Absolute path to a PEM CA certificate or bundle |
| `UNRAID_TLS_SKIP_VERIFY` | No | `false` | Disable TLS identity verification for this Unraid client only |
| `UNRAID_ALLOW_MUTATIONS` | No | `false` | Register routine lifecycle, notification, and v4.37.1 mutation tools |
| `UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS` | No | `false` | Register destructive, credential, security, and other sensitive mutation tools; requires `UNRAID_ALLOW_MUTATIONS=true` |
| `UNRAID_REQUEST_TIMEOUT_MS` | No | `15000` | Absolute per-request timeout, from 100 to 120000 ms |
| `UNRAID_MAX_RESPONSE_BYTES` | No | `5242880` | Maximum GraphQL response, from 1 KiB to 50 MiB |
| `MCP_FILE_ROOTS` | No | None | JSON object mapping short aliases to absolute container-mounted directories; enables mapped-file read tools |
| `MCP_ALLOW_FILE_WRITES` | No | `false` | Register mapped-file overwrite support; requires `MCP_WRITABLE_FILE_ROOTS` |
| `MCP_WRITABLE_FILE_ROOTS` | Conditional | None | Comma-separated aliases from `MCP_FILE_ROOTS` that may be overwritten |
| `MCP_MAX_FILE_BYTES` | No | `262144` | Maximum mapped text-file read or write, from 1 KiB to 1 MiB |
| `MCP_MAX_DIRECTORY_ENTRIES` | No | `500` | Maximum mapped directory entries per request, from 1 to 5000 |
| `MCP_TRANSPORT` | No | `stdio` | MCP transport: `stdio` or `http` |
| `MCP_HOST` | No | `127.0.0.1` | HTTP bind hostname; containers normally use `0.0.0.0` |
| `MCP_PORT` | No | `3000` | HTTP listening port |
| `MCP_AUTH_TOKEN` | No | Generated | HTTP bearer token, at least 32 bytes; generated and logged when absent |
| `MCP_ALLOWED_HOSTS` | Conditional | Localhost | Comma-separated HTTP Host allowlist; required for wildcard binds |
| `MCP_ALLOWED_ORIGINS` | No | None | Comma-separated browser Origin hostname allowlist |
| `MCP_AUTH_FAILURE_LIMIT` | No | `10` | Failed bearer attempts allowed per client and rate-limit window |
| `MCP_AUTH_FAILURE_WINDOW_MS` | No | `60000` | Authentication failure window |
| `MCP_MAX_REQUEST_BYTES` | No | `1048576` | Maximum HTTP MCP request body, up to 4 MiB |
| `MCP_HTTP_REQUEST_TIMEOUT_MS` | No | `30000` | HTTP request timeout, from 1 to 120 seconds |

Use either `UNRAID_CA_CERT` or `UNRAID_CA_CERT_PATH`, not both. Prefer trusting Unraid's certificate or local CA. `UNRAID_TLS_SKIP_VERIFY=true` is an explicit last resort and prints a warning; it does not change TLS behavior globally for other Node.js connections.

Plain HTTP is supported for isolated legacy networks but prints a warning because the API key and all server data travel without encryption.

## AI Client Setup

### OpenCode

Export the environment variables before starting OpenCode, then add this local MCP to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "unraid": {
      "type": "local",
      "command": ["node", "/absolute/path/to/unraid-mcp/dist/index.js"],
      "enabled": true,
      "environment": {
        "UNRAID_URL": "{env:UNRAID_URL}",
        "UNRAID_API_KEY": "{env:UNRAID_API_KEY}",
        "UNRAID_CA_CERT_PATH": "{env:UNRAID_CA_CERT_PATH}",
        "UNRAID_ALLOW_MUTATIONS": "{env:UNRAID_ALLOW_MUTATIONS}",
        "UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS": "{env:UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS}"
      }
    }
  }
}
```

Remove optional environment entries that are unset. Restart OpenCode after changing its configuration.

To connect to an always-on HTTP container, export its MCP token on the OpenCode machine and configure a remote server:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "unraid": {
      "type": "remote",
      "url": "https://mcp-server.example/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

Use the HTTPS reverse-proxy URL, not the Unraid GraphQL URL. OpenCode sends `MCP_AUTH_TOKEN` to the MCP; only the MCP container sends `UNRAID_API_KEY` to Unraid.

### Claude Code

Export `UNRAID_URL` and `UNRAID_API_KEY` before starting Claude Code. For project scope, create `.mcp.json` in the project where you use Claude Code:

```json
{
  "mcpServers": {
    "unraid": {
      "command": "node",
      "args": ["/absolute/path/to/unraid-mcp/dist/index.js"],
      "env": {
        "UNRAID_URL": "${UNRAID_URL}",
        "UNRAID_API_KEY": "${UNRAID_API_KEY}"
      }
    }
  }
}
```

Claude Code expands the `${VAR}` references from its environment. The configuration can therefore be shared without storing the API key. Add optional variables to `env` only when they are set, for example `"UNRAID_ALLOW_MUTATIONS": "${UNRAID_ALLOW_MUTATIONS}"`.

To launch the container image instead, use:

```json
{
  "mcpServers": {
    "unraid": {
      "command": "docker",
      "args": [
        "run",
        "--rm",
        "-i",
        "--env",
        "UNRAID_URL",
        "--env",
        "UNRAID_API_KEY",
        "unraid-mcp:0.2.0"
      ],
      "env": {
        "UNRAID_URL": "${UNRAID_URL}",
        "UNRAID_API_KEY": "${UNRAID_API_KEY}"
      }
    }
  }
}
```

Run `claude mcp list` to verify the server, then use `/mcp` inside Claude Code to inspect its status and tools. Claude Code asks for approval before using a project-scoped `.mcp.json` server. Use `--scope user` with Claude Code's MCP commands if you prefer private cross-project configuration in `~/.claude.json`.

For an always-on HTTP container, use this `.mcp.json` entry instead:

```json
{
  "mcpServers": {
    "unraid": {
      "type": "http",
      "url": "https://mcp-server.example/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_AUTH_TOKEN}"
      }
    }
  }
}
```

Export `MCP_AUTH_TOKEN` before starting Claude Code. The `${MCP_AUTH_TOKEN}` reference is expanded without storing its value in the project configuration.

### Codex CLI and IDE

Codex CLI, the Codex IDE extension, and the ChatGPT desktop app share MCP configuration. Export the required variables, then add this entry to `~/.codex/config.toml`, or to `.codex/config.toml` in a trusted project:

```toml
[mcp_servers.unraid]
command = "node"
args = ["/absolute/path/to/unraid-mcp/dist/index.js"]
env_vars = ["UNRAID_URL", "UNRAID_API_KEY"]
startup_timeout_sec = 10
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

`env_vars` forwards values from Codex's environment without writing them into `config.toml`. Add any enabled optional settings to that list, such as `UNRAID_CA_CERT_PATH` or `UNRAID_ALLOW_MUTATIONS`.

To launch the container image instead, use:

```toml
[mcp_servers.unraid]
command = "docker"
args = [
  "run",
  "--rm",
  "-i",
  "--env",
  "UNRAID_URL",
  "--env",
  "UNRAID_API_KEY",
  "unraid-mcp:0.2.0",
]
env_vars = ["UNRAID_URL", "UNRAID_API_KEY"]
startup_timeout_sec = 10
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

The `writes` approval mode prompts for tools that are not marked read-only. Run `codex mcp list` to verify the server, and use `/mcp` in the Codex TUI to inspect connected tools. Restart the IDE extension or ChatGPT desktop app after editing the shared configuration.

For an always-on HTTP container, use this entry instead:

```toml
[mcp_servers.unraid]
url = "https://mcp-server.example/mcp"
bearer_token_env_var = "MCP_AUTH_TOKEN"
startup_timeout_sec = 10
tool_timeout_sec = 120
default_tools_approval_mode = "writes"
```

Codex reads the bearer token from its local environment and does not store the value in `config.toml`.

### Claude Desktop and other stdio hosts

Configure the host to launch:

```text
node /absolute/path/to/unraid-mcp/dist/index.js
```

Have the host process inherit the required environment variables from the OS, a service manager, or its secret manager. Do not place the API key in the `args` array. If a host supports per-server environment values but not secret references, understand that those values are stored in that host's configuration file.

### MCP Inspector

With the variables exported, inspect and call tools interactively:

```bash
pnpm dlx @modelcontextprotocol/inspector node dist/index.js
```

The Inspector is intentionally not a project dependency; invoke the version approved for your environment.

## Tools

The GraphQL tool surface has two layers:

- Twelve stable tools preserve concise names and select fixed compatibility documents according to the discovered API version.
- The complete v4.37.1 catalog uses `unraid_v4371_*` names. It covers all 58 root query fields through 61 fixed query documents, all 84 effective mutation fields through 86 fixed mutation documents, and all 17 subscriptions. Array state and parity correction use separate documents so safer branches do not inherit destructive permissions.

The MCP does not accept arbitrary GraphQL. Extended tools are generated from a reviewed in-repository catalog with a separate strict Zod input schema for every document. Their calls first require a confirmed API v4.37.1 or newer; listing a latest tool does not imply an older connected server supports it.

Mapped-file tools form a separate, optional surface and are omitted unless `MCP_FILE_ROOTS` is configured.

The following stable read tools are always registered:

| Tool | Capability |
| --- | --- |
| `unraid_get_system_info` | OS, API, hardware, memory, and network inventory |
| `unraid_get_metrics` | CPU, memory, swap, network, and temperature metrics |
| `unraid_get_array` | Array, capacity, disks, and current parity state |
| `unraid_list_disks` | Physical and assignable disks, SMART summary, and partitions |
| `unraid_list_shares` | Share capacity and allocation metadata |
| `unraid_list_docker_containers` | Container state, images, ports, and conflicts |
| `unraid_get_docker_logs` | Bounded, cursor-based container logs |
| `unraid_list_vms` | VM names and lifecycle states |
| `unraid_get_ups` | UPS battery, power, status, and configuration |
| `unraid_list_notifications` | Unread/archive lists, counts, warnings, and alerts |
| `unraid_list_system_logs` | Available system log files |
| `unraid_read_system_log` | Bounded system log content |

`UNRAID_ALLOW_MUTATIONS=true` adds:

| Tool | Capability |
| --- | --- |
| `unraid_control_array` | Start or stop the array |
| `unraid_control_parity_check` | Start, pause, resume, or cancel parity checks |
| `unraid_control_docker_container` | Start, stop, pause, unpause, or update a container |
| `unraid_control_vm` | Start, stop, pause, resume, or reboot a VM |
| `unraid_manage_notifications` | Archive or unarchive notifications |

`UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS=true` additionally adds:

| Tool | Capability |
| --- | --- |
| `unraid_remove_docker_container` | Remove a container and optionally its image |
| `unraid_force_vm` | Force-stop or reset a VM |

It also allows the high-risk branches of stable tools. They require these exact confirmations:

| Operation | Required argument |
| --- | --- |
| Stop the array | `confirmation=STOP_ARRAY` |
| Start a correcting parity check | `confirmation=WRITE_PARITY_CORRECTIONS` |
| Cancel a parity check | `confirmation=CANCEL_PARITY_CHECK` |
| Update a Docker container image | `confirmation=UPDATE_DOCKER_CONTAINER` |
| Remove a Docker container | `confirmation=REMOVE_DOCKER_CONTAINER` |
| Force-stop or reset a VM | `confirmation=FORCE_VM_ACTION` |

### Complete v4.37.1 catalog

Safe latest query tools and one-event subscription tools are read-only and registered by default. Queries that accept an OIDC token or provider-defined RClone parameters use the sensitive gate. Routine latest mutations are added by `UNRAID_ALLOW_MUTATIONS=true`. Latest operations classified as destructive or sensitive require both mutation gates and a `confirmation` argument equal to the exact tool name, for example:

```json
{
  "confirmation": "unraid_v4371_delete_archived_notifications"
}
```

Representative latest tools include `unraid_v4371_query_parity_history`, `unraid_v4371_restart_docker_container`, `unraid_v4371_query_docker_tailscale_status`, `unraid_v4371_configure_ups`, `unraid_v4371_create_api_key`, and `unraid_v4371_setup_remote_access`. Use the MCP client's tool listing for the full typed set; the source catalog is [`src/api-v4.ts`](src/api-v4.ts).

Subscription tools use `unraid_v4371_next_*` names. Each opens an authenticated `graphql-transport-ws` connection to the configured GraphQL endpoint, waits for one event, returns that bounded payload, and disconnects. This makes subscription-only Docker container statistics available without leaving an unbounded background stream. The wait uses `UNRAID_REQUEST_TIMEOUT_MS`, and `https:` endpoints become `wss:` while preserving custom CA and TLS-verification settings.

### Mapped-file tools

With `MCP_FILE_ROOTS` configured:

| Tool | Capability |
| --- | --- |
| `unraid_list_mapped_file_roots` | List configured aliases, limits, and writable status without exposing absolute paths |
| `unraid_list_mapped_files` | List one bounded, non-recursive directory without following symlinks |
| `unraid_read_mapped_file` | Read one bounded UTF-8 regular file and return its SHA-256 revision |

With `MCP_ALLOW_FILE_WRITES=true` and `MCP_WRITABLE_FILE_ROOTS` configured:

| Tool | Capability |
| --- | --- |
| `unraid_overwrite_mapped_file` | Overwrite an existing text file after revision and bound-confirmation checks |

Mapped file content is untrusted and can contain prompt-injection text. The environment settings, Docker mount mode, Unix permissions, and MCP client approval are the actual controls; the deterministic confirmation argument is an intent check, not human authorization. The administrator controls the mounted directory: this feature does not defend against a malicious host that rearranges mounts while an operation is running.

MCP annotations are hints to clients, not access controls. The environment gates and the Unraid API key's own permissions are the actual controls.

## API Limitations

The current official schema does not provide every WebGUI action. In particular:

- Shares are read-only; share create/edit is not available.
- Docker containers can be controlled, updated, and removed, but not created or edited.
- VMs can be controlled, but not created, edited, cloned, snapshotted, or deleted.
- Host shutdown/reboot mutations are not published.
- Full SMART reports and SMART self-test controls are not published.
- Parity mutation response types are marked work-in-progress by Unraid.

The v4.37.1 schema also contains secret-bearing and provider-defined JSON fields. Read tools use explicit safe projections rather than returning stored API keys, Connect keys, OIDC client secrets, activation data, CSRF/LUKS values, embedded images, or Tailscale authentication URLs. The explicitly confirmed API-key creation mutation returns its newly generated key because that one-time value is required to use the feature. Five inputs remain JSON because the official schema itself defines no narrower type; those operations are sensitive-gated.

See [docs/api-capabilities.md](docs/api-capabilities.md) for the official source references and compatibility details.

## Development

```bash
pnpm typecheck
pnpm test
pnpm build
# Or run all three:
pnpm verify
```

Tests use local mock HTTP and WebSocket servers plus in-memory and Streamable HTTP MCP clients. They do not require Docker or a live Unraid server.

### Container releases

GitHub Actions builds and vulnerability-scans the container for pull requests without using registry credentials. Successful pushes to `main` access `DOCKERHUB_TOKEN` through a separate `dockerhub-nightly` environment and publish `nightly` plus immutable commit tags. Configure that environment to allow only `main` and omit required reviewers so publishing remains automatic. Semantic-versioned GitHub Releases use the reviewer-protected `dockerhub` environment and publish version, commit, and (for stable releases) `latest` tags. Both publishing paths include SBOM and provenance attestations.

## Security Notes

- Stdio remains the default and does not open a listening network port.
- HTTP mode requires bearer authentication. Missing tokens are generated with 256 bits of cryptographic randomness and deliberately written to startup logs.
- Generated tokens are operational secrets: restrict log access and configure `MCP_AUTH_TOKEN` for a stable deployment.
- HTTP mode validates Host and Origin headers, rate-limits failed authentication, caps request bodies, and defaults to a loopback bind.
- The built-in HTTP listener does not provide TLS. Use an HTTPS reverse proxy and do not expose it directly to the internet.
- It prefixes application stderr logs with ISO-8601 UTC timestamps and never writes them to stdout, which is reserved for MCP JSON-RPC.
- It does not accept arbitrary GraphQL documents from the model.
- It does not accept arbitrary host paths. Optional file access is confined to explicitly mounted aliases and rejects traversal and symlinks.
- Mapped roots should be narrow and read-only. One remote MCP bearer token grants every file capability registered by that server.
- Mapped-file overwrites require a writable alias, matching SHA-256 revision, bound confirmation, writable mount, and Unix permission.
- It does not follow redirects and bounds response size, log line counts, and request duration.
- GraphQL subscriptions return one bounded event and close rather than creating model-controlled persistent streams.
- Client cancellation aborts the local HTTP request; mutations already accepted by Unraid cannot be rolled back.
- GraphQL errors from HTTP success, HTTP failure, and WebSocket responses are bounded and redact the configured API key.
- Disk serial numbers, logs, notifications, network addresses, and other server data are visible to the connected AI client. Review that client's data-handling policy.

## Official References

- [Unraid API overview](https://docs.unraid.net/API/)
- [How to use the Unraid API](https://docs.unraid.net/API/how-to-use-the-api/)
- [Programmatic API key management](https://docs.unraid.net/API/programmatic-api-key-management/)
- [Unraid API roadmap and version support](https://docs.unraid.net/API/upcoming-features/)
- [API v4.37.1 generated GraphQL schema](https://github.com/unraid/api/blob/v4.37.1/api/generated-schema.graphql)
- [Unraid connection security guidance](https://docs.unraid.net/unraid-os/system-administration/secure-your-server/securing-your-connection/)
- [MCP TypeScript SDK stdio guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html)
- [MCP TypeScript SDK Streamable HTTP guidance](https://ts.sdk.modelcontextprotocol.io/v2/serving/http.html)
- [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp)
- [Codex MCP configuration](https://developers.openai.com/codex/mcp/)

## License

This project is licensed under the [MIT License](LICENSE).
