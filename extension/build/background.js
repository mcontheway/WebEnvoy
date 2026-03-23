const defaultForwardTimeoutMs = 3_000;
const defaultHandshakeTimeoutMs = 30_000;
const defaultNativeHostName = "com.webenvoy.host";
const bridgeProtocol = "webenvoy.native-bridge.v1";
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
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_DOMAIN_ALLOWLIST = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_high_risk",
    "live_write"
]);
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const parseUrl = (value) => {
    try {
        return new URL(value);
    }
    catch {
        return null;
    }
};
const classifyXhsPage = (url, domain) => {
    const parsed = parseUrl(url);
    if (!parsed) {
        return "unknown_tab";
    }
    const pathname = parsed.pathname;
    if (domain === XHS_READ_DOMAIN) {
        if (pathname.includes("/search_result")) {
            return "search_result_tab";
        }
        if (pathname.includes("/explore/")) {
            return "explore_detail_tab";
        }
        if (pathname.includes("/user/profile/")) {
            return "profile_tab";
        }
        if (pathname.includes("/home")) {
            return "home_tab";
        }
        return "read_unknown_tab";
    }
    if (pathname.includes("/publish")) {
        return "creator_publish_tab";
    }
    return "creator_home_tab";
};
const xhsGateReasonMessage = (reason) => {
    const mapping = {
        REQUESTED_EXECUTION_MODE_NOT_EXPLICIT: "requested_execution_mode must be explicit",
        LIVE_EXECUTION_MODE_BLOCKED_BY_BACKGROUND_GATE: "live execution mode is blocked by background target gate",
        TARGET_DOMAIN_NOT_EXPLICIT: "target domain must be explicit",
        TARGET_DOMAIN_OUT_OF_SCOPE: "target domain is out of xhs read/write scope",
        TARGET_TAB_NOT_EXPLICIT: "target tab is not explicit",
        TARGET_PAGE_NOT_EXPLICIT: "target page is not explicit",
        ACTION_DOMAIN_MISMATCH: "read action cannot target write domain",
        TARGET_TAB_NOT_FOUND: "target tab is unavailable",
        TARGET_DOMAIN_MISMATCH: "target tab domain does not match target_domain",
        TARGET_PAGE_MISMATCH: "target tab page does not match target_page",
        TARGET_TAB_URL_INVALID: "target tab url is invalid"
    };
    return mapping[reason] ?? "xhs target gate blocked";
};
const parseRequestedExecutionMode = (value) => typeof value === "string" && XHS_EXECUTION_MODES.has(value)
    ? value
    : null;
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
                payload: message.payload ?? {},
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
    #handshakeTimeout = null;
    #recoveryTimer = null;
    #recoveryDeadlineMs = null;
    #pendingHeartbeatId = null;
    #pendingHandshakeId = null;
    #sessionId = "nm-session-001";
    #heartbeatSeq = 0;
    #handshakeSeq = 0;
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
        this.#clearHandshakeTimeout();
        this.#pendingHandshakeId = null;
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
        this.#sendHandshakeOpen(port);
        this.#startHeartbeatLoop();
    }
    #sendHandshakeOpen(port) {
        const timeoutMs = this.options?.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
        const request = {
            id: this.#nextHandshakeId(),
            method: "bridge.open",
            profile: null,
            params: {
                protocol: bridgeProtocol,
                capabilities: ["relay", "heartbeat"]
            },
            timeout_ms: timeoutMs
        };
        this.#pendingHandshakeId = request.id;
        port.postMessage(request);
        this.#clearHandshakeTimeout();
        this.#handshakeTimeout = setTimeout(() => {
            if (this.#port !== port || this.#pendingHandshakeId !== request.id) {
                return;
            }
            this.#pendingHandshakeId = null;
            this.#handleDisconnect("handshake timeout");
        }, timeoutMs);
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
                session_id: this.#sessionId,
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
        this.#clearHandshakeTimeout();
        this.#pendingHandshakeId = null;
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
        const handshakeResponse = message;
        if (handshakeResponse &&
            typeof handshakeResponse.id === "string" &&
            handshakeResponse.id === this.#pendingHandshakeId &&
            (handshakeResponse.status === "success" || handshakeResponse.status === "error")) {
            this.#onHandshakeResponse(handshakeResponse);
            return;
        }
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
    #onHandshakeResponse(response) {
        this.#clearHandshakeTimeout();
        this.#pendingHandshakeId = null;
        if (response.status !== "success") {
            const message = response.error?.message ?? "handshake failed";
            this.#handleDisconnect(`handshake failed: ${message}`);
            return;
        }
        const protocol = typeof response.summary.protocol === "string" ? response.summary.protocol : null;
        if (protocol !== bridgeProtocol) {
            this.#handleDisconnect(`incompatible protocol: ${protocol ?? "unknown"}`);
            return;
        }
        const sessionId = typeof response.summary.session_id === "string" && response.summary.session_id.length > 0
            ? response.summary.session_id
            : this.#sessionId;
        this.#sessionId = sessionId;
        this.#state = "ready";
        this.#recoveryDeadlineMs = null;
        this.#stopRecoveryLoop();
        void this.#replayRecoveryQueue();
    }
    #clearHeartbeatTimeout() {
        if (!this.#heartbeatTimeout) {
            return;
        }
        clearTimeout(this.#heartbeatTimeout);
        this.#heartbeatTimeout = null;
    }
    #clearHandshakeTimeout() {
        if (!this.#handshakeTimeout) {
            return;
        }
        clearTimeout(this.#handshakeTimeout);
        this.#handshakeTimeout = null;
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
            this.#expireQueuedForwards(Date.now());
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
    #nextHandshakeId() {
        this.#handshakeSeq += 1;
        return `bg-open-${this.#handshakeSeq.toString().padStart(4, "0")}`;
    }
    async #onNativeRequest(request) {
        if (request.method === "bridge.open") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_HANDSHAKE_FAILED",
                    message: "bridge.open must be initiated by extension/background"
                }
            });
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
        const timeoutMs = this.#resolveForwardTimeoutMs(request);
        const deadlineMs = Date.now() + timeoutMs;
        if (Date.now() >= deadlineMs) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_TIMEOUT",
                    message: "forward request timed out during recovery"
                }
            });
            return;
        }
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
        this.#recoveryQueue.push({
            request,
            deadlineMs
        });
    }
    async #replayRecoveryQueue() {
        if (this.#recoveryQueue.length === 0) {
            return;
        }
        this.#expireQueuedForwards(Date.now());
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const queuedForward of queued) {
            const request = queuedForward.request;
            if (Date.now() >= queuedForward.deadlineMs) {
                this.#emit({
                    id: request.id,
                    status: "error",
                    summary: {
                        relay_path: "host>background>content-script>background>host"
                    },
                    error: {
                        code: "ERR_TRANSPORT_TIMEOUT",
                        message: "forward request timed out during recovery"
                    }
                });
                continue;
            }
            if (this.#state !== "ready") {
                this.#recoveryQueue.push(queuedForward);
                continue;
            }
            await this.#dispatchForward(request, queuedForward.deadlineMs);
        }
    }
    #failRecoveryQueue(message) {
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const queuedForward of queued) {
            const request = queuedForward.request;
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
    #expireQueuedForwards(nowMs) {
        if (this.#recoveryQueue.length === 0) {
            return;
        }
        const keep = [];
        for (const queuedForward of this.#recoveryQueue) {
            if (nowMs < queuedForward.deadlineMs) {
                keep.push(queuedForward);
                continue;
            }
            this.#emit({
                id: queuedForward.request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_TIMEOUT",
                    message: "forward request timed out during recovery"
                }
            });
        }
        this.#recoveryQueue = keep;
    }
    async #dispatchForward(request, deadlineMs) {
        const requestDeadlineMs = deadlineMs ?? Date.now() + this.#resolveForwardTimeoutMs(request);
        const command = String(request.params.command ?? "");
        let tabId;
        let consumerGateResult;
        if (command === "xhs.search") {
            const gateResult = await this.#evaluateXhsTargetGate(request);
            consumerGateResult = gateResult.consumerGateResult;
            if (!gateResult.allowed || !gateResult.targetTabId) {
                this.#emit({
                    id: request.id,
                    status: "error",
                    summary: {
                        relay_path: "host>background>content-script>background>host"
                    },
                    payload: {
                        consumer_gate_result: gateResult.consumerGateResult
                    },
                    error: {
                        code: "ERR_TRANSPORT_FORWARD_FAILED",
                        message: gateResult.errorMessage
                    }
                });
                return;
            }
            tabId = gateResult.targetTabId;
        }
        else {
            tabId = await this.#resolveTargetTabId(request);
        }
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
        const timeoutMs = requestDeadlineMs - Date.now();
        if (timeoutMs <= 0) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_TIMEOUT",
                    message: "forward request timed out during recovery"
                }
            });
            return;
        }
        const forwardTimeoutMs = Math.max(1, Math.floor(timeoutMs));
        const timeout = setTimeout(() => {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_TIMEOUT",
                message: "content script forward timed out"
            });
        }, forwardTimeoutMs);
        this.#pending.set(request.id, { request, timeout, consumerGateResult });
        const forward = {
            kind: "forward",
            id: request.id,
            runId: String(request.params.run_id ?? request.id),
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: String(request.params.cwd ?? ""),
            timeoutMs: forwardTimeoutMs,
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
    async #evaluateXhsTargetGate(request) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const optionParams = asRecord(commandParams.options);
        const readGateParam = (key) => {
            if (Object.prototype.hasOwnProperty.call(commandParams, key)) {
                return commandParams[key];
            }
            return optionParams?.[key];
        };
        const rawTargetDomain = readGateParam("target_domain");
        const rawTargetTabId = readGateParam("target_tab_id");
        const rawTargetPage = readGateParam("target_page");
        const rawRequestedExecutionMode = readGateParam("requested_execution_mode");
        const targetDomain = typeof rawTargetDomain === "string" && rawTargetDomain.trim().length > 0
            ? rawTargetDomain.trim()
            : null;
        const targetTabId = typeof rawTargetTabId === "number" && Number.isInteger(rawTargetTabId)
            ? rawTargetTabId
            : null;
        const targetPage = typeof rawTargetPage === "string" && rawTargetPage.trim().length > 0
            ? rawTargetPage.trim()
            : null;
        const actionType = "read";
        const requestedExecutionMode = parseRequestedExecutionMode(rawRequestedExecutionMode);
        const effectiveExecutionMode = requestedExecutionMode === "recon" ? "recon" : "dry_run";
        const gateReasons = [];
        if (!requestedExecutionMode) {
            gateReasons.push("REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
        }
        else if (requestedExecutionMode === "live_read_high_risk" ||
            requestedExecutionMode === "live_write") {
            gateReasons.push("LIVE_EXECUTION_MODE_BLOCKED_BY_BACKGROUND_GATE");
        }
        if (!targetDomain) {
            gateReasons.push("TARGET_DOMAIN_NOT_EXPLICIT");
        }
        else if (!XHS_DOMAIN_ALLOWLIST.has(targetDomain)) {
            gateReasons.push("TARGET_DOMAIN_OUT_OF_SCOPE");
        }
        if (targetTabId === null) {
            gateReasons.push("TARGET_TAB_NOT_EXPLICIT");
        }
        if (!targetPage) {
            gateReasons.push("TARGET_PAGE_NOT_EXPLICIT");
        }
        if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
            gateReasons.push("ACTION_DOMAIN_MISMATCH");
        }
        if (gateReasons.length === 0 && targetDomain && targetTabId !== null && targetPage) {
            const domainTabs = await this.chromeApi.tabs.query({
                url: `*://${targetDomain}/*`
            });
            const targetTab = domainTabs.find((tab) => tab.id === targetTabId);
            if (!targetTab) {
                gateReasons.push("TARGET_TAB_NOT_FOUND");
            }
            else {
                const tabUrl = typeof targetTab.url === "string" ? targetTab.url : "";
                const parsed = parseUrl(tabUrl);
                if (!parsed) {
                    gateReasons.push("TARGET_TAB_URL_INVALID");
                }
                else {
                    if (parsed.hostname !== targetDomain) {
                        gateReasons.push("TARGET_DOMAIN_MISMATCH");
                    }
                    const actualPage = classifyXhsPage(tabUrl, targetDomain);
                    if (actualPage !== targetPage) {
                        gateReasons.push("TARGET_PAGE_MISMATCH");
                    }
                }
            }
        }
        const allowed = gateReasons.length === 0;
        const gateDecision = allowed ? "allowed" : "blocked";
        const consumerGateResult = {
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            effective_execution_mode: effectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: gateReasons
        };
        return {
            allowed,
            targetTabId: allowed ? targetTabId : null,
            errorMessage: allowed ? "" : xhsGateReasonMessage(gateReasons[0] ?? "TARGET_TAB_NOT_EXPLICIT"),
            consumerGateResult
        };
    }
    #resolveForwardTimeoutMs(request) {
        return (readTimeoutMs(request.timeout_ms) ??
            this.options?.forwardTimeoutMs ??
            defaultForwardTimeoutMs);
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
        const payload = typeof result.payload === "object" && result.payload !== null
            ? { ...result.payload }
            : {};
        if (pending.consumerGateResult) {
            payload.consumer_gate_result = pending.consumerGateResult;
        }
        if (result.ok !== true) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                payload,
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
            payload,
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
