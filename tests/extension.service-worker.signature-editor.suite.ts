import { describe, expect, it, vi } from "vitest";
import { createMockPort, createEditorInputProbeResult, createChromeApi, respondHandshake, waitForBridgeTurn, waitForPostedMessage, primeTrustedFingerprintContext, promoteBootstrapReadinessThroughPing, createXhsCommandParams, createXhsEditorInputCommandParams, createApprovedReadApprovalRecord, createFingerprintRuntimeContext, asRecord, resolveWriteInteractionTier, startChromeBackgroundBridge } from "./extension.service-worker.shared.js";

describe("extension service worker / signature and editor input", () => {
  it("stops heartbeat on disconnect and restarts it after recovery handshake", async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    try {
      const ports = [createMockPort(), createMockPort()];
      const { chromeApi } = createChromeApi(ports);

      startChromeBackgroundBridge(chromeApi, {
        heartbeatIntervalMs: 10_000,
        recoveryRetryIntervalMs: 5,
        recoveryWindowMs: 100
      });

      respondHandshake(ports[0]);
      await Promise.resolve();

      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 10_000)
      ).toHaveLength(1);
      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 5)
      ).toHaveLength(0);

      ports[0].onDisconnectListeners[0]?.();
      await Promise.resolve();

      expect(clearIntervalSpy.mock.calls).toHaveLength(1);
      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 5)
      ).toHaveLength(1);

      vi.advanceTimersByTime(5);
      await Promise.resolve();
      await Promise.resolve();

      respondHandshake(ports[1]);
      await Promise.resolve();

      expect(
        setIntervalSpy.mock.calls.filter(([, intervalMs]) => intervalMs === 10_000)
      ).toHaveLength(2);
      expect(clearIntervalSpy.mock.calls).toHaveLength(2);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
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

  it("executes xhs-sign in MAIN world through extension-private rpc", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 32 },
        world: "MAIN",
        args: ["/api/sns/web/v1/search/notes", { keyword: "露营" }]
      })
    );
    expect(response).toEqual({
      ok: true,
      result: {
        "X-s": "signed",
        "X-t": "1700000000"
      }
    });
  });

  it("rejects xhs-sign requests from non-allowlisted sender tabs", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 44,
          url: "https://example.com/"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();

    expect(executeScript).not.toHaveBeenCalled();
    expect(response).toEqual({
      ok: false,
      error: {
        code: "ERR_XHS_SIGN_FORBIDDEN",
        message: "xhs-sign request is out of allowlist scope"
      }
    });
  });

  it("returns xhs-sign failure when MAIN world executeScript fails", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    executeScript.mockRejectedValueOnce(new Error("window._webmsxyw is not available"));

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-sign-request",
        uri: "/api/sns/web/v1/search/notes",
        body: { keyword: "露营" }
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result?keyword=露营"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledTimes(1);
    expect(response).toEqual({
      ok: false,
      error: {
        code: "ERR_XHS_SIGN_FAILED",
        message: "window._webmsxyw is not available"
      }
    });
  });

  it("executes xhs main-world request in MAIN world through extension-private rpc", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    executeScript.mockResolvedValueOnce([
      {
        result: {
          status: 200,
          body: {
            code: 0,
            data: {
              items: [{ id: "note-001" }]
            }
          }
        }
      }
    ]);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-main-world-request",
        url: "/api/sns/web/v1/search/notes",
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "X-s": "signed",
          "X-t": "1700000000"
        },
        body: "{\"keyword\":\"露营\"}",
        timeout_ms: 7_000
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5&type=51"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(executeScript).toHaveBeenCalledWith(
      expect.objectContaining({
        target: { tabId: 32 },
        world: "MAIN",
        args: [
          "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          "POST",
          {
            "Content-Type": "application/json;charset=utf-8",
            "X-s": "signed",
            "X-t": "1700000000"
          },
          "{\"keyword\":\"露营\"}",
          7_000,
          undefined,
          undefined
        ]
      })
    );
    expect(response).toEqual({
      ok: true,
      result: {
        status: 200,
        body: {
          code: 0,
          data: {
            items: [{ id: "note-001" }]
          }
        }
      }
    });
  });

  it("preserves AbortError metadata when xhs main-world request executeScript times out", async () => {
    const firstPort = createMockPort();
    const { chromeApi, runtimeMessageListeners, executeScript } = createChromeApi([firstPort]);
    const timeoutError = new Error("request aborted by timeout");
    timeoutError.name = "AbortError";
    executeScript.mockRejectedValueOnce(timeoutError);

    startChromeBackgroundBridge(chromeApi);

    let response: unknown;
    runtimeMessageListeners[0]?.(
      {
        kind: "xhs-main-world-request",
        url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "X-s": "signed",
          "X-t": "1700000000"
        },
        body: "{\"keyword\":\"露营\"}",
        timeout_ms: 7_000
      },
      {
        tab: {
          id: 32,
          url: "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5&type=51"
        }
      },
      (message) => {
        response = message;
      }
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(response).toEqual({
      ok: false,
      error: {
        code: "ERR_XHS_MAIN_WORLD_REQUEST_FAILED",
        message: "request aborted by timeout",
        name: "AbortError"
      }
    });
  });
});
