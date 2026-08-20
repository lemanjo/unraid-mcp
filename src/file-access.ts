import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, opendir, realpath, statfs, type FileHandle } from "node:fs/promises";
import { sep } from "node:path";

import type { FileAccessConfig, FileRootConfig } from "./config.js";

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const WRITE_FLAGS = constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const MAX_LOGICAL_PATH_BYTES = 4_096;
const MAX_PATH_DEPTH = 64;
const FORBIDDEN_FILESYSTEM_TYPES = new Set([
  0x1cd1n, // devpts
  0x27e0ebn, // cgroup
  0x9fa0n, // proc
  0x19800202n, // mqueue
  0x42494e4dn, // binfmt_misc
  0x43415d53n, // smack
  0x62656570n, // configfs
  0x62656572n, // sysfs
  0x63677270n, // cgroup2
  0x64626720n, // debugfs
  0x65735543n, // fusectl
  0x6e736673n, // nsfs
  0x6165676cn, // pstore
  0x73636673n, // securityfs
  0x74726163n, // tracefs
  0xf97cff8cn, // selinux
  0xcafe4a11n, // bpf
  0xde5e81e4n, // efivarfs
]);

export class FileAccessError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "FileAccessError";
  }
}

export interface FileListEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  size: string;
  modifiedAt: string;
}

export interface FileListResult extends Record<string, unknown> {
  root: string;
  path: string;
  entries: FileListEntry[];
  truncated: boolean;
}

export interface FileReadResult extends Record<string, unknown> {
  root: string;
  path: string;
  size: number;
  modifiedAt: string;
  sha256: string;
  content: string;
}

export interface FileWriteResult extends Record<string, unknown> {
  root: string;
  path: string;
  size: number;
  modifiedAt: string;
  sha256: string;
  changed: boolean;
}

interface OpenedFile {
  handle: FileHandle;
  parent: FileHandle;
  basename: string;
  stats: BigIntStats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function validateLogicalPath(path: string, allowRoot: boolean): string[] {
  if (
    !isWellFormedString(path) ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    Buffer.byteLength(path) > MAX_LOGICAL_PATH_BYTES
  ) {
    throw new FileAccessError("INVALID_PATH", "The mapped-file path is invalid.");
  }
  if (path === "") {
    if (allowRoot) return [];
    throw new FileAccessError("INVALID_PATH", "A mapped-file path is required.");
  }
  const segments = path.split("/");
  if (
    segments.length > MAX_PATH_DEPTH ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        Buffer.byteLength(segment) > 255,
    )
  ) {
    throw new FileAccessError("INVALID_PATH", "The mapped-file path is invalid.");
  }
  return segments;
}

function descriptorPath(fd: number, child?: string | Buffer): string | Buffer {
  const prefix = `/proc/self/fd/${fd}`;
  if (child === undefined) return prefix;
  return Buffer.isBuffer(child)
    ? Buffer.concat([Buffer.from(`${prefix}/`), child])
    : `${prefix}/${child}`;
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function modifiedAt(stats: BigIntStats): string {
  return new Date(Number(stats.mtimeNs / 1_000_000n)).toISOString();
}

function sameRevision(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

function entryType(stats: BigIntStats): FileListEntry["type"] {
  if (stats.isSymbolicLink()) return "symlink";
  if (stats.isDirectory()) return "directory";
  if (stats.isFile()) return "file";
  return "other";
}

function mapFsError(error: unknown): FileAccessError {
  if (error instanceof FileAccessError) return error;
  const code = isRecord(error) && typeof error.code === "string" ? error.code : "UNKNOWN";
  if (code === "ENOENT") {
    return new FileAccessError("NOT_FOUND", "The mapped file or directory does not exist.");
  }
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
    return new FileAccessError(
      "PERMISSION_DENIED",
      "The MCP process does not have permission for this mapped-file operation.",
    );
  }
  if (code === "ELOOP") {
    return new FileAccessError("SYMLINK_FORBIDDEN", "Symbolic links are not allowed in mapped paths.");
  }
  if (code === "ENOTDIR") {
    return new FileAccessError("NOT_DIRECTORY", "A mapped-path component is not a directory.");
  }
  return new FileAccessError("FILESYSTEM_ERROR", "The mapped-file operation failed.");
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new FileAccessError("CANCELLED", "The mapped-file operation was cancelled.");
  }
}

