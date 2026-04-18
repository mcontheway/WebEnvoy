import { describe, expect, it, vi } from "vitest";

import { executeXhsSearch } from "../extension/xhs-search.js";
import { executeXhsDetail } from "../extension/xhs-detail.js";
import { executeXhsUserHome } from "../extension/xhs-user-home.js";
import type { XhsSearchEnvironment, XhsSearchOptions } from "../extension/xhs-search-types.js";

const createApprovalRecord = () => ({
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
  recorded_at: "2026-03-23T10:00:30Z"
});

const createAdmissionContext = (input: {
  runId: string;
  targetPage: "search_result_tab" | "explore_detail_tab" | "profile_tab";
}) => ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${input.runId}`,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: input.targetPage,
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
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
    audit_admission_ref: `audit_admission_${input.runId}`,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: input.targetPage,
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
    recorded_at: "2026-03-23T10:00:30Z"
  }
});

const createLiveReadOptions = (input: {
  runId: string;
  targetPage: "search_result_tab" | "explore_detail_tab" | "profile_tab";
  overrides?: Partial<XhsSearchOptions>;
}): XhsSearchOptions => ({
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: input.targetPage,
  gate_invocation_id: `gate-${input.runId}`,
  actual_target_domain: "www.xiaohongshu.com",
  actual_target_tab_id: 32,
  actual_target_page: input.targetPage,
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  approval_record: createApprovalRecord(),
  audit_record: createAuditRecord(),
  admission_context: createAdmissionContext({
    runId: input.runId,
    targetPage: input.targetPage
  }),
  ...(input.overrides ?? {})
});

const createEnvironment = (overrides?: Partial<XhsSearchEnvironment>): XhsSearchEnvironment => ({
  now: () => 1_000,
  randomId: () => "req-001",
  getLocationHref: () => "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51",
  getDocumentTitle: () => "XHS",
  getReadyState: () => "complete",
  getCookie: () => "a1=cookie-token",
  getPageStateRoot: () => null,
  readPageStateRoot: async () => null,
  callSignature: async () => ({ "X-s": "sig", "X-t": "1710000000" }),
  fetchJson: async () => ({ status: 200, body: { code: 0, data: {} } }),
  ...overrides
});

const createExecutionContext = (runId: string, targetPage: string) => ({
  runId,
  sessionId: "nm-session-001",
  gateInvocationId: `issue209-gate-${runId}`,
  profile: "xhs_001",
  targetDomain: "www.xiaohongshu.com",
  targetTabId: 32,
  targetPage,
  actionType: "read" as const,
  requestedExecutionMode: "live_read_high_risk" as const,
  riskState: "allowed" as const
});

describe("xhs request-context hydration", () => {
  it("hydrates xhs.search live requests from captured page context when available", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));

    const result = await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI"
        },
        options: createLiveReadOptions({
          runId: "run-search-context-001",
          targetPage: "search_result_tab"
        }),
        executionContext: createExecutionContext("run-search-context-001", "search_result_tab")
      },
      createEnvironment({
        fetchJson,
        readCapturedRequestContext: async () => ({
          url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=utf-8",
            "X-S-Common": "{\"searchId\":\"captured-search-id\"}",
            "x-b3-traceid": "trace-b3-captured",
            "x-xray-traceid": "trace-xray-captured"
          },
          body: "{\"keyword\":\"AI\",\"search_id\":\"captured-search-id\",\"page\":1,\"page_size\":20,\"sort\":\"general\",\"note_type\":0}",
          referrer: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51",
          captured_at: 1_710_000_000_000
        })
      })
    );

    expect(result.ok).toBe(true);
    const searchFetchInput = fetchJson.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(searchFetchInput).toMatchObject({
      pageContextRequest: true,
      referrer: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51",
      headers: {
        "X-S-Common": "{\"searchId\":\"captured-search-id\"}",
        "x-b3-traceid": "trace-b3-captured",
        "x-xray-traceid": "trace-xray-captured"
      }
    });
    expect(JSON.parse(String(searchFetchInput.body))).toEqual({
      keyword: "AI",
      page: 1,
      page_size: 20,
      search_id: "captured-search-id",
      sort: "general",
      note_type: 0
    });
  });

  it("does not reuse captured search session fields when the captured query mismatches the current request", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0, data: { items: [] } } }));

    await executeXhsSearch(
      {
        abilityId: "xhs.note.search.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          query: "AI"
        },
        options: createLiveReadOptions({
          runId: "run-search-context-mismatch-001",
          targetPage: "search_result_tab"
        }),
        executionContext: createExecutionContext(
          "run-search-context-mismatch-001",
          "search_result_tab"
        )
      },
      createEnvironment({
        fetchJson,
        randomId: () => "generated-search-id-001",
        readCapturedRequestContext: async () => ({
          url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          method: "POST",
          headers: {
            "X-S-Common": "{\"searchId\":\"captured-search-id\"}"
          },
          body: "{\"keyword\":\"露营\",\"search_id\":\"captured-search-id\",\"page\":7,\"page_size\":50,\"sort\":\"time_desc\",\"note_type\":2}",
          referrer: "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5&type=51",
          captured_at: 1_710_000_000_000
        })
      })
    );

    const searchFetchInput = fetchJson.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(JSON.parse(String(searchFetchInput.body))).toEqual({
      keyword: "AI",
      page: 1,
      page_size: 20,
      search_id: "generated-search-id-001",
      sort: "general",
      note_type: 0
    });
  });

  it("hydrates xhs.detail live requests from captured feed context and keeps page-context fetch", async () => {
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          items: [{ note_card: { noteId: "note-001", title: "captured note" } }]
        }
      }
    }));

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions({
          runId: "run-detail-context-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createExecutionContext("run-detail-context-001", "explore_detail_tab")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        fetchJson,
        readCapturedRequestContext: async () => ({
          url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
          method: "POST",
          headers: {
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json;charset=utf-8",
            "X-S-Common": "{\"page\":\"detail\"}"
          },
          body: "{\"source_note_id\":\"note-001\",\"image_scenes\":[\"CRD_PRV_WEBP\"]}",
          referrer: "https://www.xiaohongshu.com/explore/note-001",
          captured_at: 1_710_000_000_000
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed",
        pageContextRequest: true,
        referrer: "https://www.xiaohongshu.com/explore/note-001",
        headers: expect.objectContaining({
          "X-S-Common": "{\"page\":\"detail\"}"
        }),
        body: JSON.stringify({
          source_note_id: "note-001",
          image_scenes: ["CRD_PRV_WEBP"]
        })
      })
    );
  });

  it("hydrates xhs.user_home live requests from captured user context and keeps page-context fetch", async () => {
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

    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions({
          runId: "run-user-context-001",
          targetPage: "profile_tab"
        }),
        executionContext: createExecutionContext("run-user-context-001", "profile_tab")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        fetchJson,
        readCapturedRequestContext: async () => ({
          url: "https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?user_id=user-001",
          method: "GET",
          headers: {
            Accept: "application/json, text/plain, */*",
            "X-S-Common": "{\"page\":\"profile\"}"
          },
          body: null,
          referrer: "https://www.xiaohongshu.com/user/profile/user-001",
          captured_at: 1_710_000_000_000
        })
      })
    );

    expect(result.ok).toBe(true);
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/user/otherinfo?user_id=user-001",
        pageContextRequest: true,
        referrer: "https://www.xiaohongshu.com/user/profile/user-001",
        headers: expect.objectContaining({
          "X-S-Common": "{\"page\":\"profile\"}"
        })
      })
    );
  });
});
