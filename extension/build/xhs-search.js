import { buildRiskTransitionAudit } from "../shared/risk-state.js";
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const REQUESTED_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const RISK_STATES = new Set(["paused", "limited", "allowed"]);
const READ_EXECUTION_POLICY = {
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
const ISSUE_209_ACTION_MATRIX = {
    paused: {
        issue_scope: "issue_209",
        state: "paused",
        allowed_actions: ["dry_run", "recon"],
        conditional_actions: [],
        blocked_actions: [
            "live_read_limited",
            "live_read_high_risk",
            "live_write",
            "irreversible_write",
            "expand_new_live_surface_without_gate"
        ]
    },
    limited: {
        issue_scope: "issue_209",
        state: "limited",
        allowed_actions: ["dry_run", "recon"],
        conditional_actions: [
            {
                action: "live_read_limited",
                requires: [
                    "approval_record_approved_true",
                    "approval_record_approver_present",
                    "approval_record_approved_at_present",
                    "approval_record_checks_all_true"
                ]
            }
        ],
        blocked_actions: [
            "live_read_high_risk",
            "live_write",
            "irreversible_write",
            "expand_new_live_surface_without_gate"
        ]
    },
    allowed: {
        issue_scope: "issue_209",
        state: "allowed",
        allowed_actions: ["dry_run", "recon"],
        conditional_actions: [
            {
                action: "live_read_limited",
                requires: [
                    "approval_record_approved_true",
                    "approval_record_approver_present",
                    "approval_record_approved_at_present",
                    "approval_record_checks_all_true"
                ]
            },
            {
                action: "live_read_high_risk",
                requires: [
                    "approval_record_approved_true",
                    "approval_record_approver_present",
                    "approval_record_approved_at_present",
                    "approval_record_checks_all_true"
                ]
            }
        ],
        blocked_actions: ["live_write", "irreversible_write", "expand_new_live_surface_without_gate"]
    }
};
const REQUIRED_APPROVAL_CHECKS = [
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "risk_state_checked",
    "action_type_confirmed"
];
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asArray = (value) => (Array.isArray(value) ? value : null);
const asBoolean = (value) => value === true;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const resolveActionType = (value) => typeof value === "string" && ACTION_TYPES.has(value)
    ? value
    : null;
const resolveRequestedExecutionMode = (value) => typeof value === "string" && REQUESTED_EXECUTION_MODES.has(value)
    ? value
    : null;
const resolveRiskState = (value) => typeof value === "string" && RISK_STATES.has(value)
    ? value
    : "paused";
const resolveIssue209Matrix = (state) => {
    const entry = ISSUE_209_ACTION_MATRIX[state];
    return {
        issue_scope: entry.issue_scope,
        state: entry.state,
        allowed_actions: [...entry.allowed_actions],
        conditional_actions: entry.conditional_actions.map((item) => ({
            action: item.action,
            requires: [...item.requires]
        })),
        blocked_actions: [...entry.blocked_actions]
    };
};
const resolveReadExecutionPolicy = () => ({
    default_mode: READ_EXECUTION_POLICY.default_mode,
    allowed_modes: [...READ_EXECUTION_POLICY.allowed_modes],
    blocked_actions: [...READ_EXECUTION_POLICY.blocked_actions],
    live_entry_requirements: [...READ_EXECUTION_POLICY.live_entry_requirements]
});
const resolveFallbackMode = (requestedExecutionMode, riskState) => {
    if (requestedExecutionMode === "live_write") {
        return "dry_run";
    }
    return riskState === "limited" ? "recon" : "dry_run";
};
const normalizeApprovalRecord = (value) => {
    const record = asRecord(value);
    const checksRecord = asRecord(record?.checks);
    const checks = Object.fromEntries(REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])]));
    return {
        approved: asBoolean(record?.approved),
        approver: asNonEmptyString(record?.approver),
        approved_at: asNonEmptyString(record?.approved_at),
        checks
    };
};
const resolveGate = (options) => {
    const actionType = resolveActionType(options.action_type);
    const requestedExecutionMode = resolveRequestedExecutionMode(options.requested_execution_mode);
    const riskState = resolveRiskState(options.risk_state);
    const readExecutionPolicy = resolveReadExecutionPolicy();
    const issueActionMatrix = resolveIssue209Matrix(riskState);
    const fallbackMode = resolveFallbackMode(requestedExecutionMode ?? "dry_run", riskState);
    const targetDomain = asNonEmptyString(options.target_domain);
    const targetTabId = asInteger(options.target_tab_id);
    const targetPage = asNonEmptyString(options.target_page);
    const actualTargetDomain = asNonEmptyString(options.actual_target_domain);
    const actualTargetTabId = asInteger(options.actual_target_tab_id);
    const actualTargetPage = asNonEmptyString(options.actual_target_page);
    const abilityAction = asNonEmptyString(options.ability_action);
    const approvalRecord = normalizeApprovalRecord(options.approval_record ?? options.approval);
    const gateReasons = [];
    let gateDecision = "allowed";
    let effectiveExecutionMode = requestedExecutionMode;
    if (!targetDomain) {
        gateReasons.push("TARGET_DOMAIN_NOT_EXPLICIT");
    }
    else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
        gateReasons.push("TARGET_DOMAIN_OUT_OF_SCOPE");
    }
    if (targetTabId === null || targetTabId <= 0) {
        gateReasons.push("TARGET_TAB_NOT_EXPLICIT");
    }
    if (!targetPage) {
        gateReasons.push("TARGET_PAGE_NOT_EXPLICIT");
    }
    if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
        gateReasons.push("TARGET_DOMAIN_CONTEXT_MISMATCH");
    }
    if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
        gateReasons.push("TARGET_TAB_CONTEXT_MISMATCH");
    }
    if (targetPage && !actualTargetPage) {
        gateReasons.push("TARGET_PAGE_CONTEXT_UNRESOLVED");
    }
    if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
        gateReasons.push("TARGET_PAGE_CONTEXT_MISMATCH");
    }
    if (!actionType) {
        gateReasons.push("ACTION_TYPE_NOT_EXPLICIT");
    }
    if (!requestedExecutionMode) {
        gateReasons.push("REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
    }
    if (abilityAction && actionType && abilityAction !== actionType) {
        gateReasons.push("ABILITY_ACTION_CONTEXT_MISMATCH");
    }
    else if (actionType && actionType !== "read") {
        gateReasons.push("ACTION_TYPE_UNSUPPORTED_FOR_COMMAND");
    }
    if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
        gateReasons.push("IRREVERSIBLE_WRITE_NOT_ALLOWED");
    }
    if (requestedExecutionMode === "live_write") {
        gateReasons.push("EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
    }
    if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
        gateReasons.push("ACTION_DOMAIN_MISMATCH");
    }
    if (targetDomain === XHS_READ_DOMAIN && actionType !== "read") {
        gateReasons.push("ACTION_DOMAIN_MISMATCH");
    }
    if (gateReasons.length > 0) {
        gateDecision = "blocked";
        if (requestedExecutionMode === "live_read_limited" ||
            requestedExecutionMode === "live_read_high_risk" ||
            requestedExecutionMode === "live_write") {
            effectiveExecutionMode = fallbackMode;
        }
    }
    else if (requestedExecutionMode === "dry_run" || requestedExecutionMode === "recon") {
        gateReasons.push(requestedExecutionMode === "recon" ? "DEFAULT_MODE_RECON" : "DEFAULT_MODE_DRY_RUN");
    }
    else {
        effectiveExecutionMode = fallbackMode;
        gateDecision = "blocked";
        if (requestedExecutionMode === "live_read_high_risk" && actionType !== "read") {
            gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
        }
        if (requestedExecutionMode === "live_read_limited" && actionType !== "read") {
            gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
        }
        if (requestedExecutionMode === "live_write" && actionType === "read") {
            gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
        }
        if (requestedExecutionMode &&
            !issueActionMatrix.conditional_actions.some((entry) => entry.action === requestedExecutionMode) &&
            (requestedExecutionMode === "live_read_limited" ||
                requestedExecutionMode === "live_read_high_risk")) {
            gateReasons.push(`RISK_STATE_${riskState.toUpperCase()}`);
            gateReasons.push("ISSUE_ACTION_MATRIX_BLOCKED");
        }
        const liveModeCanEnter = requestedExecutionMode !== null &&
            issueActionMatrix.conditional_actions.some((entry) => entry.action === requestedExecutionMode) &&
            (requestedExecutionMode === "live_read_limited" ||
                requestedExecutionMode === "live_read_high_risk");
        if (liveModeCanEnter) {
            const missingChecks = REQUIRED_APPROVAL_CHECKS.filter((key) => !approvalRecord.checks[key]);
            if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
                gateReasons.push("MANUAL_CONFIRMATION_MISSING");
            }
            if (missingChecks.length > 0) {
                gateReasons.push("APPROVAL_CHECKS_INCOMPLETE");
            }
            if (gateReasons.length === 0) {
                gateDecision = "allowed";
                effectiveExecutionMode = requestedExecutionMode;
                gateReasons.push("LIVE_MODE_APPROVED");
            }
        }
    }
    return {
        scope_context: {
            platform: "xhs",
            read_domain: XHS_READ_DOMAIN,
            write_domain: XHS_WRITE_DOMAIN,
            domain_mixing_forbidden: true
        },
        read_execution_policy: readExecutionPolicy,
        issue_action_matrix: issueActionMatrix,
        gate_input: {
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            risk_state: riskState
        },
        gate_outcome: {
            effective_execution_mode: effectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: gateReasons,
            requires_manual_confirmation: requestedExecutionMode === "live_read_limited" ||
                requestedExecutionMode === "live_read_high_risk" ||
                requestedExecutionMode === "live_write"
        },
        consumer_gate_result: {
            risk_state: riskState,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            action_type: actionType,
            requested_execution_mode: requestedExecutionMode,
            effective_execution_mode: effectiveExecutionMode,
            gate_decision: gateDecision,
            gate_reasons: gateReasons
        },
        approval_record: approvalRecord
    };
};
const createGateOnlySuccess = (input, gate, auditRecord, env) => ({
    ok: true,
    payload: {
        summary: {
            capability_result: {
                ability_id: input.abilityId,
                layer: input.abilityLayer,
                action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                outcome: "partial",
                data_ref: {
                    query: input.params.query
                },
                metrics: {
                    count: 0
                }
            },
            scope_context: gate.scope_context,
            gate_input: {
                run_id: auditRecord.run_id,
                session_id: auditRecord.session_id,
                profile: auditRecord.profile,
                ...gate.gate_input
            },
            gate_outcome: gate.gate_outcome,
            read_execution_policy: gate.read_execution_policy,
            issue_action_matrix: gate.issue_action_matrix,
            consumer_gate_result: gate.consumer_gate_result,
            approval_record: gate.approval_record,
            audit_record: auditRecord
        },
        observability: {
            page_state: {
                page_kind: classifyPageKind(env.getLocationHref()),
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: null
        }
    }
});
const containsCookie = (cookie, key) => cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${key}=`));
const classifyPageKind = (href) => {
    if (href.includes("/login")) {
        return "login";
    }
    if (href.includes("/search_result")) {
        return "search";
    }
    if (href.includes("/explore/")) {
        return "detail";
    }
    return "unknown";
};
const createObservability = (input) => ({
    page_state: {
        page_kind: classifyPageKind(input.href),
        url: input.href,
        title: input.title,
        ready_state: input.readyState
    },
    key_requests: [
        {
            request_id: input.requestId,
            stage: "request",
            method: "POST",
            url: SEARCH_ENDPOINT,
            outcome: input.outcome,
            ...(typeof input.statusCode === "number" ? { status_code: input.statusCode } : {}),
            ...(input.failureReason ? { failure_reason: input.failureReason, request_class: "xhs.search" } : {})
        }
    ],
    failure_site: input.outcome === "failed"
        ? {
            stage: "request",
            component: "network",
            target: SEARCH_ENDPOINT,
            summary: input.failureReason ?? "request failed"
        }
        : null
});
const createDiagnosis = (input) => ({
    category: input.category,
    stage: input.category === "page_changed" ? "execution" : "request",
    component: input.category === "page_changed" ? "page" : "network",
    failure_site: {
        stage: input.category === "page_changed" ? "execution" : "request",
        component: input.category === "page_changed" ? "page" : "network",
        target: input.category === "page_changed" ? "window._webmsxyw" : SEARCH_ENDPOINT,
        summary: input.summary
    },
    evidence: [input.reason, input.summary]
});
const createFailure = (code, message, details, observability, diagnosis, gate, auditRecord) => ({
    ok: false,
    error: {
        code,
        message
    },
    payload: {
        details,
        observability,
        diagnosis,
        ...(gate
            ? {
                scope_context: gate.scope_context,
                gate_input: {
                    run_id: auditRecord?.run_id ?? "unknown",
                    session_id: auditRecord?.session_id ?? "unknown",
                    profile: auditRecord?.profile ?? "unknown",
                    ...gate.gate_input
                },
                gate_outcome: gate.gate_outcome,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                ...(auditRecord ? { audit_record: auditRecord } : {})
            }
            : {})
    }
});
const createAuditRecord = (context, gate, env) => {
    const recordedAt = new Date(env.now()).toISOString();
    const requestedMode = gate.consumer_gate_result.requested_execution_mode;
    const liveModeRequested = requestedMode === "live_read_limited" ||
        requestedMode === "live_read_high_risk" ||
        requestedMode === "live_write";
    const riskSignal = gate.consumer_gate_result.gate_decision === "blocked" && liveModeRequested;
    const recoverySignal = gate.consumer_gate_result.gate_decision === "allowed" &&
        gate.gate_input.risk_state === "limited" &&
        liveModeRequested;
    const auditRecord = {
        event_id: `gate_evt_${env.randomId()}`,
        run_id: context.runId,
        session_id: context.sessionId,
        profile: context.profile,
        risk_state: gate.gate_input.risk_state,
        target_domain: gate.consumer_gate_result.target_domain,
        target_tab_id: gate.consumer_gate_result.target_tab_id,
        target_page: gate.consumer_gate_result.target_page,
        action_type: gate.consumer_gate_result.action_type,
        requested_execution_mode: requestedMode,
        effective_execution_mode: gate.consumer_gate_result.effective_execution_mode,
        gate_decision: gate.consumer_gate_result.gate_decision,
        gate_reasons: [...gate.consumer_gate_result.gate_reasons],
        approver: gate.approval_record.approver,
        approved_at: gate.approval_record.approved_at,
        risk_signal: riskSignal,
        recovery_signal: recoverySignal,
        session_rhythm_state: riskSignal ? "cooldown" : recoverySignal ? "recovery" : "normal",
        cooldown_until: riskSignal ? new Date(env.now() + 30 * 60_000).toISOString() : null,
        recovery_started_at: recoverySignal ? recordedAt : null,
        recorded_at: recordedAt
    };
    const transitionAudit = buildRiskTransitionAudit({
        runId: context.runId,
        sessionId: context.sessionId,
        issueScope: "issue_209",
        prevState: gate.gate_input.risk_state,
        decision: gate.consumer_gate_result.gate_decision,
        gateReasons: [...gate.consumer_gate_result.gate_reasons],
        requestedExecutionMode: gate.consumer_gate_result.requested_execution_mode,
        approvalRecord: gate.approval_record,
        auditRecords: [auditRecord],
        now: recordedAt
    });
    auditRecord.next_state = transitionAudit.next_state;
    auditRecord.transition_trigger = transitionAudit.trigger;
    return auditRecord;
};
const resolveSimulatedResult = (simulated, params, options, env) => {
    if (!simulated) {
        return null;
    }
    const requestId = `req-${env.randomId()}`;
    const observability = createObservability({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId,
        outcome: simulated === "success" ? "completed" : "failed",
        statusCode: simulated === "account_abnormal"
            ? 461
            : simulated === "browser_env_abnormal"
                ? 200
                : simulated === "gateway_invoker_failed"
                    ? 500
                    : undefined,
        failureReason: simulated === "success" ? undefined : simulated
    });
    if (simulated === "success") {
        return {
            ok: true,
            payload: {
                summary: {
                    capability_result: {
                        ability_id: "xhs.note.search.v1",
                        layer: "L3",
                        action: "read",
                        outcome: "success",
                        data_ref: {
                            query: params.query,
                            search_id: params.search_id ?? "simulated-search-id"
                        },
                        metrics: {
                            count: Number(options.timeout_ms ?? 2) > 0 ? 2 : 2
                        }
                    }
                },
                observability
            }
        };
    }
    const reasonMap = {
        login_required: {
            reason: "SESSION_EXPIRED",
            message: "登录态缺失，无法执行 xhs.search",
            category: "request_failed"
        },
        signature_entry_missing: {
            reason: "SIGNATURE_ENTRY_MISSING",
            message: "页面签名入口不可用",
            category: "page_changed"
        },
        account_abnormal: {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求",
            category: "request_failed"
        },
        browser_env_abnormal: {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求",
            category: "request_failed"
        },
        gateway_invoker_failed: {
            reason: "GATEWAY_INVOKER_FAILED",
            message: "网关调用失败，当前上下文不足以完成搜索请求",
            category: "request_failed"
        }
    };
    const mapped = reasonMap[simulated] ?? reasonMap.gateway_invoker_failed;
    return createFailure("ERR_EXECUTION_FAILED", mapped.message, {
        stage: "execution",
        reason: mapped.reason
    }, observability, createDiagnosis({
        category: mapped.category,
        reason: mapped.reason,
        summary: mapped.message
    }));
};
const parseCount = (body) => {
    const record = asRecord(body);
    if (!record) {
        return 0;
    }
    const data = asRecord(record.data);
    const candidateArrays = [
        asArray(record.items),
        asArray(record.notes),
        data ? asArray(data.items) : null,
        data ? asArray(data.notes) : null
    ];
    for (const candidate of candidateArrays) {
        if (candidate) {
            return candidate.length;
        }
    }
    const total = data?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
};
const inferFailure = (status, body) => {
    const record = asRecord(body);
    const businessCode = record?.code;
    const message = typeof record?.msg === "string" ? record.msg : typeof record?.message === "string" ? record.message : "";
    const normalized = `${message}`.toLowerCase();
    if (status === 401 || normalized.includes("login")) {
        return {
            reason: "SESSION_EXPIRED",
            message: "登录已失效，无法执行 xhs.search"
        };
    }
    if (status === 461 || businessCode === 300011) {
        return {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求"
        };
    }
    if (businessCode === 300015 || normalized.includes("browser environment abnormal")) {
        return {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求"
        };
    }
    if (status >= 500 || normalized.includes("create invoker failed")) {
        return {
            reason: "GATEWAY_INVOKER_FAILED",
            message: "网关调用失败，当前上下文不足以完成搜索请求"
        };
    }
    if (status === 429 || normalized.includes("captcha")) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    return {
        reason: "TARGET_API_RESPONSE_INVALID",
        message: "搜索接口返回了未识别的失败响应"
    };
};
const inferRequestException = (error) => {
    const errorName = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorName === "AbortError") {
        return {
            reason: "REQUEST_TIMEOUT",
            message: "请求超时，无法完成 xhs.search",
            detail: errorMessage
        };
    }
    return {
        reason: "REQUEST_DISPATCH_FAILED",
        message: "搜索请求发送失败，无法完成 xhs.search",
        detail: errorMessage
    };
};
const resolveXsCommon = (value) => {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return "{}";
};
export const executeXhsSearch = async (input, env) => {
    const gate = resolveGate(input.options);
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, {
            page_state: {
                page_kind: classifyPageKind(env.getLocationHref()),
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: {
                stage: "execution",
                component: "gate",
                target: "requested_execution_mode",
                summary: "执行模式门禁阻断"
            }
        }, {
            category: "request_failed",
            stage: "execution",
            component: "gate",
            failure_site: {
                stage: "execution",
                component: "gate",
                target: "requested_execution_mode",
                summary: "执行模式门禁阻断"
            },
            evidence: gate.consumer_gate_result.gate_reasons
        }, gate, auditRecord);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, gate, auditRecord, env);
    }
    const simulated = resolveSimulatedResult(input.options.simulate_result, input.params, input.options, env);
    if (simulated) {
        if (simulated.ok) {
            const summary = asRecord(simulated.payload.summary) ?? {};
            const capability = asRecord(summary.capability_result) ?? {};
            capability.ability_id = input.abilityId;
            capability.layer = input.abilityLayer;
            capability.action = gate.consumer_gate_result.action_type ?? input.abilityAction;
            return {
                ok: true,
                payload: {
                    ...simulated.payload,
                    summary: {
                        capability_result: capability,
                        scope_context: gate.scope_context,
                        gate_input: {
                            run_id: auditRecord.run_id,
                            session_id: auditRecord.session_id,
                            profile: auditRecord.profile,
                            ...gate.gate_input
                        },
                        gate_outcome: gate.gate_outcome,
                        read_execution_policy: gate.read_execution_policy,
                        issue_action_matrix: gate.issue_action_matrix,
                        consumer_gate_result: gate.consumer_gate_result,
                        approval_record: gate.approval_record,
                        audit_record: auditRecord
                    }
                }
            };
        }
        return {
            ...simulated,
            payload: {
                ...simulated.payload,
                details: {
                    ability_id: input.abilityId,
                    ...(asRecord(simulated.payload.details) ?? {})
                },
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                audit_record: auditRecord
            }
        };
    }
    const startedAt = env.now();
    const href = env.getLocationHref();
    const title = env.getDocumentTitle();
    const readyState = env.getReadyState();
    const requestId = `req-${env.randomId()}`;
    const timeoutMs = typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
        ? Math.max(1, Math.floor(input.options.timeout_ms))
        : 30_000;
    if (!containsCookie(env.getCookie(), "a1")) {
        return createFailure("ERR_EXECUTION_FAILED", "登录态缺失，无法执行 xhs.search", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createDiagnosis({
            category: "request_failed",
            reason: "SESSION_EXPIRED",
            summary: "登录态缺失，无法执行 xhs.search"
        }), gate, auditRecord);
    }
    const payload = {
        keyword: input.params.query,
        page: input.params.page ?? 1,
        page_size: input.params.limit ?? 20,
        search_id: input.params.search_id ?? env.randomId(),
        sort: input.params.sort ?? "general",
        note_type: input.params.note_type ?? 0
    };
    let signature;
    try {
        signature = await env.callSignature(SEARCH_ENDPOINT, payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SIGNATURE_ENTRY_MISSING"
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: message
        }), createDiagnosis({
            category: "page_changed",
            reason: "SIGNATURE_ENTRY_MISSING",
            summary: "页面签名入口不可用"
        }), gate, auditRecord);
    }
    const headers = {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-s": String(signature["X-s"]),
        "X-t": String(signature["X-t"]),
        "X-S-Common": resolveXsCommon(input.options.x_s_common),
        "x-b3-traceid": env.randomId().replace(/-/g, ""),
        "x-xray-traceid": env.randomId().replace(/-/g, "")
    };
    let response;
    try {
        response = await env.fetchJson({
            url: SEARCH_ENDPOINT,
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            timeoutMs
        });
    }
    catch (error) {
        const failure = inferRequestException(error);
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: failure.detail
        }), createDiagnosis({
            category: "request_failed",
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = responseRecord?.code;
    if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
        const failure = inferFailure(response.status, response.body);
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            statusCode: response.status,
            failureReason: failure.reason
        }), createDiagnosis({
            category: "request_failed",
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord);
    }
    const count = parseCount(response.body);
    return {
        ok: true,
        payload: {
            summary: {
                capability_result: {
                    ability_id: input.abilityId,
                    layer: input.abilityLayer,
                    action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                    outcome: "success",
                    data_ref: {
                        query: input.params.query,
                        search_id: payload.search_id
                    },
                    metrics: {
                        count,
                        duration_ms: Math.max(0, env.now() - startedAt)
                    }
                },
                scope_context: gate.scope_context,
                gate_input: {
                    run_id: auditRecord.run_id,
                    session_id: auditRecord.session_id,
                    profile: auditRecord.profile,
                    ...gate.gate_input
                },
                gate_outcome: gate.gate_outcome,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                audit_record: auditRecord
            },
            observability: createObservability({
                href,
                title,
                readyState,
                requestId,
                outcome: "completed",
                statusCode: response.status
            })
        }
    };
};
