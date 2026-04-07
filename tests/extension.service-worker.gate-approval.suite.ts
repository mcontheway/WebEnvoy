import { describe, expect, it, vi } from "vitest";
import { createMockPort, createEditorInputProbeResult, createChromeApi, respondHandshake, waitForBridgeTurn, waitForPostedMessage, primeTrustedFingerprintContext, promoteBootstrapReadinessThroughPing, createXhsCommandParams, createXhsEditorInputCommandParams, createApprovedReadApprovalRecord, createFingerprintRuntimeContext, asRecord, resolveWriteInteractionTier, startChromeBackgroundBridge } from "./extension.service-worker.shared.js";

describe("extension service worker / gate and approval", () => {
  it("forwards fingerprint_context into background bridge", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext({
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited"]
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-fingerprint-forward-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-fingerprint-forward-001",
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-fingerprint-forward-001",
        fingerprintContext: fingerprintContext
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
          issue_scope: "issue_209"
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
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
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
            issue_scope: "issue_209"
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
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

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

  it("keeps target_tab_id explicit for issue_208 editor_input forward", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 18, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true },
      { id: 32, url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article", active: false }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-issue-208-editor-input-autotab-001",
      profile: "profile-a",
      fingerprintContext: createFingerprintRuntimeContext({
        live_allowed: true,
        live_decision: "allowed",
        allowed_execution_modes: [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk",
          "live_write"
        ]
      }),
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-autotab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-autotab-001",
        command: "xhs.search",
        command_params: createXhsEditorInputCommandParams({
          target_tab_id: undefined
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const proactiveContentScriptInject = executeScript.mock.calls.find(
      (call) =>
        (call[0] as { world?: string; files?: string[] }).world === "ISOLATED" &&
        ((call[0] as { files?: string[] }).files ?? []).includes("build/content-script.js")
    );
    expect(proactiveContentScriptInject).toBeUndefined();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalledWith(
      32,
      expect.objectContaining({
        id: "run-xhs-issue-208-editor-input-autotab-001",
        command: "xhs.search"
      })
    );

    const blocked = firstPort.postMessage.mock.calls
      .map(
        (call) =>
          call[0] as {
            id?: string;
            status?: string;
            payload?: {
              consumer_gate_result?: {
                target_tab_id?: number | null;
                gate_decision?: string;
                gate_reasons?: string[];
              };
            };
          }
      )
      .find((message) => message.id === "run-xhs-issue-208-editor-input-autotab-001");
    expect(blocked).toMatchObject({
      id: "run-xhs-issue-208-editor-input-autotab-001",
      status: "error",
      payload: {
        consumer_gate_result: {
          target_tab_id: null,
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining(["TARGET_TAB_NOT_EXPLICIT"])
        }
      }
    });
  });

  it("falls back to global xhs tab resolution when currentWindow query is empty", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async (filter: { currentWindow?: boolean; url?: string | string[] }) => {
      if (filter.currentWindow) {
        return [];
      }
      if (filter.url) {
        return [{ id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }];
      }
      return [];
    });
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-issue-208-editor-input-globaltab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-issue-208-editor-input-globaltab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          target_tab_id: undefined
        }),
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
        id: "run-xhs-issue-208-editor-input-globaltab-001",
        command: "xhs.search"
      })
    );
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
          risk_state: "allowed",
          fingerprint_context: createFingerprintRuntimeContext()
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
          risk_state: "limited",
          fingerprint_context: createFingerprintRuntimeContext()
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
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
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
          fingerprint_context: createFingerprintRuntimeContext(),
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
      {
        id: 32,
        url: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article",
        active: true
      }
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
    expect(consumerGateResult?.write_interaction_tier).toBeNull();
    expect(payload.write_action_matrix_decisions).toBeNull();
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

  it("keeps issue_208 dry_run write blocked in limited/allowed even with complete approval", async () => {
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
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(blockedPayload.write_action_matrix).toBeUndefined();

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
      expect(approved?.status).toBe("error");
      const payload = asRecord(approved?.payload) ?? {};
      const approvedConsumerGateResult = asRecord(payload.consumer_gate_result);
      const writeGateOnlyDecision = asRecord(payload.write_gate_only_decision);
      expect(approvedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(payload.write_action_matrix).toBeUndefined();
      expect(writeGateOnlyDecision?.execution_enabled).toBe(false);
    }
  });

  it("blocks live mode when fingerprint_context.execution.live_allowed=false", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["PROFILE_FIELD_MISSING"]
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-blocked-by-fingerprint-001",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
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
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["PROFILE_FIELD_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context.execution.live_decision=dry_run_only", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["OS_FAMILY_MISMATCH"]
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-blocked-by-fingerprint-002",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-002",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-002",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
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
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-002");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["OS_FAMILY_MISMATCH"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context is missing", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-003",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-003",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord()
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
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-003");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const gateOutcome = asRecord(payload.gate_outcome);
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(payload.fingerprint_execution).toBeNull();
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_MISSING", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("blocks live mode when fingerprint_context exists but is not trusted for run/profile", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-blocked-by-fingerprint-untrusted-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: createFingerprintRuntimeContext()
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
      .find((message) => message.id === "run-xhs-live-blocked-by-fingerprint-untrusted-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(payload.fingerprint_execution).toBeNull();
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("rejects startup trust primed by non-allowlist sender tab", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-untrusted-startup-tab-001",
      profile: "profile-a",
      fingerprintContext,
      tabId: 9,
      tabUrl: "https://example.com/"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: "run-xhs-live-untrusted-startup-tab-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-xhs-live-untrusted-startup-tab-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
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
      .find((message) => message.id === "run-xhs-live-untrusted-startup-tab-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("allows startup trust reuse across different run_id within the same session when trust remains bound", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const startupRunId = "run-xhs-live-trusted-by-runtime-start-001";
    const liveRunId = "run-xhs-live-consume-startup-trust-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: `startup-fingerprint-trust:${startupRunId}`,
        ok: true,
        payload: {
          startup_fingerprint_trust: {
            run_id: startupRunId,
            profile,
            session_id: "nm-session-001",
            fingerprint_runtime: fingerprintContext,
            trust_source: "extension_bootstrap_context",
            bootstrap_attested: true,
            main_world_result_used_for_trust: false
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
    chromeApi.tabs.sendMessage.mockClear();

    const liveRequestId = `${liveRunId}-live`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
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
        id: liveRequestId,
        command: "xhs.search"
      })
    );
  });

  it("does not establish trusted fingerprint context from runtime.ping", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const profile = "profile-a";
    const pingRunId = "run-ping-no-trust-001";
    const liveRunId = "run-ping-no-trust-live-002";
    const fingerprintContext = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });

    firstPort.onMessageListeners[0]?.({
      id: pingRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: pingRunId,
        command: "runtime.ping",
        command_params: {
          fingerprint_context: fingerprintContext
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: pingRunId,
        ok: true,
        payload: {
          fingerprint_runtime: fingerprintContext,
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
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await waitForBridgeTurn();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRunId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("invalidates trusted fingerprint context after disconnect/recovery with new session", async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort, secondPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 100
    });
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-recovery-untrusted-001",
      profile: "profile-a",
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onDisconnectListeners[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    respondHandshake(secondPort, {
      sessionId: "nm-session-002"
    });
    await Promise.resolve();

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: "run-xhs-live-recovery-untrusted-001",
      profile: "profile-a",
      fingerprintContext,
      sessionId: "nm-session-001"
    });

    secondPort.onMessageListeners[0]?.({
      id: "run-xhs-live-recovery-untrusted-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-002",
        run_id: "run-xhs-live-recovery-untrusted-001",
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const blocked = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === "run-xhs-live-recovery-untrusted-001");
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("requires re-attestation after disconnect/recovery even in the same session", async () => {
    const firstPort = createMockPort();
    const secondPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort, secondPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10_000,
      recoveryRetryIntervalMs: 5,
      recoveryWindowMs: 100
    });
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const profile = "profile-a";
    const startupRunId = "run-xhs-live-recovery-keep-trust-startup-001";
    const liveRunId = "run-xhs-live-recovery-keep-trust-live-002";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: startupRunId,
      profile,
      fingerprintContext,
      sessionId: "nm-session-001"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onDisconnectListeners[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    respondHandshake(secondPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const firstAttemptId = `${liveRunId}-blocked-before-reprime`;
    secondPort.onMessageListeners[0]?.({
      id: firstAttemptId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const blockedDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === firstAttemptId
    );
    expect(blockedDispatch).toBeUndefined();

    const blocked = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === firstAttemptId);
    expect(blocked?.status).toBe("error");
    const blockedPayload = asRecord(blocked?.payload) ?? {};
    const blockedConsumerGateResult = asRecord(blockedPayload.consumer_gate_result);
    expect(blockedConsumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(blockedConsumerGateResult?.fingerprint_reason_codes).toEqual([
      "FINGERPRINT_CONTEXT_UNTRUSTED"
    ]);

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: `${startupRunId}-reprime`,
      profile,
      fingerprintContext,
      sessionId: "nm-session-001"
    });
    chromeApi.tabs.sendMessage.mockClear();

    secondPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRunId
    );
    expect(liveDispatch).toBeDefined();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: liveRunId,
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

    const allowed = secondPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string })
      .find((message) => message.id === liveRunId);
    expect(allowed?.status).toBe("success");
  });

  it("does not reuse startup trust across new run_id in the same session for live xhs.search", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort, {
      sessionId: "nm-session-001"
    });
    await Promise.resolve();

    const startupRunId = "run-startup-trust-001";
    const liveRunId = "run-live-followup-002";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId: startupRunId,
      profile,
      fingerprintContext,
      tabId: 32,
      tabUrl: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=article"
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: liveRunId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: liveRunId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRunId
    );
    expect(liveDispatch).toBeUndefined();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRunId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
  });

  it("invalidates trusted fingerprint context after runtime.stop for same profile::session", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-stop-untrusted-001";
    const profile = "profile-a";
    const fingerprintContext = createFingerprintRuntimeContext();
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    const stopRequestId = `${runId}-stop`;
    firstPort.onMessageListeners[0]?.({
      id: stopRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "runtime.stop",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: stopRequestId,
        ok: true,
        payload: {
          message: "stopped",
          run_id: runId,
          profile
        }
      },
      {
        tab: {
          id: 32
        }
      }
    );
    await Promise.resolve();

    const stopDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === stopRequestId
    );
    expect(stopDispatch).toBeDefined();

    const liveRequestId = `${runId}-live-after-stop`;
    firstPort.onMessageListeners[0]?.({
      id: liveRequestId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: fingerprintContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const liveDispatch = chromeApi.tabs.sendMessage.mock.calls.find(
      (call) => (call[1] as { id?: string } | undefined)?.id === liveRequestId
    );
    expect(liveDispatch).toBeUndefined();

    const blocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === liveRequestId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("rotates trusted fingerprint context when startup trust overwrites same profile::session", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-trust-rotate-001";
    const profile = "profile-a";
    const trustedAllowed = createFingerprintRuntimeContext({
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: []
    });
    const trustedBlocked = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["PROFILE_FIELD_MISSING"]
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedAllowed
    });
    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedBlocked
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: runId,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: trustedBlocked
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
      .find((message) => message.id === runId);
    expect(blocked?.status).toBe("error");
    const payload = asRecord(blocked?.payload) ?? {};
    const consumerGateResult = asRecord(payload.consumer_gate_result);
    expect(consumerGateResult?.fingerprint_gate_decision).toBe("blocked");
    expect(consumerGateResult?.fingerprint_reason_codes).toEqual(["PROFILE_FIELD_MISSING"]);
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

  it("invalidates trust when live request fingerprint_context changes without re-prime", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners } = createChromeApi([firstPort]);
    chromeApi.tabs.query.mockImplementation(async () => [
      { id: 32, url: "https://www.xiaohongshu.com/search_result?keyword=露营", active: true }
    ]);
    startChromeBackgroundBridge(chromeApi);
    respondHandshake(firstPort);
    await Promise.resolve();

    const runId = "run-xhs-live-context-drift-001";
    const profile = "profile-a";
    const trustedContext = createFingerprintRuntimeContext();
    const driftedContext = createFingerprintRuntimeContext({
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: ["OS_FAMILY_MISMATCH"]
    });

    await primeTrustedFingerprintContext({
      runtimeMessageListeners,
      runId,
      profile,
      fingerprintContext: trustedContext
    });
    chromeApi.tabs.sendMessage.mockClear();

    firstPort.onMessageListeners[0]?.({
      id: `${runId}-drifted`,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: driftedContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
    const firstBlocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === `${runId}-drifted`);
    const firstPayload = asRecord(firstBlocked?.payload) ?? {};
    const firstConsumerGateResult = asRecord(firstPayload.consumer_gate_result);
    expect(firstConsumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);

    firstPort.onMessageListeners[0]?.({
      id: `${runId}-after-invalidation`,
      method: "bridge.forward",
      profile,
      params: {
        session_id: "nm-session-001",
        run_id: runId,
        command: "xhs.search",
        command_params: createXhsCommandParams({
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: createApprovedReadApprovalRecord(),
          fingerprint_context: trustedContext
        }),
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 100
    });
    await Promise.resolve();
    await Promise.resolve();

    const secondBlocked = firstPort.postMessage.mock.calls
      .map((call) => call[0] as { id?: string; status?: string; payload?: Record<string, unknown> })
      .find((message) => message.id === `${runId}-after-invalidation`);
    expect(secondBlocked?.status).toBe("error");
    const secondPayload = asRecord(secondBlocked?.payload) ?? {};
    const secondConsumerGateResult = asRecord(secondPayload.consumer_gate_result);
    expect(secondConsumerGateResult?.fingerprint_reason_codes).toEqual(["FINGERPRINT_CONTEXT_UNTRUSTED"]);
    expect(secondConsumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["FINGERPRINT_CONTEXT_UNTRUSTED", "FINGERPRINT_EXECUTION_BLOCKED"])
    );
  });

});
