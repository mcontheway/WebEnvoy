import type { LoopbackGate } from "./loopback-gate.js";

export type LoopbackAuditSource = Pick<
  LoopbackGate,
  "gateInput" | "consumerGateResult" | "approvalRecord" | "writeActionMatrixDecisions"
>;

export const buildLoopbackAuditRecord = (input: {
  runId: string;
  sessionId: string;
  profile: string;
  gate: LoopbackAuditSource;
}): Record<string, unknown> => {
  const clone = <T>(value: T): T => structuredClone(value);

  return {
    event_id: `gate_evt_${input.runId}`,
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    risk_state: String(input.gate.gateInput.risk_state ?? "paused"),
    target_domain: input.gate.consumerGateResult.target_domain,
    target_tab_id: input.gate.consumerGateResult.target_tab_id,
    target_page: input.gate.consumerGateResult.target_page,
    action_type: input.gate.consumerGateResult.action_type,
    requested_execution_mode: input.gate.consumerGateResult.requested_execution_mode,
    effective_execution_mode: input.gate.consumerGateResult.effective_execution_mode,
    gate_decision: input.gate.consumerGateResult.gate_decision,
    gate_reasons: clone(input.gate.consumerGateResult.gate_reasons),
    approver: input.gate.approvalRecord.approver,
    approved_at: input.gate.approvalRecord.approved_at,
    write_interaction_tier: input.gate.writeActionMatrixDecisions?.write_interaction_tier ?? null,
    write_action_matrix_decisions: input.gate.writeActionMatrixDecisions
      ? clone(input.gate.writeActionMatrixDecisions)
      : null,
    recorded_at: "2026-03-23T10:00:00.000Z"
  };
};
