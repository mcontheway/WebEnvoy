import { APPROVAL_CHECK_KEYS } from "../risk-state.js";
import {
  resolveIssue209LiveReadApprovalId,
  resolveIssue209LiveReadDecisionId
} from "./identity.js";

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asBoolean = (value) => value === true;

const cloneIssue209AdmissionContext = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const approvalEvidence = asRecord(record.approval_admission_evidence);
  const auditEvidence = asRecord(record.audit_admission_evidence);

  return {
    ...(approvalEvidence ? { approval_admission_evidence: structuredClone(approvalEvidence) } : {}),
    ...(auditEvidence ? { audit_admission_evidence: structuredClone(auditEvidence) } : {})
  };
};

const normalizeChecks = (value) => {
  const record = asRecord(value);
  return Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(record?.[key])]));
};

const normalizeApprovalAdmissionEvidence = (value) => {
  const record = asRecord(value);
  return {
    approval_admission_ref: asString(record?.approval_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: normalizeChecks(record?.checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeAuditAdmissionEvidence = (value) => {
  const record = asRecord(value);
  return {
    audit_admission_ref: asString(record?.audit_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    audited_checks: normalizeChecks(record?.audited_checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeProvidedApprovalSource = (value) => {
  const record = asRecord(value);
  return {
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: normalizeChecks(record?.checks)
  };
};

const normalizeProvidedAuditSource = (value) => {
  const record = asRecord(value);
  return {
    event_id: asString(record?.event_id),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    gate_decision: asString(record?.gate_decision),
    audited_checks: normalizeChecks(record?.audited_checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const prepareIssue209LiveReadSource = (input) => {
  const decisionId = resolveIssue209LiveReadDecisionId({
    gateInvocationId: input?.gateInvocationId
  });
  const approvalId = resolveIssue209LiveReadApprovalId({
    decisionId
  });
  const explicitAdmissionContext = cloneIssue209AdmissionContext(input?.admissionContext);

  return {
    current: {
      commandRequestId: asString(input?.commandRequestId),
      gateInvocationId: asString(input?.gateInvocationId),
      runId: asString(input?.runId),
      issueScope: "issue_209",
      targetDomain: asString(input?.targetDomain),
      targetTabId: asInteger(input?.targetTabId),
      targetPage: asString(input?.targetPage),
      actionType: asString(input?.actionType),
      requestedExecutionMode: asString(input?.requestedExecutionMode),
      riskState: asString(input?.riskState),
      decisionId,
      approvalId
    },
    explicitAdmissionContext,
    explicitApprovalEvidence: normalizeApprovalAdmissionEvidence(
      explicitAdmissionContext?.approval_admission_evidence
    ),
    explicitAuditEvidence: normalizeAuditAdmissionEvidence(
      explicitAdmissionContext?.audit_admission_evidence
    ),
    approvalSource: normalizeProvidedApprovalSource(input?.approvalRecord),
    auditSource: normalizeProvidedAuditSource(input?.auditRecord)
  };
};

export {
  APPROVAL_CHECK_KEYS,
  cloneIssue209AdmissionContext,
  normalizeApprovalAdmissionEvidence,
  normalizeAuditAdmissionEvidence,
  normalizeProvidedApprovalSource,
  normalizeProvidedAuditSource,
  prepareIssue209LiveReadSource
};
