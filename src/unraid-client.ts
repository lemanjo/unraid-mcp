import type { ClientRequest, IncomingMessage } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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

function statusError(status: number): UnraidApiError {
  if (status === 401) {
    return new UnraidApiError("AUTHENTICATION_FAILED", "Unraid rejected the configured API key.");
  }
  if (status === 403) {
    return new UnraidApiError(
      "PERMISSION_DENIED",
      "The Unraid API key does not have permission for this operation.",
    );
  }
  if (status === 429) {
    return new UnraidApiError("RATE_LIMITED", "The Unraid API rate limit was reached. Try again later.");
  }
  if (status >= 300 && status < 400) {
    return new UnraidApiError(
      "REDIRECT_REJECTED",
      "The Unraid endpoint returned a redirect. Configure UNRAID_URL with the final GraphQL URL.",
    );
  }
  return new UnraidApiError("HTTP_ERROR", `The Unraid API returned HTTP ${status}.`);
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

    let response: unknown;
    try {
      response = JSON.parse(raw);
    } catch {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned invalid JSON.");
    }

    if (!isRecord(response)) {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned an invalid response.");
    }
    const errors = response.errors;
    if (errors !== undefined && !Array.isArray(errors)) {
      throw new UnraidApiError("INVALID_RESPONSE", "The Unraid API returned invalid errors.");
    }
    if (errors?.length) {
      const messages = errors
        .slice(0, 10)
        .map((error) =>
          isRecord(error) && typeof error.message === "string"
            ? error.message
            : "Unknown GraphQL error",
        )
        .map((message) => this.redact(message).slice(0, 500));
      const suffix = errors.length > 10 ? "; additional errors omitted" : "";
      const details = `${messages.join("; ")}${suffix}`.slice(0, 2_000);
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
        if (status < 200 || status >= 300) {
          response.destroy();
          fail(statusError(status));
          return;
        }

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
        response.on("end", () => succeed(Buffer.concat(chunks).toString("utf8")));
        response.on("error", fail);
      };

      const options = {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "User-Agent": "unraid-mcp/0.1.0",
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

  private networkError(error: unknown): UnraidApiError {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "UNKNOWN";
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
