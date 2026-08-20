import { describe, expect, it, vi } from "vitest";

import {
  ARRAY_COMPAT_QUERY,
  ARRAY_QUERY,
  DISK_SECTOR_SIZES_QUERY,
  DISKS_QUERY,
  METRICS_QUERY,
  NETWORK_METRICS_QUERY,
  SYSTEM_INFO_QUERY,
  SYSTEM_NETWORK_COMPAT_QUERY,
  SYSTEM_NETWORK_QUERY,
  TEMPERATURE_METRICS_QUERY,
  UPS_CONFIGURATION_QUERY,
  UPS_DEVICES_COMPAT_QUERY,
  UPS_DEVICES_QUERY,
  VMS_QUERY,
} from "../src/queries.js";
import {
  API_CAPABILITIES_QUERY,
  API_VERSION_INFO_QUERY,
  classifyGraphQLError,
  VersionAwareUnraidReadFacade,
  VMS_COMPAT_QUERY,
} from "../src/read-facade.js";
import { UnraidApiError } from "../src/unraid-client.js";

function services(version: string): Record<string, unknown> {
  return { services: [{ name: "unraid-api", version }] };
}

describe("VersionAwareUnraidReadFacade", () => {
  it("discovers and caches capabilities while merging modern system fragments", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === SYSTEM_INFO_QUERY) return { info: { os: { hostname: "tower" } } };
      if (query === SYSTEM_NETWORK_QUERY) {
        return { info: { networkInterfaces: [{ name: "eth0" }] } };
      }
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getSystemInfo()).resolves.toEqual({
      info: {
        os: { hostname: "tower" },
        networkInterfaces: [{ name: "eth0" }],
      },
    });
    await facade.getSystemInfo();

    expect(execute.mock.calls.filter(([query]) => query === API_CAPABILITIES_QUERY)).toHaveLength(1);
    expect(execute).not.toHaveBeenCalledWith(SYSTEM_NETWORK_COMPAT_QUERY, {}, undefined);
  });

  it("uses semantic version capabilities instead of lexical version ordering", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.34.0");
      if (query === SYSTEM_INFO_QUERY) return { info: { os: {} } };
      if (query === SYSTEM_NETWORK_COMPAT_QUERY) {
        return { info: { networkInterfaces: [{ name: "eth0", ipAddress: "192.0.2.2" }] } };
      }
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await facade.getSystemInfo();

    expect(execute).toHaveBeenCalledWith(SYSTEM_NETWORK_COMPAT_QUERY, {}, undefined);
    expect(execute).not.toHaveBeenCalledWith(SYSTEM_NETWORK_QUERY, {}, undefined);
  });

  it("falls back only for schema validation incompatibility and remembers the downgrade", async () => {
    const validationError = new UnraidApiError(
      "GRAPHQL_ERROR",
      'Unraid GraphQL error: Cannot query field "ipv4Addresses" on type "InfoNetworkInterface".',
    );
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === SYSTEM_INFO_QUERY) return { info: { os: {} } };
      if (query === SYSTEM_NETWORK_QUERY) throw validationError;
      if (query === SYSTEM_NETWORK_COMPAT_QUERY) return { info: { networkInterfaces: [] } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await facade.getSystemInfo();
    await facade.getSystemInfo();

    expect(execute.mock.calls.filter(([query]) => query === SYSTEM_NETWORK_QUERY)).toHaveLength(1);
    expect(
      execute.mock.calls.filter(([query]) => query === SYSTEM_NETWORK_COMPAT_QUERY),
    ).toHaveLength(2);
    expect(classifyGraphQLError(validationError)).toBe("schema-validation");
  });

  it("does not treat permission or runtime failures as compatibility failures", async () => {
    const permissionError = new UnraidApiError(
      "GRAPHQL_ERROR",
      "Unraid GraphQL error: Forbidden resource NETWORK with action READ_ANY",
    );
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === SYSTEM_INFO_QUERY) return { info: { os: {} } };
      if (query === SYSTEM_NETWORK_QUERY) throw permissionError;
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getSystemInfo()).rejects.toBe(permissionError);

    expect(classifyGraphQLError(permissionError)).toBe("permission-or-runtime");
    expect(execute).not.toHaveBeenCalledWith(SYSTEM_NETWORK_COMPAT_QUERY, {}, undefined);
  });

  it("recognizes schema validation diagnostics returned with HTTP errors", () => {
    const validationError = new UnraidApiError(
      "HTTP_ERROR",
      'The Unraid API returned HTTP 400. Unraid GraphQL error: Cannot query field "network" on type "Metrics".',
    );
    const permissionError = new UnraidApiError(
      "PERMISSION_DENIED",
      "The Unraid API key does not have permission for this operation.",
    );

    expect(classifyGraphQLError(validationError)).toBe("schema-validation");
    expect(classifyGraphQLError(permissionError)).toBe("permission-or-runtime");
  });

  it("selects and merges split metric capabilities", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("v4.35.0");
      if (query === METRICS_QUERY) return { metrics: { cpu: { percentTotal: 10 } } };
      if (query === TEMPERATURE_METRICS_QUERY) {
        return { metrics: { temperature: { sensors: [] } } };
      }
      if (query === NETWORK_METRICS_QUERY) return { metrics: { network: [{ name: "eth0" }] } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getMetrics()).resolves.toEqual({
      metrics: {
        cpu: { percentTotal: 10 },
        temperature: { sensors: [] },
        network: [{ name: "eth0" }],
      },
    });
  });

  it("omits unsupported metric fragments on older and prerelease APIs", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.0-rc.1");
      if (query === METRICS_QUERY) return { metrics: { memory: { total: 100 } } };
      if (query === TEMPERATURE_METRICS_QUERY) return { metrics: { temperature: null } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await facade.getMetrics();

    expect(execute).not.toHaveBeenCalledWith(NETWORK_METRICS_QUERY, {}, undefined);
  });

  it("returns an empty UPS list only when configuration explicitly disables it", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === UPS_CONFIGURATION_QUERY) {
        return { upsConfiguration: { service: "disable", device: "usb" } };
      }
      throw new Error("UPS devices must not be queried");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getUps()).resolves.toEqual({
      upsDevices: [],
      upsConfiguration: { service: "disable", device: "usb" },
    });
    expect(execute).not.toHaveBeenCalledWith(UPS_DEVICES_QUERY, {}, undefined);
  });

  it("preserves UPS runtime errors when the service is enabled", async () => {
    const runtimeError = new UnraidApiError(
      "GRAPHQL_ERROR",
      "Unraid GraphQL error: Failed to get UPS data: connection refused",
    );
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === UPS_CONFIGURATION_QUERY) {
        return { upsConfiguration: { service: "enable" } };
      }
      if (query === UPS_DEVICES_QUERY) throw runtimeError;
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getUps()).rejects.toBe(runtimeError);
  });

  it("normalizes explicitly unavailable VMs but preserves unrelated VM failures", async () => {
    const disabledError = new UnraidApiError(
      "GRAPHQL_ERROR",
      "Unraid GraphQL error: Failed to retrieve VM domains: VMs are not available",
    );
    const runtimeError = new UnraidApiError(
      "GRAPHQL_ERROR",
      "Unraid GraphQL error: Failed to retrieve VM domains: unexpected I/O failure",
    );
    const disabledExecute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === VMS_QUERY) throw disabledError;
      throw new Error("Unexpected query");
    });
    const disabledFacade = new VersionAwareUnraidReadFacade({ execute: disabledExecute });

    await expect(disabledFacade.listVms()).resolves.toEqual({ vms: { domains: [] } });
    expect(disabledExecute).not.toHaveBeenCalledWith(VMS_COMPAT_QUERY, {}, undefined);

    const failedExecute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === VMS_QUERY) throw runtimeError;
      throw new Error("Unexpected query");
    });
    const failedFacade = new VersionAwareUnraidReadFacade({ execute: failedExecute });
    await expect(failedFacade.listVms()).rejects.toBe(runtimeError);
  });

  it("offers only fixed read operations and discovers before delegated reads", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === ARRAY_QUERY) return { array: { state: "STARTED" } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getArray()).resolves.toEqual({ array: { state: "STARTED" } });

    expect("execute" in facade).toBe(false);
    expect(execute.mock.calls.map(([query]) => query)).toEqual([
      API_CAPABILITIES_QUERY,
      ARRAY_QUERY,
    ]);
  });

  it("uses a fixed array fallback when an older schema lacks newer fields", async () => {
    const validationError = new UnraidApiError(
      "GRAPHQL_ERROR",
      'Unraid GraphQL error: Cannot query field "bootDevices" on type "UnraidArray".',
    );
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.29.2");
      if (query === ARRAY_QUERY) throw validationError;
      if (query === ARRAY_COMPAT_QUERY) return { array: { state: "STARTED" } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getArray()).resolves.toEqual({ array: { state: "STARTED" } });
    expect(execute.mock.calls.map(([query]) => query)).toEqual([
      API_CAPABILITIES_QUERY,
      ARRAY_QUERY,
      ARRAY_COMPAT_QUERY,
    ]);
  });

  it("falls back to an INFO version probe when SERVICES permission is unavailable", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) {
        throw new UnraidApiError("PERMISSION_DENIED", "SERVICES permission denied.");
      }
      if (query === API_VERSION_INFO_QUERY) {
        return { info: { versions: { core: { api: "4.35.1" } } } };
      }
      if (query === ARRAY_QUERY) return { array: { state: "STARTED" } };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getArray()).resolves.toEqual({ array: { state: "STARTED" } });
    await expect(facade.getCapabilities()).resolves.toMatchObject({ apiVersion: "4.35.1" });
  });

  it("omits only the broken disk sector field when its non-null resolver returns null", async () => {
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === DISKS_QUERY) return { disks: [{ id: "Disk:sda", name: "disk" }] };
      if (query === DISK_SECTOR_SIZES_QUERY) {
        throw new UnraidApiError(
          "GRAPHQL_ERROR",
          "Unraid GraphQL error: Cannot return null for non-nullable field Disk.bytesPerSector.",
        );
      }
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.listDisks()).resolves.toEqual({
      disks: [{ id: "Disk:sda", name: "disk" }],
    });
    await facade.listDisks();
    expect(execute.mock.calls.filter(([query]) => query === DISK_SECTOR_SIZES_QUERY)).toHaveLength(1);
  });

  it("keeps latest UPS power fields with a fixed compatibility fallback", async () => {
    const validationError = new UnraidApiError(
      "GRAPHQL_ERROR",
      'Unraid GraphQL error: Cannot query field "nominalPower" on type "UPSPower".',
    );
    const execute = vi.fn(async (query: string) => {
      if (query === API_CAPABILITIES_QUERY) return services("4.35.1");
      if (query === UPS_CONFIGURATION_QUERY) return { upsConfiguration: { service: "enable" } };
      if (query === UPS_DEVICES_QUERY) throw validationError;
      if (query === UPS_DEVICES_COMPAT_QUERY) return { upsDevices: [{ id: "ups" }] };
      throw new Error("Unexpected query");
    });
    const facade = new VersionAwareUnraidReadFacade({ execute });

    await expect(facade.getUps()).resolves.toEqual({
      upsDevices: [{ id: "ups" }],
      upsConfiguration: { service: "enable" },
    });
  });

  it("uses the actual API-version boundaries for optional stable fields", async () => {
    const v430 = new VersionAwareUnraidReadFacade({
      execute: vi.fn(async () => services("4.30.0")),
    });
    await expect(v430.getCapabilities()).resolves.toMatchObject({
      temperatureMetrics: true,
      modernUpsPower: true,
      diskSectorSize: true,
      modernNetworkInfo: false,
      modernVmDomains: true,
    });

    const v414 = new VersionAwareUnraidReadFacade({
      execute: vi.fn(async () => services("4.14.0")),
    });
    await expect(v414.getCapabilities()).resolves.toMatchObject({
      temperatureMetrics: false,
      modernUpsPower: false,
      diskSectorSize: true,
    });
  });

  it("lets one caller cancel without cancelling shared capability discovery", async () => {
    let resolveDiscovery: ((value: Record<string, unknown>) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<Record<string, unknown>>((resolve) => {
          resolveDiscovery = resolve;
        }),
    );
    const facade = new VersionAwareUnraidReadFacade({ execute });
    const firstController = new AbortController();
    const secondController = new AbortController();

    const first = facade.getCapabilities(firstController.signal);
    const second = facade.getCapabilities(secondController.signal);
    firstController.abort();
    resolveDiscovery?.(services("4.37.1"));

    await expect(first).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(second).resolves.toMatchObject({ apiVersion: "4.37.1" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
