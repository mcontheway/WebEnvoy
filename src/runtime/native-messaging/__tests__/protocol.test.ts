import { describe, expect, it } from "vitest";

import {
  BRIDGE_PROTOCOL,
  createBridgeForwardRequest,
  createBridgeOpenRequest,
  createHeartbeatRequest,
  ensureBridgeRequestEnvelope
} from "../protocol.js";

describe("native messaging protocol", () => {
  it("builds bridge.open with protocol version", () => {
    const request = createBridgeOpenRequest({
      id: "bridge-open-001",
      profile: "profile-a"
    });

    expect(request).toMatchObject({
      id: "bridge-open-001",
      method: "bridge.open",
      profile: "profile-a",
      timeout_ms: 30_000,
      params: {
        protocol: BRIDGE_PROTOCOL
      }
    });
  });

  it("builds bridge.forward with timeout budget", () => {
    const request = createBridgeForwardRequest({
      id: "run-001",
      profile: "profile-a",
      sessionId: "nm-session-001",
      runId: "run-001",
      command: "runtime.ping",
      commandParams: { hello: "world" },
      cwd: "/tmp",
      timeoutMs: 1234
    });

    expect(request.timeout_ms).toBe(1234);
    expect(request.params).toMatchObject({
      session_id: "nm-session-001",
      run_id: "run-001",
      command: "runtime.ping",
      command_params: { hello: "world" },
      cwd: "/tmp"
    });
  });

  it("builds heartbeat request envelope", () => {
    const request = createHeartbeatRequest({
      id: "hb-001",
      sessionId: "nm-session-001"
    });

    expect(request).toMatchObject({
      id: "hb-001",
      method: "__ping__"
    });
  });

  it("rejects invalid request envelope", () => {
    expect(() =>
      ensureBridgeRequestEnvelope({
        id: "",
        method: "bridge.unknown",
        params: {}
      })
    ).toThrowError(/invalid request envelope/i);
  });
});
