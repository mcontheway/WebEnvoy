import { describe, expect, it } from "vitest";

import { BackgroundRelay } from "../extension/background.js";
import { ContentScriptHandler } from "../extension/content-script.js";

type BridgeResponse = {
  id: string;
  status: "success" | "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null | { code: string; message: string };
};

const waitForResponse = (relay: BackgroundRelay, timeoutMs = 500): Promise<BridgeResponse> =>
  new Promise((resolve, reject) => {
    const off = relay.onNativeMessage((message) => {
      off();
      clearTimeout(timer);
      resolve(message);
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error("did not receive relay response in time"));
    }, timeoutMs);
  });

describe("extension background relay contract", () => {
  it("returns ERR_TRANSPORT_FORWARD_FAILED when content script is unreachable", async () => {
    const contentScript = new ContentScriptHandler();
    contentScript.setReachable(false);
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 20 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-unreachable-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-001",
        command: "runtime.ping",
        command_params: {}
      }
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_TRANSPORT_FORWARD_FAILED");
  });

  it("returns ERR_TRANSPORT_TIMEOUT when content script does not respond", async () => {
    const contentScript = new ContentScriptHandler();
    const relay = new BackgroundRelay(contentScript, { forwardTimeoutMs: 10 });

    const responsePromise = waitForResponse(relay);
    relay.onNativeRequest({
      id: "forward-timeout-001",
      method: "bridge.forward",
      params: {
        session_id: "nm-session-001",
        run_id: "run-002",
        command: "runtime.ping",
        command_params: {
          simulate_no_response: true
        }
      }
    });

    const response = await responsePromise;
    expect(response.status).toBe("error");
    expect(response.error?.code).toBe("ERR_TRANSPORT_TIMEOUT");
  });
});
