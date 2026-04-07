import { describe, expect, it, vi } from "vitest";

import { CliError } from "../../../core/errors.js";
import type { RuntimeContext } from "../../../core/types.js";
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
  });

  it("does not swallow runtime store write errors", async () => {
    const writeError = new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "db write failed");
    const upsertRun = vi.fn().mockResolvedValue(undefined);
    const appendRunEvent = vi.fn().mockRejectedValue(writeError);
    const close = vi.fn();
    const recorder = new RuntimeStoreRecorder(baseContext.cwd, { upsertRun, appendRunEvent, close });

    await expect(recorder.recordSuccess(baseContext, {})).rejects.toBe(writeError);
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
});
