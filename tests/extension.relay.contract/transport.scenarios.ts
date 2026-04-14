import "../extension.relay.contract.shared.js";

const ctx = (globalThis as { __webenvoyExtensionRelayContract: Record<string, any> }).__webenvoyExtensionRelayContract;
const {
  describe,
  expect,
  it,
  BackgroundRelay,
  ContentScriptHandler,
  waitForResponse,
  approvedLiveOptions,
  asRecord,
  createApprovedReadAdmissionContext,
  createApprovedReadAuditRecord
} = ctx;

describe("extension background relay contract / transport", () => {
  it("keeps run/profile/cwd context on successful forward", async () => {
    const contentScript = new ContentScriptHandler();
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 20 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-context-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-context-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a"
    });

    const response = await responsePromise;
    expect(response.status).toBe("success");
    expect(response.summary).toMatchObject({
      run_id: "run-context-001",
      profile: "profile-a",
      cwd: "/workspace/WebEnvoy",
      relay_path: "host>background>content-script>background>host"
    });
  });

  it("returns ERR_TRANSPORT_FORWARD_FAILED when content script is unreachable", async () => {
    const contentScript = new ContentScriptHandler();
    contentScript.setReachable(false);
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 20 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-unreachable-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-001",
        command: "runtime.ping",
        command_params: {}
      },
      profile: "profile-a"
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_TRANSPORT_FORWARD_FAILED");
  });

  it("returns ERR_TRANSPORT_TIMEOUT when content script does not respond", async () => {
    const contentScript = new ContentScriptHandler();
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 3_000 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-timeout-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-002",
        command: "runtime.ping",
        command_params: {
          simulate_no_response: true
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 10
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_TRANSPORT_TIMEOUT");
  });

  it("passes xhs.search execution payload through relay on error", async () => {
    let capturedHeaders: Record<string, string> | null = null;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-test-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async (request) => {
          capturedHeaders = request.headers;
          return {
            status: 200,
            body: {
              code: 300011,
              msg: "Account abnormal. Switch account and retry."
            }
          };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    const requestId = "issue209-relay-account-abnormal-001";
    relay.onNativeRequest({
      id: "forward-xhs-error-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-error-001",
        command: "xhs.search",
        command_params: {
          request_id: requestId,
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            ...approvedLiveOptions,
            admission_context: createApprovedReadAdmissionContext({
              run_id: "run-xhs-error-001",
              request_id: requestId
            }),
            audit_record: createApprovedReadAuditRecord({
              run_id: "run-xhs-error-001",
              request_id: requestId
            })
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_EXECUTION_FAILED");
    expect(response.payload).toMatchObject({
      details: {
        reason: "ACCOUNT_ABNORMAL"
      },
      observability: {
        failure_site: {
          target: "/api/sns/web/v1/search/notes"
        }
      }
    });
    expect(capturedHeaders?.["X-S-Common"]).toBe("{}");
  });

  it.each([
    {
      simulateResult: "login_required",
      reason: "SESSION_EXPIRED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "browser_env_abnormal",
      reason: "BROWSER_ENV_ABNORMAL",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "gateway_invoker_failed",
      reason: "GATEWAY_INVOKER_FAILED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "signature_entry_missing",
      reason: "SIGNATURE_ENTRY_MISSING",
      category: "page_changed",
      failureTarget: "window._webmsxyw",
      failureStage: "action",
      keyRequestCount: 0
    }
  ])(
    "returns structured xhs.search failure for $simulateResult at relay layer",
    async ({
      simulateResult,
      reason,
      category,
      failureTarget,
      failureStage,
      keyRequestCount
    }) => {
      const requestId = `issue209-relay-${simulateResult}-001`;
      const runId = `run-xhs-${simulateResult}-001`;
      const contentScript = new ContentScriptHandler({
        xhsEnv: {
          now: () => 1_000,
          randomId: () => `relay-${simulateResult}-id`,
          getLocationHref: () => "https://www.xiaohongshu.com/search_result",
          getDocumentTitle: () => "Search Result",
          getReadyState: () => "complete",
          getCookie: () => "a1=valid;",
          callSignature: async () => ({
            "X-s": "signed",
            "X-t": "1"
          }),
          fetchJson: async () => ({
            status: 200,
            body: {
              code: 0,
              data: { items: [] }
            }
          })
        }
      });
      const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

      const responsePromise = waitForResponse(relay);
      relay.onNativeRequest({
        id: `forward-xhs-${simulateResult}-001`,
        method: "bridge.forward",
        params: {
          session_id: "nm-session-001",
          run_id: runId,
          command: "xhs.search",
          command_params: {
            request_id: requestId,
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营装备"
            },
            options: {
              ...approvedLiveOptions,
              admission_context: createApprovedReadAdmissionContext({
                run_id: runId,
                request_id: requestId
              }),
              audit_record: createApprovedReadAuditRecord({
                run_id: runId,
                request_id: requestId
              }),
              simulate_result: simulateResult
            }
          },
          cwd: "/workspace/WebEnvoy"
        },
        profile: "profile-a",
        timeout_ms: 200
      });

      const response = await responsePromise;
      expect(response.status).toBe("error");
      const payload = asRecord(response.payload) ?? {};
      const observability = asRecord(payload.observability) ?? {};
      const failureSite = asRecord(observability.failure_site) ?? {};
      const diagnosis = asRecord(payload.diagnosis) ?? {};
      const keyRequests = Array.isArray(observability.key_requests)
        ? (observability.key_requests as Array<Record<string, unknown>>)
        : [];

      expect(payload).toMatchObject({
        details: {
          reason
        },
        diagnosis: {
          category
        }
      });
      expect((asRecord(diagnosis.failure_site) ?? {}).target).toBe(failureTarget);
      expect(failureSite.target).toBe(failureTarget);
      expect(failureSite.stage).toBe(failureStage);
      expect(keyRequests).toHaveLength(keyRequestCount);
    }
  );

});
