import "../extension.relay.contract.shared.js";

const ctx = (globalThis as { __webenvoyExtensionRelayContract: Record<string, any> }).__webenvoyExtensionRelayContract;
const {
  describe,
  expect,
  it,
  BackgroundRelay,
  ContentScriptHandler,
  waitForResponse,
  asRecord,
  approvedLiveOptions,
  createApprovedReadAdmissionContext,
  createApprovedReadAuditRecord
} = ctx;

describe("extension background relay contract / live approval and timeouts", () => {
  it("returns structured payload when xhs.search request times out", async () => {
    const runId = "run-xhs-timeout-001";
    const requestId = "issue209-relay-timeout-001";
    const timeoutError = new Error("request timeout");
    timeoutError.name = "AbortError";
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-timeout-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw timeoutError;
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-timeout-001",
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
        reason: "REQUEST_TIMEOUT"
      },
      diagnosis: {
        category: "request_failed"
      },
      observability: {
        failure_site: {
          target: "/api/sns/web/v1/search/notes"
        }
      }
    });
  });

  it("blocks live_read_high_risk without manual approval in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-gate-blocked-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed"
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
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
    expect(fetchCalled).toBe(false);
  });

  it("blocks issue_209 write live_read_limited with fallback mode in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue209-write-limited-blocked-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue209-write-limited-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-limited-blocked-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_209",
            action_type: "write",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
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
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        issue_scope: "issue_209",
        action_type: "write",
        requested_execution_mode: "live_read_limited",
        effective_execution_mode: "recon",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_LIMITED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(fetchCalled).toBe(false);
  });

  it("blocks issue_209 write live_read_high_risk with fallback mode in relay path", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-issue209-write-live-blocked-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish/publish",
        getDocumentTitle: () => "Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          return { status: 200, body: { code: 0, data: { items: [] } } };
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-issue209-write-live-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-live-blocked-001",
        command: "xhs.search",
        command_params: {
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_209",
            action_type: "write",
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
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      consumer_gate_result: {
        issue_scope: "issue_209",
        action_type: "write",
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      ((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[]
    ).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_ALLOWED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(fetchCalled).toBe(false);
  });

  it("allows live_read_high_risk with approval and returns consumer gate result", async () => {
    const runId = "run-xhs-live-allowed-001";
    const requestId = "issue209-relay-live-high-risk-allowed-001";
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-gate-allowed-id",
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
            data: {
              items: []
            }
          }
        })
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-allowed-001",
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
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            admission_context: createApprovedReadAdmissionContext({
              run_id: runId,
              request_id: requestId
            }),
            audit_record: createApprovedReadAuditRecord({
              run_id: runId,
              request_id: requestId
            }),
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
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("success");
    expect(response.payload).toMatchObject({
      summary: {
        scope_context: {
          platform: "xhs",
          read_domain: "www.xiaohongshu.com",
          write_domain: "creator.xiaohongshu.com",
          domain_mixing_forbidden: true
        },
        gate_input: {
          run_id: "run-xhs-live-allowed-001",
          session_id: "nm-session-001",
          profile: "profile-a",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        read_execution_policy: {
          default_mode: "dry_run",
          allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
          blocked_actions: ["expand_new_live_surface_without_gate"]
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        approval_record: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z"
        },
        audit_record: {
          run_id: "run-xhs-live-allowed-001",
          session_id: "nm-session-001",
          profile: "profile-a",
          risk_state: "allowed",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z",
          risk_signal: false,
          recovery_signal: false,
          session_rhythm_state: "normal",
          cooldown_until: null,
          recovery_started_at: null
        }
      }
    });
    expect(
      typeof (((response.payload as Record<string, unknown>).summary as Record<string, unknown>).audit_record as Record<string, unknown>).event_id
    ).toBe("string");
    expect(
      typeof (((response.payload as Record<string, unknown>).summary as Record<string, unknown>).audit_record as Record<string, unknown>).recorded_at
    ).toBe("string");
  });
});
