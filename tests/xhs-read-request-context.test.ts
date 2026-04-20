import { describe, expect, it, vi } from "vitest";

import { executeXhsDetail } from "../extension/xhs-detail.js";
import { executeXhsUserHome } from "../extension/xhs-user-home.js";
import type {
  CapturedRequestContextArtifact,
  XhsSearchEnvironment,
  XhsSearchOptions
} from "../extension/xhs-search-types.js";

const createApprovalRecord = () => ({
  approved: true,
  approver: "qa-reviewer",
  approved_at: "2026-04-19T10:00:00Z",
  checks: {
    target_domain_confirmed: true,
    target_tab_confirmed: true,
    target_page_confirmed: true,
    risk_state_checked: true,
    action_type_confirmed: true
  }
});

const createAuditRecord = (targetPage: string) => ({
  event_id: `audit-${targetPage}-001`,
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: targetPage,
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  gate_decision: "allowed",
  recorded_at: "2026-04-19T10:00:30Z"
});

const createAdmissionContext = (runId: string, targetPage: string) => ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${runId}`,
    run_id: runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: targetPage,
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-04-19T10:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-04-19T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${runId}`,
    run_id: runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: targetPage,
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
    recorded_at: "2026-04-19T10:00:30Z"
  }
});

const createLiveReadOptions = (
  runId: string,
  targetPage: string,
  overrides?: Partial<XhsSearchOptions>
): XhsSearchOptions => ({
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: targetPage,
  actual_target_domain: "www.xiaohongshu.com",
  actual_target_tab_id: 32,
  actual_target_page: targetPage,
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  approval_record: createApprovalRecord(),
  audit_record: createAuditRecord(targetPage),
  admission_context: createAdmissionContext(runId, targetPage),
  ...(overrides ?? {})
});

const createExecutionContext = (runId: string) => ({
  runId,
  sessionId: "nm-session-001",
  gateInvocationId: `issue209-gate-${runId}`,
  profile: "xhs_001"
});

const createDetailArtifact = (
  overrides?: Partial<CapturedRequestContextArtifact> & Record<string, unknown>
): CapturedRequestContextArtifact =>
  ({
    source_kind: "page_request",
    transport: "fetch",
    method: "POST",
    path: "/api/sns/web/v1/feed",
    url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
    status: 200,
    captured_at: 1_710_000_000_000,
    page_context_namespace: "xhs.detail",
    shape_key: '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
    shape: {
      command: "xhs.detail",
      method: "POST",
      pathname: "/api/sns/web/v1/feed",
      note_id: "note-001"
    },
    request: {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-S-Common": "{\"detailId\":\"captured-detail-id\"}",
        "x-b3-traceid": "trace-b3-detail",
        "x-xray-traceid": "trace-xray-detail"
      },
      body: {
        source_note_id: "note-001",
        image_scenes: ["WB_PRV", "CRD_PRV_WEBP"]
      }
    },
    response: {
      headers: {},
      body: {
        code: 0,
        data: {
          note: {
            note_id: "note-001"
          }
        }
      }
    },
    referrer: "https://www.xiaohongshu.com/explore/note-001",
    ...(overrides ?? {})
  }) as unknown as CapturedRequestContextArtifact;

const createUserHomeArtifact = (
  overrides?: Partial<CapturedRequestContextArtifact> & Record<string, unknown>
): CapturedRequestContextArtifact =>
  ({
    source_kind: "page_request",
    transport: "fetch",
    method: "GET",
    path: "/api/sns/web/v1/user/otherinfo",
    url: "https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?user_id=user-001",
    status: 200,
    captured_at: 1_710_000_000_000,
    request: {
      headers: {
        Accept: "application/json, text/plain, */*",
        "X-S-Common": "{\"userId\":\"captured-user-id\"}",
        "x-b3-traceid": "trace-b3-user",
        "x-xray-traceid": "trace-xray-user"
      },
      body: null
    },
    response: {
      headers: {},
      body: {
        code: 0,
        data: {
          user: {
            user_id: "user-001",
            nickname: "captured-user"
          }
        }
      }
    },
    referrer: "https://www.xiaohongshu.com/user/profile/user-001",
    ...(overrides ?? {})
  }) as unknown as CapturedRequestContextArtifact;

