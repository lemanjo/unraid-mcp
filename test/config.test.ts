import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ConfigurationError, loadConfig } from "../src/config.js";

const requiredEnvironment = {
  UNRAID_URL: "https://tower.local",
  UNRAID_API_KEY: "test-api-key",
};
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "unraid-mcp-config-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

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
    expect(config.files).toMatchObject({
      roots: [],
      writableRoots: [],
      allowWrites: false,
      maxFileBytes: 256 * 1024,
      maxDirectoryEntries: 500,
    });
  });

  it("loads named mapped roots and a separate writable-root allowlist", () => {
    const appdata = temporaryDirectory();
    const backups = temporaryDirectory();
    const config = loadConfig({
      ...requiredEnvironment,
      MCP_FILE_ROOTS: JSON.stringify({ appdata, backups }),
      MCP_ALLOW_FILE_WRITES: "true",
      MCP_WRITABLE_FILE_ROOTS: "appdata",
      MCP_MAX_FILE_BYTES: "4096",
      MCP_MAX_DIRECTORY_ENTRIES: "25",
    });

    expect(config.files.roots.map((root) => root.name)).toEqual(["appdata", "backups"]);
    expect(config.files.writableRoots).toEqual(["appdata"]);
    expect(config.files.allowWrites).toBe(true);
    expect(config.files.maxFileBytes).toBe(4096);
    expect(config.files.maxDirectoryEntries).toBe(25);
  });

  it.each([
    ["not-json", "must be a JSON object"],
    [JSON.stringify({ AppData: "/tmp" }), "names must start with a lowercase letter"],
    [JSON.stringify({ appdata: "relative/path" }), "must be an absolute path"],
    [JSON.stringify({ proc: "/proc" }), "uses a protected container path"],
    [JSON.stringify({ missing: "/path/that/does/not/exist" }), "is not an accessible directory"],
  ])("rejects invalid mapped roots", (roots, message) => {
    expect(() => loadConfig({ ...requiredEnvironment, MCP_FILE_ROOTS: roots })).toThrow(message);
  });

  it("requires both the file-write gate and configured writable aliases", () => {
    const appdata = temporaryDirectory();
    const roots = JSON.stringify({ appdata });

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_FILE_ROOTS: roots,
        MCP_ALLOW_FILE_WRITES: "true",
      }),
    ).toThrow("MCP_ALLOW_FILE_WRITES=true requires MCP_WRITABLE_FILE_ROOTS");
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_FILE_ROOTS: roots,
        MCP_WRITABLE_FILE_ROOTS: "appdata",
      }),
    ).toThrow("MCP_WRITABLE_FILE_ROOTS requires MCP_ALLOW_FILE_WRITES=true");
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_FILE_ROOTS: roots,
        MCP_ALLOW_FILE_WRITES: "true",
        MCP_WRITABLE_FILE_ROOTS: "unknown",
      }),
    ).toThrow("may contain only names configured in MCP_FILE_ROOTS");
  });

  it("rejects a configured root that is itself a symbolic link", () => {
    const parent = temporaryDirectory();
    const target = temporaryDirectory();
    const link = join(parent, "appdata-link");
    symlinkSync(target, link);

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_FILE_ROOTS: JSON.stringify({ appdata: link }),
      }),
    ).toThrow("must not be a symbolic link");
  });

  it("rejects overlapping mapped roots", () => {
    const appdata = temporaryDirectory();
    const nested = join(appdata, "nested");
    mkdirSync(nested);

    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        MCP_FILE_ROOTS: JSON.stringify({ appdata, nested }),
      }),
    ).toThrow("must resolve to distinct, non-overlapping directories");
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
