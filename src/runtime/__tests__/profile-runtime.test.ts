import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileRuntimeService } from "../profile-runtime.js";
import { BROWSER_STATE_FILENAME } from "../browser-launcher.js";
import type { BrowserLaunchInput } from "../browser-launcher.js";
import { NativeMessagingTransportError } from "../native-messaging/bridge.js";
import type { ProfileLock } from "../profile-lock.js";
import { ProfileStore, type ProfileMeta } from "../profile-store.js";
import { buildRuntimeBootstrapContextId } from "../runtime-bootstrap.js";

const tempDirs: string[] = [];
const originalBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
const originalBrowserVersion = process.env.WEBENVOY_BROWSER_VERSION;
const originalPath = process.env.PATH;
const originalLocalAppData = process.env.LOCALAPPDATA;
const originalAppData = process.env.APPDATA;
const originalPlatform = process.platform;
const PERSISTENT_EXTENSION_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const createMockBrowserExecutable = async (
  versionOutput: string = "Chromium 146.0.0.0"
): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-browser-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "mock-browser.mjs");
  await writeFile(
    scriptPath,
    `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  console.log(${JSON.stringify(versionOutput)});
  process.exit(0);
}
setInterval(() => {}, 1000);
`,
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  return scriptPath;
};

const createMockBrowserLauncher = () => ({
  launch: async () => ({
    browserPath: "/mock/chrome",
    browserPid: 999999,
    controllerPid: 999998,
    launchArgs: ["about:blank"],
    launchedAt: new Date().toISOString()
  }),
  shutdown: async () => undefined
});

const createReadyRuntimeBridge = () => ({
  runCommand: async ({
    command,
    params,
    profile,
    runId
  }: {
    command: string;
    params: Record<string, unknown>;
    profile: string | null;
    runId: string;
  }) => {
    if (command === "runtime.bootstrap") {
      return {
        ok: true as const,
        payload: {
          result: {
            version: "v1",
            run_id: runId,
            runtime_context_id: String(params.runtime_context_id),
            profile,
            status: "ready"
          }
        },
        relay_path: "host>background"
      };
    }
    if (command === "runtime.readiness") {
      return {
        ok: true as const,
        payload: {
          bootstrap_state: "ready",
          transport_state: "ready"
        },
        relay_path: "host>background"
      };
    }
    throw new Error(`unexpected bridge command: ${command}`);
  }
});

const createNativeHostManifest = async (input: {
  nativeHostName?: string;
  allowedOrigins: string[];
}): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-manifest-"));
  tempDirs.push(dir);
  const manifestPath = join(dir, `${input.nativeHostName ?? "com.webenvoy.host"}.json`);
  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: input.nativeHostName ?? "com.webenvoy.host",
        path: "/mock/webenvoy-host",
        type: "stdio",
        allowed_origins: input.allowedOrigins
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  return manifestPath;
};

const seedInstalledPersistentExtension = async (input: {
  baseDir: string;
  profile: string;
  extensionId?: string;
  enabled?: boolean;
}): Promise<void> => {
  const extensionId = input.extensionId ?? PERSISTENT_EXTENSION_ID;
  const profileDir = join(input.baseDir, ".webenvoy", "profiles", input.profile, "Default");
  const extensionDir = join(profileDir, "Extensions", extensionId, "1.0.0");
  await mkdir(extensionDir, { recursive: true });
  await writeFile(join(extensionDir, "manifest.json"), "{\n  \"manifest_version\": 3\n}\n", "utf8");
  await writeFile(
    join(profileDir, "Preferences"),
    `${JSON.stringify(
      {
        extensions: {
          settings: {
            [extensionId]: {
              state: input.enabled === false ? 0 : 1
            }
          }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
};

const createMockRegExecutable = async (manifestPath: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "webenvoy-native-host-reg-"));
  tempDirs.push(dir);
  const scriptPath = join(dir, "reg");
  await writeFile(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "query" ]; then
  printf '%s\\n' "$2"
  printf '    (Default)    REG_SZ    %s\\n' ${JSON.stringify(manifestPath)}
  exit 0
fi
exit 1
`,
    "utf8"
  );
  await chmod(scriptPath, 0o755);
  return dir;
};

const createTestService = (
  options?: ConstructorParameters<typeof ProfileRuntimeService>[0]
): ProfileRuntimeService =>
  new ProfileRuntimeService({
    ...options,
    bridgeFactory: options?.bridgeFactory ?? (() => createReadyRuntimeBridge()),
    isProcessAlive:
      options?.isProcessAlive ??
      ((pid: number) => {
        if (pid === 999999 || pid === 999998) {
          return true;
        }
        if (!Number.isInteger(pid) || pid <= 0) {
          return false;
        }
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      }),
    browserLauncher: options?.browserLauncher ?? createMockBrowserLauncher()
  });

beforeEach(async () => {
  process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable();
  delete process.env.WEBENVOY_BROWSER_VERSION;
});

