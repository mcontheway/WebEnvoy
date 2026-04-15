import { describe, expect, it } from "vitest";

import { ContentScriptHandler, type BackgroundToContentMessage } from "../extension/content-script-handler.js";

const approvedLiveOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "explore_detail_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  approval_record: {
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
  admission_context: {
    approval_admission_evidence: {
      approval_admission_ref: "gate_appr_content_read_001",
      run_id: "run-contract-001",
      session_id: "nm-session-001",
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "explore_detail_tab",
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
      audit_admission_ref: "gate_evt_content_read_001",
      run_id: "run-contract-001",
      session_id: "nm-session-001",
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "explore_detail_tab",
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
  },
  audit_record: {
    event_id: "audit-content-read-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "explore_detail_tab",
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    gate_decision: "allowed",
    recorded_at: "2026-03-23T10:00:30Z"
  }
} as const;

const anonymousReadOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "explore_detail_tab",
  action_type: "read",
  requested_execution_mode: "dry_run",
  upstream_authorization_request: {
    action_request: {
      request_ref: "upstream-anon-read-001",
      action_name: "xhs.read_note_detail",
      action_category: "read"
    },
    resource_binding: {
      binding_ref: "binding-anon-read-001",
      resource_kind: "anonymous_context",
      profile_ref: null,
      binding_constraints: {
        anonymous_required: true,
        reuse_logged_in_context_forbidden: true
      }
    },
    authorization_grant: {
      grant_ref: "grant-anon-read-001",
      allowed_actions: ["xhs.read_note_detail"],
      binding_scope: {
        allowed_resource_kinds: ["anonymous_context"],
        allowed_profile_refs: []
      },
      target_scope: {
        allowed_domains: ["www.xiaohongshu.com"],
        allowed_pages: ["explore_detail_tab"]
      },
      approval_refs: [],
      audit_refs: [],
      resource_state_snapshot: "paused"
    },
    runtime_target: {
      target_ref: "target-anon-read-001",
      domain: "www.xiaohongshu.com",
      page: "explore_detail_tab",
      tab_id: 32,
      url: "https://www.xiaohongshu.com/explore/abc123"
    }
  }
} as const;

const waitForSingleResult = (handler: ContentScriptHandler) =>
  new Promise<Record<string, unknown>>((resolve, reject) => {
    const timeout = setTimeout(() => {
      off();
      reject(new Error("did not receive content-script result"));
    }, 500);
    const off = handler.onResult((message) => {
      clearTimeout(timeout);
      off();
      resolve(message as unknown as Record<string, unknown>);
    });
  });

const createMessage = (input: {
  command: "xhs.detail" | "xhs.user_home";
  abilityId: string;
  targetPage: "explore_detail_tab" | "profile_tab";
  href: string;
  payload: Record<string, unknown>;
  cookie?: string;
  options?: Record<string, unknown>;
}): {
  handler: ContentScriptHandler;
  message: BackgroundToContentMessage;
} => {
  const handler = new ContentScriptHandler({
    xhsEnv: {
      now: () => Date.now(),
      randomId: () => "req-contract-001",
      getLocationHref: () => input.href,
      getDocumentTitle: () => "contract-title",
      getReadyState: () => "complete",
      getCookie: () => input.cookie ?? "a1=session-cookie",
      callSignature: async () => ({
        "X-s": "signature",
        "X-t": "timestamp"
      }),
      fetchJson: async () => ({
        status: 200,
        body: {
          code: 0
        }
      })
    }
  });

  return {
    handler,
    message: {
      kind: "forward",
      id: `msg-${input.command}`,
      runId: "run-contract-001",
      tabId: 32,
      profile: "xhs_001",
      cwd: "/tmp/webenvoy",
      timeoutMs: 3_000,
      command: input.command,
      params: {
        session_id: "nm-session-001"
      },
      commandParams: {
        request_id: "req-contract-001",
        gate_invocation_id: `issue209-gate-${input.command}-001`,
        ability: {
          id: input.abilityId,
          layer: "L3",
          action: "read"
        },
        input: input.payload,
        options: {
          ...approvedLiveOptions,
          ...(input.options ?? {}),
          target_page: input.targetPage,
          audit_record: {
            ...(approvedLiveOptions.audit_record),
            target_page: input.targetPage
          },
          admission_context: {
            approval_admission_evidence: {
              ...(approvedLiveOptions.admission_context.approval_admission_evidence),
              target_page: input.targetPage
            },
            audit_admission_evidence: {
              ...(approvedLiveOptions.admission_context.audit_admission_evidence),
              target_page: input.targetPage
            }
          },
          simulate_result: "success"
        }
      }
    }
  };
};

describe("content-script handler xhs read commands", () => {
  it("routes xhs.detail through the unified xhs read execution path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .capability_result as Record<string, unknown>).ability_id
    ).toBe("xhs.note.detail.v1");
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .execution_audit as Record<string, unknown> | null)
    ).toBeNull();
  });

  it("routes xhs.user_home through the unified xhs read execution path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      targetPage: "profile_tab",
      href: "https://www.xiaohongshu.com/user/profile/user-001",
      payload: {
        user_id: "user-001"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result.ok).toBe(true);
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .capability_result as Record<string, unknown>).ability_id
    ).toBe("xhs.user.home.v1");
    expect(
      (((result.payload as Record<string, unknown>).summary as Record<string, unknown>)
        .execution_audit as Record<string, unknown> | null)
    ).toBeNull();
  });

  it("admits anonymous_context on the extension path when the target site is actually logged out", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      cookie: "",
      options: anonymousReadOptions as unknown as Record<string, unknown>,
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const summary = ((result.payload as Record<string, unknown>).summary ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(true);
    expect((summary.request_admission_result as Record<string, unknown>).admission_decision).toBe(
      "allowed"
    );
    expect(summary.execution_audit).toBeNull();
  });

  it("does not trust caller-supplied anonymous override flags when the target site is actually logged in", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      cookie: "a1=session-cookie",
      options: {
        ...anonymousReadOptions,
        __anonymous_isolation_verified: true,
        target_site_logged_in: false
      } as Record<string, unknown>,
      payload: {
        note_id: "abc123"
      }
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;
    const payload = (result.payload ?? {}) as Record<string, unknown>;
    const details = (payload.details ?? {}) as Record<string, unknown>;
    const requestAdmissionResult = (payload.request_admission_result ?? {}) as Record<string, unknown>;

    expect(result.ok).toBe(false);
    expect(details.reason).toBe("EXECUTION_MODE_GATE_BLOCKED");
    expect(requestAdmissionResult.admission_decision).toBe("blocked");
    expect(payload.execution_audit).toBeNull();
  });

  it("rejects xhs.detail when note_id is missing on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      targetPage: "explore_detail_tab",
      href: "https://www.xiaohongshu.com/explore/abc123",
      payload: {}
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
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

  it("rejects xhs.user_home when user_id is missing on the extension path", async () => {
    const { handler, message } = createMessage({
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      targetPage: "profile_tab",
      href: "https://www.xiaohongshu.com/user/profile/user-001",
      payload: {}
    });

    const resultPromise = waitForSingleResult(handler);
    expect(handler.onBackgroundMessage(message)).toBe(true);
    const result = await resultPromise;

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "ERR_CLI_INVALID_ARGS"
      },
      payload: {
        details: {
          reason: "USER_ID_MISSING"
        }
      }
    });
  });
});
