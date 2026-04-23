import { describe, expect, it, vi } from "vitest";

import { executeXhsDetail } from "../extension/xhs-detail.js";
import { executeXhsUserHome } from "../extension/xhs-user-home.js";
import type { XhsSearchEnvironment, XhsSearchOptions } from "../extension/xhs-search-types.js";

const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";

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
  event_id: "audit-live-read-fallback-001",
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  gate_decision: "allowed",
  recorded_at: "2026-03-23T10:00:30Z"
});

const createApprovedReadAdmissionContext = (input: {
  runId: string;
  requestId?: string;
  targetTabId?: number;
  targetPage: string;
  requestedExecutionMode?: "live_read_high_risk" | "live_read_limited";
  riskState?: "allowed" | "limited";
}) => {
  const requestId = input.requestId;
  const refSuffix = requestId ? `${input.runId}_${requestId}` : input.runId;
  return ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${refSuffix}`,
    ...(requestId ? { request_id: requestId } : {}),
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId ?? 32,
    target_page: input.targetPage,
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode ?? "live_read_high_risk",
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
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(requestId ? { request_id: requestId } : {}),
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId ?? 32,
    target_page: input.targetPage,
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode ?? "live_read_high_risk",
    risk_state: input.riskState ?? "allowed",
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
};

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
  audit_record: createAuditRecord(),
  ...overrides
});

const createAdmittedLiveReadOptions = (input: {
  runId: string;
  targetPage: "explore_detail_tab" | "profile_tab";
  overrides?: Partial<XhsSearchOptions>;
}): XhsSearchOptions =>
  createLiveReadOptions({
    target_page: input.targetPage,
    actual_target_page: input.targetPage,
    admission_context: createApprovedReadAdmissionContext({
      runId: input.runId,
      targetPage: input.targetPage,
      requestedExecutionMode:
        input.overrides?.requested_execution_mode === "live_read_limited"
          ? "live_read_limited"
          : "live_read_high_risk",
      riskState: input.overrides?.risk_state === "limited" ? "limited" : "allowed"
    }),
    ...(input.overrides ?? {})
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

const createDetailRequestContext = (
  noteId: string,
  overrides?: Record<string, unknown>
): Record<string, unknown> => ({
  source_kind: "page_request",
  transport: "fetch",
  method: "POST",
  path: DETAIL_ENDPOINT,
  url: `https://www.xiaohongshu.com${DETAIL_ENDPOINT}`,
  status: 200,
  captured_at: 1_710_000_000_000,
  page_context_namespace: "xhs.detail",
  shape_key: JSON.stringify({
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
  }),
  shape: {
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
  },
  request: {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json;charset=utf-8",
      "X-S-Common": "{\"detailId\":\"captured-detail-id\"}"
    },
    body: {
      source_note_id: noteId
    }
  },
  response: {
    headers: {},
    body: {
      code: 0,
      data: {
        note: {
          noteId
        }
      }
    }
  },
  referrer: `https://www.xiaohongshu.com/explore/${noteId}`,
  ...(overrides ?? {})
});

const createUserHomeRequestContext = (
  userId: string,
  overrides?: Record<string, unknown>
): Record<string, unknown> => ({
  source_kind: "page_request",
  transport: "fetch",
  method: "GET",
  path: USER_HOME_ENDPOINT,
  url: `https://www.xiaohongshu.com${USER_HOME_ENDPOINT}?user_id=${userId}`,
  status: 200,
  captured_at: 1_710_000_000_000,
  page_context_namespace: "xhs.user_home",
  shape_key: JSON.stringify({
    command: "xhs.user_home",
    method: "GET",
    pathname: USER_HOME_ENDPOINT,
    user_id: userId
  }),
  shape: {
    command: "xhs.user_home",
    method: "GET",
    pathname: USER_HOME_ENDPOINT,
    user_id: userId
  },
  request: {
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-S-Common": "{\"userId\":\"captured-user-id\"}"
    },
    body: null
  },
  response: {
    headers: {},
    body: {
      code: 0,
      data: {
        user: {
          userId
        }
      }
    }
  },
  referrer: `https://www.xiaohongshu.com/user/profile/${userId}`,
  ...(overrides ?? {})
});

