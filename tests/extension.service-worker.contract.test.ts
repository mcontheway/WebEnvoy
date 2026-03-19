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
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chromeApi.tabs.sendMessage).toHaveBeenCalledWith(
      11,
      expect.objectContaining({
        id: "run-001",
        runId: "run-001",
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
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
});
