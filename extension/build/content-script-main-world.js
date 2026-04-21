import { WEBENVOY_SYNTHETIC_REQUEST_HEADER, resolveActiveVisitedPageContextNamespace, resolveMainWorldPageContextNamespaceEventName } from "./xhs-search-types.js";
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
export const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const DEFAULT_MAIN_WORLD_CALL_TIMEOUT_MS = 5_000;
let mainWorldEventChannel = null;
let mainWorldResultListener = null;
let mainWorldResultListenerEventName = null;
let latestMainWorldPageContextNamespace = null;
let mainWorldPageContextNamespaceListener = null;
let mainWorldPageContextNamespaceListenerEventName = null;
const pendingMainWorldRequests = new Map();
const encodeUtf8Base64 = (value) => {
    if (typeof btoa === "function") {
        return btoa(unescape(encodeURIComponent(value)));
    }
    const bufferCtor = globalThis.Buffer;
    if (bufferCtor) {
        return bufferCtor.from(value, "utf8").toString("base64");
    }
    throw new Error("base64 encoder is unavailable");
};
export const encodeMainWorldPayload = (value) => encodeUtf8Base64(JSON.stringify(value));
const hashMainWorldEventChannel = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};
const normalizeMainWorldSecret = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const createMainWorldBootstrapDetail = (secret) => {
    const names = resolveMainWorldEventNamesForSecret(secret);
    return {
        request_event: names.requestEvent,
        result_event: names.resultEvent,
        namespace_event: names.namespaceEvent
    };
};
const emitMainWorldBootstrap = (secret) => {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
        return;
    }
    window.dispatchEvent(createWindowEvent(MAIN_WORLD_EVENT_BOOTSTRAP, createMainWorldBootstrapDetail(secret)));
};
export const resolveMainWorldEventNamesForSecret = (secret) => {
    const hashed = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
    return {
        requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${hashed}`,
        resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${hashed}`,
        namespaceEvent: resolveMainWorldPageContextNamespaceEventName(secret)
    };
};
const createWindowEvent = (type, detail) => {
    const CustomEventCtor = globalThis.CustomEvent;
    if (typeof CustomEventCtor === "function") {
        return new CustomEventCtor(type, { detail });
    }
    return { type, detail };
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const installMainWorldPageContextNamespaceListener = (eventName) => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return;
    }
    if (mainWorldPageContextNamespaceListener &&
        mainWorldPageContextNamespaceListenerEventName === eventName) {
        return;
    }
    if (mainWorldPageContextNamespaceListener && mainWorldPageContextNamespaceListenerEventName) {
        try {
            window.removeEventListener(mainWorldPageContextNamespaceListenerEventName, mainWorldPageContextNamespaceListener);
        }
        catch {
            // noop in contract environments
        }
    }
    mainWorldPageContextNamespaceListener = ((event) => {
        const detail = asRecord(event.detail);
        const namespace = detail?.page_context_namespace;
        if (typeof namespace === "string" && namespace.length > 0) {
            latestMainWorldPageContextNamespace = namespace;
        }
    });
    mainWorldPageContextNamespaceListenerEventName = eventName;
    window.addEventListener(eventName, mainWorldPageContextNamespaceListener);
};
const onMainWorldResultEvent = (event) => {
    const detail = (event.detail ?? null);
    if (!detail || typeof detail.id !== "string") {
        return;
    }
    const pending = pendingMainWorldRequests.get(detail.id);
    if (!pending) {
        return;
    }
    clearTimeout(pending.timeout);
    pendingMainWorldRequests.delete(detail.id);
    if (detail.ok === true) {
        pending.resolve(detail.result);
        return;
    }
    const message = typeof detail.message === "string" ? detail.message : "main world call failed";
    const error = new Error(message);
    if (typeof detail.error_name === "string" && detail.error_name.length > 0) {
        error.name = detail.error_name;
    }
    if (typeof detail.error_code === "string" && detail.error_code.length > 0) {
        error.code = detail.error_code;
    }
    pending.reject(error);
};
const detachMainWorldResultListener = () => {
    if (!mainWorldResultListener || !mainWorldResultListenerEventName) {
        return;
    }
    try {
        window.removeEventListener(mainWorldResultListenerEventName, mainWorldResultListener);
    }
    catch {
        // noop in contract environments
    }
    mainWorldResultListener = null;
    mainWorldResultListenerEventName = null;
};
export const installMainWorldEventChannelSecret = (secret) => {
    const normalizedSecret = normalizeMainWorldSecret(secret);
    if (typeof window === "undefined" ||
        typeof window.addEventListener !== "function" ||
        typeof window.dispatchEvent !== "function") {
        detachMainWorldResultListener();
        mainWorldEventChannel = null;
        return false;
    }
    if (!normalizedSecret) {
        detachMainWorldResultListener();
        mainWorldEventChannel = null;
        return false;
    }
    const names = resolveMainWorldEventNamesForSecret(normalizedSecret);
    installMainWorldPageContextNamespaceListener(names.namespaceEvent);
    if (mainWorldEventChannel?.secret === normalizedSecret &&
        mainWorldResultListenerEventName === names.resultEvent) {
        return true;
    }
    detachMainWorldResultListener();
    window.addEventListener(names.resultEvent, onMainWorldResultEvent);
    mainWorldEventChannel = {
        secret: normalizedSecret,
        requestEvent: names.requestEvent,
        resultEvent: names.resultEvent,
        namespaceEvent: names.namespaceEvent
    };
    mainWorldResultListener = onMainWorldResultEvent;
    mainWorldResultListenerEventName = names.resultEvent;
    emitMainWorldBootstrap(normalizedSecret);
    return true;
};
export const resetMainWorldEventChannelForContract = () => {
    for (const pending of pendingMainWorldRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("main world request reset"));
    }
    pendingMainWorldRequests.clear();
    latestMainWorldPageContextNamespace = null;
    if (mainWorldPageContextNamespaceListener &&
        mainWorldPageContextNamespaceListenerEventName &&
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function") {
        try {
            window.removeEventListener(mainWorldPageContextNamespaceListenerEventName, mainWorldPageContextNamespaceListener);
        }
        catch {
            // noop in contract environments
        }
    }
    mainWorldPageContextNamespaceListener = null;
    mainWorldPageContextNamespaceListenerEventName = null;
    detachMainWorldResultListener();
    mainWorldEventChannel = null;
};
const mainWorldCall = async (request) => {
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `mw-${Date.now()}`;
    return await new Promise((resolve, reject) => {
        if (!mainWorldEventChannel ||
            typeof window === "undefined" ||
            typeof window.dispatchEvent !== "function") {
            reject(new Error("main world event channel unavailable"));
            return;
        }
        emitMainWorldBootstrap(mainWorldEventChannel.secret);
        const responseTimeoutMs = DEFAULT_MAIN_WORLD_CALL_TIMEOUT_MS;
        const timeout = setTimeout(() => {
            pendingMainWorldRequests.delete(requestId);
            reject(new Error("main world event channel response timeout"));
        }, responseTimeoutMs);
        pendingMainWorldRequests.set(requestId, {
            resolve: (value) => resolve(value),
            reject,
            timeout
        });
        const requestDetail = {
            id: requestId,
            ...request
        };
        try {
            window.dispatchEvent(createWindowEvent(mainWorldEventChannel.requestEvent, requestDetail));
        }
        catch (error) {
            clearTimeout(timeout);
            pendingMainWorldRequests.delete(requestId);
            reject(error);
        }
    });
};
export const installFingerprintRuntimeViaMainWorld = async (fingerprintRuntime) => await mainWorldCall({
    type: "fingerprint-install",
    payload: {
        fingerprint_runtime: fingerprintRuntime
    }
});
export const verifyFingerprintRuntimeViaMainWorld = async () => await mainWorldCall({
    type: "fingerprint-verify",
    payload: {}
});
export const readPageStateViaMainWorld = async () => {
    const result = await mainWorldCall({
        type: "page-state-read",
        payload: {}
    });
    return typeof result === "object" && result !== null && !Array.isArray(result)
        ? result
        : null;
};
const asCapturedRequestContextLookupResult = (value) => {
    const record = asRecord(value);
    if (!record ||
        typeof record.page_context_namespace !== "string" ||
        typeof record.shape_key !== "string" ||
        !Array.isArray(record.available_shape_keys)) {
        return null;
    }
    return {
        page_context_namespace: record.page_context_namespace,
        shape_key: record.shape_key,
        admitted_template: asRecord(record.admitted_template),
        rejected_observation: asRecord(record.rejected_observation),
        incompatible_observation: asRecord(record.incompatible_observation),
        available_shape_keys: record.available_shape_keys.filter((item) => typeof item === "string")
    };
};
export const readCapturedRequestContextViaMainWorld = async (input) => {
    if (mainWorldEventChannel?.namespaceEvent) {
        installMainWorldPageContextNamespaceListener(mainWorldEventChannel.namespaceEvent);
    }
    const pageContextNamespace = resolveActiveVisitedPageContextNamespace(input.page_context_namespace, latestMainWorldPageContextNamespace);
    const result = await mainWorldCall({
        type: "captured-request-context-read",
        payload: {
            method: input.method,
            path: input.path,
            ...(pageContextNamespace ? { page_context_namespace: pageContextNamespace } : {}),
            shape_key: input.shape_key
        }
    });
    const normalized = asCapturedRequestContextLookupResult(result);
    if (!normalized ||
        resolveActiveVisitedPageContextNamespace(input.page_context_namespace, normalized.page_context_namespace) !== normalized.page_context_namespace ||
        normalized.shape_key !== input.shape_key) {
        return null;
    }
    if (typeof normalized.page_context_namespace === "string" &&
        normalized.page_context_namespace.length > 0) {
        latestMainWorldPageContextNamespace = normalized.page_context_namespace;
    }
    return normalized;
};
const resolveMainWorldRequestUrl = (value) => {
    const baseHref = typeof globalThis.location?.href === "string" && globalThis.location.href.length > 0
        ? globalThis.location.href
        : "https://www.xiaohongshu.com/";
    return new URL(value, baseHref).toString();
};
export const requestXhsSearchJsonViaMainWorld = async (input) => {
    const runtime = globalThis.chrome?.runtime;
    const sendMessage = runtime?.sendMessage;
    if (!sendMessage) {
        throw new Error("extension runtime.sendMessage is unavailable");
    }
    const request = {
        kind: "xhs-main-world-request",
        url: resolveMainWorldRequestUrl(input.url),
        method: input.method,
        headers: {
            ...input.headers,
            [WEBENVOY_SYNTHETIC_REQUEST_HEADER]: "1"
        },
        ...(typeof input.body === "string" ? { body: input.body } : {}),
        timeout_ms: input.timeoutMs,
        ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
        ...(typeof input.referrerPolicy === "string"
            ? { referrerPolicy: input.referrerPolicy }
            : {})
    };
    const response = await new Promise((resolve, reject) => {
        try {
            const maybePromise = sendMessage(request, (message) => {
                resolve(message ?? { ok: false, error: { message: "xhs main-world response missing" } });
            });
            if (maybePromise && typeof maybePromise.then === "function") {
                void maybePromise
                    .then((message) => {
                    if (message) {
                        resolve(message);
                    }
                })
                    .catch((error) => {
                    reject(error);
                });
            }
        }
        catch (error) {
            reject(error);
        }
    });
    if (!response.ok || !response.result) {
        const error = new Error(typeof response.error?.message === "string"
            ? response.error.message
            : "xhs main-world request failed");
        if (typeof response.error?.name === "string" && response.error.name.length > 0) {
            error.name = response.error.name;
        }
        throw error;
    }
    return response.result;
};
