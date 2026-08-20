import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiV4SubscriptionToolName, apiV4ToolName } from "../src/api-v4-tools.js";
import {
  UNRAID_API_V4_37_1_OPERATIONS,
  UNRAID_API_V4_37_1_SUBSCRIPTIONS,
} from "../src/api-v4.js";
import type { UnraidConfig } from "../src/config.js";
import { DOCKER_LOGS_QUERY, SYSTEM_INFO_QUERY, SYSTEM_NETWORK_QUERY } from "../src/queries.js";
import { API_CAPABILITIES_QUERY } from "../src/read-facade.js";
import { createServer } from "../src/server.js";
import { UnraidApiError } from "../src/unraid-client.js";

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
  subscribeOnce?: (
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<Record<string, unknown>>,
) {
  const server = createServer(serverConfig, { execute, subscribeOnce });
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

    const latestReads = UNRAID_API_V4_37_1_OPERATIONS.filter(
      (operation) => operation.kind === "query" && !operation.requiresConfirmation,
    );
    expect(names).toHaveLength(
      12 + latestReads.length + UNRAID_API_V4_37_1_SUBSCRIPTIONS.length,
    );
    expect(names).toContain("unraid_get_system_info");
    expect(names).toContain("unraid_read_system_log");
    expect(names).not.toContain("unraid_control_array");
    expect(names).not.toContain("unraid_remove_docker_container");
  });

  it("calls a read operation and returns structured content", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        return { services: [{ name: "unraid-api", version: "4.37.1" }] };
      }
      if (query === SYSTEM_INFO_QUERY) return { info: { os: { hostname: "tower" } } };
      if (query === SYSTEM_NETWORK_QUERY) return { info: { networkInterfaces: [] } };
      throw new Error("Unexpected query");
    });
    const { client } = await connect(config(), execute);

    const result = await client.callTool({ name: "unraid_get_system_info" });

    expect(execute).toHaveBeenCalledWith(SYSTEM_INFO_QUERY, {}, expect.any(AbortSignal));
    expect(result.structuredContent).toEqual({
      info: { os: { hostname: "tower" }, networkInterfaces: [] },
    });
  });

  it("applies bounded defaults to Docker log requests", async () => {
    const execute = vi.fn(async (query: string) =>
      query === API_CAPABILITIES_QUERY
        ? { services: [{ name: "unraid-api", version: "4.37.1" }] }
        : { docker: { logs: { lines: [] } } },
    );
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

  it("requires explicit confirmations even when the destructive gate is enabled", async () => {
    const execute = vi.fn(async () => ({ parityCheck: { start: true } }));
    const { client } = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
      execute,
    );

    const parity = await client.callTool({
      name: "unraid_control_parity_check",
      arguments: { action: "START", correct: true },
    });
    const array = await client.callTool({
      name: "unraid_control_array",
      arguments: { action: "STOP" },
    });
    const dockerUpdate = await client.callTool({
      name: "unraid_control_docker_container",
      arguments: { id: "DockerContainer:test", action: "UPDATE" },
    });

    expect(parity.isError).toBe(true);
    expect(array.isError).toBe(true);
    expect(dockerUpdate.isError).toBe(true);
    expect(execute).not.toHaveBeenCalled();
  });

  it("registers permanent and forced actions only with both gates", async () => {
    const { client } = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
    );
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toContain("unraid_remove_docker_container");
    expect(names).toContain("unraid_force_vm");

    const contradictory = await connect(
      config({ allowMutations: false, allowDestructiveMutations: true }),
    );
    const contradictoryNames = (await contradictory.client.listTools()).tools.map(
      (tool) => tool.name,
    );
    expect(contradictoryNames).not.toContain("unraid_remove_docker_container");
    expect(contradictoryNames).not.toContain("unraid_force_vm");
  });

  it("executes a fixed latest query only on a supported API version", async () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371QueryOnline",
    );
    expect(operation).toBeDefined();
    if (!operation) return;

    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        return { services: [{ name: "unraid-api", version: "4.37.1" }] };
      }
      if (query === operation.document) return { online: true };
      throw new Error("Unexpected query");
    });
    const { client } = await connect(config(), execute);

    const result = await client.callTool({ name: apiV4ToolName(operation) });

    expect(result.structuredContent).toEqual({ online: true });
    expect(execute).toHaveBeenCalledWith(operation.document, {}, expect.any(AbortSignal));
  });

  it("returns a clear version error instead of sending a latest document to an older API", async () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371QueryOnline",
    );
    expect(operation).toBeDefined();
    if (!operation) return;

    const execute = vi.fn(async () => ({
      services: [{ name: "unraid-api", version: "4.35.1" }],
    }));
    const { client } = await connect(config(), execute);

    const result = await client.callTool({ name: apiV4ToolName(operation) });

    expect(result.isError).toBe(true);
    expect(result.content).toContainEqual(
      expect.objectContaining({ text: expect.stringContaining("requires Unraid API v4.37.1") }),
    );
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("requires both gates and an exact confirmation for dangerous latest mutations", async () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371DeleteArchivedNotifications",
    );
    expect(operation).toBeDefined();
    if (!operation) return;
    const toolName = apiV4ToolName(operation);

    const readOnly = await connect(config());
    expect((await readOnly.client.listTools()).tools.map((tool) => tool.name)).not.toContain(toolName);

    const routineOnly = await connect(config({ allowMutations: true }));
    expect((await routineOnly.client.listTools()).tools.map((tool) => tool.name)).not.toContain(
      toolName,
    );

    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        return { services: [{ name: "unraid-api", version: "4.37.1" }] };
      }
      if (query === operation.document) return { deleteArchivedNotifications: { unread: {} } };
      throw new Error("Unexpected query");
    });
    const enabled = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
      execute,
    );
    const tool = (await enabled.client.listTools()).tools.find((candidate) => candidate.name === toolName);

    expect(tool?.inputSchema).toMatchObject({ required: ["confirmation"] });
    const result = await enabled.client.callTool({
      name: toolName,
      arguments: { confirmation: toolName },
    });
    expect(result.structuredContent).toEqual({
      deleteArchivedNotifications: { unread: {} },
    });
  });

  it("returns one bounded event through each latest subscription tool", async () => {
    const subscription = UNRAID_API_V4_37_1_SUBSCRIPTIONS.find(
      (candidate) => candidate.field === "dockerContainerStats",
    );
    expect(subscription).toBeDefined();
    if (!subscription) return;
    const execute = vi.fn(async () => ({
      services: [{ name: "unraid-api", version: "4.37.1" }],
    }));
    const subscribeOnce = vi.fn(async () => ({
      dockerContainerStats: { id: "DockerContainer:test", cpuPercent: 1 },
    }));
    const { client } = await connect(config(), execute, subscribeOnce);

    const result = await client.callTool({
      name: apiV4SubscriptionToolName(subscription.field),
    });

    expect(result.structuredContent).toEqual({
      dockerContainerStats: { id: "DockerContainer:test", cpuPercent: 1 },
    });
    expect(subscribeOnce).toHaveBeenCalledWith(
      subscription.document,
      {},
      expect.any(AbortSignal),
    );
  });

  it("applies catalog gates and confirmations to every latest operation", async () => {
    const readOnly = await connect(config());
    const routine = await connect(config({ allowMutations: true }));
    const all = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
    );
    const readOnlyTools = new Map(
      (await readOnly.client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    const routineTools = new Map(
      (await routine.client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    const allTools = new Map((await all.client.listTools()).tools.map((tool) => [tool.name, tool]));

    for (const operation of UNRAID_API_V4_37_1_OPERATIONS) {
      const name = apiV4ToolName(operation);
      const availableByDefault = operation.kind === "query" && !operation.requiresConfirmation;
      const availableWithRoutine =
        availableByDefault || (operation.kind === "mutation" && operation.safety === "routine");
      expect(readOnlyTools.has(name), name).toBe(availableByDefault);
      expect(routineTools.has(name), name).toBe(availableWithRoutine);
      expect(allTools.has(name), name).toBe(true);
      if (operation.requiresConfirmation) {
        expect(allTools.get(name)?.inputSchema, name).toMatchObject({
          required: expect.arrayContaining(["confirmation"]),
        });
      }
    }
  });

  it("omits echoed credentials from sensitive operation errors", async () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371QueryValidateOidcSession",
    );
    expect(operation).toBeDefined();
    if (!operation) return;
    const secret = "oidc-session-secret";
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        return { services: [{ name: "unraid-api", version: "4.37.1" }] };
      }
      throw new UnraidApiError(
        "GRAPHQL_ERROR",
        `Unraid GraphQL error: invalid token ${secret}`,
      );
    });
    const { client } = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
      execute,
    );
    const name = apiV4ToolName(operation);

    const result = await client.callTool({
      name,
      arguments: { token: secret, confirmation: name },
    });
    const rendered = JSON.stringify(result);
    expect(result.isError).toBe(true);
    expect(rendered).not.toContain(secret);
    expect(rendered).toContain("response details were omitted");
  });

  it("preserves cancellation semantics for sensitive operations", async () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371QueryValidateOidcSession",
    );
    expect(operation).toBeDefined();
    if (!operation) return;
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        return { services: [{ name: "unraid-api", version: "4.37.1" }] };
      }
      throw new UnraidApiError("CANCELLED", "The Unraid request was cancelled.");
    });
    const { client } = await connect(
      config({ allowMutations: true, allowDestructiveMutations: true }),
      execute,
    );
    const name = apiV4ToolName(operation);

    const result = await client.callTool({
      name,
      arguments: { token: "secret", confirmation: name },
    });

    expect(JSON.stringify(result)).toContain("request was cancelled");
    expect(JSON.stringify(result)).not.toContain("response details were omitted");
  });
});
