import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProfileRuntimeService } from "../profile-runtime.js";
import { BROWSER_STATE_FILENAME } from "../browser-launcher.js";
import type { BrowserLaunchInput } from "../browser-launcher.js";
import type { ProfileLock } from "../profile-lock.js";
import { ProfileStore, type ProfileMeta } from "../profile-store.js";

const tempDirs: string[] = [];
const originalBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
const originalBrowserVersion = process.env.WEBENVOY_BROWSER_VERSION;

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

const createTestService = (
  options?: ConstructorParameters<typeof ProfileRuntimeService>[0]
): ProfileRuntimeService =>
  new ProfileRuntimeService({
    ...options,
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
      lockHeld: true
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
        lockHeld: true
      });

      const stopped = await service.stop({
        cwd: baseDir,
        profile: "stop_controller_dead_profile",
        runId: "run-runtime-test-701",
        params: {}
      });
      expect(stopped).toMatchObject({
        profileState: "stopped",
        lockHeld: false
      });
      expect(alivePids.has(browserPid)).toBe(false);
      await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
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
});
