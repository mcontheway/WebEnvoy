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
