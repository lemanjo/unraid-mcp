import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { registerApiV4Tools } from "./api-v4-tools.js";
import type { UnraidConfig } from "./config.js";
import { registerFileTools } from "./file-tools.js";
import { logToStderr } from "./logger.js";
import {
  ARRAY_STATE_MUTATION,
  DOCKER_CONTROL_MUTATIONS,
  NOTIFICATION_MUTATIONS,
  PARITY_MUTATIONS,
  REMOVE_DOCKER_CONTAINER_MUTATION,
  VM_CONTROL_MUTATIONS,
  VM_DESTRUCTIVE_MUTATIONS,
} from "./queries.js";
import {
  type GraphQLExecutor,
  type UnraidReadFacade,
  VersionAwareUnraidReadFacade,
} from "./read-facade.js";
import {
  DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
  IDEMPOTENT_MUTATION_TOOL_ANNOTATIONS,
  READ_ONLY_TOOL_ANNOTATIONS,
} from "./tool-annotations.js";
import { UnraidApiError, UnraidClient } from "./unraid-client.js";

const emptyInputSchema = z.object({}).strict();
const idSchema = z.string().min(1).max(512).describe("Prefixed ID returned by the Unraid API");

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

    logToStderr("[unraid-mcp] Unexpected tool failure");
    return {
      content: [{ type: "text" as const, text: "Unexpected Unraid MCP error." }],
      isError: true,
    };
  }
}

