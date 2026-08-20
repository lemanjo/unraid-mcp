import {
  ARRAY_COMPAT_QUERY,
  ARRAY_QUERY,
  DISK_SECTOR_SIZES_QUERY,
  DISKS_QUERY,
  DOCKER_CONTAINERS_QUERY,
  DOCKER_LOGS_QUERY,
  METRICS_QUERY,
  NETWORK_METRICS_QUERY,
  NOTIFICATIONS_QUERY,
  SHARES_QUERY,
  SYSTEM_INFO_QUERY,
  SYSTEM_INFO_COMPAT_QUERY,
  SYSTEM_LOG_QUERY,
  SYSTEM_LOGS_QUERY,
  SYSTEM_NETWORK_COMPAT_QUERY,
  SYSTEM_NETWORK_QUERY,
  TEMPERATURE_METRICS_QUERY,
  UPS_CONFIGURATION_QUERY,
  UPS_DEVICES_COMPAT_QUERY,
  UPS_DEVICES_QUERY,
  VMS_QUERY,
} from "./queries.js";
import { UnraidApiError } from "./unraid-client.js";

export interface GraphQLExecutor {
  execute(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  subscribeOnce?(
    query: string,
    variables?: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
}

export interface UnraidApiCapabilities {
  apiVersion: string;
  modernSystemInfo: boolean;
  networkInfo: boolean;
  modernNetworkInfo: boolean;
  networkMetrics: boolean;
  temperatureMetrics: boolean;
  modernVmDomains: boolean;
  modernUpsPower: boolean;
  diskSectorSize: boolean;
}

export interface UnraidReadFacade {
  getCapabilities(signal?: AbortSignal): Promise<UnraidApiCapabilities>;
  getSystemInfo(signal?: AbortSignal): Promise<Record<string, unknown>>;
  getMetrics(signal?: AbortSignal): Promise<Record<string, unknown>>;
  getArray(signal?: AbortSignal): Promise<Record<string, unknown>>;
  listDisks(signal?: AbortSignal): Promise<Record<string, unknown>>;
  listShares(signal?: AbortSignal): Promise<Record<string, unknown>>;
  listDockerContainers(signal?: AbortSignal): Promise<Record<string, unknown>>;
  getDockerLogs(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  listVms(signal?: AbortSignal): Promise<Record<string, unknown>>;
  getUps(signal?: AbortSignal): Promise<Record<string, unknown>>;
  listNotifications(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
  listSystemLogs(signal?: AbortSignal): Promise<Record<string, unknown>>;
  readSystemLog(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>;
}

export const API_CAPABILITIES_QUERY = /* GraphQL */ `
  query McpApiCapabilities {
    services { name version }
  }
`;

export const API_VERSION_INFO_QUERY = /* GraphQL */ `
  query McpApiVersionFromInfo {
    info { versions { core { api } } }
  }
`;

export const API_VERSION_SETTINGS_QUERY = /* GraphQL */ `
  query McpApiVersionFromSettings {
    settings { api { version } }
  }
`;

export const VMS_COMPAT_QUERY = /* GraphQL */ `
  query McpVmsCompat {
    vms { domains: domain { id: uuid name state } }
  }
`;

export type GraphQLErrorKind = "schema-validation" | "permission-or-runtime" | "other";

interface SemanticVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | undefined;
}

const VERSION_4_15_0: SemanticVersion = {
  major: 4,
  minor: 15,
  patch: 0,
  prerelease: undefined,
};

const VERSION_4_14_0: SemanticVersion = {
  major: 4,
  minor: 14,
  patch: 0,
  prerelease: undefined,
};

const VERSION_4_30_0: SemanticVersion = {
  major: 4,
  minor: 30,
  patch: 0,
  prerelease: undefined,
};

const VERSION_4_35_0: SemanticVersion = {
  major: 4,
  minor: 35,
  patch: 0,
  prerelease: undefined,
};

const SCHEMA_VALIDATION_PATTERNS = [
  /Cannot query field "[^"]+" on type "[^"]+"/i,
  /Unknown argument "[^"]+" on field "[^"]+"/i,
  /Unknown type "[^"]+"/i,
  /Field "[^"]+" of type "[^"]+" must have a selection of subfields/i,
  /Field "[^"]+" must not have a selection since type "[^"]+" has no subfields/i,
  /Variable "\$[^"]+" of type "[^"]+" used in position expecting type "[^"]+"/i,
  /Field "[^"]+" argument "[^"]+" of type "[^"]+" is required, but it was not provided/i,
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseSemanticVersion(value: string): SemanticVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    value.trim(),
  );
  if (!match) return undefined;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;

