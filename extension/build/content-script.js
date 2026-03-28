import { ContentScriptHandler, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret } from "./content-script-handler.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
export { ContentScriptHandler };
const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
const EXTENSION_BOOTSTRAP_FILENAME = "__webenvoy_fingerprint_bootstrap.json";
const STARTUP_TRUST_SOURCE = "extension_bootstrap_context";
const MAIN_WORLD_SECRET_NAMESPACE = "webenvoy.main_world.secret.v1";
const STAGED_STARTUP_TRUST_RUN_ID = undefined;
const STAGED_STARTUP_TRUST_SESSION_ID = undefined;
const STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME = undefined;
const normalizeForwardMessage = (request) => ({
    kind: "forward",
    id: request.id,
    runId: typeof request.runId === "string" ? request.runId : request.id,
    tabId: typeof request.tabId === "number" && Number.isInteger(request.tabId) ? request.tabId : null,
    profile: typeof request.profile === "string" ? request.profile : null,
    cwd: typeof request.cwd === "string" ? request.cwd : "",
    timeoutMs: typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? Math.floor(request.timeoutMs)
        : 30_000,
    command: typeof request.command === "string" ? request.command : "",
    params: typeof request.params === "object" && request.params !== null
        ? request.params
        : {},
    commandParams: typeof request.commandParams === "object" && request.commandParams !== null
        ? request.commandParams
        : {},
    fingerprintContext: ensureFingerprintRuntimeContext(request.fingerprintContext ??
        (typeof request.commandParams === "object" &&
            request.commandParams !== null &&
            "fingerprint_context" in request.commandParams
            ? request.commandParams.fingerprint_context
            : null))
});
const readBootstrapFingerprintContext = () => globalThis[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] ?? null;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
const hashMainWorldSecret = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `mwsec_${(hash >>> 0).toString(36)}`;
};
const stableSerializeForSecret = (value, seen = new WeakSet()) => {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : '"NaN"';
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerializeForSecret(item, seen)).join(",")}]`;
    }
    if (typeof value !== "object") {
        return JSON.stringify(String(value));
    }
    if (seen.has(value)) {
        return '"[Circular]"';
    }
    seen.add(value);
    const record = value;
    const keys = Object.keys(record).sort();
    const body = keys
        .map((key) => `${JSON.stringify(key)}:${stableSerializeForSecret(record[key], seen)}`)
        .join(",");
    seen.delete(value);
    return `{${body}}`;
};
const resolveExplicitMainWorldSecret = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return asNonEmptyString(record.main_world_secret ??
        record.mainWorldSecret ??
        record.main_world_bridge_secret ??
        record.mainWorldBridgeSecret);
};
const deriveMainWorldSecretFromBootstrapPayload = (value) => {
    const explicit = resolveExplicitMainWorldSecret(value);
    if (explicit) {
        return explicit;
    }
    if (value === null || value === undefined) {
        return null;
    }
    const serialized = stableSerializeForSecret(value);
    if (serialized.length === 0) {
        return null;
    }
    return hashMainWorldSecret(`${MAIN_WORLD_SECRET_NAMESPACE}|${serialized}`);
};
const resolveBootstrapFingerprintContext = (value) => {
    const mainWorldSecret = deriveMainWorldSecretFromBootstrapPayload(value);
    const record = asRecord(value);
    const stagedRunId = asNonEmptyString(STAGED_STARTUP_TRUST_RUN_ID);
    const stagedSessionId = asNonEmptyString(STAGED_STARTUP_TRUST_SESSION_ID);
    const stagedFingerprintRuntime = ensureFingerprintRuntimeContext(STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME);
    const runId = asNonEmptyString(record?.run_id ?? record?.runId) ?? stagedRunId;
    const runtimeContextId = asNonEmptyString(record?.runtime_context_id ?? record?.runtimeContextId);
    const sessionId = asNonEmptyString(record?.session_id ?? record?.sessionId) ?? stagedSessionId;
    const direct = ensureFingerprintRuntimeContext(value);
    if (direct) {
        return {
            fingerprintRuntime: direct,
            runId,
            runtimeContextId,
            sessionId,
            mainWorldSecret
        };
    }
    if (!record) {
        return {
            fingerprintRuntime: stagedFingerprintRuntime,
            runId,
            runtimeContextId,
            sessionId,
            mainWorldSecret: null
        };
    }
    return {
        fingerprintRuntime: ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null) ?? stagedFingerprintRuntime,
        runId,
        runtimeContextId,
        sessionId,
        mainWorldSecret
    };
};
const sanitizeScopePart = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
const resolveRunToken = (normalized, runId) => {
    if (typeof runId === "string" && runId.trim().length > 0) {
        return sanitizeScopePart(runId.trim());
    }
    const record = asRecord(normalized);
    const directRunId = record?.runId ?? record?.run_id;
    if (typeof directRunId === "string" && directRunId.trim().length > 0) {
        return sanitizeScopePart(directRunId.trim());
    }
    return "run_unknown";
};
const buildExecutionScopeToken = (normalized) => {
    const execution = asRecord(asRecord(normalized)?.execution ?? null);
    if (!execution) {
        return "execution_unknown";
    }
    const liveDecision = typeof execution.live_decision === "string" ? execution.live_decision : "unknown";
    const allowedModes = Array.isArray(execution.allowed_execution_modes)
        ? execution.allowed_execution_modes
            .filter((mode) => typeof mode === "string")
            .sort()
            .join(",")
        : "";
    const reasonCodes = Array.isArray(execution.reason_codes)
        ? execution.reason_codes
            .filter((code) => typeof code === "string")
            .sort()
            .join(",")
        : "";
    const token = `${liveDecision}|${allowedModes}|${reasonCodes}`;
    return sanitizeScopePart(token.length > 0 ? token : "execution_unknown");
};
const buildScopedCacheKey = (normalized, runId) => {
    const profile = sanitizeScopePart(normalized.profile);
    const runToken = resolveRunToken(normalized, runId);
    const executionToken = buildExecutionScopeToken(normalized);
    return `${FINGERPRINT_CONTEXT_CACHE_KEY}:${profile}:${runToken}:${executionToken}`;
};
const getExtensionStorageArea = () => {
    const chromeApi = globalThis.chrome;
    const storage = chromeApi?.storage;
    if (!storage) {
        return null;
    }
    const area = storage.session ?? storage.local ?? null;
    if (!area || typeof area.get !== "function" || typeof area.set !== "function") {
        return null;
    }
    return area;
};
const persistExtensionFingerprintContext = (normalized, runId) => {
    // Keep fingerprint runtime context in extension-private storage only.
    // Never mirror it to page-readable sessionStorage/localStorage.
    const storageArea = getExtensionStorageArea();
    if (!storageArea || typeof storageArea.set !== "function") {
        return;
    }
    const scopedKey = buildScopedCacheKey(normalized, runId);
    try {
        const maybePromise = storageArea.set({
            [scopedKey]: normalized
        });
        if (maybePromise && typeof maybePromise.catch === "function") {
            void maybePromise.catch(() => undefined);
        }
    }
    catch {
        // ignore cache failures
    }
};
const loadBootstrapFingerprintContextFromExtension = async (runtime) => {
    const bootstrapUrl = typeof runtime.getURL === "function" ? runtime.getURL(EXTENSION_BOOTSTRAP_FILENAME) : null;
    if (!bootstrapUrl || typeof fetch !== "function") {
        return {
            fingerprintRuntime: null,
            runId: null,
            runtimeContextId: null,
            sessionId: null,
            mainWorldSecret: null
        };
    }
    try {
        const response = await fetch(bootstrapUrl);
        if (!response.ok) {
            return {
                fingerprintRuntime: null,
                runId: null,
                runtimeContextId: null,
                sessionId: null,
                mainWorldSecret: null
            };
        }
        const envelope = asRecord(await response.json());
        const resolved = resolveBootstrapFingerprintContext(envelope?.extension_bootstrap ?? envelope ?? null);
        return {
            fingerprintRuntime: resolved.fingerprintRuntime,
            runId: resolved.runId ?? asNonEmptyString(envelope?.run_id ?? envelope?.runId),
            runtimeContextId: resolved.runtimeContextId ??
                asNonEmptyString(envelope?.runtime_context_id ?? envelope?.runtimeContextId),
            sessionId: resolved.sessionId ?? asNonEmptyString(envelope?.session_id ?? envelope?.sessionId),
            mainWorldSecret: resolved.mainWorldSecret
        };
    }
    catch {
        return {
            fingerprintRuntime: null,
            runId: null,
            runtimeContextId: null,
            sessionId: null,
            mainWorldSecret: null
        };
    }
};
const installStartupFingerprintPatch = (fingerprintRuntime) => {
    void installFingerprintRuntimeViaMainWorld(fingerprintRuntime).catch(() => {
        // ignore install failures; startup trust must not rely on main-world response
    });
};
const emitStartupFingerprintTrust = (runtime, input) => {
    if (!input.runId || !input.runtimeContextId || !input.sessionId) {
        return;
    }
    runtime.sendMessage?.({
        kind: "result",
        id: `startup-fingerprint-trust:${input.runId}`,
        ok: true,
        payload: {
            startup_fingerprint_trust: {
                run_id: input.runId,
                runtime_context_id: input.runtimeContextId,
                profile: input.fingerprintRuntime.profile,
                session_id: input.sessionId,
                fingerprint_runtime: input.fingerprintRuntime,
                trust_source: STARTUP_TRUST_SOURCE,
                bootstrap_attested: true,
                main_world_result_used_for_trust: false
            }
        }
    });
};
export const bootstrapContentScript = (runtime) => {
    if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
        return false;
    }
    const handler = new ContentScriptHandler();
    const bootstrapPayload = readBootstrapFingerprintContext();
    const bootstrapInput = resolveBootstrapFingerprintContext(bootstrapPayload);
    installMainWorldEventChannelSecret(bootstrapInput.mainWorldSecret);
    const bootstrapContext = bootstrapInput.fingerprintRuntime;
    if (bootstrapContext) {
        persistExtensionFingerprintContext(bootstrapContext, bootstrapInput.runId);
        installStartupFingerprintPatch(bootstrapContext);
        emitStartupFingerprintTrust(runtime, {
            runId: bootstrapInput.runId,
            runtimeContextId: bootstrapInput.runtimeContextId,
            sessionId: bootstrapInput.sessionId,
            fingerprintRuntime: bootstrapContext
        });
        if (!bootstrapInput.runId || !bootstrapInput.runtimeContextId || !bootstrapInput.sessionId) {
            void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
                if (!resolvedBootstrap.runId ||
                    !resolvedBootstrap.runtimeContextId ||
                    !resolvedBootstrap.sessionId) {
                    return;
                }
                emitStartupFingerprintTrust(runtime, {
                    runId: resolvedBootstrap.runId,
                    runtimeContextId: resolvedBootstrap.runtimeContextId,
                    sessionId: resolvedBootstrap.sessionId,
                    fingerprintRuntime: bootstrapContext
                });
            });
        }
    }
    else {
        void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
            installMainWorldEventChannelSecret(resolvedBootstrap.mainWorldSecret);
            if (!resolvedBootstrap.fingerprintRuntime) {
                return;
            }
            persistExtensionFingerprintContext(resolvedBootstrap.fingerprintRuntime, resolvedBootstrap.runId);
            installStartupFingerprintPatch(resolvedBootstrap.fingerprintRuntime);
            emitStartupFingerprintTrust(runtime, {
                runId: resolvedBootstrap.runId,
                runtimeContextId: resolvedBootstrap.runtimeContextId,
                sessionId: resolvedBootstrap.sessionId,
                fingerprintRuntime: resolvedBootstrap.fingerprintRuntime
            });
        });
    }
    handler.onResult((message) => {
        runtime.sendMessage?.(message);
    });
    runtime.onMessage.addListener((message) => {
        const request = message;
        if (!request || request.kind !== "forward" || typeof request.id !== "string") {
            return;
        }
        const normalized = normalizeForwardMessage(request);
        if (normalized.fingerprintContext) {
            persistExtensionFingerprintContext(normalized.fingerprintContext, normalized.runId);
        }
        const accepted = handler.onBackgroundMessage(normalized);
        if (!accepted) {
            runtime.sendMessage?.({
                kind: "result",
                id: request.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script unreachable"
                }
            });
        }
    });
    return true;
};
const globalChrome = globalThis.chrome;
const runtime = globalChrome?.runtime;
const isLikelyContentScriptEnv = typeof window !== "undefined" && typeof document !== "undefined";
if (isLikelyContentScriptEnv && runtime) {
    bootstrapContentScript(runtime);
}
