import { describe, expect, it, vi } from "vitest";

import { startChromeBackgroundBridge } from "../extension/background.js";

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

  it("schedules periodic heartbeat and marks disconnected after heartbeat timeout", async () => {
    vi.useFakeTimers();
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

    startChromeBackgroundBridge(chromeApi, {
      heartbeatIntervalMs: 10,
      heartbeatTimeoutMs: 5,
      maxMissedHeartbeats: 1
    });

    vi.advanceTimersByTime(10);
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "__ping__"
      })
    );

    vi.advanceTimersByTime(6);

    nativeMessageListeners[0]?.({
      id: "run-after-disconnect-001",
      method: "bridge.forward",
      profile: "profile-a",
      params: {
        session_id: "nm-session-001",
        run_id: "run-after-disconnect-001",
        command: "runtime.ping",
        command_params: {},
        cwd: "/workspace/WebEnvoy"
      },
      timeout_ms: 50
    });

    await Promise.resolve();
    expect(port.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "run-after-disconnect-001",
        status: "error",
        error: expect.objectContaining({
          code: "ERR_TRANSPORT_DISCONNECTED"
        })
      })
    );
    vi.useRealTimers();
  });
});
