const ISSUE209_LIVE_READ_EXECUTION_MODES = new Set([
  "live_read_limited",
  "live_read_high_risk"
]);

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const isIssue209LiveReadMode = (value) => ISSUE209_LIVE_READ_EXECUTION_MODES.has(asString(value));

const isIssue209LiveReadGateRequest = (input) =>
  asString(input?.issueScope) === "issue_209" && isIssue209LiveReadMode(input?.requestedExecutionMode);

const resolveIssue209LiveReadDecisionId = (input) => {
  const explicitDecisionId = asString(input?.decisionId);
  if (explicitDecisionId) {
    return explicitDecisionId;
  }

  const gateInvocationId = asString(input?.gateInvocationId);
  if (gateInvocationId) {
    return `gate_decision_${gateInvocationId}`;
  }

  throw new Error("issue_209 live-read requires gate_invocation_id");
};

const resolveIssue209LiveReadApprovalId = (input) => {
  return `gate_appr_${resolveIssue209LiveReadDecisionId(input)}`;
};

const prepareIssue209LiveReadIdentity = (input) => {
  if (!isIssue209LiveReadGateRequest(input)) {
    return null;
  }

  const decisionId = resolveIssue209LiveReadDecisionId(input);

  return {
    commandRequestId: asString(input?.commandRequestId) ?? asString(input?.requestId),
    gateInvocationId: asString(input?.gateInvocationId),
    runId: asString(input?.runId),
    sessionId: asString(input?.sessionId),
    issueScope: "issue_209",
    targetDomain: asString(input?.targetDomain),
    targetTabId: asInteger(input?.targetTabId),
    targetPage: asString(input?.targetPage),
    actionType: asString(input?.actionType),
    requestedExecutionMode: asString(input?.requestedExecutionMode),
    riskState: asString(input?.riskState),
    decisionId,
    approvalId: resolveIssue209LiveReadApprovalId({
      decisionId,
      gateInvocationId: asString(input?.gateInvocationId)
    })
  };
};

export {
  ISSUE209_LIVE_READ_EXECUTION_MODES,
  isIssue209LiveReadMode,
  isIssue209LiveReadGateRequest,
  prepareIssue209LiveReadIdentity,
  resolveIssue209LiveReadDecisionId,
  resolveIssue209LiveReadApprovalId
};
