import { describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config.js";

const requiredEnvironment = {
  UNRAID_URL: "https://tower.local",
  UNRAID_API_KEY: "test-api-key",
};

describe("loadConfig", () => {
  it("loads a read-only HTTPS configuration and adds /graphql", () => {
    const config = loadConfig(requiredEnvironment);

    expect(config.endpoint.href).toBe("https://tower.local/graphql");
    expect(config.apiKey).toBe("test-api-key");
    expect(config.allowMutations).toBe(false);
    expect(config.allowDestructiveMutations).toBe(false);
    expect(config.rejectUnauthorized).toBe(true);
    expect(config.transport).toBe("stdio");
    expect(config.http.authToken).toBeUndefined();
  });

  it("preserves an explicit reverse-proxy endpoint", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      UNRAID_URL: "https://unraid.example.test/services/unraid/graphql/",
    });

    expect(config.endpoint.href).toBe("https://unraid.example.test/services/unraid/graphql");
  });

  it("loads a multiline CA from the environment", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      UNRAID_CA_CERT: "-----BEGIN CERTIFICATE-----\\ncertificate-data\\n-----END CERTIFICATE-----",
    });

    expect(config.ca?.toString()).toContain("\ncertificate-data\n");
  });

  it("requires the standard mutation gate before the destructive gate", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS: "true",
      }),
    ).toThrowError(
      new ConfigurationError(
        "UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS requires UNRAID_ALLOW_MUTATIONS=true.",
      ),
    );
  });

  it("loads authenticated HTTP transport settings", () => {
    const config = loadConfig({
      ...requiredEnvironment,
      MCP_TRANSPORT: "http",
      MCP_HOST: "0.0.0.0",
      MCP_PORT: "8080",
      MCP_AUTH_TOKEN: "a-secure-mcp-token-with-at-least-32-bytes",
      MCP_ALLOWED_HOSTS: "mcp.example.test,192.168.1.20",
      MCP_ALLOWED_ORIGINS: "app.example.test",
    });

    expect(config.transport).toBe("http");
    expect(config.http).toMatchObject({
      host: "0.0.0.0",
      port: 8080,
      authToken: "a-secure-mcp-token-with-at-least-32-bytes",
      allowedHosts: [
        "mcp.example.test",
        "192.168.1.20",
        "localhost",
        "127.0.0.1",
        "[::1]",
      ],
      allowedOrigins: ["app.example.test"],
    });
  });

  it("requires an allowed host list for a wildcard HTTP bind", () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_TRANSPORT: "http",
        MCP_HOST: "0.0.0.0",
      }),
    ).toThrow("MCP_ALLOWED_HOSTS is required when MCP_HOST binds to all interfaces.");
  });

  it("allows HTTP startup without a configured token so startup can generate one", () => {
    const config = loadConfig({ ...requiredEnvironment, MCP_TRANSPORT: "http" });

    expect(config.http.authToken).toBeUndefined();
    expect(config.http.allowedHosts).toEqual(["localhost", "127.0.0.1", "[::1]"]);
  });

  it.each([
    [{ UNRAID_API_KEY: "key" }, "UNRAID_URL is required."],
    [{ UNRAID_URL: "https://tower.local" }, "UNRAID_API_KEY is required."],
    [
      { ...requiredEnvironment, UNRAID_URL: "ftp://tower.local" },
      "UNRAID_URL must use http or https.",
    ],
    [
      { ...requiredEnvironment, UNRAID_URL: "https://user:pass@tower.local" },
      "UNRAID_URL must not contain credentials.",
    ],
    [
      { ...requiredEnvironment, UNRAID_ALLOW_MUTATIONS: "sometimes" },
      "UNRAID_ALLOW_MUTATIONS must be true or false.",
    ],
    [
      { ...requiredEnvironment, MCP_TRANSPORT: "http", MCP_AUTH_TOKEN: "too-short" },
      "MCP_AUTH_TOKEN must be at least 32 bytes.",
    ],
    [
      {
        ...requiredEnvironment,
        MCP_TRANSPORT: "http",
        MCP_AUTH_TOKEN: "invalid token with more than 32 bytes",
      },
      "MCP_AUTH_TOKEN must use only HTTP bearer-token characters",
    ],
    [
      { ...requiredEnvironment, MCP_TRANSPORT: "websocket" },
      "MCP_TRANSPORT must be stdio or http.",
    ],
  ])("rejects invalid environment values", (environment, message) => {
    expect(() => loadConfig(environment)).toThrow(message);
  });

  it.each([
    "::",
    "::0",
    "0:0:0:0:0:0:0:0",
    "::0.0.0.0",
    "::ffff:0.0.0.0",
    "::ffff:0:0",
  ])(
    "requires allowed hosts for IPv6 wildcard bind %s",
    (host) => {
      expect(() =>
        loadConfig({
          ...requiredEnvironment,
          MCP_TRANSPORT: "http",
          MCP_HOST: host,
        }),
      ).toThrow("MCP_ALLOWED_HOSTS is required when MCP_HOST binds to all interfaces.");
    },
  );
});
