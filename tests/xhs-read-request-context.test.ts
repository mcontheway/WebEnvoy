import { describe, expect, it, vi } from "vitest";

import { executeXhsDetail } from "../extension/xhs-detail.js";
import { executeXhsUserHome } from "../extension/xhs-user-home.js";
import { createPageContextNamespace } from "../extension/xhs-search-types.js";
import type {
  CapturedRequestContextArtifact,
  XhsSearchEnvironment,
  XhsSearchOptions
} from "../extension/xhs-search-types.js";

const REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS = 10;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 150;

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
    referrer:
      "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-note-001&xsec_source=pc_search",
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
    page_context_namespace: "xhs.user_home",
    shape_key:
      '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
    shape: {
      command: "xhs.user_home",
      method: "GET",
      pathname: "/api/sns/web/v1/user/otherinfo",
      user_id: "user-001"
    },
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
    referrer:
      "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=token-user-001&xsec_source=pc_search",
    ...(overrides ?? {})
  }) as unknown as CapturedRequestContextArtifact;

const createEnvironment = (overrides?: Partial<XhsSearchEnvironment>): XhsSearchEnvironment => ({
  now: () => 1_710_000_100_000,
  randomId: () => "generated-id-001",
  sleep: async () => {},
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
      source_note_id: "note-001",
      image_scenes: ["WB_PRV", "CRD_PRV_WEBP"]
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed",
        method: "POST",
        pageContextRequest: true,
        referrer:
          "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-note-001&xsec_source=pc_search",
        headers: expect.objectContaining({
          "X-S-Common": "{\"detailId\":\"captured-detail-id\"}",
          "x-b3-traceid": "generatedid001",
          "x-xray-traceid": "generatedid001"
        }),
        body: JSON.stringify({
          source_note_id: "note-001",
          image_scenes: ["WB_PRV", "CRD_PRV_WEBP"]
        })
      })
    );
  });

  it("prefers captured X-S-Common over caller-supplied options on exact detail hits", async () => {
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
        options: createLiveReadOptions("run-detail-context-xs-common-001", "explore_detail_tab", {
          x_s_common: '{"detailId":"caller-detail-id"}'
        }),
        executionContext: createExecutionContext("run-detail-context-xs-common-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => createDetailArtifact()
      })
    );

    expect(result.ok).toBe(true);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-S-Common": '{"detailId":"captured-detail-id"}'
        })
      })
    );
  });

  it("fails closed for detail exact hits when signed continuity lacks xsec_token", async () => {
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
        options: createLiveReadOptions("run-detail-continuity-missing-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-continuity-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            referrer: "https://www.xiaohongshu.com/explore/note-001?xsec_source=pc_search"
          })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected signed continuity failure");
    }
    expect(result.payload.details).toMatchObject({
      reason: "XSEC_TOKEN_MISSING",
      request_context_result: "signed_continuity_invalid",
      signed_continuity: {
        detail_url: "https://www.xiaohongshu.com/explore/note-001?xsec_source=pc_search",
        token_presence: "missing",
        xsec_token: null,
        xsec_source: "pc_search"
      }
    });
    expect(result.payload.diagnosis).toMatchObject({
      category: "page_changed"
    });
    expect(result.payload.observability).toMatchObject({
      failure_site: {
        target: "xhs.signed_continuity"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed for user_home exact hits when xsec_token is empty", async () => {
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
        options: createLiveReadOptions("run-user-continuity-empty-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-continuity-empty-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            referrer:
              "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=&xsec_source=pc_search"
          })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected signed continuity failure");
    }
    expect(result.payload.details).toMatchObject({
      reason: "XSEC_TOKEN_EMPTY",
      signed_continuity: {
        user_home_url:
          "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=&xsec_source=pc_search",
        token_presence: "empty",
        xsec_token: ""
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed for detail exact hits when xsec_source does not match allowed continuity sources", async () => {
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
        options: createLiveReadOptions("run-detail-continuity-source-mismatch-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-continuity-source-mismatch-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            referrer:
              "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-note-001&xsec_source=unexpected"
          })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected signed continuity failure");
    }
    expect(result.payload.details).toMatchObject({
      reason: "XSEC_SOURCE_MISMATCH",
      signed_continuity: {
        xsec_token: "token-note-001",
        xsec_source: "unexpected"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed for detail exact hits when xsec_source is known but not search-context compatible", async () => {
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
        options: createLiveReadOptions("run-detail-continuity-known-source-mismatch-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-continuity-known-source-mismatch-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            referrer:
              "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-note-001&xsec_source=pc_note"
          })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected signed continuity failure");
    }
    expect(result.payload.details).toMatchObject({
      reason: "XSEC_SOURCE_MISMATCH",
      signed_continuity: {
        source_route: "xhs.detail",
        xsec_token: "token-note-001",
        xsec_source: "pc_note"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("waits for captured detail context before failing closed on a fresh navigation", async () => {
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
    let readyState = "interactive";
    let lookupCount = 0;
    const sleep = vi.fn(async () => {
      readyState = "complete";
    });
    const readCapturedRequestContext = vi.fn(async () => {
      lookupCount += 1;
      return lookupCount === 1 ? null : createDetailArtifact();
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-wait-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-wait-001")
      },
      createEnvironment({
        sleep,
        getReadyState: () => readyState,
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(true);
    expect(readCapturedRequestContext).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("keeps polling detail context after readyState becomes complete until the captured template arrives", async () => {
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
    let readyState = "interactive";
    let lookupCount = 0;
    const sleep = vi.fn(async () => {
      readyState = "complete";
    });
    const readCapturedRequestContext = vi.fn(async () => {
      lookupCount += 1;
      return lookupCount < 3 ? null : createDetailArtifact();
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-complete-retry-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-complete-retry-001")
      },
      createEnvironment({
        sleep,
        getReadyState: () => readyState,
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(true);
    expect(readCapturedRequestContext).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("pins later detail retries to the returned page_context_namespace", async () => {
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
    const readCapturedRequestContext = vi
      .fn()
      .mockImplementationOnce(async () => ({
        page_context_namespace: "visited-detail-namespace-001",
        shape_key:
          '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
        admitted_template: null,
        rejected_observation: null,
        incompatible_observation: null,
        available_shape_keys: []
      }))
      .mockImplementationOnce(async () => createDetailArtifact());

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-namespace-retry-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-namespace-retry-001")
      },
      createEnvironment({
        sleep: vi.fn(async () => {}),
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(true);
    expect(readCapturedRequestContext).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        page_context_namespace: createPageContextNamespace("https://www.xiaohongshu.com/explore/note-001")
      })
    );
    expect(readCapturedRequestContext).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        page_context_namespace: "visited-detail-namespace-001"
      })
    );
  });

  it("keeps polling detail context until the last shared wait attempt before failing closed", async () => {
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
    let lookupCount = 0;
    const sleep = vi.fn(async () => {});
    const readCapturedRequestContext = vi.fn(async () => {
      lookupCount += 1;
      return lookupCount < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS ? null : createDetailArtifact();
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-last-attempt-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-last-attempt-001")
      },
      createEnvironment({
        sleep,
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(true);
    expect(readCapturedRequestContext).toHaveBeenCalledTimes(REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS - 1);
  });

  it("waits between request-context retries even when env.sleep is unavailable", async () => {
    vi.useFakeTimers();
    try {
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
      let lookupCount = 0;
      const readCapturedRequestContext = vi.fn(async () => {
        lookupCount += 1;
        return lookupCount < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS ? null : createDetailArtifact();
      });

      const resultPromise = executeXhsDetail(
        {
          abilityId: "xhs.note.detail.v1",
          abilityLayer: "L3",
          abilityAction: "read",
          params: {
            note_id: "note-001"
          },
          options: createLiveReadOptions("run-detail-context-default-wait-001", "explore_detail_tab"),
          executionContext: createExecutionContext("run-detail-context-default-wait-001")
        },
        createEnvironment({
          getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
          callSignature,
          fetchJson,
          readCapturedRequestContext
        })
      );

      await vi.advanceTimersByTimeAsync(
        REQUEST_CONTEXT_WAIT_RETRY_MS * (REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS - 1)
      );
      const result = await resultPromise;

      expect(result.ok).toBe(true);
      expect(readCapturedRequestContext).toHaveBeenCalledTimes(REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS);
      expect(callSignature).toHaveBeenCalled();
      expect(fetchJson).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed with machine-readable read failure when detail request-context lookup keeps throwing", async () => {
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
    const sleep = vi.fn(async () => {});
    const readCapturedRequestContext = vi.fn(async () => {
      throw new Error("bridge unavailable");
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-read-error-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-read-error-001")
      },
      createEnvironment({
        sleep,
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(false);
    expect(readCapturedRequestContext).toHaveBeenCalledTimes(REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS - 1);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_READ_FAILED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "error",
      request_context_miss_reason: "request_context_read_failed"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
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
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    note_id: "note-999"
                  }
                }
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

  it("fails closed for raw detail artifacts when the response lacks a canonical note_id", async () => {
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
        options: createLiveReadOptions("run-detail-raw-response-note-missing-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-raw-response-note-missing-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-001"
            },
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

  it("fails closed for raw detail artifacts when the response only exposes a bare id", async () => {
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
        options: createLiveReadOptions("run-detail-raw-response-bare-id-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-raw-response-bare-id-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  id: "note-001",
                  title: "bare id only"
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

  it("does not admit raw detail artifacts from request.body.source_note_id without canonical response note_id", async () => {
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
        options: createLiveReadOptions("run-detail-raw-source-note-id-missing-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-raw-source-note-id-missing-001")
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
                        title: "missing canonical note id"
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

  it("treats admitted detail artifacts with conflicting canonical note_id as incompatible", async () => {
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
        options: createLiveReadOptions("run-detail-response-note-conflict-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-response-note-conflict-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    note_id: "note-999"
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch",
      captured_request_shape: {
        note_id: "note-999"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed for exact-shape admitted detail artifacts when the response only exposes a conflicting bare id", async () => {
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
        options: createLiveReadOptions("run-detail-response-bare-id-conflict-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-response-bare-id-conflict-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: createDetailArtifact({
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    id: "note-999"
                  }
                }
              }
            }
          }),
          rejected_observation: null,
          incompatible_observation: null
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

  it("treats raw detail artifacts with conflicting canonical note_id as incompatible", async () => {
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
        options: createLiveReadOptions("run-detail-raw-note-conflict-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-raw-note-conflict-001")
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
                  note: {
                    note_id: "note-999"
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch",
      captured_request_shape: {
        note_id: "note-999"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("treats rejected exact-hit detail artifacts with conflicting canonical note_id as incompatible", async () => {
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
        options: createLiveReadOptions("run-detail-rejected-note-conflict-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-rejected-note-conflict-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-001"
            },
            template_ready: false,
            rejection_reason: "failed_request_rejected",
            request_status: {
              completion: "failed",
              http_status: 200
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    note_id: "note-999"
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch",
      captured_request_shape: {
        note_id: "note-999"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("treats rejected exact-shape detail observations with conflicting canonical note_id as incompatible", async () => {
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
        options: createLiveReadOptions("run-detail-rejected-exact-shape-note-conflict-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-rejected-exact-shape-note-conflict-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: null,
          rejected_observation: createDetailArtifact({
            shape: {
              command: "xhs.detail",
              method: "POST",
              pathname: "/api/sns/web/v1/feed",
              note_id: "note-001"
            },
            template_ready: false,
            rejection_reason: "failed_request_rejected",
            request_status: {
              completion: "failed",
              http_status: 200
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    note_id: "note-999"
                  }
                }
              }
            }
          }),
          incompatible_observation: null
        })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_incompatible",
      request_context_lookup_state: "incompatible",
      request_context_miss_reason: "shape_mismatch",
      captured_request_shape: {
        note_id: "note-999"
      }
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
      source_note_id: "note-001",
      image_scenes: ["WB_PRV", "CRD_PRV_WEBP"]
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed",
        method: "POST",
        pageContextRequest: true
      })
    );
  });

  it("fails closed for exact-shape admitted detail templates when the captured response only exposes a bare id", async () => {
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
        options: createLiveReadOptions("run-detail-context-bare-id-hit-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-bare-id-hit-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: createDetailArtifact({
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  note: {
                    id: "note-001",
                    title: "bare id only"
                  }
                }
              }
            }
          }),
          rejected_observation: null,
          incompatible_observation: null
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

  it("returns rejected_source for exact-shape synthetic detail observations", async () => {
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

  it("expires stale exact-shape synthetic detail observations as template_stale", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const syntheticArtifact = {
      ...createDetailArtifact({
        captured_at: 1_710_000_000_000,
        observed_at: 1_710_000_000_000
      }),
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
        options: createLiveReadOptions("run-detail-context-rejected-stale-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-rejected-stale-001")
      },
      createEnvironment({
        now: () => 1_710_001_000_000,
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => syntheticArtifact
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

  it("recovers rejected raw detail shape from request.body.source_note_id", async () => {
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
        options: createLiveReadOptions("run-detail-raw-source-note-id-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-raw-source-note-id-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createDetailArtifact({
            shape: undefined,
            template_ready: false,
            rejection_reason: "failed_request_rejected",
            request_status: {
              completion: "failed",
              http_status: 500
            },
            response: {
              headers: {},
              body: {
                code: 500100,
                msg: "create invoker failed"
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      reason: "GATEWAY_INVOKER_FAILED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "GATEWAY_INVOKER_FAILED",
      captured_request_shape: {
        note_id: "note-001"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("returns rejected_source for exact-shape synthetic user_home observations", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          user: {
            user_id: "user-001"
          }
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const syntheticArtifact = {
      ...createUserHomeArtifact(),
      source_kind: "synthetic_request",
      template_ready: true,
      rejection_reason: "synthetic_request_rejected"
    } as unknown as CapturedRequestContextArtifact;

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-context-rejected-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-context-rejected-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
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

  it("preserves TARGET_API_RESPONSE_INVALID for exact-hit detail artifacts without a recognized backend failure class", async () => {
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
          code: 123456,
          msg: "unknown upstream failure"
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
      request_context_miss_reason: "TARGET_API_RESPONSE_INVALID"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "SESSION_EXPIRED",
      status: 401,
      body: {
        code: 401001,
        msg: "login expired"
      },
      expectedMessage: "登录已失效，无法执行 xhs.detail"
    },
    {
      label: "ACCOUNT_ABNORMAL",
      status: 461,
      body: {
        code: 300011,
        msg: "account abnormal"
      },
      expectedMessage: "账号异常，平台拒绝当前请求"
    },
    {
      label: "BROWSER_ENV_ABNORMAL",
      status: 200,
      body: {
        code: 300015,
        msg: "browser environment abnormal"
      },
      expectedMessage: "浏览器环境异常，平台拒绝当前请求"
    },
    {
      label: "GATEWAY_INVOKER_FAILED",
      status: 500,
      body: {
        code: 500100,
        msg: "create invoker failed"
      },
      expectedMessage: "网关调用失败，当前上下文不足以完成 xhs.detail 请求"
    },
    {
      label: "CAPTCHA_REQUIRED",
      status: 429,
      body: {
        code: 429001,
        msg: "captcha required"
      },
      expectedMessage: "平台要求额外人机验证，无法继续执行"
    },
    {
      label: "TARGET_API_RESPONSE_INVALID",
      status: 418,
      body: {
        code: 418001,
        msg: "teapot"
      },
      expectedMessage: "xhs.detail 接口返回了未识别的失败响应"
    }
  ])("preserves backend failure class $label for rejected exact-hit detail artifacts", async ({
    label,
    status,
    body,
    expectedMessage
  }) => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const failedArtifact = {
      ...createDetailArtifact(),
      status,
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: status
      },
      response: {
        headers: {},
        body
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
        options: createLiveReadOptions(`run-detail-context-${label}-001`, "explore_detail_tab"),
        executionContext: createExecutionContext(`run-detail-context-${label}-001`)
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => failedArtifact
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toBe(expectedMessage);
    expect(result.payload.details).toMatchObject({
      reason: label,
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: label
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("prefers a newer exact-shape rejected detail observation over an older admitted template", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const admittedTemplate = createDetailArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const rejectedObservation = createDetailArtifact({
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: 500
      },
      response: {
        headers: {},
        body: {
          code: 500100,
          msg: "create invoker failed"
        }
      }
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-newer-rejected-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-newer-rejected-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: admittedTemplate,
          rejected_observation: rejectedObservation,
          incompatible_observation: null,
          available_shape_keys: []
        })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "GATEWAY_INVOKER_FAILED",
      reason: "GATEWAY_INVOKER_FAILED"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "GATEWAY_INVOKER_FAILED",
      status: 500,
      body: {
        code: 500100,
        msg: "create invoker failed"
      },
      expectedMessage: "网关调用失败，当前上下文不足以完成 xhs.user_home 请求"
    },
    {
      label: "CAPTCHA_REQUIRED",
      status: 429,
      body: {
        code: 429001,
        msg: "captcha required"
      },
      expectedMessage: "平台要求额外人机验证，无法继续执行"
    },
    {
      label: "TARGET_API_RESPONSE_INVALID",
      status: 418,
      body: {
        code: 418001,
        msg: "teapot"
      },
      expectedMessage: "xhs.user_home 接口返回了未识别的失败响应"
    }
  ])("preserves backend failure class $label for rejected exact-hit user_home artifacts", async ({
    label,
    status,
    body,
    expectedMessage
  }) => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const failedArtifact = {
      ...createUserHomeArtifact(),
      status,
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: status
      },
      response: {
        headers: {},
        body
      }
    } as unknown as CapturedRequestContextArtifact;

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions(`run-user-home-context-${label}-001`, "profile_tab"),
        executionContext: createExecutionContext(`run-user-home-context-${label}-001`)
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => failedArtifact
      })
    );

    expect(result.ok).toBe(false);
    expect(result.error.message).toBe(expectedMessage);
    expect(result.payload.details).toMatchObject({
      reason: label,
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: label
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps using an exact admitted detail template when newer mismatch evidence is only a sibling note", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          note: {
            note_id: "note-001",
            title: "note-001"
          }
        }
      }
    }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));
    const admittedTemplate = createDetailArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const incompatibleObservation = createDetailArtifact({
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
      template_ready: false,
      rejection_reason: "shape_mismatch",
      shape_key:
        '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-999"}',
      shape: {
        command: "xhs.detail",
        method: "POST",
        pathname: "/api/sns/web/v1/feed",
        note_id: "note-999"
      },
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
              }
            ]
          }
        }
      }
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-context-newer-mismatch-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-context-newer-mismatch-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: admittedTemplate,
          rejected_observation: null,
          incompatible_observation: incompatibleObservation,
          available_shape_keys: [
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-999"}'
          ]
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/feed", {
      source_note_id: "note-001",
      image_scenes: ["WB_PRV", "CRD_PRV_WEBP"]
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true,
        referrer:
          "https://www.xiaohongshu.com/explore/note-001?xsec_token=token-note-001&xsec_source=pc_search"
      })
    );
  });

  it("does not let a newer synthetic exact-shape rejection shadow an admitted detail template", async () => {
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

    const admittedTemplate = createDetailArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const rejectedObservation = createDetailArtifact({
      source_kind: "synthetic_request",
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
      template_ready: false,
      rejection_reason: "synthetic_request_rejected"
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions("run-detail-synthetic-shadow-001", "explore_detail_tab"),
        executionContext: createExecutionContext("run-detail-synthetic-shadow-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "detail-page",
          shape_key:
            '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
          admitted_template: admittedTemplate,
          rejected_observation: rejectedObservation,
          incompatible_observation: null,
          available_shape_keys: []
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true
      })
    );
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
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            url: "https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?user_id=user-001&sec_user_id=sec-001"
          })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith(
      "/api/sns/web/v1/user/otherinfo?user_id=user-001&sec_user_id=sec-001",
      {}
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/user/otherinfo?user_id=user-001&sec_user_id=sec-001",
        method: "GET",
        pageContextRequest: true,
        referrer:
          "https://www.xiaohongshu.com/user/profile/user-001?xsec_token=token-user-001&xsec_source=pc_search",
        headers: expect.objectContaining({
          "X-S-Common": "{\"userId\":\"captured-user-id\"}",
          "x-b3-traceid": "generatedid001",
          "x-xray-traceid": "generatedid001"
        })
      })
    );
  });

  it("fails closed for raw user_home artifacts without an exact shape even when the response user_id matches", async () => {
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
        options: createLiveReadOptions("run-user-home-raw-template-missing-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-raw-template-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: undefined,
            shape_key: undefined
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

  it("waits for captured user_home context before failing closed on a fresh navigation", async () => {
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
    let readyState = "interactive";
    let lookupCount = 0;
    const sleep = vi.fn(async () => {
      readyState = "complete";
    });
    const readCapturedRequestContext = vi.fn(async () => {
      lookupCount += 1;
      return lookupCount === 1 ? null : createUserHomeArtifact();
    });

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-context-wait-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-context-wait-001")
      },
      createEnvironment({
        sleep,
        getReadyState: () => readyState,
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext
      })
    );

    expect(result.ok).toBe(true);
    expect(readCapturedRequestContext).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
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

  it("expires stale exact-shape rejected user_home lookup observations as template_stale", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const rejectedObservation = createUserHomeArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000,
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: 500
      },
      response: {
        headers: {},
        body: {
          code: 500100,
          msg: "create invoker failed"
        }
      }
    });

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-rejected-stale-lookup-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-rejected-stale-lookup-001")
      },
      createEnvironment({
        now: () => 1_710_001_000_000,
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "profile-page",
          shape_key:
            '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
          admitted_template: null,
          rejected_observation: rejectedObservation,
          incompatible_observation: null,
          available_shape_keys: []
        })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "stale",
      request_context_miss_reason: "template_stale",
      captured_request_shape: {
        user_id: "user-001"
      }
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps user_home request context fresh when observed_at is newer than captured_at", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          user: {
            userId: "user-001"
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
        options: createLiveReadOptions("run-user-home-observed-at-fresh-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-observed-at-fresh-001")
      },
      createEnvironment({
        now: () => 1_710_001_000_000,
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            captured_at: 1_710_000_000_000,
            observed_at: 1_710_000_950_000
          })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true
      })
    );
  });

  it("prefers a newer exact-shape rejected user_home observation over an older admitted template", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: {} } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const admittedTemplate = createUserHomeArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const rejectedObservation = createUserHomeArtifact({
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
      template_ready: false,
      rejection_reason: "failed_request_rejected",
      request_status: {
        completion: "failed",
        http_status: 500
      },
      response: {
        headers: {},
        body: {
          code: 500100,
          msg: "create invoker failed"
        }
      }
    });

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-newer-rejected-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-newer-rejected-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "profile-page",
          shape_key:
            '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
          admitted_template: admittedTemplate,
          rejected_observation: rejectedObservation,
          incompatible_observation: null,
          available_shape_keys: []
        })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "GATEWAY_INVOKER_FAILED",
      reason: "GATEWAY_INVOKER_FAILED"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps shape_mismatch when only sibling rejected user_home shapes exist in the route bucket", async () => {
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
        options: createLiveReadOptions("run-user-home-rejected-sibling-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-rejected-sibling-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "profile-page",
          shape_key:
            '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
          admitted_template: null,
          rejected_observation: null,
          incompatible_observation: null,
          available_shape_keys: [
            '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-999"}'
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

  it("fails closed for admitted user_home artifacts when the response lacks a canonical user_id", async () => {
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
        options: createLiveReadOptions("run-user-home-response-user-missing-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-response-user-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: {
              command: "xhs.user_home",
              method: "GET",
              pathname: "/api/sns/web/v1/user/otherinfo",
              user_id: "user-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  user: {
                    nickname: "captured-user"
                  }
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

  it("fails closed for admitted user_home artifacts when the response user_id mismatches the requested user_id", async () => {
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
        options: createLiveReadOptions("run-user-home-response-user-mismatch-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-response-user-mismatch-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: {
              command: "xhs.user_home",
              method: "GET",
              pathname: "/api/sns/web/v1/user/otherinfo",
              user_id: "user-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  user: {
                    user_id: "user-999",
                    nickname: "captured-user"
                  }
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

  it("fails closed when user_home captured response only exposes nested id instead of canonical user_id", async () => {
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
        options: createLiveReadOptions("run-user-home-response-id-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-response-id-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: {
              command: "xhs.user_home",
              method: "GET",
              pathname: "/api/sns/web/v1/user/otherinfo",
              user_id: "user-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  user: {
                    id: "user-001",
                    nickname: "captured-user"
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("fails closed when user_home captured response only exposes wrapper data.user_id", async () => {
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
        options: createLiveReadOptions("run-user-home-response-wrapper-user-id-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-response-wrapper-user-id-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: {
              command: "xhs.user_home",
              method: "GET",
              pathname: "/api/sns/web/v1/user/otherinfo",
              user_id: "user-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  user_id: "user-001"
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(false);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("accepts admitted user_home artifacts when the canonical user object is stored directly under data", async () => {
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
        options: createLiveReadOptions("run-user-home-response-direct-data-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-response-direct-data-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  nickname: "captured-user",
                  basicInfo: {
                    userId: "user-001"
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true
      })
    );
  });

  it.each([
    {
      label: "basicInfo.userId",
      responseUser: {
        basicInfo: {
          userId: "user-001"
        }
      }
    },
    {
      label: "basic_info.user_id",
      responseUser: {
        basic_info: {
          user_id: "user-001"
        }
      }
    }
  ])(
    "accepts admitted user_home artifacts when canonical user identity is nested under $label",
    async ({ label, responseUser }) => {
      const runId =
        label === "basicInfo.userId"
          ? "run-user-home-nested-response-basic-info"
          : "run-user-home-nested-response-basic-info-snake";
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
          options: createLiveReadOptions(runId, "profile_tab"),
          executionContext: createExecutionContext(runId)
        },
        createEnvironment({
          getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
          callSignature,
          fetchJson,
          readCapturedRequestContext: async () =>
            createUserHomeArtifact({
              shape: {
                command: "xhs.user_home",
                method: "GET",
                pathname: "/api/sns/web/v1/user/otherinfo",
                user_id: "user-001"
              },
              response: {
                headers: {},
                body: {
                  code: 0,
                  data: {
                    user: responseUser
                  }
                }
              }
            })
        })
      );

      expect(result.ok).toBe(true);
      expect(callSignature).toHaveBeenCalled();
      expect(fetchJson).toHaveBeenCalledWith(
        expect.objectContaining({
          pageContextRequest: true
        })
      );
    }
  );

  it("prefers the requested user_id when admitted user_home responses mix wrapper candidates", async () => {
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
        options: createLiveReadOptions("run-user-home-mixed-wrapper-response-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-mixed-wrapper-response-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createUserHomeArtifact({
            shape: {
              command: "xhs.user_home",
              method: "GET",
              pathname: "/api/sns/web/v1/user/otherinfo",
              user_id: "user-001"
            },
            response: {
              headers: {},
              body: {
                code: 0,
                data: {
                  user: {
                    user_id: "wrapper-user-999",
                    nickname: "wrapper user",
                    basicInfo: {
                      userId: "user-001"
                    }
                  }
                }
              }
            }
          })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true
      })
    );
  });

  it("does not let a newer synthetic exact-shape rejection shadow an admitted user_home template", async () => {
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

    const admittedTemplate = createUserHomeArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const rejectedObservation = createUserHomeArtifact({
      source_kind: "synthetic_request",
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
      template_ready: false,
      rejection_reason: "synthetic_request_rejected"
    });

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions("run-user-home-synthetic-shadow-001", "profile_tab"),
        executionContext: createExecutionContext("run-user-home-synthetic-shadow-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "profile-page",
          shape_key:
            '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
          admitted_template: admittedTemplate,
          rejected_observation: rejectedObservation,
          incompatible_observation: null,
          available_shape_keys: []
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalled();
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true
      })
    );
  });
});
