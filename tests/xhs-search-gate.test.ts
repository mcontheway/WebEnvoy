import { describe, expect, it } from "vitest";
import { resolveActualTargetGateReasons, resolveGate } from "../extension/xhs-search-gate.js";

describe("xhs-search gate helpers", () => {
  it("flags mismatched actual target context", () => {
    expect(
      resolveActualTargetGateReasons({
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 8,
        actual_target_page: "creator_publish_tab"
      })
    ).toEqual(
      expect.arrayContaining([
        "TARGET_DOMAIN_CONTEXT_MISMATCH",
        "TARGET_TAB_CONTEXT_MISMATCH",
        "TARGET_PAGE_CONTEXT_MISMATCH"
      ])
    );
  });

  it("regenerates decision_id per gate evaluation while preserving approval_id for live approvals", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        approval_record: {
          approval_id: "gate_appr_custom_extension_req-1",
          decision_id: "gate_decision_custom_extension_req-1",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-001",
        requestId: "req-1",
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe("gate_decision_run-extension-001_req-1");
    expect(gate.approval_record.approval_id).toBe("gate_appr_custom_extension_req-1");
    expect(gate.approval_record.decision_id).toBe("gate_decision_run-extension-001_req-1");
  });

  it("clears stale approval_id for non-live gate results", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "paused",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 18,
        target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "dry_run",
        approval_record: {
          approval_id: "gate_appr_stale_extension_req-2",
          decision_id: "gate_decision_stale_extension_req-2",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-002",
        requestId: "req-2",
        sessionId: "session-extension-002",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe("gate_decision_run-extension-002_req-2");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe("gate_decision_run-extension-002_req-2");
  });
});