afterEach(async () => {
  if (originalBrowserPath === undefined) {
    delete process.env.WEBENVOY_BROWSER_PATH;
  } else {
    process.env.WEBENVOY_BROWSER_PATH = originalBrowserPath;
  }
  if (originalBrowserVersion === undefined) {
    delete process.env.WEBENVOY_BROWSER_VERSION;
  } else {
    process.env.WEBENVOY_BROWSER_VERSION = originalBrowserVersion;
  }
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  if (originalLocalAppData === undefined) {
    delete process.env.LOCALAPPDATA;
  } else {
    process.env.LOCALAPPDATA = originalLocalAppData;
  }
  if (originalAppData === undefined) {
    delete process.env.APPDATA;
  } else {
    process.env.APPDATA = originalAppData;
  }
  Object.defineProperty(process, "platform", { value: originalPlatform });
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

class FailingWriteProfileStore {
  readonly #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async ensureProfileDir(profileName: string): Promise<string> {
    const profileDir = this.getProfileDir(profileName);
    await mkdir(profileDir, { recursive: true });
    return profileDir;
  }

  getProfileDir(profileName: string): string {
    return join(this.#rootDir, profileName);
  }

  async readMeta(_profileName: string): Promise<ProfileMeta | null> {
    return null;
  }

  async initializeMeta(profileName: string, nowIso: string): Promise<ProfileMeta> {
    const profileDir = await this.ensureProfileDir(profileName);
    return {
      schemaVersion: 1,
      profileName,
      profileDir,
      profileState: "uninitialized",
      proxyBinding: null,
      fingerprintSeeds: {
        audioNoiseSeed: `${profileName}-audio-seed`,
        canvasNoiseSeed: `${profileName}-canvas-seed`
      },
      localStorageSnapshots: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      lastStartedAt: null,
      lastLoginAt: null,
      lastStoppedAt: null,
      lastDisconnectedAt: null
    };
  }

  async writeMeta(_profileName: string, _meta: ProfileMeta): Promise<void> {
    throw new Error("simulated meta write failure");
  }
}

class StopMetaWriteFailProfileStore {
  readonly #delegate: ProfileStore;

  constructor(rootDir: string) {
    this.#delegate = new ProfileStore(rootDir);
  }

  ensureProfileDir(profileName: string): Promise<string> {
    return this.#delegate.ensureProfileDir(profileName);
  }

  getProfileDir(profileName: string): string {
    return this.#delegate.getProfileDir(profileName);
  }

  readMeta(profileName: string): Promise<ProfileMeta | null> {
    return this.#delegate.readMeta(profileName);
  }

  initializeMeta(profileName: string, nowIso: string): Promise<ProfileMeta> {
    return this.#delegate.initializeMeta(profileName, nowIso);
  }

  async writeMeta(profileName: string, meta: ProfileMeta): Promise<void> {
    if (meta.profileState === "stopped") {
      throw new Error("simulated stop meta write failure");
    }
    await this.#delegate.writeMeta(profileName, meta);
  }
}

const failingDeleteLockAdapter = {
  readFile: async (path: string, encoding: "utf8") => readFile(path, encoding),
  writeFile: async (
    path: string,
    data: string,
    options?: { encoding?: "utf8"; flag?: string } | "utf8"
  ) => {
    if (typeof options === "string") {
      await writeFile(path, data, options);
      return;
    }
    await writeFile(path, data, options);
  },
  unlink: async (_path: string) => {
    const error = new Error("simulated lock delete failure") as NodeJS.ErrnoException;
    error.code = "EBUSY";
    throw error;
  }
};

const createFlakyDeleteLockAdapter = (failuresBeforeSuccess: number) => {
  let failures = 0;
  return {
    readFile: async (path: string, encoding: "utf8") => readFile(path, encoding),
    writeFile: async (
      path: string,
      data: string,
      options?: { encoding?: "utf8"; flag?: string } | "utf8"
    ) => {
      if (typeof options === "string") {
        await writeFile(path, data, options);
        return;
      }
      await writeFile(path, data, options);
    },
    unlink: async (path: string) => {
      if (failures < failuresBeforeSuccess) {
        failures += 1;
        const error = new Error("simulated transient lock delete failure") as NodeJS.ErrnoException;
        error.code = "EBUSY";
        throw error;
      }
      await rm(path, { force: true });
    }
  };
};

describe("profile-runtime start rollback", () => {
  it("rolls back lock file when meta write fails", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-"));
    tempDirs.push(baseDir);
    const profileRootDir = join(baseDir, ".webenvoy", "profiles");
    const service = createTestService({
      storeFactory: () => new FailingWriteProfileStore(profileRootDir)
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "rollback_profile",
        runId: "run-runtime-test-001",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE"
    });

    const lockPath = join(profileRootDir, "rollback_profile", "__webenvoy_lock.json");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("profile-runtime identity preflight", () => {
  it("reports missing identity binding in runtime.status for official Chrome persistent path", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-status-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const service = createTestService();

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_missing_profile",
      runId: "run-runtime-identity-status-001",
      params: {}
    });

    expect(status).toMatchObject({
      profileState: "uninitialized",
      lockHeld: false,
      identityBindingState: "missing",
      transportState: "not_connected",
      bootstrapState: "not_started",
      runtimeReadiness: "blocked",
      identityPreflight: {
        mode: "official_chrome_persistent_extension",
        failureReason: "IDENTITY_BINDING_MISSING"
      }
    });
  });

  it("reports missing identity binding in runtime.status for a fresh profile when params provide binding but the extension is absent", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-status-fresh-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const service = createTestService();

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_missing_fresh_status_profile",
      runId: "run-runtime-identity-status-fresh-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(status).toMatchObject({
      profileState: "uninitialized",
      lockHeld: false,
      identityBindingState: "missing",
      transportState: "not_connected",
      bootstrapState: "not_started",
      runtimeReadiness: "blocked",
      identityPreflight: {
        mode: "official_chrome_persistent_extension",
        failureReason: "IDENTITY_BINDING_MISSING",
        manifestPath
      }
    });
  });

  it("keeps first runtime.start/login available when official Chrome identity is still missing", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-entry-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const launchSpy = vi.fn();
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_missing_start_profile",
        runId: "run-runtime-identity-entry-001",
        params: {}
      })
    ).resolves.toMatchObject({
      profileState: "ready",
      browserState: "ready",
      lockHeld: true,
      runtimeReadiness: "blocked"
    });

    await expect(
      service.login({
        cwd: baseDir,
        profile: "identity_missing_login_profile",
        runId: "run-runtime-identity-entry-002",
        params: {}
      })
    ).resolves.toMatchObject({
      profileState: "logging_in",
      browserState: "logging_in",
      lockHeld: true,
      runtimeReadiness: "blocked",
      confirmationRequired: true
    });

    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(launchSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        launchMode: "official_chrome_persistent_extension",
        extensionBootstrap: null
      })
    );
    expect(launchSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        launchMode: "official_chrome_persistent_extension",
        extensionBootstrap: null
      })
    );
  });

  it("keeps fresh runtime.start/login blocked-from-ready when params provide binding but the extension is absent", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-entry-fresh-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const launchSpy = vi.fn();
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_missing_bound_start_profile",
        runId: "run-runtime-identity-entry-fresh-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready",
      browserState: "ready",
      lockHeld: true,
      identityBindingState: "missing",
      runtimeReadiness: "blocked"
    });

    await expect(
      service.login({
        cwd: baseDir,
        profile: "identity_missing_bound_login_profile",
        runId: "run-runtime-identity-entry-fresh-002",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "logging_in",
      browserState: "logging_in",
      lockHeld: true,
      identityBindingState: "missing",
      runtimeReadiness: "blocked",
      confirmationRequired: true
    });

    expect(launchSpy).toHaveBeenCalledTimes(2);
    expect(launchSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        launchMode: "official_chrome_persistent_extension",
        extensionBootstrap: null
      })
    );
    expect(launchSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        launchMode: "official_chrome_persistent_extension",
        extensionBootstrap: null
      })
    );
  });

  it("keeps bound official Chrome start pending until bootstrap is attested by execution surface", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-pending-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_ready_profile"
    });
    const launchSpy = vi.fn();
    const bridgeRunCommand = vi.fn(async ({ command }) => {
      if (command === "runtime.bootstrap") {
        return {
          ok: false as const,
          error: {
            code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
            message: "runtime bootstrap 尚未获得执行面确认"
          }
        };
      }
      if (command === "runtime.readiness") {
        return {
          ok: true as const,
          payload: {
            bootstrap_state: "pending"
          },
          relay_path: "host>background"
        };
      }
      throw new Error(`unexpected bridge command: ${command}`);
    });
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      },
      bridgeFactory: () => ({
        runCommand: bridgeRunCommand
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_ready_profile",
      runId: "run-runtime-bootstrap-ready-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      profileState: "ready",
      browserState: "ready",
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "pending",
      runtimeReadiness: "pending"
    });
    expect(launchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        launchMode: "official_chrome_persistent_extension",
        extensionBootstrap: null
      })
    );
    expect(bridgeRunCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap",
        profile: "identity_bound_ready_profile"
      })
    );
  });

  it("keeps readiness conservative when runtime.readiness omits transport_state", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-readiness-transport-missing-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_transport_missing_profile"
    });
    const readinessContextIds: string[] = [];
    const service = createTestService({
      browserLauncher: createMockBrowserLauncher(),
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: String((params as { runtime_context_id?: unknown }).runtime_context_id),
                  profile,
                  status: "ready"
                }
              },
              relay_path: "host>background"
            };
          }
          if (command === "runtime.readiness") {
            readinessContextIds.push(String((params as { runtime_context_id?: unknown }).runtime_context_id));
            return {
              ok: true as const,
              payload: {
                bootstrap_state: "ready"
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    await service.start({
      cwd: baseDir,
      profile: "identity_bound_transport_missing_profile",
      runId: "run-runtime-readiness-transport-missing-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_bound_transport_missing_profile",
      runId: "run-runtime-readiness-transport-missing-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(status).toMatchObject({
      profileState: "ready",
      lockHeld: true,
      identityBindingState: "bound",
      transportState: "not_connected",
      bootstrapState: "ready",
      runtimeReadiness: "unknown"
    });
    expect(readinessContextIds).toEqual([
      buildRuntimeBootstrapContextId(
        "identity_bound_transport_missing_profile",
        "run-runtime-readiness-transport-missing-001"
      )
    ]);
  });

  it("marks runtime.status as blocked when runtime.readiness reports stale bootstrap", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-readiness-stale-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_readiness_stale_profile"
    });
    const readinessContextIds: string[] = [];
    const service = createTestService({
      browserLauncher: createMockBrowserLauncher(),
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: String((params as { runtime_context_id?: unknown }).runtime_context_id),
                  profile,
                  status: "ready"
                }
              },
              relay_path: "host>background"
            };
          }
          if (command === "runtime.readiness") {
            readinessContextIds.push(String((params as { runtime_context_id?: unknown }).runtime_context_id));
            return {
              ok: true as const,
              payload: {
                bootstrap_state: "stale",
                transport_state: "ready"
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    await service.start({
      cwd: baseDir,
      profile: "identity_bound_readiness_stale_profile",
      runId: "run-runtime-readiness-stale-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_bound_readiness_stale_profile",
      runId: "run-runtime-readiness-stale-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(status).toMatchObject({
      profileState: "ready",
      lockHeld: true,
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "stale",
      runtimeReadiness: "blocked"
    });
    expect(readinessContextIds).toEqual([
      buildRuntimeBootstrapContextId(
        "identity_bound_readiness_stale_profile",
        "run-runtime-readiness-stale-001"
      )
    ]);
  });

  it("marks readiness unknown when runtime.bootstrap ack version conflicts with the request", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-version-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_version_conflict_profile"
    });
    const service = createTestService({
      browserLauncher: createMockBrowserLauncher(),
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v0",
                  run_id: runId,
                  runtime_context_id: String((params as { runtime_context_id?: unknown }).runtime_context_id),
                  profile,
                  status: "ready"
                }
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_version_conflict_profile",
      runId: "run-runtime-bootstrap-version-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "failed",
      runtimeReadiness: "unknown"
    });
  });

  it("keeps transport failures distinct from bootstrap readiness during runtime.start", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-timeout-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_ack_timeout_profile"
    });
    const service = createTestService({
      bridgeFactory: () => ({
        runCommand: async () => {
          throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "mock timeout");
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_ack_timeout_profile",
      runId: "run-runtime-bootstrap-timeout-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "disconnected",
      bootstrapState: "not_started",
      runtimeReadiness: "recoverable"
    });
  });

  it("maps runtime.bootstrap handshake failure to transport-not-connected readiness", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-handshake-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_handshake_failure_profile"
    });
    const service = createTestService({
      bridgeFactory: () => ({
        runCommand: async () => {
          throw new NativeMessagingTransportError("ERR_TRANSPORT_HANDSHAKE_FAILED", "mock handshake failed");
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_handshake_failure_profile",
      runId: "run-runtime-bootstrap-handshake-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "not_connected",
      bootstrapState: "not_started",
      runtimeReadiness: "recoverable"
    });
  });

  it("maps stale runtime.bootstrap ack to blocked readiness", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-stale-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_ack_stale_profile"
    });
    const service = createTestService({
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: String((params as { runtime_context_id?: unknown }).runtime_context_id),
                  profile,
                  status: "stale"
                }
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_ack_stale_profile",
      runId: "run-runtime-bootstrap-stale-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "stale",
      runtimeReadiness: "blocked"
    });
  });

  it("maps runtime.bootstrap ready-signal conflict to failed bootstrap state", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-conflict-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_ready_signal_conflict_profile"
    });
    const service = createTestService({
      bridgeFactory: () => ({
        runCommand: async ({ command, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: "runtime-context-mismatch",
                  profile,
                  status: "ready"
                }
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_ready_signal_conflict_profile",
      runId: "run-runtime-bootstrap-conflict-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "failed",
      runtimeReadiness: "unknown"
    });
  });

  it("marks readiness recoverable when runtime.bootstrap ack times out", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-timeout-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_timeout_profile"
    });
    const service = createTestService({
      browserLauncher: createMockBrowserLauncher(),
      bridgeFactory: () => ({
        runCommand: async ({ command }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: false as const,
              error: {
                code: "ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT",
                message: "runtime bootstrap ack 超时"
              }
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_timeout_profile",
      runId: "run-runtime-bootstrap-timeout-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "pending",
      runtimeReadiness: "recoverable"
    });
  });

  it("marks readiness blocked when runtime.bootstrap returns a stale ack", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-bootstrap-stale-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_stale_profile"
    });
    const service = createTestService({
      browserLauncher: createMockBrowserLauncher(),
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: String((params as { runtime_context_id?: unknown }).runtime_context_id),
                  profile,
                  status: "stale"
                }
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "identity_bound_stale_profile",
      runId: "run-runtime-bootstrap-stale-001",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });

    expect(started).toMatchObject({
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "stale",
      runtimeReadiness: "blocked"
    });
  });

  it("blocks runtime.start when allowed_origins mismatches bound extension identity", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-mismatch-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_mismatch_profile"
    });
    const launchSpy = vi.fn();
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_mismatch_profile",
        runId: "run-runtime-identity-mismatch-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_IDENTITY_MISMATCH"
    });

    expect(launchSpy).not.toHaveBeenCalled();
    await expect(
      readFile(
        join(baseDir, ".webenvoy", "profiles", "identity_mismatch_profile", "__webenvoy_lock.json"),
        "utf8"
      )
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(
      readFile(
        join(baseDir, ".webenvoy", "profiles", "identity_mismatch_profile", "__webenvoy_meta.json"),
        "utf8"
      )
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("keeps later run_id blocked in runtime.status after runtime.start", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-bound-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_bound_profile"
    });
    const launchSpy = vi.fn();
    const ownerRuntimeContextId = buildRuntimeBootstrapContextId(
      "identity_bound_profile",
      "run-runtime-identity-bound-001"
    );
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      },
      bridgeFactory: () => ({
        runCommand: async ({ command, params, profile, runId }) => {
          if (command === "runtime.bootstrap") {
            return {
              ok: true as const,
              payload: {
                result: {
                  version: "v1",
                  run_id: runId,
                  runtime_context_id: String(params.runtime_context_id),
                  profile,
                  status: "ready"
                }
              },
              relay_path: "host>background"
            };
          }
          if (command === "runtime.readiness") {
            return {
              ok: true as const,
              payload: {
                transport_state: "ready",
                bootstrap_state:
                  String(params.runtime_context_id) === ownerRuntimeContextId ? "ready" : "stale"
              },
              relay_path: "host>background"
            };
          }
          throw new Error(`unexpected bridge command: ${command}`);
        }
      })
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_bound_profile",
        runId: "run-runtime-identity-bound-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profile: "identity_bound_profile",
      profileState: "ready",
      browserState: "ready",
      lockHeld: true
    });

    expect(launchSpy).toHaveBeenCalledTimes(1);

    const profileStore = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    const meta = await profileStore.readMeta("identity_bound_profile");
    expect(meta).not.toHaveProperty("persistentExtensionBinding");

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_bound_profile",
      runId: "run-runtime-identity-bound-002",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        }
      }
    });
    expect(status).toMatchObject({
      lockHeld: false,
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "ready",
      runtimeReadiness: "blocked",
      identityPreflight: {
        mode: "official_chrome_persistent_extension",
        blocking: false,
        manifestPath,
        expectedOrigin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
      }
    });
  });

  it("surfaces later live-mode fingerprint gating after identity preflight succeeds", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-live-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_live_profile"
    });
    const launchSpy = vi.fn();
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_live_profile",
        runId: "run-runtime-identity-live-001",
        params: {
          requested_execution_mode: "live_read_high_risk",
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID"
    });

    expect(launchSpy).not.toHaveBeenCalled();

    const profileStore = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    const meta = await profileStore.readMeta("identity_live_profile");
    expect(meta).toBeNull();

  });

  it("keeps runtime.login available without persisting identity binding into profile meta", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-login-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_login_profile"
    });
    const launchSpy = vi.fn();
    const service = createTestService({
      browserLauncher: {
        launch: async (input) => {
          launchSpy(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    await expect(
      service.login({
        cwd: baseDir,
        profile: "identity_login_profile",
        runId: "run-runtime-identity-login-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profile: "identity_login_profile",
      profileState: "logging_in",
      browserState: "logging_in",
      lockHeld: true,
      confirmationRequired: true
    });

    expect(launchSpy).toHaveBeenCalledTimes(1);

    const profileStore = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    const meta = await profileStore.readMeta("identity_login_profile");
    expect(meta?.profileState).toBe("logging_in");
    expect(meta).not.toHaveProperty("persistentExtensionBinding");
  });

  it("keeps identity preflight bound when later calls provide identity params", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-reuse-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://cccccccccccccccccccccccccccccccc/"]
    });
    const extensionId = "cccccccccccccccccccccccccccccccc";
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_reuse_profile",
      extensionId
    });
    const service = createTestService();

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_reuse_profile",
        runId: "run-runtime-identity-reuse-001",
        params: {
          persistent_extension_identity: {
            extension_id: extensionId,
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready"
    });

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_reuse_profile",
      runId: "run-runtime-identity-reuse-002",
      params: {
        persistent_extension_identity: {
          extension_id: extensionId,
          manifest_path: manifestPath
        }
      }
    });

    expect(status.identityBindingState).toBe("bound");
    expect(status.identityPreflight).toMatchObject({
      manifestPath,
      expectedOrigin: "chrome-extension://cccccccccccccccccccccccccccccccc/"
    });
  });

  it("does not report lockHeld or ready runtimeReadiness for a non-owner status query", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-status-non-owner-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "status_non_owner_profile"
    });
    const service = createTestService();

    await expect(
      service.start({
        cwd: baseDir,
        profile: "status_non_owner_profile",
        runId: "run-runtime-status-owner-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready",
      lockHeld: true,
      runtimeReadiness: "ready"
    });

    await expect(
      service.status({
        cwd: baseDir,
        profile: "status_non_owner_profile",
        runId: "run-runtime-status-other-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready",
      lockHeld: false,
      identityBindingState: "bound",
      transportState: "ready",
      bootstrapState: "ready",
      runtimeReadiness: "blocked"
    });
  });

  it("accepts relocated manifest path when stable identity still matches", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-relocate-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const originalManifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const relocatedManifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_relocated_profile"
    });
    const service = createTestService();

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_relocated_profile",
        runId: "run-runtime-identity-relocate-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: originalManifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready"
    });

    await expect(
      service.stop({
        cwd: baseDir,
        profile: "identity_relocated_profile",
        runId: "run-runtime-identity-relocate-001",
        params: {}
      })
    ).resolves.toMatchObject({
      profileState: "stopped",
      lockHeld: false
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_relocated_profile",
        runId: "run-runtime-identity-relocate-002",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: relocatedManifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready"
    });

    const profileStore = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    const meta = await profileStore.readMeta("identity_relocated_profile");
    expect(meta).not.toHaveProperty("persistentExtensionBinding");
  });

  it("resolves win32 native host manifest path from registry before local app data fallback", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-win32-"));
    tempDirs.push(baseDir);
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const regBinDir = await createMockRegExecutable(manifestPath);
    delete process.env.WEBENVOY_BROWSER_PATH;
    process.env.PATH = `${regBinDir}:${originalPath ?? ""}`;
    process.env.LOCALAPPDATA = join(baseDir, "local-app-data");
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_win32_profile"
    });
    const service = createTestService();

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_win32_profile",
        runId: "run-runtime-identity-win32-001",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        }
      })
    ).resolves.toMatchObject({
      profileState: "ready"
    });

    const status = await service.status({
      cwd: baseDir,
      profile: "identity_win32_profile",
      runId: "run-runtime-identity-win32-002",
      params: {
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      }
    });
    expect(status).toMatchObject({
      identityBindingState: "bound",
      identityPreflight: {
        manifestPath,
        expectedOrigin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"
      }
    });
  });

  it("does not persist identity binding when later runtime.start gates reject the profile", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-gate-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Chromium 146.0.0.0");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const profileStore = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    const existingMeta = await profileStore.initializeMeta("identity_gate_profile", "2026-03-27T00:00:00.000Z");
    await profileStore.writeMeta("identity_gate_profile", {
      ...existingMeta,
      proxyBinding: {
        url: "http://127.0.0.1:8080/",
        boundAt: "2026-03-27T00:00:00.000Z",
        source: "runtime.start"
      },
      updatedAt: "2026-03-27T00:00:01.000Z"
    });
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const service = createTestService();
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "identity_gate_profile"
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "identity_gate_profile",
        runId: "run-runtime-identity-gate-001",
        params: {
          proxyUrl: "http://127.0.0.1:9090/",
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_PROXY_CONFLICT"
    });

    const meta = await profileStore.readMeta("identity_gate_profile");
    expect(meta).not.toHaveProperty("persistentExtensionBinding");
  });
});