export class FileAccessService {
  private static readonly inodeWriteTails = new Map<string, Promise<void>>();
  private readonly roots: Map<string, FileRootConfig>;
  private readonly writableRoots: Set<string>;
  private readonly writeTails = new Map<string, Promise<void>>();

  constructor(private readonly config: FileAccessConfig) {
    for (const [index, root] of config.roots.entries()) {
      if (
        config.roots.some(
          (candidate, candidateIndex) =>
            candidateIndex !== index &&
            (candidate.name === root.name ||
              (candidate.device === root.device && candidate.inode === root.inode) ||
              candidate.path.startsWith(`${root.path}${sep}`) ||
              root.path.startsWith(`${candidate.path}${sep}`)),
        )
      ) {
        throw new FileAccessError(
          "INVALID_ROOT_CONFIG",
          "Mapped-file roots must have unique names and must not overlap.",
        );
      }
    }
    this.roots = new Map(config.roots.map((root) => [root.name, root]));
    this.writableRoots = new Set(config.writableRoots);
  }

  describeRoots(): Record<string, unknown> {
    return {
      roots: this.config.roots.map((root) => ({
        name: root.name,
        writable: this.config.allowWrites && this.writableRoots.has(root.name),
      })),
      maxFileBytes: this.config.maxFileBytes,
      maxDirectoryEntries: this.config.maxDirectoryEntries,
    };
  }

