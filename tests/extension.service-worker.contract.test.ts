import { describe, expect, it, vi } from "vitest";

import { startChromeBackgroundBridge } from "../extension/background.js";

const createMockPort = () => {
  const onMessageListeners: Array<(message: Record<string, unknown>) => void> = [];
  const onDisconnectListeners: Array<() => void> = [];
  const postMessage = vi.fn();

  return {
    postMessage,
    onMessageListeners,
    onDisconnectListeners,
    port: {
      postMessage,
      onMessage: {
        addListener: (listener: (message: Record<string, unknown>) => void) => {
          onMessageListeners.push(listener);
        }
      },
      onDisconnect: {
        addListener: (listener: () => void) => {
          onDisconnectListeners.push(listener);
        }
      },
      disconnect: vi.fn()
    }
  };
};

const createChromeApi = (ports: ReturnType<typeof createMockPort>[]) => {
  let connectIndex = 0;
  const runtimeMessageListeners: Array<
    (message: unknown, sender: { tab?: { id?: number } }) => void
  > = [];
  const chromeApi = {
    runtime: {
      connectNative: vi.fn(() => {
        const current = ports[Math.min(connectIndex, ports.length - 1)];
        connectIndex += 1;
        return current.port;
      }),
      onMessage: {
        addListener: (listener: (message: unknown, sender: { tab?: { id?: number } }) => void) => {
          runtimeMessageListeners.push(listener);
        }
      },
      onInstalled: {
        addListener: vi.fn()
      },
      onStartup: {
        addListener: vi.fn()
      }
    },
    tabs: {
      query: vi.fn(async () => [{ id: 11 }]),
      sendMessage: vi.fn(async () => {})
    }
  };

  return {
    chromeApi,
    runtimeMessageListeners
  };
};

const respondHandshake = (
  mockPort: ReturnType<typeof createMockPort>,
  options?: { protocol?: string; sessionId?: string }
) => {
  const protocol = options?.protocol ?? "webenvoy.native-bridge.v1";
  const sessionId = options?.sessionId ?? "nm-session-001";
  const handshakeCall = mockPort.postMessage.mock.calls.find(
    (call) => (call[0] as { method?: string }).method === "bridge.open"
  );
  expect(handshakeCall).toBeDefined();
  const handshakeId = String((handshakeCall?.[0] as { id: string }).id);
  mockPort.onMessageListeners[0]?.({
    id: handshakeId,
    status: "success",
    summary: {
      protocol,
      session_id: sessionId,
      state: "ready"
    },
    error: null
  });
};

