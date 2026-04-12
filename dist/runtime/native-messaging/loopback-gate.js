import { WRITE_INTERACTION_TIER, ISSUE_SCOPES, getIssueActionMatrixEntry, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../../../shared/risk-state.js";
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
const resolveLoopbackRiskState = (value) => resolveSharedRiskState(value);
const resolveLoopbackIssueScope = (value) => ISSUE_SCOPES.includes(value)
    ? value
    : resolveSharedIssueScope(value);
const resolveLoopbackIssueActionMatrixEntry = (issueScope, riskState) => getIssueActionMatrixEntry(issueScope, riskState);
const bindAdmissionContextToRequest = (input) => {
    const admissionContext = asRecord(input.admissionContext);
    if (!admissionContext) {
        return null;
    }
    const approvalEvidence = asRecord(admissionContext.approval_admission_evidence);
    const auditEvidence = asRecord(admissionContext.audit_admission_evidence);
    return {
        ...(approvalEvidence
            ? {
                approval_admission_evidence: {
                    ...approvalEvidence,
                    run_id: input.runId,
                    session_id: input.sessionId,
                    issue_scope: input.issueScope,
                    target_domain: input.targetDomain,
                    target_tab_id: input.targetTabId,
                    target_page: input.targetPage,
                    action_type: input.actionType,
                    requested_execution_mode: input.requestedExecutionMode
                }
            }
            : {}),
        ...(auditEvidence
            ? {
                audit_admission_evidence: {
                    ...auditEvidence,
                    run_id: input.runId,
                    session_id: input.sessionId,
                    issue_scope: input.issueScope,
                    target_domain: input.targetDomain,
                    target_tab_id: input.targetTabId,
                    target_page: input.targetPage,
                    action_type: input.actionType,
                    requested_execution_mode: input.requestedExecutionMode,
                    risk_state: input.riskState
                }
            }
            : {})
    };
};
export const buildLoopbackGate = (options, abilityAction, linkage) => {
    const clone = (value) => structuredClone(value);
    const resolvedIssueScope = resolveLoopbackIssueScope(options.issue_scope);
    const resolvedRiskState = resolveLoopbackRiskState(options.risk_state);
    const boundAdmissionContext = bindAdmissionContextToRequest({
        admissionContext: asRecord(options.admission_context),
        runId: linkage?.runId ?? asString(options.run_id),
        sessionId: linkage?.sessionId ?? asString(options.session_id),
        issueScope: resolvedIssueScope,
        targetDomain: asString(options.target_domain),
        targetTabId: typeof options.target_tab_id === "number" ? options.target_tab_id : null,
        targetPage: asString(options.target_page),
        actionType: asString(options.action_type),
        requestedExecutionMode: asString(options.requested_execution_mode),
        riskState: resolvedRiskState
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
        approvalRecord: options.approval_record ?? options.approval,
        auditRecord: options.audit_record,
        admissionContext: boundAdmissionContext,
        limitedReadRolloutReadyTrue: options.limited_read_rollout_ready_true === true,
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
        approvalRecord: clone(evaluatedGate.approval_record),
        writeInteractionTier: clone(WRITE_INTERACTION_TIER),
        writeActionMatrixDecisions: evaluatedGate.write_action_matrix_decisions
            ? clone(evaluatedGate.write_action_matrix_decisions)
            : null
    };
};
