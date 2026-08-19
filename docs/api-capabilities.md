# Unraid API Capability Reference

This MCP uses Unraid's official GraphQL API at the WebGUI origin's `/graphql` endpoint. The implementation targets API v4.35.1 as its schema baseline and sends API keys in the officially documented `x-api-key` header.

## Version and Discovery

Unraid documents the API as built into Unraid 7.2 and later. Older supported releases can obtain API v4 from the Unraid Connect plugin, but feature availability varies. The API version is discoverable through:

```graphql
query {
  info {
    versions {
      core { unraid api kernel }
    }
  }
}
```

The GraphQL Sandbox and introspection can be enabled for development from **Settings > Management Access > Developer Options** or with:

```bash
unraid-api developer --sandbox true
```

They are not required for this MCP and should be disabled during normal use.

Sources:

- [API availability and setup](https://docs.unraid.net/API/)
- [Using the API and Sandbox](https://docs.unraid.net/API/how-to-use-the-api/)
- [Version support](https://docs.unraid.net/API/upcoming-features/)
- [Versioned API v4.35.1 schema](https://github.com/unraid/api/blob/v4.35.1/api/generated-schema.graphql)

## Authentication and Permissions

Unraid supports API keys, WebGUI cookies, and OIDC/SSO. API keys are the appropriate method for a local MCP process. This implementation uses only:

```http
x-api-key: <UNRAID_API_KEY>
```

The main API usage guide and Unraid's implementation identify `x-api-key` as the API-key header. One example in the programmatic key guide uses a Bearer header; this MCP follows the primary guide and implementation rather than that inconsistent example.

Roles include `ADMIN`, `VIEWER`, `CONNECT`, and `GUEST`. Fine-grained keys use a resource such as `DOCKER`, action such as `READ_ANY`, and can avoid broad `ADMIN` access. The official schema declares these relevant resources:

```text
ARRAY DISK DOCKER INFO LOGS NOTIFICATIONS OS SHARE VARS VMS
```

Sources:

- [API authentication](https://docs.unraid.net/API/how-to-use-the-api/#authentication)
- [Programmatic key management](https://docs.unraid.net/API/programmatic-api-key-management/)
- [Official API source](https://github.com/unraid/api)

## Implemented Surface

| Area | Official API capability used by this MCP | Schema limitations |
| --- | --- | --- |
| System | OS, CPU, memory layout, hardware, versions, and network interfaces | No published host shutdown/reboot mutation |
| Metrics | CPU/core load, memory/swap, network counters/rates, and temperature sensors | Individual metric groups can be null |
| Array | State, capacity, boot/parity/data/cache disks, current parity status, start/stop | Disk assignment mutations exist but are intentionally not exposed because of data-loss risk |
| Parity | Start, pause, resume, and cancel | Marked WIP by Unraid; correcting mode can write data |
| Disks | Identity, serial, interface, SMART summary, temperature, partitions, spin state | No complete SMART attribute report or self-test mutation |
| Shares | Capacity, include/exclude, cache, allocator, split level, COW, LUKS status | Read-only in the current schema |
| Docker | List/status, ports, logs, start/stop/pause/unpause/update/remove | No create/edit; `restart` is newer than the compatibility baseline |
| VMs | List/state, start/stop/pause/resume/reboot/force-stop/reset | No create/edit/delete/snapshot/clone |
| UPS | Status, battery, runtime, health, voltage, load, power, and configuration | The current implementation commonly represents one physical UPS despite returning a list |
| Notifications | Counts, filtered lists, warnings/alerts, archive/unarchive | Deletion and notification creation are intentionally not exposed |
| Logs | List and read system logs; timestamped Docker logs with cursor | Docker log requests are capped by Unraid at 2,000 lines in API v4.35.1 |

The fixed operation documents are in [`src/queries.ts`](../src/queries.ts). They intentionally avoid arbitrary GraphQL execution so an AI client cannot bypass the advertised tool surface.

## Available but Intentionally Omitted

The schema contains additional mutations for API-key administration, server identity and SSH settings, array disk assignment/mounting, UPS configuration, Docker autostart organization, RClone remotes, onboarding, plugins, remote access, and broad settings updates.

These are omitted because one or more of the following applies:

- The operation can cause data loss or lock out management access.
- The input is a broad untyped JSON settings object.
- The API marks the behavior as work-in-progress or feature-flagged.
- A safe AI-facing contract requires more state validation than the API currently exposes.
- It falls outside routine monitoring and lifecycle management.

Adding one should use a dedicated typed MCP tool, the narrowest Unraid API-key permission, explicit environment gating, state preconditions, bounded input, and tests. Do not add a generic GraphQL mutation tool.

## TLS and Network Security

Unraid recommends HTTPS. A self-signed server still encrypts traffic but requires the client to trust its certificate or issuing CA. Preferred options are:

1. A certificate already trusted by the host running the MCP.
2. A local CA supplied through `UNRAID_CA_CERT` or `UNRAID_CA_CERT_PATH`.
3. As a temporary last resort, scoped `UNRAID_TLS_SKIP_VERIFY=true`.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`; that disables verification globally for the Node process. Do not expose `/graphql` directly to the public internet. Configure the final HTTPS endpoint rather than relying on redirects.

Source: [Securing your connection to Unraid](https://docs.unraid.net/unraid-os/system-administration/secure-your-server/securing-your-connection/).

## Schema Compatibility

API fields can differ between the version bundled with Unraid OS and a newer API delivered by the Unraid Connect plugin. The server reports GraphQL validation failures as tool errors rather than hiding partial data.

The baseline deliberately excludes Docker `restart`, which appeared after API v4.35.1. If a target server lacks another selected field, use `unraid_get_system_info` to identify its API version and compare that version's generated schema in the [official Unraid API repository](https://github.com/unraid/api/tags).
