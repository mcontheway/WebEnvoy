import { describe, expect, it, vi } from "vitest";

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
        fetchJson
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
        fetchJson
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

  it("uses detail page-state fallback when a 200 payload omits the requested note", async () => {
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
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: [
                {
                  note_card: {
                    noteId: "different-note"
                  }
                }
              ]
            }
          }
        })
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
        target: "/api/sns/web/v1/feed"
      }
    });
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

  it("uses user_home page-state fallback when a 200 payload omits the requested user", async () => {
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
            userId: "user-fallback-target-missing-001"
          },
          board: {},
          note: {}
        }),
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
      throw new Error("expected user_home fallback failure envelope");
    }
    expect(result.payload.observability).toMatchObject({
      page_state: {
        fallback_used: true
      },
      failure_site: {
        target: "/api/sns/web/v1/user/otherinfo"
      }
    });
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
        target: "/api/sns/web/v1/feed"
      }
    });
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