  async listDirectory(
    rootName: string,
    path: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<FileListResult> {
    throwIfCancelled(signal);
    if (!Number.isInteger(limit) || limit < 1 || limit > this.config.maxDirectoryEntries) {
      throw new FileAccessError("INVALID_LIMIT", "The mapped-directory limit is invalid.");
    }
    const root = this.requireRoot(rootName);
    const segments = validateLogicalPath(path, true);
    let directory: FileHandle | undefined;
    try {
      directory = await this.openDirectory(root, segments);
      throwIfCancelled(signal);
      const entries = await this.readDirectoryEntries(directory, path, limit, signal);
      return {
        root: root.name,
        path,
        entries: entries.slice(0, limit),
        truncated: entries.length > limit,
      };
    } catch (error) {
      throw mapFsError(error);
    } finally {
      await directory?.close().catch(() => undefined);
    }
  }

  async readFile(rootName: string, path: string, signal?: AbortSignal): Promise<FileReadResult> {
    throwIfCancelled(signal);
    const root = this.requireRoot(rootName);
    const segments = validateLogicalPath(path, false);
    let opened: OpenedFile | undefined;
    try {
      opened = await this.openRegularFile(root, segments, READ_FLAGS);
      throwIfCancelled(signal);
      const value = await this.readStable(opened.handle, opened.stats, signal);
      const pathStats = await this.verifyOpenedPath(opened, root);
      if (!sameRevision(value.stats, pathStats)) {
        throw new FileAccessError("CONFLICT", "The mapped file changed while it was being read.");
      }
      if (!isUtf8(value.buffer)) {
        throw new FileAccessError(
          "INVALID_UTF8",
          "The mapped file is not valid UTF-8 text and cannot be returned.",
        );
      }
      return {
        root: root.name,
        path,
        size: value.buffer.length,
        modifiedAt: modifiedAt(value.stats),
        sha256: sha256(value.buffer),
        content: value.buffer.toString("utf8"),
      };
    } catch (error) {
      throw mapFsError(error);
    } finally {
      await this.closeOpenedFile(opened);
    }
  }

  async overwriteFile(
    rootName: string,
    path: string,
    content: string,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<FileWriteResult> {
    throwIfCancelled(signal);
    const root = this.requireRoot(rootName);
    if (!this.config.allowWrites || !this.writableRoots.has(root.name)) {
      return Promise.reject(
        new FileAccessError("WRITE_DISABLED", "Writes are not enabled for this mapped root."),
      );
    }
    const segments = validateLogicalPath(path, false);
    if (!isWellFormedString(content)) {
      return Promise.reject(
        new FileAccessError("INVALID_UTF8", "Mapped-file content must be well-formed UTF-8 text."),
      );
    }
    if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
      return Promise.reject(
        new FileAccessError("INVALID_REVISION", "expectedSha256 must be a lowercase SHA-256 hash."),
      );
    }
    const encoded = Buffer.from(content, "utf8");
    if (encoded.length > this.config.maxFileBytes) {
      return Promise.reject(
        new FileAccessError("FILE_TOO_LARGE", "Mapped-file content exceeds the configured limit."),
      );
    }
    return this.withWriteLock(`${root.name}\0${path}`, () => {
      throwIfCancelled(signal);
      return this.overwriteOpenedFile(root, segments, path, encoded, expectedSha256, signal);
    });
  }

  private requireRoot(name: string): FileRootConfig {
    const root = this.roots.get(name);
    if (!root) throw new FileAccessError("UNKNOWN_ROOT", "The mapped-file root is not configured.");
    return root;
  }

  private async openDirectory(root: FileRootConfig, segments: string[]): Promise<FileHandle> {
    let current: FileHandle | undefined;
    try {
      current = await open(root.path, DIRECTORY_FLAGS);
      const rootStats = await current.stat({ bigint: true });
      if (
        !rootStats.isDirectory() ||
        rootStats.dev !== root.device ||
        rootStats.ino !== root.inode
      ) {
        throw new FileAccessError(
          "ROOT_CHANGED",
          "The mapped-file root changed after startup; restart the MCP after checking the mount.",
        );
      }
      await this.verifyContained(current, root);

      for (const segment of segments) {
        const candidateStats = await lstat(descriptorPath(current.fd, segment), { bigint: true });
        if (candidateStats.isSymbolicLink()) {
          throw new FileAccessError(
            "SYMLINK_FORBIDDEN",
            "Symbolic links are not allowed in mapped paths.",
          );
        }
        let next: FileHandle | undefined;
        try {
          next = await open(descriptorPath(current.fd, segment), DIRECTORY_FLAGS);
          const nextStats = await next.stat({ bigint: true });
          if (!nextStats.isDirectory()) {
            throw new FileAccessError(
              "NOT_DIRECTORY",
              "A mapped-path component is not a directory.",
            );
          }
          await this.verifyContained(next, root);
          await current.close();
          current = next;
          next = undefined;
        } finally {
          await next?.close().catch(() => undefined);
        }
      }
      return current;
    } catch (error) {
      await current?.close().catch(() => undefined);
      throw mapFsError(error);
    }
  }

  private async openRegularFile(
    root: FileRootConfig,
    segments: string[],
    flags: number,
  ): Promise<OpenedFile> {
    const parentSegments = segments.slice(0, -1);
    const basename = segments.at(-1);
    if (!basename) throw new FileAccessError("INVALID_PATH", "A mapped-file path is required.");
    let parent: FileHandle | undefined;
    let file: FileHandle | undefined;
    try {
      parent = await this.openDirectory(root, parentSegments);
      const candidateStats = await lstat(descriptorPath(parent.fd, basename), { bigint: true });
      if (candidateStats.isSymbolicLink()) {
        throw new FileAccessError(
          "SYMLINK_FORBIDDEN",
          "Symbolic links are not allowed in mapped paths.",
        );
      }
      if (!candidateStats.isFile()) {
        throw new FileAccessError("NOT_REGULAR_FILE", "The mapped path is not a regular file.");
      }
      file = await open(descriptorPath(parent.fd, basename), flags);
      const stats = await file.stat({ bigint: true });
      if (!stats.isFile()) {
        throw new FileAccessError("NOT_REGULAR_FILE", "The mapped path is not a regular file.");
      }
      if (stats.nlink !== 1n) {
        throw new FileAccessError(
          "HARD_LINK_FORBIDDEN",
          "Hard-linked files are not allowed in mapped-file operations.",
        );
      }
      await this.verifyContained(file, root);
      const opened = { handle: file, parent, basename, stats };
      file = undefined;
      parent = undefined;
      return opened;
    } catch (error) {
      await file?.close().catch(() => undefined);
      await parent?.close().catch(() => undefined);
      throw mapFsError(error);
    }
  }

  private async closeOpenedFile(opened: OpenedFile | undefined): Promise<void> {
    if (!opened) return;
    await Promise.all([
      opened.handle.close().catch(() => undefined),
      opened.parent.close().catch(() => undefined),
    ]);
  }

  private async verifyOpenedPath(
    opened: OpenedFile,
    root: FileRootConfig,
  ): Promise<BigIntStats> {
    await this.verifyContained(opened.parent, root);
    const pathStats = await lstat(descriptorPath(opened.parent.fd, opened.basename), {
      bigint: true,
    });
    const handleStats = await opened.handle.stat({ bigint: true });
    if (
      !pathStats.isFile() ||
      pathStats.dev !== handleStats.dev ||
      pathStats.ino !== handleStats.ino
    ) {
      throw new FileAccessError(
        "CONFLICT",
        "The mapped path no longer references the opened file.",
      );
    }
    if (handleStats.nlink !== 1n) {
      throw new FileAccessError(
        "HARD_LINK_FORBIDDEN",
        "Hard-linked files are not allowed in mapped-file operations.",
      );
    }
    return handleStats;
  }

  private async verifyContained(handle: FileHandle, root: FileRootConfig): Promise<void> {
    let actual: string;
    try {
      actual = await realpath(descriptorPath(handle.fd) as string);
    } catch {
      throw new FileAccessError("PATH_CHANGED", "The mapped path changed during access.");
    }
    if (actual !== root.path && !actual.startsWith(`${root.path}${sep}`)) {
      throw new FileAccessError("PATH_OUTSIDE_ROOT", "The mapped path resolved outside its root.");
    }
    const filesystem = await statfs(descriptorPath(handle.fd), { bigint: true });
    if (FORBIDDEN_FILESYSTEM_TYPES.has(filesystem.type)) {
      throw new FileAccessError(
        "FILESYSTEM_FORBIDDEN",
        "Kernel and device pseudo-filesystems are not allowed in mapped roots.",
      );
    }
  }

  private async readDirectoryEntries(
    directory: FileHandle,
    logicalPath: string,
    limit: number,
    signal?: AbortSignal,
  ): Promise<FileListEntry[]> {
    const entries: FileListEntry[] = [];
    const stream = await opendir(descriptorPath(directory.fd), {
      encoding: "buffer" as BufferEncoding,
      bufferSize: Math.min(32, limit + 1),
    });
    try {
      while (entries.length <= limit) {
        throwIfCancelled(signal);
        const rawEntry = await stream.read();
        if (!rawEntry) break;
        const nameBuffer = Buffer.isBuffer(rawEntry.name)
          ? rawEntry.name
          : Buffer.from(rawEntry.name);
        if (!isUtf8(nameBuffer)) {
          throw new FileAccessError(
            "INVALID_FILENAME",
            "A mapped directory contains a filename that is not valid UTF-8.",
          );
        }
        const name = nameBuffer.toString("utf8");
        const stats = await lstat(descriptorPath(directory.fd, nameBuffer), { bigint: true });
        entries.push({
          name,
          path: logicalPath === "" ? name : `${logicalPath}/${name}`,
          type: entryType(stats),
          size: stats.size.toString(),
          modifiedAt: modifiedAt(stats),
        });
      }
    } finally {
      await stream.close().catch(() => undefined);
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    return entries;
  }

  private async readStable(
    handle: FileHandle,
    initialStats: BigIntStats,
    signal?: AbortSignal,
  ): Promise<{ buffer: Buffer; stats: BigIntStats }> {
    if (initialStats.size > BigInt(this.config.maxFileBytes)) {
      throw new FileAccessError("FILE_TOO_LARGE", "The mapped file exceeds the configured limit.");
    }
    const chunks: Buffer[] = [];
    let position = 0;
    while (position <= this.config.maxFileBytes) {
      throwIfCancelled(signal);
      const remaining = this.config.maxFileBytes + 1 - position;
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position > this.config.maxFileBytes) {
      throw new FileAccessError("FILE_TOO_LARGE", "The mapped file exceeds the configured limit.");
    }
    const finalStats = await handle.stat({ bigint: true });
    if (!sameRevision(initialStats, finalStats)) {
      throw new FileAccessError("CONFLICT", "The mapped file changed while it was being read.");
    }
    return { buffer: Buffer.concat(chunks, position), stats: finalStats };
  }

  private async overwriteOpenedFile(
    root: FileRootConfig,
    segments: string[],
    path: string,
    content: Buffer,
    expectedSha256: string,
    signal?: AbortSignal,
  ): Promise<FileWriteResult> {
    let opened: OpenedFile | undefined;
    try {
      opened = await this.openRegularFile(root, segments, WRITE_FLAGS);
      const active = opened;
      const inodeKey = `${active.stats.dev}:${active.stats.ino}`;
      return await FileAccessService.withInodeWriteLock(inodeKey, async () => {
        const currentPathStats = await this.verifyOpenedPath(active, root);
        const current = await this.readStable(active.handle, currentPathStats, signal);
        const currentHash = sha256(current.buffer);
        if (currentHash !== expectedSha256) {
          throw new FileAccessError(
            "CONFLICT",
            "The mapped file no longer matches expectedSha256; read it again before writing.",
          );
        }
        const beforeWrite = await this.verifyOpenedPath(active, root);
        if (!sameRevision(current.stats, beforeWrite)) {
          throw new FileAccessError(
            "CONFLICT",
            "The mapped file changed before it could be written.",
          );
        }
        throwIfCancelled(signal);
        const nextHash = sha256(content);
        if (nextHash === currentHash) {
          return {
            root: root.name,
            path,
            size: content.length,
            modifiedAt: modifiedAt(beforeWrite),
            sha256: nextHash,
            changed: false,
          };
        }

        try {
          await this.writeAll(active.handle, content);
          await active.handle.truncate(content.length);
          await active.handle.sync();
        } catch {
          throw new FileAccessError(
            "PARTIAL_WRITE",
            "The mapped-file write failed and the file may contain partial content.",
          );
        }
        const finalPathStats = await this.verifyOpenedPath(active, root);
        const final = await this.readStable(active.handle, finalPathStats);
        const verifiedPathStats = await this.verifyOpenedPath(active, root);
        if (!sameRevision(final.stats, verifiedPathStats) || sha256(final.buffer) !== nextHash) {
          throw new FileAccessError(
            "CONFLICT",
            "Another process changed the mapped file during the write.",
          );
        }
        return {
          root: root.name,
          path,
          size: content.length,
          modifiedAt: modifiedAt(final.stats),
          sha256: nextHash,
          changed: true,
        };
      });
    } catch (error) {
      throw mapFsError(error);
    } finally {
      await this.closeOpenedFile(opened);
    }
  }

  private async writeAll(handle: FileHandle, value: Buffer): Promise<void> {
    let position = 0;
    while (position < value.length) {
      const { bytesWritten } = await handle.write(
        value,
        position,
        value.length - position,
        position,
      );
      if (bytesWritten === 0) {
        throw new FileAccessError("WRITE_FAILED", "The mapped-file write made no progress.");
      }
      position += bytesWritten;
    }
  }

  private async withWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.writeTails.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    this.writeTails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.writeTails.get(key) === tail) this.writeTails.delete(key);
    }
  }

  private static async withInodeWriteLock<T>(
    key: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = FileAccessService.inodeWriteTails.get(key) ?? Promise.resolve();
    const current = previous.then(operation, operation);
    const tail = current.then(
      () => undefined,
      () => undefined,
    );
    FileAccessService.inodeWriteTails.set(key, tail);
    try {
      return await current;
    } finally {
      if (FileAccessService.inodeWriteTails.get(key) === tail) {
        FileAccessService.inodeWriteTails.delete(key);
      }
    }
  }
}
