import { randomUUID } from "node:crypto";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../core/errors.js";
import { BROWSER_CONTROL_FILENAME, BROWSER_STATE_FILENAME, BrowserLaunchError, launchBrowser, shutdownBrowserSession } from "./browser-launcher.js";
import { createProfileLock } from "./profile-lock.js";
import { ProfileStore } from "./profile-store.js";
import { inspectProfileLock, isLoginableProfileState, isRuntimeActiveProfileState, isStartableProfileState, resolveProfileAccessState, shouldRecoverAsDisconnected } from "./profile-access.js";
import { buildIdentityPreflightError, runIdentityPreflight } from "./persistent-extension-identity.js";
import { buildFingerprintContextForMeta } from "./fingerprint-runtime.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "./native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "./native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "./native-messaging/loopback.js";
import { buildRuntimeBootstrapContextId } from "./runtime-bootstrap.js";
import { resolveRuntimeProfileRoot } from "./worktree-root.js";
import { applyProfileProxyBinding, beginLoginSession, beginStartSession, beginStopSession, buildRuntimeSession, markSessionReady, markSessionStopped } from "./runtime-session.js";
import { browserStateFromProfileState, buildBoundlessRuntimeReadiness, buildNonPersistentRuntimeReadiness, buildRuntimeReadiness, buildUnlockedPersistentRuntimeReadiness, mapBootstrapCliErrorToReadiness, mapRuntimeReadinessPayload, mapTransportErrorToReadiness } from "./runtime-readiness.js";
const PROFILE_LOCK_FILENAME = "__webenvoy_lock.json";
const LOCK_ACQUIRE_MAX_RETRIES = 6;
const STOP_LOCK_DELETE_MAX_RETRIES = 3;
const hasRequestedPersistentExtensionIdentity = (params) => {
    const candidate = params.persistent_extension_identity ?? params.persistentExtensionIdentity;
    return typeof candidate === "object" && candidate !== null && !Array.isArray(candidate);
};
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
const buildRuntimeBootstrapEnvelope = (input) => ({
    version: "v1",
    run_id: input.runId,
    runtime_context_id: input.runtimeContextId,
    profile: input.profile,
    fingerprint_runtime: input.fingerprintRuntime,
    fingerprint_patch_manifest: input.fingerprintRuntime.fingerprint_patch_manifest
        ? input.fingerprintRuntime.fingerprint_patch_manifest
        : {},
    main_world_secret: input.mainWorldSecret
});
const resolveDefaultRuntimeBridge = () => {
    if (process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback") {
        return new NativeMessagingBridge({
            transport: createLoopbackNativeBridgeTransport()
        });
    }
    return new NativeMessagingBridge({
        transport: new NativeHostBridgeTransport()
    });
};
const isTransientBackfilledFingerprintBundle = (bundle) => {
    if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) {
        return false;
    }
    const legacyMigration = bundle.legacy_migration;
    return (typeof legacyMigration === "object" &&
        legacyMigration !== null &&
        !Array.isArray(legacyMigration) &&
        legacyMigration.status === "backfilled_from_legacy");
};
const shouldBlockSessionEntryOnIdentityPreflight = (preflight) => preflight.blocking && preflight.failureReason !== "IDENTITY_BINDING_MISSING";
const shouldPersistFingerprintBundle = (currentMeta, fingerprintRuntime) => {
    const currentBundle = currentMeta.fingerprintProfileBundle;
    const nextBundle = fingerprintRuntime.fingerprint_profile_bundle;
    if (!nextBundle) {
        return currentBundle ?? null;
    }
    const isTransientLegacyBackfill = isTransientBackfilledFingerprintBundle(nextBundle) &&
        (!currentBundle || isTransientBackfilledFingerprintBundle(currentBundle));
    if (isTransientLegacyBackfill) {
        return null;
    }
    return nextBundle;
};
const resolvePersistentExtensionBindingForMeta = (input) => input.identityPreflight.mode === "official_chrome_persistent_extension" &&
    input.identityPreflight.binding
    ? input.identityPreflight.binding
    : (input.currentMeta.persistentExtensionBinding ?? null);
const asResultRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
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
const buildIdentityPreflightOutput = (identityPreflight) => ({
    mode: identityPreflight.mode,
    binding: identityPreflight.binding,
    manifestPath: identityPreflight.manifestPath,
    manifestSource: identityPreflight.manifestSource,
    expectedOrigin: identityPreflight.expectedOrigin,
    allowedOrigins: identityPreflight.allowedOrigins,
    browserPath: identityPreflight.browserPath,
    browserVersion: identityPreflight.browserVersion,
    blocking: identityPreflight.blocking,
    failureReason: identityPreflight.failureReason,
    installDiagnostics: identityPreflight.installDiagnostics
});
export class ProfileRuntimeService {
    #storeFactory;
    #lockFileAdapter;
    #isProcessAlive;
    #browserLauncher;
    #bridgeFactory;
    constructor(options) {
        this.#storeFactory =
            options?.storeFactory ??
                ((cwd) => {
                    return new ProfileStore(resolveRuntimeProfileRoot(cwd));
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
        this.#bridgeFactory = options?.bridgeFactory ?? (() => resolveDefaultRuntimeBridge());
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
            let existingMeta = await this.#readMeta(store, input.profile, {
                mode: readFingerprintMetaMode(input.params)
            });
            const identityPreflight = await this.#runIdentityPreflight({
                input,
                meta: existingMeta,
                profileDir
            });
            const usesPersistentIdentityMode = identityPreflight.mode === "official_chrome_persistent_extension";
            if (shouldBlockSessionEntryOnIdentityPreflight(identityPreflight)) {
                throw buildIdentityPreflightError(identityPreflight);
            }
            if (!existingMeta) {
                existingMeta = usesPersistentIdentityMode
                    ? this.#buildMinimalProfileMeta({
                        profile: input.profile,
                        profileDir,
                        nowIso
                    })
                    : await store.initializeMeta(input.profile, nowIso, {
                        allowUnsupportedExtensionBrowser: usesPersistentIdentityMode ||
                            hasRequestedPersistentExtensionIdentity(input.params)
                    });
            }
            let recoveredMeta = shouldRecoverAsDisconnected(lockAcquireResult.acquisition, existingMeta.profileState)
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
            session = applyProfileProxyBinding(session, {
                requested: parseProxyUrl(input.params),
                nowIso,
                source: "runtime.start"
            });
            const requestedExecutionMode = readRequestedExecutionMode(input.params);
            const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, recoveredMeta, {
                requestedExecutionMode
            });
            ensureFingerprintExecutionAllowed(requestedExecutionMode, fingerprintRuntime);
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
                launchMode: identityPreflight.mode,
                extensionBootstrap: identityPreflight.mode === "load_extension"
                    ? buildExtensionBootstrapInput(input.runId, readSessionId(input.params), fingerprintRuntime)
                    : null
            });
            launchedControllerPid = browserLaunch.controllerPid;
            await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.controllerPid, nowIso);
            session = markSessionReady(session);
            const readiness = identityPreflight.identityBindingState === "bound"
                ? await this.#deliverRuntimeBootstrap({
                    runtimeInput: input,
                    profile: input.profile,
                    fingerprintRuntime
                })
                : await this.#readRuntimeReadiness({
                    runtimeInput: input,
                    lockHeld: true,
                    identityPreflight,
                    profileState: session.profileState
                });
            const nextMeta = this.#patchMeta(recoveredMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                persistentExtensionBinding: resolvePersistentExtensionBindingForMeta({
                    currentMeta: recoveredMeta,
                    identityPreflight
                }),
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
                identityBindingState: readiness.identityBindingState,
                transportState: readiness.transportState,
                bootstrapState: readiness.bootstrapState,
                runtimeReadiness: readiness.runtimeReadiness,
                identityPreflight: buildIdentityPreflightOutput(identityPreflight),
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
            let existingMeta = await this.#readMeta(store, input.profile, {
                mode: readFingerprintMetaMode(input.params)
            });
            const identityPreflight = await this.#runIdentityPreflight({
                input,
                meta: existingMeta,
                profileDir
            });
            const usesPersistentIdentityMode = identityPreflight.mode === "official_chrome_persistent_extension";
            if (shouldBlockSessionEntryOnIdentityPreflight(identityPreflight)) {
                throw buildIdentityPreflightError(identityPreflight);
            }
            if (!existingMeta) {
                existingMeta = usesPersistentIdentityMode
                    ? this.#buildMinimalProfileMeta({
                        profile: input.profile,
                        profileDir,
                        nowIso
                    })
                    : await store.initializeMeta(input.profile, nowIso, {
                        allowUnsupportedExtensionBrowser: usesPersistentIdentityMode ||
                            hasRequestedPersistentExtensionIdentity(input.params)
                    });
            }
            let recoveredMeta = shouldRecoverAsDisconnected(lockAcquireResult.acquisition, existingMeta.profileState)
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
            session = applyProfileProxyBinding(session, {
                requested: parseProxyUrl(input.params),
                nowIso,
                source: "runtime.login"
            });
            const requestedExecutionMode = readRequestedExecutionMode(input.params);
            const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, recoveredMeta, {
                requestedExecutionMode
            });
            ensureFingerprintExecutionAllowed(requestedExecutionMode, fingerprintRuntime);
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
                    launchMode: identityPreflight.mode,
                    extensionBootstrap: identityPreflight.mode === "load_extension"
                        ? buildExtensionBootstrapInput(input.runId, readSessionId(input.params), fingerprintRuntime)
                        : null
                });
                launchedControllerPid = browserLaunch.controllerPid;
                await this.#updateLockOwnerPid(lockPath, input.runId, browserLaunch.controllerPid, nowIso);
            }
            await store.writeMeta(input.profile, this.#patchMeta(recoveredMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                persistentExtensionBinding: resolvePersistentExtensionBindingForMeta({
                    currentMeta: recoveredMeta,
                    identityPreflight
                }),
                fingerprintProfileBundle: shouldPersistFingerprintBundle(recoveredMeta, fingerprintRuntime),
                updatedAt: nowIso
            }));
            if (!confirmLogin) {
                const readiness = await this.#readRuntimeReadiness({
                    runtimeInput: input,
                    lockHeld: true,
                    identityPreflight,
                    profileState: session.profileState
                });
                loginSucceeded = true;
                keepLockOnFailure = true;
                return {
                    profile: input.profile,
                    profileState: session.profileState,
                    browserState: browserStateFromProfileState(session.profileState, true),
                    profileDir,
                    proxyUrl: session.proxyBinding?.url ?? null,
                    lockHeld: true,
                    identityBindingState: readiness.identityBindingState,
                    transportState: readiness.transportState,
                    bootstrapState: readiness.bootstrapState,
                    runtimeReadiness: readiness.runtimeReadiness,
                    identityPreflight: buildIdentityPreflightOutput(identityPreflight),
                    recoverableSession: buildRecoverableSessionSummary(recoveredMeta),
                    fingerprint_runtime: fingerprintRuntime,
                    confirmationRequired: true,
                    confirmPath: "runtime.login --params '{\"confirm\":true}'"
                };
            }
            const localStorageSnapshot = parseLocalStorageSnapshot(input.params);
            session = markSessionReady(session);
            const readiness = identityPreflight.identityBindingState === "bound"
                ? await this.#deliverRuntimeBootstrap({
                    runtimeInput: input,
                    profile: input.profile,
                    fingerprintRuntime
                })
                : await this.#readRuntimeReadiness({
                    runtimeInput: input,
                    lockHeld: true,
                    identityPreflight,
                    profileState: session.profileState
                });
            const nextMeta = this.#patchMeta(recoveredMeta, {
                profileName: input.profile,
                profileDir,
                profileState: session.profileState,
                proxyBinding: session.proxyBinding,
                persistentExtensionBinding: resolvePersistentExtensionBindingForMeta({
                    currentMeta: recoveredMeta,
                    identityPreflight
                }),
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
                identityBindingState: readiness.identityBindingState,
                transportState: readiness.transportState,
                bootstrapState: readiness.bootstrapState,
                runtimeReadiness: readiness.runtimeReadiness,
                identityPreflight: buildIdentityPreflightOutput(identityPreflight),
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
        const lockInspection = lock !== null ? await this.#inspectProfileLock(lock, profileDir) : null;
        const accessState = resolveProfileAccessState({
            storedProfileState,
            lockOwnerRunId: lock?.ownerRunId ?? null,
            lockInspection,
            runtimeRunId: input.runId
        });
        const requestedExecutionMode = readRequestedExecutionMode(input.params);
        const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, meta, {
            requestedExecutionMode
        });
        const identityPreflight = await runIdentityPreflight({
            params: input.params,
            meta,
            profileDir
        });
        const readiness = await this.#readRuntimeReadiness({
            runtimeInput: input,
            lockHeld: accessState.lockHeld,
            observedRunId: accessState.observedRunId,
            identityPreflight,
            profileState: accessState.profileState
        });
        return {
            profile: input.profile,
            profileState: accessState.profileState,
            browserState: browserStateFromProfileState(accessState.profileState, accessState.lockHeld),
            profileDir,
            proxyUrl: meta?.proxyBinding?.url ?? null,
            lockHeld: accessState.lockHeld,
            identityBindingState: readiness.identityBindingState,
            transportState: readiness.transportState,
            bootstrapState: readiness.bootstrapState,
            runtimeReadiness: readiness.runtimeReadiness,
            identityPreflight: buildIdentityPreflightOutput(identityPreflight),
            lockOwnerPid: lock?.ownerPid ?? null,
            orphanRecoverable: lockInspection?.orphanRecoverable ?? false,
            recoverableSession: buildRecoverableSessionSummary(meta),
            fingerprint_runtime: fingerprintRuntime,
            updatedAt: meta?.updatedAt ?? null
        };
    }
    async attach(input) {
        const nowIso = isoNow();
        const store = this.#createStore(input.cwd);
        const profileDir = this.#resolveProfileDir(store, input.profile);
        const lockPath = this.#getLockPath(profileDir);
        const meta = await this.#readMeta(store, input.profile, {
            mode: readFingerprintMetaMode(input.params) ?? "readonly"
        });
        const storedProfileState = meta?.profileState ?? "uninitialized";
        const activeState = isRuntimeActiveProfileState(storedProfileState) || storedProfileState === "disconnected";
        if (!activeState) {
            throw new CliError("ERR_PROFILE_STATE_CONFLICT", `profile 当前状态 ${storedProfileState} 不能接管 live runtime`, { retryable: true });
        }
        const lock = await this.#readLock(lockPath);
        if (!lock) {
            throw new CliError("ERR_PROFILE_LOCKED", "profile 当前未持有可接管的 live runtime", {
                retryable: true
            });
        }
        const lockInspection = await this.#inspectProfileLock(lock, profileDir);
        const accessState = resolveProfileAccessState({
            storedProfileState,
            lockOwnerRunId: lock.ownerRunId,
            lockInspection,
            runtimeRunId: input.runId
        });
        const pinnedControllerPid = typeof lock.controllerPid === "number"
            ? lock.controllerPid
            : lock.ownerPid;
        const attachableReadyRuntime = accessState.healthyLock &&
            accessState.controlConnected &&
            accessState.profileState === "ready" &&
            Number.isInteger(pinnedControllerPid);
        const attachableRecoverableRuntime = (storedProfileState === "ready" || storedProfileState === "disconnected") &&
            lockInspection.orphanRecoverable;
        if (!attachableReadyRuntime && !attachableRecoverableRuntime) {
            throw new CliError("ERR_PROFILE_LOCKED", "profile 当前不存在可安全接管的 ready runtime", {
                retryable: true
            });
        }
        const identityPreflight = await this.#runIdentityPreflight({
            input,
            meta,
            profileDir
        });
        if (shouldBlockSessionEntryOnIdentityPreflight(identityPreflight)) {
            throw buildIdentityPreflightError(identityPreflight);
        }
        if (identityPreflight.mode !== "official_chrome_persistent_extension" ||
            identityPreflight.identityBindingState !== "bound") {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime identity 未就绪，无法接管", {
                retryable: true
            });
        }
        const requestedExecutionMode = readRequestedExecutionMode(input.params);
        const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, meta, {
            requestedExecutionMode
        });
        ensureFingerprintExecutionAllowed(requestedExecutionMode, fingerprintRuntime);
        if (attachableRecoverableRuntime) {
            const preAttachReadiness = await this.#readRuntimeReadiness({
                runtimeInput: input,
                lockHeld: false,
                observedRunId: accessState.observedRunId,
                identityPreflight,
                profileState: accessState.profileState
            });
            if (preAttachReadiness.bootstrapState === "stale" ||
                preAttachReadiness.transportState === "not_connected" ||
                preAttachReadiness.runtimeReadiness !== "recoverable") {
                throw new CliError("ERR_PROFILE_LOCKED", "profile 当前不存在可安全接管的 ready runtime", {
                    retryable: true
                });
            }
        }
        const nextOwnerPid = attachableRecoverableRuntime ? process.pid : lock.ownerPid;
        let attachedLock = lock;
        if (lock.ownerRunId !== input.runId ||
            (attachableRecoverableRuntime && lock.ownerPid !== nextOwnerPid)) {
            attachedLock = await this.#rebindActiveRuntimeOwnership({
                profileDir,
                lockPath,
                lock,
                nextRunId: input.runId,
                nextOwnerPid,
                orphanRecoverable: attachableRecoverableRuntime,
                nowIso
            });
        }
        let attachedProfileState = accessState.profileState;
        let nextMeta = meta;
        if (attachableRecoverableRuntime && meta && meta.profileState !== attachedProfileState) {
            nextMeta = this.#patchMeta(meta, {
                profileName: input.profile,
                profileDir,
                profileState: attachedProfileState,
                proxyBinding: meta.proxyBinding,
                persistentExtensionBinding: meta.persistentExtensionBinding ?? null,
                fingerprintProfileBundle: meta.fingerprintProfileBundle ?? null,
                updatedAt: nowIso,
                lastDisconnectedAt: meta.lastDisconnectedAt ?? nowIso
            });
            await store.writeMeta(input.profile, nextMeta);
        }
        const readiness = await this.#readRuntimeReadiness({
            runtimeInput: input,
            lockHeld: true,
            identityPreflight,
            profileState: attachedProfileState
        });
        if (attachableRecoverableRuntime &&
            readiness.runtimeReadiness === "ready" &&
            readiness.transportState === "ready" &&
            readiness.bootstrapState === "ready") {
            attachedProfileState = "ready";
            if (nextMeta) {
                nextMeta = this.#patchMeta(nextMeta, {
                    profileName: input.profile,
                    profileDir,
                    profileState: attachedProfileState,
                    proxyBinding: nextMeta.proxyBinding,
                    persistentExtensionBinding: nextMeta.persistentExtensionBinding ?? null,
                    fingerprintProfileBundle: nextMeta.fingerprintProfileBundle ?? null,
                    updatedAt: nowIso,
                    lastDisconnectedAt: nextMeta.lastDisconnectedAt ?? nowIso
                });
                await store.writeMeta(input.profile, nextMeta);
            }
        }
        return {
            profile: input.profile,
            profileState: attachedProfileState,
            browserState: browserStateFromProfileState(attachedProfileState, true),
            profileDir,
            proxyUrl: meta?.proxyBinding?.url ?? null,
            lockHeld: true,
            identityBindingState: readiness.identityBindingState,
            transportState: readiness.transportState,
            bootstrapState: readiness.bootstrapState,
            runtimeReadiness: readiness.runtimeReadiness,
            identityPreflight: buildIdentityPreflightOutput(identityPreflight),
            lockOwnerPid: attachedLock.ownerPid,
            orphanRecoverable: attachableRecoverableRuntime,
            recoverableSession: buildRecoverableSessionSummary(nextMeta),
            fingerprint_runtime: fingerprintRuntime,
            updatedAt: nextMeta?.updatedAt ?? null
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
        const lockInspection = await this.#inspectProfileLock(lock, profileDir);
        const orphanRecovered = lock.ownerRunId !== input.runId && lockInspection.orphanRecoverable;
        const stopOwnerRunId = orphanRecovered ? lock.ownerRunId : input.runId;
        if (lock.ownerRunId !== input.runId && !orphanRecovered) {
            throw new CliError("ERR_PROFILE_OWNER_CONFLICT", "runtime.stop run_id 与 profile 锁所有者不一致", { retryable: false });
        }
        let session = buildRuntimeSession(input.profile, existingMeta);
        session = {
            ...session,
            ownerRunId: stopOwnerRunId
        };
        const requestedExecutionMode = readRequestedExecutionMode(input.params);
        const fingerprintRuntime = buildFingerprintContextForMeta(input.profile, existingMeta, {
            requestedExecutionMode
        });
        try {
            const stopping = beginStopSession(session, {
                runId: stopOwnerRunId,
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
            const pinnedControllerPid = typeof lock.controllerPid === "number"
                ? lock.controllerPid
                : lock.ownerPid;
            const stalePinnedController = lock.controllerPidState === "stale";
            if (browserState &&
                (browserState.runId !== stopOwnerRunId ||
                    browserState.controllerPid !== pinnedControllerPid)) {
                throw new CliError("ERR_RUNTIME_UNAVAILABLE", "浏览器实例状态与当前锁所有者不一致，无法安全停止 live runtime", {
                    retryable: true
                });
            }
            const shutdownControllerPid = !stalePinnedController
                ? pinnedControllerPid
                : browserState?.controllerPid ?? null;
            const controllerAlive = typeof shutdownControllerPid === "number" && this.#isProcessAlive(shutdownControllerPid);
            const browserPidAlive = browserState &&
                browserState.runId === stopOwnerRunId &&
                this.#isProcessAlive(browserState.browserPid);
            if (stalePinnedController &&
                browserState &&
                browserPidAlive) {
                await this.#terminateProcess(browserState.browserPid);
                await this.#deleteBrowserStateFiles(profileDir);
            }
            else if (!controllerAlive &&
                browserState &&
                browserPidAlive) {
                await this.#terminateProcess(browserState.browserPid);
                await this.#deleteBrowserStateFiles(profileDir);
            }
            else if (stalePinnedController && controllerAlive) {
                throw new CliError("ERR_RUNTIME_UNAVAILABLE", "缺少锁定的浏览器控制者，无法安全停止 live runtime", {
                    retryable: true
                });
            }
            else if (typeof shutdownControllerPid === "number") {
                await this.#browserLauncher.shutdown({
                    profileDir,
                    controllerPid: shutdownControllerPid,
                    runId: stopOwnerRunId
                });
            }
            else {
                throw new CliError("ERR_RUNTIME_UNAVAILABLE", "缺少可验证的浏览器控制者，无法安全停止 live runtime", {
                    retryable: true
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
            orphanRecovered,
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
            controllerPid: ownerPid,
            controllerPidState: "live",
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
                    controllerPid: typeof existingLock.controllerPid === "number"
                        ? existingLock.controllerPid
                        : existingLock.ownerPid,
                    controllerPidState: existingLock.controllerPidState ?? "live",
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
            const parsed = this.#parseBrowserInstanceState(raw);
            if (parsed === null) {
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
    #parseBrowserInstanceState(raw) {
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.runId !== "string" ||
                !Number.isInteger(parsed.controllerPid) ||
                !Number.isInteger(parsed.browserPid)) {
                return null;
            }
            return {
                ...parsed,
                runId: parsed.runId,
                controllerPid: parsed.controllerPid,
                browserPid: parsed.browserPid
            };
        }
        catch {
            return null;
        }
    }
    async #rebindActiveRuntimeOwnership(input) {
        const statePath = join(input.profileDir, BROWSER_STATE_FILENAME);
        let stateRaw;
        try {
            stateRaw = await this.#lockFileAdapter.readFile(statePath, "utf8");
        }
        catch {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", "浏览器实例状态缺失，无法安全接管 live runtime", {
                retryable: true
            });
        }
        const parsedState = this.#parseBrowserInstanceState(stateRaw);
        const pinnedControllerPid = typeof input.lock.controllerPid === "number"
            ? input.lock.controllerPid
            : input.lock.ownerPid;
        if (parsedState === null ||
            parsedState.runId !== input.lock.ownerRunId ||
            parsedState.controllerPid !== pinnedControllerPid) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", "浏览器实例状态与当前锁所有者不一致，无法安全接管", {
                retryable: true
            });
        }
        const nextState = {
            ...parsedState,
            runId: input.nextRunId
        };
        const nextLock = {
            ...input.lock,
            ownerPid: input.nextOwnerPid,
            ownerRunId: input.nextRunId,
            lastHeartbeatAt: input.nowIso
        };
        if (!input.orphanRecoverable) {
            nextLock.controllerPid = parsedState.controllerPid;
            nextLock.controllerPidState = "live";
        }
        else {
            nextLock.controllerPid = parsedState.controllerPid;
            nextLock.controllerPidState = "stale";
        }
        await this.#lockFileAdapter.writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
        try {
            await this.#writeLock(input.lockPath, nextLock);
        }
        catch (error) {
            await this.#lockFileAdapter.writeFile(statePath, stateRaw, "utf8").catch(() => undefined);
            throw error;
        }
        return nextLock;
    }
    async #inspectProfileLock(lock, profileDir) {
        return inspectProfileLock({
            lock,
            browserInstanceState: await this.#readBrowserInstanceState(profileDir),
            isProcessAlive: this.#isProcessAlive
        });
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
            persistentExtensionBinding: patch.persistentExtensionBinding === null
                ? undefined
                : patch.persistentExtensionBinding ?? current.persistentExtensionBinding,
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
    async #deliverRuntimeBootstrap(input) {
        const bridge = this.#bridgeFactory();
        const envelope = buildRuntimeBootstrapEnvelope({
            profile: input.profile,
            runId: input.runtimeInput.runId,
            runtimeContextId: buildRuntimeBootstrapContextId(input.profile, input.runtimeInput.runId),
            fingerprintRuntime: input.fingerprintRuntime,
            mainWorldSecret: randomUUID()
        });
        try {
            const result = await bridge.runCommand({
                runId: input.runtimeInput.runId,
                profile: input.profile,
                cwd: input.runtimeInput.cwd,
                command: "runtime.bootstrap",
                params: envelope
            });
            if (!result.ok) {
                throw this.#buildRuntimeBootstrapCliError(result);
            }
            const payload = asResultRecord(result.payload);
            const ackResult = asResultRecord(payload?.result);
            const ackVersion = typeof ackResult?.version === "string" ? ackResult.version : null;
            const status = typeof ackResult?.status === "string" ? ackResult.status : null;
            const ackRunId = typeof ackResult?.run_id === "string" ? ackResult.run_id : null;
            const ackContextId = typeof ackResult?.runtime_context_id === "string" ? ackResult.runtime_context_id : null;
            const ackProfile = typeof ackResult?.profile === "string" ? ackResult.profile : null;
            if (status !== "ready" ||
                ackVersion !== envelope.version ||
                ackRunId !== envelope.run_id ||
                ackContextId !== envelope.runtime_context_id ||
                ackProfile !== envelope.profile) {
                throw new CliError(status === "stale"
                    ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
                    : "ERR_RUNTIME_READY_SIGNAL_CONFLICT", status === "stale"
                    ? "runtime bootstrap 返回了陈旧 ack"
                    : "runtime bootstrap ack 与当前运行上下文不一致");
            }
            return {
                identityBindingState: "bound",
                transportState: "ready",
                bootstrapState: "ready",
                runtimeReadiness: "ready",
                details: {
                    runtime_context_id: envelope.runtime_context_id
                }
            };
        }
        catch (error) {
            if (error instanceof CliError) {
                return mapBootstrapCliErrorToReadiness(error);
            }
            if (error instanceof NativeMessagingTransportError) {
                return {
                    identityBindingState: "bound",
                    ...mapTransportErrorToReadiness(error)
                };
            }
            throw error;
        }
    }
    async #readRuntimeReadiness(input) {
        const baseIdentity = input.identityPreflight.identityBindingState;
        if (input.identityPreflight.mode !== "official_chrome_persistent_extension") {
            return buildNonPersistentRuntimeReadiness({
                identityBindingState: baseIdentity,
                lockHeld: input.lockHeld,
                profileState: input.profileState
            });
        }
        if (!input.lockHeld) {
            if (baseIdentity === "bound" &&
                input.observedRunId &&
                (input.profileState === "ready" || input.profileState === "disconnected")) {
                const readiness = await this.#readPersistentRuntimeReadiness({
                    ...input,
                    runtimeInput: {
                        ...input.runtimeInput,
                        runId: input.observedRunId
                    },
                    lockHeld: true,
                    observedRunId: undefined
                });
                return {
                    ...readiness,
                    runtimeReadiness: input.profileState === "disconnected"
                        ? readiness.bootstrapState === "stale" ||
                            readiness.transportState === "not_connected"
                            ? "blocked"
                            : "recoverable"
                        : buildRuntimeReadiness({
                            lockHeld: false,
                            identityBindingState: readiness.identityBindingState,
                            transportState: readiness.transportState,
                            bootstrapState: readiness.bootstrapState
                        })
                };
            }
            return buildUnlockedPersistentRuntimeReadiness({
                identityBindingState: baseIdentity,
                profileState: input.profileState
            });
        }
        if (baseIdentity !== "bound") {
            return buildBoundlessRuntimeReadiness({
                identityBindingState: baseIdentity,
                lockHeld: input.lockHeld
            });
        }
        return this.#readPersistentRuntimeReadiness(input);
    }
    async #readPersistentRuntimeReadiness(input) {
        const baseIdentity = input.identityPreflight.identityBindingState;
        const bridge = this.#bridgeFactory();
        const runtimeContextId = buildRuntimeBootstrapContextId(input.runtimeInput.profile, input.runtimeInput.runId);
        try {
            const result = await bridge.runCommand({
                runId: input.runtimeInput.runId,
                profile: input.runtimeInput.profile,
                cwd: input.runtimeInput.cwd,
                command: "runtime.readiness",
                params: {
                    run_id: input.runtimeInput.runId,
                    runtime_context_id: runtimeContextId
                }
            });
            if (!result.ok) {
                throw this.#buildRuntimeBootstrapCliError(result);
            }
            const payload = asResultRecord(result.payload);
            return mapRuntimeReadinessPayload({
                payload,
                identityBindingState: baseIdentity,
                lockHeld: input.lockHeld
            });
        }
        catch (error) {
            if (error instanceof NativeMessagingTransportError) {
                return {
                    identityBindingState: baseIdentity,
                    ...mapTransportErrorToReadiness(error)
                };
            }
            if (error instanceof CliError) {
                return mapBootstrapCliErrorToReadiness(error, baseIdentity);
            }
            throw error;
        }
    }
    #buildRuntimeBootstrapCliError(result) {
        if (result.ok) {
            return new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "runtime bootstrap 未送达");
        }
        const code = result.error.code;
        if (code === "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED" ||
            code === "ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT" ||
            code === "ERR_RUNTIME_BOOTSTRAP_ACK_STALE" ||
            code === "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH" ||
            code === "ERR_RUNTIME_READY_SIGNAL_CONFLICT") {
            return new CliError(code, result.error.message, {
                retryable: code !== "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH"
            });
        }
        return new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", result.error.message, {
            retryable: true
        });
    }
    async #runIdentityPreflight(input) {
        return runIdentityPreflight({
            params: input.input.params,
            meta: input.meta,
            profileDir: input.profileDir
        });
    }
    #buildMinimalProfileMeta(input) {
        return {
            schemaVersion: 1,
            profileName: input.profile,
            profileDir: input.profileDir,
            profileState: "uninitialized",
            proxyBinding: null,
            fingerprintSeeds: {
                audioNoiseSeed: `${input.profile}-audio-seed`,
                canvasNoiseSeed: `${input.profile}-canvas-seed`
            },
            localStorageSnapshots: [],
            createdAt: input.nowIso,
            updatedAt: input.nowIso,
            lastStartedAt: null,
            lastLoginAt: null,
            lastStoppedAt: null,
            lastDisconnectedAt: null
        };
    }
}