  return { major, minor, patch, prerelease: match[4] };
}

function isAtLeast(version: SemanticVersion, minimum: SemanticVersion): boolean {
  if (version.major !== minimum.major) return version.major > minimum.major;
  if (version.minor !== minimum.minor) return version.minor > minimum.minor;
  if (version.patch !== minimum.patch) return version.patch > minimum.patch;
  if (version.prerelease !== undefined && minimum.prerelease === undefined) return false;
  return true;
}

export function isApiVersionAtLeast(value: string, minimum: string): boolean {
  const version = parseSemanticVersion(value);
  const required = parseSemanticVersion(minimum);
  return version !== undefined && required !== undefined && isAtLeast(version, required);
}

function requiredRecord(
  data: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = data[field];
  if (!isRecord(value)) {
    throw new UnraidApiError(
      "INVALID_RESPONSE",
      `The Unraid API response did not contain a valid ${field} field.`,
    );
  }
  return value;
}

function mergeNestedFragments(
  base: Record<string, unknown>,
  field: string,
  fragments: Array<Record<string, unknown> | undefined>,
): Record<string, unknown> {
  const merged = { ...requiredRecord(base, field) };
  for (const fragment of fragments) {
    if (fragment) Object.assign(merged, requiredRecord(fragment, field));
  }
  return { ...base, [field]: merged };
}

function isDisabledUpsConfiguration(configuration: Record<string, unknown>): boolean {
  return (
    typeof configuration.service === "string" &&
    configuration.service.trim().toLowerCase() === "disable"
  );
}

function isDisabledVmError(error: unknown): boolean {
  if (
    !isRecord(error) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    ["AUTHENTICATION_FAILED", "PERMISSION_DENIED"].includes(error.code)
  ) {
    return false;
  }
  return /\b(?:VMs?|VM Manager|libvirt)\b[^;\n]*(?:not available|not enabled|is disabled|not running)/i.test(
    error.message,
  );
}

function isDiscoveryUnavailable(error: unknown): boolean {
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") {
    return false;
  }
  if (error.code === "PERMISSION_DENIED" || classifyGraphQLError(error) === "schema-validation") {
    return true;
  }
  return /\b(?:forbidden|permission|not authorized|access denied)\b/i.test(error.message);
}

function isDiskSectorNullabilityError(error: unknown): boolean {
  return (
    isRecord(error) &&
    typeof error.message === "string" &&
    /Cannot return null for non-nullable field Disk\.bytesPerSector\b/i.test(error.message)
  );
}

function mergeArrayFields(
  base: Record<string, unknown>,
  fragment: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result = { ...base };
  for (const field of fields) {
    const baseItems = base[field];
    const fragmentItems = fragment[field];
    if (!Array.isArray(baseItems) || !Array.isArray(fragmentItems)) continue;
    const additions = new Map(
      fragmentItems
        .filter(isRecord)
        .filter((item) => typeof item.id === "string")
        .map((item) => [item.id, item]),
    );
    result[field] = baseItems.map((item) =>
      isRecord(item) && typeof item.id === "string"
        ? { ...item, ...additions.get(item.id) }
        : item,
    );
  }
  return result;
}

