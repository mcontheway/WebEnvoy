import { APPROVAL_CHECK_KEYS, buildRiskTransitionAudit } from "../risk-state.js";
import { resolveIssue209LiveReadApprovalId } from "./identity.js";
import { resolveConsumedIssue209AdmissionEvidence } from "./source.js";

const clone = (value) => structuredClone(value);
const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const normalizeChecks = (value) => {
  const record = asRecord(value);
  return Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, record?.[key] === true]));
};

const ISSUE209_LIVE_READ_MODES = new Set(["live_read_limited", "live_read_high_risk"]);
const NO_ADDITIONAL_RISK_SIGNALS = "NO_ADDITIONAL_RISK_SIGNALS";

const hasExecutionAuditInputs = (requestAdmissionResult) => {
  const derivedFrom = asRecord(requestAdmissionResult?.derived_from);
  return (
    Boolean(asString(requestAdmissionResult?.request_ref)) &&
    Boolean(asString(derivedFrom?.action_request_ref)) &&
    Boolean(asString(derivedFrom?.resource_binding_ref)) &&
    Boolean(asString(derivedFrom?.authorization_grant_ref)) &&
    Boolean(asString(derivedFrom?.runtime_target_ref))
  );
};

const hasApprovalEvidenceValidationIssue = (reasonCodes) =>
  reasonCodes.some(
    (reason) =>
      reason === "MANUAL_CONFIRMATION_MISSING" ||
      reason === "APPROVAL_CHECKS_INCOMPLETE" ||
      reason === "APPROVAL_ADMISSION_REF_OUT_OF_SCOPE"
  );

const hasAuditEvidenceValidationIssue = (reasonCodes) =>
  reasonCodes.some(
    (reason) =>
      reason === "AUDIT_RECORD_MISSING" || reason === "AUDIT_ADMISSION_REF_OUT_OF_SCOPE"
  );

const buildIssue209ExecutionAudit = (input) => {
  const requestAdmissionResult = asRecord(input.gate?.request_admission_result);
  const requestedMode = asString(input.gate?.consumer_gate_result?.requested_execution_mode);
  if (
    !requestAdmissionResult ||
    !requestedMode ||
    !ISSUE209_LIVE_READ_MODES.has(requestedMode) ||
    !hasExecutionAuditInputs(requestAdmissionResult)
  ) {
    return null;
  }

  const derivedFrom = asRecord(requestAdmissionResult.derived_from);
  const reasonCodes = asStringArray(requestAdmissionResult.reason_codes);
  const consumedEvidence = resolveConsumedIssue209AdmissionEvidence(
    input.gate?.gate_input?.admission_context
  );
  const admissionAllowed = requestAdmissionResult.admission_decision === "allowed";
  const blockedWithMatchingGrant =
    requestAdmissionResult.admission_decision === "blocked" &&
    requestAdmissionResult.grant_match === true;
  const riskSignals =
    asStringArray(input.executionAuditRiskSignals).length > 0
      ? asStringArray(input.executionAuditRiskSignals)
      : [NO_ADDITIONAL_RISK_SIGNALS];

  return {
    audit_ref: `exec_audit_${input.decisionId}`,
    request_ref: asString(requestAdmissionResult.request_ref),
    consumed_inputs: {
      action_request_ref: asString(derivedFrom?.action_request_ref),
      resource_binding_ref: asString(derivedFrom?.resource_binding_ref),
      authorization_grant_ref: asString(derivedFrom?.authorization_grant_ref),
      runtime_target_ref: asString(derivedFrom?.runtime_target_ref)
    },
    compatibility_refs: {
      gate_run_id: asString(input.runId),
      approval_admission_ref:
        (!admissionAllowed && !blockedWithMatchingGrant) ||
        hasApprovalEvidenceValidationIssue(reasonCodes)
        ? null
        : consumedEvidence.approvalAdmissionRef,
      audit_admission_ref:
        (!admissionAllowed && !blockedWithMatchingGrant) ||
        hasAuditEvidenceValidationIssue(reasonCodes)
        ? null
        : consumedEvidence.auditAdmissionRef,
      approval_record_ref: asString(input.approvalRecord?.approval_id),
      audit_record_ref: asString(input.auditRecord?.event_id),
      session_rhythm_window_id:
        asString(input.gate?.gate_input?.session_rhythm_window_id) ?? null,
      session_rhythm_decision_id: asString(input.gate?.gate_input?.session_rhythm_decision_id) ??
        null
    },
    request_admission_decision: requestAdmissionResult.admission_decision,
    risk_signals: riskSignals,
    recorded_at: input.recordedAt
  };
};

