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
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  requested_execution_mode: "dry_run",
  ...overrides
});

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

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-xhs-error-payload-001",
        status: "error",
        payload: {
          consumer_gate_result: expect.objectContaining({
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "dry_run",
            effective_execution_mode: "dry_run"
          }),
          details: {
            reason: "SESSION_EXPIRED"
          },
          diagnosis: {
            category: "request_failed"
          }
        }
      })
    );
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

    expect(firstPort.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-xhs-tab-pin-001",
        status: "success",
        payload: expect.objectContaining({
          consumer_gate_result: expect.objectContaining({
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            requested_execution_mode: "dry_run",
            effective_execution_mode: "dry_run",
            gate_decision: "allowed"
          })
        })
      })
    );
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

  it("blocks live_* mode by default and keeps auditable consumer_gate_result fields", async () => {
    const firstPort = createMockPort();
    const { chromeApi } = createChromeApi([firstPort]);
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
          requested_execution_mode: "live_read_high_risk"
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
        consumer_gate_result: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: ["LIVE_EXECUTION_MODE_BLOCKED_BY_BACKGROUND_GATE"]
        }
      }
    });
    expect(chromeApi.tabs.sendMessage).not.toHaveBeenCalled();
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
