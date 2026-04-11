import { describe, expect, it } from "vitest";

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

const createLiveReadOptions = (overrides?: Partial<XhsSearchOptions>): XhsSearchOptions => ({
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
  ...overrides
});

const createEnvironment = (overrides?: Partial<XhsSearchEnvironment>): XhsSearchEnvironment => ({
  now: () => 1_000,
  randomId: () => "req-001",
  getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=test",
  getDocumentTitle: () => "XHS",
  getReadyState: () => "complete",
  getCookie: () => "a1=cookie-token",
  getPageStateRoot: () => null,
  readPageStateRoot: async () => null,
  callSignature: async () => ({ "X-s": "sig", "X-t": "1710000000" }),
  fetchJson: async () => ({ status: 200, body: { code: 0 } }),
  ...overrides
});

describe("xhs read execution fallback", () => {
  it("uses detail page-state fallback when feed api is blocked but note state is still present", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createLiveReadOptions({
          target_page: "explore_detail_tab",
          actual_target_page: "explore_detail_tab"
        }),
        executionContext: {
          runId: "run-detail-fallback-001",
          sessionId: "nm-session-001",
          profile: "xhs_001"
        }
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        getPageStateRoot: () => null,
        readPageStateRoot: async () => ({
          note: {
            noteDetailMap: {
              "note-001": {
                noteId: "note-001"
              }
            }
          }
        }),
        fetchJson: async () => ({
          status: 461,
          body: {
            code: 300011,
            msg: "account abnormal"
          }
        })
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected detail fallback success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        ability_id: "xhs.note.detail.v1",
        outcome: "partial",
        data_ref: {
          note_id: "note-001"
        }
      }
    });
    expect(result.payload.observability).toMatchObject({
      page_state: {
        page_kind: "detail",
        fallback_used: true
      },
      failure_site: null
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "request",
          outcome: "failed",
          failure_reason: "ACCOUNT_ABNORMAL"
        }),
        expect.objectContaining({
          stage: "page_state_fallback",
          outcome: "completed",
          fallback_reason: "ACCOUNT_ABNORMAL"
        })
      ])
    );
  });

  it("uses user_home page-state fallback when profile api returns env-abnormal but page state remains readable", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions({
          target_page: "profile_tab",
          actual_target_page: "profile_tab"
        }),
        executionContext: {
          runId: "run-user-fallback-001",
          sessionId: "nm-session-001",
          profile: "xhs_001"
        }
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        getPageStateRoot: () => null,
        readPageStateRoot: async () => ({
          user: {
            userId: "user-001"
          },
          board: {},
          note: {}
        }),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 300015,
            msg: "browser environment abnormal"
          }
        })
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected user_home fallback success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        ability_id: "xhs.user.home.v1",
        outcome: "partial",
        data_ref: {
          user_id: "user-001"
        }
      }
    });
    expect(result.payload.observability).toMatchObject({
      page_state: {
        page_kind: "user_home",
        fallback_used: true
      },
      failure_site: null
    });
  });

  it("keeps detail execution failed when api fails and no fallback page state exists", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-404"
        },
        options: createLiveReadOptions({
          target_page: "explore_detail_tab",
          actual_target_page: "explore_detail_tab"
        }),
        executionContext: {
          runId: "run-detail-no-fallback-001",
          sessionId: "nm-session-001",
          profile: "xhs_001"
        }
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-404",
        fetchJson: async () => ({
          status: 500,
          body: {
            msg: "create invoker failed"
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail execution failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "网关调用失败，当前上下文不足以完成 xhs.detail 请求"
    });
  });

  it("falls back to sync page-state hook when readPageStateRoot is absent", async () => {
    const environment = createEnvironment({
      readPageStateRoot: undefined,
      getLocationHref: () => "https://www.xiaohongshu.com/explore/note-sync-001",
      getPageStateRoot: () => ({
        note: {
          noteDetailMap: {
            "note-sync-001": {
              noteId: "note-sync-001"
            }
          }
        }
      }),
      fetchJson: async () => ({
        status: 500,
        body: {
          msg: "create invoker failed"
        }
      })
    });

    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-sync-001"
        },
        options: createLiveReadOptions({
          target_page: "explore_detail_tab",
          actual_target_page: "explore_detail_tab"
        }),
        executionContext: {
          runId: "run-detail-sync-fallback-001",
          sessionId: "nm-session-001",
          profile: "xhs_001"
        }
      },
      environment
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected sync fallback success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        data_ref: {
          note_id: "note-sync-001"
        },
        outcome: "partial"
      }
    });
  });

  it("keeps user_home execution failed when page-state user identity does not match requested user_id", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-001"
        },
        options: createLiveReadOptions({
          target_page: "profile_tab",
          actual_target_page: "profile_tab"
        }),
        executionContext: {
          runId: "run-user-mismatch-001",
          sessionId: "nm-session-001",
          profile: "xhs_001"
        }
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        getPageStateRoot: () => null,
        readPageStateRoot: async () => ({
          user: {
            userId: "user-999"
          },
          board: {},
          note: {}
        }),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 300015,
            msg: "browser environment abnormal"
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home execution failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "浏览器环境异常，平台拒绝当前请求"
    });
  });
});
