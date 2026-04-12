import { describe, expect, it } from "vitest";
import { evaluateXhsGateCore } from "../shared/xhs-gate.js";
import { resolveActualTargetGateReasons, resolveGate } from "../extension/xhs-search-gate.js";

const createAdmissionContext = (input?: {
  run_id?: string;
  request_id?: string;
  session_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_high_risk" | "live_read_limited";
  risk_state?: "allowed" | "limited";
}) => {
  const runId = input?.run_id ?? "run-extension-001";
  const requestId = input?.request_id;
  const decisionId = requestId ? `gate_decision_${runId}_${requestId}` : `gate_decision_${runId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return ({
  approval_admission_evidence: {
    approval_admission_ref: approvalId,
    decision_id: decisionId,
    approval_id: approvalId,
    run_id: runId,
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
    audit_admission_ref: `gate_evt_${decisionId}`,
    decision_id: decisionId,
    approval_id: approvalId,
    run_id: runId,
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
};

const createApprovalRecord = (decisionId: string, approvalId: string) => ({
  approval_id: approvalId,
  decision_id: decisionId,
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
});

const createAuditRecord = (input: {
  decisionId: string;
  approvalId: string;
  targetTabId: number;
  targetPage: string;
  requestedExecutionMode: "live_read_high_risk" | "live_read_limited";
}) => ({
  event_id: `audit-${input.decisionId}`,
  decision_id: input.decisionId,
  approval_id: input.approvalId,
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: input.targetTabId,
  target_page: input.targetPage,
  action_type: "read",
  requested_execution_mode: input.requestedExecutionMode,
  gate_decision: "allowed",
  recorded_at: "2026-03-23T10:00:30.000Z"
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

  it("uses transport request_id when command request_id is absent", () => {
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
          approval_id: "gate_appr_custom_extension_req-1"
        }),
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
          request_id: "issue209-live-req-1",
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

  it("does not require admission evidence to pre-match internal gate ids", () => {
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
        admission_context: {
          approval_admission_evidence: {
            run_id: "run-extension-plain-admission-001",
            session_id: "stale-session-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 12,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
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
            run_id: "run-extension-plain-admission-001",
            session_id: "stale-session-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 12,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:00:30.000Z"
          }
        },
        approval_record: {
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
          event_id: "audit-extension-plain-admission-001",
          decision_id: "gate_decision_run-extension-plain-admission-001_req-plain-1",
          approval_id: "gate_appr_gate_decision_run-extension-plain-admission-001_req-plain-1",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        }
      },
      {
        runId: "run-extension-plain-admission-001",
        requestId: "req-plain-1",
        sessionId: "session-extension-plain-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      decision_id: "gate_decision_run-extension-plain-admission-001_req-plain-1",
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
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
          request_id: "req-3",
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

  it.each([
    {
      label: "run_id",
      runId: "run-extension-admission-mismatch-001",
      requestId: "req-admission-run",
      targetTabId: 12,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({ run_id: "run-extension-admission-stale-001" }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "target_tab_id",
      runId: "run-extension-admission-mismatch-002",
      requestId: "req-admission-tab",
      targetTabId: 24,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({ run_id: "run-extension-admission-mismatch-002", target_tab_id: 25 }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "target_page",
      runId: "run-extension-admission-mismatch-003",
      requestId: "req-admission-page",
      targetTabId: 36,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-003",
        target_tab_id: 36,
        target_page: "explore_detail_tab"
      }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "requested_execution_mode",
      runId: "run-extension-admission-mismatch-004",
      requestId: "req-admission-mode",
      targetTabId: 48,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-004",
        target_tab_id: 48,
        requested_execution_mode: "live_read_limited"
      }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "risk_state",
      runId: "run-extension-admission-mismatch-005",
      requestId: "req-admission-risk",
      targetTabId: 60,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_limited" as const,
      riskState: "limited" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-005",
        target_tab_id: 60,
        requested_execution_mode: "live_read_limited",
        risk_state: "allowed"
      }),
      expectedFallback: "recon",
      expectedReasons: ["AUDIT_RECORD_MISSING"]
    }
  ])("blocks live gate when admission evidence %s mismatches current request", (scenario) => {
    const decisionId = `gate_decision_${scenario.runId}_${scenario.requestId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: scenario.riskState,
        target_domain: "www.xiaohongshu.com",
        target_tab_id: scenario.targetTabId,
        target_page: scenario.targetPage,
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: scenario.targetTabId,
        actual_target_page: scenario.targetPage,
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: scenario.requestedExecutionMode,
        admission_context: scenario.admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: scenario.targetTabId,
          targetPage: scenario.targetPage,
          requestedExecutionMode: scenario.requestedExecutionMode
        }),
        limited_read_rollout_ready_true: scenario.requestedExecutionMode === "live_read_limited"
      },
      {
        runId: scenario.runId,
        requestId: scenario.requestId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe(scenario.expectedFallback);
    expect(gate.gate_outcome.gate_reasons).toEqual(expect.arrayContaining(scenario.expectedReasons));
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