describe("profile-runtime stop rollback", () => {
  it("restores lock when stop fails after meta write failure", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-"));
    tempDirs.push(baseDir);
    const profileRootDir = join(baseDir, ".webenvoy", "profiles");
    const service = createTestService({
      storeFactory: () => new StopMetaWriteFailProfileStore(profileRootDir)
    });

    const start = await service.start({
      cwd: baseDir,
      profile: "rollback_stop_profile",
      runId: "run-runtime-test-101",
      params: {}
    });
    expect(start).toMatchObject({
      profile: "rollback_stop_profile",
      profileState: "ready",
      lockHeld: true
    });

    await expect(
      service.stop({
        cwd: baseDir,
        profile: "rollback_stop_profile",
        runId: "run-runtime-test-101",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE"
    });

    const lockPath = join(profileRootDir, "rollback_stop_profile", "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    expect(lockRaw).toContain("\"ownerRunId\": \"run-runtime-test-101\"");

    const metaPath = join(profileRootDir, "rollback_stop_profile", "__webenvoy_meta.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.profileState).toBe("ready");
  });

  it("rolls back stopped meta when lock delete fails", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-delete-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      lockFileAdapter: failingDeleteLockAdapter
    });

    const start = await service.start({
      cwd: baseDir,
      profile: "rollback_delete_profile",
      runId: "run-runtime-test-111",
      params: {}
    });
    expect(start).toMatchObject({
      profile: "rollback_delete_profile",
      profileState: "ready",
      lockHeld: true
    });

    await expect(
      service.stop({
        cwd: baseDir,
        profile: "rollback_delete_profile",
        runId: "run-runtime-test-111",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE"
    });

    const profileDir = join(baseDir, ".webenvoy", "profiles", "rollback_delete_profile");
    const lockPath = join(profileDir, "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    expect(lockRaw).toContain("\"ownerRunId\": \"run-runtime-test-111\"");

    const metaPath = join(profileDir, "__webenvoy_meta.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.profileState).toBe("ready");
    expect(meta.lastStoppedAt).toBeNull();
  });

  it("retries lock delete and succeeds without rollback on transient failure", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-retry-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      lockFileAdapter: createFlakyDeleteLockAdapter(1)
    });

    await service.start({
      cwd: baseDir,
      profile: "retry_delete_profile",
      runId: "run-runtime-test-121",
      params: {}
    });

    const stopped = await service.stop({
      cwd: baseDir,
      profile: "retry_delete_profile",
      runId: "run-runtime-test-121",
      params: {}
    });
    expect(stopped).toMatchObject({
      profile: "retry_delete_profile",
      profileState: "stopped",
      lockHeld: false
    });

    const profileDir = join(baseDir, ".webenvoy", "profiles", "retry_delete_profile");
    const lockPath = join(profileDir, "__webenvoy_lock.json");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });

    const metaPath = join(profileDir, "__webenvoy_meta.json");
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.profileState).toBe("stopped");
    expect(meta.lastStoppedAt).toBeTruthy();
  });

  it("stops runtime through browser controller shutdown instead of direct process kill", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-no-kill-"));
    tempDirs.push(baseDir);
    const shutdownCalls: Array<{ profileDir: string; controllerPid: number; runId: string }> = [];
    const service = createTestService({
      isProcessAlive: (pid: number) => pid === 999998,
      browserLauncher: {
        launch: async () => ({
          browserPath: "/mock/chrome",
          browserPid: 999999,
          controllerPid: 999998,
          launchArgs: ["about:blank"],
          launchedAt: new Date().toISOString()
        }),
        shutdown: async (input) => {
          shutdownCalls.push(input);
        }
      }
    });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill
    );

    try {
      await service.start({
        cwd: baseDir,
        profile: "stop_no_kill_profile",
        runId: "run-runtime-test-131",
        params: {}
      });

      const stopped = await service.stop({
        cwd: baseDir,
        profile: "stop_no_kill_profile",
        runId: "run-runtime-test-131",
        params: {}
      });
      expect(stopped).toMatchObject({
        profile: "stop_no_kill_profile",
        profileState: "stopped",
        lockHeld: false
      });
      expect(shutdownCalls).toHaveLength(1);
      expect(shutdownCalls[0]).toMatchObject({
        controllerPid: 999998,
        runId: "run-runtime-test-131"
      });
      expect(killSpy).not.toHaveBeenCalledWith(999998, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(999998, "SIGKILL");
    } finally {
      killSpy.mockRestore();
    }
  });
});

