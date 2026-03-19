import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { JsonObject } from "../core/types.js";
import {
  BrowserLaunchError,
  launchBrowser,
  type BrowserLaunchResult
} from "./browser-launcher.js";
import {
  createProfileLock,
  type ProfileLock
} from "./profile-lock.js";
import {
  ProfileStore,
  type LocalStorageSnapshot,
  type ProfileMeta
} from "./profile-store.js";
import type { ProfileState } from "./profile-state.js";
import {
  applyProfileProxyBinding,
  beginLoginSession,
  beginStartSession,
  beginStopSession,
  buildRuntimeSession,
  markSessionReady,
  markSessionStopped
} from "./runtime-session.js";

const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];
const PROFILE_LOCK_FILENAME = "__webenvoy_lock.json";
const LOCK_ACQUIRE_MAX_RETRIES = 6;
const STOP_LOCK_DELETE_MAX_RETRIES = 3;

type BrowserState = "absent" | "starting" | "ready" | "logging_in" | "stopping" | "disconnected";

interface RuntimeActionInput {
  cwd: string;
  profile: string;
  runId: string;
  params: JsonObject;
}

interface ProfileStoreLike {
  ensureProfileDir(profileName: string): Promise<string>;
  getProfileDir(profileName: string): string;
  readMeta(profileName: string): Promise<ProfileMeta | null>;
  initializeMeta(profileName: string, nowIso: string): Promise<ProfileMeta>;
  writeMeta(profileName: string, meta: ProfileMeta): Promise<void>;
}

interface LockFileAdapter {
  readFile(path: string, encoding: "utf8"): Promise<string>;
  writeFile(
    path: string,
    data: string,
    options?: { encoding?: "utf8"; flag?: string } | "utf8"
  ): Promise<void>;
  unlink(path: string): Promise<void>;
}

interface BrowserLauncherLike {
  launch(input: {
    command: "runtime.start" | "runtime.login";
    profileDir: string;
    proxyUrl: string | null;
    params: JsonObject;
  }): Promise<BrowserLaunchResult>;
}

const isoNow = (): string => new Date().toISOString();
type LockAcquisition = "new" | "same-owner" | "same-owner-dead" | "reclaimed";
const DEFAULT_LOCK_FILE_ADAPTER: LockFileAdapter = {
  readFile: async (path, encoding) => readFile(path, encoding),
  writeFile: async (path, data, options) => {
    if (typeof options === "string") {
      await writeFile(path, data, options);
      return;
    }
    await writeFile(path, data, options);
  },
  unlink: async (path) => unlink(path)
};

const browserStateFromProfileState = (profileState: ProfileState, lockHeld: boolean): BrowserState => {
  if (!lockHeld) {
    if (profileState === "disconnected") {
      return "disconnected";
    }
    return "absent";
  }

  if (profileState === "starting") {
    return "starting";
  }
  if (profileState === "logging_in") {
    return "logging_in";
  }
  if (profileState === "stopping") {
    return "stopping";
  }
  if (profileState === "disconnected") {
    return "disconnected";
  }
  return "ready";
};

const parseProxyUrl = (params: JsonObject): string | null | undefined => {
  const value = params.proxyUrl;
  if (value === undefined || value === null) {
    return value as null | undefined;
  }
  if (typeof value !== "string") {
    throw new CliError("ERR_PROFILE_INVALID", "params.proxyUrl 必须是字符串或 null");
  }
  if (value.trim().length === 0) {
    throw new CliError("ERR_PROFILE_INVALID", "params.proxyUrl 不能为空字符串");
  }
  return value;
};

const asObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseLocalStorageSnapshot = (params: JsonObject): LocalStorageSnapshot | null => {
  const rawSnapshot = params.localStorageSnapshot;
  if (rawSnapshot === undefined || rawSnapshot === null) {
    return null;
  }
  if (!asObjectRecord(rawSnapshot)) {
    throw new CliError("ERR_PROFILE_INVALID", "params.localStorageSnapshot 必须是对象");
  }
  if (typeof rawSnapshot.origin !== "string" || rawSnapshot.origin.trim().length === 0) {
    throw new CliError("ERR_PROFILE_INVALID", "params.localStorageSnapshot.origin 必须是非空字符串");
  }
  const origin = rawSnapshot.origin;
  if (!Array.isArray(rawSnapshot.entries)) {
    throw new CliError("ERR_PROFILE_INVALID", "params.localStorageSnapshot.entries 必须是数组");
  }
  const entries = rawSnapshot.entries.map((entry, index) => {
    if (!asObjectRecord(entry)) {
      throw new CliError(
        "ERR_PROFILE_INVALID",
        `params.localStorageSnapshot.entries[${index}] 必须是对象`
      );
    }
    if (typeof entry.key !== "string" || typeof entry.value !== "string") {
      throw new CliError(
        "ERR_PROFILE_INVALID",
        `params.localStorageSnapshot.entries[${index}] 的 key/value 必须是字符串`
      );
    }
    return {
      key: entry.key,
      value: entry.value
    };
  });
  return {
    origin,
    entries
  };
};

