import {
  WRITE_INTERACTION_TIER,
  ISSUE_SCOPES,
  getIssueActionMatrixEntry,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState,
  type IssueActionMatrixEntry,
  type IssueScope,
  type RiskState,
  type WriteActionMatrixDecisionsOutput
} from "../../../shared/risk-state.js";
import { evaluateXhsGate } from "../../../shared/xhs-gate.js";

export const RELAY_PATH = "host>background>content-script>background>host";

export const LOOPBACK_PLUGIN_GATE_OWNERSHIP = {
  background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
  content_script_gate: ["page_context_check", "action_tier_check"],
  main_world_gate: ["signed_call_scope_check"],
  cli_role: "request_and_result_shell_only"
} as const;

type LoopbackRiskState = RiskState;
type LoopbackIssueScope = IssueScope;
type LoopbackIssueActionMatrixEntry = IssueActionMatrixEntry;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolveLoopbackRiskState = (value: unknown): LoopbackRiskState => resolveSharedRiskState(value);

const resolveLoopbackIssueScope = (value: unknown): LoopbackIssueScope =>
  ISSUE_SCOPES.includes(value as LoopbackIssueScope)
    ? (value as LoopbackIssueScope)
    : resolveSharedIssueScope(value);

const resolveLoopbackIssueActionMatrixEntry = (
  issueScope: LoopbackIssueScope,
  riskState: LoopbackRiskState
): LoopbackIssueActionMatrixEntry => getIssueActionMatrixEntry(issueScope, riskState);

export const buildLoopbackGate = (
  options: Record<string, unknown>,
  abilityAction: string | null,
  linkage?: {
    runId?: string;
    decisionId?: string;
    approvalId?: string;
  }
): {
  scopeContext: Record<string, unknown>;
  readExecutionPolicy: Record<string, unknown>;
  issueScope: LoopbackIssueScope;
  issueActionMatrix: LoopbackIssueActionMatrixEntry;
  writeInteractionTier: typeof WRITE_INTERACTION_TIER;
  writeActionMatrixDecisions: WriteActionMatrixDecisionsOutput | null;
  gateInput: Record<string, unknown>;
  gateOutcome: Record<string, unknown>;
  consumerGateResult: Record<string, unknown>;
  approvalRecord: Record<string, unknown>;
} => {
  const clone = <T>(value: T): T => structuredClone(value);
  const issue208EditorInputValidation =
    options.issue_scope === "issue_208" &&
    options.requested_execution_mode === "live_write" &&
    asString(options.validation_action) === "editor_input";
  const evaluatedGate = evaluateXhsGate({
    issueScope: options.issue_scope,
    riskState: options.risk_state,
    targetDomain: options.target_domain,
    targetTabId: options.target_tab_id,
    targetPage: options.target_page,
    actionType: options.action_type,
    abilityAction,
    requestedExecutionMode: options.requested_execution_mode,
    approvalRecord: options.approval_record ?? options.approval,
    runId: linkage?.runId,
    decisionId: linkage?.decisionId,
    approvalId: linkage?.approvalId,
    issue208EditorInputValidation,
    treatMissingEditorValidationAsUnsupported: true,
    includeWriteInteractionTierReason: true,
    writeGateOnlyEligibleBehavior: "block"
  });
  const issueScope = resolveLoopbackIssueScope(evaluatedGate.gate_input.issue_scope);

  return {
    scopeContext: clone(evaluatedGate.scope_context) as unknown as Record<string, unknown>,
    readExecutionPolicy: clone(evaluatedGate.read_execution_policy) as unknown as Record<string, unknown>,
    issueScope,
    issueActionMatrix: clone(evaluatedGate.issue_action_matrix),
    gateInput: clone(evaluatedGate.gate_input),
    gateOutcome: clone(evaluatedGate.gate_outcome),
    consumerGateResult: clone(evaluatedGate.consumer_gate_result),
    approvalRecord: clone(evaluatedGate.approval_record) as unknown as Record<string, unknown>,
    writeInteractionTier: clone(WRITE_INTERACTION_TIER),
    writeActionMatrixDecisions: evaluatedGate.write_action_matrix_decisions
      ? clone(evaluatedGate.write_action_matrix_decisions)
      : null
  };
};

export type LoopbackGate = ReturnType<typeof buildLoopbackGate>;