const createXhsCommandParams = (overrides?: Record<string, unknown>) => ({
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  risk_state: "paused",
  requested_execution_mode: "dry_run",
  ...overrides
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveWriteInteractionTier = (payload: Record<string, unknown>): string | null => {
  const direct = payload.write_interaction_tier;
  if (typeof direct === "string") {
    return direct;
  }
  const consumerGateResult = asRecord(payload.consumer_gate_result);
  if (typeof consumerGateResult?.write_interaction_tier === "string") {
    return consumerGateResult.write_interaction_tier;
  }
  const writeActionMatrix = asRecord(payload.write_action_matrix);
  if (typeof writeActionMatrix?.write_interaction_tier === "string") {
    return writeActionMatrix.write_interaction_tier;
  }
  const writeActionMatrixDecisions = asRecord(payload.write_action_matrix_decisions);
  if (typeof writeActionMatrixDecisions?.write_interaction_tier === "string") {
    return writeActionMatrixDecisions.write_interaction_tier;
  }
  return null;
};

describe("extension service worker recovery contract", () => {
  it("rejects mismatched protocol on bridge.open and does not enter ready", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    respondHandshake(firstPort, {
      protocol: "webenvoy.native-bridge.v0"
    });
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-after-bad-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-after-bad-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    const retryHandshakeCall = firstPort.postMessage.mock.calls.findLast(
      (call) => (call[0] as { method?: string }).method === "bridge.open"
    );
    expect(retryHandshakeCall).toBeDefined();
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards only after open handshake", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    firstPort.onMessageListeners[0]?.({
      id: "run-before-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-before-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });
    await Promise.resolve();

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-before-open-001",
        status: "error",
        error: expect.objectContaining({
          code: "ERR_TRANSPORT_NOT_READY"
        })
      })
    );
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-after-open-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-after-open-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-after-open-001"
      })
    );
  });

  it("forwards content-script error payload through background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-error-payload-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-error-payload-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-error-payload-001",
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "登录态缺失，无法执行 xhs.search"
        },
        payload: {
          details: {
            reason: "SESSION_EXPIRED"
          },
          diagnosis: {
            category: "request_failed"
          }
        }
      },
      {
        tab: {
          id: 11
        }
      }
    );
    await Promise.resolve();

    const forwardedError = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-error-payload-001");
    expect(forwardedError).toMatchObject({
      id: "run-xhs-error-payload-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          issue_scope: "issue_209",
          risk_state: "paused"
        },
        details: {
          reason: "SESSION_EXPIRED"
        },
        diagnosis: {
          category: "request_failed"
        }
      }
    });
  });

  it("pins xhs.search to xiaohongshu tab instead of generic active tab", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { active?: boolean; url?: string | string[] }) => {
      if (filter.url) {
        return [
          { id: 44, url: "https://www.xiaohongshu.com/home", active: true },
          { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
          { id: 52, url: "https://www.xiaohongshu.com/explore/abc", active: false }
        ];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-tab-pin-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-tab-pin-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-tab-pin-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-tab-pin-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success"
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const forwarded = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-tab-pin-001");
    expect(forwarded).toMatchObject({
      id: "run-xhs-tab-pin-001",
      status: "success",
      payload: {
        summary: {
          consumer_gate_result: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "dry_run",
            effective_execution_mode: "dry_run",
            gate_decision: "allowed",
            issue_scope: "issue_209",
            risk_state: "paused"
          }
        }
      }
    });
  });

  it("accepts real xhs.search payload shape and reads target gate fields from options", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { url?: string | string[] }) => {
      if (filter.url) {
        return [
          { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
          { id: 44, url: "https://www.xiaohongshu.com/home", active: true }
        ];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-options-shape-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-options-shape-001",
        command: "xhs.search",
        command_params: {
          ability: { id: "xhs.search.notes.v1", layer: "L3", action: "read" },
          input: { query: "露营" },
          options: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "dry_run"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-options-shape-001",
        command: "xhs.search"
      })
    );
  });

  it("allows explicit target tab in another window", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(
      async (filter: { currentWindow?: boolean; url?: string | string[] }) => {
        if (filter.url) {
          expect(filter.url).toBe("*://www.xiaohongshu.com/*");
          expect(filter.currentWindow).toBeUndefined();
          return [
            {
              id: 77,
              url: "https://www.xiaohongshu.com/search_result?keyword=跨窗口",
              active: false
            }
          ];
        }
        return [{ id: 11 }];
      }
    );

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-cross-window-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-cross-window-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_tab_id: 77
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      77,
      expect.objectContaining({
        id: "run-xhs-cross-window-tab-001",
        command: "xhs.search"
      })
    );
  });

  it("returns target-tab-unavailable when no xhs candidate tab exists", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { url?: string | string[] }) => {
      if (filter.url) {
        return [];
      }
      return [{ id: 11 }];
    });

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-no-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-no-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const forwardResult = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; error?: { code?: string; message?: string } })
      .find((message) => message.id === "run-xhs-no-tab-001");
    expect(forwardResult).toMatchObject({
      id: "run-xhs-no-tab-001",
      status: "error",
      error: {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: "target tab is unavailable"
      }
    });
  });

  it("blocks xhs.search when target_page is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-page-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-page-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_page: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            target_domain?: string | null;
            target_tab_id?: number | null;
            target_page?: string | null;
            action_type?: string;
            requested_execution_mode?: string;
            effective_execution_mode?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-missing-page-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-missing-page-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: null,
          action_type: "read",
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          gate_reasons: ["TARGET_PAGE_NOT_EXPLICIT"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks xhs.search when target_tab_id is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_tab_id: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            requested_execution_mode?: string;
            effective_execution_mode?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-missing-tab-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-missing-tab-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          gate_reasons: ["TARGET_TAB_NOT_EXPLICIT"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks xhs.search when requested_execution_mode is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-requested-mode-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-requested-mode-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-missing-requested-mode-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-missing-requested-mode-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          requested_execution_mode: null,
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: ["REQUESTED_EXECUTION_MODE_NOT_EXPLICIT"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks live_read_high_risk in background gate when approval is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          details?: {
            reason?: string;
          };
          consumer_gate_result?: {
            risk_state?: string;
            issue_scope?: string;
            target_domain?: string | null;
            target_tab_id?: number | null;
            target_page?: string | null;
            action_type?: string;
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-mode-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-mode-blocked-001",
      status: "error",
      payload: {
        plugin_gate_ownership: {
          background_gate: [
            "target_domain_check",
            "target_tab_check",
            "mode_gate",
            "risk_state_gate"
          ],
          content_script_gate: ["page_context_check", "action_tier_check"],
          main_world_gate: ["signed_call_scope_check"],
          cli_role: "request_and_result_shell_only"
        },
        risk_transition_audit: {
          issue_scope: "issue_209",
          prev_state: "allowed",
          next_state: "limited",
          trigger: "risk_signal_detected",
          decision: "blocked"
        },
        consumer_gate_result: {
          issue_scope: "issue_209",
          risk_state: "allowed",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: ["MANUAL_CONFIRMATION_MISSING", "APPROVAL_CHECKS_INCOMPLETE"]
        },
        read_execution_policy: {
          default_mode: "dry_run",
          allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
          blocked_actions: ["expand_new_live_surface_without_gate"]
        },
        issue_action_matrix: {
          issue_scope: "issue_209",
          state: "limited",
          allowed_actions: ["dry_run", "recon"],
          conditional_actions: [
            {
              action: "live_read_limited",
              requires: [
                "approval_record_approved_true",
                "approval_record_approver_present",
                "approval_record_approved_at_present",
                "approval_record_checks_all_true"
              ]
            }
          ]
        },
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "cooldown",
            triggered_by: "MANUAL_CONFIRMATION_MISSING",
            cooldown_until: expect.any(String),
            recovery_started_at: null,
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          },
          recovery_requirements: [
            "stability_window_passed_and_manual_approve",
            "risk_state_checked",
            "audit_record_present"
          ]
        }
      }
    });
  });

  it("blocks live_read_limited in background gate when approval is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-limited-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-limited-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          gate_outcome?: {
            effective_execution_mode?: string;
            requires_manual_confirmation?: boolean;
          };
          consumer_gate_result?: {
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-limited-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-limited-blocked-001",
      status: "error",
      payload: {
        gate_outcome: {
          effective_execution_mode: "recon",
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "recon",
          gate_decision: "blocked",
          gate_reasons: ["MANUAL_CONFIRMATION_MISSING", "APPROVAL_CHECKS_INCOMPLETE"]
        }
      }
    });
  });

  it("blocks issue_209 write live_read_limited in background before relay even with approval", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue209-write-limited-bg-blocked-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue209-write-limited-bg-blocked-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_209",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            issue_scope?: string;
            action_type?: string;
            requested_execution_mode?: string | null;
            effective_execution_mode?: string;
            gate_decision?: string;
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-issue209-write-limited-bg-blocked-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-issue209-write-limited-bg-blocked-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "recon",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining([
            "ACTION_TYPE_MODE_MISMATCH",
            "RISK_STATE_LIMITED",
            "ISSUE_ACTION_MATRIX_BLOCKED"
          ])
        }
      }
    });
  });

  it("blocks live_read_high_risk in paused state even with approval", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-paused-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-paused-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "paused",
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as {
        id?: string;
        status?: string;
        payload?: {
          consumer_gate_result?: {
            gate_reasons?: string[];
          };
        };
      })
      .find((message) => message.id === "run-xhs-live-mode-paused-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-live-mode-paused-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["RISK_STATE_PAUSED", "ISSUE_ACTION_MATRIX_BLOCKED"]
        }
      }
    });
  });

  it("blocks issue_208 write action in paused state and exposes reversible write tier", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-paused-write-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-paused-write-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused",
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-issue-208-paused-write-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(payload)).toBe("reversible_interaction");
  });

  it("blocks background gate when action_type is omitted even if ability context is write", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-missing-action-type-bg-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-missing-action-type-bg-001",
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
            risk_state: "allowed"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-missing-action-type-bg-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.action_type).toBeNull();
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
  });

  it("blocks ability.action mismatch in background with the same gate reason as relay", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
        id: "run-xhs-ability-action-mismatch-bg-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "run-xhs-ability-action-mismatch-bg-001",
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
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "dry_run",
            risk_state: "paused"
          }
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; error?: { code?: string }; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-ability-action-mismatch-bg-001");
    expect(blocked?.status).toBe("error");
    expect(blocked?.error?.code).toBe("ERR_TRANSPORT_FORWARD_FAILED");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.action_type).toBe("read");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["ABILITY_ACTION_CONTEXT_MISMATCH"])
    );
  });

  it("allows issue_208 reversible_interaction_with_approval in limited/allowed only with complete approval", async () => {
    const states: Array<"limited" | "allowed"> = ["limited", "allowed"];

    for (const state of states) {
      const blockedPort = createMockPort();
      const { chromeApi: blockedChromeApi } = createChromeApi([blockedPort]);
      blockedChromeApi.tabs.query.mockImplementation(async () => [
        { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
      ]);
      startChromeBackgroundBridge(blockedChromeApi);
      respondHandshake(blockedPort);
      await Promise.resolve();

      blockedPort.onMessageListeners[0]?.({
        id: `run-xhs-issue-208-${state}-missing-approval-001`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-missing-approval-001`,
          command: "xhs.search",
          command_params: createXhsCommandParams({
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
            approval_record: {
              approved: false,
              approver: null,
              approved_at: null,
              checks: {
                target_domain_confirmed: false,
                target_tab_confirmed: false,
                target_page_confirmed: false,
                risk_state_checked: false,
                action_type_confirmed: false
              }
            }
          }),
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 100
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(blockedChromeApi.tabs.sendMessage).not.toHaveBeenCalled();
      const blocked = blockedPort.postMessage.mock.calls
        .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
        .find((message) => message.id === `run-xhs-issue-208-${state}-missing-approval-001`);
      expect(blocked?.status).toBe("error");
      const blockedPayload = asRecord(blocked?.payload) ?? {};
      const blockedConsumerGateResult = asRecord(blockedPayload.consumer_gate_result);
      const blockedIssueActionMatrix = asRecord(blockedPayload.issue_action_matrix);
      const blockedConditionalActions = Array.isArray(blockedIssueActionMatrix?.conditional_actions)
        ? blockedIssueActionMatrix.conditional_actions
        : [];
      const blockedWriteMatrixDecisions = asRecord(blockedPayload.write_action_matrix_decisions);
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(blockedPayload.write_action_matrix).toBeUndefined();
      expect(blockedWriteMatrixDecisions).not.toBeNull();
      expect(blockedConditionalActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "reversible_interaction_with_approval"
          })
        ])
      );
      expect(resolveWriteInteractionTier(blockedPayload)).toBe("reversible_interaction");

      const approvedPort = createMockPort();
      const { chromeApi: approvedChromeApi, runtimeMessageListeners } = createChromeApi([approvedPort]);
      approvedChromeApi.tabs.query.mockImplementation(async () => [
        { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
      ]);
      startChromeBackgroundBridge(approvedChromeApi);
      respondHandshake(approvedPort);
      await Promise.resolve();

      approvedPort.onMessageListeners[0]?.({
        id: `run-xhs-issue-208-${state}-approved-001`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `run-xhs-issue-208-${state}-approved-001`,
          command: "xhs.search",
          command_params: createXhsCommandParams({
            issue_scope: "issue_208",
            target_domain: "creator.xiaohongshu.com",
            target_page: "creator_publish_tab",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
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
          }),
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 100
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(approvedChromeApi.tabs.sendMessage).not.toHaveBeenCalled();
      expect(runtimeMessageListeners).toHaveLength(1);

      const approved = approvedPort.postMessage.mock.calls
        .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
        .find((message) => message.id === `run-xhs-issue-208-${state}-approved-001`);
      expect(approved?.status).toBe("success");
      const summary = asRecord(approved?.payload?.summary) ?? {};
      const capabilityResult = asRecord(summary.capability_result);
      const approvedConsumerGateResult = asRecord(summary.consumer_gate_result);
      const approvedIssueActionMatrix = asRecord(summary.issue_action_matrix);
      const approvedConditionalActions = Array.isArray(approvedIssueActionMatrix?.conditional_actions)
        ? approvedIssueActionMatrix.conditional_actions
        : [];
      const approvedWriteMatrixDecisions = asRecord(summary.write_action_matrix_decisions);
      const writeGateOnlyDecision = asRecord(summary.write_gate_only_decision);
      expect(capabilityResult?.outcome).toBe("partial");
      expect(capabilityResult?.action).toBe("write");
      expect(approvedConsumerGateResult?.gate_decision).toBe("allowed");
      expect(summary.write_action_matrix).toBeUndefined();
      expect(approvedWriteMatrixDecisions).not.toBeNull();
      expect(approvedConditionalActions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            action: "reversible_interaction_with_approval"
          })
        ])
      );
      expect(writeGateOnlyDecision?.execution_enabled).toBe(false);
      expect(resolveWriteInteractionTier(summary)).toBe("reversible_interaction");
    }
  });

  it("keeps issue_208 gate-only approval on non-live effective mode even when request asks for live_write", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-live-write-gate-only-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-live-write-gate-only-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-issue-208-live-write-gate-only-001");
    expect(approved?.status).toBe("success");
    const summary = asRecord(approved?.payload?.summary) ?? {};
    const gateInput = asRecord(summary.gate_input);
    const gateOutcome = asRecord(summary.gate_outcome);
    const consumerGateResult = asRecord(summary.consumer_gate_result);
    const auditRecord = asRecord(summary.audit_record);
    expect(gateInput?.requested_execution_mode).toBe("live_write");
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_write");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "WRITE_EXECUTION_GATE_ONLY",
        "WRITE_INTERACTION_TIER_REVERSIBLE_INTERACTION"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_write");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
    expect(summary.write_interaction_tier).toMatchObject({
      tiers: [
        { name: "observe_only", live_allowed: false },
        { name: "reversible_interaction", live_allowed: "limited" },
        { name: "irreversible_write", live_allowed: false }
      ],
      synthetic_event_default: "blocked",
      upload_injection_default: "blocked"
    });
  });

  it("keeps issue_208 irreversible_write blocked and exposes irreversible write tier", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-irreversible-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-irreversible-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          action_type: "irreversible_write",
          requested_execution_mode: "dry_run",
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-issue-208-irreversible-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(payload)).toBe("irreversible_write");
  });

  it("forwards approved live_read_limited through the real background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-limited-approved-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-limited-approved-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-live-limited-approved-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-live-limited-approved-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success",
              action: "read"
            },
            consumer_gate_result: {
              risk_state: "limited",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              effective_execution_mode: "live_read_limited",
              gate_decision: "allowed",
              gate_reasons: ["LIVE_MODE_APPROVED"]
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-live-limited-approved-001");
    expect(approved).toMatchObject({
      id: "run-xhs-live-limited-approved-001",
      status: "success",
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            action: "read"
          },
          consumer_gate_result: {
            risk_state: "limited",
            requested_execution_mode: "live_read_limited",
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          }
        }
      }
    });
  });

  it("forwards approved live_read_high_risk through the real background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-mode-approved-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-mode-approved-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
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
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-live-mode-approved-001",
        command: "xhs.search"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-xhs-live-mode-approved-001",
        ok: true,
        payload: {
          summary: {
            capability_result: {
              outcome: "success",
              action: "read"
            },
            consumer_gate_result: {
              risk_state: "allowed",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              effective_execution_mode: "live_read_high_risk",
              gate_decision: "allowed",
              gate_reasons: ["LIVE_MODE_APPROVED"]
            }
          }
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const approved = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { summary?: Record<string, unknown> } })
      .find((message) => message.id === "run-xhs-live-mode-approved-001");
    expect(approved).toMatchObject({
      id: "run-xhs-live-mode-approved-001",
      status: "success",
      payload: {
        summary: {
          capability_result: {
            outcome: "success",
            action: "read"
          },
          consumer_gate_result: {
            risk_state: "allowed",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          }
        }
      }
    });
  });

  it("blocks xhs.search when target_domain is outside xhs read/write scope", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-invalid-domain-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-invalid-domain-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_domain: "www.douyin.com"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { consumer_gate_result?: { gate_reasons?: string[] } } })
      .find((message) => message.id === "run-xhs-invalid-domain-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-invalid-domain-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["TARGET_DOMAIN_OUT_OF_SCOPE"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("blocks xhs.search when read action targets write domain", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true },
      { id: 45, url: "https://creator.xiaohongshu.com/publish/publish", active: false }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-read-write-domain-mismatch-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-read-write-domain-mismatch-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 45,
          target_page: "creator_publish_tab"
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: { consumer_gate_result?: { gate_reasons?: string[] } } })
      .find((message) => message.id === "run-xhs-read-write-domain-mismatch-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-read-write-domain-mismatch-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          gate_reasons: ["ACTION_DOMAIN_MISMATCH"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("forwards xhs.search only when explicit target tab/page/domain match", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: false },
      { id: 44, url: "https://www.xiaohongshu.com/home", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-explicit-target-allow-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-explicit-target-allow-001",
        command: "xhs.search",
        command_params: createXhsCommandParams(),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-explicit-target-allow-001",
        command: "xhs.search"
      })
    );
  });

  it("queues forwards during recovering and replays after reopen", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 100
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();
      await Promise.resolve();
      vi.advanceTimersByTime(5);
      expect(chromeApi.runtime.connectNative).toHaveBeenCalledTimes(2);

      ports[1].onMessageListeners[0]?.({
        id: "queued-forward-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-forward-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
      await Promise.resolve();

      const queuedError = ports[1].postMessage.mock.calls.find(
        (call) => (call[0] as { id?: string }).id === "queued-forward-001"
      );
      expect(queuedError).toBeUndefined();
      expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();

      respondHandshake(ports[1]);

      await Promise.resolve();
      await Promise.resolve();
      expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
        11,
        expect.objectContaining({
          id: "queued-forward-001"
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails only when recovery queue exceeds limit", async () => {
    const ports = [createMockPort(), createMockPort()];
    const { chromeApi } = createChromeApi(ports);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 500
    });

    respondHandshake(ports[0]);
    ports[0].onDisconnectListeners[0]?.();
    await Promise.resolve();

    for (let i = 1; i <= 6; i += 1) {
      ports[1].onMessageListeners[0]?.({
        id: `queued-overflow-${i}`,
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: `queued-overflow-${i}`,
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
    }

    await Promise.resolve();
    const overflowError = ports[1].postMessage.mock.calls.find(
      (call) => (call[0] as { id?: string }).id === "queued-overflow-6"
    );
    expect(overflowError).toBeDefined();
    expect((overflowError?.[0] as { error?: { code?: string } }).error?.code).toBe(
      "ERR_TRANSPORT_DISCONNECTED"
    );

    for (let i = 1; i <= 5; i += 1) {
      const queuedFailure = ports[1].postMessage.mock.calls.find(
        (call) => (call[0] as { id?: string }).id === `queued-overflow-${i}`
      );
      expect(queuedFailure).toBeUndefined();
    }
  });

  it("fails queued forwards when recovery window exhausts", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 10,
        recoveryWindowMs: 30
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();

      ports[1].onMessageListeners[0]?.({
        id: "queued-expire-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-expire-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });

      vi.advanceTimersByTime(40);
      await Promise.resolve();
      await Promise.resolve();

      expect(ports[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "queued-expire-001",
          status: "error",
          error: expect.objectContaining({
            code: "ERR_TRANSPORT_DISCONNECTED"
          })
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires short-timeout queued forward before recovery window ends", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 200
      });

      respondHandshake(ports[0]);
      ports[0].onDisconnectListeners[0]?.();

      ports[1].onMessageListeners[0]?.({
        id: "queued-short-timeout-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "queued-short-timeout-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 20
      });

      vi.advanceTimersByTime(30);
      await Promise.resolve();

      expect(ports[1].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "queued-short-timeout-001",
          status: "error",
          error: expect.objectContaining({
            code: "ERR_TRANSPORT_TIMEOUT"
          })
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
