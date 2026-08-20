import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { createMcpHandler, type AuthInfo, type McpServer } from "@modelcontextprotocol/server";

import type { AppConfig } from "./config.js";
import { logToStderr } from "./logger.js";
import { createServer } from "./server.js";

const MCP_PATH = "/mcp";
const HEALTH_PATH = "/health";

interface FailureState {
  count: number;
  resetAt: number;
}

class AuthFailureLimiter {
  private static readonly MAX_CLIENTS = 10_000;
  private readonly failures = new Map<string, FailureState>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  isBlocked(client: string): boolean {
    const state = this.current(client);
    return state !== undefined && state.count >= this.limit;
  }

  retryAfterSeconds(client: string): number {
    const state = this.current(client);
    return state ? Math.max(1, Math.ceil((state.resetAt - this.now()) / 1_000)) : 1;
  }

  recordFailure(client: string): void {
    const current = this.current(client);
    if (current) {
      current.count += 1;
      return;
    }
    if (this.failures.size >= AuthFailureLimiter.MAX_CLIENTS) {
      const oldest = this.failures.keys().next().value as string | undefined;
      if (oldest) this.failures.delete(oldest);
    }
    this.failures.set(client, { count: 1, resetAt: this.now() + this.windowMs });
  }

  clear(client: string): void {
    this.failures.delete(client);
  }

  private current(client: string): FailureState | undefined {
    const state = this.failures.get(client);
    if (state && state.resetAt <= this.now()) {
      this.failures.delete(client);
      return undefined;
    }
    return state;
  }
}

class RequestBodyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpServerOptions {
  logger?: (message: string) => void;
  tokenGenerator?: () => string;
  now?: () => number;
  createMcpServer?: () => McpServer;
}

export interface HttpServerHandle {
  authToken: string;
  generatedAuthToken: boolean;
  host: string;
  port: number;
  server: NodeHttpServer;
  close(): Promise<void>;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function readBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  return match?.[1];
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(Buffer.byteLength(payload)),
    ...headers,
  });
  response.end(payload);
}

function sendMcpError(response: ServerResponse, status: number, message: string): void {
  sendJson(response, status, {
    jsonrpc: "2.0",
    error: { code: -32_000, message },
    id: null,
  });
}

function closeConnectionAfterResponse(request: IncomingMessage, response: ServerResponse): void {
  response.setHeader("Connection", "close");
  response.shouldKeepAlive = false;
  response.once("finish", () => request.socket.end());
}

function requestHasBody(request: IncomingMessage): boolean {
  const contentLength = request.headers["content-length"];
  return (
    request.headers["transfer-encoding"] !== undefined ||
    (contentLength !== undefined && contentLength !== "0")
  );
}

async function readJsonBody(request: IncomingMessage, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestBodyError(415, "Content-Type must be application/json.");
  }

  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new RequestBodyError(413, "MCP request body exceeds the configured limit.");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    received += buffer.length;
    if (received > maximumBytes) {
      throw new RequestBodyError(413, "MCP request body exceeds the configured limit.");
    }
    chunks.push(buffer);
  }

  if (received === 0) throw new RequestBodyError(400, "MCP request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RequestBodyError(400, "MCP request body contains invalid JSON.");
  }
}

function clientIdentifier(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? "unknown";
}

