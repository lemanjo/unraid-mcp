import { describe, expect, it } from "vitest";
import { Kind, parse } from "graphql";

import {
  UNRAID_API_CATALOG_VERSION,
  UNRAID_API_V4_37_1_GAPS,
  UNRAID_API_V4_37_1_MUTATION_PATHS,
  UNRAID_API_V4_37_1_OPERATIONS,
  UNRAID_API_V4_37_1_ROOT_QUERY_FIELDS,
  UNRAID_API_V4_37_1_SUBSCRIPTIONS,
} from "../src/api-v4.js";
import { apiV4SubscriptionToolName, apiV4ToolName } from "../src/api-v4-tools.js";

function operationDeclaration(document: string): RegExpMatchArray | null {
  return document.match(/^\s*(query|mutation)\s+([_A-Za-z][_0-9A-Za-z]*)([\s\S]*?)\{/);
}

function subscriptionDeclaration(document: string): RegExpMatchArray | null {
  return document.match(/^\s*subscription\s+([_A-Za-z][_0-9A-Za-z]*)([\s\S]*?)\{/);
}

function declaredVariables(document: string): string[] {
  const declaration = operationDeclaration(document)?.[3] ?? "";
  return [...declaration.matchAll(/\$([_A-Za-z][_0-9A-Za-z]*)\s*:/g)]
    .map((match) => match[1] as string)
    .sort();
}

describe("Unraid API v4.37.1 catalog", () => {
  it("has unique stable names and named fixed GraphQL documents", () => {
    const names = UNRAID_API_V4_37_1_OPERATIONS.map((operation) => operation.name);
    expect(new Set(names).size).toBe(names.length);

    for (const operation of UNRAID_API_V4_37_1_OPERATIONS) {
      const parsed = parse(operation.document);
      const definition = parsed.definitions.find(
        (candidate) => candidate.kind === Kind.OPERATION_DEFINITION,
      );
      const declaration = operationDeclaration(operation.document);
      expect(declaration, operation.name).not.toBeNull();
      expect(declaration?.[1], operation.name).toBe(operation.kind);
      expect(declaration?.[2], operation.name).toBe(operation.name);
      expect(operation.document).not.toMatch(/^\s*(query|mutation)\s*\{/);
      expect(definition?.kind, operation.name).toBe(Kind.OPERATION_DEFINITION);
      if (definition?.kind === Kind.OPERATION_DEFINITION) {
        expect(definition.operation, operation.name).toBe(operation.kind);
        expect(definition.name?.value, operation.name).toBe(operation.name);
      }
    }
    const toolNames = [
      ...UNRAID_API_V4_37_1_OPERATIONS.map(apiV4ToolName),
      ...UNRAID_API_V4_37_1_SUBSCRIPTIONS.map((entry) =>
        apiV4SubscriptionToolName(entry.field),
      ),
    ];
    expect(new Set(toolNames).size).toBe(toolNames.length);
    expect(toolNames.every((name) => name.length <= 64)).toBe(true);
  });

  it("declares an exact strict Zod object for document variables, or no-input metadata", () => {
    for (const operation of UNRAID_API_V4_37_1_OPERATIONS) {
      const variables = declaredVariables(operation.document);
      if (operation.inputSchema === null) {
        expect(variables, operation.name).toEqual([]);
        continue;
      }

      expect(Object.keys(operation.inputSchema.shape).sort(), operation.name).toEqual(variables);
      expect(operation.inputSchema.safeParse({ __unexpected: true }).success, operation.name).toBe(false);
    }
  });

  it("has safety, version, schema-path, and description metadata on every operation", () => {
    const safetyClasses = new Set(["read", "routine", "destructive", "sensitive"]);

    for (const operation of UNRAID_API_V4_37_1_OPERATIONS) {
      expect(safetyClasses.has(operation.safety), operation.name).toBe(true);
      expect(operation.minApiVersion, operation.name).toBe(UNRAID_API_CATALOG_VERSION);
      expect(operation.schemaPath.length, operation.name).toBeGreaterThan(0);
      expect(operation.description.length, operation.name).toBeGreaterThan(10);
      if (operation.kind === "mutation") {
        expect(operation.requiresConfirmation, operation.name).toBe(operation.safety !== "routine");
      }
    }

    expect(
      UNRAID_API_V4_37_1_OPERATIONS
        .filter((operation) => operation.kind === "query" && operation.requiresConfirmation)
        .map((operation) => operation.name)
        .sort(),
    ).toEqual([
      "UnraidV4371QueryRclone",
      "UnraidV4371QueryValidateOidcSession",
    ]);
  });

  it("rejects integers outside GraphQL's signed 32-bit range", () => {
    const operation = UNRAID_API_V4_37_1_OPERATIONS.find(
      (candidate) => candidate.name === "UnraidV4371AddDiskToArray",
    );
    expect(operation?.inputSchema).not.toBeNull();
    expect(
      operation?.inputSchema?.safeParse({
        input: { id: "Disk:sda", slot: 2_147_483_648 },
      }).success,
    ).toBe(false);
  });

  it("keeps executable image updates and Connect sign-out behind confirmation", () => {
    for (const name of [
      "UnraidV4371UpdateDockerContainer",
      "UnraidV4371UpdateDockerContainers",
      "UnraidV4371UpdateAllDockerContainers",
      "UnraidV4371ConnectSignOut",
    ]) {
      const operation = UNRAID_API_V4_37_1_OPERATIONS.find((candidate) => candidate.name === name);
      expect(operation?.requiresConfirmation, name).toBe(true);
      expect(operation?.safety, name).not.toBe("routine");
    }
  });

  it("covers every root query field from the tagged schema", () => {
    const coveredRootFields = new Set(
      UNRAID_API_V4_37_1_OPERATIONS
        .filter((operation) => operation.kind === "query")
        .map((operation) => operation.schemaPath.split(".")[0]),
    );

    expect([...coveredRootFields].sort()).toEqual(
      [...UNRAID_API_V4_37_1_ROOT_QUERY_FIELDS].sort(),
    );
    expect(UNRAID_API_V4_37_1_ROOT_QUERY_FIELDS).toHaveLength(58);
  });

  it("covers every direct mutation and effective nested mutation", () => {
    const coveredMutationPaths = new Set(
      UNRAID_API_V4_37_1_OPERATIONS
        .filter((operation) => operation.kind === "mutation")
        .map((operation) => operation.schemaPath),
    );

    expect([...coveredMutationPaths].sort()).toEqual(
      [...UNRAID_API_V4_37_1_MUTATION_PATHS].sort(),
    );
    expect(UNRAID_API_V4_37_1_MUTATION_PATHS).toHaveLength(84);
  });

  it("catalogs subscriptions separately with complete mapping metadata", () => {
    const fields = UNRAID_API_V4_37_1_SUBSCRIPTIONS.map((entry) => entry.field);
    const operationNames = new Set(
      UNRAID_API_V4_37_1_OPERATIONS.map((operation) => operation.name),
    );

    expect(fields).toHaveLength(17);
    expect(new Set(fields).size).toBe(fields.length);
    for (const entry of UNRAID_API_V4_37_1_SUBSCRIPTIONS) {
      expect(entry.minApiVersion).toBe(UNRAID_API_CATALOG_VERSION);
      expect(entry.reason).toContain("long-lived GraphQL subscription");
      const declaration = subscriptionDeclaration(entry.document);
      const parsed = parse(entry.document);
      const definition = parsed.definitions.find(
        (candidate) => candidate.kind === Kind.OPERATION_DEFINITION,
      );
      expect(declaration, entry.field).not.toBeNull();
      expect(definition?.kind, entry.field).toBe(Kind.OPERATION_DEFINITION);
      if (definition?.kind === Kind.OPERATION_DEFINITION) {
        expect(definition.operation, entry.field).toBe("subscription");
      }
      const variables = [...(declaration?.[2] ?? "").matchAll(/\$([_A-Za-z][_0-9A-Za-z]*)\s*:/g)]
        .map((match) => match[1] as string)
        .sort();
      expect(entry.inputSchema ? Object.keys(entry.inputSchema.shape).sort() : [], entry.field).toEqual(
        variables,
      );
      if (entry.requestResponseMapping !== null) {
        expect(operationNames.has(entry.requestResponseMapping), entry.field).toBe(true);
      }
    }
  });

  it("explicitly records schema gaps instead of inventing projections", () => {
    expect(UNRAID_API_V4_37_1_GAPS.length).toBeGreaterThan(0);
    expect(UNRAID_API_V4_37_1_GAPS.flatMap((gap) => gap.fields)).toContain("ApiKey.key");
    expect(UNRAID_API_V4_37_1_GAPS.flatMap((gap) => gap.fields)).toContain(
      "updateSettings.input",
    );
  });
});
