import {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  WRITE_INTERACTION_TIER,
  getIssueActionMatrixEntry,
  getWriteActionMatrixDecisions,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState
} from "./risk-state.js";

const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODE_SET = new Set(EXECUTION_MODES);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
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

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asBoolean = (value) => value === true;

const asString = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

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
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: Object.fromEntries(
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    )
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
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = resolveXhsRiskState(input.riskState);
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const targetDomain = asString(input.targetDomain);
  const targetTabId = asInteger(input.targetTabId);
  const targetPage = asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
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
    issueScope,
    riskState,
    approvalRecord,
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
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = resolveXhsRiskState(input.riskState);
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
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

  return {
    issueScope,
    riskState,
    actionType,
    requestedExecutionMode,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    writeTierReason,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
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
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
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
      const approvalSatisfied = approvalRequirementGaps.length === 0;
      if (
        state.writeMatrixDecision?.decision === "blocked" ||
        state.writeMatrixDecision?.decision === "not_applicable"
      ) {
        if (input.issue208EditorInputValidation !== true) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
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
        if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
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
      if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
        pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
      }
      if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
    }
  }

  return {
    gateReasons,
    approvalRecord,
    writeGateOnlyEligible,
    writeGateOnlyDecision,
    writeGateOnlyApprovalDecision: writeGateOnlyDecision
  };
};

const evaluateXhsGate = (input) => {
  const state = buildXhsGatePolicyState(input);
  const gateReasons = Array.isArray(input.additionalGateReasons)
    ? input.additionalGateReasons.filter((reason) => typeof reason === "string")
    : [];
  collectXhsCommandGateReasons({
    gateReasons,
    actionType: input.actionType,
    requestedExecutionMode: input.requestedExecutionMode,
    abilityAction: input.abilityAction ?? input.abilityActionType,
    targetDomain: input.targetDomain,
    targetTabId: input.targetTabId,
    targetPage: input.targetPage,
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
  const { approvalRecord, writeGateOnlyEligible } = collectXhsMatrixGateReasons({
    gateReasons,
    state,
    approvalRecord: input.approvalRecord,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true
  });
  const outcome = finalizeXhsGateOutcome({
    gateReasons,
    state,
    writeGateOnlyEligible,
    writeGateOnlyEligibleBehavior:
      input.writeGateOnlyEligibleBehavior === "block" ? "block" : "allow"
  });
  if (
    input.includeWriteInteractionTierReason === true &&
    state.issue208WriteGateOnly &&
    state.writeTierReason
  ) {
    pushReason(outcome.gateReasons, state.writeTierReason);
  }
  return {
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
      target_domain: asString(input.targetDomain),
      target_tab_id: asInteger(input.targetTabId),
      target_page: asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      risk_state: state.riskState
    },
    gate_outcome: {
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      requires_manual_confirmation:
        state.requestedExecutionMode === "live_read_limited" ||
        state.requestedExecutionMode === "live_read_high_risk" ||
        state.requestedExecutionMode === "live_write"
    },
    consumer_gate_result: {
      risk_state: state.riskState,
      issue_scope: state.issueScope,
      target_domain: asString(input.targetDomain),
      target_tab_id: asInteger(input.targetTabId),
      target_page: asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null
    },
    approval_record: approvalRecord
  };
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
  resolveXhsIssueActionMatrixEntry,
  resolveXhsWriteMatrixDecision,
  resolveXhsApprovalRequirementGaps,
  resolveXhsFallbackMode,
  evaluateXhsGateCore,
  buildXhsGatePolicyState,
  collectXhsCommandGateReasons,
  collectXhsMatrixGateReasons,
  finalizeXhsGateOutcome,
  evaluateXhsGate,
  WRITE_INTERACTION_TIER
};
