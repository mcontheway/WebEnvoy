import { buildRiskTransitionAudit, buildUnifiedRiskStateOutput, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../shared/risk-state.js";
import { evaluateXhsGate } from "../shared/xhs-gate.js";
import { classifyPageKind } from "./xhs-search-observability.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const resolveRiskState = (value) => resolveSharedRiskState(value);
const resolveIssueScope = (value) => resolveSharedIssueScope(value);
export const isIssue208EditorInputValidation = (options) => options.issue_scope === "issue_208" &&
    options.action_type === "write" &&
    options.requested_execution_mode === "live_write" &&
    options.validation_action === "editor_input";
export const resolveEditorValidationText = (options) => typeof options.validation_text === "string" && options.validation_text.trim().length > 0
    ? options.validation_text.trim()
    : "WebEnvoy editor_input validation";
export const resolveEditorFocusAttestation = (options) => {
    const record = asRecord(options.editor_focus_attestation);
    if (!record) {
        return null;
    }
    const source = typeof record.source === "string" ? record.source : null;
    const targetTabId = typeof record.target_tab_id === "number" && Number.isInteger(record.target_tab_id)
        ? record.target_tab_id
        : null;
    const editableState = record.editable_state === "entered" || record.editable_state === "already_ready"
        ? record.editable_state
        : null;
    if (source !== "chrome_debugger" || targetTabId === null || editableState === null) {
        return null;
    }
    return {
        source,
        target_tab_id: targetTabId,
        editable_state: editableState,
        focus_confirmed: record.focus_confirmed === true,
        entry_button_locator: typeof record.entry_button_locator === "string" ? record.entry_button_locator : null,
        entry_button_target_key: typeof record.entry_button_target_key === "string" ? record.entry_button_target_key : null,
        editor_locator: typeof record.editor_locator === "string" ? record.editor_locator : null,
        editor_target_key: typeof record.editor_target_key === "string" ? record.editor_target_key : null,
        failure_reason: typeof record.failure_reason === "string" ? record.failure_reason : null
    };
};
export const resolveGate = (options) => evaluateXhsGate({
    issueScope: options.issue_scope,
    riskState: options.risk_state,
    targetDomain: options.target_domain,
    targetTabId: options.target_tab_id,
    targetPage: options.target_page,
    actualTargetDomain: options.actual_target_domain,
    actualTargetTabId: options.actual_target_tab_id,
    actualTargetPage: options.actual_target_page,
    requireActualTargetPage: true,
    actionType: options.action_type,
    abilityAction: options.ability_action,
    requestedExecutionMode: options.requested_execution_mode,
    approvalRecord: options.approval_record ?? options.approval,
    issue208EditorInputValidation: isIssue208EditorInputValidation(options),
    treatMissingEditorValidationAsUnsupported: true
});
export const resolveRiskStateOutput = (gate, auditRecord) => buildUnifiedRiskStateOutput(resolveRiskState(auditRecord?.next_state ?? gate.gate_input.risk_state), {
    auditRecords: auditRecord ? [auditRecord] : [],
    now: auditRecord?.recorded_at ?? Date.now()
});
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
            approval_record: gate.approval_record,
            risk_state_output: resolveRiskStateOutput(gate, auditRecord),
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
export const buildEditorInputEvidence = (result) => ({
    validation_action: "editor_input",
    target_page: "creator.xiaohongshu.com/publish",
    validation_mode: result.mode,
    validation_attestation: result.attestation,
    editor_locator: result.editor_locator,
    input_text: result.input_text,
    before_text: result.before_text,
    visible_text: result.visible_text,
    post_blur_text: result.post_blur_text,
    focus_confirmed: result.focus_confirmed,
    focus_attestation_source: result.focus_attestation_source,
    focus_attestation_reason: result.focus_attestation_reason,
    preserved_after_blur: result.preserved_after_blur,
    success_signals: result.success_signals,
    failure_signals: result.failure_signals,
    minimum_replay: result.minimum_replay,
    out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
});
export const isTrustedEditorInputValidation = (result) => result.ok &&
    result.mode === "controlled_editor_input_validation" &&
    result.attestation === "controlled_real_interaction";
export const createAuditRecord = (context, gate, env) => {
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
        issueScope: resolveIssueScope(gate.gate_input.issue_scope),
        prevState: resolveRiskState(gate.gate_input.risk_state),
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
export const resolveTargetContextMismatchReasons = (options) => {
    const gateReasons = [];
    const targetDomain = asNonEmptyString(options.target_domain);
    const targetTabId = typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)
        ? options.target_tab_id
        : null;
    const targetPage = asNonEmptyString(options.target_page);
    const actualTargetDomain = asNonEmptyString(options.actual_target_domain);
    const actualTargetTabId = typeof options.actual_target_tab_id === "number" && Number.isInteger(options.actual_target_tab_id)
        ? options.actual_target_tab_id
        : null;
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
