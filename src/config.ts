import { readFileSync } from "node:fs";
import { isIP, SocketAddress } from "node:net";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface UnraidConfig {
  endpoint: URL;
  apiKey: string;
  timeoutMs: number;
  maxResponseBytes: number;
  ca: Buffer | undefined;
  rejectUnauthorized: boolean;
  allowMutations: boolean;
  allowDestructiveMutations: boolean;
}

export interface McpHttpConfig {
  host: string;
  port: number;
  authToken: string | undefined;
  allowedHosts: string[];
  allowedOrigins: string[];
  authFailureLimit: number;
  authFailureWindowMs: number;
  maxRequestBytes: number;
  requestTimeoutMs: number;
}

export interface AppConfig extends UnraidConfig {
  transport: "stdio" | "http";
  http: McpHttpConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigurationError(`${name} is required.`);
  }
  return value;
}

function parseBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new ConfigurationError(`${name} must be true or false.`);
}

function parseInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ConfigurationError(`${name} must be an integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ConfigurationError(`${name} must be between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

function parseTransport(env: NodeJS.ProcessEnv): "stdio" | "http" {
  const value = env.MCP_TRANSPORT?.trim().toLowerCase() ?? "stdio";
  if (value === "stdio" || value === "http") return value;
  throw new ConfigurationError("MCP_TRANSPORT must be stdio or http.");
}

function validateHostname(value: string, name: string, allowUnbracketedIpv6: boolean): string {
  if (!value || /[\s/]/.test(value) || value.includes("://")) {
    throw new ConfigurationError(`${name} contains an invalid hostname.`);
  }
  if (value.startsWith("[")) {
    if (!value.endsWith("]") || isIP(value.slice(1, -1)) !== 6) {
      throw new ConfigurationError(`${name} contains an invalid hostname.`);
    }
    return (allowUnbracketedIpv6 ? value.slice(1, -1) : value).toLowerCase();
  }
  if (value.includes(":")) {
    if (!allowUnbracketedIpv6) {
      throw new ConfigurationError(`${name} IPv6 entries must use brackets.`);
    }
    if (isIP(value) !== 6) {
      throw new ConfigurationError(`${name} contains an invalid hostname.`);
    }
    return value.toLowerCase();
  }
  if (isIP(value) !== 4 && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(value)) {
    throw new ConfigurationError(`${name} contains an invalid hostname.`);
  }
  return value.toLowerCase();
}

function parseHostnameList(env: NodeJS.ProcessEnv, name: string): string[] {
  const raw = env[name]?.trim();
  if (!raw) return [];
  const values = raw.split(",").map((value) => value.trim());
  if (values.some((value) => value === "")) {
    throw new ConfigurationError(`${name} must be a comma-separated hostname list.`);
  }
  return [...new Set(values.map((value) => validateHostname(value, name, false)))];
}

function parseAuthToken(env: NodeJS.ProcessEnv): string | undefined {
  const token = env.MCP_AUTH_TOKEN;
  if (token === undefined || token === "") return undefined;
  if (token.trim() !== token) {
    throw new ConfigurationError("MCP_AUTH_TOKEN must not have leading or trailing whitespace.");
  }
  if (Buffer.byteLength(token) < 32) {
    throw new ConfigurationError("MCP_AUTH_TOKEN must be at least 32 bytes.");
  }
  if (Buffer.byteLength(token) > 512 || !/^[a-z0-9._~+\/-]+=*$/i.test(token)) {
    throw new ConfigurationError(
      "MCP_AUTH_TOKEN must use only HTTP bearer-token characters and be at most 512 bytes.",
    );
  }
  return token;
}

function defaultAllowedHosts(host: string): string[] {
  if (host === "127.0.0.1" || host === "localhost" || host === "::1") {
    return ["localhost", "127.0.0.1", "[::1]"];
  }
  return [host.includes(":") ? `[${host}]` : host];
}

function includeLocalhost(hostnames: string[]): string[] {
  return [...new Set([...hostnames, "localhost", "127.0.0.1", "[::1]"])];
}

function isWildcardHost(host: string): boolean {
  if (host === "0.0.0.0") return true;
  if (isIP(host) !== 6) return false;
  const normalized = new SocketAddress({ address: host, family: "ipv6" }).address;
  return normalized === "::" || normalized === "::ffff:0.0.0.0";
}

function parseEndpoint(raw: string): URL {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new ConfigurationError("UNRAID_URL must be a valid absolute URL.");
  }

  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new ConfigurationError("UNRAID_URL must use http or https.");
  }
  if (endpoint.username || endpoint.password) {
    throw new ConfigurationError("UNRAID_URL must not contain credentials.");
  }
  if (endpoint.search || endpoint.hash) {
    throw new ConfigurationError("UNRAID_URL must not contain a query string or fragment.");
  }

  const pathname = endpoint.pathname.replace(/\/+$/, "");
  endpoint.pathname = pathname === "" ? "/graphql" : pathname;
  return endpoint;
}

