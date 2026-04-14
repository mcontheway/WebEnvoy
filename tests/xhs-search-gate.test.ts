import { describe, expect, it } from "vitest";
import {
  buildIssue209PostGateArtifacts,
  evaluateXhsGateCore,
  resolveXhsGateDecisionId
} from "../shared/xhs-gate.js";
import { resolveActualTargetGateReasons, resolveGate } from "../extension/xhs-search-gate.js";
import {
  validateIssue209AuditSourceAgainstCurrentLinkage
} from "../shared/issue209-live-read/source-validation.js";

const createAdmissionContext = (input?: {
  run_id?: string;
  request_id?: string;
  decision_id?: string;
  approval_id?: string;
  session_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_high_risk" | "live_read_limited";
  risk_state?: "allowed" | "limited";
}) => {
  const runId = input?.run_id ?? "run-extension-001";
  const requestId = input?.request_id;
  const decisionId = input?.decision_id;
  const approvalId = input?.approval_id;
  const refSuffix = requestId ? `${runId}_${requestId}` : runId;
  return ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
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
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
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

type AuditRecordOptions = {
  decisionId: string;
  approvalId: string;
  targetTabId: number;
  targetPage: string;
  requestedExecutionMode: "live_read_high_risk" | "live_read_limited";
  auditedChecks?: Record<string, boolean>;
  overrides?: Record<string, unknown>;
};

const defaultAuditChecks = {
  target_domain_confirmed: true,
  target_tab_confirmed: true,
  target_page_confirmed: true,
  risk_state_checked: true,
  action_type_confirmed: true
};

const createAuditRecord = (input: AuditRecordOptions) => ({
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
  audited_checks: input.auditedChecks ?? defaultAuditChecks,
  recorded_at: "2026-03-23T10:00:30.000Z",
  ...input.overrides
});

const createIssue209InvocationLinkage = (runId: string, suffix: string) => {
  const gateInvocationId = `issue209-gate-${runId}-${suffix}`;
  const decisionId = `gate_decision_${gateInvocationId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return { gateInvocationId, decisionId, approvalId };
};

const buildAuditValidationContext = () => {
  const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
    "run-extension-audit-validation-001",
    "audit-validation-001"
  );
  return {
    commandRequestId: "issue209-live-req-1",
    gateInvocationId,
    decisionId,
    approvalId,
    issueScope: "issue_209",
    targetDomain: "www.xiaohongshu.com",
    targetTabId: 12,
    targetPage: "search_result_tab",
    actionType: "read",
    requestedExecutionMode: "live_read_high_risk",
    riskState: "allowed"
  };
};

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

  it("requires gate_invocation_id for issue_209 live-read gate linkage", () => {
    expect(() =>
      resolveGate(
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
          admission_context: createAdmissionContext()
        },
        {
          runId: "run-extension-001",
          requestId: "req-1",
          sessionId: "session-extension-001",
          profile: "profile-a"
        }
      )
    ).toThrow("issue_209 live-read requires gate_invocation_id");
  });

  it("does not derive issue_209 live gate linkage from caller request ids", () => {
    expect(() =>
      resolveGate(
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
          })
        },
        {
          runId: "run-extension-command-request-001",
          requestId: "transport-req-1",
          commandRequestId: "issue209-live-req-1",
          sessionId: "session-extension-command-request-001",
          profile: "profile-a"
        }
      )
    ).toThrow("issue_209 live-read requires gate_invocation_id");
  });

  it("keeps non-issue209 gate linkage tied to dispatch identity instead of caller request_id", () => {
    const firstDecisionId = resolveXhsGateDecisionId({
      runId: "run-extension-generic-identity-001",
      requestId: "dispatch-req-1",
      commandRequestId: "caller-req-reused",
      issueScope: "issue_208",
      requestedExecutionMode: "dry_run",
      targetPage: "search_result_tab",
      targetTabId: 12
    });
    const secondDecisionId = resolveXhsGateDecisionId({
      runId: "run-extension-generic-identity-001",
      requestId: "dispatch-req-2",
      commandRequestId: "caller-req-reused",
      issueScope: "issue_208",
      requestedExecutionMode: "dry_run",
      targetPage: "search_result_tab",
      targetTabId: 12
    });

    expect(firstDecisionId).toBe("gate_decision_run-extension-generic-identity-001_dispatch-req-1");
    expect(secondDecisionId).toBe("gate_decision_run-extension-generic-identity-001_dispatch-req-2");
    expect(firstDecisionId).not.toBe(secondDecisionId);
  });

  it("prefers gate_invocation_id over caller request ids for live gate linkage", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-command-request-001",
      "gate-invocation-001"
    );
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
          session_id: "session-extension-gate-invocation-001"
        }),
        audit_record: createAuditRecord({
          decisionId: "gate_decision_previous_issue209_request_linkage",
          approvalId: "gate_appr_gate_decision_previous_issue209_request_linkage",
          targetTabId: 12,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-command-request-001",
        gateInvocationId,
        sessionId: "session-extension-gate-invocation-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.approval_record.approval_id).toBe(approvalId);
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("does not require admission evidence to pre-match internal gate ids", () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-plain-admission-001",
      "plain-admission-001"
    );
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
            approval_admission_ref: "approval_admission_plain-admission-001",
            run_id: "run-extension-plain-admission-001",
            session_id: "session-extension-plain-001",
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
            audit_admission_ref: "audit_admission_plain-admission-001",
            run_id: "run-extension-plain-admission-001",
            session_id: "session-extension-plain-001",
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
        gateInvocationId,
        sessionId: "session-extension-plain-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
  });

  it("blocks admission evidence from an older native-messaging session", () => {
    const { gateInvocationId } = createIssue209InvocationLinkage(
      "run-extension-session-rebind-001",
      "session-rebind-001"
    );
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
          run_id: "run-extension-session-rebind-001",
          session_id: "stale-session-001"
        }),
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
        }
      },
      {
        runId: "run-extension-session-rebind-001",
        requestId: "req-session-rebind-1",
        gateInvocationId,
        sessionId: "session-extension-current-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run"
    });
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"])
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
        gateInvocationId: "issue209-gate-run-extension-command-request-001-a",
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
        runId: "run-extension-command-request-001",
        requestId: "transport-req-2",
        commandRequestId: "issue209-live-req-reused",
        gateInvocationId: "issue209-gate-run-extension-command-request-001-b",
        sessionId: "session-extension-command-request-001",
        profile: "profile-a"
      }
    );

    expect(firstGate.gate_outcome.decision_id).toBe(
      "gate_decision_issue209-gate-run-extension-command-request-001-a"
    );
    expect(secondGate.gate_outcome.decision_id).toBe(
      "gate_decision_issue209-gate-run-extension-command-request-001-b"
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
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-003",
      "reused-approval-001"
    );
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
        gateInvocationId,
        sessionId: "session-extension-003",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("blocks live approval when a legacy approval_record omits decision_id", () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-004",
      "legacy-approval-001"
    );
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
        gateInvocationId,
        sessionId: "session-extension-004",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("ignores stale caller audit_record when admission evidence already matches the current request", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-005",
      "current-live-limited-001"
    );
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
        admission_context: createAdmissionContext({
          run_id: "run-extension-005",
          request_id: "req-5",
          session_id: "session-extension-005",
          target_tab_id: 36,
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        }),
        approval_record: createApprovalRecord(decisionId, approvalId),
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
        gateInvocationId,
        sessionId: "session-extension-005",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("allowed");
    expect(gate.gate_outcome.effective_execution_mode).toBe("live_read_limited");
    expect(gate.gate_outcome.gate_reasons).toEqual(["LIVE_MODE_APPROVED"]);
    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.approval_record.approval_id).toBe(approvalId);
  });

  it("allows explicit admission_context without mirrored approval_record", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-explicit-admission-only-001",
      "explicit-admission-only-001"
    );
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
        admission_context: createAdmissionContext({
          run_id: "run-extension-explicit-admission-only-001",
          request_id: "req-explicit-only-1",
          session_id: "session-extension-explicit-only-001",
          target_tab_id: 36,
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        })
      },
      {
        runId: "run-extension-explicit-admission-only-001",
        requestId: "req-explicit-only-1",
        gateInvocationId,
        sessionId: "session-extension-explicit-only-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "allowed",
      effective_execution_mode: "live_read_limited",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(gate.approval_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00.000Z",
      checks: defaultAuditChecks
    });
  });

  it("blocks admission evidence when it carries a stale internal decision linkage", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-linkage-mismatch-001",
      "linkage-mismatch-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 40,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 40,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-linkage-mismatch-001",
          request_id: "req-linkage-001",
          decision_id: "gate_decision_previous_req",
          approval_id: "gate_appr_gate_decision_previous_req",
          target_tab_id: 40
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-linkage-mismatch-001",
        requestId: "req-linkage-001",
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"])
    );
  });

  it("blocks admission evidence when only one internal linkage field is present", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-linkage-mismatch-002",
      "linkage-mismatch-002"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 44,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 44,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-linkage-mismatch-002",
          request_id: "req-linkage-002",
          approval_id: approvalId,
          target_tab_id: 44
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-linkage-mismatch-002",
        requestId: "req-linkage-002",
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"])
    );
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
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      scenario.runId,
      `${scenario.label}-current`
    );
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
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe(scenario.expectedFallback);
    expect(gate.gate_outcome.gate_reasons).toEqual(expect.arrayContaining(scenario.expectedReasons));
  });

  it("blocks live gate when approval admission evidence omits stable approval_admission_ref", () => {
    const runId = "run-extension-admission-ref-missing-001";
    const requestId = "req-admission-ref-missing-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "approval-ref-missing-001"
    );
    const completeAdmissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId
    });
    const { approval_admission_ref: _approvalAdmissionRef, ...approvalEvidence } =
      completeAdmissionContext.approval_admission_evidence;
    const admissionContext = {
      ...completeAdmissionContext,
      approval_admission_evidence: approvalEvidence
    };

    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 72,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 72,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: 72,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        })
      },
      {
        runId,
        requestId,
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"])
    );
  });

  it("blocks live gate when audit admission evidence omits stable audit_admission_ref", () => {
    const runId = "run-extension-audit-ref-missing-001";
    const requestId = "req-audit-ref-missing-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "audit-ref-missing-001"
    );
    const completeAdmissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId
    });
    const { audit_admission_ref: _auditAdmissionRef, ...auditEvidence } =
      completeAdmissionContext.audit_admission_evidence;
    const admissionContext = {
      ...completeAdmissionContext,
      audit_admission_evidence: auditEvidence
    };

    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 84,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 84,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: 84,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        })
      },
      {
        runId,
        requestId,
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["AUDIT_RECORD_MISSING"])
    );
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

  it("emits audited_checks in issued issue_209 audit artifacts", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-issued-audit-001",
      "issued-audit-001"
    );
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
          run_id: "run-extension-issued-audit-001",
          request_id: "req-issued-audit-1",
          session_id: "session-extension-issued-audit-001",
          decision_id: decisionId,
          approval_id: approvalId
        })
      },
      {
        runId: "run-extension-issued-audit-001",
        requestId: "req-issued-audit-1",
        gateInvocationId,
        sessionId: "session-extension-issued-audit-001",
        profile: "profile-a"
      }
    );

    const artifacts = buildIssue209PostGateArtifacts({
      runId: "run-extension-issued-audit-001",
      sessionId: "session-extension-issued-audit-001",
      profile: "profile-a",
      gate,
      now: () => new Date("2026-03-23T10:10:00.000Z").getTime()
    });

    expect(artifacts.audit_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      gate_decision: "allowed",
      audited_checks: defaultAuditChecks
    });

    const validation = validateIssue209AuditSourceAgainstCurrentLinkage({
      current: {
        commandRequestId: "req-issued-audit-1",
        gateInvocationId,
        decisionId,
        approvalId,
        issueScope: "issue_209",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 12,
        targetPage: "search_result_tab",
        actionType: "read",
        requestedExecutionMode: "live_read_high_risk",
        riskState: "allowed"
      },
      auditRecord: artifacts.audit_record
    });

    expect(validation.isValid).toBe(true);
    expect(validation.auditRequirementGaps).toEqual([]);
  });

  describe("issue_209 audit source validation", () => {
    it("rejects audit sources with mismatched linkage", () => {
      const current = buildAuditValidationContext();
      const { auditRequirementGaps, isValid } = validateIssue209AuditSourceAgainstCurrentLinkage({
        current,
        auditSource: {
          event_id: "audit-linkage-validation",
          decision_id: "gate_decision_stale",
          approval_id: "gate_appr_stale",
          issue_scope: current.issueScope,
          target_domain: current.targetDomain,
          target_tab_id: current.targetTabId,
          target_page: current.targetPage,
          action_type: current.actionType,
          requested_execution_mode: current.requestedExecutionMode,
          risk_state: current.riskState,
          gate_decision: "allowed",
          audited_checks: defaultAuditChecks,
          recorded_at: "2026-03-23T10:00:30.000Z",
          request_id: current.commandRequestId
        },
        requestIdWasExplicit: true
      });

      expect(isValid).toBe(false);
      expect(auditRequirementGaps).toEqual(
        expect.arrayContaining(["audit_record_linkage_invalid"])
      );
    });

    it("rejects audit sources missing audited checks", () => {
      const current = buildAuditValidationContext();
      const { auditRequirementGaps, isValid } = validateIssue209AuditSourceAgainstCurrentLinkage({
        current,
        auditSource: {
          event_id: "audit-missing-checks-validation",
          decision_id: current.decisionId,
          approval_id: current.approvalId,
          issue_scope: current.issueScope,
          target_domain: current.targetDomain,
          target_tab_id: current.targetTabId,
          target_page: current.targetPage,
          action_type: current.actionType,
          requested_execution_mode: current.requestedExecutionMode,
          risk_state: current.riskState,
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z",
          request_id: current.commandRequestId
        },
        requestIdWasExplicit: true
      });

      expect(isValid).toBe(false);
      expect(auditRequirementGaps).toEqual(expect.arrayContaining(["audit_record_checks_all_true"]));
    });
  });

});
