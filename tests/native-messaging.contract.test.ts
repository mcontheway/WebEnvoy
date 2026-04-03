import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.join(import.meta.dirname, ".."));
const binPath = path.join(repoRoot, "bin", "webenvoy");
const mockNativeHostPath = path.join(repoRoot, "tests", "fixtures", "native-host-mock.mjs");
const repoOwnedNativeHostPath = path.join(
  repoRoot,
  "dist",
  "runtime",
  "native-messaging",
  "native-host-entry.js"
);

const runCli = (args: string[], env?: Record<string, string>) =>
  spawnSync(process.execPath, [binPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });

const parseJson = (stdout: string) => JSON.parse(stdout.trim()) as Record<string, unknown>;
const createNativeHostCommand = (entryPath: string): string =>
  `"${process.execPath}" "${entryPath}"`;
const withNativeHost = (mode: string): Record<string, string> => ({
  WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(mockNativeHostPath),
  WEBENVOY_NATIVE_HOST_MODE: mode
});
const withRepoOwnedNativeHost = (): Record<string, string> => ({
  WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(repoOwnedNativeHostPath)
});
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const encodeNativeEnvelope = (envelope: Record<string, unknown>): Buffer => {
  const body = Buffer.from(JSON.stringify(envelope), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

const readSingleNativeEnvelope = async (
  stream: NodeJS.ReadableStream
): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    const cleanup = () => {
      stream.off("data", onData);
      stream.off("error", onError);
      stream.off("end", onEnd);
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const onEnd = () => {
      cleanup();
      reject(new Error("native host stdout ended before returning a framed response"));
    };

    const onData = (chunk: Buffer | string) => {
      buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      if (buffer.length < 4) {
        return;
      }
      const frameLength = buffer.readUInt32LE(0);
      const frameEnd = 4 + frameLength;
      if (buffer.length < frameEnd) {
        return;
      }
      cleanup();
      resolve(JSON.parse(buffer.subarray(4, frameEnd).toString("utf8")) as Record<string, unknown>);
    };

    stream.on("data", onData);
    stream.on("error", onError);
    stream.on("end", onEnd);
  });

describe("native messaging contract", () => {
  it("fails runtime.ping on default transport when no native host command is configured", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-default-001"]);
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_HANDSHAKE_FAILED"
    );
  });

  it("returns transport metadata on runtime.ping success via native host stdio bridge", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-001"], withNativeHost("success"));
    expect(result.status).toBe(0);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      command: "runtime.ping",
      status: "success"
    });
    expect(body.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1",
        relay_path: "host>background>content-script>background>host"
      }
    });
  });

  it("returns transport metadata on runtime.ping success via repo-owned native host entry", () => {
    const result = runCli(
      ["runtime.ping", "--run-id", "run-nm-repo-owned-001"],
      withRepoOwnedNativeHost()
    );
    expect(result.status).toBe(0);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      command: "runtime.ping",
      status: "success"
    });
    expect(body.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1",
        relay_path: "host>background>content-script>background>host"
      }
    });
  });

  it("keeps repo-owned native host responses stable across repeated forward calls", () => {
    for (let index = 0; index < 8; index += 1) {
      const result = runCli(
        ["runtime.ping", "--run-id", `run-nm-repo-owned-repeat-${index}`],
        withRepoOwnedNativeHost()
      );
      expect(result.status).toBe(0);

      const body = parseJson(result.stdout);
      expect(body).toMatchObject({
        command: "runtime.ping",
        status: "success"
      });
      expect(body.summary).toMatchObject({
        message: "pong",
        transport: {
          protocol: "webenvoy.native-bridge.v1",
          relay_path: "host>background>content-script>background>host"
        }
      });
    }
  });

  it("keeps repo-owned native host entry compatible with legacy profile-dir launcher env", async () => {
    const profileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-entry-legacy-"));
    tempDirs.push(profileDir);
    const socketPath = path.join(profileDir, "nm.sock");
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: profileDir
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-legacy-profile-dir-001",
          method: "bridge.open",
          profile: "ignored-profile-name",
          params: {},
          timeout_ms: 100
        })
      );
      expect(await responsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });
      await expect(access(socketPath)).resolves.toBeUndefined();
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("keeps repo-owned native host entry compatible with profile-root bootstrap socket handshake", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-entry-profile-root-"));
    tempDirs.push(profileRoot);
    const socketPath = path.join(profileRoot, "nm.sock");
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-profile-root-001",
          method: "bridge.open",
          profile: null,
          params: {},
          timeout_ms: 100
        })
      );
      expect(await responsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });
      await expect(access(socketPath)).resolves.toBeUndefined();
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("prefers profile-root routing for profiled requests when both launcher envs are present", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-legacy-"));
    const profileName = "xhs_dual_profile";
    const profileSocketPath = path.join(profileRoot, profileName, "nm.sock");
    tempDirs.push(profileRoot, legacyProfileDir);
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: legacyProfileDir
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-dual-env-profile-root-001",
          method: "bridge.open",
          profile: profileName,
          params: {},
          timeout_ms: 100
        })
      );
      expect(await responsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });
      await expect(access(profileSocketPath)).resolves.toBeUndefined();
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("keeps legacy profile-dir handshake when both launcher envs are present without a profile", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-boot-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-boot-legacy-"));
    const legacySocketPath = path.join(legacyProfileDir, "nm.sock");
    tempDirs.push(profileRoot, legacyProfileDir);
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: legacyProfileDir
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-dual-env-legacy-bootstrap-001",
          method: "bridge.open",
          profile: null,
          params: {},
          timeout_ms: 100
        })
      );
      expect(await responsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });
      await expect(access(legacySocketPath)).resolves.toBeUndefined();
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("maps transport timeout to runtime unavailable exit code without loopback", () => {
    const result = runCli([
      "runtime.ping",
      "--run-id",
      "run-nm-002",
      "--params",
      '{"timeout_ms":100}'
    ], withNativeHost("drop-forward"));
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_TIMEOUT"
    );
  });

  it("returns runtime store error when persistence is unavailable during native messaging failure", () => {
    const result = runCli(
      [
        "runtime.ping",
        "--run-id",
        "run-nm-store-warning-001",
        "--params",
        '{"timeout_ms":100}'
      ],
      {
        ...withNativeHost("drop-forward"),
        WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE: "1"
      }
    );
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE"
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_RUNTIME_STORE_UNAVAILABLE"
    );
    expect(String((body.error as Record<string, unknown>).message)).not.toContain(
      "ERR_TRANSPORT_TIMEOUT"
    );
    expect(result.stderr).toBe("");
  });

  it("maps transport disconnect to runtime unavailable exit code without loopback", () => {
    const result = runCli(["runtime.ping", "--run-id", "run-nm-003"], withNativeHost("disconnect-on-forward"));
    expect(result.status).toBe(5);

    const body = parseJson(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_RUNTIME_UNAVAILABLE",
        retryable: true
      }
    });
    expect(String((body.error as Record<string, unknown>).message)).toContain(
      "ERR_TRANSPORT_DISCONNECTED"
    );
  });
});
