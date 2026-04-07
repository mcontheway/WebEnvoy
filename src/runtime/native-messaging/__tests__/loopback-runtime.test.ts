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
});
