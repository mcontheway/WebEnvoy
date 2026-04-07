import { describe, expect, it } from "vitest";

import { buildLoopbackAuditRecord } from "../loopback-gate-audit.js";
import { createLoopbackAuditFixture } from "./loopback-gate-test-fixtures.js";

describe("native messaging loopback gate audit", () => {
  it("records the gate outcome into the audit envelope", () => {
    const gate = createLoopbackAuditFixture();
    const audit = buildLoopbackAuditRecord({
      runId: "run-001",
      sessionId: "session-001",
      profile: "profile-a",
      gate
    });

    (audit.gate_reasons as string[]).push("MUTATED");
    const decisions = audit.write_action_matrix_decisions as
      | { decisions?: string[] }
      | null
      | undefined;
    decisions?.decisions?.push("MUTATED");

    expect(audit).toMatchObject({
      event_id: "gate_evt_run-001",
      run_id: "run-001",
      session_id: "session-001",
      profile: "profile-a",
      risk_state: "paused",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 1,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "dry_run",
      effective_execution_mode: "dry_run",
      gate_decision: "allowed",
      approver: "loopback-agent",
      approved_at: "2026-03-23T10:00:00.000Z",
      write_interaction_tier: "observe_only",
      recorded_at: "2026-03-23T10:00:00.000Z"
    });
    expect(gate.consumerGateResult.gate_reasons).toEqual([]);
    expect(gate.writeActionMatrixDecisions?.decisions).toEqual([]);
  });
});
