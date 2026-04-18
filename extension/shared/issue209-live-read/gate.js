import { APPROVAL_CHECK_KEYS } from "../risk-state.js";
import {
  cloneIssue209AdmissionContext
} from "./admission.js";
import {
  validateIssue209ApprovalSourceAgainstCurrentLinkage
} from "./source-validation.js";

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asBoolean = (value) => value === true;

const hasOwnNonNullValue = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const asStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return normalized.length === value.length ? normalized : [];
};

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

const hasExplicitAdmissionEvidence = (admissionContext) => {
  const approvalEvidence = asRecord(admissionContext?.approval_admission_evidence);
  const auditEvidence = asRecord(admissionContext?.audit_admission_evidence);

  const hasMeaningfulEvidence = (record) => {
    if (!record) {
      return false;
    }
    return Object.values(record).some((value) => {
      if (value === true) {
        return true;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      if (typeof value === "number") {
        return true;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return Object.values(value).some((nested) => nested === true);
      }
      return false;
    });
  };

  return hasMeaningfulEvidence(approvalEvidence) || hasMeaningfulEvidence(auditEvidence);
};

const resolveCanonicalGrantApprovedAt = (input) =>
  asString(input.state?.upstreamAuthorizationRequest?.authorization_grant?.granted_at) ??
  asString(input.state?.upstreamAuthorizationRequest?.action_request?.requested_at);

const projectRiskStateFromGrantSnapshot = (value) => {
  const normalized = asString(value);
  if (normalized === "active") {
    return "allowed";
  }
  if (normalized === "cool_down") {
    return "limited";
  }
  if (normalized === "paused") {
    return "paused";
  }
  return null;
};

const hasCanonicalGrantBackedAdmission = (input, liveRequirements) => {
  const upstream = asRecord(input.state?.upstreamAuthorizationRequest);
  const actionRequest = asRecord(upstream?.action_request);
  const resourceBinding = asRecord(upstream?.resource_binding);
  const authorizationGrant = asRecord(upstream?.authorization_grant);
  const runtimeTarget = asRecord(upstream?.runtime_target);
  const actionRequestRef = asString(actionRequest?.request_ref);
  const resourceBindingRef = asString(resourceBinding?.binding_ref);
  const authorizationGrantRef = asString(authorizationGrant?.grant_ref);
  const runtimeTargetRef = asString(runtimeTarget?.target_ref);
  const approvalRefs = asStringArray(authorizationGrant?.approval_refs);
  const auditRefs = asStringArray(authorizationGrant?.audit_refs);
  const grantActionName = asString(actionRequest?.action_name);
  const grantActionType = asString(actionRequest?.action_category);
  const grantResourceKind = asString(resourceBinding?.resource_kind);
  const grantProfileRef = asString(resourceBinding?.profile_ref);
  const grantBindingConstraints = asRecord(resourceBinding?.binding_constraints);
  const bindingScope = asRecord(authorizationGrant?.binding_scope);
  const targetScope = asRecord(authorizationGrant?.target_scope);
  const allowedActions = asStringArray(authorizationGrant?.allowed_actions);
  const grantDomain = asString(runtimeTarget?.domain);
  const grantPage = asString(runtimeTarget?.page);
  const grantTabId = asInteger(runtimeTarget?.tab_id);
  const projectedRiskState = projectRiskStateFromGrantSnapshot(
    authorizationGrant?.resource_state_snapshot
  );
  const supportsRequestedMode =
    input.state?.requestedExecutionMode === "live_read_high_risk"
      ? projectedRiskState === "allowed"
      : input.state?.requestedExecutionMode === "live_read_limited"
        ? projectedRiskState === "limited" || projectedRiskState === "allowed"
        : false;
  const grantHasExecutableBinding =
    grantResourceKind === "profile_session"
      ? grantProfileRef !== null
      : grantResourceKind === "anonymous_context"
        ? grantProfileRef === null &&
          grantBindingConstraints?.anonymous_required === true &&
          grantBindingConstraints?.reuse_logged_in_context_forbidden === true
        : false;

  return (
    liveRequirements.length > 0 &&
    input.state?.issueScope === "issue_209" &&
    input.state?.actionType === "read" &&
    (input.state?.requestedExecutionMode === "live_read_limited" ||
      input.state?.requestedExecutionMode === "live_read_high_risk") &&
    actionRequest !== null &&
    resourceBinding !== null &&
    authorizationGrant !== null &&
    runtimeTarget !== null &&
    actionRequestRef !== null &&
    resourceBindingRef !== null &&
    authorizationGrantRef !== null &&
    runtimeTargetRef !== null &&
    resolveCanonicalGrantApprovedAt(input) !== null &&
    approvalRefs.length > 0 &&
    auditRefs.length > 0 &&
    grantActionName !== null &&
    grantActionType === input.state?.actionType &&
    grantResourceKind !== null &&
    grantHasExecutableBinding &&
    grantDomain === input.targetDomain &&
    grantPage === input.targetPage &&
    grantTabId === input.targetTabId &&
    supportsRequestedMode &&
    allowedActions.includes(grantActionName) &&
    asStringArray(bindingScope?.allowed_resource_kinds).includes(grantResourceKind) &&
    (grantResourceKind !== "profile_session" ||
      asStringArray(bindingScope?.allowed_profile_refs).includes(grantProfileRef ?? "")) &&
    asStringArray(targetScope?.allowed_domains).includes(grantDomain ?? "") &&
    asStringArray(targetScope?.allowed_pages).includes(grantPage ?? "")
  );
};

const explicitAdmissionRefMatchesCurrentGrant = (grantRefs, explicitRef) => {
  const normalizedExplicitRef = asString(explicitRef);
  if (normalizedExplicitRef === null) {
    return false;
  }

  return asStringArray(grantRefs).includes(normalizedExplicitRef);
};

const normalizeApprovalAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.checks);
  return {
    approval_admission_ref: asString(record?.approval_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
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
    checks: Object.fromEntries(
      APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeAuditAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.audited_checks);
  return {
    audit_admission_ref: asString(record?.audit_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    audited_checks: Object.fromEntries(
      APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const buildApprovalRecordFromAdmissionEvidence = (approvalAdmissionEvidence, expected) => ({
  approval_id: expected.approvalId ?? null,
  decision_id: expected.decisionId ?? null,
  approved: approvalAdmissionEvidence.approved === true,
  approver: approvalAdmissionEvidence.approver,
  approved_at: approvalAdmissionEvidence.approved_at,
  checks: Object.fromEntries(
    APPROVAL_CHECK_KEYS.map((key) => [key, approvalAdmissionEvidence.checks[key] === true])
  )
});

const buildSyntheticApprovalRecordFromCanonicalGrant = (expected) => ({
  approval_id: expected.approvalId ?? null,
  decision_id: expected.decisionId ?? null,
  approved: true,
  approver: "authorization_grant",
  approved_at: expected.approvedAt ?? null,
  checks: Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, true]))
});

const resolveIssue209ApprovalAdmissionRequirementGaps = (
  requirements,
  approvalAdmissionEvidence,
  expected
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(approvalAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(approvalAdmissionEvidence, "approval_id");

  for (const requirement of requirements) {
    if (requirement === "approval_admission_evidence_approved_true") {
      if (!approvalAdmissionEvidence.approved) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approver_present") {
      if (!approvalAdmissionEvidence.approver) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approved_at_present") {
      if (!approvalAdmissionEvidence.approved_at) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_checks_all_true") {
      const allChecksComplete = APPROVAL_CHECK_KEYS.every(
        (key) => approvalAdmissionEvidence.checks[key] === true
      );
      if (!allChecksComplete) {
        gaps.push(requirement);
      }
      continue;
    }
    if (
      requirement === "risk_state_checked" ||
      requirement === "target_domain_confirmed" ||
      requirement === "target_tab_confirmed" ||
      requirement === "target_page_confirmed" ||
      requirement === "action_type_confirmed"
    ) {
      if (approvalAdmissionEvidence.checks[requirement] !== true) {
        gaps.push(requirement);
      }
      continue;
    }
    gaps.push(requirement);
  }

  if (
    !approvalAdmissionEvidence.approval_admission_ref ||
    !approvalAdmissionEvidence.recorded_at ||
    approvalAdmissionEvidence.run_id !== expected.runId ||
    approvalAdmissionEvidence.session_id !== expected.sessionId ||
    approvalAdmissionEvidence.issue_scope !== expected.issueScope ||
    approvalAdmissionEvidence.target_domain !== expected.targetDomain ||
    approvalAdmissionEvidence.target_tab_id !== expected.targetTabId ||
    approvalAdmissionEvidence.target_page !== expected.targetPage ||
    approvalAdmissionEvidence.action_type !== expected.actionType ||
    approvalAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode
  ) {
    gaps.push("approval_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    approvalAdmissionEvidence.decision_id === expected.decisionId &&
    approvalAdmissionEvidence.approval_id === expected.approvalId;
  if (linkagePresent && !linkageValid) {
    gaps.push("approval_admission_evidence_present");
  }

  return gaps;
};

const resolveIssue209AuditAdmissionRequirementGaps = (
  auditAdmissionEvidence,
  expected,
  requirements
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(auditAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(auditAdmissionEvidence, "approval_id");

  if (
    requirements.includes("audit_admission_evidence_present") &&
    (!auditAdmissionEvidence.audit_admission_ref ||
      !auditAdmissionEvidence.recorded_at ||
      auditAdmissionEvidence.run_id !== expected.runId ||
      auditAdmissionEvidence.session_id !== expected.sessionId ||
      auditAdmissionEvidence.issue_scope !== expected.issueScope ||
      auditAdmissionEvidence.target_domain !== expected.targetDomain ||
      auditAdmissionEvidence.target_tab_id !== expected.targetTabId ||
      auditAdmissionEvidence.target_page !== expected.targetPage ||
      auditAdmissionEvidence.action_type !== expected.actionType ||
      auditAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode ||
      auditAdmissionEvidence.risk_state !== expected.riskState)
  ) {
    gaps.push("audit_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    auditAdmissionEvidence.decision_id === expected.decisionId &&
    auditAdmissionEvidence.approval_id === expected.approvalId;
  if (requirements.includes("audit_admission_evidence_present") && linkagePresent && !linkageValid) {
    gaps.push("audit_admission_evidence_present");
  }

  if (requirements.includes("audit_admission_checks_all_true")) {
    const allChecksComplete = APPROVAL_CHECK_KEYS.every(
      (key) => auditAdmissionEvidence.audited_checks[key] === true
    );
    if (!allChecksComplete) {
      gaps.push("audit_admission_checks_all_true");
    }
  }

  return gaps;
};

const collectIssue209LiveReadMatrixGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const admissionContext = cloneIssue209AdmissionContext(input.admissionContext);
  const approvalRecord = buildApprovalRecordFromAdmissionEvidence(
    normalizeApprovalAdmissionEvidence(admissionContext?.approval_admission_evidence),
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null
    }
  );

  if (gateReasons.length === 0 && input.state.isBlockedByStateMatrix) {
    pushReason(gateReasons, `RISK_STATE_${String(input.state.riskState).toUpperCase()}`);
    pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
  }

  if (gateReasons.length > 0 || input.state.liveModeCanEnter !== true) {
    return {
      gateReasons,
      approvalRecord,
      admissionContext: {
        approval_admission_evidence: normalizeApprovalAdmissionEvidence(
          admissionContext?.approval_admission_evidence
        ),
        audit_admission_evidence: normalizeAuditAdmissionEvidence(
          admissionContext?.audit_admission_evidence
        )
      },
      writeGateOnlyEligible: false,
      writeGateOnlyDecision: null,
      writeGateOnlyApprovalDecision: null
    };
  }

  const conditionalRequirement =
    input.state.requestedExecutionMode === null
      ? null
      : input.state.issueActionMatrix.conditional_actions.find(
          (entry) => entry.action === input.state.requestedExecutionMode
        ) ?? null;
  const liveRequirements = conditionalRequirement?.requires ?? [];
  const approvalAdmissionEvidence = normalizeApprovalAdmissionEvidence(
    admissionContext?.approval_admission_evidence
  );
  const auditAdmissionEvidence = normalizeAuditAdmissionEvidence(
    admissionContext?.audit_admission_evidence
  );
  const approvalAdmissionRequirementGaps = resolveIssue209ApprovalAdmissionRequirementGaps(
    liveRequirements.filter(
      (requirement) =>
        requirement === "approval_admission_evidence_approved_true" ||
        requirement === "approval_admission_evidence_approver_present" ||
        requirement === "approval_admission_evidence_approved_at_present" ||
        requirement === "approval_admission_evidence_checks_all_true" ||
        requirement === "risk_state_checked" ||
        requirement === "target_domain_confirmed" ||
        requirement === "target_tab_confirmed" ||
        requirement === "target_page_confirmed" ||
        requirement === "action_type_confirmed"
    ),
    approvalAdmissionEvidence,
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      issueScope: input.state.issueScope,
      targetDomain: input.targetDomain ?? null,
      targetTabId: input.targetTabId ?? null,
      targetPage: input.targetPage ?? null,
      actionType: input.state.actionType,
      requestedExecutionMode: input.state.requestedExecutionMode
    }
  );
  const auditAdmissionRequirementGaps = resolveIssue209AuditAdmissionRequirementGaps(
    auditAdmissionEvidence,
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      issueScope: input.state.issueScope,
      targetDomain: input.targetDomain ?? null,
      targetTabId: input.targetTabId ?? null,
      targetPage: input.targetPage ?? null,
      actionType: input.state.actionType,
      requestedExecutionMode: input.state.requestedExecutionMode,
      riskState: input.state.riskState
    },
    liveRequirements
  );
  const rolloutRequirementGaps =
    liveRequirements.includes("limited_read_rollout_ready_true") &&
    input.state.limitedReadRolloutReadyTrue !== true
      ? ["limited_read_rollout_ready_true"]
      : [];
  const canonicalGrantBackedAdmission = hasCanonicalGrantBackedAdmission(input, liveRequirements);
  const explicitApprovalAlignedWithCurrentGrant =
    !canonicalGrantBackedAdmission ||
    explicitAdmissionRefMatchesCurrentGrant(
      input.state?.upstreamAuthorizationRequest?.authorization_grant?.approval_refs,
      approvalAdmissionEvidence.approval_admission_ref
    );
  const explicitAuditAlignedWithCurrentGrant =
    !canonicalGrantBackedAdmission ||
    explicitAdmissionRefMatchesCurrentGrant(
      input.state?.upstreamAuthorizationRequest?.authorization_grant?.audit_refs,
      auditAdmissionEvidence.audit_admission_ref
    );
  const explicitApprovalUsable =
    approvalAdmissionRequirementGaps.length === 0 && explicitApprovalAlignedWithCurrentGrant;
  const explicitAuditUsable =
    auditAdmissionRequirementGaps.length === 0 && explicitAuditAlignedWithCurrentGrant;
  const explicitAdmissionUsable =
    explicitApprovalUsable && explicitAuditUsable;
  const effectiveApprovalAdmissionEvidence =
    canonicalGrantBackedAdmission && !explicitApprovalUsable
      ? normalizeApprovalAdmissionEvidence(null)
      : approvalAdmissionEvidence;
  const effectiveAuditAdmissionEvidence =
    canonicalGrantBackedAdmission && !explicitAuditUsable
      ? normalizeAuditAdmissionEvidence(null)
      : auditAdmissionEvidence;
  const liveAdmissionSatisfied =
    explicitAdmissionUsable || canonicalGrantBackedAdmission;
  const canonicalApprovalRecord = explicitApprovalUsable
    ? buildApprovalRecordFromAdmissionEvidence(approvalAdmissionEvidence, {
        decisionId: input.decisionId ?? null,
        approvalId: input.expectedApprovalId ?? null
      })
    : canonicalGrantBackedAdmission
      ? buildSyntheticApprovalRecordFromCanonicalGrant({
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          approvedAt: resolveCanonicalGrantApprovedAt(input)
        })
      : approvalRecord;

  if (!liveAdmissionSatisfied && approvalAdmissionRequirementGaps.length > 0) {
    pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
  }
  if (
    !liveAdmissionSatisfied &&
    approvalAdmissionRequirementGaps.includes("approval_admission_evidence_checks_all_true")
  ) {
    pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
  }
  if (!liveAdmissionSatisfied && auditAdmissionRequirementGaps.length > 0) {
    pushReason(gateReasons, "AUDIT_RECORD_MISSING");
  }
  if (rolloutRequirementGaps.length > 0) {
    pushReason(gateReasons, "LIMITED_READ_ROLLOUT_NOT_READY");
  }

  return {
    gateReasons,
    approvalRecord: canonicalApprovalRecord,
    admissionContext: {
      approval_admission_evidence: effectiveApprovalAdmissionEvidence,
      audit_admission_evidence: effectiveAuditAdmissionEvidence
    },
    writeGateOnlyEligible: false,
    writeGateOnlyDecision: null,
    writeGateOnlyApprovalDecision: null
  };
};

export {
  validateIssue209ApprovalSourceAgainstCurrentLinkage,
  collectIssue209LiveReadMatrixGateReasons
};
