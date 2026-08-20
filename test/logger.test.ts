import { describe, expect, it, vi } from "vitest";

import { createTimestampedLogger } from "../src/logger.js";

describe("createTimestampedLogger", () => {
  it("prefixes each message with an ISO-8601 UTC timestamp", () => {
    const sink = vi.fn();
    const logger = createTimestampedLogger(
      sink,
      () => new Date("2026-08-20T06:40:02.531Z"),
    );

    logger("[unraid-mcp] Listening on stdio (read-only).");

    expect(sink).toHaveBeenCalledWith(
      "2026-08-20T06:40:02.531Z [unraid-mcp] Listening on stdio (read-only).",
    );
  });
});
