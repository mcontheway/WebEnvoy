import {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  WRITE_INTERACTION_TIER,
  getIssueActionMatrixEntry,
  getWriteActionMatrixDecisions,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState
} from "./risk-state.js";
import {
  collectIssue209LiveReadMatrixGateReasons
} from "./issue209-live-read/gate.js";
import {
  buildIssue209PostGateArtifacts
} from "./issue209-live-read/postgate-audit.js";
import {
  resolveConsumedIssue209AdmissionEvidence
} from "./issue209-live-read/source.js";
import {
  isIssue209LiveReadGateRequest,
  resolveIssue209LiveReadApprovalId
} from "./issue209-live-read/identity.js";

const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_UPSTREAM_RESOURCE_KINDS = new Set(["anonymous_context", "profile_session"]);
const XHS_RESOURCE_STATE_SNAPSHOTS = new Set(["active", "cool_down", "paused"]);
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODE_SET = new Set(EXECUTION_MODES);
const XHS_LIVE_READ_EXECUTION_MODE_SET = new Set(["live_read_limited", "live_read_high_risk"]);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_REQUIRED_AUDIT_ADMISSION_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_WRITE_APPROVAL_REQUIREMENTS = [
  "approval_record_approved_true",
  "approval_record_approver_present",
  "approval_record_approved_at_present",
  "approval_record_checks_all_true"
];
const XHS_SCOPE_CONTEXT = {
  platform: "xhs",
  read_domain: XHS_READ_DOMAIN,
  write_domain: XHS_WRITE_DOMAIN,
  domain_mixing_forbidden: true
};
const XHS_READ_EXECUTION_POLICY = {
  default_mode: "dry_run",
  allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
  blocked_actions: ["expand_new_live_surface_without_gate"],
  live_entry_requirements: [
    "gate_input_risk_state_limited_or_allowed",
    "audit_admission_evidence_present",
    "audit_admission_checks_all_true",
    "risk_state_checked",
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "action_type_confirmed",
    "approval_admission_evidence_approved_true",
    "approval_admission_evidence_approver_present",
    "approval_admission_evidence_approved_at_present",
    "approval_admission_evidence_checks_all_true"
  ]
};
const EXECUTION_AUDIT_NON_RISK_REASON_CODES = new Set([
  "LIVE_MODE_APPROVED",
  "DEFAULT_MODE_DRY_RUN",
  "DEFAULT_MODE_RECON",
  "WRITE_INTERACTION_APPROVED",
  "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED"
]);
const NO_ADDITIONAL_RISK_SIGNALS = "NO_ADDITIONAL_RISK_SIGNALS";

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asBoolean = (value) => value === true;

const asString = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asStringArray = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return normalized.length === value.length ? normalized : null;
};

const normalizeGrantRefs = (value) => asStringArray(value) ?? [];

const normalizeUpstreamAuthorizationRequest = (value) => {
  const record = asRecord(value);
  const actionRequest = asRecord(record?.action_request);
  const resourceBinding = asRecord(record?.resource_binding);
  const authorizationGrant = asRecord(record?.authorization_grant);
  const runtimeTarget = asRecord(record?.runtime_target);
  const bindingScope = asRecord(authorizationGrant?.binding_scope);
  const targetScope = asRecord(authorizationGrant?.target_scope);
  const bindingConstraints = asRecord(resourceBinding?.binding_constraints);

  const resourceKind = asString(resourceBinding?.resource_kind);
  const resourceStateSnapshot = asString(authorizationGrant?.resource_state_snapshot);

  return {
    action_request: actionRequest
      ? {
          request_ref: asString(actionRequest.request_ref),
          action_name: asString(actionRequest.action_name),
          action_category: resolveXhsActionType(actionRequest.action_category),
          requested_at: asString(actionRequest.requested_at)
        }
      : null,
    resource_binding: resourceBinding
      ? {
          binding_ref: asString(resourceBinding.binding_ref),
          resource_kind:
            resourceKind && XHS_UPSTREAM_RESOURCE_KINDS.has(resourceKind) ? resourceKind : null,
          profile_ref: Object.prototype.hasOwnProperty.call(resourceBinding, "profile_ref")
            ? resourceBinding.profile_ref === null
              ? null
              : asString(resourceBinding.profile_ref)
            : undefined,
          binding_constraints: bindingConstraints
            ? {
                anonymous_required: bindingConstraints.anonymous_required === true,
                reuse_logged_in_context_forbidden:
                  bindingConstraints.reuse_logged_in_context_forbidden === true
              }
            : null
        }
      : null,
    authorization_grant: authorizationGrant
      ? {
          grant_ref: asString(authorizationGrant.grant_ref),
          allowed_actions: asStringArray(authorizationGrant.allowed_actions) ?? [],
          binding_scope: {
            allowed_resource_kinds: asStringArray(bindingScope?.allowed_resource_kinds) ?? [],
            allowed_profile_refs: asStringArray(bindingScope?.allowed_profile_refs) ?? []
          },
          target_scope: {
            allowed_domains: asStringArray(targetScope?.allowed_domains) ?? [],
            allowed_pages: asStringArray(targetScope?.allowed_pages) ?? []
          },
          approval_refs: normalizeGrantRefs(authorizationGrant.approval_refs),
          audit_refs: normalizeGrantRefs(authorizationGrant.audit_refs),
          granted_at: asString(authorizationGrant.granted_at),
          resource_state_snapshot:
            resourceStateSnapshot && XHS_RESOURCE_STATE_SNAPSHOTS.has(resourceStateSnapshot)
              ? resourceStateSnapshot
              : null
        }
      : null,
    runtime_target: runtimeTarget
      ? {
          target_ref: asString(runtimeTarget.target_ref),
          domain: asString(runtimeTarget.domain),
          page: asString(runtimeTarget.page),
          tab_id: asInteger(runtimeTarget.tab_id),
          url: asString(runtimeTarget.url)
        }
      : null
  };
};

const projectRiskStateFromSnapshot = (snapshot) => {
  if (snapshot === "active") {
    return "allowed";
  }
  if (snapshot === "cool_down") {
    return "limited";
  }
  if (snapshot === "paused") {
    return "paused";
  }
  return null;
};

const deriveCanonicalRiskState = (inputRiskState, upstream) => {
  const explicitRiskState = asString(inputRiskState);
  if (explicitRiskState) {
    return resolveXhsRiskState(explicitRiskState);
  }
  const projectedRiskState = projectRiskStateFromSnapshot(
    upstream?.authorization_grant?.resource_state_snapshot
  );
  return projectedRiskState
    ? resolveXhsRiskState(projectedRiskState)
    : resolveXhsRiskState(inputRiskState);
};

const buildSearchParamValueMap = (url) => {
  const values = new Map();
  for (const [key, value] of url.searchParams.entries()) {
    const current = values.get(key) ?? [];
    current.push(value);
    values.set(key, current);
  }
  return values;
};

