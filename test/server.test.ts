import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UnraidConfig } from "../src/config.js";
import { DOCKER_LOGS_QUERY, SYSTEM_INFO_QUERY } from "../src/queries.js";
import { createServer } from "../src/server.js";

const closeCallbacks: (() => Promise<void>)[] = [];

function config(overrides: Partial<UnraidConfig> = {}): UnraidConfig {
  return {
    endpoint: new URL("https://tower.local/graphql"),
    apiKey: "test-api-key",
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    ca: undefined,
    rejectUnauthorized: true,
    allowMutations: false,
    allowDestructiveMutations: false,
    ...overrides,
  };
}

async function connect(
  serverConfig: UnraidConfig,
  execute: (
    query: string,
    variables?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>> = vi.fn(async () => ({ result: "ok" })),
) {
  const server = createServer(serverConfig, { execute });
  const client = new Client({ name: "unraid-mcp-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closeCallbacks.push(async () => {
    await client.close();
    await server.close();
  });

  return { client, execute };
}

afterEach(async () => {
  await Promise.all(closeCallbacks.splice(0).map((close) => close()));
});

describe("createServer", () => {
  it("advertises only read tools by default", async () => {
    const { client } = await connect(config());
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toHaveLength(12);
    expect(names).toContain("unraid_get_system_info");
    expect(names).toContain("unraid_read_system_log");
    expect(names).not.toContain("unraid_control_array");
    expect(names).not.toContain("unraid_remove_docker_container");
  });

  it("calls a read operation and returns structured content", async () => {
    const execute = vi.fn(async () => ({ info: { os: { hostname: "tower" } } }));
    const { client } = await connect(config(), execute);

    const result = await client.callTool({ name: "unraid_get_system_info" });

    expect(execute).toHaveBeenCalledWith(SYSTEM_INFO_QUERY, {}, expect.any(AbortSignal));
    expect(result.structuredContent).toEqual({ info: { os: { hostname: "tower" } } });
  });

  it("applies bounded defaults to Docker log requests", async () => {
    const execute = vi.fn(async () => ({ docker: { logs: { lines: [] } } }));
    const { client } = await connect(config(), execute);

    await client.callTool({
      name: "unraid_get_docker_logs",
      arguments: { id: "DockerContainer:abc" },
    });

    expect(execute).toHaveBeenCalledWith(DOCKER_LOGS_QUERY, {
      id: "DockerContainer:abc",
      tail: 200,
      since: undefined,
    }, expect.any(AbortSignal));
  });

  it("registers standard mutations without destructive-only tools", async () => {
    const { client } = await connect(config({ allowMutations: true }));
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toContain("unraid_control_array");
    expect(names).toContain("unraid_control_docker_container");
    expect(names).toContain("unraid_manage_notifications");
    expect(names).not.toContain("unraid_remove_docker_container");
    expect(names).not.toContain("unraid_force_vm");
  });

  it("blocks parity correction without the destructive gate", async () => {
    const execute = vi.fn(async () => ({ parityCheck: { start: true } }));
    const { client } = await connect(config({ allowMutations: true }), execute);

    const result = await client.callTool({
      name: "unraid_control_parity_check",
      arguments: { action: "START", correct: true },
    });

    expect(result.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("registers permanent and forced actions only with both gates", async () => {
    const { client } = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toContain("unraid_remove_docker_container");
    expect(names).toContain("unraid_force_vm");
  });
});