const upsertLocalStorageSnapshot = (
  snapshots: LocalStorageSnapshot[],
  nextSnapshot: LocalStorageSnapshot | null
): LocalStorageSnapshot[] => {
  if (!nextSnapshot) {
    return snapshots;
  }
  const preserved = snapshots.filter((snapshot) => snapshot.origin !== nextSnapshot.origin);
  return [...preserved, nextSnapshot];
};

const buildRecoverableSessionSummary = (
  meta: Pick<ProfileMeta, "localStorageSnapshots" | "lastLoginAt"> | null
): JsonObject => {
  const snapshots = meta?.localStorageSnapshots ?? [];
  return {
    hasLocalStorageSnapshot: snapshots.length > 0,
    snapshotCount: snapshots.length,
    origins: snapshots.map((snapshot) => snapshot.origin),
    lastLoginAt: meta?.lastLoginAt ?? null
  };
};

const isStartableProfileState = (state: ProfileState): boolean =>
  state === "uninitialized" || state === "stopped" || state === "disconnected";
const isLoginableProfileState = (state: ProfileState): boolean =>
  state === "uninitialized" ||
  state === "stopped" ||
  state === "disconnected" ||
  state === "ready" ||
  state === "logging_in";
const isRuntimeActiveProfileState = (state: ProfileState): boolean =>
  state === "starting" || state === "ready" || state === "logging_in" || state === "stopping";

const shouldRecoverAsDisconnected = (acquisition: LockAcquisition, state: ProfileState): boolean =>
  acquisition !== "same-owner" && isRuntimeActiveProfileState(state);
const shouldConfirmLogin = (params: JsonObject): boolean => params.confirm === true;

const mapRuntimeError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
  }
  if (error instanceof BrowserLaunchError) {
    if (error.code === "BROWSER_INVALID_ARGUMENT") {
      return new CliError("ERR_PROFILE_INVALID", error.message);
    }
    return new CliError("ERR_BROWSER_LAUNCH_FAILED", error.message, {
      retryable: error.code !== "BROWSER_NOT_FOUND",
      cause: error
    });
  }
  if (error instanceof Error) {
    if (/Invalid profile name/i.test(error.message)) {
      return new CliError("ERR_PROFILE_INVALID", "profile 名称非法");
    }
    if (/Profile lock conflict/i.test(error.message)) {
      return new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
        retryable: true
      });
    }
    if (/Proxy binding conflict/i.test(error.message)) {
      return new CliError("ERR_PROFILE_PROXY_CONFLICT", "profile 代理绑定冲突");
    }
    if (/Invalid proxy URL|Unsupported proxy protocol/i.test(error.message)) {
      return new CliError("ERR_PROFILE_INVALID", error.message);
    }
  }
  return new CliError("ERR_RUNTIME_UNAVAILABLE", "最小会话运行时不可用", { retryable: true });
};

export class ProfileRuntimeService {
  readonly #storeFactory: (cwd: string) => ProfileStoreLike;
  readonly #lockFileAdapter: LockFileAdapter;
  readonly #isProcessAlive: (pid: number) => boolean;
  readonly #browserLauncher: BrowserLauncherLike;

