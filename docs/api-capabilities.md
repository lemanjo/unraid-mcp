# Unraid API Capability Reference

This MCP uses Unraid's official GraphQL API at the WebGUI origin's `/graphql` endpoint. Its complete typed catalog targets API v4.37.1, while its stable monitoring tools select fixed fallback documents for older API v4 releases. API keys use the officially documented `x-api-key` header and GraphQL WebSocket connection parameter.

## Version and Discovery

Unraid documents the API as built into Unraid 7.2 and later. Older supported releases can obtain API v4 from the Unraid Connect plugin, but feature availability varies. The primary version probe is:

```graphql
query McpApiCapabilities {
  services { name version }
}
```

The MCP selects the `unraid-api` service and caches its semantic version. Some keys cannot read `SERVICES`, so permission or schema failures trigger fixed `info.versions.core.api` and `settings.api.version` probes. Authentication, network, and unrelated runtime errors are not mistaken for compatibility failures. If no probe is permitted, stable tools optimistically try modern fixed documents and downgrade only for recognized schema-validation errors; latest `unraid_v4371_*` calls remain blocked because their minimum version cannot be confirmed.

The GraphQL Sandbox and introspection can be enabled for development from **Settings > Management Access > Developer Options** or with:

```bash
unraid-api developer --sandbox true
```

They are not required for this MCP and should be disabled during normal use.

Sources:

- [API availability and setup](https://docs.unraid.net/API/)
- [Using the API and Sandbox](https://docs.unraid.net/API/how-to-use-the-api/)
- [Version support](https://docs.unraid.net/API/upcoming-features/)
- [Versioned API v4.37.1 schema](https://github.com/unraid/api/blob/v4.37.1/api/generated-schema.graphql)

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
| Array | State, capacity, boot/parity/data/cache disks, current parity status, start/stop, disk assignment, mount/unmount, and statistics reset | Assignment and unmount operations are destructive-gated |
| Parity | Start, pause, resume, and cancel | Marked WIP by Unraid; correcting mode can write data |
| Disks | Identity, serial, interface, SMART summary, temperature, partitions, spin state | No complete SMART attribute report or self-test mutation |
| Shares | Capacity, include/exclude, cache, allocator, split level, COW, LUKS status | Read-only in the current schema |
| Docker | List/status, ports, logs, Tailscale status, organizer, autostart, start/stop/restart/pause/unpause/update/remove, and live statistics | No create/edit in the official schema |
| VMs | List/state, start/stop/pause/resume/reboot/force-stop/reset | No create/edit/delete/snapshot/clone |
| UPS | Status, battery, runtime, health, voltage, load, power, and configuration | The current implementation commonly represents one physical UPS despite returning a list |
| Notifications | Counts, filtered lists, warnings/alerts, create/delete/archive/unarchive, and event subscriptions | Deletion is destructive-gated |
| Logs | List and read system logs; timestamped Docker logs with cursor | Docker log requests are capped by Unraid at 2,000 lines in API v4.35.1 |
| Administration | API keys, settings, OIDC, SSH, identity, plugins, onboarding, RClone, Connect, remote access, system time, temperature, and UPS configuration | Credential/security operations are sensitive-gated and use safe result projections |

Compatibility documents are in [`src/queries.ts`](../src/queries.ts). The complete catalog is in [`src/api-v4.ts`](../src/api-v4.ts): 61 queries cover all 58 root query fields, 86 mutations cover all 84 effective mutation fields, and 17 fixed subscription documents cover every subscription field. All 164 documents validate against the tagged official schema. They intentionally avoid arbitrary GraphQL execution so an AI client cannot bypass the advertised tool surface.

## Safe Projection Exceptions

Every v4.37.1 root capability is represented, but exposing every raw output field would disclose credentials or unbounded provider data. Fixed read projections omit stored API keys, server API keys, registration key files, CSRF and LUKS values, OIDC client secrets, activation codes, embedded case images, Tailscale authentication URLs, and broad/unbounded JSON where narrower fields exist. API-key creation is the deliberate exception: its sensitive-gated, explicitly confirmed mutation returns the newly generated key once.

The official schema defines five provider inputs only as `JSON`:

- Unified settings updates.
- Docker organizer view preferences.
- Flash backup options.
- RClone remote parameters.
- RClone configuration-form parameters.

Their Zod schemas enforce JSON-serializability rather than inventing unsupported shapes, and their operations are sensitive-gated.

## TLS and Network Security

Unraid recommends HTTPS. A self-signed server still encrypts traffic but requires the client to trust its certificate or issuing CA. Preferred options are:

1. A certificate already trusted by the host running the MCP.
2. A local CA supplied through `UNRAID_CA_CERT` or `UNRAID_CA_CERT_PATH`.
3. As a temporary last resort, scoped `UNRAID_TLS_SKIP_VERIFY=true`.

Do not set `NODE_TLS_REJECT_UNAUTHORIZED=0`; that disables verification globally for the Node process. Do not expose `/graphql` directly to the public internet. Configure the final HTTPS endpoint rather than relying on redirects.

Source: [Securing your connection to Unraid](https://docs.unraid.net/unraid-os/system-administration/secure-your-server/securing-your-connection/).

## Schema Compatibility

API fields can differ between the version bundled with Unraid OS and a newer API delivered by the Unraid Connect plugin. Stable tools split optional fields into separate fixed documents so one unsupported field does not discard otherwise valid data.

| API version | Stable-tool behavior |
| --- | --- |
| v4.0-v4.14 | Legacy system-information projection when modern nested versions are unavailable |
| v4.15+ | Modern system-information projection |
| v4.30-v4.34 | Compatibility network fields, temperature metrics, complete UPS power fields, modern VM-domain projection, and safe disk projection |
| v4.35+ | Rich network addresses and network metrics |
| v4.37.1+ | Complete `unraid_v4371_*` query, mutation, and one-event subscription catalog |

Fallbacks occur only for recognized GraphQL schema-validation errors. Permission and runtime errors remain visible. Three resolver-specific normalizations are intentionally narrow:

- `Disk.bytesPerSector` is fetched separately. If Unraid violates its non-null schema by returning null, disk listing still succeeds without that field.
- An explicitly disabled UPS returns its configuration and an empty device list without running `apcaccess`.
- An explicitly unavailable or disabled VM service returns an empty domain list; unrelated VM failures remain errors.

The latest catalog uses a conservative v4.37.1 minimum rather than guessing that a complete document exists on an intermediate release. Use the stable tools on older servers or compare the reported version's generated schema in the [official Unraid API repository](https://github.com/unraid/api/tags).