function registerReadTools(server: McpServer, client: UnraidReadFacade): void {
  server.registerTool(
    "unraid_get_system_info",
    {
      title: "Get Unraid system information",
      description:
        "Get Unraid/API versions, host OS, hardware summary, memory modules, and network interfaces.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.getSystemInfo(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_get_metrics",
    {
      title: "Get Unraid live metrics",
      description:
        "Get current CPU, memory, network, swap, and temperature metrics from Unraid.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.getMetrics(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_get_array",
    {
      title: "Get Unraid array status",
      description:
        "Get array state, capacity, parity status, and boot, parity, data, and cache disks.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.getArray(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_list_disks",
    {
      title: "List Unraid physical disks",
      description:
        "List detected and assignable physical disks with identity, SMART summary, temperature, and partitions.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listDisks(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_list_shares",
    {
      title: "List Unraid shares",
      description: "List user shares, capacity, allocation, cache, disk inclusion, and LUKS status.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listShares(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_get_mover_status",
    {
      title: "Get Unraid Mover status",
      description: "Check whether Mover is active. A null value means Unraid did not report its status.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.getMoverStatus(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_list_docker_containers",
    {
      title: "List Unraid Docker containers",
      description:
        "List Docker container state, image, ports, autostart, and port conflicts. Use unraid_list_docker_container_sizes for storage sizes. A null docker result means the inventory is unavailable.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listDockerContainers(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_list_docker_container_sizes",
    {
      title: "List Unraid Docker container storage sizes",
      description:
        "List container IDs, names, and root filesystem, writable layer, and log sizes. This can be slow; use it only when you need sizes. A null docker result means the inventory is unavailable.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listDockerContainerSizes(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_get_docker_logs",
    {
      title: "Get Docker container logs",
      description:
        "Get timestamped logs for one Unraid Docker container. Use the returned cursor as since for the next page.",
      inputSchema: z
        .object({
          id: idSchema.describe("Container ID returned by unraid_list_docker_containers"),
          tail: z.number().int().min(1).max(2_000).default(200).describe("Maximum recent lines"),
          since: z
            .string()
            .datetime({ offset: true })
            .optional()
            .describe("Optional DateTime cursor returned by an earlier log request"),
        })
        .strict(),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    ({ id, tail, since }, context) =>
      runTool(() =>
        client.getDockerLogs({ id, tail, since }, context.mcpReq.signal),
      ),
  );

  server.registerTool(
    "unraid_list_vms",
    {
      title: "List Unraid virtual machines",
      description: "List Unraid VM IDs, names, and lifecycle states. A null vms result means the inventory is unavailable.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listVms(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_get_ups",
    {
      title: "Get Unraid UPS status",
      description:
        "Get connected UPS status, battery, load, voltage, runtime, power, and UPS configuration.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.getUps(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_list_notifications",
    {
      title: "List Unraid notifications",
      description:
        "List unread or archived Unraid notifications and include overview counts and active warnings/alerts.",
      inputSchema: z
        .object({
          type: z.enum(["UNREAD", "ARCHIVE"]).default("UNREAD"),
          importance: z.enum(["INFO", "WARNING", "ALERT"]).optional(),
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(200).default(50),
        })
        .strict(),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    ({ type, importance, offset, limit }, context) =>
      runTool(() =>
        client.listNotifications({
          filter: { type, importance, offset, limit },
        }, context.mcpReq.signal),
      ),
  );

  server.registerTool(
    "unraid_list_system_logs",
    {
      title: "List Unraid system logs",
      description: "List system log files available through the Unraid API.",
      inputSchema: emptyInputSchema,
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    (_input, context) => runTool(() => client.listSystemLogs(context.mcpReq.signal)),
  );

  server.registerTool(
    "unraid_read_system_log",
    {
      title: "Read an Unraid system log",
      description:
        "Read a bounded section of a system log. First obtain its API-provided path with unraid_list_system_logs.",
      inputSchema: z
        .object({
          path: z.string().min(1).max(1_024).describe("Exact path returned by unraid_list_system_logs"),
          lines: z.number().int().min(1).max(5_000).default(200),
          startLine: z.number().int().min(0).optional(),
        })
        .strict(),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
    },
    ({ path, lines, startLine }, context) =>
      runTool(() =>
        client.readSystemLog({ path, lines, startLine }, context.mcpReq.signal),
      ),
  );
}

function registerMutationTools(
  server: McpServer,
  client: GraphQLExecutor,
  config: UnraidConfig,
): void {
  server.registerTool(
    "unraid_control_array",
    {
      title: "Start or stop the Unraid array",
      description: "Set the Unraid array state. Stopping the array interrupts storage services.",
      inputSchema: z
        .object({
          action: z.enum(["START", "STOP"]),
          confirmation: z.literal("STOP_ARRAY").optional(),
        })
        .strict(),
      // Tool annotations cover the destructive STOP branch, not only the safer START branch.
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ action, confirmation }, context) => {
      if (
        action === "STOP" &&
        (!config.allowDestructiveMutations || confirmation !== "STOP_ARRAY")
      ) {
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: "Stopping the array requires UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS=true and confirmation=STOP_ARRAY.",
            },
          ],
          isError: true,
        });
      }
      return runTool(() =>
        client.execute(
          ARRAY_STATE_MUTATION,
          { input: { desiredState: action } },
          context.mcpReq.signal,
        ),
      );
    },
  );

  server.registerTool(
    "unraid_control_parity_check",
    {
      title: "Control an Unraid parity check",
      description:
        "Start, pause, resume, or cancel a parity check. START with correct=true writes parity corrections and requires destructive mutations to be enabled.",
      inputSchema: z
        .object({
          action: z.enum(["START", "PAUSE", "RESUME", "CANCEL"]),
          correct: z
            .boolean()
            .default(false)
            .describe("For START only: write corrections when parity errors are found"),
          confirmation: z
            .enum(["WRITE_PARITY_CORRECTIONS", "CANCEL_PARITY_CHECK"])
            .optional(),
        })
        .strict(),
      // Correcting START and CANCEL make this mixed-action tool destructive and non-idempotent.
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ action, correct, confirmation }, context) => {
      if (
        action === "START" &&
        correct &&
        (!config.allowDestructiveMutations || confirmation !== "WRITE_PARITY_CORRECTIONS")
      ) {
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: "Parity correction requires UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS=true and confirmation=WRITE_PARITY_CORRECTIONS.",
            },
          ],
          isError: true,
        });
      }
      if (
        action === "CANCEL" &&
        (!config.allowDestructiveMutations || confirmation !== "CANCEL_PARITY_CHECK")
      ) {
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: "Cancelling a parity check requires UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS=true and confirmation=CANCEL_PARITY_CHECK.",
            },
          ],
          isError: true,
        });
      }
      const variables = action === "START" ? { correct } : {};
      return runTool(() =>
        client.execute(PARITY_MUTATIONS[action], variables, context.mcpReq.signal),
      );
    },
  );

  server.registerTool(
    "unraid_control_docker_container",
    {
      title: "Control an Unraid Docker container",
      description:
        "Start, stop, pause, unpause, or update one existing Docker container. UPDATE replaces executable image content and requires the destructive gate and explicit confirmation.",
      inputSchema: z
        .object({
          id: idSchema.describe("Container ID returned by unraid_list_docker_containers"),
          action: z.enum(["START", "STOP", "PAUSE", "UNPAUSE", "UPDATE"]),
          confirmation: z.literal("UPDATE_DOCKER_CONTAINER").optional(),
        })
        .strict(),
      // UPDATE replaces executable image content, so the combined tool uses conservative hints.
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ id, action, confirmation }, context) => {
      if (
        action === "UPDATE" &&
        (!config.allowDestructiveMutations || confirmation !== "UPDATE_DOCKER_CONTAINER")
      ) {
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: "Updating a container image requires UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS=true and confirmation=UPDATE_DOCKER_CONTAINER.",
            },
          ],
          isError: true,
        });
      }
      return runTool(() =>
        client.execute(DOCKER_CONTROL_MUTATIONS[action], { id }, context.mcpReq.signal),
      );
    },
  );

  server.registerTool(
    "unraid_control_vm",
    {
      title: "Control an Unraid virtual machine",
      description:
        "Start, stop, pause, resume, or reboot one existing Unraid VM. STOP can fall back to a forced shutdown if graceful shutdown times out, risking unsaved guest data.",
      inputSchema: z
        .object({
          id: idSchema.describe("VM ID returned by unraid_list_vms"),
          action: z.enum(["START", "STOP", "PAUSE", "RESUME", "REBOOT"]),
        })
        .strict(),
      // STOP may fall back to forced destruction, and REBOOT is not idempotent.
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ id, action }, context) =>
      runTool(() =>
        client.execute(VM_CONTROL_MUTATIONS[action], { id }, context.mcpReq.signal),
      ),
  );

  server.registerTool(
    "unraid_manage_notifications",
    {
      title: "Archive or unarchive Unraid notifications",
      description: "Archive or unarchive one or more Unraid notifications by ID.",
      inputSchema: z
        .object({
          ids: z.array(idSchema).min(1).max(100),
          action: z.enum(["ARCHIVE", "UNARCHIVE"]),
        })
        .strict(),
      // Batch retries ignore notifications already moved to the requested state.
      annotations: IDEMPOTENT_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ ids, action }, context) =>
      runTool(() =>
        client.execute(NOTIFICATION_MUTATIONS[action], { ids }, context.mcpReq.signal),
      ),
  );
}

