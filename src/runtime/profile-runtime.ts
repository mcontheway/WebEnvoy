import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { JsonObject } from "../core/types.js";
import { acquireProfileLock, type ProfileLock } from "./profile-lock.js";
import { ProfileStore, type ProfileMeta } from "./profile-store.js";
import type { ProfileState } from "./profile-state.js";
import {
  applyProfileProxyBinding,
  beginStartSession,
  beginStopSession,
  buildRuntimeSession,
  markSessionReady,
  markSessionStopped
} from "./runtime-session.js";

const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];
const PROFILE_LOCK_FILENAME = "__webenvoy_lock.json";

type BrowserState = "absent" | "starting" | "ready" | "logging_in" | "stopping" | "disconnected";

interface RuntimeActionInput {
  cwd: string;
  profile: string;
  runId: string;
  params: JsonObject;
}

const isoNow = (): string => new Date().toISOString();

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
  return value;
};

const mapRuntimeError = (error: unknown): CliError => {
  if (error instanceof CliError) {
    return error;
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
  async start(input: RuntimeActionInput): Promise<JsonObject> {
    const nowIso = isoNow();
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso);
    const currentLock = await this.#readLock(lockPath);
    const lockResult = acquireProfileLock(currentLock, {
      profileName: input.profile,
      lockPath,
      ownerPid: process.pid,
      ownerRunId: input.runId,
      nowIso
    });

    if (lockResult.status === "conflict") {
      throw new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
        retryable: true
      });
    }

    let session = buildRuntimeSession(input.profile, existingMeta);
    try {
      session = applyProfileProxyBinding(session, {
        requested: parseProxyUrl(input.params),
        nowIso,
        source: "runtime.start"
      });
      session = beginStartSession(session, {
        runId: input.runId,
        nowIso
      });
      session = markSessionReady(session);
    } catch (error) {
      throw mapRuntimeError(error);
    }

    await store.writeMeta(
      input.profile,
      this.#patchMeta(existingMeta, {
        profileName: input.profile,
        profileDir,
        profileState: session.profileState,
        proxyBinding: session.proxyBinding,
        updatedAt: nowIso,
        lastStartedAt: nowIso
      })
    );
    await this.#writeLock(lockPath, lockResult.lock);

    return {
      profile: input.profile,
      profileState: session.profileState,
      browserState: browserStateFromProfileState(session.profileState, true),
      profileDir,
      proxyUrl: session.proxyBinding?.url ?? null,
      lockHeld: true,
      startedAt: nowIso
    };
  }

  async status(input: RuntimeActionInput): Promise<JsonObject> {
    const store = this.#createStore(input.cwd);
    const profileDir = this.#resolveProfileDir(store, input.profile);
    const lockPath = this.#getLockPath(profileDir);
    const meta = await this.#readMeta(store, input.profile);
    const lock = await this.#readLock(lockPath);
    const lockHeld = lock !== null;

    const profileState: ProfileState = meta?.profileState ?? "uninitialized";
    return {
      profile: input.profile,
      profileState,
      browserState: browserStateFromProfileState(profileState, lockHeld),
      profileDir,
      proxyUrl: meta?.proxyBinding?.url ?? null,
      lockHeld,
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

    let session = buildRuntimeSession(input.profile, existingMeta);
    session = {
      ...session,
      ownerRunId: lock.ownerRunId
    };

    try {
      const stopping = beginStopSession(session, {
        runId: lock.ownerRunId,
        nowIso
      });
      session = markSessionStopped(stopping);
    } catch (error) {
      throw mapRuntimeError(error);
    }

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
    await this.#deleteLock(lockPath);

    return {
      profile: input.profile,
      profileState: session.profileState,
      browserState: "absent",
      profileDir,
      proxyUrl: session.proxyBinding?.url ?? null,
      lockHeld: false,
      stoppedAt: nowIso
    };
  }

  #createStore(cwd: string): ProfileStore {
    return new ProfileStore(join(cwd, ...PROFILE_ROOT_SEGMENTS));
  }

  #resolveProfileDir(store: ProfileStore, profile: string): string {
    try {
      return store.getProfileDir(profile);
    } catch (error) {
      throw mapRuntimeError(error);
    }
  }

  #getLockPath(profileDir: string): string {
    return join(profileDir, PROFILE_LOCK_FILENAME);
  }

  async #readMeta(store: ProfileStore, profile: string): Promise<ProfileMeta | null> {
    try {
      return await store.readMeta(profile);
    } catch {
      throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 元数据损坏");
    }
  }

  async #readOrInitializeMeta(
    store: ProfileStore,
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
      const raw = await readFile(lockPath, "utf8");
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
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  }

  async #deleteLock(lockPath: string): Promise<void> {
    try {
      await unlink(lockPath);
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code !== "ENOENT") {
        throw error;
      }
    }
  }

  #patchMeta(
    current: ProfileMeta,
    patch: {
      profileName: string;
      profileDir: string;
      profileState: ProfileState;
      proxyBinding: ProfileMeta["proxyBinding"];
      updatedAt: string;
      lastStartedAt?: string;
      lastStoppedAt?: string;
    }
  ): ProfileMeta {
    return {
      ...current,
      profileName: patch.profileName,
      profileDir: patch.profileDir,
      profileState: patch.profileState,
      proxyBinding: patch.proxyBinding,
      updatedAt: patch.updatedAt,
      lastStartedAt: patch.lastStartedAt ?? current.lastStartedAt,
      lastStoppedAt: patch.lastStoppedAt ?? current.lastStoppedAt
    };
  }
}
