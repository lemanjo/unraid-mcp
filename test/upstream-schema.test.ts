import { buildSchema, isNonNullType, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";

import { UNRAID_API_V4_37_1_OPERATIONS, UNRAID_API_V4_37_1_SUBSCRIPTIONS } from "../src/api-v4.js";
import { DOCKER_CONTAINERS_QUERY, DOCKER_LOGS_QUERY, MOVER_STATUS_QUERY, VMS_QUERY } from "../src/queries.js";

// Opt in to network access; the default test suite runs offline.
describe.runIf(process.env.UNRAID_TEST_UPSTREAM_SCHEMAS === "1")("tagged Unraid schemas", () => {
  it.each([
    { version: "4.37.1", diskRemoval: true, nullableInventories: false },
    { version: "4.37.3", diskRemoval: true, nullableInventories: false },
    { version: "4.37.4", diskRemoval: false, nullableInventories: false },
    { version: "4.37.8", diskRemoval: false, nullableInventories: true },
    { version: "4.37.12", diskRemoval: false, nullableInventories: true },
  ])("validates the catalog against API v$version", async ({ version, diskRemoval, nullableInventories }) => {
    const url = `https://raw.githubusercontent.com/unraid/api/v${version}/api/generated-schema.graphql`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Cannot fetch schema v${version}: HTTP ${res.status}`);
    const schema = buildSchema(await res.text());
    const invalid = [
      ...UNRAID_API_V4_37_1_OPERATIONS.map(({ name, document }) => ({ name, document })),
      ...UNRAID_API_V4_37_1_SUBSCRIPTIONS.map(({ field, document }) => ({ name: field, document })),
    ].flatMap(({ name, document }) => validate(schema, parse(document)).map((error) => ({
      name, message: error.message,
    })));
    expect(invalid).toEqual(diskRemoval ? [] : [{
      name: "UnraidV4371RemoveDiskFromArray",
      message: expect.stringContaining('Cannot query field "removeDiskFromArray"'),
    }]);

    const fields = schema.getQueryType()!.getFields();
    for (const name of ["docker", "vms"]) {
      expect(isNonNullType(fields[name]!.type), name).toBe(!nullableInventories);
    }
    for (const document of [MOVER_STATUS_QUERY, DOCKER_CONTAINERS_QUERY, DOCKER_LOGS_QUERY, VMS_QUERY]) {
      expect(validate(schema, parse(document)), document).toEqual([]);
    }
  }, 15_000);
});
