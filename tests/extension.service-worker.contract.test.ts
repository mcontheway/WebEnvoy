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

describe("extension service worker entry contract", () => {
  it("binds native port and forwards request context to content script", async () => {
    const nativeMessageListeners: Array<(message: Record<string, unknown>) => void> = [];
    const runtimeMessageListeners: Array<
      (message: unknown, sender: { tab?: { id?: number } }) => void
    > = [];

    const port = {
      postMessage: vi.fn(),
      onMessage: {
        addListener: (listener: (message: Record<string, unknown>) => void) => {
          nativeMessageListeners.push(listener);
        }
      },
      onDisconnect: {
        addListener: vi.fn()
      }
    };

    const chromeApi = {
      runtime: {
        connectNative: vi.fn(() => port),
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

    startChromeBackgroundBridge(chromeApi);
    expect(chromeApi.runtime.connectNative).toHaveBeenCalledWith("com.webenvoy.host");

    nativeMessageListeners[0]?.({
      id: "bridge-open-001",
      method: "bridge.open",
      profile: "profile-a",
      params: {}
    });
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "bridge-open-001",
        status: "success"
      })
    );

    nativeMessageListeners[0]?.({
      id: "run-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-001",
        command: "runtime.ping",
        command_params: {
          foo: "bar"
        },
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 123
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-001",
        runId: "run-001",
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 123,
        command: "runtime.ping"
      })
    );

    runtimeMessageListeners[0]?.(
      {
        kind: "result",
        id: "run-001",
        ok: true,
        payload: {
          message: "pong"
        }
      },
      {
        tab: {
          id: 11
        }
      }
    );

    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-001",
        status: "success",
        summary: expect.objectContaining({
          run_id: "run-001",
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          relay_path: "host>background>content-script>background>host"
        })
      })
    );
  });

  it("returns ERR_TRANSPORT_NOT_READY before handshake and does not forward", async () => {
    const firstPort = createMockPort();
    const runtimeMessageListeners: Array<
      (message: unknown, sender: { tab?: { id?: number } }) => void
    > = [];

    const chromeApi = {
      runtime: {
        connectNative: vi.fn(() => firstPort.port),
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
  });

  it("heartbeat timeout clears port and fails pending forward as disconnected", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
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
          sendMessage: vi.fn(
            async () =>
              await new Promise<void>(() => {
                // keep pending forward unresolved until disconnect handling.
              })
          )
        }
      };

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10,
        heartbeatTimeoutMs: 5,
        maxMissedHeartbeats: 1,
        recoveryRetryIntervalMs: 50,
        recoveryWindowMs: 200
      });

      ports[0].onMessageListeners[0]?.({
        id: "open-001",
        method: "bridge.open",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001"
        }
      });

      ports[0].onMessageListeners[0]?.({
        id: "run-pending-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "run-pending-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 500
      });

      await Promise.resolve();
      await Promise.resolve();
      vi.advanceTimersByTime(10);
      vi.advanceTimersByTime(6);

      expect(ports[0].postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "run-pending-001",
          status: "error",
          error: expect.objectContaining({
            code: "ERR_TRANSPORT_DISCONNECTED"
          })
        })
      );
      expect(chromeApi.runtime.connectNative).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("reconnects after heartbeat timeout and can handshake again", async () => {
    vi.useFakeTimers();
    try {
      const ports = [createMockPort(), createMockPort()];
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

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10,
        heartbeatTimeoutMs: 5,
        maxMissedHeartbeats: 1,
        recoveryRetryIntervalMs: 10,
        recoveryWindowMs: 200
      });

      ports[0].onMessageListeners[0]?.({
        id: "open-first-001",
        method: "bridge.open",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001"
        }
      });

      vi.advanceTimersByTime(10);
      vi.advanceTimersByTime(6);
      expect(chromeApi.runtime.connectNative).toHaveBeenCalledTimes(2);

      ports[1].onMessageListeners[0]?.({
        id: "run-before-reopen-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "run-before-reopen-001",
          command: "runtime.ping",
          command_params: {},
          cwd: "/workspace/WebEnvoy"
        },
        timeout_ms: 50
      });
      await Promise.resolve();
      await Promise.resolve();
      const preReadyCall = ports[1].postMessage.mock.calls.find(
        (call) =>
          (call[0] as { id?: string }).id === "run-before-reopen-001" &&
          (call[0] as { status?: string }).status === "error"
      );
      expect(preReadyCall).toBeDefined();
      const preReadyCode = (preReadyCall?.[0] as { error?: { code?: string } })?.error?.code;
      expect(["ERR_TRANSPORT_NOT_READY", "ERR_TRANSPORT_DISCONNECTED"]).toContain(preReadyCode);

      ports[1].onMessageListeners[0]?.({
        id: "open-second-001",
        method: "bridge.open",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001"
        }
      });

      ports[1].onMessageListeners[0]?.({
        id: "run-after-reopen-001",
        method: "bridge.forward",
        profile: "profile-a",
        params: {
          session_id: "nm-session-001",
          run_id: "run-after-reopen-001",
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
          id: "run-after-reopen-001"
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
