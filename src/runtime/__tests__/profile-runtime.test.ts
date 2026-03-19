import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileRuntimeService } from "../profile-runtime.js";
import { BROWSER_STATE_FILENAME } from "../browser-launcher.js";
import type { ProfileLock } from "../profile-lock.js";
import { ProfileStore, type ProfileMeta } from "../profile-store.js";

const tempDirs: string[] = [];

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

afterEach(async () => {
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