describe("profile-runtime stale lock reclaim", () => {
  it("auto-recovers stale lock for runtime.start after crash residue", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-reclaim-start-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => false
    });

    await service.start({
      cwd: baseDir,
      profile: "reclaim_start_profile",
      runId: "run-runtime-test-301",
      params: {}
    });

    const lockPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_start_profile",
      "__webenvoy_lock.json"
    );
    const staleRaw = await readFile(lockPath, "utf8");
    const staleLock = JSON.parse(staleRaw) as ProfileLock;
    staleLock.ownerPid = 999999;
    staleLock.ownerRunId = "run-runtime-test-crashed";
    staleLock.lastHeartbeatAt = "1970-01-01T00:00:00.000Z";
    await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, "utf8");

    const recovered = await service.start({
      cwd: baseDir,
      profile: "reclaim_start_profile",
      runId: "run-runtime-test-302",
      params: {}
    });
    expect(recovered).toMatchObject({
      profile: "reclaim_start_profile",
      profileState: "ready",
      lockHeld: true
    });

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as ProfileLock;
    expect(lock.ownerRunId).toBe("run-runtime-test-302");

    const metaPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_start_profile",
      "__webenvoy_meta.json"
    );
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.lastDisconnectedAt).toBeTruthy();
  });

  it("auto-recovers stale lock for runtime.login after crash residue", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-reclaim-login-"));
    tempDirs.push(baseDir);
    let alive = false;
    const service = createTestService({
      isProcessAlive: () => alive
    });

    await service.start({
      cwd: baseDir,
      profile: "reclaim_login_profile",
      runId: "run-runtime-test-401",
      params: {}
    });

    const lockPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_login_profile",
      "__webenvoy_lock.json"
    );
    const staleRaw = await readFile(lockPath, "utf8");
    const staleLock = JSON.parse(staleRaw) as ProfileLock;
    staleLock.ownerPid = 999999;
    staleLock.ownerRunId = "run-runtime-test-crashed-login";
    staleLock.lastHeartbeatAt = "1970-01-01T00:00:00.000Z";
    await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, "utf8");

    const recovered = await service.login({
      cwd: baseDir,
      profile: "reclaim_login_profile",
      runId: "run-runtime-test-402",
      params: {}
    });
    expect(recovered).toMatchObject({
      profile: "reclaim_login_profile",
      profileState: "logging_in",
      lockHeld: true
    });

    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as ProfileLock;
    expect(lock.ownerRunId).toBe("run-runtime-test-402");
    expect(lock.ownerPid).toBe(999998);

    const metaPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_login_profile",
      "__webenvoy_meta.json"
    );
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.lastDisconnectedAt).toBeTruthy();
    expect(meta.profileState).toBe("logging_in");

    alive = true;
    const confirmed = await service.login({
      cwd: baseDir,
      profile: "reclaim_login_profile",
      runId: "run-runtime-test-402",
      params: { confirm: true }
    });
    expect(confirmed).toMatchObject({
      profile: "reclaim_login_profile",
      profileState: "ready",
      lockHeld: true
    });
  });

  it("does not reclaim stale-looking lock when owner process is still alive", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-reclaim-alive-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    await service.start({
      cwd: baseDir,
      profile: "reclaim_alive_profile",
      runId: "run-runtime-test-501",
      params: {}
    });

    const lockPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_alive_profile",
      "__webenvoy_lock.json"
    );
    const staleRaw = await readFile(lockPath, "utf8");
    const staleLock = JSON.parse(staleRaw) as ProfileLock;
    staleLock.ownerPid = 12345;
    staleLock.ownerRunId = "run-runtime-test-alive";
    staleLock.lastHeartbeatAt = "1970-01-01T00:00:00.000Z";
    await writeFile(lockPath, `${JSON.stringify(staleLock, null, 2)}\n`, "utf8");

    await expect(
      service.start({
        cwd: baseDir,
        profile: "reclaim_alive_profile",
        runId: "run-runtime-test-502",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });
  });

  it("marks disconnected while still blocking reuse when controller is dead but browser pid in state file is still alive", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-reclaim-controller-dead-"));
    tempDirs.push(baseDir);
    const alivePids = new Set<number>([999998, 999999]);
    const service = createTestService({
      isProcessAlive: (pid: number) => alivePids.has(pid)
    });

    await service.start({
      cwd: baseDir,
      profile: "reclaim_controller_dead_profile",
      runId: "run-runtime-test-601",
      params: {}
    });

    const profileDir = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "reclaim_controller_dead_profile"
    );
    const lockPath = join(profileDir, "__webenvoy_lock.json");
    const lockRaw = await readFile(lockPath, "utf8");
    const lock = JSON.parse(lockRaw) as ProfileLock;
    lock.ownerPid = 12345;
    lock.ownerRunId = "run-runtime-test-legacy-controller";
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

    const browserPid = 223344;
    const browserStatePath = join(profileDir, BROWSER_STATE_FILENAME);
    await writeFile(
      browserStatePath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          launchToken: "state-token-601",
          profileDir,
          runId: "run-runtime-test-legacy-controller",
          browserPath: "/mock/chrome",
          controllerPid: 12345,
          browserPid,
          launchedAt: new Date().toISOString()
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    alivePids.delete(999998);
    alivePids.delete(999999);
    alivePids.add(browserPid);

    const status = await service.status({
      cwd: baseDir,
      profile: "reclaim_controller_dead_profile",
      runId: "run-runtime-test-602",
      params: {}
    });
    expect(status).toMatchObject({
      profile: "reclaim_controller_dead_profile",
      profileState: "disconnected",
      browserState: "disconnected",
      lockHeld: false
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "reclaim_controller_dead_profile",
        runId: "run-runtime-test-603",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });

    await expect(
      service.login({
        cwd: baseDir,
        profile: "reclaim_controller_dead_profile",
        runId: "run-runtime-test-604",
        params: {}
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });
  });

  it("marks disconnected and allows stop recovery when controller is dead but browser pid is still alive", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-controller-dead-"));
    tempDirs.push(baseDir);
    const alivePids = new Set<number>([999998, 999999]);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        return alivePids.has(pid);
      }
      alivePids.delete(pid);
      return true;
    }) as typeof process.kill);
    const service = createTestService({
      isProcessAlive: (pid: number) => alivePids.has(pid)
    });

    try {
      await service.start({
        cwd: baseDir,
        profile: "stop_controller_dead_profile",
        runId: "run-runtime-test-701",
        params: {}
      });

      const profileDir = join(
        baseDir,
        ".webenvoy",
        "profiles",
        "stop_controller_dead_profile"
      );
      const lockPath = join(profileDir, "__webenvoy_lock.json");
      const lockRaw = await readFile(lockPath, "utf8");
      const lock = JSON.parse(lockRaw) as ProfileLock;
      lock.ownerPid = 12345;
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

      const browserPid = 223355;
      const browserStatePath = join(profileDir, BROWSER_STATE_FILENAME);
      await writeFile(
        browserStatePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            launchToken: "state-token-701",
            profileDir,
            runId: "run-runtime-test-701",
            browserPath: "/mock/chrome",
            controllerPid: 12345,
            browserPid,
            launchedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      alivePids.delete(999998);
      alivePids.delete(999999);
      alivePids.add(browserPid);

      const status = await service.status({
        cwd: baseDir,
        profile: "stop_controller_dead_profile",
        runId: "run-runtime-test-702",
        params: {}
      });
      expect(status).toMatchObject({
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      });

      const stopped = await service.stop({
        cwd: baseDir,
        profile: "stop_controller_dead_profile",
        runId: "run-runtime-test-701",
        params: {}
      });
      expect(stopped).toMatchObject({
        profileState: "stopped",
        lockHeld: false,
        orphanRecovered: false
      });
      expect(alivePids.has(browserPid)).toBe(false);
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      killSpy.mockRestore();
    }
  });

  it("allows runtime.stop to recover an orphaned runtime when owner run_id is no longer available", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-orphan-"));
    tempDirs.push(baseDir);
    const alivePids = new Set<number>([999998, 999999]);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        return alivePids.has(pid);
      }
      alivePids.delete(pid);
      return true;
    }) as typeof process.kill);
    const service = createTestService({
      isProcessAlive: (pid: number) => alivePids.has(pid)
    });

    try {
      await service.start({
        cwd: baseDir,
        profile: "orphan_stop_profile",
        runId: "run-runtime-test-711",
        params: {}
      });

      const profileDir = join(baseDir, ".webenvoy", "profiles", "orphan_stop_profile");
      const lockPath = join(profileDir, "__webenvoy_lock.json");
      const lockRaw = await readFile(lockPath, "utf8");
      const lock = JSON.parse(lockRaw) as ProfileLock;
      lock.ownerPid = 12345;
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

      const browserStatePath = join(profileDir, BROWSER_STATE_FILENAME);
      await writeFile(
        browserStatePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            launchToken: "state-token-711",
            profileDir,
            runId: "run-runtime-test-711",
            browserPath: "/mock/chrome",
            controllerPid: 12345,
            browserPid: 999999,
            launchedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      alivePids.delete(999998);

      const status = await service.status({
        cwd: baseDir,
        profile: "orphan_stop_profile",
        runId: "run-runtime-test-712",
        params: {}
      });
      expect(status).toMatchObject({
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      });

      const stopped = await service.stop({
        cwd: baseDir,
        profile: "orphan_stop_profile",
        runId: "run-runtime-test-713",
        params: {}
      });
      expect(stopped).toMatchObject({
        profile: "orphan_stop_profile",
        profileState: "stopped",
        lockHeld: false,
        orphanRecovered: true
      });
      expect(alivePids.has(999999)).toBe(false);
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      killSpy.mockRestore();
    }
  });

  it("rejects orphan recovery when browser state controller ownership no longer matches the lock", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-stop-orphan-mismatch-"));
    tempDirs.push(baseDir);
    const alivePids = new Set<number>([999998, 999999, 223355, 223356]);
    const killSpy = vi.spyOn(process, "kill").mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (signal === 0) {
        return alivePids.has(pid);
      }
      alivePids.delete(pid);
      return true;
    }) as typeof process.kill);
    const service = createTestService({
      isProcessAlive: (pid: number) => alivePids.has(pid)
    });

    try {
      await service.start({
        cwd: baseDir,
        profile: "orphan_stop_mismatch_profile",
        runId: "run-runtime-test-721",
        params: {}
      });

      const profileDir = join(baseDir, ".webenvoy", "profiles", "orphan_stop_mismatch_profile");
      const lockPath = join(profileDir, "__webenvoy_lock.json");
      const lockRaw = await readFile(lockPath, "utf8");
      const lock = JSON.parse(lockRaw) as ProfileLock;
      lock.ownerPid = 12345;
      await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");

      const browserStatePath = join(profileDir, BROWSER_STATE_FILENAME);
      await writeFile(
        browserStatePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            launchToken: "state-token-721",
            profileDir,
            runId: "run-runtime-test-721",
            browserPath: "/mock/chrome",
            controllerPid: 223355,
            browserPid: 223356,
            launchedAt: new Date().toISOString()
          },
          null,
          2
        )}\n`,
        "utf8"
      );
      alivePids.delete(999998);
      alivePids.delete(999999);

      const status = await service.status({
        cwd: baseDir,
        profile: "orphan_stop_mismatch_profile",
        runId: "run-runtime-test-722",
        params: {}
      });
      expect(status).toMatchObject({
        profileState: "disconnected",
        browserState: "disconnected",
        lockHeld: false
      });

      await expect(
        service.stop({
          cwd: baseDir,
          profile: "orphan_stop_mismatch_profile",
          runId: "run-runtime-test-723",
          params: {}
        })
      ).rejects.toMatchObject({
        code: "ERR_PROFILE_OWNER_CONFLICT"
      });
      expect(alivePids.has(223356)).toBe(true);
      const lockAfterReject = JSON.parse(await readFile(lockPath, "utf8")) as ProfileLock;
      expect(lockAfterReject.ownerRunId).toBe("run-runtime-test-721");
    } finally {
      killSpy.mockRestore();
    }
  });
});

describe("profile-runtime login", () => {
  it("keeps logging_in before confirmation and writes lastLoginAt after confirmation", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-login-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    const beforeConfirm = await service.login({
      cwd: baseDir,
      profile: "first_login_profile",
      runId: "run-runtime-test-201",
      params: {}
    });
    expect(beforeConfirm).toMatchObject({
      profile: "first_login_profile",
      profileState: "logging_in",
      browserState: "logging_in",
      lockHeld: true,
      confirmationRequired: true
    });

    const metaPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "first_login_profile",
      "__webenvoy_meta.json"
    );
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.profileState).toBe("logging_in");
    expect(meta.lastLoginAt).toBeNull();

    const result = await service.login({
      cwd: baseDir,
      profile: "first_login_profile",
      runId: "run-runtime-test-201",
      params: {
        confirm: true,
        localStorageSnapshot: {
          origin: "https://example.com",
          entries: [{ key: "session", value: "token-1" }]
        }
      }
    });

    expect(result).toMatchObject({
      profile: "first_login_profile",
      profileState: "ready",
      browserState: "ready",
      lockHeld: true,
      recoverableSession: {
        hasLocalStorageSnapshot: true,
        snapshotCount: 1,
        origins: ["https://example.com"]
      }
    });
    expect(typeof result.lastLoginAt).toBe("string");

    const confirmedMetaRaw = await readFile(metaPath, "utf8");
    const confirmedMeta = JSON.parse(confirmedMetaRaw) as ProfileMeta;
    expect(confirmedMeta.profileState).toBe("ready");
    expect(confirmedMeta.lastLoginAt).toBe(result.lastLoginAt);
    expect(confirmedMeta.localStorageSnapshots).toEqual([
      {
        origin: "https://example.com",
        entries: [{ key: "session", value: "token-1" }]
      }
    ]);
  });

  it("marks disconnected when confirm arrives after login browser already closed", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-login-disconnect-"));
    tempDirs.push(baseDir);
    let alive = true;
    const service = createTestService({
      isProcessAlive: () => alive
    });

    const beforeConfirm = await service.login({
      cwd: baseDir,
      profile: "disconnect_login_profile",
      runId: "run-runtime-test-301",
      params: {}
    });
    expect(beforeConfirm).toMatchObject({
      profileState: "logging_in",
      lockHeld: true
    });

    alive = false;

    await expect(
      service.login({
        cwd: baseDir,
        profile: "disconnect_login_profile",
        runId: "run-runtime-test-301",
        params: { confirm: true }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_STATE_CONFLICT"
    });

    const metaPath = join(baseDir, ".webenvoy", "profiles", "disconnect_login_profile", "__webenvoy_meta.json");
    const rawMeta = await readFile(metaPath, "utf8");
    const meta = JSON.parse(rawMeta) as ProfileMeta;
    expect(meta.profileState).toBe("disconnected");
    expect(typeof meta.lastDisconnectedAt).toBe("string");

    const lockPath = join(baseDir, ".webenvoy", "profiles", "disconnect_login_profile", "__webenvoy_lock.json");
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

describe("profile-runtime fingerprint runtime contract", () => {
  it("passes extensionBootstrap to launcher with the same fingerprint_runtime payload", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-fingerprint-bootstrap-"));
    tempDirs.push(baseDir);
    const launchInputs: BrowserLaunchInput[] = [];
    const service = createTestService({
      isProcessAlive: () => true,
      browserLauncher: {
        launch: async (input) => {
          launchInputs.push(input);
          return {
            browserPath: "/mock/chrome",
            browserPid: 999999,
            controllerPid: 999998,
            launchArgs: ["about:blank"],
            launchedAt: new Date().toISOString()
          };
        },
        shutdown: async () => undefined
      }
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "fingerprint_bootstrap_start_profile",
      runId: "run-runtime-test-fingerprint-bootstrap-001",
      params: {}
    });
    const startLaunch = launchInputs[0];
    expect(startLaunch.command).toBe("runtime.start");
    expect(startLaunch.launchMode).toBe("load_extension");
    expect(startLaunch.extensionBootstrap).toMatchObject({
      run_id: "run-runtime-test-fingerprint-bootstrap-001",
      session_id: "nm-session-001",
      fingerprint_runtime: started.fingerprint_runtime
    });
    expect(
      (startLaunch.extensionBootstrap as { fingerprint_runtime: unknown }).fingerprint_runtime
    ).toEqual(started.fingerprint_runtime);

    const loginStart = await service.login({
      cwd: baseDir,
      profile: "fingerprint_bootstrap_login_profile",
      runId: "run-runtime-test-fingerprint-bootstrap-002",
      params: {}
    });
    const loginLaunch = launchInputs[1];
    expect(loginLaunch.command).toBe("runtime.login");
    expect(loginLaunch.launchMode).toBe("load_extension");
    expect(loginLaunch.extensionBootstrap).toMatchObject({
      run_id: "run-runtime-test-fingerprint-bootstrap-002",
      session_id: "nm-session-001",
      fingerprint_runtime: loginStart.fingerprint_runtime
    });
    expect(
      (loginLaunch.extensionBootstrap as { fingerprint_runtime: unknown }).fingerprint_runtime
    ).toEqual(loginStart.fingerprint_runtime);
  });

  it("returns fingerprint_runtime on start/status/stop/login", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-fingerprint-runtime-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    const started = await service.start({
      cwd: baseDir,
      profile: "fingerprint_runtime_profile",
      runId: "run-runtime-test-fingerprint-001",
      params: {}
    });
    expect(started).toMatchObject({
      profile: "fingerprint_runtime_profile",
      fingerprint_runtime: {
        source: "profile_meta",
        execution: {
          live_decision: "allowed"
        }
      }
    });
    expect(typeof (started as { fingerprint_runtime?: { execution?: { live_allowed?: unknown } } }).fingerprint_runtime?.execution?.live_allowed).toBe("boolean");

    const status = await service.status({
      cwd: baseDir,
      profile: "fingerprint_runtime_profile",
      runId: "run-runtime-test-fingerprint-002",
      params: {}
    });
    expect(status).toMatchObject({
      profile: "fingerprint_runtime_profile",
      fingerprint_runtime: {
        source: "profile_meta"
      }
    });

    const stopped = await service.stop({
      cwd: baseDir,
      profile: "fingerprint_runtime_profile",
      runId: "run-runtime-test-fingerprint-001",
      params: {}
    });
    expect(stopped).toMatchObject({
      profile: "fingerprint_runtime_profile",
      fingerprint_runtime: {
        source: "profile_meta"
      }
    });

    const loginStart = await service.login({
      cwd: baseDir,
      profile: "fingerprint_runtime_profile",
      runId: "run-runtime-test-fingerprint-003",
      params: {}
    });
    expect(loginStart).toMatchObject({
      profile: "fingerprint_runtime_profile",
      fingerprint_runtime: {
        source: "profile_meta"
      }
    });
  });

  it("blocks live start when fingerprint environment mismatches and downgrades status", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-fingerprint-mismatch-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    await service.start({
      cwd: baseDir,
      profile: "fingerprint_mismatch_profile",
      runId: "run-runtime-test-fingerprint-101",
      params: {}
    });
    await service.stop({
      cwd: baseDir,
      profile: "fingerprint_mismatch_profile",
      runId: "run-runtime-test-fingerprint-101",
      params: {}
    });

    const metaPath = join(
      baseDir,
      ".webenvoy",
      "profiles",
      "fingerprint_mismatch_profile",
      "__webenvoy_meta.json"
    );
    const metaRaw = await readFile(metaPath, "utf8");
    const meta = JSON.parse(metaRaw) as ProfileMeta;
    expect(meta.fingerprintProfileBundle).toBeTruthy();
    if (!meta.fingerprintProfileBundle) {
      throw new Error("fingerprintProfileBundle is required for mismatch test");
    }
    meta.fingerprintProfileBundle.environment = {
      os_family: "linux",
      os_version: "99.99",
      arch: "x64"
    };
    await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

    await expect(
      service.start({
        cwd: baseDir,
        profile: "fingerprint_mismatch_profile",
        runId: "run-runtime-test-fingerprint-102",
        params: {
          requested_execution_mode: "live_read_high_risk"
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID"
    });

    const status = await service.status({
      cwd: baseDir,
      profile: "fingerprint_mismatch_profile",
      runId: "run-runtime-test-fingerprint-103",
      params: {
        requested_execution_mode: "live_read_high_risk"
      }
    });
    expect(status).toMatchObject({
      fingerprint_runtime: {
        fingerprint_profile_bundle: {
          environment: {
            os_family: "linux",
            os_version: "99.99",
            arch: "x64"
          }
        },
        fingerprint_consistency_check: {
          expected_environment: {
            os_family: "linux",
            os_version: "99.99",
            arch: "x64"
          },
          decision: "mismatch",
          reason_codes: expect.arrayContaining(["OS_VERSION_MISMATCH"])
        },
        execution: {
          live_allowed: false,
          live_decision: "dry_run_only",
          allowed_execution_modes: ["dry_run", "recon"],
          reason_codes: expect.arrayContaining(["OS_VERSION_MISMATCH"])
        }
      }
    });
  });

  it("keeps legacy profile degraded until explicit migrate and never persists transient backfill during runtime actions", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-fingerprint-legacy-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    const store = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    await store.ensureProfileDir("legacy_profile");
    await writeFile(
      store.getMetaPath("legacy_profile"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy_profile",
          profileDir: store.getProfileDir("legacy_profile"),
          profileState: "stopped",
          proxyBinding: null,
          fingerprintSeeds: {
            audioNoiseSeed: "legacy-audio-seed",
            canvasNoiseSeed: "legacy-canvas-seed"
          },
          localStorageSnapshots: [],
          createdAt: "2026-03-19T10:00:00.000Z",
          updatedAt: "2026-03-19T10:01:00.000Z",
          lastStartedAt: null,
          lastLoginAt: null,
          lastStoppedAt: "2026-03-19T10:01:00.000Z",
          lastDisconnectedAt: null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const status = await service.status({
      cwd: baseDir,
      profile: "legacy_profile",
      runId: "run-runtime-test-fingerprint-legacy-status",
      params: {
        requested_execution_mode: "live_read_limited"
      }
    });
    expect(status).toMatchObject({
      fingerprint_runtime: {
        source: "profile_meta",
        fingerprint_profile_bundle: {
          legacy_migration: {
            status: "backfilled_from_legacy",
            reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
          }
        },
        execution: {
          live_allowed: false,
          live_decision: "dry_run_only",
          allowed_execution_modes: ["dry_run", "recon"],
          reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
        }
      }
    });

    const storedAfterStatusRaw = await readFile(store.getMetaPath("legacy_profile"), "utf8");
    const storedAfterStatus = JSON.parse(storedAfterStatusRaw) as {
      fingerprintProfileBundle?: unknown;
    };
    expect(storedAfterStatus.fingerprintProfileBundle).toBeUndefined();

    const started = await service.start({
      cwd: baseDir,
      profile: "legacy_profile",
      runId: "run-runtime-test-fingerprint-legacy-start",
      params: {}
    });
    expect(started).toMatchObject({
      fingerprint_runtime: {
        fingerprint_profile_bundle: {
          legacy_migration: {
            status: "backfilled_from_legacy",
            reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
          }
        },
        execution: {
          live_decision: "allowed"
        }
      }
    });

    const storedMetaRaw = await readFile(store.getMetaPath("legacy_profile"), "utf8");
    const storedMeta = JSON.parse(storedMetaRaw) as ProfileMeta;
    expect(storedMeta.fingerprintProfileBundle).toBeUndefined();

    await service.stop({
      cwd: baseDir,
      profile: "legacy_profile",
      runId: "run-runtime-test-fingerprint-legacy-start",
      params: {}
    });

    await expect(
      service.start({
        cwd: baseDir,
        profile: "legacy_profile",
        runId: "run-runtime-test-fingerprint-legacy-live",
        params: {
          requested_execution_mode: "live_read_limited"
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID"
    });
  });

  it("persists legacy fingerprint bundle only when explicit migrate mode is requested", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-fingerprint-migrate-"));
    tempDirs.push(baseDir);
    const service = createTestService({
      isProcessAlive: () => true
    });

    const store = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    await store.ensureProfileDir("legacy_profile_migrate");
    await writeFile(
      store.getMetaPath("legacy_profile_migrate"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy_profile_migrate",
          profileDir: store.getProfileDir("legacy_profile_migrate"),
          profileState: "stopped",
          proxyBinding: null,
          fingerprintSeeds: {
            audioNoiseSeed: "legacy-audio-seed",
            canvasNoiseSeed: "legacy-canvas-seed"
          },
          localStorageSnapshots: [],
          createdAt: "2026-03-19T10:00:00.000Z",
          updatedAt: "2026-03-19T10:01:00.000Z",
          lastStartedAt: null,
          lastLoginAt: null,
          lastStoppedAt: "2026-03-19T10:01:00.000Z",
          lastDisconnectedAt: null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    const status = await service.status({
      cwd: baseDir,
      profile: "legacy_profile_migrate",
      runId: "run-runtime-test-fingerprint-legacy-migrate-status",
      params: {
        migrate_fingerprint_profile_bundle: true
      }
    });
    expect(status).toMatchObject({
      fingerprint_runtime: {
        fingerprint_profile_bundle: {
          timezone: expect.any(String),
          ua: expect.stringContaining("Chrome/"),
          legacy_migration: {
            status: "backfilled_from_legacy",
            reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
          }
        },
        execution: {
          live_allowed: false,
          live_decision: "allowed",
          reason_codes: expect.arrayContaining(["LEGACY_PROFILE_BUNDLE_MIGRATED"])
        }
      }
    });

    const storedMetaRaw = await readFile(store.getMetaPath("legacy_profile_migrate"), "utf8");
    const storedMeta = JSON.parse(storedMetaRaw) as ProfileMeta;
    expect(storedMeta.fingerprintProfileBundle?.legacy_migration).toMatchObject({
      status: "backfilled_from_legacy",
      reason_codes: ["LEGACY_PROFILE_BUNDLE_MIGRATED"]
    });
    expect(storedMeta.fingerprintProfileBundle?.timezone).toBeTruthy();

    await expect(
      service.start({
        cwd: baseDir,
        profile: "legacy_profile_migrate",
        runId: "run-runtime-test-fingerprint-legacy-migrate-live",
        params: {
          requested_execution_mode: "live_read_limited"
        }
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_INVALID",
      details: {
        stage: "input_validation",
        reason: "LEGACY_PROFILE_BUNDLE_MIGRATED"
      }
    });
  });

  it("does not persist transient legacy backfill bundle during official Chrome identity bootstrap", async () => {
    const baseDir = await mkdtemp(join(tmpdir(), "webenvoy-profile-runtime-identity-legacy-"));
    tempDirs.push(baseDir);
    process.env.WEBENVOY_BROWSER_PATH = await createMockBrowserExecutable("Google Chrome 146.0.7680.154");
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    await seedInstalledPersistentExtension({
      baseDir,
      profile: "legacy_identity_profile"
    });
    const service = createTestService();

    const store = new ProfileStore(join(baseDir, ".webenvoy", "profiles"));
    await store.ensureProfileDir("legacy_identity_profile");
    await writeFile(
      store.getMetaPath("legacy_identity_profile"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          profileName: "legacy_identity_profile",
          profileDir: store.getProfileDir("legacy_identity_profile"),
          profileState: "stopped",
          proxyBinding: null,
          fingerprintSeeds: {
            audioNoiseSeed: "legacy-audio-seed",
            canvasNoiseSeed: "legacy-canvas-seed"
          },
          localStorageSnapshots: [],
          createdAt: "2026-03-19T10:00:00.000Z",
          updatedAt: "2026-03-19T10:01:00.000Z",
          lastStartedAt: null,
          lastLoginAt: null,
          lastStoppedAt: "2026-03-19T10:01:00.000Z",
          lastDisconnectedAt: null
        },
        null,
        2
      )}\n`,
      "utf8"
    );

    await expect(
      service.start({
        cwd: baseDir,
        profile: "legacy_identity_profile",
        runId: "run-runtime-test-fingerprint-legacy-identity",
        params: {
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        }
      })
    ).resolves.toMatchObject({
      profile: "legacy_identity_profile",
      profileState: "ready",
      browserState: "ready",
      lockHeld: true
    });

    const storedMetaRaw = await readFile(store.getMetaPath("legacy_identity_profile"), "utf8");
    const storedMeta = JSON.parse(storedMetaRaw) as ProfileMeta;
    expect(storedMeta).not.toHaveProperty("persistentExtensionBinding");
    expect(storedMeta.fingerprintProfileBundle).toBeUndefined();
  });
});
