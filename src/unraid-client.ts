import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import WebSocket, { type RawData } from "ws";

import type { UnraidConfig } from "./config.js";

export class UnraidApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UnraidApiError";
  }
}

function statusError(status: number, details?: string): UnraidApiError {
  const suffix = details ? ` Unraid GraphQL error: ${details}` : "";
  if (status === 401) {
    return new UnraidApiError(
      "AUTHENTICATION_FAILED",
      `Unraid rejected the configured API key.${suffix}`,
    );
  }
  if (status === 403) {
    return new UnraidApiError(
      "PERMISSION_DENIED",
      `The Unraid API key does not have permission for this operation.${suffix}`,
    );
  }
  if (status === 429) {
    return new UnraidApiError(
      "RATE_LIMITED",
      `The Unraid API rate limit was reached. Try again later.${suffix}`,
    );
  }
  if (status >= 300 && status < 400) {
    return new UnraidApiError(
      "REDIRECT_REJECTED",
      `The Unraid endpoint returned a redirect. Configure UNRAID_URL with the final GraphQL URL.${suffix}`,
    );
  }
  return new UnraidApiError("HTTP_ERROR", `The Unraid API returned HTTP ${status}.${suffix}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class UnraidClient {
  constructor(private readonly config: UnraidConfig) {}

  async execute<T extends Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    const payload = JSON.stringify({ query, variables });
    const raw = await this.request(payload, signal);
    return this.parseGraphQLResponse<T>(raw);
  }

  subscribeOnce<T extends Record<string, unknown>>(
    query: string,
    variables: Record<string, unknown> = {},
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new UnraidApiError("CANCELLED", "The Unraid subscription was cancelled."));
        return;
      }

      const endpoint = new URL(this.config.endpoint);
      endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
      let settled = false;
      let subscribed = false;
      const socket = new WebSocket(endpoint, "graphql-transport-ws", {
        ca: this.config.ca,
        rejectUnauthorized: this.config.rejectUnauthorized,
        handshakeTimeout: this.config.timeoutMs,
        maxPayload: this.config.maxResponseBytes,
      });
      const timeout = setTimeout(() => {
        fail(new UnraidApiError("TIMEOUT", "The Unraid subscription timed out before an event arrived."));
      }, this.config.timeoutMs);
      timeout.unref();

      const cleanup = (): void => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        socket.removeAllListeners();
        socket.once("error", () => undefined);
        if (socket.readyState === WebSocket.OPEN) {
          if (subscribed) socket.send(JSON.stringify({ id: "1", type: "complete" }));
          socket.close(1000);
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.terminate();
        }
      };
      const succeed = (data: T): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error instanceof UnraidApiError ? error : this.networkError(error));
      };
      const onAbort = (): void => {
        fail(new UnraidApiError("CANCELLED", "The Unraid subscription was cancelled."));
      };
      const sendSubscribe = (): void => {
        if (subscribed) return;
        subscribed = true;
        socket.send(
          JSON.stringify({
            id: "1",
            type: "subscribe",
            payload: { query, variables },
          }),
        );
      };
      const onMessage = (raw: RawData): void => {
        const body = raw.toString();
        if (Buffer.byteLength(body) > this.config.maxResponseBytes) {
          fail(new UnraidApiError("RESPONSE_TOO_LARGE", "The Unraid API response exceeded the size limit."));
          return;
        }
        let message: unknown;
        try {
          message = JSON.parse(body);
        } catch {
          fail(new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned invalid subscription JSON."));
          return;
        }
        if (!isRecord(message) || typeof message.type !== "string") {
          fail(new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned an invalid subscription message."));
          return;
        }
        if (message.type === "connection_ack") {
          sendSubscribe();
          return;
        }
        if (message.type === "ping") {
          socket.send(JSON.stringify({ type: "pong", payload: message.payload }));
          return;
        }
        if (message.type === "next" && message.id === "1") {
          try {
            succeed(this.parseGraphQLValue<T>(message.payload));
          } catch (error) {
            fail(error);
          }
          return;
        }
        if (message.type === "error" && message.id === "1") {
          const errors = Array.isArray(message.payload) ? message.payload : [message.payload];
          fail(
            new UnraidApiError(
              "GRAPHQL_ERROR",
              `Unraid GraphQL error: ${this.graphqlErrorDetails(errors)}`,
            ),
          );
          return;
        }
        if (message.type === "complete" && message.id === "1") {
          fail(
            new UnraidApiError(
              "INVALID_RESPONSE",
              "The Unraid subscription completed before an event arrived.",
            ),
          );
        }
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            type: "connection_init",
            payload: { "x-api-key": this.config.apiKey },
          }),
        );
      });
      socket.on("message", onMessage);
      socket.once("error", fail);
      socket.once("close", (code, reason) => {
        if (!settled) {
          const closeError =
            code === 4401
              ? new UnraidApiError("AUTHENTICATION_FAILED", "Unraid rejected the configured API key.")
              : code === 4403
                ? new UnraidApiError(
                    "PERMISSION_DENIED",
                    "The Unraid API key does not have permission for this subscription.",
                  )
                : code === 4408
                  ? new UnraidApiError(
                      "TIMEOUT",
                      "The Unraid subscription connection initialization timed out.",
                    )
                  : new UnraidApiError(
                      "NETWORK_ERROR",
                      `The Unraid subscription closed before an event arrived (code ${code}${
                        reason.length ? `: ${this.redact(reason.toString()).slice(0, 200)}` : ""
                      }).`,
                    );
          fail(closeError);
        }
      });
    });
  }

  private parseGraphQLResponse<T extends Record<string, unknown>>(raw: string): T {
    let response: unknown;
    try {
      response = JSON.parse(raw);
    } catch {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned invalid JSON.");
    }

    return this.parseGraphQLValue<T>(response);
  }

  private parseGraphQLValue<T extends Record<string, unknown>>(response: unknown): T {
    if (!isRecord(response)) {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned an invalid response.");
    }
    const errors = response.errors;
    if (errors !== undefined && !Array.isArray(errors)) {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned invalid errors.");
    }
    if (errors?.length) {
      const details = this.graphqlErrorDetails(errors);
      throw new UnraidApiError("GRAPHQL_ERROR", `Unraid GraphQL error: ${details}`);
    }
    if (!isRecord(response.data)) {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API response did not contain data.");
    }
    return response.data as T;
  }

  private request(payload: string, signal?: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new UnraidApiError("CANCELLED", "The Unraid request was cancelled."));
        return;
      }

      let settled = false;
      let request: ClientRequest | undefined;
      let timeout: NodeJS.Timeout | undefined;
      const cleanup = (): void => {
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };
      const succeed = (value: string): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const fail = (error: unknown): void => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error instanceof UnraidApiError) {
          reject(error);
          return;
        }
        reject(this.networkError(error));
      };
      const onAbort = (): void => {
        fail(new UnraidApiError("CANCELLED", "The Unraid request was cancelled."));
        request?.destroy();
      };

      const onResponse = (response: IncomingMessage): void => {
        if (settled) {
          response.destroy();
          return;
        }
        const status = response.statusCode ?? 0;
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > this.config.maxResponseBytes) {
          response.destroy();
          fail(new UnraidApiError("RESPONSE_TOO_LARGE", "The Unraid API response exceeded the size limit."));
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          received += buffer.length;
          if (received > this.config.maxResponseBytes) {
            response.destroy();
            fail(
              new UnraidApiError(
                "RESPONSE_TOO_LARGE",
                "The Unraid API response exceeded the size limit.",
              ),
            );
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          if (status < 200 || status >= 300) {
            fail(statusError(status, this.graphqlErrorDetailsFromBody(body)));
            return;
          }
          succeed(body);
        });
        response.on("error", fail);
      };

      const options = {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "unraid-mcp/0.2.0",
          "x-api-key": this.config.apiKey,
        },
      };

      request =
        this.config.endpoint.protocol === "https:"
          ? httpsRequest(
              this.config.endpoint,
              {
                ...options,
                ca: this.config.ca,
                rejectUnauthorized: this.config.rejectUnauthorized,
              },
              onResponse,
            )
          : httpRequest(this.config.endpoint, options, onResponse);

      timeout = setTimeout(() => {
        fail(new UnraidApiError("TIMEOUT", "The request to the Unraid API timed out."));
        request?.destroy();
      }, this.config.timeoutMs);
      timeout.unref();
      signal?.addEventListener("abort", onAbort, { once: true });
      request.on("error", fail);
      request.end(payload);
    });
  }

  private graphqlErrorDetailsFromBody(body: string): string | undefined {
    let response: unknown;
    try {
      response = JSON.parse(body);
    } catch {
      return undefined;
    }
    if (!isRecord(response) || !Array.isArray(response.errors) || response.errors.length === 0) {
      return undefined;
    }
    return this.graphqlErrorDetails(response.errors);
  }

  private graphqlErrorDetails(errors: unknown[]): string {
    const messages = errors
      .slice(0, 10)
      .map((error) =>
        isRecord(error) && typeof error.message === "string"
          ? error.message
          : "Unknown GraphQL error",
      )
      .map((message) => this.redact(message).slice(0, 500));
    const suffix = errors.length > 10 ? "; additional errors omitted" : "";
    return `${messages.join("; ")}${suffix}`.slice(0, 2_000);
  }

  private networkError(error: unknown): UnraidApiError {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN";
    if (code === "WS_ERR_UNSUPPORTED_MESSAGE_LENGTH") {
      return new UnraidApiError(
        "RESPONSE_TOO_LARGE",
        "The Unraid API response exceeded the size limit.",
      );
    }
    if (
      [
        "CERT_HAS_EXPIRED",
        "CERT_NOT_YET_VALID",
        "DEPTH_ZERO_SELF_SIGNED_CERT",
        "ERR_TLS_CERT_ALTNAME_INVALID",
        "SELF_SIGNED_CERT_IN_CHAIN",
        "UNABLE_TO_GET_ISSUER_CERT",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
      ].includes(code)
    ) {
      return new UnraidApiError(
        "TLS_VALIDATION_FAILED",
        "Unraid TLS validation failed. Configure UNRAID_CA_CERT or UNRAID_CA_CERT_PATH.",
      );
    }
    return new UnraidApiError("NETWORK_ERROR", "Unable to connect to the configured Unraid API.");
  }

  private redact(message: string): string {
    return message.split(this.config.apiKey).join("[REDACTED]");
  }
}
