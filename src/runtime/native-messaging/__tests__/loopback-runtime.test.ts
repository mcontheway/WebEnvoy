import { describe, expect, it } from "vitest";

import { NativeMessagingBridge } from "../bridge.js";
import { createInMemoryLoopbackTransport } from "../loopback-runtime.js";

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
});
