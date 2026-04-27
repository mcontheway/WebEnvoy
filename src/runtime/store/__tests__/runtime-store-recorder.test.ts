import { describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CliError } from "../../../core/errors.js";
import type { RuntimeContext } from "../../../core/types.js";
import { ProfileStore } from "../../profile-store.js";
import { RuntimeStoreRecorder } from "../runtime-store-recorder.js";
import { RuntimeStoreError } from "../sqlite-runtime-store.js";

const baseContext: RuntimeContext = {
  run_id: "run-recorder-001",
  command: "runtime.ping",
  profile: "default",
  params: {},
  cwd: "/tmp"
};

describe("runtime-store-recorder", () => {
  it("keeps startedAt stable from start to success", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordStart(baseContext);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recorder.recordSuccess(baseContext, {});

    expect(upsertRun).toHaveBeenCalledTimes(2);
    const startInput = upsertRun.mock.calls[0][0] as { startedAt: string };
    const successInput = upsertRun.mock.calls[1][0] as { startedAt: string };
    expect(successInput.startedAt).toBe(startInput.startedAt);
    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        summary: "command started",
        summaryTruncated: false
      })
    );
    expect(appendRunEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        summaryTruncated: false
      })
    );
  });

  it("keeps startedAt stable from start to failure", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordStart(baseContext);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recorder.recordFailure(baseContext, new CliError("ERR_EXECUTION_FAILED", "boom"));

    expect(upsertRun).toHaveBeenCalledTimes(2);
    const startInput = upsertRun.mock.calls[0][0] as { startedAt: string };
    const failureInput = upsertRun.mock.calls[1][0] as { startedAt: string };
    expect(failureInput.startedAt).toBe(startInput.startedAt);
    expect(appendRunEvent).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        diagnosisCategory: "unknown",
        stage: "execution",
        component: "runtime",
        failurePoint: "unknown",
        summary: "boom",
        summaryTruncated: false
      })
    );
  });

  it("reuses CLI fallback diagnosis for runtime unavailable failures", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_RUNTIME_UNAVAILABLE", "通信链路不可用: ERR_TRANSPORT_TIMEOUT", {
        retryable: true
      })
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        diagnosisCategory: "runtime_unavailable",
        stage: "runtime",
        component: "cli",
        failurePoint: "native-messaging",
        summary: "通信链路不可用: ERR_TRANSPORT_TIMEOUT",
        summaryTruncated: false
      })
    );
  });

  it("does not swallow runtime store write errors", async () => {
    const writeError = new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "db write failed");
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockRejectedValue(writeError);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await expect(recorder.recordSuccess(baseContext, {})).rejects.toBe(writeError);
  });

  it("projects diagnosis into runtime store failure events", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_EXECUTION_FAILED", "bridge timed out", {
        diagnosis: {
          category: "execution_interrupted",
          failure_site: {
            stage: "runtime_link",
            component: "extension",
            target: "native_bridge_open",
            summary: "heartbeat timeout after retry budget"
          },
          evidence: ["transport ack missing"]
        }
      })
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "runtime_link",
        component: "extension",
        diagnosisCategory: "execution_interrupted",
        failurePoint: "native_bridge_open",
        summary: "heartbeat timeout after retry budget",
        summaryTruncated: false
      })
    );
  });

  it("falls back to observability failure_site when diagnosis is absent", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_EXECUTION_FAILED", "blocked by page drift", {
        observability: {
          coverage: "partial",
          request_evidence: "none",
          key_requests: [],
          page_state: null,
          failure_site: {
            stage: "request",
            component: "network",
            target: "/api/sns/web/v1/user/otherinfo",
            summary: "account_abnormal gate returned 461"
          }
        }
      })
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "request",
        component: "network",
        diagnosisCategory: "request_failed",
        failurePoint: "/api/sns/web/v1/user/otherinfo",
        summary: "account_abnormal gate returned 461",
        summaryTruncated: false
      })
    );
  });

  it("preserves upstream diagnosis truncation when projecting failure events", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_EXECUTION_FAILED", "oversized diagnosis", {
        diagnosis: {
          failure_site: {
            stage: "request",
            component: "network",
            target: "edith.xiaohongshu.com/api/sns/web/v1/search/notes",
            summary: "x".repeat(400)
          }
        }
      })
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        diagnosisCategory: "request_failed",
        summaryTruncated: true
      })
    );
  });

  it("preserves truncation markers from already-shaped diagnoses", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_EXECUTION_FAILED", "forwarded runtime failure", {
        diagnosis: {
          category: "request_failed",
          failure_site: {
            stage: "request",
            component: "network",
            target: "/api/feed",
            summary: "already clipped upstream",
            summary_truncated: true
          }
        }
      })
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        diagnosisCategory: "request_failed",
        summary: "already clipped upstream",
        summaryTruncated: true
      })
    );
  });

  it("redacts oversized failure summaries when synthesizing CLI fallback diagnosis", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await recorder.recordFailure(
      baseContext,
      new CliError("ERR_EXECUTION_FAILED", `authorization=Bearer abc ${"x".repeat(1200)}`)
    );

    expect(appendRunEvent).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        diagnosisCategory: "unknown"
      })
    );
    const eventInput = appendRunEvent.mock.calls[0][0] as { summary: string };
    expect(eventInput.summary).toContain("[REDACTED]");
    expect(eventInput.summary).not.toContain("Bearer abc");
    expect(eventInput.summary).not.toContain("[TRUNCATED]");
    expect(eventInput.summary.length).toBeLessThanOrEqual(200);
  });

  it("preserves approval_id when recording gate artifacts", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue({
      approval_id: "gate_appr_custom_run-recorder-001",
      decision_id: "gate_decision_run-recorder-001_req-1"
    });
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await recorder.recordSuccess(
      { ...baseContext, command: "xhs.search" },
      {
        run_id: "run-recorder-001",
        gate_outcome: {
          decision_id: "gate_decision_run-recorder-001_req-1"
        },
        approval_record: {
          approval_id: "gate_appr_custom_run-recorder-001",
          decision_id: "gate_decision_run-recorder-001_req-1",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        },
        audit_record: {
          event_id: "gate_evt_gate_decision_run-recorder-001_req-1",
          decision_id: "gate_decision_run-recorder-001_req-1",
          approval_id: "gate_appr_custom_run-recorder-001",
          run_id: "run-recorder-001",
          session_id: "session-recorder-001",
          profile: "default",
          issue_scope: "issue_209",
          risk_state: "allowed",
          next_state: "allowed",
          transition_trigger: "manual_approval",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          recorded_at: "2026-03-23T10:00:11.000Z"
        }
      }
    );

    expect(upsertGateApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "gate_appr_custom_run-recorder-001",
        decisionId: "gate_decision_run-recorder-001_req-1",
        runId: "run-recorder-001"
      })
    );
    expect(appendGateAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "gate_evt_gate_decision_run-recorder-001_req-1",
        approvalId: "gate_appr_custom_run-recorder-001",
        decisionId: "gate_decision_run-recorder-001_req-1"
      })
    );
  });

  it("persists canonical live-read approvals synthesized from authorization_grant", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue({
      approval_id: "gate_appr_gate_decision_run-recorder-grant_req-1",
      decision_id: "gate_decision_run-recorder-grant_req-1"
    });
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await recorder.recordSuccess(
      { ...baseContext, command: "xhs.search" },
      {
        run_id: "run-recorder-grant",
        gate_outcome: {
          decision_id: "gate_decision_run-recorder-grant_req-1"
        },
        approval_record: {
          approval_id: "gate_appr_gate_decision_run-recorder-grant_req-1",
          decision_id: "gate_decision_run-recorder-grant_req-1",
          approved: true,
          approver: "authorization_grant",
          approved_at: "2026-04-15T09:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        },
        audit_record: {
          event_id: "gate_evt_gate_decision_run-recorder-grant_req-1",
          decision_id: "gate_decision_run-recorder-grant_req-1",
          approval_id: "gate_appr_gate_decision_run-recorder-grant_req-1",
          run_id: "run-recorder-grant",
          session_id: "session-recorder-grant",
          profile: "default",
          issue_scope: "issue_209",
          risk_state: "allowed",
          next_state: "allowed",
          transition_trigger: "canonical_authorization_grant",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "authorization_grant",
          approved_at: "2026-04-15T09:00:00.000Z",
          recorded_at: "2026-04-15T09:00:01.000Z"
        }
      }
    );

    expect(upsertGateApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "gate_appr_gate_decision_run-recorder-grant_req-1",
        decisionId: "gate_decision_run-recorder-grant_req-1",
        runId: "run-recorder-grant",
        approver: "authorization_grant",
        approvedAt: "2026-04-15T09:00:00.000Z"
      })
    );
    expect(appendGateAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "gate_evt_gate_decision_run-recorder-grant_req-1",
        approvalId: "gate_appr_gate_decision_run-recorder-grant_req-1",
        decisionId: "gate_decision_run-recorder-grant_req-1",
        approver: "authorization_grant"
      })
    );
  });

  it("does not persist synthetic approval rows for gate results without real approval", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue(undefined);
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await recorder.recordFailure(
      { ...baseContext, command: "xhs.search" },
      new CliError("ERR_EXECUTION_FAILED", "blocked", {
        details: {
          run_id: "run-recorder-002",
          gate_outcome: {
            decision_id: "gate_decision_run-recorder-002_req-1"
          },
          approval_record: {
            approval_id: null,
            decision_id: "gate_decision_run-recorder-002_req-1",
            approved: false,
            approver: null,
            approved_at: null,
            checks: {
              target_domain_confirmed: false
            }
          },
          audit_record: {
            event_id: "gate_evt_gate_decision_run-recorder-002_req-1",
            decision_id: "gate_decision_run-recorder-002_req-1",
            approval_id: "gate_appr_stale_run-recorder-002",
            run_id: "run-recorder-002",
            session_id: "session-recorder-002",
            profile: "default",
            issue_scope: "issue_209",
            risk_state: "paused",
            next_state: "paused",
            transition_trigger: "gate_evaluation",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            gate_decision: "blocked",
            gate_reasons: ["LIVE_READ_HIGH_RISK_BLOCKED"],
            approver: null,
            approved_at: null,
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      })
    );

    expect(upsertGateApproval).not.toHaveBeenCalled();
    expect(appendGateAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "gate_evt_gate_decision_run-recorder-002_req-1",
        approvalId: null,
        decisionId: "gate_decision_run-recorder-002_req-1"
      })
    );
  });

  it("uses the persisted approval_id when approval upsert rewrites linkage", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue({
      approval_id: "gate_appr_gate_decision_run-recorder-003_req-2",
      decision_id: "gate_decision_run-recorder-003_req-2"
    });
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await recorder.recordSuccess(
      { ...baseContext, command: "xhs.search" },
      {
        run_id: "run-recorder-003",
        gate_outcome: {
          decision_id: "gate_decision_run-recorder-003_req-2"
        },
        approval_record: {
          approval_id: "gate_appr_custom_conflict",
          decision_id: "gate_decision_run-recorder-003_req-2",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        },
        audit_record: {
          event_id: "gate_evt_gate_decision_run-recorder-003_req-2",
          decision_id: "gate_decision_run-recorder-003_req-2",
          approval_id: "gate_appr_custom_conflict",
          run_id: "run-recorder-003",
          session_id: "session-recorder-003",
          profile: "default",
          issue_scope: "issue_209",
          risk_state: "allowed",
          next_state: "allowed",
          transition_trigger: "manual_approval",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          recorded_at: "2026-03-23T10:00:11.000Z"
        }
      }
    );

    expect(appendGateAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "gate_evt_gate_decision_run-recorder-003_req-2",
        approvalId: "gate_appr_gate_decision_run-recorder-003_req-2",
        decisionId: "gate_decision_run-recorder-003_req-2"
      })
    );
  });

  it("rejects reused approval records when decision linkage is missing", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue(undefined);
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await expect(
      recorder.recordSuccess(
        { ...baseContext, command: "xhs.search" },
        {
          run_id: "run-recorder-legacy",
          gate_outcome: {
            decision_id: "gate_decision_run-recorder-legacy_req-1"
          },
          approval_record: {
            approval_id: "gate_appr_legacy_without_decision",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: {
            event_id: "gate_evt_gate_decision_run-recorder-legacy_req-1",
            decision_id: "gate_decision_run-recorder-legacy_req-1",
            approval_id: "gate_appr_legacy_without_decision",
            run_id: "run-recorder-legacy",
            session_id: "session-recorder-legacy",
            profile: "default",
            issue_scope: "issue_209",
            risk_state: "allowed",
            next_state: "allowed",
            transition_trigger: "manual_approval",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    expect(upsertGateApproval).not.toHaveBeenCalled();
    expect(appendGateAuditRecord).not.toHaveBeenCalled();
  });

  it("rewrites audit approval_id to the persisted approval row when approval upsert normalizes conflicts", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue({
      approval_id: "gate_appr_gate_decision_run-recorder-003_req-2",
      decision_id: "gate_decision_run-recorder-003_req-2"
    });
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await recorder.recordSuccess(
      { ...baseContext, command: "xhs.search" },
      {
        run_id: "run-recorder-003",
        gate_outcome: {
          decision_id: "gate_decision_run-recorder-003_req-2"
        },
        approval_record: {
          approval_id: "gate_appr_conflicting_reused_id",
          decision_id: "gate_decision_run-recorder-003_req-2",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        },
        audit_record: {
          event_id: "gate_evt_gate_decision_run-recorder-003_req-2",
          decision_id: "gate_decision_run-recorder-003_req-2",
          approval_id: "gate_appr_conflicting_reused_id",
          run_id: "run-recorder-003",
          session_id: "session-recorder-003",
          profile: "default",
          issue_scope: "issue_209",
          risk_state: "allowed",
          next_state: "allowed",
          transition_trigger: "manual_approval",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:10.000Z",
          recorded_at: "2026-03-23T10:00:11.000Z"
        }
      }
    );

    expect(appendGateAuditRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalId: "gate_appr_gate_decision_run-recorder-003_req-2",
        decisionId: "gate_decision_run-recorder-003_req-2"
      })
    );
  });

  it("rejects allowed live audit artifacts when no persisted approval_id is available", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue(undefined);
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await expect(
      recorder.recordSuccess(
        { ...baseContext, command: "xhs.search" },
        {
          run_id: "run-recorder-004",
          gate_outcome: {
            decision_id: "gate_decision_run-recorder-004_req-1"
          },
          approval_record: {
            approval_id: null,
            decision_id: "gate_decision_run-recorder-004_req-1",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: {
            event_id: "gate_evt_gate_decision_run-recorder-004_req-1",
            decision_id: "gate_decision_run-recorder-004_req-1",
            approval_id: null,
            run_id: "run-recorder-004",
            session_id: "session-recorder-004",
            profile: "default",
            issue_scope: "issue_209",
            risk_state: "allowed",
            next_state: "allowed",
            transition_trigger: "manual_approval",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    expect(appendGateAuditRecord).not.toHaveBeenCalled();
  });

  it("rejects allowed live audit artifacts that only carry audit-side approval linkage", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue(undefined);
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await expect(
      recorder.recordSuccess(
        { ...baseContext, command: "xhs.search" },
        {
          run_id: "run-recorder-005",
          gate_outcome: {
            decision_id: "gate_decision_run-recorder-005_req-1"
          },
          approval_record: {
            approval_id: null,
            decision_id: "gate_decision_run-recorder-005_req-1",
            approved: false,
            approver: null,
            approved_at: null,
            checks: {
              target_domain_confirmed: false,
              target_tab_confirmed: false,
              target_page_confirmed: false,
              risk_state_checked: false,
              action_type_confirmed: false
            }
          },
          audit_record: {
            event_id: "gate_evt_gate_decision_run-recorder-005_req-1",
            decision_id: "gate_decision_run-recorder-005_req-1",
            approval_id: "gate_appr_stale_run-recorder-005",
            run_id: "run-recorder-005",
            session_id: "session-recorder-005",
            profile: "default",
            issue_scope: "issue_209",
            risk_state: "allowed",
            next_state: "allowed",
            transition_trigger: "manual_approval",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    expect(upsertGateApproval).not.toHaveBeenCalled();
    expect(appendGateAuditRecord).not.toHaveBeenCalled();
  });

  it("rejects allowed live audit artifacts when approval checks are incomplete", async () => {
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockResolvedValue(undefined);
    const upsertGateApproval = vi.fn().mockResolvedValue(undefined);
    const appendGateAuditRecord = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, {
      upsertRun,
      appendRunEvent,
      upsertGateApproval,
      appendGateAuditRecord,
      close
    });

    await expect(
      recorder.recordSuccess(
        { ...baseContext, command: "xhs.search" },
        {
          run_id: "run-recorder-006",
          gate_outcome: {
            decision_id: "gate_decision_run-recorder-006_req-1"
          },
          approval_record: {
            approval_id: "gate_appr_incomplete_checks_run-recorder-006",
            decision_id: "gate_decision_run-recorder-006_req-1",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true
            }
          },
          audit_record: {
            event_id: "gate_evt_gate_decision_run-recorder-006_req-1",
            decision_id: "gate_decision_run-recorder-006_req-1",
            approval_id: "gate_appr_incomplete_checks_run-recorder-006",
            run_id: "run-recorder-006",
            session_id: "session-recorder-006",
            profile: "default",
            issue_scope: "issue_209",
            risk_state: "allowed",
            next_state: "allowed",
            transition_trigger: "manual_approval",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    expect(upsertGateApproval).not.toHaveBeenCalled();
    expect(appendGateAuditRecord).not.toHaveBeenCalled();
  });

  it("records an allowed session rhythm decision for admitted live runs after a deferred probe", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-recorder-rhythm-"));
    const profile = "xhs_recorder_rhythm_profile";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(profile, "2026-04-25T10:00:00.000Z", {
        allowUnsupportedExtensionBrowser: true
      });
      await profileStore.writeMeta(profile, {
        ...meta,
        accountSafety: {
          state: "clear",
          platform: null,
          reason: null,
          observedAt: null,
          cooldownUntil: null,
          sourceRunId: null,
          sourceCommand: null,
          targetDomain: null,
          targetTabId: null,
          pageUrl: null,
          statusCode: null,
          platformCode: null
        },
        xhsCloseoutRhythm: {
          state: "single_probe_passed",
          cooldownUntil: null,
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: false,
          singleProbePassedAt: "2026-04-25T10:40:00.000Z",
          probeRunId: "run-recorder-rhythm-probe",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
        }
      });
      const upsertRun = vi.fn().mockResolvedValue(undefined);
      const appendRunEvent = vi.fn().mockResolvedValue(undefined);
      const upsertGateApproval = vi.fn().mockResolvedValue({
        approval_id: "gate_appr_recorder_rhythm_live"
      });
      const appendGateAuditRecord = vi.fn().mockResolvedValue({
        event_id: "gate_evt_recorder_rhythm_live"
      });
      const recordSessionRhythmStatusView = vi.fn().mockResolvedValue(undefined);
      const close = vi.fn();
      const recorder = new RuntimeStoreRecorder(cwd, {
        upsertRun,
        appendRunEvent,
        upsertGateApproval,
        appendGateAuditRecord,
        recordSessionRhythmStatusView,
        close
      });

      await recorder.recordSuccess(
        {
          ...baseContext,
          cwd,
          profile,
          command: "xhs.search",
          run_id: "run-recorder-rhythm-live"
        },
        {
          run_id: "run-recorder-rhythm-live",
          gate_outcome: {
            decision_id: "gate_decision_recorder_rhythm_live"
          },
          approval_record: {
            approval_id: "gate_appr_recorder_rhythm_live",
            decision_id: "gate_decision_recorder_rhythm_live",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: {
            event_id: "gate_evt_recorder_rhythm_live",
            decision_id: "gate_decision_recorder_rhythm_live",
            approval_id: "gate_appr_recorder_rhythm_live",
            run_id: "run-recorder-rhythm-live",
            session_id: "session-recorder-rhythm-live",
            profile,
            issue_scope: "issue_209",
            risk_state: "allowed",
            next_state: "allowed",
            transition_trigger: "manual_approval",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 9,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"],
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:10.000Z",
            recorded_at: "2026-03-23T10:00:11.000Z"
          }
        }
      );

      expect(recordSessionRhythmStatusView).toHaveBeenCalledWith(
        expect.objectContaining({
          windowState: expect.objectContaining({
            session_id: "session-recorder-rhythm-live",
            last_event_id: "rhythm_evt_run-recorder-rhythm-live",
            source_run_id: "run-recorder-rhythm-live"
          }),
          event: expect.objectContaining({
            event_id: "rhythm_evt_run-recorder-rhythm-live",
            session_id: "session-recorder-rhythm-live",
            source_audit_event_id: "gate_evt_recorder_rhythm_live",
            reason: "XHS_CLOSEOUT_LIVE_ADMISSION_ALLOWED"
          }),
          decision: expect.objectContaining({
            decision_id: "rhythm_decision_run-recorder-rhythm-live",
            run_id: "run-recorder-rhythm-live",
            session_id: "session-recorder-rhythm-live",
            decision: "allowed",
            reason_codes: ["XHS_CLOSEOUT_LIVE_ADMISSION_ALLOWED"],
            requires: []
          })
        })
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
