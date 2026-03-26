import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../core/errors.js";
import { BROWSER_CONTROL_FILENAME, BROWSER_STATE_FILENAME, BrowserLaunchError, launchBrowser, shutdownBrowserSession } from "./browser-launcher.js";
import { createProfileLock } from "./profile-lock.js";
import { ProfileStore } from "./profile-store.js";
import { buildFingerprintContextForMeta } from "./fingerprint-runtime.js";
import { applyProfileProxyBinding, beginLoginSession, beginStartSession, beginStopSession, buildRuntimeSession, markSessionReady, markSessionStopped } from "./runtime-session.js";
const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];
const PROFILE_LOCK_FILENAME = "__webenvoy_lock.json";
const LOCK_ACQUIRE_MAX_RETRIES = 6;
const STOP_LOCK_DELETE_MAX_RETRIES = 3;
const isoNow = () => new Date().toISOString();
const DEFAULT_LOCK_FILE_ADAPTER = {
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
    if (value.trim().length === 0) {
        throw new CliError("ERR_PROFILE_INVALID", "params.proxyUrl 不能为空字符串");
    }
    return value;
};
const readSessionId = (params) => {
    const value = params.session_id;
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return "nm-session-001";
};
const readFingerprintMetaMode = (params) => params.migrate_fingerprint_profile_bundle === true ? "migrate" : undefined;
const asObjectRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const parseLocalStorageSnapshot = (params) => {
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
            throw new CliError("ERR_PROFILE_INVALID", `params.localStorageSnapshot.entries[${index}] 必须是对象`);
        }
        if (typeof entry.key !== "string" || typeof entry.value !== "string") {
            throw new CliError("ERR_PROFILE_INVALID", `params.localStorageSnapshot.entries[${index}] 的 key/value 必须是字符串`);
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
const upsertLocalStorageSnapshot = (snapshots, nextSnapshot) => {
    if (!nextSnapshot) {
        return snapshots;
    }
    const preserved = snapshots.filter((snapshot) => snapshot.origin !== nextSnapshot.origin);
    return [...preserved, nextSnapshot];
};
const buildRecoverableSessionSummary = (meta) => {
    const snapshots = meta?.localStorageSnapshots ?? [];
    return {
        hasLocalStorageSnapshot: snapshots.length > 0,
        snapshotCount: snapshots.length,
        origins: snapshots.map((snapshot) => snapshot.origin),
        lastLoginAt: meta?.lastLoginAt ?? null
    };
};
const isStartableProfileState = (state) => state === "uninitialized" || state === "stopped" || state === "disconnected";
const isLoginableProfileState = (state) => state === "uninitialized" ||
    state === "stopped" ||
    state === "disconnected" ||
    state === "ready" ||
    state === "logging_in";
const isRuntimeActiveProfileState = (state) => state === "starting" || state === "ready" || state === "logging_in" || state === "stopping";
const shouldRecoverAsDisconnected = (acquisition, state) => acquisition !== "same-owner" && isRuntimeActiveProfileState(state);
const shouldConfirmLogin = (params) => params.confirm === true;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const readRequestedExecutionMode = (params) => {
    const mode = params.requested_execution_mode;
    return typeof mode === "string" && mode.length > 0 ? mode : null;
};
const ensureFingerprintExecutionAllowed = (requestedExecutionMode, fingerprintRuntime) => {
    if (!requestedExecutionMode || !LIVE_EXECUTION_MODES.has(requestedExecutionMode)) {
        return;
    }
    if (fingerprintRuntime.execution.live_allowed) {
        return;
    }
    throw new CliError("ERR_PROFILE_INVALID", `profile 指纹一致性校验未通过，禁止 ${requestedExecutionMode}`, {
        details: {
            ability_id: "runtime.profile",
            stage: "input_validation",
            reason: fingerprintRuntime.execution.reason_codes[0] ?? "FINGERPRINT_RUNTIME_INCONSISTENT"
        }
    });
};
const buildExtensionBootstrapInput = (runId, sessionId, fingerprintRuntime) => ({
    run_id: runId,
    session_id: sessionId,
    fingerprint_runtime: fingerprintRuntime
});
const shouldPersistFingerprintBundle = (currentMeta, fingerprintRuntime) => {
    const currentBundle = currentMeta.fingerprintProfileBundle;
    const nextBundle = fingerprintRuntime.fingerprint_profile_bundle;
    const isLegacyBackfilledBundle = (bundle) => {
        if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) {
            return false;
        }
        const legacyMigration = bundle.legacy_migration;
        return (typeof legacyMigration === "object" &&
            legacyMigration !== null &&
            !Array.isArray(legacyMigration) &&
            legacyMigration.status === "backfilled_from_legacy");
    };
    if (!nextBundle) {
        return currentBundle ?? null;
    }
    const isTransientLegacyBackfill = isLegacyBackfilledBundle(nextBundle) &&
        (!currentBundle || isLegacyBackfilledBundle(currentBundle));
    if (isTransientLegacyBackfill) {
        return null;
    }
    return nextBundle;
};
const mapRuntimeError = (error) => {
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
    #storeFactory;
    #lockFileAdapter;
    #isProcessAlive;
    #browserLauncher;
    constructor(options) {
        this.#storeFactory =
            options?.storeFactory ??
                ((cwd) => {
                    return new ProfileStore(join(cwd, ...PROFILE_ROOT_SEGMENTS));
                });
        this.#lockFileAdapter = options?.lockFileAdapter ?? DEFAULT_LOCK_FILE_ADAPTER;
        this.#isProcessAlive =
            options?.isProcessAlive ??
                ((pid) => {
                    if (!Number.isInteger(pid) || pid <= 0) {
                        return false;
                    }
                    try {
                        process.kill(pid, 0);
                        return true;
                    }
                    catch {
                        return false;
                    }
                });
        this.#browserLauncher = options?.browserLauncher ?? {
            launch: launchBrowser,
            shutdown: shutdownBrowserSession
        };
    }
    async start(input) {
        const nowIso = isoNow();
        const store = this.#createStore(input.cwd);
        const profileDir = this.#resolveProfileDir(store, input.profile);
        await store.ensureProfileDir(input.profile);
        const lockPath = this.#getLockPath(profileDir);
        const lockAcquireResult = await this.#acquireProfileLockAtomically({
            profileName: input.profile,
            profileDir,
            lockPath,
            runId: input.runId,
            nowIso
        });
        const keepExistingLockOnFailure = lockAcquireResult.acquisition === "same-owner" &&
            lockAcquireResult.lock.ownerPid !== process.pid;
        let startSucceeded = false;
        let launchedControllerPid = null;
        try {
            let existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso, readFingerprintMetaMode(input.params));
            const recoveredMeta = shouldRecoverAsDisconnected(lockAcquireResult.acquisition, existingMeta.profileState)
                ? this.#patchMeta(existingMeta, {
                    profileName: input.profile,
                    profileDir,
                    profileState: "disconnected",
                    proxyBinding: existingMeta.proxyBinding,
                    fingerprintProfileBundle: existingMeta.fingerprintProfileBundle,
                    updatedAt: nowIso,
                    lastDisconnectedAt: nowIso
                })
                : existingMeta;
            const profileState = recoveredMeta.profileState;
            if (!isStartableProfileState(profileState)) {
                throw new CliError("ERR_PROFILE_STATE_CONFLICT", `profile 当前状态 ${profileState} 不能直接 start`);
            }
            let session = buildRuntimeSession(input.profile, recoveredMeta);
            const requestedExecutionMode = readRequestedExecutionMode(input.params);
            const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, recoveredMeta, {
                requestedExecutionMode
            });
            ensureFingerprintExecutionAllowed(requestedExecutionMode, fingerprintRuntime);
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
                runId: input.runId,
                params: input.params,
                extensionBootstrap: buildExtensionBootstrapInput(input.runId, readSessionId(input.params), fingerprintRuntime)
            });
            launchedControllerPid = browserLaunch.controllerPid;
            await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.controllerPid, nowIso);
            session = markSessionReady(session);
            const nextMeta = this.#patchMeta(recoveredMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                fingerprintProfileBundle: shouldPersistFingerprintBundle(recoveredMeta, fingerprintRuntime),
                updatedAt: nowIso,
                lastStartedAt: nowIso
            });
            await store.writeMeta(input.profile, nextMeta);
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
                controllerPid: browserLaunch.controllerPid,
                recoverableSession: buildRecoverableSessionSummary(nextMeta),
                fingerprint_runtime: fingerprintRuntime,
                startedAt: nowIso
            };
        }
        catch (error) {
            throw mapRuntimeError(error);
        }
        finally {
            if (!startSucceeded) {
                await this.#terminateProcess(launchedControllerPid);
                if (!keepExistingLockOnFailure) {
                    await this.#rollbackLockOnStartFailure(lockPath, input.runId);
                }
            }
        }
    }
    async login(input) {
        const nowIso = isoNow();
        const store = this.#createStore(input.cwd);
        const profileDir = this.#resolveProfileDir(store, input.profile);
        await store.ensureProfileDir(input.profile);
        const lockPath = this.#getLockPath(profileDir);
        const confirmLogin = shouldConfirmLogin(input.params);
        const lockAcquireResult = await this.#acquireProfileLockAtomically({
            profileName: input.profile,
            profileDir,
            lockPath,
            runId: input.runId,
            nowIso,
            allowDeadOwnerRecoveryForSameRun: !confirmLogin
        });
        let loginSucceeded = false;
        let keepLockOnFailure = false;
        let launchedControllerPid = null;
        try {
            let existingMeta = await this.#readOrInitializeMeta(store, input.profile, nowIso, readFingerprintMetaMode(input.params));
            const recoveredMeta = shouldRecoverAsDisconnected(lockAcquireResult.acquisition, existingMeta.profileState)
                ? this.#patchMeta(existingMeta, {
                    profileName: input.profile,
                    profileDir,
                    profileState: "disconnected",
                    proxyBinding: existingMeta.proxyBinding,
                    fingerprintProfileBundle: existingMeta.fingerprintProfileBundle,
                    updatedAt: nowIso,
                    lastDisconnectedAt: nowIso
                })
                : existingMeta;
            const profileState = recoveredMeta.profileState;
            if (!isLoginableProfileState(profileState)) {
                throw new CliError("ERR_PROFILE_STATE_CONFLICT", `profile 当前状态 ${profileState} 不能直接 login`);
            }
            if (confirmLogin &&
                (lockAcquireResult.acquisition !== "same-owner" ||
                    lockAcquireResult.lock.ownerRunId !== input.runId ||
                    lockAcquireResult.lock.ownerPid === process.pid ||
                    !(await this.#inspectProfileLock(lockAcquireResult.lock, profileDir)).controlConnected)) {
                if (isRuntimeActiveProfileState(recoveredMeta.profileState) ||
                    recoveredMeta.profileState === "disconnected") {
                    await store.writeMeta(input.profile, this.#patchMeta(recoveredMeta, {
                        profileName: input.profile,
                        profileDir,
                        profileState: "disconnected",
                        proxyBinding: recoveredMeta.proxyBinding,
                        fingerprintProfileBundle: recoveredMeta.fingerprintProfileBundle,
                        updatedAt: nowIso,
                        lastDisconnectedAt: nowIso
                    }));
                }
                throw new CliError("ERR_PROFILE_STATE_CONFLICT", "runtime.login --confirm 前检测到登录浏览器已断开，请重新执行 runtime.login", { retryable: true });
            }
            let session = buildRuntimeSession(input.profile, recoveredMeta);
            const requestedExecutionMode = readRequestedExecutionMode(input.params);
            const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, recoveredMeta, {
                requestedExecutionMode
            });
            ensureFingerprintExecutionAllowed(requestedExecutionMode, fingerprintRuntime);
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
                    runId: input.runId,
                    params: input.params,
                    extensionBootstrap: buildExtensionBootstrapInput(input.runId, readSessionId(input.params), fingerprintRuntime)
                });
                launchedControllerPid = browserLaunch.controllerPid;
                await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.controllerPid, nowIso);
            }
            await store.writeMeta(input.profile, this.#patchMeta(recoveredMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                fingerprintProfileBundle: shouldPersistFingerprintBundle(recoveredMeta, fingerprintRuntime),
                updatedAt: nowIso
            }));
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
                    fingerprint_runtime: fingerprintRuntime,
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
                fingerprintProfileBundle: shouldPersistFingerprintBundle(recoveredMeta, fingerprintRuntime),
                updatedAt: nowIso,
                lastLoginAt: nowIso,
                localStorageSnapshots: upsertLocalStorageSnapshot(recoveredMeta.localStorageSnapshots, localStorageSnapshot)
            });
            await store.writeMeta(input.profile, nextMeta);
            loginSucceeded = true;
            return {
                profile: input.profile,
                profileState: session.profileState,
                browserState: browserStateFromProfileState(session.profileState, true),
                profileDir,
                proxyUrl: session.proxyBinding?.url ?? null,
                lockHeld: true,
                recoverableSession: buildRecoverableSessionSummary(nextMeta),
                fingerprint_runtime: fingerprintRuntime,
                lastLoginAt: nowIso
            };
        }
        catch (error) {
            throw mapRuntimeError(error);
        }
        finally {
            if (!loginSucceeded && !keepLockOnFailure) {
                await this.#terminateProcess(launchedControllerPid);
                await this.#rollbackLockOnStartFailure(lockPath, input.runId);
            }
        }
    }
    async status(input) {
        const store = this.#createStore(input.cwd);
        const profileDir = this.#resolveProfileDir(store, input.profile);
        const lockPath = this.#getLockPath(profileDir);
        const meta = await this.#readMeta(store, input.profile, {
            mode: readFingerprintMetaMode(input.params) ?? "readonly"
        });
        const lock = await this.#readLock(lockPath);
        const storedProfileState = meta?.profileState ?? "uninitialized";
        const activeState = isRuntimeActiveProfileState(storedProfileState);
        const lockInspection = lock !== null ? await this.#inspectProfileLock(lock, profileDir) : null;
        const healthyLock = lockInspection?.blocksReuse ?? false;
        const profileState = activeState && !(lockInspection?.controlConnected ?? false) ? "disconnected" : storedProfileState;
        const lockHeld = activeState && healthyLock;
        const requestedExecutionMode = readRequestedExecutionMode(input.params);
        const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, meta, {
            requestedExecutionMode
        });
        return {
            profile: input.profile,
            profileState,
            browserState: browserStateFromProfileState(profileState, lockHeld),
            profileDir,
            proxyUrl: meta?.proxyBinding?.url ?? null,
            lockHeld,
            lockOwnerPid: lock?.ownerPid ?? null,
            recoverableSession: buildRecoverableSessionSummary(meta),
            fingerprint_runtime: fingerprintRuntime,
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
        const requestedExecutionMode = readRequestedExecutionMode(input.params);
        const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, existingMeta, {
            requestedExecutionMode
        });
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
        const previousMeta = existingMeta;
        try {
            const browserState = await this.#readBrowserInstanceState(profileDir);
            const controllerAlive = this.#isProcessAlive(lock.ownerPid);
            if (!controllerAlive &&
                browserState &&
                browserState.runId === input.runId &&
                this.#isProcessAlive(browserState.browserPid)) {
                await this.#terminateProcess(browserState.browserPid);
                await this.#deleteBrowserStateFiles(profileDir);
            }
            else {
                await this.#browserLauncher.shutdown({
                    profileDir,
                    controllerPid: lock.ownerPid,
                    runId: input.runId
                });
            }
            await store.writeMeta(input.profile, this.#patchMeta(existingMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                fingerprintProfileBundle: shouldPersistFingerprintBundle(existingMeta, fingerprintRuntime),
                updatedAt: nowIso,
                lastStoppedAt: nowIso
            }));
            await this.#deleteLockWithRetry(lockPath);
        }
        catch (error) {
            try {
                await store.writeMeta(input.profile, previousMeta);
            }
            catch (rollbackError) {
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
            fingerprint_runtime: fingerprintRuntime,
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
    async #readMeta(store, profile, options) {
        try {
            return await store.readMeta(profile, options);
        }
        catch {
            throw new CliError("ERR_PROFILE_META_CORRUPT", "profile 元数据损坏");
        }
    }
    async #readOrInitializeMeta(store, profile, nowIso, mode) {
        const meta = await this.#readMeta(store, profile, mode ? { mode } : undefined);
        if (meta) {
            return meta;
        }
        return store.initializeMeta(profile, nowIso);
    }
    async #readLock(lockPath) {
        try {
            const raw = await this.#lockFileAdapter.readFile(lockPath, "utf8");
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
        await this.#lockFileAdapter.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
    }
    async #updateLockOwnerPid(lockPath, runId, ownerPid, nowIso) {
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
        const updated = {
            ...existing,
            ownerPid,
            lastHeartbeatAt: nowIso
        };
        await this.#writeLock(lockPath, updated);
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
    async #terminateProcess(pid) {
        if (!Number.isInteger(pid) || pid === null || pid <= 0) {
            return;
        }
        try {
            process.kill(pid, "SIGTERM");
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ESRCH") {
                return;
            }
            throw error;
        }
        for (let attempt = 0; attempt < 3; attempt += 1) {
            if (!this.#isProcessAlive(pid)) {
                return;
            }
            await new Promise((resolve) => {
                setTimeout(resolve, 80);
            });
        }
        if (!this.#isProcessAlive(pid)) {
            return;
        }
        try {
            process.kill(pid, "SIGKILL");
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code !== "ESRCH") {
                throw error;
            }
        }
    }
    async #acquireProfileLockAtomically(input) {
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
            if (existingLock.ownerRunId === input.runId) {
                const inspection = await this.#inspectProfileLock(existingLock, input.profileDir);
                if (!inspection.blocksReuse && input.allowDeadOwnerRecoveryForSameRun === false) {
                    return { lock: existingLock, acquisition: "same-owner-dead" };
                }
                const ownerPid = inspection.blocksReuse ? existingLock.ownerPid : process.pid;
                const updatedLock = {
                    ...existingLock,
                    ownerPid,
                    lastHeartbeatAt: input.nowIso
                };
                await this.#writeLock(input.lockPath, updatedLock);
                return { lock: updatedLock, acquisition: "same-owner" };
            }
            if ((await this.#inspectProfileLock(existingLock, input.profileDir)).blocksReuse) {
                throw new CliError("ERR_PROFILE_LOCKED", "profile 当前被其他运行占用", {
                    retryable: true
                });
            }
            await this.#deleteLock(input.lockPath);
            try {
                await this.#lockFileAdapter.writeFile(input.lockPath, `${JSON.stringify(nextLock, null, 2)}\n`, {
                    encoding: "utf8",
                    flag: "wx"
                });
                return { lock: nextLock, acquisition: "reclaimed" };
            }
            catch (error) {
                const nodeError = error;
                if (nodeError.code !== "EEXIST") {
                    throw error;
                }
            }
        }
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "profile 锁获取失败，请重试", {
            retryable: true
        });
    }
    async #deleteLock(lockPath) {
        try {
            await this.#lockFileAdapter.unlink(lockPath);
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code !== "ENOENT") {
                throw error;
            }
        }
    }
    async #deleteLockWithRetry(lockPath) {
        let lastError = null;
        for (let attempt = 0; attempt < STOP_LOCK_DELETE_MAX_RETRIES; attempt += 1) {
            try {
                await this.#deleteLock(lockPath);
                return;
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError;
    }
    async #readBrowserInstanceState(profileDir) {
        const statePath = join(profileDir, BROWSER_STATE_FILENAME);
        try {
            const raw = await this.#lockFileAdapter.readFile(statePath, "utf8");
            const parsed = JSON.parse(raw);
            if (typeof parsed.runId !== "string" ||
                !Number.isInteger(parsed.controllerPid) ||
                !Number.isInteger(parsed.browserPid)) {
                return null;
            }
            const controllerPid = parsed.controllerPid;
            const browserPid = parsed.browserPid;
            if (controllerPid <= 0 || browserPid <= 0) {
                return null;
            }
            return {
                runId: parsed.runId,
                controllerPid,
                browserPid
            };
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code === "ENOENT") {
                return null;
            }
            return null;
        }
    }
    async #inspectProfileLock(lock, profileDir) {
        const lockOwnerAlive = this.#isProcessAlive(lock.ownerPid);
        const state = await this.#readBrowserInstanceState(profileDir);
        const controllerAlive = lockOwnerAlive ||
            (state !== null &&
                state.controllerPid === lock.ownerPid &&
                this.#isProcessAlive(state.controllerPid));
        const browserAlive = state !== null && this.#isProcessAlive(state.browserPid);
        return {
            blocksReuse: controllerAlive || browserAlive,
            controlConnected: controllerAlive,
            browserPid: browserAlive ? state?.browserPid ?? null : null,
            stateRunId: state?.runId ?? null
        };
    }
    async #deleteBrowserStateFiles(profileDir) {
        const statePath = join(profileDir, BROWSER_STATE_FILENAME);
        const controlPath = join(profileDir, BROWSER_CONTROL_FILENAME);
        try {
            await this.#lockFileAdapter.unlink(statePath);
        }
        catch (error) {
            const nodeError = error;
            if (nodeError.code !== "ENOENT") {
                throw error;
            }
        }
        try {
            await this.#lockFileAdapter.unlink(controlPath);
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
            fingerprintProfileBundle: patch.fingerprintProfileBundle === null
                ? undefined
                : patch.fingerprintProfileBundle ?? current.fingerprintProfileBundle,
            localStorageSnapshots: patch.localStorageSnapshots ?? current.localStorageSnapshots,
            updatedAt: patch.updatedAt,
            lastStartedAt: patch.lastStartedAt ?? current.lastStartedAt,
            lastLoginAt: patch.lastLoginAt ?? current.lastLoginAt,
            lastStoppedAt: patch.lastStoppedAt ?? current.lastStoppedAt,
            lastDisconnectedAt: patch.lastDisconnectedAt ?? current.lastDisconnectedAt
        };
    }
}
