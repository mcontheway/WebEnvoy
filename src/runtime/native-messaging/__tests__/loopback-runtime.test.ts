import { describe, expect, it } from "vitest";

import { NativeMessagingBridge } from "../bridge.js";
import { createInMemoryLoopbackTransport } from "../loopback-runtime.js";

const createApprovedReadAdmissionContext = (input: {
  runId: string;
  requestId: string;
  targetTabId: number;
  requestedExecutionMode: "live_read_limited" | "live_read_high_risk";
  riskState: "limited" | "allowed";
}) => ({
  approval_admission_evidence: {
    approval_admission_ref: `gate_appr_gate_decision_${input.runId}_${input.requestId}`,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode,
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `gate_evt_${input.runId}`,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode,
    risk_state: input.riskState,
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:30Z"
  }
});

describe("native messaging legacy loopback runtime", () => {
  it("keeps xhs.search observability page_state aligned with the shared contract", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-legacy-observability-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      }
    });

    expect(result.payload).toMatchObject({
      observability: {
        page_state: {
          observation_status: "complete"
        }
      }
    });
  });

  it("blocks stale approval linkage in live loopback bundles", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-custom-approval-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approval_id: "gate_appr_custom_run-loopback-custom-approval-001",
            decision_id: "gate_decision_custom_run-loopback-custom-approval-001",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-custom-approval-001_run-\d{4}$/
          ),
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"])
        }),
        approval_record: expect.objectContaining({
          approval_id: null,
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-custom-approval-001_run-\d{4}$/
          )
        }),
        audit_record: expect.objectContaining({
          approval_id: null,
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-custom-approval-001_run-\d{4}$/
          )
        })
      })
    );
  });

  it("keeps approval_id null in blocked loopback gate bundles without approval", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-no-approval-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 33,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "paused"
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toMatchObject({
      approval_record: {
        approval_id: null
      },
      audit_record: {
        approval_id: null
      }
    });
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-no-approval-001_run-\d{4}$/
          )
        }),
        approval_record: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-no-approval-001_run-\d{4}$/
          )
        }),
        audit_record: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-no-approval-001_run-\d{4}$/
          )
        })
      })
    );
  });

  it("keeps live_read_limited approved when caller provides matching audit linkage", async () => {
    const runId = "run-loopback-live-limited-001";
    const requestId = "issue209-live-limited-001";
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 33,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
            }
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            targetTabId: 33,
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          }),
          audit_record: {
            event_id: "audit-live-read-limited-loopback-001",
            decision_id: "gate_decision_run-loopback-live-limited-001_issue209-live-limited-001",
            approval_id:
              "gate_appr_gate_decision_run-loopback-live-limited-001_issue209-live-limited-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 33,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          approval_record: expect.objectContaining({
            approval_id: expect.stringMatching(
              /^gate_appr_gate_decision_run-loopback-live-limited-001_issue209-live-limited-001$/
            ),
            decision_id: expect.stringMatching(
              /^gate_decision_run-loopback-live-limited-001_issue209-live-limited-001$/
            )
          }),
          audit_record: expect.objectContaining({
            decision_id: expect.stringMatching(
              /^gate_decision_run-loopback-live-limited-001_issue209-live-limited-001$/
            ),
            gate_decision: "allowed",
            requested_execution_mode: "live_read_limited",
            effective_execution_mode: "live_read_limited"
          }),
          gate_outcome: expect.objectContaining({
            decision_id: expect.stringMatching(
              /^gate_decision_run-loopback-live-limited-001_issue209-live-limited-001$/
            ),
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          })
        })
      })
    );
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          consumer_gate_result: expect.objectContaining({
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          })
        })
      })
    );
  });

  it("blocks stale caller audit linkage in loopback bundles", async () => {
    const runId = "run-loopback-live-limited-stale-001";
    const requestId = "issue209-live-limited-current-001";
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 34,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
            }
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            targetTabId: 34,
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          }),
          audit_record: {
            event_id: "gate_evt_gate_decision_issue209-live-limited-previous-001",
            decision_id: "gate_decision_issue209-live-limited-previous-001",
            approval_id: "gate_appr_gate_decision_issue209-live-limited-previous-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 34,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-live-limited-stale-001_issue209-live-limited-current-001$/
          ),
          effective_execution_mode: "recon",
          gate_decision: "blocked",
          gate_reasons: ["AUDIT_RECORD_MISSING"]
        }),
        audit_record: expect.objectContaining({
          decision_id: expect.stringMatching(
            /^gate_decision_run-loopback-live-limited-stale-001_issue209-live-limited-current-001$/
          ),
          gate_decision: "blocked",
          issue_scope: "issue_209"
        }),
        approval_record: expect.objectContaining({
          approval_id: null
        })
      })
    );
  });
});