const buildIssue209PostGateArtifacts = (input) => {
  const nowValue = typeof input?.now === "function" ? input.now() : Date.now();
  const recordedAt = new Date(nowValue).toISOString();
  const gate = input.gate;
  const requestedMode = gate.consumer_gate_result.requested_execution_mode;
  const effectiveMode = gate.consumer_gate_result.effective_execution_mode;
  const liveModeRequested =
    requestedMode === "live_read_limited" || requestedMode === "live_read_high_risk";
  const approvalIssued =
    gate.consumer_gate_result.gate_decision === "allowed" &&
    (effectiveMode === "live_read_limited" || effectiveMode === "live_read_high_risk");
  const riskSignal = gate.consumer_gate_result.gate_decision === "blocked" && liveModeRequested;
  const recoverySignal =
    gate.consumer_gate_result.gate_decision === "allowed" &&
    gate.gate_input.risk_state === "limited" &&
    liveModeRequested;

  const approvalRecord = clone(gate.approval_record);
  const decisionId = gate.gate_outcome.decision_id;
  const approvalId = approvalIssued
    ? asString(gate.gate_outcome.approval_id) ??
      asString(gate.approval_record.approval_id) ??
      resolveIssue209LiveReadApprovalId({ decisionId })
    : null;
  approvalRecord.decision_id = decisionId;
  approvalRecord.approval_id = approvalId;
  const auditAdmissionEvidence = asRecord(gate.gate_input.admission_context?.audit_admission_evidence);

  const auditRecord = {
    event_id: `gate_evt_${decisionId}`,
    decision_id: decisionId,
    approval_id: approvalId,
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    issue_scope: gate.gate_input.issue_scope,
    risk_state: gate.gate_input.risk_state,
    target_domain: gate.consumer_gate_result.target_domain,
    target_tab_id: gate.consumer_gate_result.target_tab_id,
    target_page: gate.consumer_gate_result.target_page,
    action_type: gate.consumer_gate_result.action_type,
    requested_execution_mode: requestedMode,
    effective_execution_mode: gate.consumer_gate_result.effective_execution_mode,
    gate_decision: gate.consumer_gate_result.gate_decision,
    gate_reasons: clone(gate.consumer_gate_result.gate_reasons),
    approver: approvalRecord.approver,
    approved_at: approvalRecord.approved_at,
    audited_checks: normalizeChecks(auditAdmissionEvidence?.audited_checks),
    write_interaction_tier: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
    write_action_matrix_decisions: gate.write_action_matrix_decisions
      ? clone(gate.write_action_matrix_decisions)
      : null,
    risk_signal: riskSignal,
    recovery_signal: recoverySignal,
    session_rhythm_state: riskSignal ? "cooldown" : recoverySignal ? "recovery" : "normal",
    cooldown_until: riskSignal ? new Date(nowValue + 30 * 60_000).toISOString() : null,
    recovery_started_at: recoverySignal ? recordedAt : null,
    recorded_at: recordedAt
  };

  const transitionAudit = buildRiskTransitionAudit({
    runId: input.runId,
    sessionId: input.sessionId,
    issueScope: gate.gate_input.issue_scope,
    prevState: gate.gate_input.risk_state,
    decision: gate.consumer_gate_result.gate_decision,
    gateReasons: clone(gate.consumer_gate_result.gate_reasons),
    requestedExecutionMode: gate.consumer_gate_result.requested_execution_mode,
    approvalRecord,
    auditRecords: [auditRecord],
    now: recordedAt
  });
  auditRecord.next_state = asString(transitionAudit.next_state);
  auditRecord.transition_trigger = asString(transitionAudit.trigger);
  const executionAudit = buildIssue209ExecutionAudit({
    runId: input.runId,
    gate,
    decisionId,
    approvalRecord,
    auditRecord,
    recordedAt,
    executionAuditRiskSignals: input.executionAuditRiskSignals
  });

  return {
    approval_record: approvalRecord,
    audit_record: auditRecord,
    execution_audit: executionAudit
  };
};

export { buildIssue209PostGateArtifacts };