const actualUrlSatisfiesExpectedQuery = (expectedUrl, actualUrl) => {
  const expectedParams = buildSearchParamValueMap(expectedUrl);
  if (expectedParams.size === 0) {
    return true;
  }

  const actualParams = buildSearchParamValueMap(actualUrl);
  for (const [key, expectedValues] of expectedParams.entries()) {
    const actualValues = [...(actualParams.get(key) ?? [])];
    if (actualValues.length < expectedValues.length) {
      return false;
    }

    for (const expectedValue of expectedValues) {
      const matchIndex = actualValues.indexOf(expectedValue);
      if (matchIndex === -1) {
        return false;
      }
      actualValues.splice(matchIndex, 1);
    }
  }

  return true;
};

const matchesRuntimeTargetUrl = (input, actualTargetUrl) => {
  const runtimeTarget = input?.runtime_target;
  if (!runtimeTarget?.url || !runtimeTarget.domain || !runtimeTarget.page) {
    return true;
  }

  try {
    const parsed = new URL(runtimeTarget.url);
    if (parsed.hostname !== runtimeTarget.domain) {
      return false;
    }
    if (runtimeTarget.page === "search_result_tab") {
      if (!parsed.pathname.startsWith("/search_result")) {
        return false;
      }
    }
    if (runtimeTarget.page === "explore_detail_tab") {
      if (!parsed.pathname.startsWith("/explore/")) {
        return false;
      }
    }
    if (runtimeTarget.page === "profile_tab") {
      if (!parsed.pathname.startsWith("/user/profile/")) {
        return false;
      }
    }
    if (runtimeTarget.page === "creator_publish_tab") {
      if (
        parsed.hostname !== XHS_WRITE_DOMAIN ||
        !parsed.pathname.startsWith("/publish")
      ) {
        return false;
      }
    }
    if (!actualTargetUrl) {
      return true;
    }
    const actual = new URL(actualTargetUrl);
    return (
      actual.protocol === parsed.protocol &&
      actual.hostname === parsed.hostname &&
      actual.pathname === parsed.pathname &&
      actualUrlSatisfiesExpectedQuery(parsed, actual)
    );
  } catch {
    return false;
  }
};

const deriveCanonicalRequestedExecutionMode = (input) => {
  const explicitRequestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const upstream = normalizeUpstreamAuthorizationRequest(
    input.upstreamAuthorizationRequest ?? input.upstream_authorization_request
  );
  const actionCategory = upstream.action_request?.action_category ?? null;
  const targetDomain = upstream.runtime_target?.domain ?? asString(input.targetDomain);

  if (!upstream.action_request || !upstream.resource_binding || !upstream.authorization_grant || !upstream.runtime_target) {
    return {
      requestedExecutionMode: explicitRequestedExecutionMode,
      upstream,
      legacyRequestedExecutionMode: resolveXhsExecutionMode(
        input.legacyRequestedExecutionMode ?? input.legacy_requested_execution_mode
      )
    };
  }

  let requestedExecutionMode = null;
  if (actionCategory === "write" || actionCategory === "irreversible_write") {
    requestedExecutionMode = "live_write";
  } else if (actionCategory === "read") {
    const hasGrantRefs =
      upstream.authorization_grant.approval_refs.length > 0 &&
      upstream.authorization_grant.audit_refs.length > 0;
    const projectedRiskState = projectRiskStateFromSnapshot(
      upstream.authorization_grant.resource_state_snapshot
    );
    if (!hasGrantRefs || targetDomain !== XHS_READ_DOMAIN) {
      requestedExecutionMode = "dry_run";
    } else if (projectedRiskState === "allowed") {
      requestedExecutionMode = "live_read_high_risk";
    } else if (projectedRiskState === "limited") {
      requestedExecutionMode = "live_read_limited";
    } else {
      requestedExecutionMode = "dry_run";
    }
  }
  let legacyRequestedExecutionMode = resolveXhsExecutionMode(
    input.legacyRequestedExecutionMode ?? input.legacy_requested_execution_mode
  );
  if (
    !legacyRequestedExecutionMode &&
    explicitRequestedExecutionMode &&
    requestedExecutionMode &&
    explicitRequestedExecutionMode !== requestedExecutionMode
  ) {
    legacyRequestedExecutionMode = explicitRequestedExecutionMode;
  }

  return {
    requestedExecutionMode: requestedExecutionMode ?? explicitRequestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  };
};