function loadCa(env: NodeJS.ProcessEnv): Buffer | undefined {
  const inline = env.UNRAID_CA_CERT?.trim();
  const path = env.UNRAID_CA_CERT_PATH?.trim();
  if (inline && path) {
    throw new ConfigurationError("Set only one of UNRAID_CA_CERT or UNRAID_CA_CERT_PATH.");
  }

  if (inline) {
    const pem = inline.replaceAll("\\n", "\n");
    if (!pem.includes("-----BEGIN CERTIFICATE-----")) {
      throw new ConfigurationError("UNRAID_CA_CERT must contain a PEM certificate.");
    }
    return Buffer.from(pem);
  }

  if (path) {
    try {
      return readFileSync(path);
    } catch {
      throw new ConfigurationError("UNRAID_CA_CERT_PATH could not be read.");
    }
  }

  return undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const endpoint = parseEndpoint(required(env, "UNRAID_URL"));
  const apiKey = required(env, "UNRAID_API_KEY");
  const transport = parseTransport(env);
  const httpHost =
    transport === "http"
      ? validateHostname(env.MCP_HOST?.trim() || "127.0.0.1", "MCP_HOST", true)
      : "127.0.0.1";
  const configuredAllowedHosts =
    transport === "http" ? parseHostnameList(env, "MCP_ALLOWED_HOSTS") : [];
  const wildcardHost = isWildcardHost(httpHost);
  if (transport === "http" && wildcardHost && configuredAllowedHosts.length === 0) {
    throw new ConfigurationError(
      "MCP_ALLOWED_HOSTS is required when MCP_HOST binds to all interfaces.",
    );
  }
  const allowMutations = parseBoolean(env, "UNRAID_ALLOW_MUTATIONS", false);
  const allowDestructiveMutations = parseBoolean(
    env,
    "UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS",
    false,
  );
  const rejectUnauthorized = !parseBoolean(env, "UNRAID_TLS_SKIP_VERIFY", false);
  const ca = loadCa(env);

  if (allowDestructiveMutations && !allowMutations) {
    throw new ConfigurationError(
      "UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS requires UNRAID_ALLOW_MUTATIONS=true.",
    );
  }
  if (endpoint.protocol === "http:" && (ca || !rejectUnauthorized)) {
    throw new ConfigurationError("TLS options cannot be used with an http UNRAID_URL.");
  }
  if (ca && !rejectUnauthorized) {
    throw new ConfigurationError(
      "UNRAID_CA_CERT and UNRAID_TLS_SKIP_VERIFY=true cannot be used together.",
    );
  }

  return {
    endpoint,
    apiKey,
    timeoutMs: parseInteger(env, "UNRAID_REQUEST_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 100, 120_000),
    maxResponseBytes: parseInteger(
      env,
      "UNRAID_MAX_RESPONSE_BYTES",
      DEFAULT_MAX_RESPONSE_BYTES,
      1_024,
      50 * 1024 * 1024,
    ),
    ca,
    rejectUnauthorized,
    allowMutations,
    allowDestructiveMutations,
    transport,
    http: {
      host: httpHost,
      port: transport === "http" ? parseInteger(env, "MCP_PORT", 3_000, 1, 65_535) : 3_000,
      authToken: transport === "http" ? parseAuthToken(env) : undefined,
      allowedHosts:
        configuredAllowedHosts.length > 0
          ? includeLocalhost(configuredAllowedHosts)
          : includeLocalhost(defaultAllowedHosts(httpHost)),
      allowedOrigins:
        transport === "http" ? parseHostnameList(env, "MCP_ALLOWED_ORIGINS") : [],
      authFailureLimit:
        transport === "http"
          ? parseInteger(env, "MCP_AUTH_FAILURE_LIMIT", 10, 1, 1_000)
          : 10,
      authFailureWindowMs:
        transport === "http"
          ? parseInteger(env, "MCP_AUTH_FAILURE_WINDOW_MS", 60_000, 1_000, 3_600_000)
          : 60_000,
      maxRequestBytes:
        transport === "http"
          ? parseInteger(env, "MCP_MAX_REQUEST_BYTES", 1024 * 1024, 1_024, 4 * 1024 * 1024)
          : 1024 * 1024,
      requestTimeoutMs:
        transport === "http"
          ? parseInteger(env, "MCP_HTTP_REQUEST_TIMEOUT_MS", 30_000, 1_000, 120_000)
          : 30_000,
    },
  };
}
