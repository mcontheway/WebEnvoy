import { ContentScriptHandler } from "./content-script-handler.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
export { ContentScriptHandler };
const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
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
const readWindowCachedFingerprintContext = () => {
    if (typeof window === "undefined") {
        return null;
    }
    try {
        const raw = window.sessionStorage?.getItem(FINGERPRINT_CONTEXT_CACHE_KEY) ?? null;
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
};
const readBootstrapFingerprintContext = () => globalThis[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] ?? null;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const normalizeFingerprintRuntimeContextInput = (value) => {
    const direct = ensureFingerprintRuntimeContext(value);
    if (direct) {
        return direct;
    }
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null);
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
const persistWindowFingerprintContext = (normalized, runId) => {
    if (typeof window === "undefined") {
        return;
    }
    const scopedKey = buildScopedCacheKey(normalized, runId);
    try {
        window.sessionStorage?.setItem(scopedKey, JSON.stringify(normalized));
        window.sessionStorage?.removeItem(FINGERPRINT_CONTEXT_CACHE_KEY);
    }
    catch {
        // ignore cache failures (quota, privacy mode, etc.)
    }
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
const readExtensionCachedFingerprintContext = async (scopedKey) => {
    const storageArea = getExtensionStorageArea();
    const storageGet = storageArea?.get;
    if (typeof storageGet !== "function") {
        return null;
    }
    return await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) {
                return;
            }
            settled = true;
            resolve(null);
        }, 50);
        const finish = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        try {
            const maybePromise = storageGet([scopedKey], (items) => finish(items?.[scopedKey] ?? null));
            if (maybePromise && typeof maybePromise.then === "function") {
                maybePromise
                    .then((items) => finish(items?.[scopedKey] ?? null))
                    .catch(() => finish(null));
            }
        }
        catch {
            finish(null);
        }
    });
};
const persistExtensionFingerprintContext = (normalized, runId) => {
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
export const bootstrapContentScript = (runtime) => {
    if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
        return false;
    }
    const handler = new ContentScriptHandler();
    let bootstrapInstalled = false;
    let bootstrapScopeKey = null;
    const installBootstrapFingerprintPatch = (fingerprintContext) => {
        if (bootstrapInstalled) {
            return;
        }
        const normalizedContext = normalizeFingerprintRuntimeContextInput(fingerprintContext);
        if (!normalizedContext) {
            return;
        }
        bootstrapScopeKey = buildScopedCacheKey(normalizedContext, null);
        bootstrapInstalled = true;
        handler.onBackgroundMessage(normalizeForwardMessage({
            id: "__webenvoy-bootstrap-fingerprint__",
            runId: "__webenvoy-bootstrap-fingerprint__",
            command: "runtime.ping",
            commandParams: {},
            params: {},
            timeoutMs: 1_000,
            cwd: "",
            fingerprintContext: normalizedContext
        }));
    };
    installBootstrapFingerprintPatch(readBootstrapFingerprintContext());
    if (bootstrapScopeKey) {
        const windowCachedContext = readWindowCachedFingerprintContext();
        if (windowCachedContext !== null) {
            const normalizedWindowContext = normalizeFingerprintRuntimeContextInput(windowCachedContext);
            if (normalizedWindowContext &&
                buildScopedCacheKey(normalizedWindowContext, null) === bootstrapScopeKey) {
                installBootstrapFingerprintPatch(windowCachedContext);
            }
        }
        void readExtensionCachedFingerprintContext(bootstrapScopeKey).then((cachedContext) => {
            installBootstrapFingerprintPatch(cachedContext);
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
            persistWindowFingerprintContext(normalized.fingerprintContext, normalized.runId);
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
