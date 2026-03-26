import { WRITE_INTERACTION_TIER, APPROVAL_CHECK_KEYS, EXECUTION_MODES, buildRiskTransitionAudit, buildUnifiedRiskStateOutput, getIssueActionMatrixEntry, getWriteActionMatrixDecisions, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../shared/risk-state.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
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
const STARTUP_TRUST_ALLOWLIST_URLS = [`*://${XHS_READ_DOMAIN}/*`, `*://${XHS_WRITE_DOMAIN}/*`];
const XHS_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODES = new Set(EXECUTION_MODES);
const XHS_LIVE_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_WRITE_APPROVAL_REQUIREMENTS = [
    "approval_record_approved_true",
    "approval_record_approver_present",
    "approval_record_approved_at_present",
    "approval_record_checks_all_true"
];
const XHS_READ_EXECUTION_POLICY = {
    default_mode: "dry_run",
    allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    blocked_actions: ["expand_new_live_surface_without_gate"],
    live_entry_requirements: [
        "gate_input_risk_state_limited_or_allowed",
        "risk_state_checked",
        "target_domain_confirmed",
        "target_tab_confirmed",
        "target_page_confirmed",
        "action_type_confirmed",
        "approval_record_approved_true",
        "approval_record_approver_present",
        "approval_record_approved_at_present",
        "approval_record_checks_all_true"
    ]
};
const XHS_SCOPE_CONTEXT = {
    platform: "xhs",
    read_domain: XHS_READ_DOMAIN,
    write_domain: XHS_WRITE_DOMAIN,
    domain_mixing_forbidden: true
};
const XHS_GATE_CONTRACT_MARKERS = {
    recovery_requirements: "recovery_requirements",
    session_rhythm_policy: "session_rhythm_policy",
    session_rhythm: "session_rhythm"
};
const STARTUP_TRUST_SOURCE = "extension_bootstrap_context";
const MAX_TRUSTED_FINGERPRINT_CONTEXTS = 64;
const XHS_PLUGIN_GATE_OWNERSHIP = {
    background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
    content_script_gate: ["page_context_check", "action_tier_check"],
    main_world_gate: ["signed_call_scope_check"],
    cli_role: "request_and_result_shell_only"
};
const scoreXhsTab = (tab) => {
    const url = typeof tab.url === "string" ? tab.url : "";
    if (url.includes("/search_result")) {
        return 0;
    }
    if (url.includes("/explore/")) {
        return 1;
    }
    if (url.includes("/user/profile/")) {
        return 2;
    }
    return 3;
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const resolveFingerprintContext = (commandParams) => {
    const context = ensureFingerprintRuntimeContext(commandParams.fingerprint_context);
    return context ? { ...context } : null;
};
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asBoolean = (value) => value === true;
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
        ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX: "requested action is blocked by issue/state matrix",
        ISSUE_ACTION_MATRIX_BLOCKED: "requested action is blocked by issue/state matrix",
        TARGET_DOMAIN_NOT_EXPLICIT: "target domain must be explicit",
        TARGET_DOMAIN_OUT_OF_SCOPE: "target domain is out of xhs read/write scope",
        TARGET_TAB_NOT_EXPLICIT: "target tab is not explicit",
        TARGET_PAGE_NOT_EXPLICIT: "target page is not explicit",
        ACTION_DOMAIN_MISMATCH: "read action cannot target write domain",
        EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND: "execution mode is unsupported for xhs.search",
        WRITE_EXECUTION_GATE_ONLY: "write gate approved but execution remains gate-only",
        RISK_STATE_PAUSED: "risk state paused blocks live read",
        RISK_STATE_LIMITED: "risk state limited blocks high-risk live read",
        MANUAL_CONFIRMATION_MISSING: "manual confirmation is required for live mode",
        APPROVAL_CHECKS_INCOMPLETE: "approval checks are incomplete",
        FINGERPRINT_CONTEXT_MISSING: "fingerprint context is required for live execution",
        FINGERPRINT_CONTEXT_UNTRUSTED: "fingerprint context is not trusted for current run/profile",
        TARGET_TAB_NOT_FOUND: "target tab is unavailable",
        TARGET_DOMAIN_MISMATCH: "target tab domain does not match target_domain",
        TARGET_PAGE_MISMATCH: "target tab page does not match target_page",
        TARGET_TAB_URL_INVALID: "target tab url is invalid",
        FINGERPRINT_EXECUTION_BLOCKED: "fingerprint runtime blocks live execution for this profile"
    };
    return mapping[reason] ?? "xhs target gate blocked";
};
const parseRequestedExecutionMode = (value) => typeof value === "string" && XHS_EXECUTION_MODES.has(value)
    ? value
    : null;
const parseActionType = (value) => typeof value === "string" && XHS_ACTION_TYPES.has(value)
    ? value
    : null;
const resolveRiskState = (value) => resolveSharedRiskState(value);
const resolveIssueScope = (value) => resolveSharedIssueScope(value);
const normalizeApprovalRecord = (value) => {
    const approval = asRecord(value);
    const checks = asRecord(approval?.checks);
    return {
        approved: asBoolean(approval?.approved),
        approver: asNonEmptyString(approval?.approver),
        approved_at: asNonEmptyString(approval?.approved_at),
        checks: Object.fromEntries(XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checks?.[key])]))
    };
};
const resolveIssueActionMatrixEntry = (issueScope, state) => {
    return getIssueActionMatrixEntry(issueScope, state);
};
const resolveWriteMatrixDecision = (output, state) => output.decisions.find((entry) => entry.state === state) ?? {
    state,
    decision: "blocked",
    requires: []
};
const resolveApprovalRequirementGaps = (requirements, approvalRecord) => {
    const gaps = [];
    for (const requirement of requirements) {
        if (requirement === "approval_record_approved_true") {
            if (!approvalRecord.approved) {
                gaps.push(requirement);
            }
            continue;
        }
        if (requirement === "approval_record_approver_present") {
            if (!approvalRecord.approver) {
                gaps.push(requirement);
            }
            continue;
        }
        if (requirement === "approval_record_approved_at_present") {
            if (!approvalRecord.approved_at) {
                gaps.push(requirement);
            }
            continue;
        }
        if (requirement === "approval_record_checks_all_true") {
            const allChecksComplete = XHS_REQUIRED_APPROVAL_CHECKS.every((key) => approvalRecord.checks[key]);
            if (!allChecksComplete) {
                gaps.push(requirement);
            }
            continue;
        }
        gaps.push(requirement);
    }
    return gaps;
};
const resolveBlockedFallbackMode = (requestedExecutionMode, riskState) => requestedExecutionMode === "recon"
    ? "recon"
    : requestedExecutionMode === "live_write"
        ? "dry_run"
        : riskState === "limited"
            ? "recon"
            : "dry_run";