export function classifyGraphQLError(error: unknown): GraphQLErrorKind {
  if (!isRecord(error) || typeof error.code !== "string" || typeof error.message !== "string") {
    return "other";
  }
  if (error.code === "GRAPHQL_VALIDATION_FAILED") return "schema-validation";
  const message = error.message;
  return SCHEMA_VALIDATION_PATTERNS.some((pattern) => pattern.test(message))
    ? "schema-validation"
    : "permission-or-runtime";
}

export class VersionAwareUnraidReadFacade implements UnraidReadFacade {
  private capabilitiesPromise: Promise<UnraidApiCapabilities> | undefined;
  private readonly unavailableCapabilities = new Set<keyof UnraidApiCapabilities>();

  constructor(private readonly executor: GraphQLExecutor) {}

  getCapabilities(signal?: AbortSignal): Promise<UnraidApiCapabilities> {
    if (!this.capabilitiesPromise) {
      const pending = this.discoverCapabilities();
      this.capabilitiesPromise = pending;
      void pending.catch(() => {
        if (this.capabilitiesPromise === pending) this.capabilitiesPromise = undefined;
      });
    }
    return signal ? this.waitForCapabilities(this.capabilitiesPromise, signal) : this.capabilitiesPromise;
  }

  async getSystemInfo(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const capabilities = await this.getCapabilities(signal);
    const [base, network] = await Promise.all([
      this.getSystemInfoBase(capabilities, signal),
      this.supports(capabilities, "networkInfo")
        ? this.getSystemNetwork(capabilities, signal)
        : Promise.resolve(undefined),
    ]);
    return network ? mergeNestedFragments(base, "info", [network]) : base;
  }

  async getMetrics(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const capabilities = await this.getCapabilities(signal);
    const temperature = this.supports(capabilities, "temperatureMetrics")
      ? this.optionalFragment(TEMPERATURE_METRICS_QUERY, "temperatureMetrics", signal)
      : Promise.resolve(undefined);
    const network = this.supports(capabilities, "networkMetrics")
      ? this.optionalFragment(NETWORK_METRICS_QUERY, "networkMetrics", signal)
      : Promise.resolve(undefined);
    const [base, temperatureFragment, networkFragment] = await Promise.all([
      this.executor.execute(METRICS_QUERY, {}, signal),
      temperature,
      network,
    ]);
    return mergeNestedFragments(base, "metrics", [temperatureFragment, networkFragment]);
  }

  async getArray(signal?: AbortSignal): Promise<Record<string, unknown>> {
    await this.getCapabilities(signal);
    try {
      return await this.executor.execute(ARRAY_QUERY, {}, signal);
    } catch (error) {
      if (classifyGraphQLError(error) !== "schema-validation") throw error;
      return this.executor.execute(ARRAY_COMPAT_QUERY, {}, signal);
    }
  }

  async listDisks(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const capabilities = await this.getCapabilities(signal);
    const base = await this.executor.execute(DISKS_QUERY, {}, signal);
    if (!this.supports(capabilities, "diskSectorSize")) return base;
    try {
      const sectorSizes = await this.executor.execute(DISK_SECTOR_SIZES_QUERY, {}, signal);
      return mergeArrayFields(base, sectorSizes, ["disks", "assignableDisks"]);
    } catch (error) {
      if (
        classifyGraphQLError(error) !== "schema-validation" &&
        !isDiskSectorNullabilityError(error)
      ) {
        throw error;
      }
      this.unavailableCapabilities.add("diskSectorSize");
      return base;
    }
  }

  listShares(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.executeFixed(SHARES_QUERY, {}, signal);
  }

  listDockerContainers(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.executeFixed(DOCKER_CONTAINERS_QUERY, {}, signal);
  }

  getDockerLogs(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.executeFixed(DOCKER_LOGS_QUERY, variables, signal);
  }