const createRequestContextReader = (
  artifact: Record<string, unknown>
): NonNullable<XhsSearchEnvironment["readCapturedRequestContext"]> =>
  (async () => artifact as never) as NonNullable<XhsSearchEnvironment["readCapturedRequestContext"]>;

const createFallbackExecutionContext = (runId: string) => ({
  runId,
  sessionId: "nm-session-001",
  profile: "xhs_001",
  gateInvocationId: `issue209-gate-${runId}-fallback-001`
});

describe("xhs read execution fallback", () => {
  it("returns detail success only when the api payload contains the requested note object", async () => {
    const callSignature = vi.fn(async () => ({
      "X-s": "sig",
      "X-t": "1710000000"
    }));
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          note: {
            noteId: "note-success-001",
            title: "target note"
          }
        }
      }
    }));
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-success-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-success-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-success-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-success-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-success-001")
        )
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected detail success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        ability_id: "xhs.note.detail.v1",
        outcome: "success",
        data_ref: {
          note_id: "note-success-001"
        }
      }
    });
    expect(result.payload.observability).toMatchObject({
      failure_site: null
    });
    expect(result.payload).not.toHaveProperty("diagnosis");
    expect(callSignature).toHaveBeenCalledWith("/api/sns/web/v1/feed", {
      source_note_id: "note-success-001"
    });
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/feed"
      })
    );
  });

  it("returns user_home success only when the api payload contains the requested user object", async () => {
    const callSignature = vi.fn(async () => ({
      "X-s": "sig",
      "X-t": "1710000000"
    }));
    const fetchJson = vi.fn(async () => ({
      status: 200,
      body: {
        code: 0,
        data: {
          user: {
            userId: "user-success-001",
            nickname: "target user"
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
          user_id: "user-success-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-success-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-success-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-success-001",
        callSignature,
        fetchJson,
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-success-001")
        )
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected user_home success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        ability_id: "xhs.user.home.v1",
        outcome: "success",
        data_ref: {
          user_id: "user-success-001"
        }
      }
    });
    expect(result.payload.observability).toMatchObject({
      failure_site: null
    });
    expect(result.payload).not.toHaveProperty("diagnosis");
    expect(callSignature).toHaveBeenCalledWith(
      "/api/sns/web/v1/user/otherinfo?user_id=user-success-001",
      {}
    );
    expect(fetchJson).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/api/sns/web/v1/user/otherinfo?user_id=user-success-001"
      })
    );
  });

  it("accepts wrapped detail payloads when the requested note is nested under note_card", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-wrapped-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-wrapped-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-wrapped-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-wrapped-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-wrapped-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: [
                {
                  note_card: {
                    noteId: "note-wrapped-001",
                    title: "wrapped note"
                  }
                }
              ]
            }
          }
        })
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected wrapped detail success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        outcome: "success",
        data_ref: {
          note_id: "note-wrapped-001"
        }
      }
    });
  });

  it("accepts nested user_home payloads when the requested user id is inside user.basicInfo", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-nested-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-nested-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-nested-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-nested-001",
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-nested-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              user: {
                basicInfo: {
                  userId: "user-nested-001"
                },
                nickname: "nested user"
              }
            }
          }
        })
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error("expected nested user_home success");
    }
    expect(result.payload.summary).toMatchObject({
      capability_result: {
        outcome: "success",
        data_ref: {
          user_id: "user-nested-001"
        }
      }
    });
  });

  it("keeps detail execution failed when api success payload does not contain requested note", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-missing-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-target-missing-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-target-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-missing-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-missing-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: [
                {
                  noteId: "different-note"
                }
              ]
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail target-missing failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "xhs.detail 接口返回成功但未包含目标数据"
    });
    expect(result.payload.diagnosis).toMatchObject({
      failure_site: {
        target: "/api/sns/web/v1/feed"
      }
    });
  });

  it("keeps user_home execution failed when api success payload does not contain requested user", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-missing-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-target-missing-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-target-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-missing-001",
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-missing-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              user: {
                userId: "different-user"
              }
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user target-missing failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "xhs.user_home 接口返回成功但未包含目标数据"
    });
    expect(result.payload.diagnosis).toMatchObject({
      failure_site: {
        target: "/api/sns/web/v1/user/otherinfo"
      }
    });
  });

  it("keeps user_home execution failed when api success payload only exposes a bare id", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-bare-id-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-bare-id-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-bare-id-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-bare-id-001",
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-bare-id-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              user: {
                id: "user-bare-id-001",
                nickname: "bare id only"
              }
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user bare-id failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "xhs.user_home 接口返回成功但未包含目标数据"
    });
    expect(result.payload.diagnosis).toMatchObject({
      failure_site: {
        target: "/api/sns/web/v1/user/otherinfo"
      }
    });
  });

  it("does not treat metadata note id as detail success evidence", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-metadata-only-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-metadata-only-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-metadata-only-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-metadata-only-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-metadata-only-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: [
                {
                  noteId: "different-note",
                  title: "other note"
                }
              ],
              metadata: {
                current_note_id: "note-metadata-only-001"
              }
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail metadata-only failure");
    }
    expect(result.error.message).toBe("xhs.detail 接口返回成功但未包含目标数据");
  });

  it("keeps detail execution failed when the api success payload only exposes a bare id", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-bare-id-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-bare-id-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-bare-id-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-bare-id-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-bare-id-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              id: "note-bare-id-001",
              title: "bare id only"
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail bare-id failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "xhs.detail 接口返回成功但未包含目标数据"
    });
  });

  it("uses detail page-state fallback when request context is missing but page state still proves the requested note", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-fallback-target-missing-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-fallback-target-missing-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-fallback-target-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-fallback-target-missing-001",
        readPageStateRoot: async () => ({
          note: {
            noteDetailMap: {
              "note-fallback-target-missing-001": {
                noteId: "note-fallback-target-missing-001"
              }
            }
          }
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail fallback failure envelope");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "REQUEST_CONTEXT_MISSING"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("uses detail page-state fallback when request-context lookup errors but page state still proves the requested note", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-read-error-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-read-error-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-read-error-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-read-error-001",
        readCapturedRequestContext: vi.fn(async () => {
          throw new Error("bridge unavailable");
        }),
        readPageStateRoot: async () => ({
          note: {
            noteDetailMap: {
              "note-read-error-001": {
                noteId: "note-read-error-001"
              }
            }
          }
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail read-error failure");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "REQUEST_CONTEXT_READ_FAILED"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_READ_FAILED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "error",
      request_context_miss_reason: "request_context_read_failed"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("preserves CAPTCHA_REQUIRED during detail page-state fallback for rejected exact-hit request context", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-fallback-rejected-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-fallback-rejected-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-fallback-rejected-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-fallback-rejected-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-fallback-rejected-001", {
            template_ready: false,
            rejection_reason: "failed_request_rejected",
            request_status: {
              completion: "failed",
              http_status: 429
            },
            response: {
              headers: {},
              body: {
                code: 429001,
                msg: "captcha required"
              }
            }
          })
        ),
        readPageStateRoot: async () => ({
          note: {
            noteDetailMap: {
              "note-fallback-rejected-001": {
                noteId: "note-fallback-rejected-001"
              }
            }
          }
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail rejected-context fallback failure envelope");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "平台要求额外人机验证，无法继续执行"
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "CAPTCHA_REQUIRED"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "CAPTCHA_REQUIRED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "CAPTCHA_REQUIRED"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("does not treat metadata user id as user_home success evidence", async () => {
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-metadata-only-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-metadata-only-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-metadata-only-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-metadata-only-001",
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-metadata-only-001")
        ),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              user: {
                userId: "different-user",
                nickname: "other user"
              },
              metadata: {
                owner_user_id: "user-metadata-only-001"
              }
            }
          }
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home metadata-only failure");
    }
    expect(result.error.message).toBe("xhs.user_home 接口返回成功但未包含目标数据");
  });

  it("uses user_home page-state fallback when request context is missing but page state still proves the requested user", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-fallback-target-missing-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-fallback-target-missing-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-fallback-target-missing-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-fallback-target-missing-001",
        readPageStateRoot: async () => ({
          user: {
            userId: "user-fallback-target-missing-001",
            nickname: "target user"
          }
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home fallback failure envelope");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "REQUEST_CONTEXT_MISSING"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("does not use user_home page-state fallback when page state only exposes root.user metadata", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-fallback-metadata-only-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-fallback-metadata-only-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-fallback-metadata-only-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-fallback-metadata-only-001",
        readPageStateRoot: async () => ({
          user: {
            userId: "user-fallback-metadata-only-001"
          }
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home metadata-only request-context failure");
    }
    expect((result.payload.observability as Record<string, unknown>).page_state).not.toHaveProperty(
      "fallback_used"
    );
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([]);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("uses user_home page-state fallback when request-context lookup errors but page state still proves the requested user", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-read-error-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-read-error-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-read-error-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-read-error-001",
        readCapturedRequestContext: vi.fn(async () => {
          throw new Error("bridge unavailable");
        }),
        readPageStateRoot: async () => ({
          user: {
            basic_info: {
              user_id: "user-read-error-001"
            }
          },
          board: {},
          note: {}
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home read-error failure");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "REQUEST_CONTEXT_READ_FAILED"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_READ_FAILED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "error",
      request_context_miss_reason: "request_context_read_failed"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("preserves GATEWAY_INVOKER_FAILED during user_home page-state fallback for rejected exact-hit request context", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-fallback-rejected-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-fallback-rejected-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-fallback-rejected-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-fallback-rejected-001",
        readCapturedRequestContext: createRequestContextReader(
          createUserHomeRequestContext("user-fallback-rejected-001", {
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
        ),
        readPageStateRoot: async () => ({
          user: {
            userId: "user-fallback-rejected-001"
          },
          board: {},
          note: {}
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home rejected-context fallback failure envelope");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "网关调用失败，当前上下文不足以完成 xhs.user_home 请求"
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "GATEWAY_INVOKER_FAILED"
      })
    ]);
    expect(result.payload.details).toMatchObject({
      reason: "GATEWAY_INVOKER_FAILED",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "rejected_source",
      request_context_miss_reason: "GATEWAY_INVOKER_FAILED"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("uses user_home page-state fallback when page state only proves the requested user via basic_info.user_id", async () => {
    const fetchJson = vi.fn(async () => ({ status: 200, body: { code: 0 } }));
    const result = await executeXhsUserHome(
      {
        abilityId: "xhs.user.home.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          user_id: "user-fallback-basic-info-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-user-fallback-basic-info-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-fallback-basic-info-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-fallback-basic-info-001",
        readPageStateRoot: async () => ({
          user: {
            basic_info: {
              user_id: "user-fallback-basic-info-001"
            }
          },
          board: {},
          note: {}
        }),
        fetchJson
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home basic_info fallback failure envelope");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "captured_request_context"
      }
    });
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
    });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("uses detail page-state fallback when feed api is blocked but note state is still present", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-fallback-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-fallback-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-001",
        getPageStateRoot: () => null,
        readCapturedRequestContext: createRequestContextReader(createDetailRequestContext("note-001")),
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

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected detail fallback failure envelope");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "账号异常，平台拒绝当前请求"
    });
    expect(result.payload.observability).toMatchObject({
      page_state: {
        page_kind: "detail",
        fallback_used: true
      },
      failure_site: {
        target: "/api/sns/web/v1/feed"
      }
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
          fallback_reason: "ACCOUNT_ABNORMAL",
          data_ref: {
            note_id: "note-001"
          }
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
        options: createAdmittedLiveReadOptions({
          runId: "run-user-fallback-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-fallback-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        getPageStateRoot: () => null,
        readCapturedRequestContext: createRequestContextReader(createUserHomeRequestContext("user-001")),
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

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected user_home fallback failure envelope");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "浏览器环境异常，平台拒绝当前请求"
    });
    expect(result.payload.observability).toMatchObject({
      page_state: {
        page_kind: "user_home",
        fallback_used: true
      },
      failure_site: {
        target: "/api/sns/web/v1/user/otherinfo"
      }
    });
  });

  it("uses detail page-state fallback when signature entry is unavailable but note state is still present", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-signature-fallback-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-signature-fallback-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-signature-fallback-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-signature-fallback-001",
        readCapturedRequestContext: createRequestContextReader(
          createDetailRequestContext("note-signature-fallback-001")
        ),
        readPageStateRoot: async () => ({
          note: {
            noteDetailMap: {
              "note-signature-fallback-001": {
                noteId: "note-signature-fallback-001"
              }
            }
          }
        }),
        callSignature: async () => {
          throw new Error("window._webmsxyw is not a function");
        }
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected signature fallback failure envelope");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "页面签名入口不可用"
    });
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "window._webmsxyw"
      }
    });
    expect((result.payload.observability as Record<string, unknown>).key_requests).toEqual([
      expect.objectContaining({
        stage: "page_state_fallback",
        outcome: "completed",
        fallback_reason: "SIGNATURE_ENTRY_MISSING"
      })
    ]);
  });

  it("projects simulated signature-entry failures with page-change semantics for xhs.detail", async () => {
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-simulated-signature-001"
        },
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-simulated-signature-001",
          targetPage: "explore_detail_tab",
          overrides: {
            simulate_result: "signature_entry_missing"
          }
        }),
        executionContext: createFallbackExecutionContext("run-detail-simulated-signature-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-simulated-signature-001"
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected simulated signature-entry failure");
    }
    expect(result.error).toMatchObject({
      code: "ERR_EXECUTION_FAILED",
      message: "页面签名入口不可用"
    });
    expect(result.payload.details).toMatchObject({
      reason: "SIGNATURE_ENTRY_MISSING"
    });
    expect(result.payload.diagnosis).toMatchObject({
      category: "page_changed",
      failure_site: {
        target: "window._webmsxyw"
      }
    });
  });

  it("keeps simulated read failures bound to the real audit run/session/profile", async () => {
    const runId = "run-detail-simulated-failure-001";
    const result = await executeXhsDetail(
      {
        abilityId: "xhs.note.detail.v1",
        abilityLayer: "L3",
        abilityAction: "read",
        params: {
          note_id: "note-simulated-failure-001"
        },
        options: createAdmittedLiveReadOptions({
          runId,
          targetPage: "explore_detail_tab",
          overrides: {
            simulate_result: "gateway_invoker_failed"
          }
        }),
        executionContext: createFallbackExecutionContext(runId)
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-simulated-failure-001"
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected simulated read failure");
    }
    expect(result.payload.gate_input).toMatchObject({
      run_id: runId,
      session_id: "nm-session-001",
      profile: "xhs_001"
    });
    expect(result.payload.audit_record).toMatchObject({
      run_id: runId,
      session_id: "nm-session-001",
      profile: "xhs_001"
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
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-no-fallback-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-no-fallback-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/explore/note-404",
        readCapturedRequestContext: createRequestContextReader(createDetailRequestContext("note-404")),
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

  it("falls back to sync page-state hook when request context is missing and readPageStateRoot is absent", async () => {
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
        options: createAdmittedLiveReadOptions({
          runId: "run-detail-sync-fallback-001",
          targetPage: "explore_detail_tab"
        }),
        executionContext: createFallbackExecutionContext("run-detail-sync-fallback-001")
      },
      environment
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected sync fallback failure envelope");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      }
    });
    expect(result.payload.details).toMatchObject({
      reason: "REQUEST_CONTEXT_MISSING",
      request_context_result: "request_context_missing",
      request_context_lookup_state: "miss",
      request_context_miss_reason: "template_missing"
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
        options: createAdmittedLiveReadOptions({
          runId: "run-user-mismatch-001",
          targetPage: "profile_tab"
        }),
        executionContext: createFallbackExecutionContext("run-user-mismatch-001")
      },
      createEnvironment({
        getLocationHref: () => "https://www.xiaohongshu.com/user/profile/user-001",
        getPageStateRoot: () => null,
        readCapturedRequestContext: createRequestContextReader(createUserHomeRequestContext("user-001")),
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