function registerDestructiveTools(server: McpServer, client: GraphQLExecutor): void {
  server.registerTool(
    "unraid_remove_docker_container",
    {
      title: "Remove an Unraid Docker container",
      description:
        "Permanently remove a Docker container and optionally its image. This does not remove appdata.",
      inputSchema: z
        .object({
          id: idSchema.describe("Container ID returned by unraid_list_docker_containers"),
          withImage: z.boolean().default(false),
          confirmation: z.literal("REMOVE_DOCKER_CONTAINER"),
        })
        .strict(),
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ id, withImage }, context) =>
      runTool(() =>
        client.execute(
          REMOVE_DOCKER_CONTAINER_MUTATION,
          { id, withImage },
          context.mcpReq.signal,
        ),
      ),
  );

  server.registerTool(
    "unraid_force_vm",
    {
      title: "Force stop or reset an Unraid VM",
      description:
        "Force stop or reset an existing VM without a graceful guest shutdown. Unsaved guest data can be lost.",
      inputSchema: z
        .object({
          id: idSchema.describe("VM ID returned by unraid_list_vms"),
          action: z.enum(["FORCE_STOP", "RESET"]),
          confirmation: z.literal("FORCE_VM_ACTION"),
        })
        .strict(),
      annotations: DESTRUCTIVE_MUTATION_TOOL_ANNOTATIONS,
    },
    ({ id, action }, context) =>
      runTool(() =>
        client.execute(VM_DESTRUCTIVE_MUTATIONS[action], { id }, context.mcpReq.signal),
      ),
  );
}

export function createServer(
  config: UnraidConfig,
  client: GraphQLExecutor = new UnraidClient(config),
): McpServer {
  const server = new McpServer({
    name: "unraid-mcp",
    version: "1.1.1",
  });
  const readFacade = new VersionAwareUnraidReadFacade(client);

  registerReadTools(server, readFacade);
  if (config.allowMutations) registerMutationTools(server, client, config);
  if (config.allowMutations && config.allowDestructiveMutations) {
    registerDestructiveTools(server, client);
  }
  registerApiV4Tools(server, client, readFacade, config);
  registerFileTools(server, config.files);

  return server;
}
