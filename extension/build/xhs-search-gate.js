import { buildRiskTransitionAudit, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../shared/risk-state.js";
import { buildIssue209PostGateArtifacts, evaluateXhsGate, resolveXhsGateDecisionId } from "../shared/xhs-gate.js";
import { resolveRiskStateOutput } from "./xhs-search-telemetry.js";
export { resolveRiskStateOutput } from "./xhs-search-telemetry.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asOptionalBoolean = (value) => typeof value === "boolean" ? value : null;
const resolveRiskState = (value) => resolveSharedRiskState(value);
const resolveIssueScope = (value) => resolveSharedIssueScope(value);
const isIssue208EditorInputValidation = (options) => options.issue_scope === "issue_208" &&
    options.action_type === "write" &&
    options.requested_execution_mode === "live_write" &&
    options.validation_action === "editor_input";
const shouldDeferAnonymousCanonicalGateDiagnostics = (input) => {
    const resourceBinding = asRecord(input.upstreamAuthorizationRequest?.resource_binding);
    return (resourceBinding?.resource_kind === "anonymous_context" &&
        (input.anonymousIsolationVerified === null || input.targetSiteLoggedIn === null));
};
const buildGateDecisionId = (context, options) => resolveXhsGateDecisionId({
    runId: context.runId,
    requestId: context.requestId,
    commandRequestId: context.commandRequestId,
    gateInvocationId: context.gateInvocationId,
    issueScope: options.issue_scope,
    requestedExecutionMode: options.requested_execution_mode
});
const buildGateEventId = (decisionId) => `gate_evt_${decisionId}`;
export const resolveActualTargetGateReasons = (options) => {
    const gateReasons = [];
    const targetDomain = asNonEmptyString(options.target_domain);
    const targetTabId = asInteger(options.target_tab_id);
    const targetPage = asNonEmptyString(options.target_page);
    const actualTargetDomain = asNonEmptyString(options.actual_target_domain);
    const actualTargetTabId = asInteger(options.actual_target_tab_id);
    const actualTargetPage = asNonEmptyString(options.actual_target_page);
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
    return gateReasons;
};
export const resolveGate = (options, context, actualTargetUrl) => {
    const providedApprovalRecord = (options.approval_record ?? options.approval);
    const approvalRecord = asRecord(providedApprovalRecord);
    const decisionId = buildGateDecisionId(context, options);
    const approvalId = asNonEmptyString(approvalRecord?.approval_id) ?? undefined;
    const anonymousIsolationVerified = asOptionalBoolean(options.__anonymous_isolation_verified);
    const targetSiteLoggedIn = asOptionalBoolean(options.target_site_logged_in);
    const gate = evaluateXhsGate({
        issueScope: options.issue_scope,
        riskState: options.risk_state,
        targetDomain: options.target_domain,
        targetTabId: options.target_tab_id,
        targetPage: options.target_page,
        actualTargetDomain: options.actual_target_domain,
        actualTargetTabId: options.actual_target_tab_id,
        actualTargetPage: options.actual_target_page,
        actualTargetUrl,
        requireActualTargetPage: true,
        actionType: options.action_type,
        abilityAction: options.ability_action,
        requestedExecutionMode: options.requested_execution_mode,
        legacyRequestedExecutionMode: options.__legacy_requested_execution_mode,
        runtimeProfileRef: options.__runtime_profile_ref ?? context.profile,
        upstreamAuthorizationRequest: options.upstream_authorization_request,
        ...(anonymousIsolationVerified !== null ? { anonymousIsolationVerified } : {}),
        ...(targetSiteLoggedIn !== null ? { targetSiteLoggedIn } : {}),
        runId: context.runId,
        sessionId: context.sessionId,
        gateInvocationId: context.gateInvocationId,
        approvalRecord: providedApprovalRecord,
        auditRecord: options.audit_record,
        admissionContext: options.admission_context,
        limitedReadRolloutReadyTrue: options.limited_read_rollout_ready_true === true,
        decisionId,
        approvalId,
        issue208EditorInputValidation: isIssue208EditorInputValidation(options),
        treatMissingEditorValidationAsUnsupported: true
    });
    if (shouldDeferAnonymousCanonicalGateDiagnostics({
        upstreamAuthorizationRequest: options.upstream_authorization_request,
        anonymousIsolationVerified,
        targetSiteLoggedIn
    })) {
        return {
            ...gate,
            request_admission_result: null,
            execution_audit: null
        };
    }
    return gate;
};
export const createAuditRecord = (context, gate, env) => {
    if (gate.gate_input.issue_scope === "issue_209" &&
        (gate.consumer_gate_result.requested_execution_mode === "live_read_limited" ||
            gate.consumer_gate_result.requested_execution_mode === "live_read_high_risk")) {
        const artifacts = buildIssue209PostGateArtifacts({
            runId: context.runId,
            sessionId: context.sessionId,
            profile: context.profile,
            gate: gate,
            now: () => env.now()
        });
        gate.approval_record = artifacts.approval_record;
        return artifacts.audit_record;
    }
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
        event_id: buildGateEventId(gate.gate_outcome.decision_id),
        decision_id: gate.gate_outcome.decision_id,
        approval_id: gate.approval_record.approval_id,
        run_id: context.runId,
        session_id: context.sessionId,
        profile: context.profile,
        issue_scope: gate.gate_input.issue_scope,
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
        write_interaction_tier: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
        write_action_matrix_decisions: gate.write_action_matrix_decisions,
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
        issueScope: gate.gate_input.issue_scope,
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
export const createGateOnlySuccess = (input, gate, auditRecord, env) => ({
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
            write_interaction_tier: gate.write_interaction_tier,
            write_action_matrix_decisions: gate.write_action_matrix_decisions,
            consumer_gate_result: gate.consumer_gate_result,
            request_admission_result: gate.request_admission_result,
            execution_audit: gate.execution_audit,
            approval_record: gate.approval_record,
            risk_state_output: resolveRiskStateOutput(gate, auditRecord),
            audit_record: auditRecord
        },
        observability: {
            page_state: {
                page_kind: env.getLocationHref().includes("/login")
                    ? "login"
                    : env.getLocationHref().includes("creator.xiaohongshu.com/publish")
                        ? "compose"
                        : env.getLocationHref().includes("/search_result")
                            ? "search"
                            : env.getLocationHref().includes("/explore/")
                                ? "detail"
                                : "unknown",
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: null
        }
    }
});
