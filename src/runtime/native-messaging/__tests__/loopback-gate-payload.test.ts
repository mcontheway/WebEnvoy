import { describe, expect, it } from "vitest";

import { buildLoopbackGatePayload } from "../loopback-gate-payload.js";
import { createLoopbackGateFixture } from "./loopback-gate-test-fixtures.js";

describe("native messaging loopback gate payload", () => {
  it("wraps gate audit data with risk transition and observability metadata", () => {
    const gate = createLoopbackGateFixture({
      gateInput: {
        issue_scope: "issue_208",
        risk_state: "paused",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 9,
        target_page: "creator_publish_tab",
        action_type: "write",
        requested_execution_mode: "live_write"
      },
      consumerGateResult: {
        gate_decision: "blocked",
        gate_reasons: ["TARGET_DOMAIN_OUT_OF_SCOPE"],
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 9,
        target_page: "creator_publish_tab",
        action_type: "write",
        requested_execution_mode: "live_write",
        effective_execution_mode: "dry_run"
      },
      executionAudit: {
        decision_id: "gate_decision_run-001",
        admission_decision: "blocked",
        effective_execution_mode: "dry_run",
        risk_signals: ["TARGET_DOMAIN_OUT_OF_SCOPE"],
        reason_codes: ["TARGET_DOMAIN_OUT_OF_SCOPE", "LIVE_MODE_APPROVED"]
      }
    });

    const payload = buildLoopbackGatePayload({
      runId: "run-001",
      sessionId: "session-001",
      profile: "profile-a",
      gate,
      auditRecord: {
        event_id: "gate_evt_gate_decision_run-001",
        decision_id: "gate_decision_run-001",
        approval_id: "gate_appr_run-001",
        run_id: "run-001",
        session_id: "session-001",
        profile: "profile-a",
        recorded_at: "2026-03-23T10:00:00.000Z"
      }
    });

    expect(payload).toMatchObject({
      plugin_gate_ownership: {
        background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
        content_script_gate: ["page_context_check", "action_tier_check"],
        main_world_gate: ["signed_call_scope_check"],
        cli_role: "request_and_result_shell_only"
      },
      gate_input: {
        run_id: "run-001",
        session_id: "session-001",
        profile: "profile-a",
        issue_scope: "issue_208"
      },
      consumer_gate_result: {
        gate_decision: "blocked"
      },
      execution_audit: {
        decision_id: "gate_decision_run-001",
        admission_decision: "blocked",
        effective_execution_mode: "dry_run",
        risk_signals: ["TARGET_DOMAIN_OUT_OF_SCOPE"],
        reason_codes: ["TARGET_DOMAIN_OUT_OF_SCOPE", "LIVE_MODE_APPROVED"]
      },
      observability: {
        page_state: {
          observation_status: "complete"
        },
        failure_site: {
          component: "gate"
        }
      },
      audit_record: {
        event_id: "gate_evt_gate_decision_run-001",
        decision_id: "gate_decision_run-001",
        approval_id: "gate_appr_run-001",
        next_state: "paused"
      },
      risk_transition_audit: {
        run_id: "run-001",
        session_id: "session-001"
      }
    });

    const payloadGateReasons = payload.consumer_gate_result as
      | { gate_reasons?: string[] }
      | null
      | undefined;
    payloadGateReasons?.gate_reasons?.push("MUTATED");
    const payloadAuditDecisions = payload.audit_record as
      | { write_action_matrix_decisions?: { decisions?: string[] } | null }
      | null
      | undefined;
    payloadAuditDecisions?.write_action_matrix_decisions?.decisions?.push("MUTATED");
    const payloadExecutionAudit = payload.execution_audit as
      | { risk_signals?: string[]; reason_codes?: string[] }
      | null
      | undefined;
    payloadExecutionAudit?.risk_signals?.push("MUTATED");
    expect(gate.consumerGateResult.gate_reasons).toEqual(["TARGET_DOMAIN_OUT_OF_SCOPE"]);
    expect(gate.executionAudit).toEqual({
      decision_id: "gate_decision_run-001",
      admission_decision: "blocked",
      effective_execution_mode: "dry_run",
      risk_signals: ["TARGET_DOMAIN_OUT_OF_SCOPE"],
      reason_codes: ["TARGET_DOMAIN_OUT_OF_SCOPE", "LIVE_MODE_APPROVED"]
    });
    expect(gate.writeActionMatrixDecisions?.decisions).toEqual([]);
    expect(gate.readExecutionPolicy.blocked_actions).toEqual(["expand_new_live_surface_without_gate"]);
  });
});
