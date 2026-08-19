import { type AddressInfo } from "node:net";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, describe, expect, it } from "vitest";

import type { UnraidConfig } from "../src/config.js";
import { UnraidApiError, UnraidClient } from "../src/unraid-client.js";

const servers: ReturnType<typeof createServer>[] = [];

async function listen(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<URL> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/graphql`);
}

function config(endpoint: URL, overrides: Partial<UnraidConfig> = {}): UnraidConfig {
  return {
    endpoint,
    apiKey: "secret-test-key",
    timeoutMs: 1_000,
    maxResponseBytes: 10_000,
    ca: undefined,
    rejectUnauthorized: true,
    allowMutations: false,
    allowDestructiveMutations: false,
    ...overrides,
  };
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        ),
    ),
  );
});

describe("UnraidClient", () => {
  it("sends the API key, query, and variables to GraphQL", async () => {
    const endpoint = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        expect(request.method).toBe("POST");
        expect(request.url).toBe("/graphql");
        expect(request.headers["x-api-key"]).toBe("secret-test-key");
        expect(JSON.parse(Buffer.concat(chunks).toString())).toEqual({
          query: "query Test($id: ID!) { thing(id: $id) }",
          variables: { id: "thing-1" },
        });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ data: { thing: { id: "thing-1" } } }));
      });
    });

    const client = new UnraidClient(config(endpoint));
    await expect(
      client.execute("query Test($id: ID!) { thing(id: $id) }", { id: "thing-1" }),
    ).resolves.toEqual({ thing: { id: "thing-1" } });
  });

  it("redacts the API key from GraphQL errors", async () => {
    const endpoint = await listen((_request, response) => {
      response.end(
        JSON.stringify({ errors: [{ message: "invalid secret-test-key in request" }] }),
      );
    });

    const client = new UnraidClient(config(endpoint));
    await expect(client.execute("query Test { info { id } }")).rejects.toMatchObject({
      code: "GRAPHQL_ERROR",
      message: "Unraid GraphQL error: invalid [REDACTED] in request",
    });
  });

  it("rejects redirects instead of forwarding the API key", async () => {
    const endpoint = await listen((_request, response) => {
      response.statusCode = 302;
      response.setHeader("location", "http://example.test/graphql");
      response.end();
    });

    const client = new UnraidClient(config(endpoint));
    await expect(client.execute("query Test { online }")).rejects.toEqual(
      new UnraidApiError(
        "REDIRECT_REJECTED",
        "The Unraid endpoint returned a redirect. Configure UNRAID_URL with the final GraphQL URL.",
      ),
    );
  });

  it("enforces the configured response limit", async () => {
    const endpoint = await listen((_request, response) => {
      response.end(JSON.stringify({ data: { value: "x".repeat(1_000) } }));
    });

    const client = new UnraidClient(config(endpoint, { maxResponseBytes: 100 }));
    await expect(client.execute("query Test { value }")).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
  });

  it("uses an absolute timeout even while response data is arriving", async () => {
    const endpoint = await listen((_request, response) => {
      response.write('{"data":{"value":"');
      const interval = setInterval(() => response.write("x"), 10);
      response.on("close", () => clearInterval(interval));
    });

    const client = new UnraidClient(config(endpoint, { timeoutMs: 50 }));
    const startedAt = Date.now();
    await expect(client.execute("query Test { value }")).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(Date.now() - startedAt).toBeLessThan(250);
  });

  it("cancels an in-flight request with an AbortSignal", async () => {
    const endpoint = await listen((_request, response) => {
      response.write('{"data":');
    });
    const controller = new AbortController();
    const client = new UnraidClient(config(endpoint));

    const result = client.execute("query Test { value }", {}, controller.signal);
    controller.abort();

    await expect(result).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("rejects malformed GraphQL error payloads safely", async () => {
    const endpoint = await listen((_request, response) => {
      response.end(JSON.stringify({ errors: "not-an-array" }));
    });

    const client = new UnraidClient(config(endpoint));
    await expect(client.execute("query Test { value }")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("bounds aggregate GraphQL error output", async () => {
    const endpoint = await listen((_request, response) => {
      response.end(
        JSON.stringify({ errors: Array.from({ length: 1_000 }, () => ({ message: "x".repeat(500) })) }),
      );
    });

    const client = new UnraidClient(config(endpoint, { maxResponseBytes: 1_000_000 }));
    const error = await client.execute("query Test { value }").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnraidApiError);
    expect((error as UnraidApiError).message.length).toBeLessThanOrEqual(2_025);
  });
});