const applyCanonicalAdmissionReasons = (input) => {
  const upstream = input.upstream;
  const runtimeProfileRef = asString(input.runtimeProfileRef);
  if (!upstream?.action_request || !upstream?.resource_binding || !upstream?.authorization_grant || !upstream?.runtime_target) {
    return;
  }
  if (
    input.legacyRequestedExecutionMode &&
    input.requestedExecutionMode &&
    input.legacyRequestedExecutionMode !== input.requestedExecutionMode
  ) {
    pushReason(input.gateReasons, "STALE_LEGACY_REQUESTED_EXECUTION_MODE");
  }

  if (!upstream.authorization_grant.allowed_actions.includes(upstream.action_request.action_name)) {
    pushReason(input.gateReasons, "ACTION_NOT_ALLOWED_BY_GRANT");
  }
  if (
    !upstream.authorization_grant.binding_scope.allowed_resource_kinds.includes(
      upstream.resource_binding.resource_kind
    )
  ) {
    pushReason(input.gateReasons, "RESOURCE_KIND_OUT_OF_SCOPE");
  }
  if (
    upstream.resource_binding.resource_kind === "profile_session" &&
    upstream.resource_binding.profile_ref &&
    !upstream.authorization_grant.binding_scope.allowed_profile_refs.includes(
      upstream.resource_binding.profile_ref
    )
  ) {
    pushReason(input.gateReasons, "PROFILE_REF_OUT_OF_SCOPE");
  }
  if (
    upstream.resource_binding.resource_kind === "profile_session" &&
    upstream.resource_binding.profile_ref &&
    runtimeProfileRef &&
    runtimeProfileRef !== upstream.resource_binding.profile_ref
  ) {
    pushReason(input.gateReasons, "PROFILE_SESSION_RUNTIME_PROFILE_MISMATCH");
  }
  if (
    !upstream.authorization_grant.target_scope.allowed_domains.includes(upstream.runtime_target.domain)
  ) {
    pushReason(input.gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (
    !upstream.authorization_grant.target_scope.allowed_pages.includes(upstream.runtime_target.page)
  ) {
    pushReason(input.gateReasons, "TARGET_PAGE_OUT_OF_SCOPE");
  }
  if (!matchesRuntimeTargetUrl(upstream, asString(input.actualTargetUrl))) {
    pushReason(input.gateReasons, "TARGET_URL_CONTEXT_MISMATCH");
  }

  if (upstream.resource_binding.resource_kind === "anonymous_context") {
    const bindingConstraints = upstream.resource_binding.binding_constraints;
    if (
      bindingConstraints?.anonymous_required !== true ||
      bindingConstraints?.reuse_logged_in_context_forbidden !== true
    ) {
      pushReason(input.gateReasons, "ANONYMOUS_BINDING_CONSTRAINTS_INVALID");
    }
    if (input.targetSiteLoggedIn) {
      pushReason(input.gateReasons, "ANONYMOUS_CONTEXT_REQUIRES_LOGGED_OUT_SITE_CONTEXT");
      return;
    }
    if (!input.anonymousIsolationVerified) {
      pushReason(input.gateReasons, "ANONYMOUS_ISOLATION_UNVERIFIED");
    }
  }

  if (
    input.issueScope === "issue_209" &&
    input.requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(input.requestedExecutionMode)
  ) {
    const consumedEvidence = resolveConsumedIssue209AdmissionEvidence(input.admissionContext);
    if (
      consumedEvidence.approvalAdmissionRef &&
      !upstream.authorization_grant.approval_refs.includes(consumedEvidence.approvalAdmissionRef)
    ) {
      pushReason(input.gateReasons, "APPROVAL_ADMISSION_REF_OUT_OF_SCOPE");
    }
    if (
      consumedEvidence.auditAdmissionRef &&
      !upstream.authorization_grant.audit_refs.includes(consumedEvidence.auditAdmissionRef)
    ) {
      pushReason(input.gateReasons, "AUDIT_ADMISSION_REF_OUT_OF_SCOPE");
    }
  }
};

const deriveExecutionAuditRiskSignals = (reasonCodes) => {
  const normalizedReasonCodes = asStringArray(reasonCodes) ?? [];
  const riskSignals = normalizedReasonCodes.filter(
    (reason) =>
      !EXECUTION_AUDIT_NON_RISK_REASON_CODES.has(reason) &&
      !reason.startsWith("WRITE_INTERACTION_TIER_")
  );
  return riskSignals.length > 0 ? riskSignals : [NO_ADDITIONAL_RISK_SIGNALS];
};

const firstValidGrantRef = (value) => normalizeGrantRefs(value)[0] ?? null;

const resolveCanonicalCompatibilityRefs = (input) => {
  const upstreamApprovalRef = firstValidGrantRef(input.upstream?.authorization_grant?.approval_refs);
  const upstreamAuditRef = firstValidGrantRef(input.upstream?.authorization_grant?.audit_refs);
  const admissionApprovalRef =
    input.admissionContext?.approval_admission_evidence?.approval_admission_ref ?? null;
  const admissionAuditRef =
    input.admissionContext?.audit_admission_evidence?.audit_admission_ref ?? null;
  const allowUpstreamFallback = input.allowUpstreamFallback !== false;

  return {
    approvalAdmissionRef:
      typeof admissionApprovalRef === "string" && admissionApprovalRef.length > 0
        ? admissionApprovalRef
        : allowUpstreamFallback &&
            typeof upstreamApprovalRef === "string" &&
            upstreamApprovalRef.length > 0
          ? upstreamApprovalRef
          : null,
    auditAdmissionRef:
      typeof admissionAuditRef === "string" && admissionAuditRef.length > 0
        ? admissionAuditRef
        : allowUpstreamFallback &&
            typeof upstreamAuditRef === "string" &&
            upstreamAuditRef.length > 0
          ? upstreamAuditRef
          : null
  };
};

const evaluateRequestAdmissionResult = (input) => {
  const state = input.state ?? {};
  const upstream = input.upstream;
  const requestRef = upstream?.action_request?.request_ref ?? asString(input.commandRequestId) ?? asString(input.requestId);
  const normalizedActionType = upstream?.action_request?.action_category ?? state.actionType ?? null;
  const normalizedResourceKind = upstream?.resource_binding?.resource_kind ?? null;
  const runtimeTargetMatch =
    !input.gateReasons.includes("TARGET_DOMAIN_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_TAB_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_PAGE_CONTEXT_UNRESOLVED") &&
    !input.gateReasons.includes("TARGET_PAGE_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_URL_CONTEXT_MISMATCH");

  let grantMatch = true;
  if (upstream?.authorization_grant && upstream?.action_request && upstream?.resource_binding && upstream?.runtime_target) {
    const allowedActions = upstream.authorization_grant.allowed_actions;
    const allowedResourceKinds = upstream.authorization_grant.binding_scope.allowed_resource_kinds;
    const allowedProfileRefs = upstream.authorization_grant.binding_scope.allowed_profile_refs;
    const allowedDomains = upstream.authorization_grant.target_scope.allowed_domains;
    const allowedPages = upstream.authorization_grant.target_scope.allowed_pages;

    if (!allowedActions.includes(upstream.action_request.action_name)) {
      grantMatch = false;
    }
    if (!allowedResourceKinds.includes(upstream.resource_binding.resource_kind)) {
      grantMatch = false;
    }
    if (
      upstream.resource_binding.resource_kind === "profile_session" &&
      upstream.resource_binding.profile_ref &&
      !allowedProfileRefs.includes(upstream.resource_binding.profile_ref)
    ) {
      grantMatch = false;
    }
    if (!allowedDomains.includes(upstream.runtime_target.domain)) {
      grantMatch = false;
    }
    if (!allowedPages.includes(upstream.runtime_target.page)) {
      grantMatch = false;
    }
    if (
      input.gateReasons.includes("APPROVAL_ADMISSION_REF_OUT_OF_SCOPE") ||
      input.gateReasons.includes("AUDIT_ADMISSION_REF_OUT_OF_SCOPE")
    ) {
      grantMatch = false;
    }
  }
  const requiresCanonicalGrantAdmission =
    state.issueScope === "issue_209" &&
    (state.requestedExecutionMode === "live_read_limited" ||
      state.requestedExecutionMode === "live_read_high_risk");
  const explicitCompatibilityRefs = resolveCanonicalCompatibilityRefs({
    upstream,
    admissionContext: input.admissionContext,
    allowUpstreamFallback: false
  });
  const hasExplicitCompatibilityEvidence =
    explicitCompatibilityRefs.approvalAdmissionRef !== null ||
    explicitCompatibilityRefs.auditAdmissionRef !== null;
  const hasCanonicalAdmissionGaps =
    input.gateReasons.includes("MANUAL_CONFIRMATION_MISSING") ||
    input.gateReasons.includes("APPROVAL_CHECKS_INCOMPLETE") ||
    input.gateReasons.includes("AUDIT_RECORD_MISSING");
  const canUseCanonicalGrantCompatibilityFallback =
    requiresCanonicalGrantAdmission && !hasCanonicalAdmissionGaps;

  if (requiresCanonicalGrantAdmission && hasCanonicalAdmissionGaps && !hasExplicitCompatibilityEvidence) {
    grantMatch = false;
  }

  const anonymousIsolationVerified = input.anonymousIsolationVerified === true;
  const targetSiteLoggedIn = input.targetSiteLoggedIn === true;
  const anonymousBindingConstraintsOk = !input.gateReasons.includes(
    "ANONYMOUS_BINDING_CONSTRAINTS_INVALID"
  );
  const anonymousIsolationOk =
    normalizedResourceKind !== "anonymous_context"
      ? true
      : !targetSiteLoggedIn && anonymousIsolationVerified && anonymousBindingConstraintsOk;
  const compatibilityRefs = resolveCanonicalCompatibilityRefs({
    upstream,
    admissionContext: input.admissionContext,
    allowUpstreamFallback: canUseCanonicalGrantCompatibilityFallback
  });

  const admissionDecision =
    !runtimeTargetMatch || !grantMatch || !anonymousIsolationOk || input.outcome.gateDecision === "blocked"
      ? "blocked"
      : input.outcome.gateDecision === "allowed"
        ? "allowed"
        : "deferred";

  return {
    request_ref: requestRef,
    admission_decision: admissionDecision,
    normalized_action_type: normalizedActionType,
    normalized_resource_kind: normalizedResourceKind,
    runtime_target_match: runtimeTargetMatch,
    grant_match: grantMatch,
    anonymous_isolation_ok: anonymousIsolationOk,
    effective_runtime_mode: input.outcome.effectiveExecutionMode,
    reason_codes: [...input.gateReasons],
    derived_from: {
      gate_input_ref: asString(input.runId) ?? input.decisionId,
      action_request_ref: upstream?.action_request?.request_ref ?? null,
      resource_binding_ref: upstream?.resource_binding?.binding_ref ?? null,
      authorization_grant_ref: upstream?.authorization_grant?.grant_ref ?? null,
      runtime_target_ref: upstream?.runtime_target?.target_ref ?? null,
      approval_admission_ref: compatibilityRefs.approvalAdmissionRef,
      audit_admission_ref: compatibilityRefs.auditAdmissionRef
    }
  };
};

const resolveXhsGateDecisionId = (input) => {
  const explicitDecisionId = asString(input?.decisionId);
  if (explicitDecisionId) {
    return explicitDecisionId;
  }

  const gateInvocationId = asString(input?.gateInvocationId);
  if (gateInvocationId) {
    return `gate_decision_${gateInvocationId}`;
  }

  const issueScope = asString(input?.issueScope);
  const requestedExecutionMode = asString(input?.requestedExecutionMode);
  if (
    issueScope === "issue_209" &&
    requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(requestedExecutionMode)
  ) {
    throw new Error("issue_209 live-read requires gate_invocation_id");
  }

  const runId = asString(input?.runId);
  const requestId = asString(input?.requestId);
  if (runId && requestId) {
    return `gate_decision_${runId}_${requestId}`;
  }
  if (requestId) {
    return `gate_decision_${requestId}`;
  }
  if (runId) {
    return `gate_decision_${runId}`;
  }

  const fallbackIssueScope = asString(input?.issueScope) ?? "unknown_scope";
  const fallbackTargetPage = asString(input?.targetPage) ?? "unknown_page";
  const fallbackTargetTabId = asInteger(input?.targetTabId);
  return `gate_decision_${fallbackIssueScope}_${fallbackTargetPage}_${fallbackTargetTabId ?? "unknown_tab"}`;
};

const deriveGateDecisionId = (input) => {
  return resolveXhsGateDecisionId(input);
};

const deriveApprovalId = (input, decisionId) => {
  if (isIssue209LiveReadGateRequest(input)) {
    return resolveIssue209LiveReadApprovalId({
      decisionId,
      gateInvocationId: input.gateInvocationId
    });
  }

  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const hasRealApproval =
    approvalRecord.approved &&
    approvalRecord.approver &&
    approvalRecord.approved_at &&
    XHS_REQUIRED_APPROVAL_CHECKS.every((key) => approvalRecord.checks[key] === true);
  if (!hasRealApproval) {
    return null;
  }

  const approvalRecordHasConflictingLinkage = hasApprovalRecordConflictingLinkage(
    approvalRecord,
    decisionId
  );
  if (approvalRecordHasConflictingLinkage) {
    return null;
  }

  const explicitApprovalId = asString(input.approvalId);
  if (explicitApprovalId && !approvalRecordHasConflictingLinkage) {
    return explicitApprovalId;
  }

  const record = asRecord(input.approvalRecord);
  const recordApprovalId = asString(record?.approval_id);
  if (recordApprovalId && approvalRecord.decision_id === decisionId) {
    return recordApprovalId;
  }

  return `gate_appr_${decisionId}`;
};

const resolveXhsGateApprovalId = (input) => {
  const decisionId = resolveXhsGateDecisionId(input);
  return deriveApprovalId(input, decisionId);
};

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

const hasOwnNonNullValue = (record, key) => Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const resolveXhsActionType = (value) =>
  typeof value === "string" && XHS_ACTION_TYPES.has(value) ? value : null;

const resolveXhsExecutionMode = (value) =>
  typeof value === "string" && XHS_EXECUTION_MODE_SET.has(value) ? value : null;

const resolveXhsRiskState = (value) => resolveSharedRiskState(value);

const resolveXhsIssueScope = (value) => resolveSharedIssueScope(value);

const normalizeXhsApprovalRecord = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.checks);
  return {
    approval_id: asString(record?.approval_id),
    decision_id: asString(record?.decision_id),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: Object.fromEntries(
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    )
  };
};

