import { describe, expect, it } from "vitest";

import type { ContentMessage } from "../loopback-messages.js";
import { createPortPair } from "../loopback-port.js";
import { InMemoryContentScriptRuntime } from "../loopback-content-runtime.js";

const createAdmissionContext = (input: {
  runId: string;
  requestId: string;
  sessionId: string;
  decisionId: string;
  approvalId: string;
  targetTabId: number;
}) => ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${input.runId}_${input.requestId}`,
    decision_id: input.decisionId,
    approval_id: input.approvalId,
    request_id: input.requestId,
    run_id: input.runId,
    session_id: input.sessionId,
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
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
    audit_admission_ref: `audit_admission_${input.runId}_${input.requestId}`,
    decision_id: input.decisionId,
    approval_id: input.approvalId,
    request_id: input.requestId,
    run_id: input.runId,
    session_id: input.sessionId,
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
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
});

const createUpstreamAuthorizationRequest = (input: {
  runId: string;
  requestId: string;
  targetTabId: number;
}) => ({
  action_request: {
    request_ref: `upstream_req_${input.requestId}`,
    action_name: "xhs.read_search_results",
    action_category: "read",
    requested_at: "2026-03-23T10:00:00.000Z"
  },
  resource_binding: {
    binding_ref: `binding_${input.requestId}`,
    resource_kind: "profile_session",
    profile_ref: "loopback_profile"
  },
  authorization_grant: {
    grant_ref: `grant_${input.requestId}`,
    allowed_actions: ["xhs.read_search_results"],
    binding_scope: {
      allowed_resource_kinds: ["profile_session"],
      allowed_profile_refs: ["loopback_profile"]
    },
    target_scope: {
      allowed_domains: ["www.xiaohongshu.com"],
      allowed_pages: ["search_result_tab"]
    },
    approval_refs: [`approval_admission_${input.runId}_${input.requestId}`],
    audit_refs: [`audit_admission_${input.runId}_${input.requestId}`],
    resource_state_snapshot: "active",
    granted_at: "2026-03-23T10:00:00.000Z"
  },
  runtime_target: {
    target_ref: `target_${input.requestId}`,
    domain: "www.xiaohongshu.com",
    page: "search_result_tab",
    tab_id: input.targetTabId,
    url: "https://www.xiaohongshu.com/search_result?keyword=camping"
  }
});

describe("native messaging loopback content runtime", () => {
  it("acks runtime.bootstrap after the attestation delay", async () => {
    const [left, right] = createPortPair<ContentMessage>();

    new InMemoryContentScriptRuntime(right);

    const first = new Promise<Record<string, unknown>>((resolve) => {
      const off = left.onMessage((message) => {
        if (message.kind === "result") {
          off();
          resolve(message as Record<string, unknown>);
        }
      });
    });

    left.postMessage({
      kind: "forward",
      id: "bootstrap-001",
      command: "runtime.bootstrap",
      runId: "run-001",
      sessionId: "session-001",
      commandParams: {
        version: "v1",
        run_id: "run-001",
        runtime_context_id: "runtime-001",
        profile: "profile-a",
        fingerprint_runtime: {},
        fingerprint_patch_manifest: {},
        main_world_secret: "secret-001"
      }
    });

    const bootstrap = await first;
    expect(bootstrap).toMatchObject({
      ok: false,
      error: {
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
      }
    });
  });

  it("rejects xhs.detail with missing note_id instead of emitting an empty data_ref", async () => {
    const [left, right] = createPortPair<ContentMessage>();

    new InMemoryContentScriptRuntime(right);

    const resultPromise = new Promise<Record<string, unknown>>((resolve) => {
      const off = left.onMessage((message) => {
        if (message.kind === "result") {
          off();
          resolve(message as Record<string, unknown>);
        }
      });
    });

    left.postMessage({
      kind: "forward",
      id: "xhs-detail-missing-note-001",
      command: "xhs.detail",
      runId: "run-001",
      sessionId: "session-001",
      commandParams: {
        ability: {
          id: "xhs.note.detail.v1",
          layer: "L3",
          action: "read"
        },
        input: {},
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 11,
          target_page: "explore_detail_tab",
          action_type: "read",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      }
    });

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_CLI_INVALID_ARGS"
      },
      payload: {
        details: {
          reason: "NOTE_ID_MISSING"
        }
      }
    });
  });

  it("emits classifier-only account abnormal evidence on the content-script xhs read path", async () => {
    const [left, right] = createPortPair<ContentMessage>();

    new InMemoryContentScriptRuntime(right);

    const resultPromise = new Promise<Record<string, unknown>>((resolve) => {
      const off = left.onMessage((message) => {
        if (message.kind === "result") {
          off();
          resolve(message as Record<string, unknown>);
        }
      });
    });

    const runId = "run-classifier-only-account-abnormal-001";
    const requestId = "request-classifier-only-account-abnormal-001";
    const sessionId = "session-classifier-only-account-abnormal-001";
    const targetTabId = 32;
    const decisionId = "decision-classifier-only-account-abnormal-001";
    const approvalId = "approval-classifier-only-account-abnormal-001";
    const admissionContext = createAdmissionContext({
      runId,
      requestId,
      sessionId,
      decisionId,
      approvalId,
      targetTabId
    });

    left.postMessage({
      kind: "forward",
      id: "xhs-search-classifier-only-account-abnormal-001",
      command: "xhs.search",
      runId,
      sessionId,
      commandParams: {
        request_id: requestId,
        gate_invocation_id: "gate-classifier-only-account-abnormal-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营"
        },
        options: {
          simulate_result: "classifier_only_account_abnormal",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: targetTabId,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          __runtime_profile_ref: "loopback_profile",
          upstream_authorization_request: createUpstreamAuthorizationRequest({
            runId,
            requestId,
            targetTabId
          }),
          admission_context: admissionContext,
          approval_record: {
            approval_id: approvalId,
            decision_id: decisionId,
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
          audit_record: {
            event_id: "audit-classifier-only-account-abnormal-001",
            decision_id: decisionId,
            approval_id: approvalId,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: targetTabId,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    const result = await resultPromise;
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED"
      },
      payload: {
        details: {
          reason: "TARGET_API_RESPONSE_INVALID"
        },
        observability: {
          key_requests: [
            expect.objectContaining({
              status_code: 400,
              failure_reason: "request_context_missing"
            })
          ],
          failure_site: expect.objectContaining({
            summary: "Account abnormal. Switch account and retry."
          })
        },
        diagnosis: {
          failure_site: expect.objectContaining({
            summary: "Account abnormal. Switch account and retry."
          }),
          evidence: ["unclassified upstream failure"]
        }
      }
    });
  });
});