  async listVms(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const capabilities = await this.getCapabilities(signal);
    const modern = this.supports(capabilities, "modernVmDomains");
    const primary = modern ? VMS_QUERY : VMS_COMPAT_QUERY;
    const fallback = modern ? VMS_COMPAT_QUERY : VMS_QUERY;

    try {
      return await this.executor.execute(primary, {}, signal);
    } catch (error) {
      if (isDisabledVmError(error)) return { vms: { domains: [] } };
      if (classifyGraphQLError(error) !== "schema-validation") throw error;
      if (modern) this.unavailableCapabilities.add("modernVmDomains");
    }

    try {
      return await this.executor.execute(fallback, {}, signal);
    } catch (error) {
      if (isDisabledVmError(error)) return { vms: { domains: [] } };
      throw error;
    }
  }

  async getUps(signal?: AbortSignal): Promise<Record<string, unknown>> {
    await this.getCapabilities(signal);
    const configurationData = await this.executor.execute(UPS_CONFIGURATION_QUERY, {}, signal);
    const configuration = requiredRecord(configurationData, "upsConfiguration");
    if (isDisabledUpsConfiguration(configuration)) {
      return { upsDevices: [], ...configurationData };
    }

    const modern = this.supports(await this.getCapabilities(signal), "modernUpsPower");
    let devicesData: Record<string, unknown>;
    try {
      devicesData = await this.executor.execute(
        modern ? UPS_DEVICES_QUERY : UPS_DEVICES_COMPAT_QUERY,
        {},
        signal,
      );
    } catch (error) {
      if (!modern || classifyGraphQLError(error) !== "schema-validation") throw error;
      this.unavailableCapabilities.add("modernUpsPower");
      devicesData = await this.executor.execute(UPS_DEVICES_COMPAT_QUERY, {}, signal);
    }
    return { ...devicesData, ...configurationData };
  }

  listNotifications(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.executeFixed(NOTIFICATIONS_QUERY, variables, signal);
  }

  listSystemLogs(signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.executeFixed(SYSTEM_LOGS_QUERY, {}, signal);
  }

  readSystemLog(
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.executeFixed(SYSTEM_LOG_QUERY, variables, signal);
  }

  private async discoverCapabilities(signal?: AbortSignal): Promise<UnraidApiCapabilities> {
    const apiVersion = await this.discoverApiVersion(signal);
    const version = apiVersion === "unknown" ? undefined : parseSemanticVersion(apiVersion);

    return Object.freeze({
      apiVersion,
      modernSystemInfo: version ? isAtLeast(version, VERSION_4_15_0) : true,
      networkInfo: version ? isAtLeast(version, VERSION_4_30_0) : true,
      modernNetworkInfo: version ? isAtLeast(version, VERSION_4_35_0) : true,
      networkMetrics: version ? isAtLeast(version, VERSION_4_35_0) : true,
      temperatureMetrics: version ? isAtLeast(version, VERSION_4_30_0) : true,
      modernVmDomains: version ? isAtLeast(version, VERSION_4_30_0) : true,
      modernUpsPower: version ? isAtLeast(version, VERSION_4_30_0) : true,
      diskSectorSize: version ? isAtLeast(version, VERSION_4_14_0) : true,
    });
  }