  constructor(options?: {
    storeFactory?: (cwd: string) => ProfileStoreLike;
    lockFileAdapter?: LockFileAdapter;
    isProcessAlive?: (pid: number) => boolean;
    browserLauncher?: BrowserLauncherLike;
  }) {
    this.#storeFactory =
      options?.storeFactory ??
      ((cwd: string) => {
        return new ProfileStore(join(cwd, ...PROFILE_ROOT_SEGMENTS));
      });
    this.#lockFileAdapter = options?.lockFileAdapter ?? DEFAULT_LOCK_FILE_ADAPTER;
    this.#isProcessAlive =
      options?.isProcessAlive ??
      ((pid: number) => {
        if (!Number.isInteger(pid) || pid <= 0) {
          return false;
        }
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      });
    this.#browserLauncher = options?.browserLauncher ?? {
      launch: launchBrowser
    };
  }

  async start(input: RuntimeActionInput): Promise<JsonObject> {
    const nowIso = isoNow();
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    await store.ensureProfileDir(input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const lockAcquireResult = await this.#acquireProfileLockAtomically({
      profileName: input.profile,
      lockPath,
      runId: input.runId,
      nowIso
    });
    const keepExistingLockOnFailure =
      lockAcquireResult.acquisition === "same-owner" &&
      lockAcquireResult.lock.ownerPid !== process.pid;
    let startSucceeded = false;
    let launchedBrowserPid: number | null = null;

    try {
      let existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso);
      const recoveredMeta =
        shouldRecoverAsDisconnected(lockAcquireResult.acquisition, existingMeta.profileState)
          ? this.#patchMeta(existingMeta, {
              profileName: input.profile,
              profileDir,
              profileState: "disconnected",
              proxyBinding: existingMeta.proxyBinding,
              updatedAt: nowIso,
              lastDisconnectedAt: nowIso
            })
          : existingMeta;
      const profileState = recoveredMeta.profileState;
      if (!isStartableProfileState(profileState)) {
        throw new CliError(
          "ERR_PROFILE_STATE_CONFLICT",
          `profile 当前状态 ${profileState} 不能直接 start`
        );
      }

      let session = buildRuntimeSession(input.profile, recoveredMeta);
      session = applyProfileProxyBinding(session, {
        requested: parseProxyUrl(input.params),
        nowIso,
        source: "runtime.start"
      });
      session = beginStartSession(session, {
        runId: input.runId,
        nowIso
      });
      const browserLaunch = await this.#browserLauncher.launch({
        command: "runtime.start",
        profileDir,
        proxyUrl: session.proxyBinding?.url ?? null,
        params: input.params
      });
      launchedBrowserPid = browserLaunch.browserPid;
      await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.browserPid, nowIso);
      session = markSessionReady(session);

      const nextMeta = this.#patchMeta(recoveredMeta, {
        profileName: input.profile,
        profileDir,
        profileState: session.profileState,
        proxyBinding: session.proxyBinding,
        updatedAt: nowIso,
        lastStartedAt: nowIso
      });
      await store.writeMeta(
        input.profile,
        nextMeta
      );

      startSucceeded = true;
      return {
        profile: input.profile,
        profileState: session.profileState,
        browserState: browserStateFromProfileState(session.profileState, true),
        profileDir,
        proxyUrl: session.proxyBinding?.url ?? null,
        lockHeld: true,
        browserPath: browserLaunch.browserPath,
        browserPid: browserLaunch.browserPid,
        recoverableSession: buildRecoverableSessionSummary(nextMeta),
        startedAt: nowIso
      };
    } catch (error) {
      throw mapRuntimeError(error);
    } finally {
      if (!startSucceeded) {
        await this.#terminateProcess(launchedBrowserPid);
        if (!keepExistingLockOnFailure) {
          await this.#rollbackLockOnStartFailure(lockPath, input.runId);
        }
      }
    }
  }

  async login(input: RuntimeActionInput): Promise<JsonObject> {
    const nowIso = isoNow();
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    await store.ensureProfileDir(input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const confirmLogin = shouldConfirmLogin(input.params);
    const lockAcquireResult = await this.#acquireProfileLockAtomically({
      profileName: input.profile,
      lockPath,
      runId: input.runId,
      nowIso,
      allowDeadOwnerRecoveryForSameRun: !confirmLogin
    });
    let loginSucceeded = false;
    let keepLockOnFailure = false;
    let launchedBrowserPid: number | null = null;

    try {
      let existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso);
      const recoveredMeta = shouldRecoverAsDisconnected(
        lockAcquireResult.acquisition,
        existingMeta.profileState
      )
        ? this.#patchMeta(existingMeta, {
            profileName: input.profile,
            profileDir,
            profileState: "disconnected",
            proxyBinding: existingMeta.proxyBinding,
            updatedAt: nowIso,
            lastDisconnectedAt: nowIso
          })
        : existingMeta;

      const profileState = recoveredMeta.profileState;
      if (!isLoginableProfileState(profileState)) {
        throw new CliError(
          "ERR_PROFILE_STATE_CONFLICT",
          `profile 当前状态 ${profileState} 不能直接 login`
        );
      }

      if (
        confirmLogin &&
        (lockAcquireResult.acquisition !== "same-owner" ||
          lockAcquireResult.lock.ownerRunId !== input.runId ||
          lockAcquireResult.lock.ownerPid === process.pid ||
          !this.#isProcessAlive(lockAcquireResult.lock.ownerPid))
      ) {
        if (
          isRuntimeActiveProfileState(recoveredMeta.profileState) ||
          recoveredMeta.profileState === "disconnected"
        ) {
          await store.writeMeta(
            input.profile,
            this.#patchMeta(recoveredMeta, {
              profileName: input.profile,
              profileDir,
              profileState: "disconnected",
              proxyBinding: recoveredMeta.proxyBinding,
              updatedAt: nowIso,
              lastDisconnectedAt: nowIso
            })
          );
        }

        throw new CliError(
          "ERR_PROFILE_STATE_CONFLICT",
          "runtime.login --confirm 前检测到登录浏览器已断开，请重新执行 runtime.login",
          { retryable: true }
        );
      }

      let session = buildRuntimeSession(input.profile, recoveredMeta);
      session = applyProfileProxyBinding(session, {
        requested: parseProxyUrl(input.params),
        nowIso,
        source: "runtime.login"
      });
      session = beginLoginSession(session, {
        runId: input.runId,
        nowIso
      });

      if (!confirmLogin) {
        const browserLaunch = await this.#browserLauncher.launch({
          command: "runtime.login",
          profileDir,
          proxyUrl: session.proxyBinding?.url ?? null,
          params: input.params
        });
        launchedBrowserPid = browserLaunch.browserPid;
        await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.browserPid, nowIso);
      }

      await store.writeMeta(
        input.profile,
        this.#patchMeta(recoveredMeta, {
          profileName: input.profile,
          profileDir,
          profileState: session.profileState,
          proxyBinding: session.proxyBinding,
          updatedAt: nowIso
        })
      );

      if (!confirmLogin) {
        loginSucceeded = true;
        keepLockOnFailure = true;
        return {
          profile: input.profile,
          profileState: session.profileState,
          browserState: browserStateFromProfileState(session.profileState, true),
          profileDir,
          proxyUrl: session.proxyBinding?.url ?? null,
          lockHeld: true,
          recoverableSession: buildRecoverableSessionSummary(recoveredMeta),
          confirmationRequired: true,
          confirmPath: "runtime.login --params '{\"confirm\":true}'"
        };
      }

      const localStorageSnapshot = parseLocalStorageSnapshot(input.params);
      session = markSessionReady(session);
      const nextMeta = this.#patchMeta(recoveredMeta, {
        profileName: input.profile,
        profileDir,
        profileState: session.profileState,
        proxyBinding: session.proxyBinding,
        updatedAt: nowIso,
        lastLoginAt: nowIso,
        localStorageSnapshots: upsertLocalStorageSnapshot(
          recoveredMeta.localStorageSnapshots,
          localStorageSnapshot
        )
      });
      await store.writeMeta(
        input.profile,
        nextMeta
      );

      loginSucceeded = true;
      return {
        profile: input.profile,
        profileState: session.profileState,
        browserState: browserStateFromProfileState(session.profileState, true),
        profileDir,
        proxyUrl: session.proxyBinding?.url ?? null,
        lockHeld: true,
        recoverableSession: buildRecoverableSessionSummary(nextMeta),
        lastLoginAt: nowIso
      };
    } catch (error) {
      throw mapRuntimeError(error);
    } finally {
      if (!loginSucceeded && !keepLockOnFailure) {
        await this.#terminateProcess(launchedBrowserPid);
        await this.#rollbackLockOnStartFailure(lockPath, input.runId);
      }
    }
  }

  async status(input: RuntimeActionInput): Promise<JsonObject> {
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const meta = await this.#readMeta(store, input.profile);
    const lock = await this.#readLock(lockPath);

    const storedProfileState: ProfileState = meta?.profileState ?? "uninitialized";
    const activeState = isRuntimeActiveProfileState(storedProfileState);
    const healthyLock = lock !== null && this.#isProcessAlive(lock.ownerPid);
    const profileState: ProfileState =
      activeState && !healthyLock ? "disconnected" : storedProfileState;
    const lockHeld = activeState && healthyLock;

    return {
      profile: input.profile,
      profileState,
      browserState: browserStateFromProfileState(profileState, lockHeld),
      profileDir,
      proxyUrl: meta?.proxyBinding?.url ?? null,
      lockHeld,
      lockOwnerPid: lock?.ownerPid ?? null,
      recoverableSession: buildRecoverableSessionSummary(meta),
      updatedAt: meta?.updatedAt ?? null
    };
  }

  async stop(input: RuntimeActionInput): Promise<JsonObject> {
    const nowIso = isoNow();
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const existingMeta = await this.#readMeta(store, input.profile);
    const lock = await this.#readLock(lockPath);

    if (!existingMeta || !lock) {
      throw new CliError("ERR_PROFILE_STATE_CONFLICT", "profile 当前未持锁或未启动");
    }

    if (lock.ownerRunId !== input.runId) {
      throw new CliError(
        "ERR_PROFILE_OWNER_CONFLICT",
        "runtime.stop run_id 与 profile 锁所有者不一致",
        { retryable: false }
      );
    }

    let session = buildRuntimeSession(input.profile, existingMeta);
    session = {
      ...session,
      ownerRunId: lock.ownerRunId
    };

    try {
      const stopping = beginStopSession(session, {
        runId: input.runId,
        nowIso
      });
      session = markSessionStopped(stopping);
    } catch (error) {
      throw mapRuntimeError(error);
    }

    const previousMeta = existingMeta;
    try {
      await store.writeMeta(
        input.profile,
        this.#patchMeta(existingMeta, {
          profileName: input.profile,
          profileDir,
          profileState: session.profileState,
          proxyBinding: session.proxyBinding,
          updatedAt: nowIso,
          lastStoppedAt: nowIso
        })
      );
      await this.#deleteLockWithRetry(lockPath);
    } catch (error) {
      try {
        await store.writeMeta(input.profile, previousMeta);
      } catch (rollbackError) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "runtime.stop 回滚失败，profile 状态可能不一致", {
          retryable: true,
          cause: rollbackError
        });
      }
      throw mapRuntimeError(error);
    }

    return {
      profile: input.profile,
      profileState: session.profileState,
      browserState: "absent",
      profileDir,
      proxyUrl: session.proxyBinding?.url ?? null,
      lockHeld: false,
      recoverableSession: buildRecoverableSessionSummary(existingMeta),
      stoppedAt: nowIso
    };
  }

  #createStore(cwd: string): ProfileStoreLike {
    return this.#storeFactory(cwd);
  }

  #resolveProfileDir(store: ProfileStoreLike, profile: string): string {
    try {
      return store.getProfileDir(profile);
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }

  #getLockPath(profileDir: string): string {
    return join(profileDir, PROFILE_LOCK_FILENAME);
  }

  async #readMeta(store: ProfileStoreLike, profile: string): Promise<ProfileMeta | null> {
    try {
      return await store.readMeta(profile);
    } catch {
      throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 元数据损坏");
    }
  }

  async #readOrInitializeMeta(
    store: ProfileStoreLike,
    profile: string,
    nowIso: string
  ): Promise<ProfileMeta> {
    const meta = await this.#readMeta(store, profile);
    if (meta) {
      return meta;
    }
    return store.initializeMeta(profile, nowIso);
  }

  async #readLock(lockPath: string): Promise<ProfileLock | null> {
    try {
      const raw = await this.#lockFileAdapter.readFile(lockPath, "utf8");
      return JSON.parse(raw) as ProfileLock;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") {
        return null;
      }
      throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 锁文件损坏");
    }
  }

  async #writeLock(lockPath: string, lock: ProfileLock): Promise<void> {
    await this.#lockFileAdapter.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  }

  async #updateLockOwnerPid(
    lockPath: string,
    runId: string,
    ownerPid: number,
    nowIso: string
  ): Promise<void> {
    const existing = await this.#readLock(lockPath);
    if (!existing) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", "profile 锁丢失，浏览器启动状态不可恢复", {
        retryable: true
      });
    }
    if (existing.ownerRunId !== runId) {
      throw new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
        retryable: true
      });
    }
    const updated: ProfileLock = {
      ...existing,
      ownerPid,
      lastHeartbeatAt: nowIso
    };
    await this.#writeLock(lockPath, updated);
  }

  async #rollbackLockOnStartFailure(lockPath: string, runId: string): Promise<void> {
    const lock = await this.#readLock(lockPath);
    if (!lock) {
      return;
    }
    if (lock.ownerRunId !== runId) {
      return;
    }
    await this.#deleteLock(lockPath);
  }

  async #terminateProcess(pid: number | null): Promise<void> {
    if (!Number.isInteger(pid) || pid === null || pid <= 0) {
      return;
    }
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ESRCH") {
        return;
      }
      throw error;
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!this.#isProcessAlive(pid)) {
        return;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80);
      });
    }

    if (!this.#isProcessAlive(pid)) {
      return;
    }

    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ESRCH") {
        throw error;
      }
    }
  }

  async #acquireProfileLockAtomically(input: {
    profileName: string;
    lockPath: string;
    runId: string;
    nowIso: string;
    allowDeadOwnerRecoveryForSameRun?: boolean;
  }): Promise<{ lock: ProfileLock; acquisition: LockAcquisition }> {

    for (let attempt = 0; attempt < LOCK_ACQUIRE_MAX_RETRIES; attempt += 1) {
      const nextRequest = {
        profileName: input.profileName,
        lockPath: input.lockPath,
        ownerPid: process.pid,
        ownerRunId: input.runId,
        nowIso: input.nowIso
      };
      const nextLock = createProfileLock(nextRequest);

      try {
        await this.#lockFileAdapter.writeFile(input.lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, {
          encoding: "utf8",
          flag: "wx"
        });
        return { lock: nextLock, acquisition: "new" };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "EEXIST") {
          throw error;
        }
      }

      const existingLock = await this.#readLock(input.lockPath);
      if (!existingLock) {
        continue;
      }

      if (existingLock.ownerRunId === input.runId) {
        const ownerAlive = this.#isProcessAlive(existingLock.ownerPid);
        if (!ownerAlive && input.allowDeadOwnerRecoveryForSameRun === false) {
          return { lock: existingLock, acquisition: "same-owner-dead" };
        }
        const ownerPid = ownerAlive ? existingLock.ownerPid : process.pid;
        const updatedLock: ProfileLock = {
          ...existingLock,
          ownerPid,
          lastHeartbeatAt: input.nowIso
        };
        await this.#writeLock(input.lockPath, updatedLock);
        return { lock: updatedLock, acquisition: "same-owner" };
      }

      if (this.#isProcessAlive(existingLock.ownerPid)) {
        throw new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
          retryable: true
        });
      }

      await this.#deleteLock(input.lockPath);
      try {
        await this.#lockFileAdapter.writeFile(
          input.lockPath,
          `${JSON.stringify(nextLock, null, 2)}\n`,
          {
            encoding: "utf8",
            flag: "wx"
          }
        );
        return { lock: nextLock, acquisition: "reclaimed" };
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "EEXIST") {
          throw error;
        }
      }
    }

    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "profile 锁获取失败，请重试", {
      retryable: true
    });
  }

  async #deleteLock(lockPath: string): Promise<void> {
    try {
      await this.#lockFileAdapter.unlink(lockPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async #deleteLockWithRetry(lockPath: string): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < STOP_LOCK_DELETE_MAX_RETRIES; attempt += 1) {
      try {
        await this.#deleteLock(lockPath);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  #patchMeta(
    current: ProfileMeta,
    patch: {
      profileName: string;
      profileDir: string;
      profileState: ProfileState;
      proxyBinding: ProfileMeta["proxyBinding"];
      updatedAt: string;
      localStorageSnapshots?: ProfileMeta["localStorageSnapshots"];
      lastStartedAt?: string;
      lastLoginAt?: string;
      lastStoppedAt?: string;
      lastDisconnectedAt?: string;
    }
  ): ProfileMeta {
    return {
      ...current,
      profileName: patch.profileName,
      profileDir: patch.profileDir,
      profileState: patch.profileState,
      proxyBinding: patch.proxyBinding,
      localStorageSnapshots: patch.localStorageSnapshots ?? current.localStorageSnapshots,
      updatedAt: patch.updatedAt,
      lastStartedAt: patch.lastStartedAt ?? current.lastStartedAt,
      lastLoginAt: patch.lastLoginAt ?? current.lastLoginAt,
      lastStoppedAt: patch.lastStoppedAt ?? current.lastStoppedAt,
      lastDisconnectedAt: patch.lastDisconnectedAt ?? current.lastDisconnectedAt
    };
  }
}
