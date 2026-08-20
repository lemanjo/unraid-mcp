import { readFileSync, realpathSync, statSync } from "node:fs";
import { isIP, SocketAddress } from "node:net";
import { isAbsolute, resolve, sep } from "node:path";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILE_BYTES = 256 * 1024;
const DEFAULT_MAX_DIRECTORY_ENTRIES = 500;

export interface FileRootConfig {
  name: string;
  path: string;
  device: bigint;
  inode: bigint;
}

export interface FileAccessConfig {
  roots: readonly FileRootConfig[];
  writableRoots: readonly string[];
  allowWrites: boolean;
  maxFileBytes: number;
  maxDirectoryEntries: number;
}

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
  files: FileAccessConfig;
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

function parseNameList(env: NodeJS.ProcessEnv, name: string): string[] {
  const raw = env[name]?.trim();
  if (!raw) return [];
  const names = raw.split(",").map((value) => value.trim());
  if (names.some((value) => !/^[a-z][a-z0-9_-]{0,31}$/.test(value))) {
    throw new ConfigurationError(
      `${name} must be a comma-separated list of lowercase file-root names.`,
    );
  }
  return [...new Set(names)];
}

function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isProtectedFileRoot(path: string): boolean {
  const protectedPaths = ["/app", "/dev", "/etc", "/proc", "/run", "/sys"];
  return path === "/" || protectedPaths.some((entry) => path === entry || path.startsWith(`${entry}${sep}`));
}

function parseFileRoots(env: NodeJS.ProcessEnv): readonly FileRootConfig[] {
  const raw = env.MCP_FILE_ROOTS?.trim();
  if (!raw) return [];
  if (process.platform !== "linux") {
    throw new ConfigurationError("MCP_FILE_ROOTS is supported only on Linux.");
  }
  if (Buffer.byteLength(raw) > 16 * 1024) {
    throw new ConfigurationError("MCP_FILE_ROOTS exceeds the 16 KiB configuration limit.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ConfigurationError("MCP_FILE_ROOTS must be a JSON object of name-to-path entries.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigurationError("MCP_FILE_ROOTS must be a JSON object of name-to-path entries.");
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0 || entries.length > 16) {
    throw new ConfigurationError("MCP_FILE_ROOTS must define between 1 and 16 roots.");
  }
  const roots: FileRootConfig[] = [];
  for (const [name, configuredPath] of entries) {
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
      throw new ConfigurationError(
        "MCP_FILE_ROOTS names must start with a lowercase letter and use only lowercase letters, digits, underscores, or hyphens.",
      );
    }
    if (
      typeof configuredPath !== "string" ||
      configuredPath.length === 0 ||
      configuredPath.includes("\0") ||
      !isWellFormedString(configuredPath) ||
      !isAbsolute(configuredPath)
    ) {
      throw new ConfigurationError(`MCP_FILE_ROOTS entry ${name} must be an absolute path.`);
    }

    const normalized = resolve(configuredPath);
    let canonical: string;
    let stats: ReturnType<typeof statSync>;
    try {
      canonical = realpathSync.native(normalized);
      stats = statSync(canonical, { bigint: true });
    } catch {
      throw new ConfigurationError(`MCP_FILE_ROOTS entry ${name} is not an accessible directory.`);
    }
    if (canonical !== normalized) {
      throw new ConfigurationError(`MCP_FILE_ROOTS entry ${name} must not be a symbolic link.`);
    }
    if (!stats.isDirectory()) {
      throw new ConfigurationError(`MCP_FILE_ROOTS entry ${name} is not a directory.`);
    }
    if (isProtectedFileRoot(canonical)) {
      throw new ConfigurationError(`MCP_FILE_ROOTS entry ${name} uses a protected container path.`);
    }
    if (
      roots.some(
        (root) =>
          (root.device === stats.dev && root.inode === stats.ino) ||
          canonical.startsWith(`${root.path}${sep}`) ||
          root.path.startsWith(`${canonical}${sep}`),
      )
    ) {
      throw new ConfigurationError(
        "MCP_FILE_ROOTS entries must resolve to distinct, non-overlapping directories.",
      );
    }
    roots.push(Object.freeze({
      name,
      path: canonical,
      device: stats.dev,
      inode: stats.ino,
    }));
  }

  try {
    const procFd = statSync("/proc/self/fd");
    if (!procFd.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new ConfigurationError("MCP_FILE_ROOTS requires an accessible /proc/self/fd.");
  }
  return Object.freeze(roots);
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
  const fileRoots = parseFileRoots(env);
  const allowFileWrites = parseBoolean(env, "MCP_ALLOW_FILE_WRITES", false);
  const writableFileRoots = parseNameList(env, "MCP_WRITABLE_FILE_ROOTS");
  const rejectUnauthorized = !parseBoolean(env, "UNRAID_TLS_SKIP_VERIFY", false);
  const ca = loadCa(env);

  if (allowDestructiveMutations && !allowMutations) {
    throw new ConfigurationError(
      "UNRAID_ALLOW_DESTRUCTIVE_MUTATIONS requires UNRAID_ALLOW_MUTATIONS=true.",
    );
  }
  if (allowFileWrites && writableFileRoots.length === 0) {
    throw new ConfigurationError(
      "MCP_ALLOW_FILE_WRITES=true requires MCP_WRITABLE_FILE_ROOTS.",
    );
  }
  if (!allowFileWrites && writableFileRoots.length > 0) {
    throw new ConfigurationError(
      "MCP_WRITABLE_FILE_ROOTS requires MCP_ALLOW_FILE_WRITES=true.",
    );
  }
  const fileRootNames = new Set(fileRoots.map((root) => root.name));
  if (writableFileRoots.some((name) => !fileRootNames.has(name))) {
    throw new ConfigurationError(
      "MCP_WRITABLE_FILE_ROOTS may contain only names configured in MCP_FILE_ROOTS.",
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
    files: {
      roots: fileRoots,
      writableRoots: Object.freeze(writableFileRoots),
      allowWrites: allowFileWrites,
      maxFileBytes: parseInteger(
        env,
        "MCP_MAX_FILE_BYTES",
        DEFAULT_MAX_FILE_BYTES,
        1_024,
        1024 * 1024,
      ),
      maxDirectoryEntries: parseInteger(
        env,
        "MCP_MAX_DIRECTORY_ENTRIES",
        DEFAULT_MAX_DIRECTORY_ENTRIES,
        1,
        5_000,
      ),
    },
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
