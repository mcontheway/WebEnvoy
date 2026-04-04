import { resolveMainWorldEventNamesForSecret } from "./content-script-handler.js";
import { WRITE_INTERACTION_TIER, APPROVAL_CHECK_KEYS, EXECUTION_MODES, buildRiskTransitionAudit, buildUnifiedRiskStateOutput, getIssueActionMatrixEntry, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../shared/risk-state.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
import { buildXhsGatePolicyState, collectXhsCommandGateReasons, collectXhsMatrixGateReasons, finalizeXhsGateOutcome, resolveXhsActionType, resolveXhsExecutionMode, normalizeXhsApprovalRecord } from "../shared/xhs-gate.js";
const defaultForwardTimeoutMs = 3_000;
const defaultHandshakeTimeoutMs = 30_000;
const defaultNativeHostName = "com.webenvoy.host";
const bridgeProtocol = "webenvoy.native-bridge.v1";
const maxRecoveryQueuedForwards = 5;
const debuggerProtocolVersion = "1.3";
const editorInputDebuggerProbeWaitMs = 150;
const editorInputDebuggerEntryLabels = ["新的创作"];
const editorInputSelectors = [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"].tiptap.ProseMirror',
    '[contenteditable="true"].ProseMirror',
    '[contenteditable="true"][data-lexical-editor="true"]'
];
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
    conditional_actions: "conditional_actions",
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
const scoreXhsRuntimeSurfaceTab = (tab) => {
    const url = typeof tab.url === "string" ? tab.url : "";
    if (url.includes("creator.xiaohongshu.com/publish/publish")) {
        return 0;
    }
    if (url.includes("creator.xiaohongshu.com/")) {
        return 1;
    }
    if (url.includes("www.xiaohongshu.com/")) {
        return 2;
    }
    return 3;
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const resolveFingerprintContext = (commandParams) => {
    const direct = resolveAttestedFingerprintRuntimeContext(commandParams.fingerprint_context) ??
        resolveAttestedFingerprintRuntimeContext(commandParams.fingerprint_runtime);
    const context = direct;
    return context ? { ...context } : null;
};
const resolveAttestedFingerprintRuntimeContext = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const injection = asRecord(record.injection);
    const cloneWithInjection = (runtime) => injection
        ? {
            ...runtime,
            injection: JSON.parse(JSON.stringify(injection))
        }
        : { ...runtime };
    const direct = ensureFingerprintRuntimeContext(record);
    if (direct) {
        return cloneWithInjection(direct);
    }
    const sanitized = { ...record };
    delete sanitized.injection;
    const normalized = ensureFingerprintRuntimeContext(sanitized);
    if (normalized) {
        return cloneWithInjection(normalized);
    }
    return null;
};
const hasSuccessfulExecutionAttestation = (payload) => {
    const startupTrust = asRecord(payload.startup_fingerprint_trust);
    if (startupTrust?.bootstrap_attested === true) {
        return true;
    }
    const fingerprintRuntime = asRecord(payload.fingerprint_runtime);
    const injection = asRecord(fingerprintRuntime?.injection);
    if (!injection || injection.installed !== true) {
        return false;
    }
    return asStringArray(injection.missing_required_patches).length === 0;
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
const isCreatorArticlePublishPage = (url, domain) => {
    if (domain !== XHS_WRITE_DOMAIN) {
        return false;
    }
    const parsed = parseUrl(url);
    if (!parsed || !parsed.pathname.includes("/publish")) {
        return false;
    }
    return parsed.searchParams.get("target") === "article";
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
        EDITOR_INPUT_VALIDATION_REQUIRED: "issue_208 live_write requires editor_input validation scope",
        TARGET_PAGE_ARTICLE_REQUIRED: "issue_208 editor_input only supports article publish target",
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
const readXhsGateParam = (commandParams, key) => {
    if (Object.prototype.hasOwnProperty.call(commandParams, key)) {
        return commandParams[key];
    }
    return asRecord(commandParams.options)?.[key];
};
const XHS_FORWARD_OPTION_KEYS = [
    "issue_scope",
    "target_domain",
    "target_tab_id",
    "target_page",
    "action_type",
    "requested_execution_mode",
    "risk_state",
    "validation_action",
    "validation_text",
    "editor_focus_attestation",
    "approval_record",
    "approval",
    "timeout_ms",
    "simulate_result",
    "x_s_common"
];
const normalizeXhsSearchCommandParams = (commandParams, resolvedTargetTabId) => {
    const normalized = {
        ...commandParams
    };
    const optionParams = asRecord(commandParams.options);
    const normalizedOptions = optionParams ? { ...optionParams } : {};
    for (const key of XHS_FORWARD_OPTION_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(normalizedOptions, key) &&
            Object.prototype.hasOwnProperty.call(commandParams, key)) {
            normalizedOptions[key] = commandParams[key];
        }
    }
    if (typeof resolvedTargetTabId === "number" && Number.isInteger(resolvedTargetTabId)) {
        normalized.target_tab_id = resolvedTargetTabId;
        normalizedOptions.target_tab_id = resolvedTargetTabId;
    }
    if (Object.keys(normalizedOptions).length > 0) {
        normalized.options = normalizedOptions;
    }
    return normalized;
};
const resolveXhsGateCommandInput = (input) => {
    const commandParams = normalizeXhsSearchCommandParams(input);
    const abilityParams = asRecord(commandParams.ability);
    const optionParams = asRecord(commandParams.options);
    const readGateParam = (key) => {
        if (Object.prototype.hasOwnProperty.call(commandParams, key)) {
            return commandParams[key];
        }
        return optionParams?.[key];
    };
    return {
        commandParams,
        targetDomain: asNonEmptyString(readGateParam("target_domain")),
        targetTabId: asInteger(readGateParam("target_tab_id")),
        targetPage: asNonEmptyString(readGateParam("target_page")),
        issueScope: resolveIssueScope(readGateParam("issue_scope")),
        riskState: resolveRiskState(readGateParam("risk_state")),
        actionType: resolveXhsActionType(readGateParam("action_type")),
        abilityActionType: resolveXhsActionType(abilityParams?.action),
        requestedExecutionMode: resolveXhsExecutionMode(readGateParam("requested_execution_mode")),
        approvalRecord: normalizeXhsApprovalRecord(readGateParam("approval_record") ?? readGateParam("approval")),
        validationAction: asNonEmptyString(readGateParam("validation_action")),
        requestedFingerprintContext: resolveFingerprintContext(commandParams)
    };
};
const resolveGateOnlyPageState = (gateInput, scopeContext) => {
    const targetPage = asNonEmptyString(gateInput.target_page);
    const targetDomain = asNonEmptyString(gateInput.target_domain) ??
        asNonEmptyString(scopeContext.write_domain) ??
        asNonEmptyString(scopeContext.read_domain);
    if (!targetPage || !targetDomain) {
        return null;
    }
    return {
        page_kind: targetPage === "creator_publish_tab" ? "compose" : targetPage,
        url: targetPage === "creator_publish_tab"
            ? `https://${targetDomain}/publish/publish`
            : targetPage === "search_result_tab"
                ? `https://${targetDomain}/search_result`
                : `https://${targetDomain}/`,
        title: targetPage === "creator_publish_tab" ? "Creator Publish" : "Search Result",
        ready_state: "complete"
    };
};
const buildGateOnlyObservability = (gatePayload) => {
    const gateInput = asRecord(gatePayload.gate_input) ?? {};
    const gateOutcome = asRecord(gatePayload.gate_outcome) ?? {};
    const scopeContext = asRecord(gatePayload.scope_context) ?? {};
    const gateReasons = asStringArray(gateOutcome.gate_reasons);
    return {
        page_state: resolveGateOnlyPageState(gateInput, scopeContext),
        key_requests: [],
        failure_site: gateOutcome.gate_decision === "blocked"
            ? {
                stage: "execution",
                component: "gate",
                target: asNonEmptyString(gateInput.target_page) ??
                    asNonEmptyString(gateInput.target_domain) ??
                    "issue_208_gate_only",
                summary: gateReasons[0] ?? "gate blocked"
            }
            : null
    };
};
const createBridgeXhsGateOnlyPayload = (request, gatePayload) => {
    const commandParams = asRecord(request.params.command_params) ?? {};
    const ability = asRecord(commandParams.ability) ?? {};
    const input = asRecord(commandParams.input) ?? {};
    const consumerGateResult = asRecord(gatePayload.consumer_gate_result) ?? {};
    const capabilityResult = {
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
    };
    return {
        summary: {
            capability_result: capabilityResult,
            ...gatePayload
        },
        observability: buildGateOnlyObservability(gatePayload)
    };
};
const createRelayXhsGatePayload = (input) => {
    const recordedAt = new Date().toISOString();
    const runId = String(input.request.params.run_id ?? input.request.id);
    const sessionId = String(input.request.params.session_id ?? "nm-session-001");
    const profile = typeof input.request.profile === "string" ? input.request.profile : null;
    return {
        plugin_gate_ownership: XHS_PLUGIN_GATE_OWNERSHIP,
        scope_context: XHS_SCOPE_CONTEXT,
        read_execution_policy: XHS_READ_EXECUTION_POLICY,
        gate_input: {
            run_id: runId,
            session_id: sessionId,
            profile,
            issue_scope: input.issueScope,
            target_domain: input.targetDomain,
            target_tab_id: input.targetTabId,
            target_page: input.targetPage,
            action_type: input.actionType,
            requested_execution_mode: input.requestedExecutionMode,
            risk_state: input.riskState,
            fingerprint_gate_decision: "allowed"
        },
        gate_outcome: {
            effective_execution_mode: input.effectiveExecutionMode,
            gate_decision: input.gateDecision,
            gate_reasons: input.gateReasons,
            requires_manual_confirmation: input.requiresManualConfirmation,
            fingerprint_gate_decision: "allowed"
        },
        consumer_gate_result: input.consumerGateResult,
        approval_record: input.approvalRecord,
        issue_action_matrix: input.issueScope !== null
            ? resolveIssueActionMatrixEntry(input.issueScope, input.riskState)
            : null,
        write_interaction_tier: WRITE_INTERACTION_TIER,
        write_action_matrix_decisions: input.writeActionMatrixDecisions,
        ...(input.writeGateOnlyDecision
            ? { write_gate_only_decision: input.writeGateOnlyDecision }
            : {}),
        observability: buildGateOnlyObservability({
            gate_input: {
                target_domain: input.targetDomain,
                target_page: input.targetPage
            },
            gate_outcome: {
                gate_decision: input.gateDecision,
                gate_reasons: input.gateReasons
            },
            scope_context: XHS_SCOPE_CONTEXT
        }),
        audit_record: {
            event_id: `relay_gate_${input.request.id}`,
            run_id: runId,
            session_id: sessionId,
            profile,
            issue_scope: input.issueScope,
            risk_state: input.riskState,
            target_domain: input.targetDomain,
            target_tab_id: input.targetTabId,
            target_page: input.targetPage,
            action_type: input.actionType,
            requested_execution_mode: input.requestedExecutionMode,
            effective_execution_mode: input.effectiveExecutionMode,
            gate_decision: input.gateDecision,
            gate_reasons: input.gateReasons,
            approver: input.approvalRecord.approver,
            approved_at: input.approvalRecord.approved_at,
            recorded_at: recordedAt,
            risk_signal: input.riskState !== "allowed",
            recovery_signal: false,
            session_rhythm_state: "normal",
            cooldown_until: null,
            recovery_started_at: null
        }
    };
};
const createBackgroundXhsGatePayload = (input) => {
    const runId = String(input.request.params.run_id ?? input.request.id);
    const sessionId = String(input.request.params.session_id ?? "nm-session-001");
    const profile = typeof input.request.profile === "string" ? input.request.profile : null;
    const recordedAt = new Date().toISOString();
    const auditRecord = {
        event_id: `bg_gate_${input.request.id}`,
        run_id: runId,
        session_id: sessionId,
        profile,
        issue_scope: input.issueScope,
        risk_state: input.riskState,
        target_domain: input.targetDomain,
        target_tab_id: input.targetTabId,
        target_page: input.targetPage,
        action_type: input.actionType,
        requested_execution_mode: input.requestedExecutionMode,
        effective_execution_mode: input.effectiveExecutionMode,
        gate_decision: input.gateDecision,
        gate_reasons: input.gateReasons,
        approver: input.approvalRecord.approver,
        approved_at: input.approvalRecord.approved_at,
        write_interaction_tier: input.writeActionMatrixDecisions?.write_interaction_tier ?? null,
        write_matrix_decision: input.writeMatrixDecision?.decision ?? null,
        recorded_at: recordedAt,
        next_state: input.riskTransitionAudit.next_state,
        transition_trigger: input.riskTransitionAudit.trigger
    };
    return {
        plugin_gate_ownership: XHS_PLUGIN_GATE_OWNERSHIP,
        scope_context: XHS_SCOPE_CONTEXT,
        read_execution_policy: XHS_READ_EXECUTION_POLICY,
        gate_input: {
            run_id: runId,
            session_id: sessionId,
            profile,
            issue_scope: input.issueScope,
            target_domain: input.targetDomain,
            target_tab_id: input.targetTabId,
            target_page: input.targetPage,
            action_type: input.actionType,
            requested_execution_mode: input.requestedExecutionMode,
            risk_state: input.riskState,
            fingerprint_gate_decision: input.fingerprintGateDecision
        },
        gate_outcome: {
            effective_execution_mode: input.effectiveExecutionMode,
            gate_decision: input.gateDecision,
            gate_reasons: input.gateReasons,
            requires_manual_confirmation: input.requiresManualConfirmation,
            fingerprint_gate_decision: input.fingerprintGateDecision
        },
        fingerprint_execution: input.fingerprintExecution ? { ...input.fingerprintExecution } : null,
        consumer_gate_result: input.consumerGateResult,
        approval_record: input.approvalRecord,
        issue_action_matrix: input.issueScope !== null
            ? resolveIssueActionMatrixEntry(input.issueScope, input.resolvedRiskState)
            : null,
        write_interaction_tier: WRITE_INTERACTION_TIER,
        write_action_matrix_decisions: input.writeActionMatrixDecisions,
        ...(input.writeGateOnlyDecision ? { write_gate_only_decision: input.writeGateOnlyDecision } : {}),
        risk_state_output: buildUnifiedRiskStateOutput(input.resolvedRiskState, {
            auditRecords: [auditRecord],
            now: auditRecord.recorded_at
        }),
        audit_record: auditRecord,
        risk_transition_audit: input.riskTransitionAudit
    };
};
const buildTrustedFingerprintContextKey = (profile, sessionId) => `${profile}::${sessionId}`;
const serializeFingerprintRuntimeContext = (fingerprintRuntime) => {
    const record = { ...fingerprintRuntime };
    delete record.injection;
    return JSON.stringify(record);
};
const hasInstalledFingerprintInjection = (fingerprintRuntime) => {
    if (!fingerprintRuntime) {
        return false;
    }
    const injection = asRecord(fingerprintRuntime.injection);
    return (injection?.installed === true &&
        asStringArray(injection.missing_required_patches).length === 0);
};
const isFingerprintRuntimeContextEquivalent = (left, right) => serializeFingerprintRuntimeContext(left) === serializeFingerprintRuntimeContext(right);
const TRUST_INVALIDATION_COMMANDS = new Set(["runtime.stop", "runtime.start", "runtime.login"]);
// Trust must come from startup trust bound to an allowlist page, not generic bridge commands.
const TRUST_PRIMING_COMMANDS = new Set(["runtime.ping"]);
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
        const command = String(request.params.command ?? "");
        if (command === "xhs.interact") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "unsupported command"
                }
            });
            return;
        }
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
class BackgroundRuntimeTrustState {
    #trustedFingerprintContexts = new Map();
    #runtimeBootstrapStates = new Map();
    clearAll() {
        this.clearTrustedContexts();
        this.clearRuntimeBootstrapStates();
    }
    clearTrustedContexts() {
        if (this.#trustedFingerprintContexts.size === 0) {
            return;
        }
        this.#trustedFingerprintContexts.clear();
    }
    clearRuntimeBootstrapStates() {
        if (this.#runtimeBootstrapStates.size === 0) {
            return;
        }
        this.#runtimeBootstrapStates.clear();
    }
    clearTrustedContextBySession(profile, sessionId) {
        this.#trustedFingerprintContexts.delete(buildTrustedFingerprintContextKey(profile, sessionId));
    }
    clearTrustedContextsByProfile(profile) {
        const profilePrefix = `${profile}::`;
        for (const key of this.#trustedFingerprintContexts.keys()) {
            if (key.startsWith(profilePrefix)) {
                this.#trustedFingerprintContexts.delete(key);
            }
        }
    }
    getBootstrap(profile) {
        return this.#runtimeBootstrapStates.get(profile) ?? null;
    }
    setBootstrap(profile, state) {
        this.#runtimeBootstrapStates.set(profile, state);
    }
    getTrusted(profile, sessionId) {
        return this.#trustedFingerprintContexts.get(buildTrustedFingerprintContextKey(profile, sessionId)) ?? null;
    }
    upsertTrusted(profile, sessionId, normalized, source) {
        const key = buildTrustedFingerprintContextKey(profile, sessionId);
        const serializedFingerprintRuntime = serializeFingerprintRuntimeContext(normalized);
        const sourceTabId = source?.sourceTabId ?? null;
        const sourceDomain = source?.sourceDomain ?? null;
        const runId = source?.runId ?? null;
        const runtimeContextId = source?.runtimeContextId ?? null;
        const existing = this.#trustedFingerprintContexts.get(key);
        const shouldRotate = !!existing &&
            (existing.sessionId !== sessionId ||
                existing.runId !== runId ||
                existing.runtimeContextId !== runtimeContextId ||
                existing.serializedFingerprintRuntime !== serializedFingerprintRuntime ||
                existing.sourceTabId !== sourceTabId ||
                existing.sourceDomain !== sourceDomain);
        if (shouldRotate) {
            this.#trustedFingerprintContexts.delete(key);
        }
        this.#trustedFingerprintContexts.set(key, {
            sessionId,
            runId,
            runtimeContextId,
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
    listTrustedByProfile(profile) {
        return Array.from(this.#trustedFingerprintContexts.entries()).filter(([key]) => key.startsWith(`${profile}::`));
    }
}
class NativeBridgePendingForwardState {
    #pending = new Map();
    register(id, pending) {
        this.#pending.set(id, pending);
    }
    take(id) {
        const pending = this.#pending.get(id);
        if (!pending) {
            return null;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(id);
        return pending;
    }
    fail(id, error, emit) {
        const pending = this.take(id);
        if (!pending || pending.suppressHostResponse) {
            return;
        }
        emit({
            id,
            status: "error",
            summary: {
                relay_path: "host>background>content-script>background>host"
            },
            error
        });
    }
    failAll(error, emit) {
        for (const id of [...this.#pending.keys()]) {
            this.fail(id, error, emit);
        }
    }
}
class NativeBridgeRecoveryState {
    hooks;
    options;
    #recoveryQueue = [];
    constructor(hooks, options) {
        this.hooks = hooks;
        this.options = options;
    }
    queueForward(request) {
        const timeoutMs = this.#resolveForwardTimeoutMs(request);
        const deadlineMs = Date.now() + timeoutMs;
        if (Date.now() >= deadlineMs) {
            this.hooks.emit({
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
            this.hooks.emit({
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
    async replayQueuedForwards(dispatchForward) {
        if (this.#recoveryQueue.length === 0) {
            return;
        }
        this.#expireQueuedForwards(Date.now());
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const queuedForward of queued) {
            const request = queuedForward.request;
            if (Date.now() >= queuedForward.deadlineMs) {
                this.hooks.emit({
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
            if (this.hooks.getState() !== "ready") {
                this.#recoveryQueue.push(queuedForward);
                continue;
            }
            await dispatchForward(request, queuedForward.deadlineMs);
        }
    }
    failRecoveryQueue(message) {
        const queued = [...this.#recoveryQueue];
        this.#recoveryQueue.length = 0;
        for (const queuedForward of queued) {
            this.hooks.emit({
                id: queuedForward.request.id,
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
    expireQueuedForwards(nowMs) {
        this.#expireQueuedForwards(nowMs);
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
            this.hooks.emit({
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
    #resolveForwardTimeoutMs(request) {
        const timeoutMs = readTimeoutMs(request.timeout_ms);
        return timeoutMs ?? (this.options?.forwardTimeoutMs ?? defaultForwardTimeoutMs);
    }
}
class ChromeBackgroundBridge {
    chromeApi;
    options;
    #port = null;
    #pendingState = new NativeBridgePendingForwardState();
    #runtimeTrustState = new BackgroundRuntimeTrustState();
    #recoveryState;
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
        this.#recoveryState = new NativeBridgeRecoveryState({
            getState: () => this.#state,
            emit: (message) => {
                this.#emit(message);
            }
        }, options);
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
    #stopHeartbeatLoop() {
        if (this.#heartbeatTimer) {
            clearInterval(this.#heartbeatTimer);
            this.#heartbeatTimer = null;
        }
        this.#clearHeartbeatTimeout();
        this.#pendingHeartbeatId = null;
        this.#missedHeartbeatCount = 0;
    }
    #handleDisconnect(message) {
        this.#stopHeartbeatLoop();
        this.#clearHandshakeTimeout();
        this.#pendingHandshakeId = null;
        this.#clearTrustedFingerprintContexts();
        this.#clearRuntimeBootstrapStates();
        this.#failAllPending({
            code: "ERR_TRANSPORT_DISCONNECTED",
            message
        });
        this.#disposeCurrentPort();
        this.#enterRecovery();
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
            this.#clearRuntimeBootstrapStates();
        }
        this.#state = "ready";
        this.#recoveryDeadlineMs = null;
        this.#stopRecoveryLoop();
        this.#startHeartbeatLoop();
        void this.#recoveryState.replayQueuedForwards((request, deadlineMs) => this.#dispatchForward(request, deadlineMs));
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
    #enterRecovery() {
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
            this.#recoveryState.expireQueuedForwards(Date.now());
            const deadline = this.#recoveryDeadlineMs;
            if (deadline !== null && Date.now() >= deadline) {
                this.#state = "disconnected";
                this.#recoveryDeadlineMs = null;
                this.#recoveryState.failRecoveryQueue("recovery window exhausted");
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
        this.#runtimeTrustState.clearTrustedContexts();
    }
    #clearRuntimeBootstrapStates() {
        this.#runtimeTrustState.clearRuntimeBootstrapStates();
    }
    #clearTrustedFingerprintContextBySession(profile, sessionId) {
        this.#runtimeTrustState.clearTrustedContextBySession(profile, sessionId);
    }
    #clearTrustedFingerprintContextsByProfile(profile) {
        this.#runtimeTrustState.clearTrustedContextsByProfile(profile);
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
        if (!hasSuccessfulExecutionAttestation(payload)) {
            return;
        }
        const fingerprintRuntime = resolveAttestedFingerprintRuntimeContext(payload.fingerprint_runtime ?? null);
        if (!fingerprintRuntime) {
            return;
        }
        if (fingerprintRuntime.profile !== profile) {
            return;
        }
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        const bootstrap = this.#runtimeTrustState.getBootstrap(profile);
        const canPrimeFromBootstrap = command === "runtime.ping" &&
            !!bootstrap &&
            bootstrap.sessionId === sessionId &&
            (bootstrap.status === "pending" || bootstrap.status === "ready") &&
            bootstrap.serializedFingerprintRuntime === serializeFingerprintRuntimeContext(fingerprintRuntime);
        if (!canPrimeFromBootstrap) {
            return;
        }
        // Runtime bootstrap readiness should be promoted by execution-surface attestation,
        // regardless of whether an XHS-specific target binding is present.
        this.#promoteRuntimeBootstrapStateFromExecutionSignal(profile, sessionId, fingerprintRuntime, asNonEmptyString(request.params.run_id) ?? bootstrap?.runId ?? null, bootstrap?.runtimeContextId ?? null);
        const sourceBinding = this.#resolveRequestTargetBinding(request);
        if (!sourceBinding) {
            return;
        }
        this.#upsertTrustedFingerprintContext(profile, sessionId, fingerprintRuntime, {
            sourceTabId: sourceBinding.tabId,
            sourceDomain: sourceBinding.domain,
            runId: bootstrap?.runId ?? null,
            runtimeContextId: bootstrap?.runtimeContextId ?? null
        });
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
        if (hasInstalledFingerprintInjection(fingerprintRuntime)) {
            this.#promoteRuntimeBootstrapStateFromExecutionSignal(profile, explicitSessionId, fingerprintRuntime, asNonEmptyString(startupTrust.run_id ?? null), asNonEmptyString(startupTrust.runtime_context_id ?? null));
        }
        const senderBinding = await this.#resolveStartupTrustSenderBinding(sender);
        if (!senderBinding) {
            return;
        }
        this.#upsertTrustedFingerprintContext(profile, explicitSessionId, fingerprintRuntime, {
            sourceTabId: senderBinding.tabId,
            sourceDomain: senderBinding.domain,
            runId: asNonEmptyString(startupTrust.run_id ?? null),
            runtimeContextId: asNonEmptyString(startupTrust.runtime_context_id ?? null)
        });
    }
    #normalizeTrustedFingerprintRuntime(fingerprintRuntime) {
        const injection = asRecord(fingerprintRuntime.injection);
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
            execution: JSON.parse(JSON.stringify(fingerprintRuntime.execution)),
            ...(injection ? { injection: JSON.parse(JSON.stringify(injection)) } : {})
        };
    }
    #upsertTrustedFingerprintContext(profile, sessionId, fingerprintRuntime, source) {
        this.#runtimeTrustState.upsertTrusted(profile, sessionId, this.#normalizeTrustedFingerprintRuntime(fingerprintRuntime), source);
    }
    #promoteRuntimeBootstrapStateFromExecutionSignal(profile, sessionId, fingerprintRuntime, signalRunId, signalRuntimeContextId) {
        const bootstrap = this.#runtimeTrustState.getBootstrap(profile);
        if (!bootstrap) {
            return;
        }
        if (bootstrap.sessionId !== sessionId || bootstrap.status !== "pending") {
            return;
        }
        if (!signalRunId || bootstrap.runId !== signalRunId) {
            return;
        }
        if (!signalRuntimeContextId || bootstrap.runtimeContextId !== signalRuntimeContextId) {
            return;
        }
        if (bootstrap.serializedFingerprintRuntime !== serializeFingerprintRuntimeContext(fingerprintRuntime)) {
            bootstrap.status = "failed";
            bootstrap.updatedAt = new Date().toISOString();
            this.#runtimeTrustState.setBootstrap(profile, bootstrap);
            return;
        }
        bootstrap.status = "ready";
        bootstrap.updatedAt = new Date().toISOString();
        this.#runtimeTrustState.setBootstrap(profile, bootstrap);
    }
    #resolveTrustedFingerprintContext(request) {
        const profile = asNonEmptyString(request.profile);
        if (!profile) {
            return null;
        }
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        const trusted = this.#runtimeTrustState.getTrusted(profile, sessionId);
        if (!trusted) {
            return null;
        }
        if (trusted.sessionId !== this.#sessionId) {
            this.#runtimeTrustState.clearTrustedContextBySession(profile, sessionId);
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
        const command = String(request.params.command ?? "");
        if (command === "runtime.bootstrap") {
            await this.#handleRuntimeBootstrap(request);
            return;
        }
        if (command === "runtime.tabs") {
            await this.#handleRuntimeTabs(request);
            return;
        }
        if (command === "runtime.reload_tab") {
            await this.#handleRuntimeReloadTab(request);
            return;
        }
        if (command === "runtime.main_world_probe") {
            await this.#handleRuntimeMainWorldProbe(request);
            return;
        }
        if (command === "runtime.trusted_fingerprint_probe") {
            this.#handleRuntimeTrustedFingerprintProbe(request);
            return;
        }
        if (command === "runtime.readiness") {
            this.#handleRuntimeReadiness(request);
            return;
        }
        await this.#dispatchForward(request);
    }
    async #handleRuntimeBootstrap(request) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const version = asNonEmptyString(commandParams.version);
        const runId = asNonEmptyString(commandParams.run_id);
        const runtimeContextId = asNonEmptyString(commandParams.runtime_context_id);
        const profile = asNonEmptyString(commandParams.profile);
        const fingerprintRuntime = ensureFingerprintRuntimeContext(commandParams.fingerprint_runtime ?? null);
        const fingerprintPatchManifest = asRecord(commandParams.fingerprint_patch_manifest);
        const mainWorldSecret = asNonEmptyString(commandParams.main_world_secret);
        const requestRunId = asNonEmptyString(request.params.run_id);
        const requestProfile = asNonEmptyString(request.profile);
        const requestSessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        if (!version ||
            version !== "v1" ||
            !runId ||
            !runtimeContextId ||
            !profile ||
            !fingerprintRuntime ||
            !fingerprintPatchManifest ||
            !mainWorldSecret) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "invalid runtime bootstrap envelope"
                }
            });
            return;
        }
        if (!requestProfile || requestProfile !== profile) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
                    message: "runtime bootstrap profile 与当前请求 profile 不一致"
                }
            });
            return;
        }
        if (requestRunId && requestRunId !== runId) {
            this.#runtimeTrustState.setBootstrap(profile, {
                version,
                runId,
                runtimeContextId,
                profile,
                sessionId: requestSessionId,
                status: "stale",
                serializedFingerprintRuntime: serializeFingerprintRuntimeContext(fingerprintRuntime),
                updatedAt: new Date().toISOString()
            });
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: this.#sessionId,
                    run_id: requestRunId,
                    command: "runtime.bootstrap",
                    profile,
                    relay_path: "host>background"
                },
                payload: {
                    method: "runtime.bootstrap.ack",
                    result: {
                        version,
                        run_id: runId,
                        runtime_context_id: runtimeContextId,
                        profile,
                        status: "stale"
                    }
                },
                error: null
            });
            return;
        }
        const serializedFingerprintRuntime = serializeFingerprintRuntimeContext(fingerprintRuntime);
        const currentBootstrapState = this.#runtimeTrustState.getBootstrap(profile);
        const bootstrapReadyFromState = !!currentBootstrapState &&
            currentBootstrapState.sessionId === requestSessionId &&
            currentBootstrapState.status === "ready" &&
            currentBootstrapState.version === version &&
            currentBootstrapState.runId === runId &&
            currentBootstrapState.runtimeContextId === runtimeContextId &&
            currentBootstrapState.serializedFingerprintRuntime === serializedFingerprintRuntime;
        const trusted = this.#runtimeTrustState.getTrusted(profile, requestSessionId);
        const trustedHasInstalledInjection = hasInstalledFingerprintInjection(trusted?.fingerprintRuntime ?? null);
        const trustedMatchesBootstrap = !!trusted &&
            trusted.sessionId === requestSessionId &&
            trusted.runId === runId &&
            trusted.runtimeContextId === runtimeContextId &&
            trustedHasInstalledInjection;
        const bootstrapReadyFromTrusted = trustedMatchesBootstrap &&
            trusted.serializedFingerprintRuntime === serializedFingerprintRuntime;
        if (bootstrapReadyFromState && trustedMatchesBootstrap || bootstrapReadyFromTrusted) {
            this.#runtimeTrustState.setBootstrap(profile, {
                version,
                runId,
                runtimeContextId,
                profile,
                sessionId: requestSessionId,
                status: "ready",
                serializedFingerprintRuntime,
                updatedAt: new Date().toISOString()
            });
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: this.#sessionId,
                    run_id: requestRunId ?? request.id,
                    command: "runtime.bootstrap",
                    profile,
                    relay_path: "host>background"
                },
                payload: {
                    method: "runtime.bootstrap.ack",
                    result: {
                        version,
                        run_id: runId,
                        runtime_context_id: runtimeContextId,
                        profile,
                        status: "ready"
                    },
                    ...(trustedMatchesBootstrap
                        ? {
                            runtime_bootstrap_attested: true,
                            fingerprint_runtime: trusted?.fingerprintRuntime ?? null
                        }
                        : {})
                },
                error: null
            });
            return;
        }
        this.#runtimeTrustState.setBootstrap(profile, {
            version,
            runId,
            runtimeContextId,
            profile,
            sessionId: requestSessionId,
            status: "pending",
            serializedFingerprintRuntime,
            updatedAt: new Date().toISOString()
        });
        // Keep the request pending until the execution surface returns an explicit bootstrap ack
        // or the normal forward timeout resolves it.
        void this.#dispatchForward(request);
        return;
    }
    async #handleRuntimeTabs(request) {
        const commandParams = asRecord(request.params.command_params) ?? {};
        const currentWindowOnly = commandParams.current_window_only !== false;
        const rawUrlPatterns = Array.isArray(commandParams.url_patterns)
            ? commandParams.url_patterns.filter((entry) => typeof entry === "string")
            : [];
        try {
            const tabs = await this.chromeApi.tabs.query({
                ...(currentWindowOnly ? { currentWindow: true } : {}),
                ...(rawUrlPatterns.length > 0 ? { url: rawUrlPatterns } : {})
            });
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: String(request.params.session_id ?? this.#sessionId),
                    run_id: String(request.params.run_id ?? request.id),
                    command: "runtime.tabs",
                    relay_path: "host>background"
                },
                payload: {
                    tabs: tabs.map((tab) => ({
                        tab_id: typeof tab.id === "number" ? tab.id : null,
                        active: tab.active === true,
                        url: typeof tab.url === "string" ? tab.url : null
                    }))
                },
                error: null
            });
        }
        catch (error) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    async #handleRuntimeReloadTab(request) {
        const tabId = await this.#resolveTargetTabId(request);
        if (!tabId) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "runtime.reload_tab requires resolvable target_tab_id"
                }
            });
            return;
        }
        if (!this.chromeApi.scripting?.executeScript) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "chrome.scripting.executeScript is unavailable"
                }
            });
            return;
        }
        try {
            const results = await this.chromeApi.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: () => {
                    const href = location.href;
                    setTimeout(() => {
                        location.reload();
                    }, 0);
                    return {
                        href,
                        reload_scheduled: true
                    };
                }
            });
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: String(request.params.session_id ?? this.#sessionId),
                    run_id: String(request.params.run_id ?? request.id),
                    command: "runtime.reload_tab",
                    profile: typeof request.profile === "string" ? request.profile : null,
                    tab_id: tabId,
                    relay_path: "host>background>main-world>background>host"
                },
                payload: {
                    target_tab_id: tabId,
                    result: Array.isArray(results) ? (results[0]?.result ?? null) : null
                },
                error: null
            });
        }
        catch (error) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>main-world>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    async #handleRuntimeMainWorldProbe(request) {
        const tabId = await this.#resolveTargetTabId(request);
        const commandParams = asRecord(request.params.command_params) ?? {};
        const mainWorldSecret = asNonEmptyString(commandParams.main_world_secret);
        if (!tabId || !mainWorldSecret) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "runtime.main_world_probe requires target_tab_id and main_world_secret"
                }
            });
            return;
        }
        if (!this.chromeApi.scripting?.executeScript) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "chrome.scripting.executeScript is unavailable"
                }
            });
            return;
        }
        const { requestEvent, resultEvent } = resolveMainWorldEventNamesForSecret(mainWorldSecret);
        try {
            const results = await this.chromeApi.scripting.executeScript({
                target: { tabId },
                world: "MAIN",
                func: async (requestEventName, resultEventName) => {
                    const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
                    const requestEvent = typeof requestEventName === "string" ? requestEventName : "";
                    const resultEvent = typeof resultEventName === "string" ? resultEventName : "";
                    const state = {
                        ready_state: document.readyState,
                        href: location.href,
                        plugins_length: typeof navigator.plugins?.length === "number" ? navigator.plugins.length : null,
                        mime_types_length: typeof navigator.mimeTypes?.length === "number" ? navigator.mimeTypes.length : null,
                        has_get_battery: typeof navigator.getBattery === "function"
                    };
                    if (!requestEvent || !resultEvent) {
                        return {
                            ...state,
                            probe_response_received: false,
                            error: "invalid probe event names"
                        };
                    }
                    return await new Promise((resolve) => {
                        let settled = false;
                        const timer = setTimeout(() => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            window.removeEventListener(resultEvent, onResult);
                            resolve({
                                ...state,
                                probe_response_received: false,
                                error: "main world probe timeout"
                            });
                        }, 1_500);
                        const onResult = (event) => {
                            if (settled) {
                                return;
                            }
                            settled = true;
                            clearTimeout(timer);
                            window.removeEventListener(resultEvent, onResult);
                            const detail = typeof event.detail === "object" &&
                                event.detail !== null
                                ? event.detail
                                : null;
                            resolve({
                                ...state,
                                probe_response_received: true,
                                probe_result: detail
                            });
                        };
                        window.addEventListener(resultEvent, onResult);
                        window.dispatchEvent(new CustomEvent(MAIN_WORLD_EVENT_BOOTSTRAP, {
                            detail: {
                                request_event: requestEvent,
                                result_event: resultEvent
                            }
                        }));
                        window.dispatchEvent(new CustomEvent(requestEvent, {
                            detail: {
                                id: `probe-${Date.now()}`,
                                type: "fingerprint-install",
                                payload: {}
                            }
                        }));
                    });
                },
                args: [requestEvent, resultEvent]
            });
            const payload = Array.isArray(results) && results.length > 0
                ? results[0]?.result
                : undefined;
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: String(request.params.session_id ?? this.#sessionId),
                    run_id: String(request.params.run_id ?? request.id),
                    command: "runtime.main_world_probe",
                    profile: typeof request.profile === "string" ? request.profile : null,
                    tab_id: tabId,
                    relay_path: "host>background>main-world>background>host"
                },
                payload: {
                    target_tab_id: tabId,
                    request_event: requestEvent,
                    result_event: resultEvent,
                    ...(payload ? { probe: payload } : {})
                },
                error: null
            });
        }
        catch (error) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>main-world>background>host"
                },
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
    #handleRuntimeTrustedFingerprintProbe(request) {
        const profile = asNonEmptyString(request.profile);
        const sessionId = asNonEmptyString(request.params.session_id) ?? this.#sessionId;
        const bootstrap = profile ? this.#runtimeTrustState.getBootstrap(profile) : null;
        const sourceBinding = this.#resolveRequestTargetBinding(request);
        const trusted = profile !== null
            ? this.#runtimeTrustState.getTrusted(profile, sessionId)
            : null;
        const profileEntries = profile === null
            ? []
            : this.#runtimeTrustState.listTrustedByProfile(profile)
                .map(([key, entry]) => ({
                key,
                session_id: entry.sessionId,
                run_id: entry.runId,
                runtime_context_id: entry.runtimeContextId,
                source_tab_id: entry.sourceTabId,
                source_domain: entry.sourceDomain
            }));
        this.#emit({
            id: request.id,
            status: "success",
            summary: {
                session_id: sessionId,
                run_id: String(request.params.run_id ?? request.id),
                command: "runtime.trusted_fingerprint_probe",
                profile,
                relay_path: "host>background"
            },
            payload: {
                trusted_context_present: trusted !== null,
                trusted_context: trusted
                    ? {
                        session_id: trusted.sessionId,
                        run_id: trusted.runId,
                        runtime_context_id: trusted.runtimeContextId,
                        source_tab_id: trusted.sourceTabId,
                        source_domain: trusted.sourceDomain,
                        fingerprint_runtime: trusted.fingerprintRuntime
                    }
                    : null,
                debug: {
                    background_session_id: this.#sessionId,
                    request_session_id: sessionId,
                    resolved_request_target_binding: sourceBinding
                        ? {
                            tab_id: sourceBinding.tabId,
                            domain: sourceBinding.domain
                        }
                        : null,
                    bootstrap_state: bootstrap
                        ? {
                            session_id: bootstrap.sessionId,
                            run_id: bootstrap.runId,
                            runtime_context_id: bootstrap.runtimeContextId,
                            status: bootstrap.status
                        }
                        : null,
                    profile_entries: profileEntries
                }
            },
            error: null
        });
    }
    #handleRuntimeReadiness(request) {
        const profile = asNonEmptyString(request.profile);
        const bootstrap = profile ? this.#runtimeTrustState.getBootstrap(profile) : null;
        const requestRunId = asNonEmptyString(request.params.run_id);
        const readinessCommandParams = asRecord(request.params.command_params) ?? {};
        const requestRuntimeContextId = asNonEmptyString(readinessCommandParams.runtime_context_id);
        const sessionMatches = !!bootstrap && bootstrap.sessionId === this.#sessionId;
        const runMatches = !!bootstrap && !!requestRunId && bootstrap.runId === requestRunId;
        const runtimeContextMatches = !!bootstrap &&
            (!requestRuntimeContextId || bootstrap.runtimeContextId === requestRuntimeContextId);
        const bootstrapState = bootstrap === null
            ? "not_started"
            : sessionMatches && runMatches && runtimeContextMatches
                ? bootstrap.status
                : "stale";
        this.#emit({
            id: request.id,
            status: "success",
            summary: {
                session_id: this.#sessionId,
                run_id: String(request.params.run_id ?? request.id),
                command: "runtime.readiness",
                profile,
                relay_path: "host>background"
            },
            payload: {
                profile,
                bootstrap_state: bootstrapState,
                run_id: bootstrap?.runId ?? null,
                runtime_context_id: bootstrap?.runtimeContextId ?? null,
                version: bootstrap?.version ?? null,
                transport_state: "ready"
            },
            error: null
        });
    }
    #handleRuntimeBootstrapForwardResult(input) {
        const profile = asNonEmptyString(input.request.profile);
        const bootstrap = profile ? this.#runtimeTrustState.getBootstrap(profile) : null;
        const ackResult = asRecord(input.payload.result);
        const ackVersion = asNonEmptyString(ackResult?.version);
        const ackRunId = asNonEmptyString(ackResult?.run_id);
        const ackRuntimeContextId = asNonEmptyString(ackResult?.runtime_context_id);
        const ackProfile = asNonEmptyString(ackResult?.profile);
        const ackStatus = asNonEmptyString(ackResult?.status);
        if (input.result.ok !== true) {
            if (bootstrap && profile) {
                bootstrap.status = "pending";
                bootstrap.updatedAt = new Date().toISOString();
                this.#runtimeTrustState.setBootstrap(profile, bootstrap);
            }
            if (input.suppressHostResponse) {
                return;
            }
            this.#emit({
                id: input.request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                payload: input.payload,
                error: input.result.error ?? {
                    code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
                    message: "runtime bootstrap 尚未获得执行面确认"
                }
            });
            return;
        }
        if (!bootstrap || !profile || !ackVersion || !ackRunId || !ackRuntimeContextId || !ackProfile || !ackStatus) {
            if (input.suppressHostResponse) {
                return;
            }
            this.#emit({
                id: input.request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                payload: input.payload,
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "runtime bootstrap ack 与当前运行上下文不一致"
                }
            });
            return;
        }
        const isContextMatch = ackVersion === bootstrap.version &&
            ackRunId === bootstrap.runId &&
            ackRuntimeContextId === bootstrap.runtimeContextId &&
            ackProfile === bootstrap.profile;
        if (ackStatus === "stale" && isContextMatch) {
            bootstrap.status = "stale";
            bootstrap.updatedAt = new Date().toISOString();
            this.#runtimeTrustState.setBootstrap(profile, bootstrap);
            if (input.suppressHostResponse) {
                return;
            }
            this.#emit({
                id: input.request.id,
                status: "success",
                summary: {
                    session_id: String(input.request.params.session_id ?? "nm-session-001"),
                    run_id: String(input.request.params.run_id ?? input.request.id),
                    command: String(input.request.params.command ?? "runtime.bootstrap"),
                    profile,
                    cwd: String(input.request.params.cwd ?? ""),
                    tab_id: input.sender.tab?.id ?? null,
                    relay_path: "host>background>content-script>background>host"
                },
                payload: input.payload,
                error: null
            });
            return;
        }
        if (ackStatus !== "ready" || !isContextMatch || !hasSuccessfulExecutionAttestation(input.payload)) {
            bootstrap.status = "failed";
            bootstrap.updatedAt = new Date().toISOString();
            this.#runtimeTrustState.setBootstrap(profile, bootstrap);
            if (input.suppressHostResponse) {
                return;
            }
            this.#emit({
                id: input.request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                payload: input.payload,
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "runtime bootstrap ack 与当前运行上下文不一致"
                }
            });
            return;
        }
        bootstrap.status = "ready";
        bootstrap.updatedAt = new Date().toISOString();
        this.#runtimeTrustState.setBootstrap(profile, bootstrap);
        const attestedFingerprintRuntime = resolveAttestedFingerprintRuntimeContext(input.payload.fingerprint_runtime ?? null);
        const sourceBinding = this.#resolveRequestTargetBinding(input.request);
        if (attestedFingerprintRuntime &&
            attestedFingerprintRuntime.profile === profile &&
            sourceBinding) {
            this.#upsertTrustedFingerprintContext(profile, bootstrap.sessionId, attestedFingerprintRuntime, {
                sourceTabId: sourceBinding.tabId,
                sourceDomain: sourceBinding.domain,
                runId: bootstrap.runId,
                runtimeContextId: bootstrap.runtimeContextId
            });
        }
        if (input.suppressHostResponse) {
            return;
        }
        this.#emit({
            id: input.request.id,
            status: "success",
            summary: {
                session_id: String(input.request.params.session_id ?? "nm-session-001"),
                run_id: String(input.request.params.run_id ?? input.request.id),
                command: String(input.request.params.command ?? "runtime.bootstrap"),
                profile,
                cwd: String(input.request.params.cwd ?? ""),
                tab_id: input.sender.tab?.id ?? null,
                relay_path: "host>background>content-script>background>host"
            },
            payload: input.payload,
            error: null
        });
    }
    #isRecoveryWindowOpen() {
        const deadline = this.#recoveryDeadlineMs;
        return deadline !== null && Date.now() < deadline;
    }
    #enqueueRecoveryForward(request) {
        this.#recoveryState.queueForward(request);
    }
    async #dispatchForward(request, deadlineMs, options) {
        const requestDeadlineMs = deadlineMs ?? Date.now() + this.#resolveForwardTimeoutMs(request);
        const suppressHostResponse = options?.suppressHostResponse === true;
        const command = String(request.params.command ?? "");
        if (command === "xhs.interact") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "unsupported command"
                }
            });
            return;
        }
        this.#invalidateTrustedFingerprintContextForCommand(request, command);
        const rawCommandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
            ? request.params.command_params
            : {};
        let commandParams = command === "xhs.search"
            ? normalizeXhsSearchCommandParams(rawCommandParams)
            : rawCommandParams;
        const optionParams = asRecord(commandParams.options);
        const validationAction = asNonEmptyString(Object.prototype.hasOwnProperty.call(commandParams, "validation_action")
            ? commandParams.validation_action
            : optionParams?.validation_action);
        const issueScope = asNonEmptyString(Object.prototype.hasOwnProperty.call(commandParams, "issue_scope")
            ? commandParams.issue_scope
            : optionParams?.issue_scope);
        const requestedExecutionMode = parseRequestedExecutionMode(Object.prototype.hasOwnProperty.call(commandParams, "requested_execution_mode")
            ? commandParams.requested_execution_mode
            : optionParams?.requested_execution_mode);
        const issue208EditorInputValidation = command === "xhs.search" &&
            issueScope === "issue_208" &&
            requestedExecutionMode === "live_write" &&
            validationAction === "editor_input";
        const requestedLiveMode = requestedExecutionMode !== null && XHS_LIVE_EXECUTION_MODES.has(requestedExecutionMode);
        const requestedFingerprintContext = resolveFingerprintContext(commandParams);
        let forwardFingerprintContext = command === "xhs.search" ? requestedFingerprintContext : requestedFingerprintContext;
        let tabId;
        let consumerGateResult;
        let gatePayload;
        if (command === "xhs.search") {
            const gateResult = await this.#evaluateXhsTargetGate({
                ...request,
                params: {
                    ...request.params,
                    command_params: commandParams
                }
            });
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
                        command: "xhs.search",
                        profile: typeof request.profile === "string" ? request.profile : null,
                        cwd: String(request.params.cwd ?? ""),
                        tab_id: null,
                        relay_path: "host>background"
                    },
                    payload: createBridgeXhsGateOnlyPayload(request, gateResult.gatePayload),
                    error: null
                });
                return;
            }
            tabId = gateResult.targetTabId;
            commandParams = normalizeXhsSearchCommandParams(commandParams, tabId);
            forwardFingerprintContext =
                requestedLiveMode
                    ? this.#resolveValidatedTrustedFingerprintContext({
                        ...request,
                        params: {
                            ...request.params,
                            command_params: commandParams
                        }
                    }, requestedFingerprintContext) ?? requestedFingerprintContext
                    : requestedFingerprintContext;
        }
        else {
            tabId = await this.#resolveTargetTabId(request);
        }
        if (!tabId) {
            if (suppressHostResponse) {
                return;
            }
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
        if (issue208EditorInputValidation) {
            const editorFocusAttestation = await this.#buildEditorInputFocusAttestation(tabId);
            commandParams = this.#injectEditorFocusAttestation(commandParams, editorFocusAttestation);
        }
        const timeoutMs = requestDeadlineMs - Date.now();
        if (timeoutMs <= 0) {
            if (suppressHostResponse) {
                return;
            }
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
        const timeoutError = command === "runtime.bootstrap"
            ? {
                code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
                message: "runtime bootstrap 尚未获得执行面确认"
            }
            : {
                code: "ERR_TRANSPORT_TIMEOUT",
                message: "content script forward timed out"
            };
        const timeout = setTimeout(() => {
            this.#failPending(request.id, {
                code: timeoutError.code,
                message: timeoutError.message
            });
        }, forwardTimeoutMs);
        this.#pendingState.register(request.id, {
            request,
            timeout,
            consumerGateResult,
            gatePayload,
            suppressHostResponse
        });
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
            await this.#sendMessageWithContentScriptRecovery(tabId, forward);
        }
        catch (error) {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: error instanceof Error ? error.message : "content script dispatch failed"
            });
        }
    }
    #injectEditorFocusAttestation(commandParams, attestation) {
        const normalized = {
            ...commandParams,
            editor_focus_attestation: attestation
        };
        const optionParams = asRecord(commandParams.options);
        const normalizedOptions = optionParams ? { ...optionParams } : {};
        normalizedOptions.editor_focus_attestation = attestation;
        normalized.options = normalizedOptions;
        return normalized;
    }
    #buildEditorInputFocusAttestationRecord(input) {
        return {
            source: "chrome_debugger",
            target_tab_id: input.tabId,
            editable_state: input.editableState,
            focus_confirmed: input.focusConfirmed,
            entry_button_locator: input.entryButton?.locator ?? null,
            entry_button_target_key: input.entryButton?.targetKey ?? null,
            editor_locator: input.editor?.locator ?? null,
            editor_target_key: input.editor?.targetKey ?? null,
            failure_reason: input.failureReason
        };
    }
    #buildEditorInputFailureAttestation(tabId, failureReason, input) {
        return this.#buildEditorInputFocusAttestationRecord({
            tabId,
            editableState: input?.editableState ?? "already_ready",
            entryButton: input?.entryButton ?? null,
            editor: input?.editor ?? null,
            focusConfirmed: false,
            failureReason
        });
    }
    #buildEditorInputSuccessAttestation(tabId, input) {
        return this.#buildEditorInputFocusAttestationRecord({
            tabId,
            editableState: input.editableState,
            entryButton: input.entryButton,
            editor: input.editor,
            focusConfirmed: true,
            failureReason: null
        });
    }
    async #attachEditorInputDebugger(tabId) {
        const debuggerApi = this.chromeApi.debugger;
        if (!debuggerApi) {
            return false;
        }
        try {
            await debuggerApi.attach({ tabId }, debuggerProtocolVersion);
            return true;
        }
        catch {
            return false;
        }
    }
    async #resolveEditorInputAttestationAfterAttach(tabId, input) {
        const { editableState } = input;
        let entryButton = input.entryButton;
        let editor = input.editor;
        if (!editor) {
            return this.#buildEditorInputFailureAttestation(tabId, "EDITOR_ENTRY_NOT_VISIBLE", {
                editableState,
                entryButton,
                editor
            });
        }
        await this.#dispatchEditorInputDebuggerClick(tabId, editor);
        await this.#sleep(50);
        const finalProbe = await this.#probeEditorInputTargets(tabId);
        const focusConfirmed = finalProbe?.editorFocused === true;
        const finalEditor = finalProbe?.editor ?? editor;
        if (!focusConfirmed) {
            return this.#buildEditorInputFailureAttestation(tabId, "EDITOR_FOCUS_NOT_ATTESTED", {
                editableState,
                entryButton,
                editor: finalEditor
            });
        }
        return this.#buildEditorInputSuccessAttestation(tabId, {
            editableState,
            entryButton,
            editor: finalEditor
        });
    }
    async #buildEditorInputFocusAttestation(tabId) {
        const debuggerApi = this.chromeApi.debugger;
        const initialProbe = await this.#probeEditorInputTargets(tabId);
        if (!initialProbe) {
            return this.#buildEditorInputFailureAttestation(tabId, "DEBUGGER_INTERACTION_FAILED");
        }
        let entryButton = initialProbe.entryButton;
        const editor = initialProbe.editor;
        let editableState = "already_ready";
        const attached = await this.#attachEditorInputDebugger(tabId);
        if (!attached) {
            return this.#buildEditorInputFailureAttestation(tabId, "DEBUGGER_ATTACH_FAILED", {
                entryButton,
                editor
            });
        }
        try {
            if (!editor) {
                if (!entryButton) {
                    return this.#buildEditorInputFailureAttestation(tabId, "EDITOR_ENTRY_NOT_VISIBLE", {
                        entryButton,
                        editor
                    });
                }
                await this.#dispatchEditorInputDebuggerClick(tabId, entryButton);
                await this.#sleep(editorInputDebuggerProbeWaitMs);
                const postEntryProbe = await this.#probeEditorInputTargets(tabId);
                if (!postEntryProbe?.editor) {
                    return this.#buildEditorInputFailureAttestation(tabId, "EDITOR_ENTRY_NOT_VISIBLE", {
                        entryButton,
                        editor
                    });
                }
                editableState = "entered";
                entryButton = postEntryProbe.entryButton ?? entryButton;
                return await this.#resolveEditorInputAttestationAfterAttach(tabId, {
                    editableState,
                    entryButton,
                    editor: postEntryProbe.editor
                });
            }
            return await this.#resolveEditorInputAttestationAfterAttach(tabId, {
                editableState,
                entryButton,
                editor
            });
        }
        catch {
            return this.#buildEditorInputFailureAttestation(tabId, "DEBUGGER_INTERACTION_FAILED", {
                editableState,
                entryButton,
                editor
            });
        }
        finally {
            if (attached) {
                try {
                    await debuggerApi?.detach({ tabId });
                }
                catch {
                    // Swallow detach errors to avoid overriding primary failure semantics.
                }
            }
        }
    }
    async #probeEditorInputTargets(tabId) {
        const executeScript = this.chromeApi.scripting?.executeScript;
        if (!executeScript) {
            return null;
        }
        try {
            const results = await executeScript({
                target: { tabId },
                world: "ISOLATED",
                func: (entryLabels, selectors) => {
                    const labels = Array.isArray(entryLabels)
                        ? entryLabels.filter((item) => typeof item === "string")
                        : [];
                    const editorSelectors = Array.isArray(selectors)
                        ? selectors.filter((item) => typeof item === "string")
                        : [];
                    const asVisibleElement = (value) => {
                        if (!(value instanceof HTMLElement)) {
                            return null;
                        }
                        const rect = value.getBoundingClientRect();
                        const style = window.getComputedStyle(value);
                        if (rect.width <= 0 ||
                            rect.height <= 0 ||
                            style.visibility === "hidden" ||
                            style.display === "none") {
                            return null;
                        }
                        return value;
                    };
                    const buildLocator = (element) => {
                        if (typeof element.id === "string" && element.id.length > 0) {
                            return `#${element.id}`;
                        }
                        const className = typeof element.className === "string"
                            ? element.className
                                .split(/\s+/)
                                .map((token) => token.trim())
                                .filter((token) => token.length > 0)
                                .slice(0, 2)
                                .join(".")
                            : "";
                        if (className) {
                            return `${element.tagName.toLowerCase()}.${className}`;
                        }
                        return element.tagName.toLowerCase();
                    };
                    const buildTargetKey = (element) => {
                        const segments = [];
                        let current = element;
                        while (current) {
                            const parent = current.parentElement;
                            const tagName = current.tagName.toLowerCase();
                            if (!parent) {
                                segments.unshift(current.id ? `${tagName}#${current.id}` : tagName);
                                break;
                            }
                            const siblings = Array.from(parent.children).filter((candidate) => candidate instanceof HTMLElement && candidate.tagName === current?.tagName);
                            const position = siblings.indexOf(current) + 1;
                            const idSegment = current.id ? `#${current.id}` : "";
                            segments.unshift(`${tagName}${idSegment}:nth-of-type(${position})`);
                            current = parent;
                        }
                        return segments.join(" > ");
                    };
                    const toTarget = (element) => {
                        if (!element) {
                            return null;
                        }
                        const rect = element.getBoundingClientRect();
                        return {
                            locator: buildLocator(element),
                            targetKey: buildTargetKey(element),
                            centerX: Math.round(rect.left + rect.width / 2),
                            centerY: Math.round(rect.top + rect.height / 2)
                        };
                    };
                    const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
                        .map((entry) => asVisibleElement(entry))
                        .filter((entry) => entry !== null);
                    let entryButton = null;
                    for (const button of buttons) {
                        const text = button.innerText?.trim() ?? button.textContent?.trim() ?? "";
                        if (labels.some((label) => text.includes(label))) {
                            entryButton = button;
                            break;
                        }
                    }
                    let editor = null;
                    for (const selector of editorSelectors) {
                        const candidates = Array.from(document.querySelectorAll(selector))
                            .map((entry) => asVisibleElement(entry))
                            .filter((entry) => entry !== null);
                        if (candidates.length > 0) {
                            const active = document.activeElement;
                            const activeCandidate = active instanceof Element
                                ? candidates.find((candidate) => candidate === active || candidate.contains(active)) ?? null
                                : null;
                            if (activeCandidate) {
                                editor = activeCandidate;
                            }
                            else if (candidates.length === 1) {
                                editor = candidates[0];
                            }
                            else {
                                editor = null;
                            }
                            break;
                        }
                    }
                    const active = document.activeElement;
                    const editorFocused = editor !== null &&
                        (active === editor ||
                            (active instanceof Element && editor.contains(active)));
                    return {
                        entryButton: toTarget(entryButton),
                        editor: toTarget(editor),
                        editorFocused
                    };
                },
                args: [[...editorInputDebuggerEntryLabels], [...editorInputSelectors]]
            });
            return this.#parseEditorInputProbeResult(results[0]?.result ?? null);
        }
        catch {
            return null;
        }
    }
    #parseEditorInputProbeResult(value) {
        const record = asRecord(value);
        if (!record) {
            return null;
        }
        return {
            entryButton: this.#parseEditorInputProbeTarget(record.entryButton),
            editor: this.#parseEditorInputProbeTarget(record.editor),
            editorFocused: record.editorFocused === true
        };
    }
    #parseEditorInputProbeTarget(value) {
        const record = asRecord(value);
        if (!record) {
            return null;
        }
        const locator = asNonEmptyString(record.locator);
        const targetKey = asNonEmptyString(record.targetKey);
        const centerX = typeof record.centerX === "number" ? record.centerX : null;
        const centerY = typeof record.centerY === "number" ? record.centerY : null;
        if (!locator ||
            !targetKey ||
            centerX === null ||
            centerY === null ||
            !Number.isFinite(centerX) ||
            !Number.isFinite(centerY)) {
            return null;
        }
        return {
            locator,
            targetKey,
            centerX,
            centerY
        };
    }
    async #dispatchEditorInputDebuggerClick(tabId, target) {
        const debuggerApi = this.chromeApi.debugger;
        if (!debuggerApi) {
            throw new Error("chrome.debugger is unavailable");
        }
        await debuggerApi.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: target.centerX,
            y: target.centerY,
            button: "left",
            buttons: 0
        });
        await debuggerApi.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: target.centerX,
            y: target.centerY,
            button: "left",
            buttons: 1,
            clickCount: 1
        });
        await debuggerApi.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: target.centerX,
            y: target.centerY,
            button: "left",
            buttons: 0,
            clickCount: 1
        });
    }
    async #sleep(timeoutMs) {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
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
        const { commandParams, targetDomain, targetTabId: initialTargetTabId, targetPage, issueScope, riskState, actionType, abilityActionType, requestedExecutionMode, approvalRecord, validationAction, requestedFingerprintContext } = resolveXhsGateCommandInput(asRecord(request.params.command_params) ?? {});
        let fingerprintExecution = requestedFingerprintContext?.execution ?? null;
        let fingerprintReasonCodes = (Array.isArray(fingerprintExecution?.reason_codes) ? fingerprintExecution.reason_codes : []).filter((code) => typeof code === "string");
        let targetTabId = initialTargetTabId;
        const issue208EditorInputValidation = targetPage === "creator_publish_tab" &&
            requestedExecutionMode === "live_write" &&
            validationAction === "editor_input";
        const requestedLiveMode = requestedExecutionMode !== null && XHS_LIVE_EXECUTION_MODES.has(requestedExecutionMode);
        let fingerprintContextMissing = false;
        let fingerprintContextUntrusted = false;
        let fingerprintLiveBlocked = false;
        let fingerprintGateDecision = "allowed";
        let resolvedFingerprintReasonCodes = [...fingerprintReasonCodes];
        const gateReasons = [];
        let writeGateOnlyApprovalDecision = null;
        let writeGateOnlyEligible = false;
        const pushReason = (reason) => {
            if (!gateReasons.includes(reason)) {
                gateReasons.push(reason);
            }
        };
        if (targetTabId === null && !issue208EditorInputValidation) {
            targetTabId = await this.#resolveTargetTabId({
                ...request,
                params: {
                    ...request.params,
                    command_params: commandParams
                }
            });
        }
        const gateState = buildXhsGatePolicyState({
            issueScope,
            riskState,
            actionType,
            requestedExecutionMode
        });
        collectXhsCommandGateReasons({
            gateReasons,
            actionType,
            requestedExecutionMode,
            abilityAction: abilityActionType,
            targetDomain,
            targetTabId,
            targetPage,
            issue208WriteGateOnly: gateState.issue208WriteGateOnly,
            issue208EditorInputValidation,
            treatMissingEditorValidationAsUnsupported: false
        });
        const matrixResolution = collectXhsMatrixGateReasons({
            gateReasons,
            state: gateState,
            approvalRecord,
            issue208EditorInputValidation
        });
        writeGateOnlyEligible = matrixResolution.writeGateOnlyEligible;
        writeGateOnlyApprovalDecision = matrixResolution.writeGateOnlyApprovalDecision;
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
                    if (issue208EditorInputValidation &&
                        !isCreatorArticlePublishPage(tabUrl, targetDomain)) {
                        pushReason("TARGET_PAGE_ARTICLE_REQUIRED");
                    }
                }
            }
        }
        const shouldEvaluateTrustedFingerprintGate = requestedLiveMode &&
            (!gateState.issue208WriteGateOnly || writeGateOnlyEligible) &&
            gateReasons.length === 0;
        if (shouldEvaluateTrustedFingerprintGate) {
            const trustedGateRequest = {
                ...request,
                params: {
                    ...request.params,
                    command_params: normalizeXhsSearchCommandParams(commandParams, targetTabId)
                }
            };
            const trustedFingerprintContext = this.#resolveValidatedTrustedFingerprintContext(trustedGateRequest, requestedFingerprintContext);
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
        if (gateState.issue208WriteGateOnly) {
            if (!gateReasons.includes(gateState.writeTierReason)) {
                gateReasons.push(gateState.writeTierReason);
            }
        }
        const finalizedGate = finalizeXhsGateOutcome({
            gateReasons,
            state: gateState,
            writeGateOnlyEligible,
            nonBlockingReasons: [gateState.writeTierReason]
        });
        const gateDecision = finalizedGate.gateDecision;
        const allowed = finalizedGate.allowed;
        const resolvedEffectiveExecutionMode = finalizedGate.effectiveExecutionMode ?? gateState.fallbackMode;
        const requiresManualConfirmation = !gateState.issue208WriteGateOnly &&
            (requestedExecutionMode === "live_read_limited" ||
                requestedExecutionMode === "live_read_high_risk" ||
                requestedExecutionMode === "live_write");
        const consumerGateResult = {
            risk_state: riskState,
            issue_scope: issueScope,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            effective_execution_mode: resolvedEffectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: finalizedGate.gateReasons,
            fingerprint_gate_decision: fingerprintGateDecision,
            fingerprint_reason_codes: resolvedFingerprintReasonCodes,
            write_interaction_tier: gateState.writeActionMatrixDecisions?.write_interaction_tier ?? null
        };
        const runId = String(request.params.run_id ?? request.id);
        const sessionId = String(request.params.session_id ?? this.#sessionId);
        const profile = typeof request.profile === "string" ? request.profile : null;
        const recordedAt = new Date().toISOString();
        const gateAuditSeed = {
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
            effective_execution_mode: resolvedEffectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: finalizedGate.gateReasons,
            approver: approvalRecord.approver,
            approved_at: approvalRecord.approved_at,
            write_interaction_tier: gateState.writeActionMatrixDecisions?.write_interaction_tier ?? null,
            write_matrix_decision: gateState.writeMatrixDecision?.decision ?? null,
            recorded_at: recordedAt
        };
        const riskTransitionAudit = buildRiskTransitionAudit({
            runId,
            sessionId,
            issueScope,
            prevState: riskState,
            decision: gateDecision,
            gateReasons: finalizedGate.gateReasons,
            requestedExecutionMode,
            approvalRecord,
            auditRecords: [gateAuditSeed],
            now: gateAuditSeed.recorded_at
        });
        const resolvedRiskState = resolveSharedRiskState(riskTransitionAudit.next_state);
        const gatePayload = createBackgroundXhsGatePayload({
            request,
            issueScope,
            riskState,
            resolvedRiskState,
            targetDomain,
            targetTabId,
            targetPage,
            actionType,
            requestedExecutionMode,
            effectiveExecutionMode: resolvedEffectiveExecutionMode,
            gateDecision,
            gateReasons: finalizedGate.gateReasons,
            requiresManualConfirmation,
            fingerprintGateDecision,
            fingerprintExecution,
            consumerGateResult,
            approvalRecord,
            writeActionMatrixDecisions: gateState.writeActionMatrixDecisions,
            writeMatrixDecision: gateState.writeMatrixDecision,
            writeGateOnlyDecision: writeGateOnlyApprovalDecision,
            riskTransitionAudit
        });
        return {
            allowed,
            targetTabId: allowed ? targetTabId : null,
            errorMessage: allowed
                ? ""
                : xhsGateReasonMessage(finalizedGate.gateReasons[0] ?? "TARGET_TAB_NOT_EXPLICIT"),
            gateOnly: allowed && gateState.issue208WriteGateOnly && !writeGateOnlyEligible,
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
        const pending = this.#pendingState.take(result.id);
        if (!pending) {
            void this.#rememberStartupTrustedFingerprintContext(payload, sender);
            return;
        }
        const request = pending.request;
        const suppressHostResponse = pending.suppressHostResponse === true;
        const command = String(request.params.command ?? "");
        if (command === "runtime.bootstrap") {
            this.#handleRuntimeBootstrapForwardResult({
                request,
                result,
                payload,
                sender,
                suppressHostResponse
            });
            return;
        }
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
            if (suppressHostResponse) {
                return;
            }
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
        if (suppressHostResponse) {
            return;
        }
        const senderTabId = typeof sender.tab?.id === "number" ? sender.tab.id : null;
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
            payload: {
                ...payload,
                ...(senderTabId !== null ? { target_tab_id: senderTabId } : {})
            },
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
        if (typeof commandParams.target_tab_id === "number" &&
            Number.isInteger(commandParams.target_tab_id)) {
            return commandParams.target_tab_id;
        }
        const options = typeof commandParams.options === "object" && commandParams.options !== null
            ? commandParams.options
            : {};
        if (typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)) {
            return options.target_tab_id;
        }
        const command = String(request.params.command ?? "");
        if (command === "runtime.ping" || command === "runtime.bootstrap") {
            const runtimeSurfaceTabs = await this.chromeApi.tabs.query({
                url: ["*://creator.xiaohongshu.com/*", "*://www.xiaohongshu.com/*"]
            });
            const ranked = runtimeSurfaceTabs
                .filter((tab) => typeof tab.id === "number")
                .sort((left, right) => {
                const scoreDiff = scoreXhsRuntimeSurfaceTab(left) - scoreXhsRuntimeSurfaceTab(right);
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
        if (command === "xhs.search") {
            const xhsUrlPatterns = [
                "*://www.xiaohongshu.com/*",
                "*://edith.xiaohongshu.com/*",
                "*://*.xiaohongshu.com/*"
            ];
            const currentWindowTabs = await this.chromeApi.tabs.query({
                currentWindow: true,
                url: xhsUrlPatterns
            });
            const xhsTabs = currentWindowTabs.length > 0
                ? currentWindowTabs
                : await this.chromeApi.tabs.query({
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
        this.#pendingState.fail(id, error, (payload) => {
            this.#emit(payload);
        });
    }
    #failAllPending(error) {
        this.#pendingState.failAll(error, (payload) => {
            this.#emit(payload);
        });
    }
    async #resolveAllowlistedTabDomain(tabId) {
        const tabs = await this.chromeApi.tabs.query({
            url: STARTUP_TRUST_ALLOWLIST_URLS
        });
        const targetTab = tabs.find((tab) => tab.id === tabId);
        const tabUrl = typeof targetTab?.url === "string" ? targetTab.url : "";
        const parsed = parseUrl(tabUrl);
        if (!parsed || !XHS_DOMAIN_ALLOWLIST.has(parsed.hostname)) {
            return null;
        }
        return parsed.hostname;
    }
    async #ensureContentScriptInjected(tabId) {
        if (!this.chromeApi.scripting?.executeScript) {
            return;
        }
        await this.chromeApi.scripting.executeScript({
            target: { tabId },
            world: "ISOLATED",
            files: ["build/content-script.js"]
        });
    }
    async #sendMessageWithContentScriptRecovery(tabId, forward) {
        try {
            await this.chromeApi.tabs.sendMessage(tabId, forward);
            return;
        }
        catch (initialError) {
            try {
                await this.#ensureContentScriptInjected(tabId);
            }
            catch (recoveryError) {
                const initialMessage = initialError instanceof Error ? initialError.message : String(initialError);
                const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
                throw new Error(`content script recovery failed: ${recoveryMessage}; initial dispatch error: ${initialMessage}`);
            }
            await this.chromeApi.tabs.sendMessage(tabId, forward);
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
