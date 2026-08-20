import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  UNRAID_API_CATALOG_VERSION,
  UNRAID_API_V4_37_1_OPERATIONS,
  UNRAID_API_V4_37_1_SUBSCRIPTIONS,
  type UnraidApiOperation,
} from "./api-v4.js";
import type { UnraidConfig } from "./config.js";
import {
  isApiVersionAtLeast,
  type GraphQLExecutor,
  type UnraidReadFacade,
} from "./read-facade.js";
import { UnraidApiError } from "./unraid-client.js";

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

function operationAnnotations(operation: UnraidApiOperation) {
  if (operation.kind === "query") return readAnnotations;
  return {
    readOnlyHint: false,
    destructiveHint: operation.safety !== "routine",
    idempotentHint: false,
  } as const;
}

export function apiV4ToolName(operation: UnraidApiOperation): string {
  const suffix = operation.name
    .replace(/^UnraidV4371/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return `unraid_v4371_${suffix}`;
}

export function apiV4SubscriptionToolName(field: string): string {
  const suffix = field.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return `unraid_v4371_next_${suffix}`;
}

function requiresConfirmation(operation: UnraidApiOperation): boolean {
  return operation.requiresConfirmation;
}

function isEnabled(operation: UnraidApiOperation, config: UnraidConfig): boolean {
  if (operation.kind === "query") {
    return (
      !operation.requiresConfirmation ||
      (config.allowMutations && config.allowDestructiveMutations)
    );
  }
  if (!config.allowMutations) return false;
  return operation.safety === "routine" || config.allowDestructiveMutations;
}

function success(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

async function runTool(operation: () => Promise<Record<string, unknown>>) {
  try {
    return success(await operation());
  } catch (error) {
    if (error instanceof UnraidApiError) {
      console.error(`[unraid-mcp] ${error.code}: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: error.message }],
        isError: true,
      };
    }
    console.error("[unraid-mcp] Unexpected v4.37.1 tool failure");
    return {
      content: [{ type: "text" as const, text: "Unexpected Unraid MCP error." }],
      isError: true,
    };
  }
}

async function requireCatalogVersion(
  facade: UnraidReadFacade,
  signal?: AbortSignal,
): Promise<void> {
  const { apiVersion } = await facade.getCapabilities(signal);
  if (isApiVersionAtLeast(apiVersion, UNRAID_API_CATALOG_VERSION)) return;
  const reported =
    apiVersion === "unknown"
      ? "an unknown version"
      : apiVersion.startsWith("v")
        ? apiVersion
        : `v${apiVersion}`;
  throw new UnraidApiError(
    "UNSUPPORTED_API_VERSION",
    `This tool requires Unraid API v${UNRAID_API_CATALOG_VERSION} or newer; the server reports ${reported}.`,
  );
}

export function registerApiV4Tools(
  server: McpServer,
  executor: GraphQLExecutor,
  facade: UnraidReadFacade,
  config: UnraidConfig,
): void {
  for (const operation of UNRAID_API_V4_37_1_OPERATIONS) {
    if (!isEnabled(operation, config)) continue;

    const name = apiV4ToolName(operation);
    const confirmationRequired = requiresConfirmation(operation);
    const baseSchema = operation.inputSchema ?? z.object({}).strict();
    const inputSchema = confirmationRequired
      ? baseSchema.extend({
          confirmation: z
            .literal(name)
            .describe(`Required acknowledgement: set exactly to ${name}`),
        })
      : baseSchema;
    const description = confirmationRequired
      ? `${operation.description} Requires explicit confirmation with the exact tool name.`
      : operation.description;

    server.registerTool(
      name,
      {
        title: `Unraid API ${operation.schemaPath}`,
        description,
        inputSchema,
        annotations: operationAnnotations(operation),
        _meta: {
          unraidApiVersion: operation.minApiVersion,
          unraidSchemaPath: operation.schemaPath,
          unraidSafetyClass: operation.safety,
        },
      },
      (input, context) => {
        const { confirmation: _confirmation, ...variables } = input as Record<string, unknown>;
        return runTool(async () => {
          await requireCatalogVersion(facade, context.mcpReq.signal);
          try {
            return await executor.execute(operation.document, variables, context.mcpReq.signal);
          } catch (error) {
            if (
              operation.safety === "sensitive" &&
              error instanceof UnraidApiError &&
              [
                "AUTHENTICATION_FAILED",
                "GRAPHQL_ERROR",
                "HTTP_ERROR",
                "PERMISSION_DENIED",
                "RATE_LIMITED",
              ].includes(error.code)
            ) {
              throw new UnraidApiError(
                error.code,
                `Unraid rejected sensitive operation ${operation.schemaPath}; response details were omitted to avoid disclosing supplied credentials or settings.`,
              );
            }
            throw error;
          }
        });
      },
    );
  }

  for (const subscription of UNRAID_API_V4_37_1_SUBSCRIPTIONS) {
    const name = apiV4SubscriptionToolName(subscription.field);
    const inputSchema = subscription.inputSchema ?? z.object({}).strict();
    server.registerTool(
      name,
      {
        title: `Next Unraid ${subscription.field} event`,
        description:
          "Wait for the next event from this fixed GraphQL subscription, return one bounded payload, then disconnect.",
        inputSchema,
        annotations: readAnnotations,
        _meta: {
          unraidApiVersion: subscription.minApiVersion,
          unraidSubscriptionField: subscription.field,
          unraidSafetyClass: subscription.safety,
        },
      },
      (variables, context) =>
        runTool(async () => {
          await requireCatalogVersion(facade, context.mcpReq.signal);
          if (!executor.subscribeOnce) {
            throw new UnraidApiError(
              "SUBSCRIPTIONS_UNAVAILABLE",
              "This GraphQL executor does not support WebSocket subscriptions.",
            );
          }
          return executor.subscribeOnce(
            subscription.document,
            variables as Record<string, unknown>,
            context.mcpReq.signal,
          );
        }),
    );
  }
}
