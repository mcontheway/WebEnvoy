import { describe, expect, it, vi } from "vitest";

import { executeXhsSearch } from "../extension/xhs-search.js";
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

const createAuditRecord = () => ({
  event_id: "audit-live-read-request-context-001",
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  gate_decision: "allowed",
  recorded_at: "2026-04-19T10:00:30Z"
});

const createAdmissionContext = (runId: string) => ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${runId}`,
    run_id: runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "search_result_tab",
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
    recorded_at: "2026-04-19T10:00:30Z"
  }
});

const createLiveReadOptions = (
  runId: string,
  overrides?: Partial<XhsSearchOptions>
): XhsSearchOptions => ({
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  actual_target_domain: "www.xiaohongshu.com",
  actual_target_tab_id: 32,
  actual_target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  approval_record: createApprovalRecord(),
  audit_record: createAuditRecord(),
  admission_context: createAdmissionContext(runId),
  ...(overrides ?? {})
});

const createExecutionContext = (runId: string) => ({
  runId,
  sessionId: "nm-session-001",
  gateInvocationId: `issue209-gate-${runId}`,
  profile: "xhs_001"
});

const createCapturedArtifact = (
  overrides?: Partial<CapturedRequestContextArtifact> & Record<string, unknown>
): CapturedRequestContextArtifact =>
  ({
    source_kind: "page_request",
    transport: "fetch",
    method: "POST",
    path: "/api/sns/web/v1/search/notes",
    url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
    status: 200,
    captured_at: 1_710_000_000_000,
    request: {
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-S-Common": "{\"searchId\":\"captured-search-id\"}",
        "x-b3-traceid": "trace-b3-captured",
        "x-xray-traceid": "trace-xray-captured"
      },
      body: {
        keyword: "AI",
        page: 2,
        page_size: 30,
        search_id: "captured-search-id",
        sort: "time_desc",
        note_type: 1
      }
    },
    response: {
      headers: {},
      body: {
        code: 0,
        data: {
          items: []
        }
      }
    },
    referrer: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51&page=2",
    ...(overrides ?? {})
  }) as unknown as CapturedRequestContextArtifact;

const createEnvironment = (overrides?: Partial<XhsSearchEnvironment>): XhsSearchEnvironment => ({
  now: () => 1_710_000_100_000,
  randomId: () => "generated-search-id-001",
  getLocationHref: () => "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51&page=2",
  getDocumentTitle: () => "XHS Search",
  getReadyState: () => "complete",
  getCookie: () => "a1=cookie-token",
  getPageStateRoot: () => null,
  readPageStateRoot: async () => null,
  callSignature: async () => ({ "X-s": "sig", "X-t": "1710000000" }),
  fetchJson: async () => ({ status: 200, body: { code: 0, data: { items: [] } } }),
  readCapturedRequestContext: async () => null,
  ...overrides
});

describe("xhs search request-context exact-shape reuse", () => {
  it("reuses headers, referrer, and search_id only on exact shape hit", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-context-hit-001"),
        executionContext: createExecutionContext("run-search-context-hit-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => createCapturedArtifact()
      })
    );

    expect(result.ok).toBe(true);
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/search/notes", {
      keyword: "AI",
      page: 2,
      page_size: 30,
      search_id: "captured-search-id",
      sort: "time_desc",
      note_type: 1
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        pageContextRequest: true,
        referrer: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51&page=2",
        headers: expect.objectContaining({
          "X-S-Common": "{\"searchId\":\"captured-search-id\"}",
          "x-b3-traceid": "trace-b3-captured",
          "x-xray-traceid": "trace-xray-captured"
        }),
        body: JSON.stringify({
          keyword: "AI",
          page: 2,
          page_size: 30,
          search_id: "captured-search-id",
          sort: "time_desc",
          note_type: 1
        })
      })
    );
  });

  it("fails closed on shape mismatch instead of falling back to synthetic page-context dispatch", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-context-mismatch-001"),
        executionContext: createExecutionContext("run-search-context-mismatch-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () =>
          createCapturedArtifact({
            request: {
              headers: createCapturedArtifact().request.headers,
              body: {
                keyword: "AI",
                page: 2,
                page_size: 30,
                search_id: "captured-search-id",
                sort: "time_desc",
                note_type: 2
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

  it("fails closed when no captured request context is available", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI"
        },
        options: createLiveReadOptions("run-search-context-missing-001"),
        executionContext: createExecutionContext("run-search-context-missing-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => null
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

  it("treats failed captured search artifacts as rejected_source", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const failedArtifact = {
      ...createCapturedArtifact(),
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

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-context-rejected-001"),
        executionContext: createExecutionContext("run-search-context-rejected-001")
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

  it("prefers a newer exact-shape rejected search observation over an older admitted template", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const admittedTemplate = createCapturedArtifact({
      captured_at: 1_710_000_000_000,
      observed_at: 1_710_000_000_000
    });
    const rejectedObservation = createCapturedArtifact({
      captured_at: 1_710_000_050_000,
      observed_at: 1_710_000_050_000,
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
    });

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-newer-rejected-001"),
        executionContext: createExecutionContext("run-search-newer-rejected-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "search-page",
          shape_key:
            '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"AI","page":2,"page_size":30,"sort":"time_desc","note_type":1}',
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
      request_context_miss_reason: "failed_request_rejected"
    });
    expect(callSignature).not.toHaveBeenCalled();
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("keeps shape_mismatch when only sibling rejected search shapes exist in the route bucket", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI"
        },
        options: createLiveReadOptions("run-search-rejected-sibling-001"),
        executionContext: createExecutionContext("run-search-rejected-sibling-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        readCapturedRequestContext: async () => ({
          page_context_namespace: "search-page",
          shape_key:
            '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"AI","page":1,"page_size":20,"sort":"general","note_type":0}',
          admitted_template: null,
          rejected_observation: null,
          incompatible_observation: null,
          available_shape_keys: [
            '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"AI","page":2,"page_size":20,"sort":"general","note_type":0}'
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

  it("fails closed on stale exact-shape context", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-context-stale-001"),
        executionContext: createExecutionContext("run-search-context-stale-001")
      },
      createEnvironment({
        callSignature,
        fetchJson,
        now: () => 1_710_001_000_000,
        readCapturedRequestContext: async () =>
          createCapturedArtifact({
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

  it("treats synthetic captured requests as rejected_source even when they look template-ready", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));
    const callSignature = vi.fn(async () => ({ "X-s": "sig", "X-t": "1710000000" }));

    const syntheticArtifact = {
      ...createCapturedArtifact(),
      source_kind: "synthetic_request",
      template_ready: true,
      rejection_reason: "synthetic_request_rejected"
    } as unknown as CapturedRequestContextArtifact;

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI",
          page: 2,
          limit: 30,
          sort: "time_desc",
          note_type: 1
        },
        options: createLiveReadOptions("run-search-context-rejected-001"),
        executionContext: createExecutionContext("run-search-context-rejected-001")
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
});
