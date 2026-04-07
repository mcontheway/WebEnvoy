import { describe, expect, it } from "vitest";

import { buildLoopbackGateObservability } from "../loopback-gate-observability.js";
import { createLoopbackObservabilityFixture } from "./loopback-gate-test-fixtures.js";

describe("native messaging loopback gate observability", () => {
  it("emits page state and failure site for a blocked creator publish gate", () => {
    const observability = buildLoopbackGateObservability(
      createLoopbackObservabilityFixture({
        gateInput: {
          issue_scope: "issue_208",
          risk_state: "paused",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write"
        },
        consumerGateResult: {
          gate_decision: "blocked",
          gate_reasons: ["TARGET_DOMAIN_OUT_OF_SCOPE"],
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 9,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run"
        }
      })
    );

    expect(observability).toMatchObject({
      page_state: {
        page_kind: "compose",
        url: "https://creator.xiaohongshu.com/publish/publish",
        title: "Creator Publish",
        ready_state: "complete",
        observation_status: "complete"
      },
      key_requests: [],
      failure_site: {
        stage: "execution",
        component: "gate",
        target: "creator_publish_tab",
        summary: "TARGET_DOMAIN_OUT_OF_SCOPE"
      }
    });
  });
});