const createEnvironment = (overrides?: Partial<XhsSearchEnvironment>): XhsSearchEnvironment => ({
  now: () => 1_710_000_100_000,
  randomId: () => "generated-id-001",
  getLocationHref: () => "https://www.xiaohongshu.com/",
  getDocumentTitle: () => "XHS",
  getReadyState: () => "complete",
  getCookie: () => "a1=cookie-token",
  getPageStateRoot: () => null,
  readPageStateRoot: async () => null,
  callSignature: async () => ({ "X-s": "sig", "X-t": "1710000000" }),
  fetchJson: async () => ({ status: 200, body: { code: 0, data: {} } }),
  readCapturedRequestContext: async () => null,
  ...overrides
});

describe("xhs read request-context exact-shape reuse", () => {
  it("reuses detail request context on exact note_id hit while keeping image_scenes out of identity", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          note: {
            note_id: "note-001"
          }
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-hit-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-hit-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => createDetailArtifact()
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/feed", {
      source_note_id: "note-001"
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed",
        method: "POST",
        pageContextRequest: true,
        referrer: "https://www.xiaohongshu.com/explore/note-001",
        headers: expect.objectContaining({
          "X-S-Common": "{\"detailId\":\"captured-detail-id\"}",
          "x-b3-traceid": "trace-b3-detail",
          "x-xray-traceid": "trace-xray-detail"
        }),
        body: JSON.stringify({
          source_note_id: "note-001"
        })
      })
    );
  });

  it("fails closed for detail when captured note_id shape mismatches", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-mismatch-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-mismatch-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape_key:
              '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-999"}',
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-999"
            },
            referrer: "https://www.xiaohongshu.com/explore/note-999",
            request: {
              headers: createDetailArtifact().request.headers,
              body: {
                source_note_id: "note-999"
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed for admitted detail artifacts when the response lacks a canonical note_id", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-response-note-missing-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-response-note-missing-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: undefined,
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  items: [
                    {
                      note_card: {
                        title: "missing-id"
                      }
                    }
                  ]
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("accepts a later detail response candidate when it is the first one matching the requested note_id", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          note: {
            note_id: "note-001"
          }
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-response-late-match-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-response-late-match-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: undefined,
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  items: [
                    {
                      note_card: {
                        note_id: "note-999"
                      }
                    },
                    {
                      note_card: {
                        note_id: "note-001"
                      }
                    }
                  ]
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/feed", {
      source_note_id: "note-001"
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed",
        method: "POST",
        pageContextRequest: true
      })
    );
  });

  it("treats synthetic detail artifacts as rejected_source", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const syntheticArtifact = {
      ...createDetailArtifact(),
      source_kind: "synthetic_request",
      template_ready: true,
      rejection_reason: "synthetic_request_rejected"
    } as unknown as CapturedRequestContextArtifact;

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-rejected-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-rejected-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => syntheticArtifact
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "synthetic_request_rejected"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("treats failed detail artifacts as rejected_source", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const failedArtifact = {
      ...createDetailArtifact(),
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: 200
      },
      response: {
        headers: {},
        body: {
          code: 500100,
          msg: "gateway failed"
        }
      }
    } as unknown as CapturedRequestContextArtifact;

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-failed-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-failed-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => failedArtifact
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "failed_request_rejected"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps shape_mismatch when only sibling rejected detail shapes exist in the route bucket", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-rejected-sibling-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-rejected-sibling-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: null,
          rejected_observation: null,
          incompatible_observation: null,
          available_shape_keys: [
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-999"}'
          ]
        })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "shape_mismatch"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("reuses user_home request context from exact user_id URL match", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          user: {
            user_id: "user-001",
            nickname: "captured-user"
          }
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-context-hit-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-context-hit-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => createUserHomeArtifact()
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/user/otherinfo?user_id=user-001", {});
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/user/otherinfo?user_id=user-001",
        method: "GET",
        pageContextRequest: true,
        referrer: "https://www.xiaohongshu.com/user/profile/user-001",
        headers: expect.objectContaining({
          "X-S-Common": "{\"userId\":\"captured-user-id\"}",
          "x-b3-traceid": "trace-b3-user",
          "x-xray-traceid": "trace-xray-user"
        })
      })
    );
  });

  it("fails closed on stale user_home request context", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-context-stale-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-context-stale-001")
      },
      createEnvironment({
        now: () => 1_710_001_000_000,
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            captured_at: 1_710_000_000_000
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "stale",
      request_context_miss_reason: "template_stale"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
