import { WRITE_INTERACTION_TIER, ISSUE_SCOPES, getIssueActionMatrixEntry, resolveIssueScope as resolveSharedIssueScope } from "../../../shared/risk-state.js";
import { evaluateXhsGate } from "../../../shared/xhs-gate.js";
export const RELAY_PATH = "host>background>content-script>background>host";
export const LOOPBACK_PLUGIN_GATE_OWNERSHIP = {
    background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
    content_script_gate: ["page_context_check", "action_tier_check"],
    main_world_gate: ["signed_call_scope_check"],
    cli_role: "request_and_result_shell_only"
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const resolveLoopbackIssueScope = (value) => ISSUE_SCOPES.includes(value)
    ? value
    : resolveSharedIssueScope(value);
const resolveLoopbackIssueActionMatrixEntry = (issueScope, riskState) => getIssueActionMatrixEntry(issueScope, riskState);
const cloneAdmissionContext = (admissionContext) => {
    const normalizedAdmissionContext = asRecord(admissionContext);
    if (!normalizedAdmissionContext) {
        return null;
    }
    const approvalEvidence = asRecord(normalizedAdmissionContext.approval_admission_evidence);
    const auditEvidence = asRecord(normalizedAdmissionContext.audit_admission_evidence);
    return {
        ...(approvalEvidence ? { approval_admission_evidence: { ...approvalEvidence } } : {}),
        ...(auditEvidence ? { audit_admission_evidence: { ...auditEvidence } } : {})
    };
};
const bindAdmissionContextToRequest = (input) => {
    const admissionContext = cloneAdmissionContext(input.admissionContext);
    if (!admissionContext) {
        return null;
    }
    return admissionContext;
};
export const buildLoopbackGate = (options, abilityAction, linkage) => {
    const clone = (value) => structuredClone(value);
    const boundAdmissionContext = bindAdmissionContextToRequest({
        admissionContext: asRecord(options.admission_context)
    });
    const issue208EditorInputValidation = options.issue_scope === "issue_208" &&
        options.requested_execution_mode === "live_write" &&
        asString(options.validation_action) === "editor_input";
    const evaluatedGate = evaluateXhsGate({
        runId: linkage?.runId ?? asString(options.run_id),
        sessionId: linkage?.sessionId ?? asString(options.session_id),
        issueScope: options.issue_scope,
        riskState: options.risk_state,
        targetDomain: options.target_domain,
        targetTabId: options.target_tab_id,
        targetPage: options.target_page,
        actionType: options.action_type,
        abilityAction,
        requestedExecutionMode: options.requested_execution_mode,
        legacyRequestedExecutionMode: options.__legacy_requested_execution_mode,
        runtimeProfileRef: options.__runtime_profile_ref ?? linkage?.profile,
        upstreamAuthorizationRequest: options.upstream_authorization_request,
        anonymousIsolationVerified: options.__anonymous_isolation_verified === true,
        targetSiteLoggedIn: options.target_site_logged_in === true,
        approvalRecord: options.approval_record ?? options.approval,
        auditRecord: options.audit_record,
        admissionContext: boundAdmissionContext,
        limitedReadRolloutReadyTrue: options.limited_read_rollout_ready_true === true,
        gateInvocationId: linkage?.gateInvocationId,
        decisionId: linkage?.decisionId,
        approvalId: linkage?.approvalId,
        issue208EditorInputValidation,
        treatMissingEditorValidationAsUnsupported: true,
        includeWriteInteractionTierReason: true,
        writeGateOnlyEligibleBehavior: "block"
    });
    const issueScope = resolveLoopbackIssueScope(evaluatedGate.gate_input.issue_scope);
    return {
        scopeContext: clone(evaluatedGate.scope_context),
        readExecutionPolicy: clone(evaluatedGate.read_execution_policy),
        issueScope,
        issueActionMatrix: clone(evaluatedGate.issue_action_matrix),
        gateInput: clone(evaluatedGate.gate_input),
        gateOutcome: clone(evaluatedGate.gate_outcome),
        consumerGateResult: clone(evaluatedGate.consumer_gate_result),
        requestAdmissionResult: clone(evaluatedGate.request_admission_result),
        approvalRecord: clone(evaluatedGate.approval_record),
        writeInteractionTier: clone(WRITE_INTERACTION_TIER),
        writeActionMatrixDecisions: evaluatedGate.write_action_matrix_decisions
            ? clone(evaluatedGate.write_action_matrix_decisions)
            : null
    };
};
