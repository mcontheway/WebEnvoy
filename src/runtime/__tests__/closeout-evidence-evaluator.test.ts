import { describe, expect, it } from "vitest";

import {
  evaluateCloseoutEvidence,
  type EvaluateCloseoutEvidenceInput
} from "../closeout-evidence-evaluator.js";

const baseInput = (): EvaluateCloseoutEvidenceInput => ({
  expected: {
    latest_head_sha: "15a4e0bd5371178933fd23cac0311181db5bfde5",
    run_id: "run-closeout-evidence-001",
    artifact_identity: "artifact/xhs-closeout-evidence/run-closeout-evidence-001",
    profile_ref: "profile/xhs_001",
    target_tab_id: 88,
    page_url: "https://www.xiaohongshu.com/explore?keyword=closeout",
    action_ref: "action/xhs.search/open_result_card"
  },
  evidence: {
    route_role: "primary",
    path_kind: "api",
    evidence_status: "success",
    evidence_class: "passive_api_capture",
    reproduced_multi_round: true,
    head_sha: "15a4e0bd5371178933fd23cac0311181db5bfde5",
    run_id: "run-closeout-evidence-001",
    artifact_identity: "artifact/xhs-closeout-evidence/run-closeout-evidence-001",
    profile_ref: "profile/xhs_001",
    target_tab_id: 88,
    page_url: "https://www.xiaohongshu.com/explore?keyword=closeout",
    action_ref: "action/xhs.search/open_result_card"
  }
});

describe("closeout evidence evaluator", () => {
  it("passes when primary API success evidence is current and fully bound", () => {
    expect(evaluateCloseoutEvidence(baseInput())).toMatchObject({
      decision: "PASS",
      passed: true,
      blockers: [],
      route_role: "primary",
      path_kind: "api",
      evidence_status: "success",
      evidence_class: "passive_api_capture",
      reproduced_multi_round: true,
      freshness: {
        latest_head_available: true,
        latest_head_matches: true,
        run_matches: true,
        artifact_matches: true
      },
      bindings: {
        profile_bound: true,
        tab_bound: true,
        page_bound: true,
        action_bound: true
      }
    });
  });

  it.each([
    {
      name: "non-primary route",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.route_role = "fallback";
      },
      blocker_code: "non_primary_route"
    },
    {
      name: "non-API path",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.path_kind = "page";
      },
      blocker_code: "non_api_path"
    },
    {
      name: "non-success evidence status",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.evidence_status = "candidate";
      },
      blocker_code: "evidence_not_success"
    },
    {
      name: "DOM state evidence",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.evidence_class = "dom_state_extraction";
      },
      blocker_code: "dom_state_not_full_closeout"
    },
    {
      name: "active fetch fallback evidence",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.evidence_class = "active_api_fetch_fallback";
      },
      blocker_code: "active_fetch_not_admitted"
    },
    {
      name: "unsupported evidence class",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.evidence_class = "unexpected_adapter_class";
      },
      blocker_code: "unsupported_evidence_class"
    },
    {
      name: "missing latest head",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.expected.latest_head_sha = null;
      },
      blocker_code: "missing_latest_head"
    },
    {
      name: "stale head",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.head_sha = "deadbeef";
      },
      blocker_code: "stale_head"
    },
    {
      name: "stale run",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.run_id = "run-closeout-evidence-old";
      },
      blocker_code: "stale_run"
    },
    {
      name: "stale artifact",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.artifact_identity = "artifact/xhs-closeout-evidence/run-old";
      },
      blocker_code: "stale_artifact"
    },
    {
      name: "missing profile binding",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.profile_ref = null;
      },
      blocker_code: "missing_profile_binding"
    },
    {
      name: "missing tab binding",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.target_tab_id = null;
      },
      blocker_code: "missing_tab_binding"
    },
    {
      name: "missing page binding",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.page_url = null;
      },
      blocker_code: "missing_page_binding"
    },
    {
      name: "missing action binding",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.action_ref = null;
      },
      blocker_code: "missing_action_binding"
    },
    {
      name: "missing multi-round evidence",
      mutate: (input: EvaluateCloseoutEvidenceInput) => {
        input.evidence.reproduced_multi_round = false;
      },
      blocker_code: "missing_multi_round_evidence"
    }
  ])("fails closed for $name", ({ mutate, blocker_code }) => {
    const input = baseInput();
    mutate(input);

    expect(evaluateCloseoutEvidence(input)).toMatchObject({
      decision: "FAIL",
      passed: false,
      blockers: [expect.objectContaining({ blocker_code })]
    });
  });
});
