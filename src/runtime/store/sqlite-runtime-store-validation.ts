import type {
  AppendGateAuditRecordInput,
  AppendRunEventInput,
  ListGateAuditRecordsInput,
  UpsertGateApprovalInput,
  UpsertRunInput
} from "./sqlite-runtime-store.js";

const GATE_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const GATE_EXECUTION_MODES = new Set([
  "dry_run",
  "recon",
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);
const GATE_RISK_STATES = new Set(["paused", "limited", "allowed"]);
const GATE_DECISIONS = new Set(["allowed", "blocked"]);
const GATE_ISSUE_SCOPES = new Set(["issue_208", "issue_209"]);
const REQUIRED_APPROVAL_CHECKS = new Set([
  "target_domain_confirmed",
  "target_tab_confirmed",
  "target_page_confirmed",
  "risk_state_checked",
  "action_type_confirmed"
]);
const LIVE_APPROVAL_REQUIRED_EXECUTION_MODES = new Set([
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);

interface RuntimeStoreValidationContext {
  invalidInput(message: string): never;
  isIsoLike(value: string): boolean;
}

const hasTrimmedText = (value: string): boolean => value.trim().length > 0;

const requiresApprovalEvidence = (input: AppendGateAuditRecordInput): boolean =>
  input.gateDecision === "allowed" &&
  (LIVE_APPROVAL_REQUIRED_EXECUTION_MODES.has(input.requestedExecutionMode) ||
    LIVE_APPROVAL_REQUIRED_EXECUTION_MODES.has(input.effectiveExecutionMode));

export const assertUpsertRunInput = (
  input: UpsertRunInput,
  helpers: RuntimeStoreValidationContext
): void => {
  if (!hasTrimmedText(input.runId) || !hasTrimmedText(input.profileName) || !hasTrimmedText(input.command)) {
    helpers.invalidInput("missing required run fields");
  }
  if (input.status !== "running" && input.status !== "succeeded" && input.status !== "failed") {
    helpers.invalidInput("invalid run status");
  }
  if (!helpers.isIsoLike(input.startedAt) || (input.endedAt !== null && !helpers.isIsoLike(input.endedAt))) {
    helpers.invalidInput("invalid timestamp format");
  }
  if (input.status === "running" && input.endedAt !== null) {
    helpers.invalidInput("running status must not include ended_at");
  }
  if (input.status !== "running" && input.endedAt === null) {
    helpers.invalidInput("final status must include ended_at");
  }
};

export const assertAppendRunEventInput = (
  input: AppendRunEventInput,
  helpers: RuntimeStoreValidationContext
): void => {
  if (
    !hasTrimmedText(input.runId) ||
    !hasTrimmedText(input.stage) ||
    !hasTrimmedText(input.component) ||
    !hasTrimmedText(input.eventType)
  ) {
    helpers.invalidInput("missing required event fields");
  }
  if (!helpers.isIsoLike(input.eventTime)) {
    helpers.invalidInput("invalid event_time");
  }
  if (typeof input.summaryTruncated !== "boolean") {
    helpers.invalidInput("summary_truncated must be boolean");
  }
};

export const assertGateApprovalInput = (
  input: UpsertGateApprovalInput,
  helpers: RuntimeStoreValidationContext
): void => {
  if (input.approvalId !== undefined && input.approvalId !== null && !hasTrimmedText(input.approvalId)) {
    helpers.invalidInput("invalid approval_id");
  }
  if (!hasTrimmedText(input.runId) || !hasTrimmedText(input.decisionId)) {
    helpers.invalidInput("run_id and decision_id are required");
  }
  if (!input.checks || typeof input.checks !== "object") {
    helpers.invalidInput("checks is required");
  }
  for (const check of REQUIRED_APPROVAL_CHECKS) {
    if (typeof input.checks[check] !== "boolean") {
      helpers.invalidInput(`checks.${check} is required`);
    }
  }
  if (input.approved) {
    if (!input.approver?.trim() || !input.approvedAt || !helpers.isIsoLike(input.approvedAt)) {
      helpers.invalidInput("approved record requires approver and approved_at");
    }
    return;
  }
  if (input.approvedAt !== null && !helpers.isIsoLike(input.approvedAt)) {
    helpers.invalidInput("invalid approved_at");
  }
};

export const assertGateAuditRecordInput = (
  input: AppendGateAuditRecordInput,
  helpers: RuntimeStoreValidationContext
): void => {
  if (
    !hasTrimmedText(input.eventId) ||
    !hasTrimmedText(input.decisionId) ||
    !hasTrimmedText(input.runId) ||
    !hasTrimmedText(input.sessionId) ||
    !hasTrimmedText(input.profile) ||
    !hasTrimmedText(input.issueScope) ||
    !hasTrimmedText(input.riskState) ||
    !hasTrimmedText(input.nextState) ||
    !hasTrimmedText(input.transitionTrigger) ||
    !hasTrimmedText(input.targetDomain) ||
    !hasTrimmedText(input.targetPage) ||
    !hasTrimmedText(input.requestedExecutionMode) ||
    !hasTrimmedText(input.effectiveExecutionMode) ||
    !hasTrimmedText(input.gateDecision)
  ) {
    helpers.invalidInput("missing required gate audit fields");
  }
  if (input.approvalId !== null && !hasTrimmedText(input.approvalId)) {
    helpers.invalidInput("invalid approval_id");
  }
  if (!Number.isInteger(input.targetTabId) || input.targetTabId <= 0) {
    helpers.invalidInput("invalid target_tab_id");
  }
  if (!GATE_RISK_STATES.has(input.riskState)) {
    helpers.invalidInput("invalid risk_state");
  }
  if (!GATE_ISSUE_SCOPES.has(input.issueScope)) {
    helpers.invalidInput("invalid issue_scope");
  }
  if (!GATE_RISK_STATES.has(input.nextState)) {
    helpers.invalidInput("invalid next_state");
  }
  if (input.actionType !== null && !GATE_ACTION_TYPES.has(input.actionType)) {
    helpers.invalidInput("invalid action_type");
  }
  if (!GATE_EXECUTION_MODES.has(input.requestedExecutionMode)) {
    helpers.invalidInput("invalid requested_execution_mode");
  }
  if (!GATE_EXECUTION_MODES.has(input.effectiveExecutionMode)) {
    helpers.invalidInput("invalid effective_execution_mode");
  }
  const allowedLiveExecution =
    input.gateDecision === "allowed" &&
    (input.effectiveExecutionMode === "live_read_limited" ||
      input.effectiveExecutionMode === "live_read_high_risk" ||
      input.effectiveExecutionMode === "live_write");
  if (allowedLiveExecution && input.approvalId === null) {
    helpers.invalidInput("approval_id is required for allowed live audit records");
  }
  if (!GATE_DECISIONS.has(input.gateDecision)) {
    helpers.invalidInput("invalid gate_decision");
  }
  if (!Array.isArray(input.gateReasons) || input.gateReasons.length === 0) {
    helpers.invalidInput("gate_reasons is required");
  }
  for (const reason of input.gateReasons) {
    if (typeof reason !== "string" || reason.trim().length === 0) {
      helpers.invalidInput("invalid gate_reasons");
    }
  }
  if (!helpers.isIsoLike(input.recordedAt)) {
    helpers.invalidInput("invalid recorded_at");
  }
  if (
    requiresApprovalEvidence(input) &&
    (!input.approver?.trim() || !input.approvedAt || !helpers.isIsoLike(input.approvedAt))
  ) {
    helpers.invalidInput("allowed record requires approver and approved_at");
  }
  if (input.approvedAt !== null && !helpers.isIsoLike(input.approvedAt)) {
    helpers.invalidInput("invalid approved_at");
  }
};

export const assertListGateAuditInput = (
  input: ListGateAuditRecordsInput,
  helpers: RuntimeStoreValidationContext
): void => {
  if (input.runId !== undefined && input.runId.trim().length === 0) {
    helpers.invalidInput("run_id is empty");
  }
  if (input.sessionId !== undefined && input.sessionId.trim().length === 0) {
    helpers.invalidInput("session_id is empty");
  }
  if (input.profile !== undefined && input.profile.trim().length === 0) {
    helpers.invalidInput("profile is empty");
  }
  if (
    input.limit !== undefined &&
    (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 100)
  ) {
    helpers.invalidInput("invalid limit");
  }
};
