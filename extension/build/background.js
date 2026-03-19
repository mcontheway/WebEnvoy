const defaultForwardTimeoutMs = 3_000;
const defaultNativeHostName = "com.webenvoy.host";
const maxRecoveryQueuedForwards = 5;
const readTimeoutMs = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    if (value < 1) {
        return null;
    }
    return Math.floor(value);
};
export class BackgroundRelay {
    contentScript;
    #listeners = new Set();
    #pending = new Map();
    #sessionId = "nm-session-001";
    #forwardTimeoutMs;
    constructor(contentScript, options) {
        this.contentScript = contentScript;
        this.#forwardTimeoutMs = options?.forwardTimeoutMs ?? defaultForwardTimeoutMs;
        this.contentScript.onResult((message) => {
            this.#onContentResult(message);
        });
    }
    onNativeMessage(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    onNativeRequest(request) {
        if (request.method === "bridge.open") {
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    protocol: "webenvoy.native-bridge.v1",
                    state: "ready",
                    session_id: this.#sessionId
                },
                error: null
            });
            return;
        }
        if (request.method === "__ping__") {
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: this.#sessionId
                },
                error: null
            });
            return;
        }
        if (request.method !== "bridge.forward") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported method: ${request.method}`
                }
            });
            return;
        }
        const timeoutMs = readTimeoutMs(request.timeout_ms) ?? this.#forwardTimeoutMs;
        const timeout = setTimeout(() => {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_TIMEOUT",
                message: "content script forward timed out"
            });
        }, timeoutMs);
        this.#pending.set(request.id, { request, timeout });
        const forward = {
            kind: "forward",
            id: request.id,
            runId: String(request.params.run_id ?? request.id),
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: String(request.params.cwd ?? ""),
            timeoutMs,
            command: String(request.params.command ?? ""),
            params: typeof request.params === "object" && request.params !== null
                ? { ...request.params }
                : {},
            commandParams: typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {}
        };
        try {
            const accepted = this.contentScript.onBackgroundMessage(forward);
            if (!accepted) {
                this.#failPending(request.id, {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script unreachable"
                });
            }
        }
        catch {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: "content script dispatch failed"
            });
        }
    }
    #onContentResult(message) {
        const pending = this.#pending.get(message.id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(message.id);
        const request = pending.request;
        if (!message.ok) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: message.error ?? {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script failed"
                }
            });
            return;
        }
        this.#emit({
            id: request.id,
            status: "success",
            summary: {
                session_id: String(request.params.session_id ?? this.#sessionId),
                run_id: String(request.params.run_id ?? request.id),
                command: String(request.params.command ?? "runtime.ping"),
                profile: typeof request.profile === "string" ? request.profile : null,
                cwd: String(request.params.cwd ?? ""),
                relay_path: "host>background>content-script>background>host"
            },
            payload: message.payload ?? {},
            error: null
        });
    }
    #failPending(id, error) {
        const pending = this.#pending.get(id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(id);
        this.#emit({
            id: pending.request.id,
            status: "error",
            summary: {
                relay_path: "host>background>content-script>background>host"
            },
            error
        });
    }
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
class ChromeBackgroundBridge {
    chromeApi;
    options;
    #port = null;
    #pending = new Map();
    #recoveryQueue = [];
    #heartbeatTimer = null;
    #heartbeatTimeout = null;
    #recoveryTimer = null;
    #recoveryDeadlineMs = null;
    #pendingHeartbeatId = null;
    #heartbeatSeq = 0;
    #missedHeartbeatCount = 0;
    #state = "connecting";
    constructor(chromeApi, options) {
        this.chromeApi = chromeApi;
        this.options = options;
    }
    start() {
        this.#connectNativePort();
        this.chromeApi.runtime.onMessage.addListener((message, sender) => {
            this.#onContentScriptResult(message, sender);
        });
        this.chromeApi.runtime.onInstalled?.addListener(() => this.#connectNativePort());
        this.chromeApi.runtime.onStartup?.addListener(() => this.#connectNativePort());
    }
    #connectNativePort() {
        if (this.#port && this.#state !== "recovering" && this.#state !== "disconnected") {
            return;
        }
        if (this.#port) {
            this.#disposeCurrentPort();
        }
        const hostName = this.options?.nativeHostName ?? defaultNativeHostName;
        const port = this.chromeApi.runtime.connectNative(hostName);
        this.#port = port;
        this.#state = "connecting";
        this.#missedHeartbeatCount = 0;
        this.#pendingHeartbeatId = null;
        this.#clearHeartbeatTimeout();
        port.onMessage.addListener((message) => {
            if (this.#port !== port) {
                return;
            }
            void this.#onNativeMessage(message);
        });
        port.onDisconnect.addListener(() => {
            if (this.#port !== port) {
                return;
            }
            this.#handleDisconnect("native messaging disconnected");
        });
        this.#startHeartbeatLoop();
    }
    #startHeartbeatLoop() {
        if (this.#heartbeatTimer) {
            return;
        }
        const intervalMs = this.options?.heartbeatIntervalMs ?? 20_000;
        this.#heartbeatTimer = setInterval(() => {
            this.#sendHeartbeat();
        }, intervalMs);
    }
    #sendHeartbeat() {
        if (!this.#port || this.#state !== "ready") {
            return;
        }
        if (this.#pendingHeartbeatId) {
            return;
        }
        const timeoutMs = this.options?.heartbeatTimeoutMs ?? 5_000;
        const heartbeat = {
            id: this.#nextHeartbeatId(),
            method: "__ping__",
            profile: null,
            params: {
                session_id: "nm-session-001",
                timestamp: new Date().toISOString()
            },
            timeout_ms: timeoutMs
        };
        this.#pendingHeartbeatId = heartbeat.id;
        this.#port.postMessage(heartbeat);
        this.#clearHeartbeatTimeout();
        this.#heartbeatTimeout = setTimeout(() => {
            if (!this.#pendingHeartbeatId) {
                return;
            }
            this.#pendingHeartbeatId = null;
            this.#missedHeartbeatCount += 1;
            const maxMissed = this.options?.maxMissedHeartbeats ?? 2;
            if (this.#missedHeartbeatCount >= maxMissed) {
                this.#handleDisconnect("heartbeat timeout");
            }
        }, timeoutMs);
    }
    #handleDisconnect(message) {
        this.#clearHeartbeatTimeout();
        this.#pendingHeartbeatId = null;
        this.#missedHeartbeatCount = 0;
        this.#failAllPending({
            code: "ERR_TRANSPORT_DISCONNECTED",
            message
        });
        this.#disposeCurrentPort();
        this.#enterRecovery(message);
    }
    async #onNativeMessage(message) {
        const heartbeatAck = message;
        if (heartbeatAck &&
            typeof heartbeatAck.id === "string" &&
            heartbeatAck.id === this.#pendingHeartbeatId &&
            (heartbeatAck.method === "__ping__" ||
                heartbeatAck.method === "__pong__" ||
                heartbeatAck.status === "success")) {
            this.#pendingHeartbeatId = null;
            this.#missedHeartbeatCount = 0;
            this.#clearHeartbeatTimeout();
            return;
        }
        const request = message;
        await this.#onNativeRequest(request);
    }
    #clearHeartbeatTimeout() {
        if (!this.#heartbeatTimeout) {
            return;
        }
        clearTimeout(this.#heartbeatTimeout);
        this.#heartbeatTimeout = null;
    }
    #disposeCurrentPort() {
        const current = this.#port;
        this.#port = null;
        if (!current) {
            return;
        }
        try {
            current.disconnect?.();
        }
        catch {
            // ignore teardown errors from stale ports
        }
    }
    #enterRecovery(message) {
        const recoveryWindowMs = this.options?.recoveryWindowMs ?? 30_000;
        this.#state = "recovering";
        this.#recoveryDeadlineMs = Date.now() + recoveryWindowMs;
        this.#startRecoveryLoop();
    }
    #startRecoveryLoop() {
        const retryIntervalMs = this.options?.recoveryRetryIntervalMs ?? 1_000;
        if (this.#recoveryTimer) {
            return;
        }
        const tick = () => {
            if (this.#state !== "recovering" && this.#state !== "connecting") {
                return;
            }
            const deadline = this.#recoveryDeadlineMs;
            if (deadline !== null && Date.now() >= deadline) {
                this.#state = "disconnected";
                this.#recoveryDeadlineMs = null;
                this.#failRecoveryQueue("recovery window exhausted");
                this.#stopRecoveryLoop();
                return;
            }
            this.#connectNativePort();
        };
        tick();
        this.#recoveryTimer = setInterval(tick, retryIntervalMs);
    }
    #stopRecoveryLoop() {
        if (!this.#recoveryTimer) {
            return;
        }
        clearInterval(this.#recoveryTimer);
        this.#recoveryTimer = null;
    }
    #nextHeartbeatId() {
        this.#heartbeatSeq += 1;
        return `bg-hb-${this.#heartbeatSeq.toString().padStart(4, "0")}`;
    }
    async #onNativeRequest(request) {
        if (request.method === "bridge.open") {
            this.#state = "ready";
            this.#recoveryDeadlineMs = null;
            this.#stopRecoveryLoop();
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    protocol: "webenvoy.native-bridge.v1",
                    state: "ready",
                    session_id: String(request.params.session_id ?? "nm-session-001")
                },
                error: null
            });
            this.#replayRecoveryQueue();
            return;
        }
        if (request.method === "__ping__") {
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: String(request.params.session_id ?? "nm-session-001")
                },
                error: null
            });
            return;
        }
        if (request.method !== "bridge.forward") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported method: ${request.method}`
                }
            });
            return;
        }
        if (this.#state !== "ready") {
            if (this.#isRecoveryWindowOpen()) {
                this.#enqueueRecoveryForward(request);
                return;
            }
            const code = this.#state === "disconnected" ? "ERR_TRANSPORT_DISCONNECTED" : "ERR_TRANSPORT_NOT_READY";
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code,
                    message: code === "ERR_TRANSPORT_DISCONNECTED"
                        ? "native messaging disconnected"
                        : "native bridge is not ready"
                }
            });
            return;
        }
        await this.#dispatchForward(request);
    }
    #isRecoveryWindowOpen() {
        const deadline = this.#recoveryDeadlineMs;
        return deadline !== null && Date.now() < deadline;
    }
    #enqueueRecoveryForward(request) {
        if (this.#recoveryQueue.length >= maxRecoveryQueuedForwards) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_DISCONNECTED",
                    message: `recovery queue exhausted (${maxRecoveryQueuedForwards})`
                }
            });
            return;
        }
        this.#recoveryQueue.push(request);
    }
    async #replayRecoveryQueue() {
        if (this.#recoveryQueue.length === 0) {
            return;
        }
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const request of queued) {
            if (this.#state !== "ready") {
                this.#enqueueRecoveryForward(request);
                continue;
            }
            await this.#dispatchForward(request);
        }
    }
    #failRecoveryQueue(message) {
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const request of queued) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_DISCONNECTED",
                    message
                }
            });
        }
    }
    async #dispatchForward(request) {
        const tabId = await this.#resolveTargetTabId(request);
        if (!tabId) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "target tab is unavailable"
                }
            });
            return;
        }
        const timeoutMs = readTimeoutMs(request.timeout_ms) ?? this.options?.forwardTimeoutMs ?? defaultForwardTimeoutMs;
        const timeout = setTimeout(() => {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_TIMEOUT",
                message: "content script forward timed out"
            });
        }, timeoutMs);
        this.#pending.set(request.id, { request, timeout });
        const forward = {
            kind: "forward",
            id: request.id,
            runId: String(request.params.run_id ?? request.id),
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: String(request.params.cwd ?? ""),
            timeoutMs,
            command: String(request.params.command ?? ""),
            params: typeof request.params === "object" && request.params !== null
                ? { ...request.params }
                : {},
            commandParams: typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {}
        };
        try {
            await this.chromeApi.tabs.sendMessage(tabId, forward);
        }
        catch {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: "content script dispatch failed"
            });
        }
    }
    #onContentScriptResult(message, sender) {
        const result = message;
        if (!result || result.kind !== "result" || typeof result.id !== "string") {
            return;
        }
        const pending = this.#pending.get(result.id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(result.id);
        const request = pending.request;
        if (result.ok !== true) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: result.error ?? {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script failed"
                }
            });
            return;
        }
        this.#emit({
            id: request.id,
            status: "success",
            summary: {
                session_id: String(request.params.session_id ?? "nm-session-001"),
                run_id: String(request.params.run_id ?? request.id),
                command: String(request.params.command ?? "runtime.ping"),
                profile: typeof request.profile === "string" ? request.profile : null,
                cwd: String(request.params.cwd ?? ""),
                tab_id: sender.tab?.id ?? null,
                relay_path: "host>background>content-script>background>host"
            },
            payload: typeof result.payload === "object" && result.payload !== null
                ? result.payload
                : {},
            error: null
        });
    }
    async #resolveTargetTabId(request) {
        if (typeof request.params.tab_id === "number" && Number.isInteger(request.params.tab_id)) {
            return request.params.tab_id;
        }
        const tabs = await this.chromeApi.tabs.query({
            active: true,
            currentWindow: true
        });
        const first = tabs[0];
        return typeof first?.id === "number" ? first.id : null;
    }
    #failPending(id, error) {
        const pending = this.#pending.get(id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(id);
        this.#emit({
            id,
            status: "error",
            summary: {
                relay_path: "host>background>content-script>background>host"
            },
            error
        });
    }
    #failAllPending(error) {
        for (const [id] of this.#pending.entries()) {
            this.#failPending(id, error);
        }
    }
    #emit(message) {
        this.#port?.postMessage(message);
    }
}
export const startChromeBackgroundBridge = (chromeApi, options) => {
    const bridge = new ChromeBackgroundBridge(chromeApi, options);
    bridge.start();
};
const chromeApi = globalThis.chrome;
if (chromeApi?.runtime?.connectNative) {
    startChromeBackgroundBridge(chromeApi);
}
