import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { request as httpRequest } from "node:http";
import { createConnection } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { startHttpServer, type HttpServerHandle } from "../src/http-server.js";
import { createServer } from "../src/server.js";
import {
  UNRAID_API_V4_37_1_OPERATIONS,
  UNRAID_API_V4_37_1_SUBSCRIPTIONS,
} from "../src/api-v4.js";

const TOKEN = "test-mcp-auth-token-that-is-longer-than-32-bytes";
const handles: HttpServerHandle[] = [];
const clients: Client[] = [];

function httpConfig(environment: NodeJS.ProcessEnv = {}): AppConfig {
  const config = loadConfig({
    UNRAID_URL: "https://tower.local",
    UNRAID_API_KEY: "test-unraid-api-key",
    MCP_TRANSPORT: "http",
    MCP_AUTH_TOKEN: TOKEN,
    ...environment,
  });
  config.http.port = 0;
  return config;
}

async function start(
  config: AppConfig,
  options: Parameters<typeof startHttpServer>[1] = {},
): Promise<HttpServerHandle> {
  const handle = await startHttpServer(config, options);
  handles.push(handle);
  return handle;
}

function endpoint(handle: HttpServerHandle, path = "/mcp"): URL {
  return new URL(`http://127.0.0.1:${handle.port}${path}`);
}

async function requestStatus(
  url: URL,
  headers: Record<string, string>,
  body?: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(body);
  });
}

async function rawRequest(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error("Raw HTTP request did not close."));
    }, 1_000);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timeout);
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
});

describe("HTTP transport", () => {
  it("generates and logs an auth token when MCP_AUTH_TOKEN is absent", async () => {
    const config = httpConfig();
    config.http.authToken = undefined;
    const logger = vi.fn();
    const generatedToken = "generated-token-with-at-least-thirty-two-bytes";
    const handle = await start(config, {
      logger,
      tokenGenerator: () => generatedToken,
      createMcpServer: () => createServer(config, { execute: vi.fn() }),
    });

    expect(handle.generatedAuthToken).toBe(true);
    expect(handle.authToken).toBe(generatedToken);
    expect(logger).toHaveBeenCalledWith(
      `[unraid-mcp] Generated MCP auth token: ${generatedToken}`,
    );
  });

  it("serves health without authentication", async () => {
    const handle = await start(httpConfig(), { logger: vi.fn() });

    const response = await fetch(endpoint(handle, "/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("rejects body-bearing health requests", async () => {
    const handle = await start(httpConfig(), { logger: vi.fn() });
    const body = "unexpected body";

    const status = await requestStatus(
      endpoint(handle, "/health"),
      { "Content-Length": String(Buffer.byteLength(body)) },
      body,
    );

    expect(status).toBe(413);
  });

  it("requires a valid bearer token", async () => {
    const handle = await start(httpConfig(), { logger: vi.fn() });
    const request = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    };

    const missing = await fetch(endpoint(handle), request);
    const invalid = await fetch(endpoint(handle), {
      ...request,
      headers: { ...request.headers, Authorization: "Bearer wrong-token" },
    });

    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="unraid-mcp"');
    expect(invalid.status).toBe(401);
  });

  it("rate-limits repeated authentication failures", async () => {
    const config = httpConfig({ MCP_AUTH_FAILURE_LIMIT: "2" });
    const handle = await start(config, { logger: vi.fn() });
    const request = {
      method: "POST",
      headers: {
        Authorization: "Bearer wrong-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    };

    expect((await fetch(endpoint(handle), request)).status).toBe(401);
    expect((await fetch(endpoint(handle), request)).status).toBe(401);
    const blocked = await fetch(endpoint(handle), request);

    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
  });

  it("rejects unlisted hosts and browser origins", async () => {
    const handle = await start(httpConfig(), { logger: vi.fn() });

    const badHost = await requestStatus(endpoint(handle, "/health"), {
      Host: "attacker.example",
    });
    const badOrigin = await requestStatus(endpoint(handle, "/health"), {
      Origin: "https://attacker.example",
    });

    expect(badHost).toBe(403);
    expect(badOrigin).toBe(403);
  });

  it("closes body-bearing requests rejected by the Host guard", async () => {
    const handle = await start(httpConfig(), { logger: vi.fn() });
    const response = await rawRequest(
      handle.port,
      [
        "POST /mcp HTTP/1.1",
        "Host: attacker.example",
        "Content-Type: application/json",
        "Content-Length: 1000000",
        "Connection: keep-alive",
        "",
        "{",
      ].join("\r\n"),
    );

    expect(response).toMatch(/^HTTP\/1\.1 403/);
    expect(response).toMatch(/connection:\s*close/i);
  });

  it("enforces the HTTP request-body limit", async () => {
    const config = httpConfig();
    config.http.maxRequestBytes = 100;
    const handle = await start(config, { logger: vi.fn() });

    const response = await fetch(endpoint(handle), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: "x".repeat(200) }),
    });

    expect(response.status).toBe(413);
  });

  it("serves MCP tools and calls them over authenticated Streamable HTTP", async () => {
    const config = httpConfig();
    const execute = vi.fn(async () => ({ info: { os: { hostname: "tower" } } }));
    const handle = await start(config, {
      logger: vi.fn(),
      createMcpServer: () => createServer(config, { execute }),
    });
    const client = new Client(
      { name: "http-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(endpoint(handle), {
        requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
      }),
    );

    const tools = await client.listTools();
    const result = await client.callTool({ name: "unraid_get_system_info" });

    expect(tools.tools).toHaveLength(
      12 +
        UNRAID_API_V4_37_1_OPERATIONS.filter(
          (operation) => operation.kind === "query" && !operation.requiresConfirmation,
        ).length +
        UNRAID_API_V4_37_1_SUBSCRIPTIONS.length,
    );
    expect(result.structuredContent).toEqual({ info: { os: { hostname: "tower" } } });
  });
});
