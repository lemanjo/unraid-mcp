import {
  chmodSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { FileAccessConfig, FileRootConfig } from "../src/config.js";
import { FileAccessError, FileAccessService } from "../src/file-access.js";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), "unraid-mcp-files-"));
  temporaryDirectories.push(path);
  return path;
}

function root(path: string, name = "appdata"): FileRootConfig {
  const canonical = realpathSync.native(path);
  const stats = statSync(canonical, { bigint: true });
  return { name, path: canonical, device: stats.dev, inode: stats.ino };
}

function config(
  roots: readonly FileRootConfig[],
  overrides: Partial<FileAccessConfig> = {},
): FileAccessConfig {
  return {
    roots,
    writableRoots: [],
    allowWrites: false,
    maxFileBytes: 1024,
    maxDirectoryEntries: 100,
    ...overrides,
  };
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { force: true, recursive: true });
  }
});

describe("FileAccessService", () => {
  it("lists one directory without following symlinks", async () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    writeFileSync(join(directory, "config.yml"), "enabled: true\n");
    mkdirSync(join(directory, "nested"));
    symlinkSync(outside, join(directory, "outside-link"));
    const service = new FileAccessService(config([root(directory)]));

    await expect(service.listDirectory("appdata", "", 10)).resolves.toMatchObject({
      root: "appdata",
      path: "",
      truncated: false,
      entries: [
        { name: "config.yml", path: "config.yml", type: "file" },
        { name: "nested", path: "nested", type: "directory" },
        { name: "outside-link", path: "outside-link", type: "symlink" },
      ],
    });
  });

  it("bounds directory results", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "a"), "a");
    writeFileSync(join(directory, "b"), "b");
    writeFileSync(join(directory, "c"), "c");
    const service = new FileAccessService(config([root(directory)]));

    const result = await service.listDirectory("appdata", "", 1);
    expect(result.entries).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("reads bounded UTF-8 content and returns its revision", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "config.json"), '{"enabled":true}\n');
    const service = new FileAccessService(config([root(directory)]));

    await expect(service.readFile("appdata", "config.json")).resolves.toMatchObject({
      root: "appdata",
      path: "config.json",
      size: 17,
      sha256: "a050ef06ea542b8fd8781f1e945f9adcd03c7ae5190719e66ba826e2059fce12",
      content: '{"enabled":true}\n',
    });
  });

  it.each([
    "../outside",
    "/etc/passwd",
    "nested//file",
    "nested/./file",
    "nested/../file",
    "nested\\file",
    "nested/",
  ])("rejects invalid logical path %s", async (path) => {
    const directory = temporaryDirectory();
    const service = new FileAccessService(config([root(directory)]));

    await expect(service.readFile("appdata", path)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects final and intermediate symlinks", async () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    writeFileSync(join(outside, "secret"), "secret");
    symlinkSync(join(outside, "secret"), join(directory, "file-link"));
    symlinkSync(outside, join(directory, "dir-link"));
    const service = new FileAccessService(config([root(directory)]));

    await expect(service.readFile("appdata", "file-link")).rejects.toMatchObject({
      code: "SYMLINK_FORBIDDEN",
    });
    await expect(service.readFile("appdata", "dir-link/secret")).rejects.toMatchObject({
      code: "SYMLINK_FORBIDDEN",
    });
  });

  it("rejects hard-linked files", async () => {
    const directory = temporaryDirectory();
    const outside = temporaryDirectory();
    const outsideFile = join(outside, "shared");
    writeFileSync(outsideFile, "secret");
    linkSync(outsideFile, join(directory, "shared"));
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );

    await expect(service.readFile("appdata", "shared")).rejects.toMatchObject({
      code: "HARD_LINK_FORBIDDEN",
    });
    await expect(
      service.overwriteFile("appdata", "shared", "changed", "0".repeat(64)),
    ).rejects.toMatchObject({ code: "HARD_LINK_FORBIDDEN" });
    expect(readFileSync(outsideFile, "utf8")).toBe("secret");
  });

  it("rejects oversized and non-UTF-8 files", async () => {
    const directory = temporaryDirectory();
    writeFileSync(join(directory, "large"), "12345");
    writeFileSync(join(directory, "binary"), Buffer.from([0xff, 0xfe]));
    const service = new FileAccessService(
      config([root(directory)], { maxFileBytes: 4 }),
    );

    await expect(service.readFile("appdata", "large")).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    await expect(service.readFile("appdata", "binary")).rejects.toMatchObject({
      code: "INVALID_UTF8",
    });
  });

  it("rejects directory names that are not valid UTF-8", async () => {
    const directory = temporaryDirectory();
    const invalidPath = Buffer.concat([Buffer.from(`${directory}/`), Buffer.from([0xff])]);
    writeFileSync(invalidPath, "content");
    const service = new FileAccessService(config([root(directory)]));

    await expect(service.listDirectory("appdata", "", 10)).rejects.toMatchObject({
      code: "INVALID_FILENAME",
    });
  });

  it("overwrites an existing revision while preserving inode, owner, group, and mode", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config.ini");
    writeFileSync(path, "enabled=no\n");
    chmodSync(path, 0o640);
    const before = statSync(path, { bigint: true });
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );
    const current = await service.readFile("appdata", "config.ini");

    const result = await service.overwriteFile(
      "appdata",
      "config.ini",
      "enabled=yes\n",
      current.sha256,
    );
    expect(result).toMatchObject({ changed: true });
    expect(result).not.toHaveProperty("content");
    const after = statSync(path, { bigint: true });
    expect(readFileSync(path, "utf8")).toBe("enabled=yes\n");
    expect(after.ino).toBe(before.ino);
    expect(after.uid).toBe(before.uid);
    expect(after.gid).toBe(before.gid);
    expect(after.mode & 0o777n).toBe(0o640n);
  });

  it("rejects stale revisions without modifying content", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config.ini");
    writeFileSync(path, "original\n");
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );

    await expect(
      service.overwriteFile("appdata", "config.ini", "changed\n", "0".repeat(64)),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(readFileSync(path, "utf8")).toBe("original\n");
  });

  it("serializes concurrent overwrites so only one matching revision succeeds", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config.ini");
    writeFileSync(path, "original\n");
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );
    const current = await service.readFile("appdata", "config.ini");

    const results = await Promise.allSettled([
      service.overwriteFile("appdata", "config.ini", "first\n", current.sha256),
      service.overwriteFile("appdata", "config.ini", "second\n", current.sha256),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(["first\n", "second\n"]).toContain(readFileSync(path, "utf8"));
  });

  it("serializes writes to the same inode across service instances", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config.ini");
    writeFileSync(path, "original\n");
    const fileConfig = config([root(directory)], {
      allowWrites: true,
      writableRoots: ["appdata"],
    });
    const firstService = new FileAccessService(fileConfig);
    const secondService = new FileAccessService(fileConfig);
    const current = await firstService.readFile("appdata", "config.ini");

    const results = await Promise.allSettled([
      firstService.overwriteFile("appdata", "config.ini", "first\n", current.sha256),
      secondService.overwriteFile("appdata", "config.ini", "second\n", current.sha256),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("rejects ill-formed write strings without modifying content", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config.ini");
    writeFileSync(path, "original\n");
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );
    const current = await service.readFile("appdata", "config.ini");

    await expect(
      service.overwriteFile("appdata", "config.ini", "\ud800", current.sha256),
    ).rejects.toMatchObject({ code: "INVALID_UTF8" });
    expect(readFileSync(path, "utf8")).toBe("original\n");
  });

  it("does not create files and enforces the writable-root allowlist", async () => {
    const directory = temporaryDirectory();
    const service = new FileAccessService(config([root(directory)]));

    await expect(
      service.overwriteFile("appdata", "missing", "new", "0".repeat(64)),
    ).rejects.toMatchObject({ code: "WRITE_DISABLED" });
    expect(() => readFileSync(join(directory, "missing"))).toThrow();

    const writable = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );
    await expect(
      writable.overwriteFile("appdata", "missing", "new", "0".repeat(64)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(() => readFileSync(join(directory, "missing"))).toThrow();
  });

  it("detects replacement of the configured root", async () => {
    const parent = temporaryDirectory();
    const directory = join(parent, "appdata");
    mkdirSync(directory);
    writeFileSync(join(directory, "config"), "original");
    const configuredRoot = root(directory);
    const service = new FileAccessService(config([configuredRoot]));
    renameSync(directory, join(parent, "old-appdata"));
    mkdirSync(directory);
    writeFileSync(join(directory, "config"), "replacement");

    await expect(service.readFile("appdata", "config")).rejects.toMatchObject({
      code: "ROOT_CHANGED",
    });
  });

  it("rejects kernel pseudo-filesystems even when directly supplied to the service", async () => {
    const service = new FileAccessService(config([root("/proc", "proc")]));

    await expect(service.readFile("proc", "self/environ")).rejects.toMatchObject({
      code: "FILESYSTEM_FORBIDDEN",
    });
  });

  it("does not disclose configured absolute paths in operational errors", async () => {
    const directory = temporaryDirectory();
    const service = new FileAccessService(config([root(directory)]));

    const error = await service.readFile("appdata", "missing").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(FileAccessError);
    expect((error as Error).message).not.toContain(directory);
  });

  it("rejects operations that are cancelled before filesystem access", async () => {
    const directory = temporaryDirectory();
    const path = join(directory, "config");
    writeFileSync(path, "original");
    const service = new FileAccessService(
      config([root(directory)], {
        allowWrites: true,
        writableRoots: ["appdata"],
      }),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      service.listDirectory("appdata", "", 10, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      service.readFile("appdata", "config", controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      service.overwriteFile(
        "appdata",
        "config",
        "changed",
        "0".repeat(64),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(readFileSync(path, "utf8")).toBe("original");
  });
});
