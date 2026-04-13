import { buildIssue209PostGateArtifacts } from "../../../shared/xhs-gate.js";
export const buildLoopbackAuditRecord = (input) => {
    if (input.gate.gateInput.issue_scope === "issue_209" &&
        (input.gate.consumerGateResult.requested_execution_mode === "live_read_limited" ||
            input.gate.consumerGateResult.requested_execution_mode === "live_read_high_risk")) {
        const artifacts = buildIssue209PostGateArtifacts({
            runId: input.runId,
            sessionId: input.sessionId,
            profile: input.profile,
            gate: {
                gate_input: input.gate.gateInput,
                gate_outcome: input.gate.gateOutcome,
                consumer_gate_result: input.gate.consumerGateResult,
                approval_record: input.gate.approvalRecord,
                write_action_matrix_decisions: input.gate.writeActionMatrixDecisions
            },
            now: () => new Date("2026-03-23T10:00:00.000Z").getTime()
        });
        input.gate.approvalRecord = structuredClone(artifacts.approval_record);
        return artifacts.audit_record;
    }
    const clone = (value) => structuredClone(value);
    const decisionId = String(input.gate.gateOutcome.decision_id ?? `gate_decision_${input.runId}`);
    const approvalId = typeof input.gate.approvalRecord.approval_id === "string" &&
        input.gate.approvalRecord.approval_id.length > 0
        ? input.gate.approvalRecord.approval_id
        : null;
    return {
        event_id: `gate_evt_${decisionId}`,
        decision_id: decisionId,
        approval_id: approvalId,
        run_id: input.runId,
        session_id: input.sessionId,
        profile: input.profile,
        issue_scope: input.gate.gateInput.issue_scope,
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
