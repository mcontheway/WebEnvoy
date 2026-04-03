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
const PROFILE_MODE_ROOT_PREFERRED = "profile_root_preferred";
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

  it("keeps rejecting stdio bridge.forward after profile-root bootstrap without legacy launcher env", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-entry-root-only-"));
    tempDirs.push(profileRoot);
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot
      }
    });

    try {
      const openResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-root-only-001",
          method: "bridge.open",
          profile: null,
          params: {},
          timeout_ms: 100
        })
      );
      expect(await openResponsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });

      const forwardResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "forward-root-only-001",
          method: "bridge.forward",
          profile: null,
          params: {
            session_id: "nm-session-001",
            run_id: "run-root-only-001",
            command: "runtime.ping",
            command_params: {},
            cwd: repoRoot
          },
          timeout_ms: 100
        })
      );
      expect(await forwardResponsePromise).toMatchObject({
        status: "error",
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "unsupported extension request: bridge.forward"
        }
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("preserves legacy profile-dir routing for profiled requests when both launcher envs are present without profile mode", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-legacy-"));
    const profileName = "xhs_dual_profile";
    const profileSocketPath = path.join(profileRoot, profileName, "nm.sock");
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
      await expect(access(legacySocketPath)).resolves.toBeUndefined();
      await expect(access(profileSocketPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("keeps compatibility-only stdio forward fallback after legacy profile-dir bootstrap when both launcher envs are present without profile mode", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-boot-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-boot-legacy-"));
    const rootSocketPath = path.join(profileRoot, "nm.sock");
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
      await expect(access(rootSocketPath)).rejects.toMatchObject({
        code: "ENOENT"
      });

      const forwardResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "forward-dual-env-legacy-bootstrap-001",
          method: "bridge.forward",
          profile: null,
          params: {
            session_id: "nm-session-001",
            run_id: "run-dual-env-legacy-bootstrap-001",
            command: "runtime.ping",
            command_params: {},
            cwd: repoRoot
          },
          timeout_ms: 100
        })
      );
      expect(await forwardResponsePromise).toMatchObject({
        status: "success",
        summary: {
          session_id: "nm-session-001",
          command: "runtime.ping",
          run_id: "run-dual-env-legacy-bootstrap-001",
          relay_path: "host>background>content-script>background>host"
        },
        payload: {
          message: "pong",
          run_id: "run-dual-env-legacy-bootstrap-001",
          profile: null,
          cwd: repoRoot
        }
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("does not synthesize runtime.bootstrap readiness on legacy dual-env stdio compatibility fallback", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-bootstrap-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-bootstrap-legacy-"));
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
      const openResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-dual-env-legacy-bootstrap-guard-001",
          method: "bridge.open",
          profile: null,
          params: {},
          timeout_ms: 100
        })
      );
      expect(await openResponsePromise).toMatchObject({
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready"
        }
      });

      const bootstrapResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "forward-dual-env-legacy-bootstrap-guard-001",
          method: "bridge.forward",
          profile: null,
          params: {
            session_id: "nm-session-001",
            run_id: "run-dual-env-legacy-bootstrap-guard-001",
            command: "runtime.bootstrap",
            command_params: {
              version: "v1",
              runtime_context_id: "runtime-context-legacy-guard-001"
            },
            cwd: repoRoot
          },
          timeout_ms: 100
        })
      );
      expect(await bootstrapResponsePromise).toMatchObject({
        status: "error",
        summary: {
          session_id: "nm-session-001",
          run_id: "run-dual-env-legacy-bootstrap-guard-001",
          command: "runtime.bootstrap",
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
          message: "runtime bootstrap 尚未获得执行面确认"
        }
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("routes profiled requests through the canonical profile-root socket when dual-env launchers set profile mode", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "wv-nmr-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "wv-nml-"));
    const profileName = "p";
    const profileSocketPath = path.join(profileRoot, profileName, "nm.sock");
    const legacySocketPath = path.join(legacyProfileDir, "nm.sock");
    tempDirs.push(profileRoot, legacyProfileDir);
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: legacyProfileDir,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE: PROFILE_MODE_ROOT_PREFERRED
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-dual-env-root-preferred-profile-001",
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
      await expect(access(legacySocketPath)).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.once("close", () => resolve());
      });
    }
  });

  it("keeps dual-env root-preferred launchers on canonical root transport semantics", async () => {
    const profileRoot = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-mode-boot-root-"));
    const legacyProfileDir = await mkdtemp(path.join(tmpdir(), "webenvoy-nm-dual-mode-boot-legacy-"));
    const rootSocketPath = path.join(profileRoot, "nm.sock");
    const legacySocketPath = path.join(legacyProfileDir, "nm.sock");
    tempDirs.push(profileRoot, legacyProfileDir);
    const child = spawn(process.execPath, [repoOwnedNativeHostPath], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT: profileRoot,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR: legacyProfileDir,
        WEBENVOY_NATIVE_BRIDGE_PROFILE_MODE: PROFILE_MODE_ROOT_PREFERRED
      }
    });

    try {
      const responsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "open-dual-env-root-preferred-bootstrap-001",
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
      await expect(access(rootSocketPath)).resolves.toBeUndefined();
      await expect(access(legacySocketPath)).rejects.toMatchObject({
        code: "ENOENT"
      });

      const forwardResponsePromise = readSingleNativeEnvelope(child.stdout);
      child.stdin.write(
        encodeNativeEnvelope({
          id: "forward-dual-env-root-preferred-bootstrap-001",
          method: "bridge.forward",
          profile: null,
          params: {
            session_id: "nm-session-001",
            run_id: "run-dual-env-root-preferred-bootstrap-001",
            command: "runtime.ping",
            command_params: {},
            cwd: repoRoot
          },
          timeout_ms: 100
        })
      );
      expect(await forwardResponsePromise).toMatchObject({
        status: "error",
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "unsupported extension request: bridge.forward"
        }
      });
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