  private waitForCapabilities(
    capabilities: Promise<UnraidApiCapabilities>,
    signal: AbortSignal,
  ): Promise<UnraidApiCapabilities> {
    if (signal.aborted) {
      return Promise.reject(new UnraidApiError("CANCELLED", "The Unraid request was cancelled."));
    }
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        reject(new UnraidApiError("CANCELLED", "The Unraid request was cancelled."));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      void capabilities.then(
        (value) => {
          signal.removeEventListener("abort", onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }

  private async discoverApiVersion(signal?: AbortSignal): Promise<string> {
    try {
      const data = await this.executor.execute(API_CAPABILITIES_QUERY, {}, signal);
      if (Array.isArray(data.services)) {
        const service = data.services.find(
          (candidate) => isRecord(candidate) && candidate.name === "unraid-api",
        );
        if (isRecord(service) && typeof service.version === "string") {
          return this.validateApiVersion(service.version);
        }
      }
    } catch (error) {
      if (!isDiscoveryUnavailable(error)) throw error;
    }

    const probes: Array<[
      query: string,
      extract: (data: Record<string, unknown>) => unknown,
    ]> = [
      [
        API_VERSION_INFO_QUERY,
        (data) =>
          isRecord(data.info) &&
          isRecord(data.info.versions) &&
          isRecord(data.info.versions.core)
            ? data.info.versions.core.api
            : undefined,
      ],
      [
        API_VERSION_SETTINGS_QUERY,
        (data) =>
          isRecord(data.settings) && isRecord(data.settings.api)
            ? data.settings.api.version
            : undefined,
      ],
    ];
    for (const [query, extract] of probes) {
      try {
        const version = extract(await this.executor.execute(query, {}, signal));
        if (typeof version === "string") return this.validateApiVersion(version);
      } catch (error) {
        if (!isDiscoveryUnavailable(error)) throw error;
      }
    }
    return "unknown";
  }

  private validateApiVersion(value: string): string {
    if (parseSemanticVersion(value)) return value;
    throw new UnraidApiError(
      "API_VERSION_UNAVAILABLE",
      `The Unraid API reported an invalid semantic version: ${value.slice(0, 100)}.`,
    );
  }

  private async getSystemInfoBase(
    capabilities: UnraidApiCapabilities,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    if (!this.supports(capabilities, "modernSystemInfo")) {
      return this.executor.execute(SYSTEM_INFO_COMPAT_QUERY, {}, signal);
    }
    try {
      return await this.executor.execute(SYSTEM_INFO_QUERY, {}, signal);
    } catch (error) {
      if (classifyGraphQLError(error) !== "schema-validation") throw error;
      this.unavailableCapabilities.add("modernSystemInfo");
      return this.executor.execute(SYSTEM_INFO_COMPAT_QUERY, {}, signal);
    }
  }

  private supports(
    capabilities: UnraidApiCapabilities,
    capability: keyof UnraidApiCapabilities,
  ): boolean {
    return capabilities[capability] === true && !this.unavailableCapabilities.has(capability);
  }

  private async getSystemNetwork(
    capabilities: UnraidApiCapabilities,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    if (!this.supports(capabilities, "modernNetworkInfo")) {
      try {
        return await this.executor.execute(SYSTEM_NETWORK_COMPAT_QUERY, {}, signal);
      } catch (error) {
        if (classifyGraphQLError(error) !== "schema-validation") throw error;
        this.unavailableCapabilities.add("networkInfo");
        return undefined;
      }
    }

    try {
      return await this.executor.execute(SYSTEM_NETWORK_QUERY, {}, signal);
    } catch (error) {
      if (classifyGraphQLError(error) !== "schema-validation") throw error;
      this.unavailableCapabilities.add("modernNetworkInfo");
      try {
        return await this.executor.execute(SYSTEM_NETWORK_COMPAT_QUERY, {}, signal);
      } catch (fallbackError) {
        if (classifyGraphQLError(fallbackError) !== "schema-validation") throw fallbackError;
        this.unavailableCapabilities.add("networkInfo");
        return undefined;
      }
    }
  }

  private async optionalFragment(
    query: string,
    capability: keyof UnraidApiCapabilities,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown> | undefined> {
    try {
      return await this.executor.execute(query, {}, signal);
    } catch (error) {
      if (classifyGraphQLError(error) !== "schema-validation") throw error;
      this.unavailableCapabilities.add(capability);
      return undefined;
    }
  }

  private async executeFixed(
    query: string,
    variables: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    await this.getCapabilities(signal);
    return this.executor.execute(query, variables, signal);
  }
}
