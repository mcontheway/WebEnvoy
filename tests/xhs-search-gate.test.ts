import { describe, expect, it } from "vitest";
import { evaluateXhsGateCore } from "../shared/xhs-gate.js";
import { resolveActualTargetGateReasons, resolveGate } from "../extension/xhs-search-gate.js";

const createAdmissionContext = (input?: {
  run_id?: string;
  session_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_high_risk" | "live_read_limited";
  risk_state?: "allowed" | "limited";
}) => ({
  approval_admission_evidence: {
    approval_admission_ref: "gate_appr_issue209_extension_001",
    run_id: input?.run_id ?? "run-extension-001",
    session_id: input?.session_id ?? "session-extension-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 12,
    target_page: input?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input?.requested_execution_mode ?? "live_read_high_risk",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00.000Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00.000Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: "gate_evt_issue209_extension_001",
    run_id: input?.run_id ?? "run-extension-001",
    session_id: input?.session_id ?? "session-extension-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 12,
    target_page: input?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input?.requested_execution_mode ?? "live_read_high_risk",
    risk_state: input?.risk_state ?? "allowed",
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:30.000Z"
  }
});

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

  it("preserves approval_id when the provided approval linkage already matches the current decision", () => {
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
        admission_context: createAdmissionContext(),
        audit_record: {
          event_id: "audit-extension-req-1",
          decision_id: "gate_decision_run-extension-001_req-1",
          approval_id: "gate_appr_custom_extension_req-1",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        },
        approval_record: {
          approval_id: "gate_appr_custom_extension_req-1",
          decision_id: "gate_decision_run-extension-001_req-1",
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

  it("uses caller-provided command request_id for live gate linkage", () => {
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
        admission_context: createAdmissionContext({
          run_id: "run-extension-command-request-001",
          session_id: "session-extension-command-request-001"
        }),
        audit_record: {
          event_id: "audit-extension-command-req-1",
          decision_id:
            "gate_decision_run-extension-command-request-001_issue209-live-req-1",
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-001_issue209-live-req-1",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        },
        approval_record: {
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-001_issue209-live-req-1",
          decision_id:
            "gate_decision_run-extension-command-request-001_issue209-live-req-1",
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
        runId: "run-extension-command-request-001",
        requestId: "transport-req-1",
        commandRequestId: "issue209-live-req-1",
        sessionId: "session-extension-command-request-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(
      "gate_decision_run-extension-command-request-001_issue209-live-req-1"
    );
    expect(gate.approval_record.approval_id).toBe(
      "gate_appr_gate_decision_run-extension-command-request-001_issue209-live-req-1"
    );
    expect(gate.approval_record.decision_id).toBe(
      "gate_decision_run-extension-command-request-001_issue209-live-req-1"
    );
  });

  it("keeps gate decision IDs unique per run even when caller reuses request_id", () => {
    const firstGate = resolveGate(
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
        admission_context: createAdmissionContext(),
        approval_record: {
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-001_issue209-live-req-reused",
          decision_id:
            "gate_decision_run-extension-command-request-001_issue209-live-req-reused",
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
        runId: "run-extension-command-request-001",
        requestId: "transport-req-1",
        commandRequestId: "issue209-live-req-reused",
        sessionId: "session-extension-command-request-001",
        profile: "profile-a"
      }
    );
    const secondGate = resolveGate(
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
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-002_issue209-live-req-reused",
          decision_id:
            "gate_decision_run-extension-command-request-002_issue209-live-req-reused",
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
        runId: "run-extension-command-request-002",
        requestId: "transport-req-2",
        commandRequestId: "issue209-live-req-reused",
        sessionId: "session-extension-command-request-002",
        profile: "profile-a"
      }
    );

    expect(firstGate.gate_outcome.decision_id).toBe(
      "gate_decision_run-extension-command-request-001_issue209-live-req-reused"
    );
    expect(secondGate.gate_outcome.decision_id).toBe(
      "gate_decision_run-extension-command-request-002_issue209-live-req-reused"
    );
    expect(firstGate.gate_outcome.decision_id).not.toBe(secondGate.gate_outcome.decision_id);
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

  it("blocks live approval when a reused approval_record belongs to an older decision", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 24,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 24,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-003",
          session_id: "session-extension-003"
        }),
        audit_record: {
          event_id: "gate_evt_run-extension-003_req-3",
          decision_id: "gate_decision_run-extension-003_req-3",
          approval_id: "gate_appr_gate_decision_run-extension-003_req-3",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 24,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        },
        approval_record: {
          approval_id: "gate_appr_previous_req",
          decision_id: "gate_decision_previous_req",
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
        runId: "run-extension-003",
        requestId: "req-3",
        sessionId: "session-extension-003",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe("gate_decision_run-extension-003_req-3");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe("gate_decision_run-extension-003_req-3");
  });

  it("blocks live approval when a legacy approval_record omits decision_id", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 30,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 30,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        approval_record: {
          approval_id: "gate_appr_legacy_without_decision",
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
        runId: "run-extension-004",
        requestId: "req-4",
        sessionId: "session-extension-004",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe("gate_decision_run-extension-004_req-4");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe("gate_decision_run-extension-004_req-4");
  });

  it("blocks live_read_limited when audit_record linkage does not match the approved decision", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "limited",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 36,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 36,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_limited",
        limited_read_rollout_ready_true: true,
        approval_record: {
          approval_id: "gate_appr_gate_decision_run-extension-005_req-5",
          decision_id: "gate_decision_run-extension-005_req-5",
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
        },
        audit_record: {
          event_id: "gate_evt_issue209_stale_req-5",
          decision_id: "gate_decision_issue209_stale_req-5",
          approval_id: "gate_appr_issue209_stale_req-5",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 36,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        }
      },
      {
        runId: "run-extension-005",
        requestId: "req-5",
        sessionId: "session-extension-005",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("recon");
    expect(gate.gate_outcome.gate_reasons).toContain("AUDIT_RECORD_MISSING");
  });

  it("returns gate core state without throwing when admission_context is provided", () => {
    expect(() =>
      evaluateXhsGateCore({
        issueScope: "issue_209",
        riskState: "allowed",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 12,
        targetPage: "search_result_tab",
        actualTargetDomain: "www.xiaohongshu.com",
        actualTargetTabId: 12,
        actualTargetPage: "search_result_tab",
        actionType: "read",
        abilityAction: "read",
        requestedExecutionMode: "live_read_high_risk",
        admissionContext: createAdmissionContext({
          run_id: "run-core-001",
          session_id: "session-core-001"
        }),
        approvalRecord: {
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
      })
    ).not.toThrow();
  });

});
