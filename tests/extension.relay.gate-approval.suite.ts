import { describe, expect, it, vi } from "vitest";
import { waitForResponse, asRecord, resolveWriteInteractionTier, completeIssue208ApprovalRecord, createAttestedEditorInputValidationResult, createApprovedReadAdmissionContext, approvedHighRiskLimitedOptions, BackgroundRelay, ContentScriptHandler, type BridgeResponse } from "./extension.relay.shared.js";

describe("extension background relay contract / gate and approval", () => {
  const limitedRunId = "run-xhs-live-limited-allowed-001";
  const limitedRequestId = "issue209-relay-live-limited-allowed-001";
  const approvedLimitedLiveOptions = {
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: "live_read_limited",
    risk_state: "limited",
    approval: {
      approved: true,
      approver: "reviewer-a",
      approved_at: "2026-03-23T08:00:00Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    },
    limited_read_rollout_ready_true: true,
    admission_context: createApprovedReadAdmissionContext({
      run_id: limitedRunId,
      request_id: limitedRequestId,
      session_id: "nm-session-001",
      requested_execution_mode: "live_read_limited",
      risk_state: "limited"
    }),
    audit_record: {
      event_id: "gate_evt_forward-xhs-live-limited-allowed-001",
      decision_id: `gate_decision_${limitedRunId}_${limitedRequestId}`,
      approval_id: `gate_appr_gate_decision_${limitedRunId}_${limitedRequestId}`,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "live_read_limited",
      gate_decision: "allowed",
      recorded_at: "2026-03-23T08:00:30Z"
    }
  };

  it("blocks xhs.search when execution mode is omitted", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-default-recon-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("omitted execution mode should not hit live fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-default-recon-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-default-recon-001",
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
            action_type: "read"
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
      scope_context: {
        platform: "xhs",
        read_domain: "www.xiaohongshu.com",
        write_domain: "creator.xiaohongshu.com",
        domain_mixing_forbidden: true
      },
      gate_input: {
        run_id: "run-xhs-default-recon-001",
        session_id: "nm-session-001",
        profile: "profile-a",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: null,
        risk_state: "paused"
      },
      gate_outcome: {
        effective_execution_mode: null,
        gate_decision: "blocked",
        gate_reasons: ["REQUESTED_EXECUTION_MODE_NOT_EXPLICIT"],
        requires_manual_confirmation: false
      },
      consumer_gate_result: {
        requested_execution_mode: null,
        effective_execution_mode: null,
        gate_decision: "blocked",
        gate_reasons: ["REQUESTED_EXECUTION_MODE_NOT_EXPLICIT"]
      }
    });
  });

  it("blocks live_read_high_risk without approval and exposes consumer_gate_result", async () => {
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
          throw new Error("blocked live mode should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });
    const approvedLimitedLiveOptions = {
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "live_read_limited",
      risk_state: "limited",
      approval: {
        approved: true,
        approver: "reviewer-a",
        approved_at: "2026-03-23T08:00:00Z",
        checks: {
          target_domain_confirmed: true,
          target_tab_confirmed: true,
          target_page_confirmed: true,
          risk_state_checked: true,
          action_type_confirmed: true
        }
      },
      limited_read_rollout_ready_true: true,
      audit_record: {
        event_id: "gate_evt_forward-xhs-live-limited-allowed-001",
        decision_id:
          "gate_decision_run-xhs-live-limited-allowed-001_forward-xhs-live-limited-allowed-001",
        approval_id:
          "gate_appr_gate_decision_run-xhs-live-limited-allowed-001_forward-xhs-live-limited-allowed-001",
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        gate_decision: "allowed",
        recorded_at: "2026-03-23T08:00:30Z"
      }
    };

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-gate-blocked-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-gate-blocked-001",
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
      scope_context: {
        platform: "xhs",
        read_domain: "www.xiaohongshu.com",
        write_domain: "creator.xiaohongshu.com",
        domain_mixing_forbidden: true
      },
      gate_input: {
        run_id: "run-xhs-gate-blocked-001",
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
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        gate_reasons: [
          "MANUAL_CONFIRMATION_MISSING",
          "APPROVAL_CHECKS_INCOMPLETE",
          "AUDIT_RECORD_MISSING"
        ],
        requires_manual_confirmation: true
      },
      consumer_gate_result: {
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        gate_reasons: [
          "MANUAL_CONFIRMATION_MISSING",
          "APPROVAL_CHECKS_INCOMPLETE",
          "AUDIT_RECORD_MISSING"
        ]
      }
    });
  });

  it("blocks live_read_limited when risk_state is paused", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-limited-paused-id",
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
      id: "forward-xhs-live-limited-paused-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-limited-paused-001",
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
            ...approvedLimitedLiveOptions,
            risk_state: "paused"
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
      gate_input: {
        requested_execution_mode: "live_read_limited",
        risk_state: "paused"
      },
      gate_outcome: {
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      },
      consumer_gate_result: {
        requested_execution_mode: "live_read_limited",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["RISK_STATE_PAUSED", "ISSUE_ACTION_MATRIX_BLOCKED"]));
    expect(fetchCalled).toBe(false);
  });

  it("allows live_read_limited with approval in limited risk state", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-limited-allowed-id",
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
      id: "forward-xhs-live-limited-allowed-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: limitedRunId,
        command: "xhs.search",
        command_params: {
          request_id: limitedRequestId,
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
          options: approvedLimitedLiveOptions
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
        gate_input: {
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        }
      }
    });
  });

  it("blocks live_read_high_risk in limited risk state and falls back to recon", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-high-risk-limited-id",
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
      id: "forward-xhs-live-high-risk-limited-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-high-risk-limited-001",
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
          options: approvedHighRiskLimitedOptions
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
      gate_input: {
        requested_execution_mode: "live_read_high_risk",
        risk_state: "limited"
      },
      gate_outcome: {
        effective_execution_mode: "recon",
        gate_decision: "blocked"
      },
      consumer_gate_result: {
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "recon",
        gate_decision: "blocked"
      }
    });
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["RISK_STATE_LIMITED", "ISSUE_ACTION_MATRIX_BLOCKED"]));
    expect(fetchCalled).toBe(false);
  });

  it("blocks xhs.search when target scope is missing even in dry_run", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-missing-target-scope-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("blocked target scope should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-missing-target-scope-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-target-scope-001",
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
          options: {}
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
        gate_decision: "blocked"
      }
    });
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "TARGET_DOMAIN_NOT_EXPLICIT",
        "TARGET_TAB_NOT_EXPLICIT",
        "TARGET_PAGE_NOT_EXPLICIT"
      ])
    );
  });

  it("blocks live_write when action_type is omitted even if ability.action is write", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-write-action-mismatch-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("blocked action mismatch should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-write-action-mismatch-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-write-action-mismatch-001",
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
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "live_write",
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
      scope_context: {
        platform: "xhs",
        read_domain: "www.xiaohongshu.com",
        write_domain: "creator.xiaohongshu.com",
        domain_mixing_forbidden: true
      },
      gate_input: {
        run_id: "run-xhs-live-write-action-mismatch-001",
        session_id: "nm-session-001",
        profile: "profile-a",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: null,
        requested_execution_mode: "live_write",
        risk_state: "allowed"
      },
      gate_outcome: {
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        requires_manual_confirmation: true
      },
      consumer_gate_result: {
        requested_execution_mode: "live_write",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        write_interaction_tier: null
      },
      write_action_matrix_decisions: null
    });
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
  });

  it("blocks live_write because xhs.search is a read-only command", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-write-readonly-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("read-only command should not hit live write fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-write-readonly-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-write-readonly-001",
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
            action_type: "write",
            requested_execution_mode: "live_write",
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
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
  });

  it("blocks when ability.action diverges from the approved gate action", async () => {
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-ability-action-mismatch-id",
        getLocationHref: () => "https://www.xiaohongshu.com/search_result",
        getDocumentTitle: () => "Search Result",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          throw new Error("ability action mismatch should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-ability-action-mismatch-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-ability-action-mismatch-001",
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
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
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
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      profile: "profile-a",
      timeout_ms: 200
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["ABILITY_ACTION_CONTEXT_MISMATCH"]));
  });

  it("blocks live_write when action_type is irreversible_write even with approval", async () => {
    let fetchCalled = false;
    const contentScript = new ContentScriptHandler({
      xhsEnv: {
        now: () => 1_000,
        randomId: () => "relay-live-write-irreversible-id",
        getLocationHref: () => "https://creator.xiaohongshu.com/publish",
        getDocumentTitle: () => "Creator Publish",
        getReadyState: () => "complete",
        getCookie: () => "a1=valid;",
        callSignature: async () => ({
          "X-s": "signed",
          "X-t": "1"
        }),
        fetchJson: async () => {
          fetchCalled = true;
          throw new Error("irreversible live_write should not hit fetch");
        }
      }
    });
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 200 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-xhs-live-write-irreversible-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-write-irreversible-001",
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
            action_type: "irreversible_write",
            requested_execution_mode: "live_write",
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
      gate_input: {
        run_id: "run-xhs-live-write-irreversible-001",
        session_id: "nm-session-001",
        profile: "profile-a",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "creator_publish_tab",
        action_type: "irreversible_write",
        requested_execution_mode: "live_write",
        risk_state: "allowed"
      },
      gate_outcome: {
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        requires_manual_confirmation: true
      },
      consumer_gate_result: {
        requested_execution_mode: "live_write",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked"
      }
    });
    expect(
      (((response.payload as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
        .gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "ABILITY_ACTION_CONTEXT_MISMATCH",
        "IRREVERSIBLE_WRITE_NOT_ALLOWED",
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
    expect(fetchCalled).toBe(false);
  });

});