const normalizeXhsApprovalAdmissionEvidence = (value) => {
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
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeXhsAuditAdmissionEvidence = (value) => {
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
      XHS_REQUIRED_AUDIT_ADMISSION_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeXhsAdmissionContext = (value) => {
  const record = asRecord(value);
  return {
    approval_admission_evidence: normalizeXhsApprovalAdmissionEvidence(
      record?.approval_admission_evidence
    ),
    audit_admission_evidence: normalizeXhsAuditAdmissionEvidence(record?.audit_admission_evidence)
  };
};

const resolveXhsIssueActionMatrixEntry = (issueScope, state) => {
  return getIssueActionMatrixEntry(issueScope, state);
};

const resolveXhsWriteActionMatrixDecisions = (issueScope, actionType, requestedExecutionMode) =>
  actionType === null ? null : getWriteActionMatrixDecisions(issueScope, actionType, requestedExecutionMode);

const resolveXhsWriteMatrixDecision = (output, state) =>
  output.decisions.find((entry) => entry.state === state) ?? {
    state,
    decision: "blocked",
    requires: []
  };

const resolveXhsWriteTierReason = (writeActionMatrixDecisions) =>
  writeActionMatrixDecisions === null
    ? null
    : `WRITE_INTERACTION_TIER_${writeActionMatrixDecisions.write_interaction_tier.toUpperCase()}`;

const resolveXhsApprovalRequirementGaps = (requirements, approvalRecord) => {
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

const resolveXhsApprovalAdmissionRequirementGaps = (
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
      const allChecksComplete = XHS_REQUIRED_APPROVAL_CHECKS.every(
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

const normalizeXhsAuditRecord = (value) => {
  const record = asRecord(value);
  return {
    event_id: asString(record?.event_id),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    gate_decision: asString(record?.gate_decision),
    recorded_at: asString(record?.recorded_at)
  };
};

const resolveXhsAuditAdmissionRequirementGaps = (
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
      auditAdmissionEvidence.risk_state !== expected.riskState)) {
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
    const allChecksComplete = XHS_REQUIRED_AUDIT_ADMISSION_CHECKS.every(
      (key) => auditAdmissionEvidence.audited_checks[key] === true
    );
    if (!allChecksComplete) {
      gaps.push("audit_admission_checks_all_true");
    }
  }

  return gaps;
};
const hasApprovalRecordConflictingLinkage = (approvalRecord, decisionId) => {
  if (typeof decisionId !== "string" || decisionId.length === 0) {
    return true;
  }

  if (approvalRecord.decision_id && approvalRecord.decision_id !== decisionId) {
    return true;
  }

  return approvalRecord.approval_id !== null && approvalRecord.decision_id === null;
};

const resolveXhsFallbackMode = (requestedExecutionMode, riskState) => {
  if (requestedExecutionMode === "recon") {
    return "recon";
  }
  if (requestedExecutionMode === "live_write") {
    return "dry_run";
  }
  return riskState === "limited" ? "recon" : "dry_run";
};

const evaluateXhsGateCore = (input) => {
  const {
    requestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  } = deriveCanonicalRequestedExecutionMode(input);
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = deriveCanonicalRiskState(input.riskState, upstream);
  const actionType =
    upstream.action_request?.action_category ?? resolveXhsActionType(input.actionType);
  const targetDomain = upstream.runtime_target?.domain ?? asString(input.targetDomain);
  const targetTabId = upstream.runtime_target?.tab_id ?? asInteger(input.targetTabId);
  const targetPage = upstream.runtime_target?.page ?? asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const admissionContext = normalizeXhsAdmissionContext(input.admissionContext);
  const issueActionMatrix = resolveXhsIssueActionMatrixEntry(issueScope, riskState);
  const writeActionMatrixDecisions = resolveXhsWriteActionMatrixDecisions(
    issueScope,
    actionType,
    requestedExecutionMode
  );
  const writeMatrixDecision =
    writeActionMatrixDecisions === null
      ? null
      : resolveXhsWriteMatrixDecision(writeActionMatrixDecisions, riskState);
  const issue208WriteGateOnly =
    issueScope === "issue_208" &&
    actionType !== null &&
    writeActionMatrixDecisions !== null &&
    writeActionMatrixDecisions.write_interaction_tier !== "observe_only";
  const issue208EditorInputValidation = input.issue208EditorInputValidation === true;
  const fallbackMode = resolveXhsFallbackMode(requestedExecutionMode, riskState);
  const gateReasons = [];
  const writeTierReason = resolveXhsWriteTierReason(writeActionMatrixDecisions);
  const isLiveReadMode =
    requestedExecutionMode === "live_read_limited" ||
    requestedExecutionMode === "live_read_high_risk";
  const isBlockedByStateMatrix =
    !issue208WriteGateOnly &&
    requestedExecutionMode !== null &&
    issueActionMatrix.blocked_actions.includes(requestedExecutionMode);
  const conditionalRequirement =
    issue208WriteGateOnly || requestedExecutionMode === null
      ? null
      : issueActionMatrix.conditional_actions.find((entry) => entry.action === requestedExecutionMode) ??
        null;
  const liveModeCanEnter =
    requestedExecutionMode !== null &&
    conditionalRequirement !== null &&
    isLiveReadMode;
  let writeGateOnlyEligible = false;
  let writeGateOnlyDecision = null;

  if (!targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_NOT_EXPLICIT");
  } else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
    pushReason(gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (targetTabId === null || targetTabId <= 0) {
    pushReason(gateReasons, "TARGET_TAB_NOT_EXPLICIT");
  }
  if (!targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_NOT_EXPLICIT");
  }
  if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_CONTEXT_MISMATCH");
  }
  if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
    pushReason(gateReasons, "TARGET_TAB_CONTEXT_MISMATCH");
  }
  if (targetPage && actualTargetPage === null && input.requireActualTargetPage === true) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_UNRESOLVED");
  }
  if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_MISMATCH");
  }
  if (!actionType) {
    pushReason(gateReasons, "ACTION_TYPE_NOT_EXPLICIT");
  }
  if (!requestedExecutionMode) {
    pushReason(gateReasons, "REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
  }
  if (abilityAction && actionType && abilityAction !== actionType) {
    pushReason(gateReasons, "ABILITY_ACTION_CONTEXT_MISMATCH");
  }
  if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
    pushReason(gateReasons, "IRREVERSIBLE_WRITE_NOT_ALLOWED");
  }
  if (
    requestedExecutionMode === "live_write" &&
    (!issue208WriteGateOnly ||
      (input.treatMissingEditorValidationAsUnsupported === true && !issue208EditorInputValidation))
  ) {
    pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
  }
  if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  if (targetDomain === XHS_READ_DOMAIN && actionType !== null && actionType !== "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }

  if (gateReasons.length === 0) {
    if (isBlockedByStateMatrix) {
      if (isLiveReadMode) {
        pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else {
        pushReason(gateReasons, "ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
      }
    }

    if (issue208WriteGateOnly && actionType !== null && requestedExecutionMode !== null) {
      const approvalRequirementGaps = resolveXhsApprovalRequirementGaps(
        [...XHS_WRITE_APPROVAL_REQUIREMENTS],
        approvalRecord
      );
      const approvalSatisfied = approvalRequirementGaps.length === 0;
      if (issue208EditorInputValidation && riskState === "allowed" && approvalSatisfied) {
        writeGateOnlyEligible = true;
      } else {
        if (!issue208EditorInputValidation) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (riskState !== "allowed") {
          pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
          pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
        }
        if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (
          XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)
        ) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
      }
      writeGateOnlyDecision = {
        issue_scope: issueScope,
        state: riskState,
        write_interaction_tier: writeActionMatrixDecisions?.write_interaction_tier ?? null,
        matrix_decision: writeGateOnlyEligible ? "conditional" : "blocked",
        matrix_actions: writeActionMatrixDecisions?.matrix_actions ?? [],
        required_approval: writeGateOnlyEligible ? [...XHS_WRITE_APPROVAL_REQUIREMENTS] : [],
        approval_satisfied: approvalSatisfied,
        approval_missing_requirements: approvalRequirementGaps,
        execution_enabled: writeGateOnlyEligible
      };
    } else if (actionType && actionType !== "read") {
      if (isLiveReadMode) {
        pushReason(gateReasons, "ACTION_TYPE_MODE_MISMATCH");
      }
      pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
      pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
    } else if (liveModeCanEnter) {
      if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
        pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
      }
      if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
    }
  }

  if (input.includeWriteInteractionTierReason === true && issue208WriteGateOnly) {
    pushReason(gateReasons, writeTierReason);
  }

  return {
    targetDomain,
    targetTabId,
    targetPage,
    actionType,
    requestedExecutionMode,
    legacyRequestedExecutionMode,
    upstreamAuthorizationRequest: upstream,
    issueScope,
    riskState,
    approvalRecord,
    admissionContext,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    issue208EditorInputValidation,
    writeTierReason,
    gateReasons,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
    fallbackMode,
    writeGateOnlyEligible,
    writeGateOnlyDecision
  };
};

const finalizeXhsGateOutcome = (input) => {
  const state = input.state ?? {};
  const gateReasons = [...(Array.isArray(input.gateReasons) ? input.gateReasons : [])];
  const {
    requestedExecutionMode = state.requestedExecutionMode ?? null,
    fallbackMode = state.fallbackMode ?? "dry_run",
    issue208WriteGateOnly = state.issue208WriteGateOnly === true,
    actionType = state.actionType ?? null,
    writeMatrixDecision = state.writeMatrixDecision ?? null,
    writeGateOnlyEligible,
    liveModeCanEnter = state.liveModeCanEnter === true
  } = input;
  const nonBlockingReasons = Array.isArray(input.nonBlockingReasons) ? input.nonBlockingReasons : [];
  const blockingReasons = gateReasons.filter((reason) => !nonBlockingReasons.includes(reason));
  let gateDecision = "allowed";
  let effectiveExecutionMode = requestedExecutionMode;

  if (blockingReasons.length > 0) {
    gateDecision = "blocked";
    if (
      requestedExecutionMode === "live_read_limited" ||
      requestedExecutionMode === "live_read_high_risk" ||
      requestedExecutionMode === "live_write"
    ) {
      effectiveExecutionMode = fallbackMode;
    }
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  if (issue208WriteGateOnly && actionType && actionType !== "read" && requestedExecutionMode !== null) {
    if (writeGateOnlyEligible) {
      if (
        input.writeGateOnlyEligibleBehavior === "block" ||
        input.allowIssue208EligibleExecution === false ||
        input.supportsIssue208ValidatedLiveWrite === false
      ) {
        gateDecision = "blocked";
        effectiveExecutionMode = fallbackMode;
        pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
      } else {
        gateDecision = "allowed";
        effectiveExecutionMode = requestedExecutionMode;
        pushReason(gateReasons, "WRITE_INTERACTION_APPROVED");
        pushReason(gateReasons, "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED");
      }
    } else {
      gateDecision = "blocked";
      effectiveExecutionMode = fallbackMode;
    }
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  if (requestedExecutionMode === "dry_run" || requestedExecutionMode === "recon") {
    pushReason(
      gateReasons,
      requestedExecutionMode === "recon" ? "DEFAULT_MODE_RECON" : "DEFAULT_MODE_DRY_RUN"
    );
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  gateDecision = "blocked";
  effectiveExecutionMode = fallbackMode;
  if (liveModeCanEnter) {
    gateDecision = "allowed";
    effectiveExecutionMode = requestedExecutionMode;
    pushReason(gateReasons, "LIVE_MODE_APPROVED");
  }

  return {
    allowed: gateDecision === "allowed",
    gateDecision,
    effectiveExecutionMode,
    gateReasons
  };
};

const buildXhsGatePolicyState = (input) => {
  const {
    requestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  } = deriveCanonicalRequestedExecutionMode(input);
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = deriveCanonicalRiskState(input.riskState, upstream);
  const actionType =
    upstream.action_request?.action_category ?? resolveXhsActionType(input.actionType);
  const issueActionMatrix = resolveXhsIssueActionMatrixEntry(issueScope, riskState);
  const writeActionMatrixDecisions = resolveXhsWriteActionMatrixDecisions(
    issueScope,
    actionType,
    requestedExecutionMode
  );
  const writeMatrixDecision =
    writeActionMatrixDecisions === null
      ? null
      : resolveXhsWriteMatrixDecision(writeActionMatrixDecisions, riskState);
  const issue208WriteGateOnly =
    issueScope === "issue_208" &&
    actionType !== null &&
    writeActionMatrixDecisions !== null &&
    writeActionMatrixDecisions.write_interaction_tier !== "observe_only";
  const writeTierReason = resolveXhsWriteTierReason(writeActionMatrixDecisions);
  const isLiveReadMode =
    requestedExecutionMode === "live_read_limited" ||
    requestedExecutionMode === "live_read_high_risk";
  const isBlockedByStateMatrix =
    !issue208WriteGateOnly &&
    requestedExecutionMode !== null &&
    issueActionMatrix.blocked_actions.includes(requestedExecutionMode);
  const liveModeCanEnter =
    requestedExecutionMode !== null &&
    issueActionMatrix.conditional_actions.some((entry) => entry.action === requestedExecutionMode) &&
    isLiveReadMode;
  const limitedReadRolloutReadyTrue = input.limitedReadRolloutReadyTrue === true;

  return {
    issueScope,
    riskState,
    actionType,
    requestedExecutionMode,
    legacyRequestedExecutionMode,
    upstreamAuthorizationRequest: upstream,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    writeTierReason,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
    limitedReadRolloutReadyTrue,
    fallbackMode: resolveXhsFallbackMode(requestedExecutionMode, riskState)
  };
};

const collectXhsCommandGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const targetDomain = asString(input.targetDomain);
  const targetTabId = asInteger(input.targetTabId);
  const targetPage = asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);

  if (!targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_NOT_EXPLICIT");
  } else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
    pushReason(gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (targetTabId === null || targetTabId <= 0) {
    pushReason(gateReasons, "TARGET_TAB_NOT_EXPLICIT");
  }
  if (!targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_NOT_EXPLICIT");
  }
  if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_CONTEXT_MISMATCH");
  }
  if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
    pushReason(gateReasons, "TARGET_TAB_CONTEXT_MISMATCH");
  }
  if (targetPage && actualTargetPage === null && input.requireActualTargetPage === true) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_UNRESOLVED");
  }
  if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_MISMATCH");
  }
  if (!actionType) {
    pushReason(gateReasons, "ACTION_TYPE_NOT_EXPLICIT");
  }
  if (!requestedExecutionMode) {
    pushReason(gateReasons, "REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
  }
  if (abilityAction && actionType && abilityAction !== actionType) {
    pushReason(gateReasons, "ABILITY_ACTION_CONTEXT_MISMATCH");
  }
  if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
    pushReason(gateReasons, "IRREVERSIBLE_WRITE_NOT_ALLOWED");
  }
  if (
    requestedExecutionMode === "live_write" &&
    (!input.issue208WriteGateOnly ||
      (input.treatMissingEditorValidationAsUnsupported === true &&
        input.issue208EditorInputValidation !== true))
  ) {
    pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
  }
  if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  if (targetDomain === XHS_READ_DOMAIN && actionType !== null && actionType !== "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  return gateReasons;
};

const collectXhsMatrixGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const state = input.state;
  if (state.issueScope === "issue_209" && state.isLiveReadMode && state.actionType === "read") {
    return collectIssue209LiveReadMatrixGateReasons({
      gateReasons,
      state,
      decisionId: input.decisionId ?? null,
      expectedApprovalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      approvalRecord: input.approvalRecord,
      auditRecord: input.auditRecord,
      admissionContext: input.admissionContext,
      targetDomain: input.targetDomain,
      targetTabId: input.targetTabId,
      targetPage: input.targetPage
    });
  }

  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const auditRecord = normalizeXhsAuditRecord(input.auditRecord);
  const admissionContext = normalizeXhsAdmissionContext(input.admissionContext);
  const approvalRecordHasConflictingLinkage = hasApprovalRecordConflictingLinkage(
    approvalRecord,
    input.decisionId
  );
  let writeGateOnlyEligible = false;
  let writeGateOnlyDecision = null;

  if (gateReasons.length === 0) {
    if (state.isBlockedByStateMatrix) {
      if (state.isLiveReadMode) {
        pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else {
        pushReason(gateReasons, "ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
      }
    }

    if (state.issue208WriteGateOnly && state.actionType !== null && state.requestedExecutionMode !== null) {
      const approvalRequirementGaps = resolveXhsApprovalRequirementGaps(
        [...XHS_WRITE_APPROVAL_REQUIREMENTS],
        approvalRecord
      );
      const approvalSatisfied =
        !approvalRecordHasConflictingLinkage && approvalRequirementGaps.length === 0;
      if (
        state.writeMatrixDecision?.decision === "blocked" ||
        state.writeMatrixDecision?.decision === "not_applicable"
      ) {
        if (input.issue208EditorInputValidation !== true) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (
          approvalRecordHasConflictingLinkage ||
          !approvalRecord.approved ||
          !approvalRecord.approver ||
          !approvalRecord.approved_at
        ) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
        pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else if (
        input.issue208EditorInputValidation === true &&
        state.riskState === "allowed" &&
        approvalSatisfied
      ) {
        writeGateOnlyEligible = true;
      } else {
        if (input.issue208EditorInputValidation !== true) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (state.riskState !== "allowed") {
          pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
          pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
        }
        if (
          approvalRecordHasConflictingLinkage ||
          !approvalRecord.approved ||
          !approvalRecord.approver ||
          !approvalRecord.approved_at
        ) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
      }
      writeGateOnlyDecision = {
        issue_scope: state.issueScope,
        state: state.riskState,
        write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null,
        matrix_decision: writeGateOnlyEligible ? "conditional" : "blocked",
        matrix_actions: state.writeActionMatrixDecisions?.matrix_actions ?? [],
        required_approval: writeGateOnlyEligible ? [...XHS_WRITE_APPROVAL_REQUIREMENTS] : [],
        approval_satisfied: approvalSatisfied,
        approval_missing_requirements: approvalRequirementGaps,
        execution_enabled: writeGateOnlyEligible
      };
    } else if (state.actionType && state.actionType !== "read") {
      if (state.isLiveReadMode) {
        pushReason(gateReasons, "ACTION_TYPE_MODE_MISMATCH");
      }
      pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
      pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
    } else if (state.liveModeCanEnter) {
      const conditionalRequirement =
        state.requestedExecutionMode === null
          ? null
          : state.issueActionMatrix.conditional_actions.find(
              (entry) => entry.action === state.requestedExecutionMode
            ) ?? null;
      const liveRequirements = conditionalRequirement?.requires ?? [];
      const approvalAdmissionRequirementGaps = resolveXhsApprovalAdmissionRequirementGaps(
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
        admissionContext.approval_admission_evidence,
        {
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          runId: input.runId ?? null,
          sessionId: input.sessionId ?? null,
          issueScope: state.issueScope,
          targetDomain: input.targetDomain,
          targetTabId: input.targetTabId,
          targetPage: input.targetPage,
          actionType: state.actionType,
          requestedExecutionMode: state.requestedExecutionMode
        }
      );
      const auditAdmissionRequirementGaps = resolveXhsAuditAdmissionRequirementGaps(
        admissionContext.audit_admission_evidence,
        {
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          runId: input.runId ?? null,
          sessionId: input.sessionId ?? null,
          issueScope: state.issueScope,
          targetDomain: input.targetDomain,
          targetTabId: input.targetTabId,
          targetPage: input.targetPage,
          actionType: state.actionType,
          requestedExecutionMode: state.requestedExecutionMode,
          riskState: state.riskState
        },
        liveRequirements
      );
      const rolloutRequirementGaps =
        liveRequirements.includes("limited_read_rollout_ready_true") &&
        state.limitedReadRolloutReadyTrue !== true
          ? ["limited_read_rollout_ready_true"]
          : [];
      if (
        approvalRecordHasConflictingLinkage ||
        !approvalRecord.approved ||
        !approvalRecord.approver ||
        !approvalRecord.approved_at ||
        approvalAdmissionRequirementGaps.length > 0
      ) {
        pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
      }
      if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
      if (
        approvalAdmissionRequirementGaps.includes("approval_admission_evidence_checks_all_true")
      ) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
      if (
        auditAdmissionRequirementGaps.includes("audit_admission_evidence_present") ||
        auditAdmissionRequirementGaps.includes("audit_admission_checks_all_true")
      ) {
        pushReason(gateReasons, "AUDIT_RECORD_MISSING");
      }
      if (rolloutRequirementGaps.length > 0) {
        pushReason(gateReasons, "LIMITED_READ_ROLLOUT_NOT_READY");
      }
    }
  }

  return {
    gateReasons,
    approvalRecord,
    auditRecord,
    admissionContext,
    writeGateOnlyEligible,
    writeGateOnlyDecision,
    writeGateOnlyApprovalDecision: writeGateOnlyDecision
  };
};

const evaluateXhsGate = (input) => {
  const state = buildXhsGatePolicyState(input);
  const decisionId = deriveGateDecisionId(input);
  const gateReasons = Array.isArray(input.additionalGateReasons)
    ? input.additionalGateReasons.filter((reason) => typeof reason === "string")
    : [];
  const expectedApprovalId = deriveApprovalId(input, decisionId);
  collectXhsCommandGateReasons({
    gateReasons,
    actionType: state.actionType,
    requestedExecutionMode: state.requestedExecutionMode,
    abilityAction: input.abilityAction ?? input.abilityActionType,
    targetDomain:
      state.upstreamAuthorizationRequest?.runtime_target?.domain ?? input.targetDomain,
    targetTabId:
      state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? input.targetTabId,
    targetPage:
      state.upstreamAuthorizationRequest?.runtime_target?.page ?? input.targetPage,
    actualTargetDomain: input.actualTargetDomain,
    actualTargetTabId: input.actualTargetTabId,
    actualTargetPage: input.actualTargetPage,
    requireActualTargetPage: input.requireActualTargetPage,
    issue208WriteGateOnly: state.issue208WriteGateOnly,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    treatMissingEditorValidationAsUnsupported:
      input.treatMissingEditorValidationAsUnsupported === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true,
    writeTierReason: state.writeTierReason
  });
  const { approvalRecord, admissionContext, writeGateOnlyEligible } = collectXhsMatrixGateReasons({
    gateReasons,
    state,
    decisionId,
    expectedApprovalId,
    runId: asString(input.runId),
    sessionId: asString(input.sessionId),
    approvalRecord: input.approvalRecord,
    auditRecord: input.auditRecord,
    admissionContext: input.admissionContext,
    targetDomain:
      state.upstreamAuthorizationRequest?.runtime_target?.domain ?? input.targetDomain,
    targetTabId:
      state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? input.targetTabId,
    targetPage:
      state.upstreamAuthorizationRequest?.runtime_target?.page ?? input.targetPage,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true
  });
  applyCanonicalAdmissionReasons({
    gateReasons,
    upstream: state.upstreamAuthorizationRequest,
    issueScope: state.issueScope,
    requestedExecutionMode: state.requestedExecutionMode,
    legacyRequestedExecutionMode: state.legacyRequestedExecutionMode,
    runtimeProfileRef: input.runtimeProfileRef ?? input.__runtime_profile_ref,
    actualTargetUrl: input.actualTargetUrl ?? input.__actual_target_url,
    admissionContext,
    anonymousIsolationVerified:
      input.anonymousIsolationVerified === true || input.__anonymous_isolation_verified === true,
    targetSiteLoggedIn: input.targetSiteLoggedIn === true || input.target_site_logged_in === true
  });
  const approvalId = expectedApprovalId;
  approvalRecord.approval_id = approvalId;
  approvalRecord.decision_id = decisionId;
  const outcome = finalizeXhsGateOutcome({
    gateReasons,
    state,
    writeGateOnlyEligible,
    writeGateOnlyEligibleBehavior:
      input.writeGateOnlyEligibleBehavior === "block" ? "block" : "allow"
  });
  const approvalActive =
    outcome.gateDecision === "allowed" &&
    (outcome.effectiveExecutionMode === "live_read_limited" ||
      outcome.effectiveExecutionMode === "live_read_high_risk" ||
      outcome.effectiveExecutionMode === "live_write");
  if (
    input.includeWriteInteractionTierReason === true &&
    state.issue208WriteGateOnly &&
    state.writeTierReason
  ) {
    pushReason(outcome.gateReasons, state.writeTierReason);
  }
  approvalRecord.approval_id = approvalActive ? approvalId : null;
  const requestAdmissionResult = evaluateRequestAdmissionResult({
    state,
    upstream: state.upstreamAuthorizationRequest,
    requestId: input.requestId,
    commandRequestId: input.commandRequestId,
    legacyRequestedExecutionMode: state.legacyRequestedExecutionMode,
    anonymousIsolationVerified:
      input.anonymousIsolationVerified === true || input.__anonymous_isolation_verified === true,
    targetSiteLoggedIn: input.targetSiteLoggedIn === true || input.target_site_logged_in === true,
    gateReasons: outcome.gateReasons,
    outcome,
    runId: input.runId,
    decisionId,
    admissionContext
  });
  const executionAuditRiskSignals = deriveExecutionAuditRiskSignals(
    requestAdmissionResult.reason_codes
  );
  const result = {
    scope_context: { ...XHS_SCOPE_CONTEXT },
    read_execution_policy: {
      default_mode: XHS_READ_EXECUTION_POLICY.default_mode,
      allowed_modes: [...XHS_READ_EXECUTION_POLICY.allowed_modes],
      blocked_actions: [...XHS_READ_EXECUTION_POLICY.blocked_actions],
      live_entry_requirements: [...XHS_READ_EXECUTION_POLICY.live_entry_requirements]
    },
    issue_action_matrix: state.issueActionMatrix,
    write_interaction_tier: WRITE_INTERACTION_TIER,
    write_action_matrix_decisions: state.writeActionMatrixDecisions,
    gate_input: {
      issue_scope: state.issueScope,
      target_domain:
        state.upstreamAuthorizationRequest?.runtime_target?.domain ?? asString(input.targetDomain),
      target_tab_id:
        state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? asInteger(input.targetTabId),
      target_page:
        state.upstreamAuthorizationRequest?.runtime_target?.page ?? asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      risk_state: state.riskState,
      admission_context: admissionContext
    },
    gate_outcome: {
      decision_id: decisionId,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      requires_manual_confirmation:
        state.requestedExecutionMode === "live_read_limited" ||
        state.requestedExecutionMode === "live_read_high_risk" ||
        state.requestedExecutionMode === "live_write"
    },
    consumer_gate_result: {
      issue_scope: state.issueScope,
      target_domain:
        state.upstreamAuthorizationRequest?.runtime_target?.domain ?? asString(input.targetDomain),
      target_tab_id:
        state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? asInteger(input.targetTabId),
      target_page:
        state.upstreamAuthorizationRequest?.runtime_target?.page ?? asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null
    },
    request_admission_result: requestAdmissionResult,
    approval_record: approvalRecord,
    execution_audit: null
  };
  if (
    state.issueScope === "issue_209" &&
    state.requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(state.requestedExecutionMode)
  ) {
    const postGateArtifacts = buildIssue209PostGateArtifacts({
      runId: asString(input.runId),
      sessionId: asString(input.sessionId),
      profile: asString(input.profile),
      gate: result,
      executionAuditRiskSignals,
      now: typeof input.now === "function" ? input.now : undefined
    });
    result.execution_audit = postGateArtifacts.execution_audit;
    const compatibilityRefs = asRecord(result.execution_audit?.compatibility_refs);
    const derivedFrom = asRecord(requestAdmissionResult?.derived_from);
    const explicitAdmissionContext = asRecord(result.gate_input?.admission_context);
    const explicitApprovalEvidence = asRecord(explicitAdmissionContext?.approval_admission_evidence);
    const explicitAuditEvidence = asRecord(explicitAdmissionContext?.audit_admission_evidence);
    const canBackfillApprovalAdmissionRef =
      asString(explicitApprovalEvidence?.approval_admission_ref) === null;
    const canBackfillAuditAdmissionRef =
      asString(explicitAuditEvidence?.audit_admission_ref) === null;
    const shouldBackfillCanonicalCompatibilityRefs =
      requestAdmissionResult?.admission_decision === "allowed" ||
      (requestAdmissionResult?.admission_decision === "blocked" &&
        requestAdmissionResult?.grant_match === true);
    if (compatibilityRefs && derivedFrom && shouldBackfillCanonicalCompatibilityRefs) {
      if (
        canBackfillApprovalAdmissionRef &&
        compatibilityRefs.approval_admission_ref === null &&
        typeof derivedFrom.approval_admission_ref === "string" &&
        derivedFrom.approval_admission_ref.length > 0
      ) {
        compatibilityRefs.approval_admission_ref = derivedFrom.approval_admission_ref;
      }
      if (
        canBackfillAuditAdmissionRef &&
        compatibilityRefs.audit_admission_ref === null &&
        typeof derivedFrom.audit_admission_ref === "string" &&
        derivedFrom.audit_admission_ref.length > 0
      ) {
        compatibilityRefs.audit_admission_ref = derivedFrom.audit_admission_ref;
      }
    }
  }
  return result;
};

export {
  XHS_ALLOWED_DOMAINS,
  XHS_READ_DOMAIN,
  XHS_WRITE_DOMAIN,
  XHS_REQUIRED_APPROVAL_CHECKS,
  XHS_WRITE_APPROVAL_REQUIREMENTS,
  XHS_SCOPE_CONTEXT,
  XHS_READ_EXECUTION_POLICY,
  XHS_ACTION_TYPES,
  resolveXhsActionType,
  resolveXhsExecutionMode,
  resolveXhsRiskState,
  resolveXhsIssueScope,
  normalizeXhsApprovalRecord,
  normalizeXhsApprovalAdmissionEvidence,
  normalizeXhsAuditAdmissionEvidence,
  normalizeXhsAdmissionContext,
  resolveXhsGateDecisionId,
  resolveXhsGateApprovalId,
  resolveXhsIssueActionMatrixEntry,
  resolveXhsWriteMatrixDecision,
  resolveXhsApprovalRequirementGaps,
  resolveXhsApprovalAdmissionRequirementGaps,
  resolveXhsAuditAdmissionRequirementGaps,
  resolveXhsFallbackMode,
  evaluateXhsGateCore,
  buildXhsGatePolicyState,
  collectXhsCommandGateReasons,
  collectXhsMatrixGateReasons,
  finalizeXhsGateOutcome,
  evaluateXhsGate,
  buildIssue209PostGateArtifacts,
  WRITE_INTERACTION_TIER
};