function displayHost(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

export async function startHttpServer(
  config: AppConfig,
  options: HttpServerOptions = {},
): Promise<HttpServerHandle> {
  const logger = options.logger ?? logToStderr;
  const generatedAuthToken = config.http.authToken === undefined;
  const authToken = config.http.authToken ?? (options.tokenGenerator ?? (() => randomBytes(32).toString("base64url")))();
  const expectedTokenHash = hashToken(authToken);
  const limiter = new AuthFailureLimiter(
    config.http.authFailureLimit,
    config.http.authFailureWindowMs,
    options.now ?? Date.now,
  );
  const mcpHandler = createMcpHandler(options.createMcpServer ?? (() => createServer(config)), {
    onerror: () => logger("[unraid-mcp] MCP HTTP handler error."),
    maxSubscriptions: 100,
  });
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: () => logger("[unraid-mcp] MCP HTTP adapter error."),
  });
  const validateHost = hostHeaderValidation(config.http.allowedHosts);
  const validateOrigin = originValidation(config.http.allowedOrigins);

  const server = createNodeServer(
    {
      headersTimeout: Math.min(config.http.requestTimeoutMs, 10_000),
      keepAliveTimeout: 5_000,
      maxHeaderSize: 16 * 1024,
      requestTimeout: config.http.requestTimeoutMs,
    },
    (request, response) => {
      void (async () => {
        const closeIfGuardRejects = requestHasBody(request);
        const originalShouldKeepAlive = response.shouldKeepAlive;
        const originalConnectionHeader = response.getHeader("Connection");
        if (closeIfGuardRejects) {
          response.setHeader("Connection", "close");
          response.shouldKeepAlive = false;
        }
        if (!validateHost(request, response)) {
          return;
        }
        if (!validateOrigin(request, response)) {
          return;
        }
        if (closeIfGuardRejects) {
          if (originalConnectionHeader === undefined) response.removeHeader("Connection");
          else response.setHeader("Connection", originalConnectionHeader);
          response.shouldKeepAlive = originalShouldKeepAlive;
        }

        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === HEALTH_PATH) {
          if (requestHasBody(request)) {
            closeConnectionAfterResponse(request, response);
            sendJson(response, 413, { error: "Health requests must not contain a body." });
            return;
          }
          if (request.method !== "GET" && request.method !== "HEAD") {
            closeConnectionAfterResponse(request, response);
            sendJson(response, 405, { error: "Method not allowed." }, { Allow: "GET, HEAD" });
            return;
          }
          if (request.method === "HEAD") {
            response.writeHead(200, { "Cache-Control": "no-store" });
            response.end();
            return;
          }
          sendJson(response, 200, { status: "ok" });
          return;
        }

        if (pathname !== MCP_PATH) {
          closeConnectionAfterResponse(request, response);
          sendJson(response, 404, { error: "Not found." });
          return;
        }

        const client = clientIdentifier(request);
        const suppliedToken = readBearerToken(request.headers.authorization);
        const authenticated =
          suppliedToken !== undefined &&
          timingSafeEqual(hashToken(suppliedToken), expectedTokenHash);

        if (!authenticated) {
          closeConnectionAfterResponse(request, response);
          if (limiter.isBlocked(client)) {
            sendJson(
              response,
              429,
              { error: "Too many authentication failures." },
              { "Retry-After": String(limiter.retryAfterSeconds(client)) },
            );
            return;
          }
          limiter.recordFailure(client);
          sendJson(
            response,
            401,
            { error: "Unauthorized." },
            { "WWW-Authenticate": 'Bearer realm="unraid-mcp"' },
          );
          return;
        }
        limiter.clear(client);

        (request as IncomingMessage & { auth?: AuthInfo }).auth = {
          token: authToken,
          clientId: client,
          scopes: ["mcp"],
        };

        let parsedBody: unknown;
        if (request.method === "POST") {
          parsedBody = await readJsonBody(request, config.http.maxRequestBytes);
        }
        await nodeHandler(request, response, parsedBody);
      })().catch((error: unknown) => {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        if (error instanceof RequestBodyError) {
          closeConnectionAfterResponse(request, response);
          sendMcpError(response, error.status, error.message);
          return;
        }
        logger("[unraid-mcp] Unexpected HTTP request error.");
        sendMcpError(response, 500, "Internal server error.");
      });
    },
  );

  server.maxRequestsPerSocket = 100;
  server.on("clientError", (_error, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(config.http.port, config.http.host);
  });

  const address = server.address() as AddressInfo;
  if (generatedAuthToken) {
    logger(`[unraid-mcp] Generated MCP auth token: ${authToken}`);
    logger("[unraid-mcp] Set MCP_AUTH_TOKEN to keep the same token after restart.");
  }
  logger("[unraid-mcp] HTTP transport is unencrypted; terminate TLS at a trusted reverse proxy.");
  logger(
    `[unraid-mcp] Listening on HTTP at http://${displayHost(config.http.host)}:${address.port}${MCP_PATH} (${config.allowMutations ? "mutations enabled" : "read-only"}).`,
  );

  let closed = false;
  return {
    authToken,
    generatedAuthToken,
    host: config.http.host,
    port: address.port,
    server,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      const serverClosed = new Promise<void>((resolve) => server.close(() => resolve()));
      await mcpHandler.close();
      server.closeAllConnections();
      await serverClosed;
    },
  };
}
