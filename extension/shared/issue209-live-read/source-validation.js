import { APPROVAL_CHECK_KEYS } from "../risk-state.js";
import {
  normalizeProvidedApprovalSource,
  normalizeProvidedAuditSource
} from "./source.js";

const hasOwnNonNullValue = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const cloneChecks = (checks) =>
  Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, checks?.[key] === true]));

const hasAllTrueChecks = (checks) => APPROVAL_CHECK_KEYS.every((key) => checks?.[key] === true);

const validateIssue209ApprovalSourceAgainstCurrentLinkage = (input) => {
  const current = input?.current ?? {};
  const approvalSource = normalizeProvidedApprovalSource(
    input?.approvalSource ?? input?.approvalRecord
  );
  const approvalRequirementGaps = [];
  const carriesDecisionId = hasOwnNonNullValue(approvalSource, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(approvalSource, "approval_id");

  if (approvalSource.approved !== true) {
    approvalRequirementGaps.push("approval_record_approved_true");
  }
  if (!approvalSource.approver) {
    approvalRequirementGaps.push("approval_record_approver_present");
  }
  if (!approvalSource.approved_at) {
    approvalRequirementGaps.push("approval_record_approved_at_present");
  }
  if (!hasAllTrueChecks(approvalSource.checks)) {
    approvalRequirementGaps.push("approval_record_checks_all_true");
  }

  if (carriesDecisionId !== carriesApprovalId) {
    approvalRequirementGaps.push("approval_record_linkage_invalid");
  } else if (
    carriesDecisionId &&
    carriesApprovalId &&
    (approvalSource.decision_id !== current.decisionId ||
      approvalSource.approval_id !== current.approvalId)
  ) {
    approvalRequirementGaps.push("approval_record_linkage_invalid");
  }

  return {
    approvalSource,
    approvalRecord: {
      approval_id: current.approvalId ?? null,
      decision_id: current.decisionId ?? null,
      approved: approvalSource.approved,
      approver: approvalSource.approver,
      approved_at: approvalSource.approved_at,
      checks: cloneChecks(approvalSource.checks)
    },
    approvalRequirementGaps,
    isValid: approvalRequirementGaps.length === 0
  };
};

const validateIssue209AuditSourceAgainstCurrentLinkage = (input) => {
  const current = input?.current ?? {};
  const requestIdWasExplicit = input?.requestIdWasExplicit === true;
  const auditSource = normalizeProvidedAuditSource(input?.auditSource ?? input?.auditRecord);
  const auditRequirementGaps = [];
  const carriesDecisionId = hasOwnNonNullValue(auditSource, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(auditSource, "approval_id");

  if (!auditSource.event_id) {
    auditRequirementGaps.push("audit_record_event_id_present");
  }
  if (!auditSource.recorded_at) {
    auditRequirementGaps.push("audit_record_recorded_at_present");
  }
  if (auditSource.gate_decision !== "allowed") {
    auditRequirementGaps.push("audit_record_gate_decision_allowed");
  }
  if (!hasAllTrueChecks(auditSource.audited_checks)) {
    auditRequirementGaps.push("audit_record_checks_all_true");
  }
  if (carriesDecisionId !== true || carriesApprovalId !== true) {
    auditRequirementGaps.push("audit_record_linkage_invalid");
  } else if (
    auditSource.decision_id !== current.decisionId ||
    auditSource.approval_id !== current.approvalId
  ) {
    auditRequirementGaps.push("audit_record_linkage_invalid");
  }

  if (auditSource.issue_scope !== current.issueScope) {
    auditRequirementGaps.push("audit_record_issue_scope_match");
  }
  if (auditSource.target_domain !== current.targetDomain) {
    auditRequirementGaps.push("audit_record_target_domain_match");
  }
  if (auditSource.target_tab_id !== current.targetTabId) {
    auditRequirementGaps.push("audit_record_target_tab_id_match");
  }
  if (auditSource.target_page !== current.targetPage) {
    auditRequirementGaps.push("audit_record_target_page_match");
  }
  if (auditSource.action_type !== current.actionType) {
    auditRequirementGaps.push("audit_record_action_type_match");
  }
  if (auditSource.requested_execution_mode !== current.requestedExecutionMode) {
    auditRequirementGaps.push("audit_record_requested_execution_mode_match");
  }
  if (auditSource.risk_state !== current.riskState) {
    auditRequirementGaps.push("audit_record_risk_state_match");
  }
  if (
    requestIdWasExplicit &&
    current.commandRequestId &&
    auditSource.request_id &&
    auditSource.request_id !== current.commandRequestId
  ) {
    auditRequirementGaps.push("audit_record_request_id_match");
  }

  return {
    auditSource,
    auditRecord: {
      event_id: auditSource.event_id,
      decision_id: current.decisionId ?? null,
      approval_id: current.approvalId ?? null,
      request_id: auditSource.request_id ?? null,
      issue_scope: current.issueScope ?? null,
      target_domain: current.targetDomain ?? null,
      target_tab_id: current.targetTabId ?? null,
      target_page: current.targetPage ?? null,
      action_type: current.actionType ?? null,
      requested_execution_mode: current.requestedExecutionMode ?? null,
      risk_state: current.riskState ?? null,
      gate_decision: auditSource.gate_decision,
      audited_checks: cloneChecks(auditSource.audited_checks),
      recorded_at: auditSource.recorded_at
    },
    auditRequirementGaps,
    isValid: auditRequirementGaps.length === 0
  };
};

export {
  validateIssue209ApprovalSourceAgainstCurrentLinkage,
  validateIssue209AuditSourceAgainstCurrentLinkage
};
