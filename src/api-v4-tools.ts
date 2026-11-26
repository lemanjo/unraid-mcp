import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import {
  UNRAID_API_V4_37_1_OPERATIONS,
  UNRAID_API_V4_37_1_SUBSCRIPTIONS,
  type UnraidApiOperation,
} from "./api-v4.js";
import type { UnraidConfig } from "./config.js";
import { logToStderr } from "./logger.js";
import {
  isApiVersionAtLeast,
  isApiVersionInReleaseRange,
  type GraphQLExecutor,
  type UnraidReadFacade,
} from "./read-facade.js";
import { READ_ONLY_TOOL_ANNOTATIONS } from "./tool-annotations.js";
import { UnraidApiError } from "./unraid-client.js";

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
      logToStderr(`[unraid-mcp] ${error.code}: ${error.message}`);
      return {
        content: [{ type: "text" as const, text: error.message }],
        isError: true,
      };
    }
    logToStderr("[unraid-mcp] Unexpected v4.37.1 tool failure");
    return {
      content: [{ type: "text" as const, text: "Unexpected Unraid MCP error." }],
      isError: true,
    };
  }
}

async function requireCatalogVersion(
  facade: UnraidReadFacade,
  { minApiVersion, maxApiVersion }: Pick<UnraidApiOperation, "minApiVersion" | "maxApiVersion">,
  signal?: AbortSignal,
): Promise<void> {
  // A cached version could predate an upgrade that removed this operation.
  const apiVersion = maxApiVersion
    ? await facade.probeApiVersion(signal)
    : (await facade.getCapabilities(signal)).apiVersion;
  const supported = maxApiVersion
    ? isApiVersionInReleaseRange(apiVersion, minApiVersion, maxApiVersion)
    : isApiVersionAtLeast(apiVersion, minApiVersion);
  if (supported) return;
  const reported =
    apiVersion === "unknown"
      ? "an unknown version"
      : apiVersion.startsWith("v")
        ? apiVersion
        : `v${apiVersion}`;
  const required = maxApiVersion
    ? `v${minApiVersion} through v${maxApiVersion} (stable releases only)`
    : `v${minApiVersion} or newer`;
  throw new UnraidApiError(
    "UNSUPPORTED_API_VERSION",
    `This tool requires Unraid API ${required}; the server reports ${reported}.`,
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
    const description = [
      operation.description,
      operation.maxApiVersion &&
        `Available only on stable Unraid API v${operation.minApiVersion} through v${operation.maxApiVersion}.`,
      confirmationRequired && "Requires explicit confirmation with the exact tool name.",
    ]
      .filter(Boolean)
      .join(" ");

    server.registerTool(
      name,
      {
        title: `Unraid API ${operation.schemaPath}`,
        description,
        inputSchema,
        annotations: operation.annotations,
        _meta: {
          unraidApiVersion: operation.minApiVersion,
          ...(operation.maxApiVersion && { unraidApiMaxVersion: operation.maxApiVersion }),
          unraidSchemaPath: operation.schemaPath,
          unraidSafetyClass: operation.safety,
        },
      },
      (input, context) => {
        const { confirmation: _confirmation, ...variables } = input as Record<string, unknown>;
        return runTool(async () => {
          await requireCatalogVersion(facade, operation, context.mcpReq.signal);
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
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
        _meta: {
          unraidApiVersion: subscription.minApiVersion,
          unraidSubscriptionField: subscription.field,
          unraidSafetyClass: subscription.safety,
        },
      },
      (variables, context) =>
        runTool(async () => {
          await requireCatalogVersion(facade, subscription, context.mcpReq.signal);
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