const buildTrustedFingerprintContextKey = (profile, sessionId) => `${profile}::${sessionId}`;
const serializeFingerprintRuntimeContext = (fingerprintRuntime) => JSON.stringify(fingerprintRuntime);
const isFingerprintRuntimeContextEquivalent = (left, right) => serializeFingerprintRuntimeContext(left) === serializeFingerprintRuntimeContext(right);
const TRUST_INVALIDATION_COMMANDS = new Set(["runtime.stop", "runtime.start", "runtime.login"]);
// Trust must come from startup trust bound to an allowlist page, not generic bridge commands.
const TRUST_PRIMING_COMMANDS = new Set();
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
        const commandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
            ? request.params.command_params
            : {};
        const forward = {
            kind: "forward",
            id: request.id,
            runId: String(request.params.run_id ?? request.id),
            tabId: typeof request.params.tab_id === "number" && Number.isInteger(request.params.tab_id)
                ? request.params.tab_id
                : String(request.params.command ?? "") === "xhs.search"
                    ? 32
                    : null,
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: String(request.params.cwd ?? ""),
            timeoutMs,
            command: String(request.params.command ?? ""),
            params: typeof request.params === "object" && request.params !== null
                ? { ...request.params }
                : {},
            commandParams,
            fingerprintContext: resolveFingerprintContext(commandParams)
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
            ...(pending.gatePayload ? { payload: { ...pending.gatePayload } } : {}),
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
    #trustedFingerprintContexts = new Map();
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
        this.chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (this.#isXhsSignRequestMessage(message)) {
                void this.#handleXhsSignRequest(message, sender, sendResponse);
                return true;
            }
            this.#onContentScriptResult(message, sender);
            return undefined;
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
        this.#clearTrustedFingerprintContexts();
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
        const prevSessionId = this.#sessionId;
        const sessionId = typeof response.summary.session_id === "string" && response.summary.session_id.length > 0
            ? response.summary.session_id
            : this.#sessionId;
        this.#sessionId = sessionId;
        if (sessionId !== prevSessionId) {
            this.#clearTrustedFingerprintContexts();
        }
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
    #clearTrustedFingerprintContexts() {
        if (this.#trustedFingerprintContexts.size === 0) {
            return;
        }
        this.#trustedFingerprintContexts.clear();
    }
    #clearTrustedFingerprintContextBySession(profile, sessionId) {
        this.#trustedFingerprintContexts.delete(buildTrustedFingerprintContextKey(profile, sessionId));
    }
    #clearTrustedFingerprintContextsByProfile(profile) {
        const profilePrefix = `${profile}::`;
        for (const key of this.#trustedFingerprintContexts.keys()) {
            if (key.startsWith(profilePrefix)) {
                this.#trustedFingerprintContexts.delete(key);
            }
        }
    }
    #invalidateTrustedFingerprintContextForCommand(request, command) {
        if (!TRUST_INVALIDATION_COMMANDS.has(command)) {
            return;
        }
        const profile = asNonEmptyString(request.profile);
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        if (command === "runtime.stop") {
            if (profile) {
                this.#clearTrustedFingerprintContextBySession(profile, sessionId);
                return;
            }
            this.#clearTrustedFingerprintContexts();
            return;
        }
        if (profile) {
            this.#clearTrustedFingerprintContextsByProfile(profile);
            return;
        }
        this.#clearTrustedFingerprintContexts();
    }
    #rememberTrustedFingerprintContext(request, payload, ok) {
        if (!ok) {
            return;
        }
        const command = String(request.params.command ?? "");
        if (!TRUST_PRIMING_COMMANDS.has(command)) {
            return;
        }
        const profile = asNonEmptyString(request.profile);
        if (!profile) {
            return;
        }
        const fingerprintRuntime = ensureFingerprintRuntimeContext(payload.fingerprint_runtime ?? null);
        if (!fingerprintRuntime) {
            return;
        }
        if (fingerprintRuntime.profile !== profile) {
            return;
        }
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        this.#upsertTrustedFingerprintContext(profile, sessionId, fingerprintRuntime);
    }
    async #resolveStartupTrustSenderBinding(sender) {
        const tabId = asInteger(sender.tab?.id);
        if (tabId === null) {
            return null;
        }
        const senderUrl = asNonEmptyString(sender.tab?.url ?? sender.url);
        if (senderUrl) {
            const parsedSenderUrl = parseUrl(senderUrl);
            if (!parsedSenderUrl || !XHS_DOMAIN_ALLOWLIST.has(parsedSenderUrl.hostname)) {
                return null;
            }
            return {
                tabId,
                domain: parsedSenderUrl.hostname
            };
        }
        const allowlistTabs = await this.chromeApi.tabs.query({
            url: STARTUP_TRUST_ALLOWLIST_URLS
        });
        const senderTab = allowlistTabs.find((tab) => tab.id === tabId);
        const senderTabUrl = typeof senderTab?.url === "string" ? senderTab.url : "";
        const parsedTabUrl = parseUrl(senderTabUrl);
        if (!parsedTabUrl || !XHS_DOMAIN_ALLOWLIST.has(parsedTabUrl.hostname)) {
            return null;
        }
        return {
            tabId,
            domain: parsedTabUrl.hostname
        };
    }
    #resolveRequestTargetBinding(request) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const options = asRecord(commandParams.options);
        const readTarget = (key) => Object.prototype.hasOwnProperty.call(commandParams, key)
            ? commandParams[key]
            : options?.[key];
        const targetTabId = asInteger(readTarget("target_tab_id"));
        const targetDomain = asNonEmptyString(readTarget("target_domain"));
        if (targetTabId === null || !targetDomain || !XHS_DOMAIN_ALLOWLIST.has(targetDomain)) {
            return null;
        }
        return {
            tabId: targetTabId,
            domain: targetDomain
        };
    }
    async #rememberStartupTrustedFingerprintContext(payload, sender) {
        const startupTrust = asRecord(payload.startup_fingerprint_trust);
        if (!startupTrust) {
            return;
        }
        const trustSource = asNonEmptyString(startupTrust.trust_source ?? startupTrust.source);
        if (trustSource !== STARTUP_TRUST_SOURCE) {
            return;
        }
        if (startupTrust.bootstrap_attested !== true) {
            return;
        }
        if (startupTrust.main_world_result_used_for_trust === true) {
            return;
        }
        const profile = asNonEmptyString(startupTrust.profile);
        if (!profile) {
            return;
        }
        const fingerprintRuntime = ensureFingerprintRuntimeContext(startupTrust.fingerprint_runtime ?? null);
        if (!fingerprintRuntime || fingerprintRuntime.profile !== profile) {
            return;
        }
        const explicitSessionId = asNonEmptyString(startupTrust.session_id ?? startupTrust.sessionId);
        if (!explicitSessionId || explicitSessionId !== this.#sessionId) {
            return;
        }
        const senderBinding = await this.#resolveStartupTrustSenderBinding(sender);
        if (!senderBinding) {
            return;
        }
        this.#upsertTrustedFingerprintContext(profile, explicitSessionId, fingerprintRuntime, {
            sourceTabId: senderBinding.tabId,
            sourceDomain: senderBinding.domain
        });
    }
    #normalizeTrustedFingerprintRuntime(fingerprintRuntime) {
        return {
            profile: fingerprintRuntime.profile,
            source: fingerprintRuntime.source,
            fingerprint_profile_bundle: fingerprintRuntime.fingerprint_profile_bundle
                ? JSON.parse(JSON.stringify(fingerprintRuntime.fingerprint_profile_bundle))
                : null,
            fingerprint_patch_manifest: fingerprintRuntime.fingerprint_patch_manifest
                ? JSON.parse(JSON.stringify(fingerprintRuntime.fingerprint_patch_manifest))
                : null,
            fingerprint_consistency_check: JSON.parse(JSON.stringify(fingerprintRuntime.fingerprint_consistency_check)),
            execution: JSON.parse(JSON.stringify(fingerprintRuntime.execution))
        };
    }
    #upsertTrustedFingerprintContext(profile, sessionId, fingerprintRuntime, source) {
        const normalized = this.#normalizeTrustedFingerprintRuntime(fingerprintRuntime);
        const key = buildTrustedFingerprintContextKey(profile, sessionId);
        const serializedFingerprintRuntime = serializeFingerprintRuntimeContext(normalized);
        const sourceTabId = source?.sourceTabId ?? null;
        const sourceDomain = source?.sourceDomain ?? null;
        const existing = this.#trustedFingerprintContexts.get(key);
        const shouldRotate = !!existing &&
            (existing.sessionId !== sessionId ||
                existing.serializedFingerprintRuntime !== serializedFingerprintRuntime ||
                existing.sourceTabId !== sourceTabId ||
                existing.sourceDomain !== sourceDomain);
        if (shouldRotate) {
            this.#trustedFingerprintContexts.delete(key);
        }
        this.#trustedFingerprintContexts.set(key, {
            sessionId,
            fingerprintRuntime: normalized,
            serializedFingerprintRuntime,
            sourceTabId,
            sourceDomain
        });
        if (this.#trustedFingerprintContexts.size <= MAX_TRUSTED_FINGERPRINT_CONTEXTS) {
            return;
        }
        const oldestKey = this.#trustedFingerprintContexts.keys().next().value;
        if (typeof oldestKey === "string") {
            this.#trustedFingerprintContexts.delete(oldestKey);
        }
    }
    #resolveTrustedFingerprintContext(request) {
        const profile = asNonEmptyString(request.profile);
        if (!profile) {
            return null;
        }
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        const key = buildTrustedFingerprintContextKey(profile, sessionId);
        const trusted = this.#trustedFingerprintContexts.get(key);
        if (!trusted) {
            return null;
        }
        if (trusted.sessionId !== this.#sessionId) {
            this.#trustedFingerprintContexts.delete(key);
            return null;
        }
        return trusted;
    }
    #resolveValidatedTrustedFingerprintContext(request, requestedFingerprintContext) {
        const trustedEntry = this.#resolveTrustedFingerprintContext(request);
        if (!trustedEntry) {
            return null;
        }
        const trusted = trustedEntry.fingerprintRuntime;
        if (requestedFingerprintContext &&
            !isFingerprintRuntimeContextEquivalent(trusted, requestedFingerprintContext)) {
            const profile = asNonEmptyString(request.profile);
            if (profile) {
                const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
                this.#clearTrustedFingerprintContextBySession(profile, sessionId);
            }
            else {
                this.#clearTrustedFingerprintContexts();
            }
            return null;
        }
        const requestTargetBinding = this.#resolveRequestTargetBinding(request);
        if (trustedEntry.sourceTabId !== null &&
            trustedEntry.sourceDomain !== null &&
            (!requestTargetBinding ||
                requestTargetBinding.tabId !== trustedEntry.sourceTabId ||
                requestTargetBinding.domain !== trustedEntry.sourceDomain)) {
            return null;
        }
        return { ...trusted };
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
        this.#invalidateTrustedFingerprintContextForCommand(request, command);
        const commandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
            ? request.params.command_params
            : {};
        const optionParams = asRecord(commandParams.options);
        const requestedExecutionMode = parseRequestedExecutionMode(Object.prototype.hasOwnProperty.call(commandParams, "requested_execution_mode")
            ? commandParams.requested_execution_mode
            : optionParams?.requested_execution_mode);
        const requestedLiveMode = requestedExecutionMode !== null && XHS_LIVE_EXECUTION_MODES.has(requestedExecutionMode);
        const requestedFingerprintContext = resolveFingerprintContext(commandParams);
        const trustedFingerprintContext = command === "xhs.search" && requestedLiveMode
            ? this.#resolveValidatedTrustedFingerprintContext(request, requestedFingerprintContext)
            : null;
        const forwardFingerprintContext = trustedFingerprintContext ?? requestedFingerprintContext;
        let tabId;
        let consumerGateResult;
        let gatePayload;
        if (command === "xhs.search") {
            const gateResult = await this.#evaluateXhsTargetGate(request);
            consumerGateResult = gateResult.consumerGateResult;
            gatePayload = gateResult.gatePayload;
            if (!gateResult.allowed || (!gateResult.targetTabId && !gateResult.gateOnly)) {
                this.#emit({
                    id: request.id,
                    status: "error",
                    summary: {
                        relay_path: "host>background>content-script>background>host"
                    },
                    payload: gateResult.gatePayload,
                    error: {
                        code: "ERR_TRANSPORT_FORWARD_FAILED",
                        message: gateResult.errorMessage
                    }
                });
                return;
            }
            if (gateResult.gateOnly) {
                this.#emit({
                    id: request.id,
                    status: "success",
                    summary: {
                        session_id: String(request.params.session_id ?? "nm-session-001"),
                        run_id: String(request.params.run_id ?? request.id),
                        command: String(request.params.command ?? "xhs.search"),
                        profile: typeof request.profile === "string" ? request.profile : null,
                        cwd: String(request.params.cwd ?? ""),
                        tab_id: null,
                        relay_path: "host>background"
                    },
                    payload: this.#createXhsGateOnlyPayload(request, gateResult.gatePayload),
                    error: null
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
        this.#pending.set(request.id, { request, timeout, consumerGateResult, gatePayload });
        const forward = {
            kind: "forward",
            id: request.id,
            runId: String(request.params.run_id ?? request.id),
            tabId,
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: String(request.params.cwd ?? ""),
            timeoutMs: forwardTimeoutMs,
            command: String(request.params.command ?? ""),
            params: typeof request.params === "object" && request.params !== null
                ? { ...request.params }
                : {},
            commandParams,
            fingerprintContext: forwardFingerprintContext
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
    #createXhsGateOnlyPayload(request, gatePayload) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const ability = asRecord(commandParams.ability) ?? {};
        const input = asRecord(commandParams.input) ?? {};
        const consumerGateResult = asRecord(gatePayload.consumer_gate_result) ?? {};
        return {
            summary: {
                capability_result: {
                    ability_id: String(ability.id ?? "xhs.note.search.v1"),
                    layer: String(ability.layer ?? "L3"),
                    action: String(consumerGateResult.action_type ?? "read"),
                    outcome: "partial",
                    data_ref: {
                        query: String(input.query ?? "")
                    },
                    metrics: {
                        count: 0
                    }
                },
                ...gatePayload
            },
            observability: {
                page_state: null,
                key_requests: [],
                failure_site: null
            }
        };
    }
    #appendGateReason(target, reason) {
        const gateReasons = asStringArray(target.gate_reasons);
        if (!gateReasons.includes(reason)) {
            gateReasons.push(reason);
        }
        target.gate_reasons = gateReasons;
    }
    #backfillExecutionFailureIntoGatePayload(gatePayload, payload) {
        const details = asRecord(payload.details);
        if (!details) {
            return false;
        }
        const stage = asNonEmptyString(details.stage);
        const reason = asNonEmptyString(details.reason);
        if (stage !== "execution" || !reason) {
            return false;
        }
        const requestedExecutionMode = asNonEmptyString(details.requested_execution_mode);
        const missingRequiredPatches = asStringArray(details.missing_required_patches);
        const executionFailure = {
            stage,
            reason,
            ...(requestedExecutionMode ? { requested_execution_mode: requestedExecutionMode } : {}),
            ...(missingRequiredPatches.length > 0
                ? { missing_required_patches: [...missingRequiredPatches] }
                : {})
        };
        const isFingerprintFailure = reason.startsWith("FINGERPRINT_");
        const gateOutcome = asRecord(gatePayload.gate_outcome);
        if (gateOutcome) {
            gateOutcome.gate_decision = "blocked";
            this.#appendGateReason(gateOutcome, reason);
            gateOutcome.execution_failure = { ...executionFailure };
            if (isFingerprintFailure) {
                gateOutcome.fingerprint_gate_decision = "blocked";
            }
        }
        const consumerGateResult = asRecord(gatePayload.consumer_gate_result);
        if (consumerGateResult) {
            consumerGateResult.gate_decision = "blocked";
            this.#appendGateReason(consumerGateResult, reason);
            consumerGateResult.execution_failure = { ...executionFailure };
            if (isFingerprintFailure) {
                consumerGateResult.fingerprint_gate_decision = "blocked";
                const reasonCodes = asStringArray(consumerGateResult.fingerprint_reason_codes);
                if (!reasonCodes.includes(reason)) {
                    reasonCodes.push(reason);
                }
                consumerGateResult.fingerprint_reason_codes = reasonCodes;
            }
        }
        if (isFingerprintFailure) {
            const runtime = asRecord(payload.fingerprint_runtime);
            const runtimeExecution = asRecord(runtime?.execution);
            const fingerprintExecution = runtimeExecution
                ? { ...runtimeExecution }
                : asRecord(gatePayload.fingerprint_execution)
                    ? { ...asRecord(gatePayload.fingerprint_execution) }
                    : null;
            if (fingerprintExecution) {
                fingerprintExecution.live_allowed = false;
                fingerprintExecution.live_decision = "dry_run_only";
                const allowedModes = asStringArray(fingerprintExecution.allowed_execution_modes);
                const fallbackModes = allowedModes.filter((mode) => mode === "dry_run" || mode === "recon");
                fingerprintExecution.allowed_execution_modes =
                    fallbackModes.length > 0 ? fallbackModes : ["dry_run"];
                const reasonCodes = asStringArray(fingerprintExecution.reason_codes);
                if (!reasonCodes.includes(reason)) {
                    reasonCodes.push(reason);
                }
                fingerprintExecution.reason_codes = reasonCodes;
                fingerprintExecution.execution_failure = { ...executionFailure };
                if (missingRequiredPatches.length > 0) {
                    fingerprintExecution.missing_required_patches = [...missingRequiredPatches];
                }
                gatePayload.fingerprint_execution = fingerprintExecution;
            }
        }
        const auditRecord = asRecord(gatePayload.audit_record);
        if (auditRecord) {
            auditRecord.gate_decision = "blocked";
            this.#appendGateReason(auditRecord, reason);
            auditRecord.execution_failure = { ...executionFailure };
        }
        return true;
    }
    async #evaluateXhsTargetGate(request) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const abilityParams = asRecord(commandParams.ability);
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
        const rawActionType = readGateParam("action_type");
        const rawAbilityActionType = abilityParams?.action;
        const rawIssueScope = readGateParam("issue_scope");
        const rawRiskState = readGateParam("risk_state");
        const rawApprovalRecord = readGateParam("approval_record") ?? readGateParam("approval");
        const requestedFingerprintContext = resolveFingerprintContext(commandParams);
        let fingerprintExecution = requestedFingerprintContext?.execution ?? null;
        let fingerprintReasonCodes = (Array.isArray(fingerprintExecution?.reason_codes) ? fingerprintExecution.reason_codes : []).filter((code) => typeof code === "string");
        const targetDomain = asNonEmptyString(rawTargetDomain);
        const targetTabId = asInteger(rawTargetTabId);
        const targetPage = asNonEmptyString(rawTargetPage);
        const issueScope = resolveIssueScope(rawIssueScope);
        const riskState = resolveRiskState(rawRiskState);
        const actionType = parseActionType(rawActionType);
        const abilityActionType = parseActionType(rawAbilityActionType);
        const requestedExecutionMode = parseRequestedExecutionMode(rawRequestedExecutionMode);
        const approvalRecord = normalizeApprovalRecord(rawApprovalRecord);
        const issueActionMatrixEntry = resolveIssueActionMatrixEntry(issueScope, riskState);
        const writeActionMatrixDecisions = getWriteActionMatrixDecisions(issueScope, actionType ?? "read", requestedExecutionMode);
        const writeMatrixDecision = resolveWriteMatrixDecision(writeActionMatrixDecisions, riskState);
        const issue208WriteGateOnly = issueScope === "issue_208" &&
            actionType !== null &&
            writeActionMatrixDecisions.write_interaction_tier !== "observe_only";
        const requestedLiveMode = requestedExecutionMode !== null && XHS_LIVE_EXECUTION_MODES.has(requestedExecutionMode);
        let fingerprintContextMissing = false;
        let fingerprintContextUntrusted = false;
        let fingerprintLiveBlocked = false;
        let fingerprintGateDecision = "allowed";
        let resolvedFingerprintReasonCodes = [...fingerprintReasonCodes];
        const writeTierReason = `WRITE_INTERACTION_TIER_${writeActionMatrixDecisions.write_interaction_tier.toUpperCase()}`;
        const gateReasons = [];
        let writeGateOnlyApprovalDecision = null;
        let writeGateOnlyEligible = false;
        const pushReason = (reason) => {
            if (!gateReasons.includes(reason)) {
                gateReasons.push(reason);
            }
        };
        if (!requestedExecutionMode) {
            pushReason("REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
        }
        if (!actionType) {
            pushReason("ACTION_TYPE_NOT_EXPLICIT");
        }
        if (abilityActionType && actionType && abilityActionType !== actionType) {
            pushReason("ABILITY_ACTION_CONTEXT_MISMATCH");
        }
        if (!targetDomain) {
            pushReason("TARGET_DOMAIN_NOT_EXPLICIT");
        }
        else if (!XHS_DOMAIN_ALLOWLIST.has(targetDomain)) {
            pushReason("TARGET_DOMAIN_OUT_OF_SCOPE");
        }
        if (targetTabId === null) {
            pushReason("TARGET_TAB_NOT_EXPLICIT");
        }
        if (!targetPage) {
            pushReason("TARGET_PAGE_NOT_EXPLICIT");
        }
        if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
            pushReason("ACTION_DOMAIN_MISMATCH");
        }
        if (targetDomain === XHS_READ_DOMAIN && actionType !== null && actionType !== "read") {
            pushReason("ACTION_DOMAIN_MISMATCH");
        }
        if (requestedExecutionMode === "live_write" && !issue208WriteGateOnly) {
            pushReason("EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
        }
        const isLiveReadMode = requestedExecutionMode === "live_read_limited" ||
            requestedExecutionMode === "live_read_high_risk";
        const isBlockedByStateMatrix = !issue208WriteGateOnly &&
            requestedExecutionMode !== null &&
            issueActionMatrixEntry.blocked_actions.includes(requestedExecutionMode);
        if (isBlockedByStateMatrix) {
            if (isLiveReadMode) {
                pushReason(`RISK_STATE_${riskState.toUpperCase()}`);
                pushReason("ISSUE_ACTION_MATRIX_BLOCKED");
            }
            else {
                pushReason("ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
            }
        }
        const conditionalRequirement = issue208WriteGateOnly || requestedExecutionMode === null
            ? null
            : issueActionMatrixEntry.conditional_actions.find((entry) => entry.action === requestedExecutionMode) ?? null;
        if (isLiveReadMode && !isBlockedByStateMatrix && conditionalRequirement) {
            if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
                pushReason("MANUAL_CONFIRMATION_MISSING");
            }
            const missingChecks = XHS_REQUIRED_APPROVAL_CHECKS.filter((key) => !approvalRecord.checks[key]);
            if (missingChecks.length > 0) {
                pushReason("APPROVAL_CHECKS_INCOMPLETE");
            }
        }
        if (issue208WriteGateOnly) {
            const writeApprovalRequirements = writeMatrixDecision.requires.length > 0
                ? writeMatrixDecision.requires
                : writeActionMatrixDecisions.write_interaction_tier === "reversible_interaction"
                    ? [...XHS_WRITE_APPROVAL_REQUIREMENTS]
                    : [];
            const approvalRequirementGaps = resolveApprovalRequirementGaps(writeApprovalRequirements, approvalRecord);
            const approvalSatisfied = approvalRequirementGaps.length === 0;
            if (writeMatrixDecision.decision === "blocked" ||
                writeMatrixDecision.decision === "not_applicable") {
                pushReason("ISSUE_ACTION_MATRIX_BLOCKED");
            }
            else if ((writeMatrixDecision.decision === "conditional" ||
                writeMatrixDecision.decision === "allowed") &&
                !approvalSatisfied) {
                if (approvalRequirementGaps.includes("approval_record_approved_true") ||
                    approvalRequirementGaps.includes("approval_record_approver_present") ||
                    approvalRequirementGaps.includes("approval_record_approved_at_present")) {
                    pushReason("MANUAL_CONFIRMATION_MISSING");
                }
                if (approvalRequirementGaps.includes("approval_record_checks_all_true")) {
                    pushReason("APPROVAL_CHECKS_INCOMPLETE");
                }
            }
            else if (writeMatrixDecision.decision === "allowed" ||
                (writeMatrixDecision.decision === "conditional" && approvalSatisfied)) {
                writeGateOnlyEligible = true;
            }
            writeGateOnlyApprovalDecision = {
                issue_scope: issueScope,
                state: riskState,
                write_interaction_tier: writeActionMatrixDecisions.write_interaction_tier,
                matrix_decision: writeMatrixDecision.decision,
                matrix_actions: writeActionMatrixDecisions.matrix_actions,
                required_approval: writeApprovalRequirements,
                approval_satisfied: approvalSatisfied,
                approval_missing_requirements: approvalRequirementGaps,
                execution_enabled: false
            };
        }
        else if (issueScope !== "issue_208" &&
            actionType !== null &&
            actionType !== "read") {
            if (isLiveReadMode) {
                pushReason("ACTION_TYPE_MODE_MISMATCH");
            }
            pushReason(`RISK_STATE_${riskState.toUpperCase()}`);
            pushReason("ISSUE_ACTION_MATRIX_BLOCKED");
        }
        if (gateReasons.length === 0 && targetDomain && targetTabId !== null && targetPage) {
            const domainTabs = await this.chromeApi.tabs.query({
                url: `*://${targetDomain}/*`
            });
            const targetTab = domainTabs.find((tab) => tab.id === targetTabId);
            if (!targetTab) {
                pushReason("TARGET_TAB_NOT_FOUND");
            }
            else {
                const tabUrl = typeof targetTab.url === "string" ? targetTab.url : "";
                const parsed = parseUrl(tabUrl);
                if (!parsed) {
                    pushReason("TARGET_TAB_URL_INVALID");
                }
                else {
                    if (parsed.hostname !== targetDomain) {
                        pushReason("TARGET_DOMAIN_MISMATCH");
                    }
                    const actualPage = classifyXhsPage(tabUrl, targetDomain);
                    if (actualPage !== targetPage) {
                        pushReason("TARGET_PAGE_MISMATCH");
                    }
                }
            }
        }
        const shouldEvaluateTrustedFingerprintGate = requestedLiveMode && !issue208WriteGateOnly && gateReasons.length === 0;
        if (shouldEvaluateTrustedFingerprintGate) {
            const trustedFingerprintContext = this.#resolveValidatedTrustedFingerprintContext(request, requestedFingerprintContext);
            fingerprintExecution = trustedFingerprintContext?.execution ?? null;
            fingerprintReasonCodes = (Array.isArray(fingerprintExecution?.reason_codes) ? fingerprintExecution.reason_codes : []).filter((code) => typeof code === "string");
            if (fingerprintExecution === null) {
                fingerprintContextMissing = requestedFingerprintContext === null;
                fingerprintContextUntrusted = requestedFingerprintContext !== null;
                if (fingerprintContextMissing) {
                    pushReason("FINGERPRINT_CONTEXT_MISSING");
                    resolvedFingerprintReasonCodes = ["FINGERPRINT_CONTEXT_MISSING"];
                }
                else {
                    pushReason("FINGERPRINT_CONTEXT_UNTRUSTED");
                    resolvedFingerprintReasonCodes = ["FINGERPRINT_CONTEXT_UNTRUSTED"];
                }
                pushReason("FINGERPRINT_EXECUTION_BLOCKED");
            }
            else if (requestedExecutionMode !== null &&
                (fingerprintExecution.live_allowed !== true ||
                    fingerprintExecution.live_decision === "dry_run_only" ||
                    !fingerprintExecution.allowed_execution_modes.includes(requestedExecutionMode))) {
                fingerprintLiveBlocked = true;
                pushReason("FINGERPRINT_EXECUTION_BLOCKED");
                resolvedFingerprintReasonCodes = [...fingerprintReasonCodes];
            }
            else {
                resolvedFingerprintReasonCodes = [...fingerprintReasonCodes];
            }
            fingerprintGateDecision =
                fingerprintContextMissing || fingerprintContextUntrusted || fingerprintLiveBlocked
                    ? "blocked"
                    : "allowed";
        }
        if (issue208WriteGateOnly) {
            if (!gateReasons.includes(writeTierReason)) {
                gateReasons.push(writeTierReason);
            }
        }
        const blockingReasons = gateReasons.filter((reason) => reason !== writeTierReason);
        const allowed = blockingReasons.length === 0;
        const gateDecision = allowed ? "allowed" : "blocked";
        const requiresManualConfirmation = requestedExecutionMode === "live_read_limited" ||
            requestedExecutionMode === "live_read_high_risk" ||
            requestedExecutionMode === "live_write" ||
            (issue208WriteGateOnly &&
                (writeMatrixDecision.decision === "conditional" ||
                    writeActionMatrixDecisions.write_interaction_tier === "reversible_interaction"));
        const gateOnlyEffectiveExecutionMode = requestedExecutionMode === "recon" ? "recon" : "dry_run";
        const effectiveExecutionMode = allowed
            ? issue208WriteGateOnly
                ? gateOnlyEffectiveExecutionMode
                : requestedExecutionMode ?? "dry_run"
            : resolveBlockedFallbackMode(requestedExecutionMode, riskState);
        if (allowed && requestedExecutionMode === "dry_run") {
            gateReasons.push("DEFAULT_MODE_DRY_RUN");
        }
        if (allowed && requestedExecutionMode === "recon") {
            gateReasons.push("DEFAULT_MODE_RECON");
        }
        if (allowed &&
            (requestedExecutionMode === "live_read_limited" ||
                requestedExecutionMode === "live_read_high_risk")) {
            gateReasons.push("LIVE_MODE_APPROVED");
        }
        if (allowed && issue208WriteGateOnly && writeGateOnlyEligible) {
            gateReasons.push("WRITE_EXECUTION_GATE_ONLY");
        }
        const consumerGateResult = {
            risk_state: riskState,
            issue_scope: issueScope,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            effective_execution_mode: effectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: gateReasons,
            fingerprint_gate_decision: fingerprintGateDecision,
            fingerprint_reason_codes: resolvedFingerprintReasonCodes,
            write_interaction_tier: writeActionMatrixDecisions.write_interaction_tier
        };
        const runId = String(request.params.run_id ?? request.id);
        const sessionId = String(request.params.session_id ?? this.#sessionId);
        const profile = typeof request.profile === "string" ? request.profile : null;
        const auditRecord = {
            event_id: `bg_gate_${request.id}`,
            run_id: runId,
            session_id: sessionId,
            profile,
            issue_scope: issueScope,
            risk_state: riskState,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            effective_execution_mode: effectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: gateReasons,
            approver: approvalRecord.approver,
            approved_at: approvalRecord.approved_at,
            write_interaction_tier: writeActionMatrixDecisions.write_interaction_tier,
            write_matrix_decision: writeMatrixDecision.decision,
            recorded_at: new Date().toISOString()
        };
        const riskTransitionAudit = buildRiskTransitionAudit({
            runId,
            sessionId,
            issueScope,
            prevState: riskState,
            decision: gateDecision,
            gateReasons,
            requestedExecutionMode,
            approvalRecord,
            auditRecords: [auditRecord],
            now: auditRecord.recorded_at
        });
        const resolvedRiskState = resolveSharedRiskState(riskTransitionAudit.next_state);
        const resolvedIssueActionMatrixEntry = resolveIssueActionMatrixEntry(issueScope, resolvedRiskState);
        const persistedAuditRecord = {
            ...auditRecord,
            next_state: riskTransitionAudit.next_state,
            transition_trigger: riskTransitionAudit.trigger
        };
        const gatePayload = {
            plugin_gate_ownership: XHS_PLUGIN_GATE_OWNERSHIP,
            scope_context: XHS_SCOPE_CONTEXT,
            read_execution_policy: XHS_READ_EXECUTION_POLICY,
            gate_input: {
                run_id: runId,
                session_id: sessionId,
                profile,
                issue_scope: issueScope,
                target_domain: targetDomain,
                target_tab_id: targetTabId,
                target_page: targetPage,
                action_type: actionType,
                requested_execution_mode: requestedExecutionMode,
                risk_state: riskState,
                fingerprint_gate_decision: fingerprintGateDecision
            },
            gate_outcome: {
                effective_execution_mode: effectiveExecutionMode,
                gate_decision: gateDecision,
                gate_reasons: gateReasons,
                requires_manual_confirmation: requiresManualConfirmation,
                fingerprint_gate_decision: fingerprintGateDecision
            },
            fingerprint_execution: fingerprintExecution ? { ...fingerprintExecution } : null,
            consumer_gate_result: consumerGateResult,
            approval_record: approvalRecord,
            issue_action_matrix: resolvedIssueActionMatrixEntry,
            write_interaction_tier: WRITE_INTERACTION_TIER,
            write_action_matrix_decisions: writeActionMatrixDecisions,
            ...(writeGateOnlyApprovalDecision ? { write_gate_only_decision: writeGateOnlyApprovalDecision } : {}),
            risk_state_output: buildUnifiedRiskStateOutput(resolvedRiskState, {
                auditRecords: [persistedAuditRecord],
                now: persistedAuditRecord.recorded_at
            }),
            audit_record: persistedAuditRecord,
            risk_transition_audit: riskTransitionAudit
        };
        return {
            allowed,
            targetTabId: allowed ? targetTabId : null,
            errorMessage: allowed ? "" : xhsGateReasonMessage(gateReasons[0] ?? "TARGET_TAB_NOT_EXPLICIT"),
            gateOnly: allowed && issue208WriteGateOnly,
            consumerGateResult,
            gatePayload
        };
    }
    #resolveForwardTimeoutMs(request) {
        return (readTimeoutMs(request.timeout_ms) ??
            this.options?.forwardTimeoutMs ??
            defaultForwardTimeoutMs);
    }
    #isXhsSignRequestMessage(message) {
        const record = asRecord(message);
        return (record?.kind === "xhs-sign-request" &&
            typeof record.uri === "string" &&
            record.uri.length > 0 &&
            asRecord(record.body) !== null);
    }
    async #executeXhsSignInMainWorld(tabId, uri, body) {
        if (!this.chromeApi.scripting?.executeScript) {
            throw new Error("chrome.scripting.executeScript is unavailable");
        }
        const results = await this.chromeApi.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: (inputUri, inputBody) => {
                const signatureFn = window._webmsxyw;
                if (typeof signatureFn !== "function") {
                    throw new Error("window._webmsxyw is not available");
                }
                if (typeof inputUri !== "string" || inputUri.length === 0) {
                    throw new Error("xhs-sign requires uri");
                }
                const result = signatureFn(inputUri, typeof inputBody === "object" && inputBody !== null ? inputBody : {});
                const xSignature = typeof result?.["X-s"] === "string" ? result["X-s"] : null;
                const xTimestamp = result?.["X-t"];
                if (!xSignature || (typeof xTimestamp !== "string" && typeof xTimestamp !== "number")) {
                    throw new Error("xhs-sign result is invalid");
                }
                return {
                    "X-s": xSignature,
                    "X-t": xTimestamp
                };
            },
            args: [uri, body]
        });
        const first = Array.isArray(results) ? results[0] : null;
        const signature = asRecord(first?.result);
        if (!signature ||
            typeof signature["X-s"] !== "string" ||
            (typeof signature["X-t"] !== "string" && typeof signature["X-t"] !== "number")) {
            throw new Error("xhs-sign result is invalid");
        }
        return {
            "X-s": signature["X-s"],
            "X-t": signature["X-t"]
        };
    }
    async #handleXhsSignRequest(message, sender, sendResponse) {
        const tabId = asInteger(sender.tab?.id);
        const senderUrl = asNonEmptyString(sender.tab?.url);
        const parsedSenderUrl = senderUrl ? parseUrl(senderUrl) : null;
        if (tabId === null || !parsedSenderUrl || !XHS_DOMAIN_ALLOWLIST.has(parsedSenderUrl.hostname)) {
            sendResponse({
                ok: false,
                error: {
                    code: "ERR_XHS_SIGN_FORBIDDEN",
                    message: "xhs-sign request is out of allowlist scope"
                }
            });
            return;
        }
        try {
            const result = await this.#executeXhsSignInMainWorld(tabId, message.uri, message.body);
            sendResponse({
                ok: true,
                result
            });
        }
        catch (error) {
            sendResponse({
                ok: false,
                error: {
                    code: "ERR_XHS_SIGN_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    #onContentScriptResult(message, sender) {
        const result = message;
        if (!result || result.kind !== "result" || typeof result.id !== "string") {
            return;
        }
        const payload = typeof result.payload === "object" && result.payload !== null
            ? { ...result.payload }
            : {};
        const pending = this.#pending.get(result.id);
        if (!pending) {
            void this.#rememberStartupTrustedFingerprintContext(payload, sender);
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(result.id);
        const request = pending.request;
        this.#rememberTrustedFingerprintContext(request, payload, result.ok === true);
        const backfilledExecutionFailure = pending.gatePayload
            ? this.#backfillExecutionFailureIntoGatePayload(pending.gatePayload, payload)
            : false;
        const summary = typeof payload.summary === "object" && payload.summary !== null
            ? payload.summary
            : null;
        if (pending.gatePayload && backfilledExecutionFailure) {
            // Ensure audit-trace fields reflect the final blocked decision even if content payload already had stale copies.
            for (const key of [
                "gate_outcome",
                "consumer_gate_result",
                "audit_record",
                "fingerprint_execution"
            ]) {
                if (!Object.prototype.hasOwnProperty.call(pending.gatePayload, key)) {
                    continue;
                }
                const value = pending.gatePayload[key];
                payload[key] = value;
                if (summary !== null) {
                    summary[key] = value;
                }
            }
        }
        if (pending.gatePayload) {
            for (const [key, value] of Object.entries(pending.gatePayload)) {
                const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
                const hasInSummary = summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
                if (!hasInPayload && !hasInSummary) {
                    if (summary !== null) {
                        summary[key] = value;
                    }
                    else {
                        payload[key] = value;
                    }
                }
            }
        }
        else if (pending.consumerGateResult &&
            !Object.prototype.hasOwnProperty.call(payload, "consumer_gate_result") &&
            !(summary !== null && Object.prototype.hasOwnProperty.call(summary, "consumer_gate_result"))) {
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
        const commandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
            ? request.params.command_params
            : {};
        const options = typeof commandParams.options === "object" && commandParams.options !== null
            ? commandParams.options
            : {};
        if (typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)) {
            return options.target_tab_id;
        }
        const command = String(request.params.command ?? "");
        if (command === "xhs.search") {
            const xhsUrlPatterns = ["*://www.xiaohongshu.com/*", "*://edith.xiaohongshu.com/*", "*://*.xiaohongshu.com/*"];
            const xhsTabs = await this.chromeApi.tabs.query({
                currentWindow: true,
                url: xhsUrlPatterns
            });
            const ranked = xhsTabs
                .filter((tab) => typeof tab.id === "number")
                .sort((left, right) => {
                const scoreDiff = scoreXhsTab(left) - scoreXhsTab(right);
                if (scoreDiff !== 0) {
                    return scoreDiff;
                }
                if (left.active === right.active) {
                    return 0;
                }
                return left.active ? -1 : 1;
            });
            const candidate = ranked[0];
            return typeof candidate?.id === "number" ? candidate.id : null;
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
    void XHS_GATE_CONTRACT_MARKERS;
    const bridge = new ChromeBackgroundBridge(chromeApi, options);
    bridge.start();
};
const chromeApi = globalThis.chrome;
if (chromeApi?.runtime?.connectNative) {
    startChromeBackgroundBridge(chromeApi);
}
