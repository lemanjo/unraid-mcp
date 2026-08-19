#!/usr/bin/env node

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { ConfigurationError, loadConfig } from "./config.js";
import { startHttpServer } from "./http-server.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.endpoint.protocol === "http:") {
    console.error("[unraid-mcp] Warning: UNRAID_URL uses unencrypted HTTP.");
  }
  if (!config.rejectUnauthorized) {
    console.error("[unraid-mcp] Warning: TLS certificate verification is disabled for Unraid.");
  }

  const handle =
    config.transport === "http"
      ? await startHttpServer(config)
      : serveStdio(() => createServer(config));
  if (config.transport === "stdio") {
    console.error(
      `[unraid-mcp] Listening on stdio (${config.allowMutations ? "mutations enabled" : "read-only"}).`,
    );
  }

  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    void handle.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    console.error(`[unraid-mcp] Configuration error: ${error.message}`);
  } else {
    console.error("[unraid-mcp] Failed to start.");
  }
  process.exitCode = 1;
});
