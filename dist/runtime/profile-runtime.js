import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../core/errors.js";
import { createProfileLock } from "./profile-lock.js";
import { ProfileStore } from "./profile-store.js";
import { applyProfileProxyBinding, beginStartSession, beginStopSession, buildRuntimeSession, markSessionReady, markSessionStopped } from "./runtime-session.js";
const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];
const PROFILE_LOCK_FILENAME = "__webenvoy_lock.json";
const LOCK_ACQUIRE_MAX_RETRIES = 6;
const isoNow = () => new Date().toISOString();
const browserStateFromProfileState = (profileState, lockHeld) => {
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
const parseProxyUrl = (params) => {
    const value = params.proxyUrl;
    if (value === undefined || value === null) {
        return value;
    }
    if (typeof value !== "string") {
        throw new CliError("ERR_PROFILE_INVALID", "params.proxyUrl 必须是字符串或 null");
    }
    return value;
};
const isStartableProfileState = (state) => state === "uninitialized" || state === "stopped" || state === "disconnected";
const mapRuntimeError = (error) => {
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
    #storeFactory;
    constructor(options) {
        this.#storeFactory =
            options?.storeFactory ??
                ((cwd) => {
                    return new ProfileStore(join(cwd, ...PROFILE_ROOT_SEGMENTS));
                });
    }
    async start(input) {
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
        let startSucceeded = false;
        try {
            let existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso);
            const profileState = existingMeta.profileState;
            if (!isStartableProfileState(profileState)) {
                throw new CliError("ERR_PROFILE_STATE_CONFLICT", `profile 当前状态 ${profileState} 不能直接 start`);
            }
            let session = buildRuntimeSession(input.profile, existingMeta);
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
            await store.writeMeta(input.profile, this.#patchMeta(existingMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                updatedAt: nowIso,
                lastStartedAt: nowIso
            }));
            await this.#writeLock(lockPath, lockAcquireResult.lock);
            startSucceeded = true;
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
        catch (error) {
            throw mapRuntimeError(error);
        }
        finally {
            if (!startSucceeded) {
                await this.#rollbackLockOnStartFailure(lockPath, input.runId);
            }
        }
    }
    async status(input) {
        const store = this.#createStore(input.cwd);
        const profileDir = this.#resolveProfileDir(store, input.profile);
        const lockPath = this.#getLockPath(profileDir);
        const meta = await this.#readMeta(store, input.profile);
        const lock = await this.#readLock(lockPath);
        const lockHeld = lock !== null;
        const profileState = meta?.profileState ?? "uninitialized";
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
    async stop(input) {
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
            throw new CliError("ERR_PROFILE_OWNER_CONFLICT", "runtime.stop run_id 与 profile 锁所有者不一致", { retryable: false });
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
        }
        catch (error) {
            throw mapRuntimeError(error);
        }
        await store.writeMeta(input.profile, this.#patchMeta(existingMeta, {
            profileName: input.profile,
            profileDir,
            profileState: session.profileState,
            proxyBinding: session.proxyBinding,
            updatedAt: nowIso,
            lastStoppedAt: nowIso
        }));
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
    #createStore(cwd) {
        return this.#storeFactory(cwd);
    }
    #resolveProfileDir(store, profile) {
        try {
            return store.getProfileDir(profile);
        }
        catch (error) {
            throw mapRuntimeError(error);
        }
    }
    #getLockPath(profileDir) {
        return join(profileDir, PROFILE_LOCK_FILENAME);
    }
    async #readMeta(store, profile) {
        try {
            return await store.readMeta(profile);
        }
        catch {
            throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 元数据损坏");
        }
    }
    async #readOrInitializeMeta(store, profile, nowIso) {
        const meta = await this.#readMeta(store, profile);
        if (meta) {
            return meta;
        }
        return store.initializeMeta(profile, nowIso);
    }
    async #readLock(lockPath) {
        try {
            const raw = await readFile(lockPath, "utf8");
            return JSON.parse(raw);
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ENOENT") {
                return null;
            }
            throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 锁文件损坏");
        }
    }
    async #writeLock(lockPath, lock) {
        await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
    async #rollbackLockOnStartFailure(lockPath, runId) {
        const lock = await this.#readLock(lockPath);
        if (!lock) {
            return;
        }
        if (lock.ownerRunId !== runId) {
            return;
        }
        await this.#deleteLock(lockPath);
    }
    async #acquireProfileLockAtomically(input) {
        for (let attempt = 0; attempt < LOCK_ACQUIRE_MAX_RETRIES; attempt += 1) {
            const nextLock = createProfileLock({
                profileName: input.profileName,
                lockPath: input.lockPath,
                ownerPid: process.pid,
                ownerRunId: input.runId,
                nowIso: input.nowIso
            });
            try {
                await writeFile(input.lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, {
                    encoding: "utf8",
                    flag: "wx"
                });
                return { lock: nextLock };
            }
            catch (error) {
                const nodeError = error;
                if (nodeError.code !== "EEXIST") {
                    throw error;
                }
            }
            const existingLock = await this.#readLock(input.lockPath);
            if (!existingLock) {
                continue;
            }
            if (existingLock.ownerPid === process.pid && existingLock.ownerRunId === input.runId) {
                const updated = {
                    ...existingLock,
                    lastHeartbeatAt: input.nowIso
                };
                await this.#writeLock(input.lockPath, updated);
                return { lock: updated };
            }
            throw new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
                retryable: true
            });
        }
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "profile 锁获取失败，请重试", {
            retryable: true
        });
    }
    async #deleteLock(lockPath) {
        try {
            await unlink(lockPath);
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code !== "ENOENT") {
                throw error;
            }
        }
    }
    #patchMeta(current, patch) {
        return {
            ...current,
            profileName: patch.profileName,
            profileDir: patch.profileDir,
            profileState: patch.profileState,
            proxyBinding: patch.proxyBinding,
            updatedAt: patch.updatedAt,
            lastStartedAt: patch.lastStartedAt ?? current.lastStartedAt,
            lastStoppedAt: patch.lastStoppedAt ?? current.lastStoppedAt,
            lastDisconnectedAt: patch.lastDisconnectedAt ?? current.lastDisconnectedAt
        };
    }
}
