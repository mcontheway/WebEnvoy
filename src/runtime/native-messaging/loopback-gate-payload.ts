import {
  buildRiskTransitionAudit,
  buildUnifiedRiskStateOutput,
  getIssueActionMatrixEntry,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState,
  type IssueActionMatrixEntry,
  type IssueScope,
  type RiskState
} from "../../../shared/risk-state.js";
import type { LoopbackGate } from "./loopback-gate.js";
import { LOOPBACK_PLUGIN_GATE_OWNERSHIP } from "./loopback-gate.js";
import { buildLoopbackGateObservability } from "./loopback-gate-observability.js";

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolveLoopbackRiskState = (value: unknown): RiskState => resolveSharedRiskState(value);

const resolveLoopbackIssueScope = (value: unknown): IssueScope =>
  (value === "issue_208" || value === "issue_209"
    ? value
    : resolveSharedIssueScope(value)) as IssueScope;

const resolveLoopbackIssueActionMatrixEntry = (
  issueScope: IssueScope,
  riskState: RiskState
): IssueActionMatrixEntry => getIssueActionMatrixEntry(issueScope, riskState);

export const buildLoopbackGatePayload = (input: {
  runId: string;
  sessionId: string;
  profile: string;
  gate: LoopbackGate;
  auditRecord: Record<string, unknown>;
}): Record<string, unknown> => {
  const clone = <T>(value: T): T => structuredClone(value);
  const riskTransitionAudit = buildRiskTransitionAudit({
    runId: input.runId,
    sessionId: input.sessionId,
    issueScope: resolveLoopbackIssueScope(input.gate.gateInput.issue_scope),
    prevState: resolveLoopbackRiskState(input.gate.gateInput.risk_state),
    decision:
      input.gate.consumerGateResult.gate_decision === "allowed" ? "allowed" : "blocked",
    gateReasons: Array.isArray(input.gate.consumerGateResult.gate_reasons)
      ? input.gate.consumerGateResult.gate_reasons.map((item) => String(item))
      : [],
    requestedExecutionMode: asString(input.gate.gateInput.requested_execution_mode),
    approvalRecord: input.gate.approvalRecord,
    auditRecords: [input.auditRecord],
    now: String(input.auditRecord.recorded_at ?? "")
  });
  const resolvedRiskState = resolveLoopbackRiskState(riskTransitionAudit.next_state);
  const resolvedIssueActionMatrix = resolveLoopbackIssueActionMatrixEntry(
    resolveLoopbackIssueScope(input.gate.gateInput.issue_scope),
    resolvedRiskState
  );
  const persistedAuditRecord: Record<string, unknown> = {
    ...clone(input.auditRecord),
    next_state: riskTransitionAudit.next_state,
    transition_trigger: riskTransitionAudit.trigger
  };
  const gateInput = {
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    ...input.gate.gateInput
  };

  return {
    plugin_gate_ownership: LOOPBACK_PLUGIN_GATE_OWNERSHIP,
    scope_context: clone(input.gate.scopeContext),
    gate_input: clone(gateInput),
    gate_outcome: clone(input.gate.gateOutcome),
    consumer_gate_result: clone(input.gate.consumerGateResult),
    request_admission_result: input.gate.requestAdmissionResult
      ? clone(input.gate.requestAdmissionResult)
      : null,
    execution_audit: input.gate.executionAudit ? clone(input.gate.executionAudit) : null,
    approval_record: clone(input.gate.approvalRecord),
    issue_action_matrix: clone(resolvedIssueActionMatrix),
    write_interaction_tier: clone(input.gate.writeInteractionTier),
    write_action_matrix_decisions: input.gate.writeActionMatrixDecisions
      ? clone(input.gate.writeActionMatrixDecisions)
      : null,
    observability: buildLoopbackGateObservability(input.gate),
    read_execution_policy: clone(input.gate.readExecutionPolicy),
    risk_state_output: buildUnifiedRiskStateOutput(resolvedRiskState, {
      auditRecords: [clone(persistedAuditRecord)],
      now: String(persistedAuditRecord.recorded_at ?? "")
    }),
    audit_record: clone(persistedAuditRecord),
    risk_transition_audit: clone(riskTransitionAudit)
  };
};
