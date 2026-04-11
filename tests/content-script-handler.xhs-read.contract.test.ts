import { describe, expect, it } from "vitest";

import { ContentScriptHandler, type BackgroundToContentMessage } from "../extension/content-script-handler.js";

const approvedLiveOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
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
      getCookie: () => "a1=session-cookie",
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
        ability: {
          id: input.abilityId,
          layer: "L3",
          action: "read"
        },
        input: input.payload,
        options: {
          ...approvedLiveOptions,
          target_page: input.targetPage,
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
