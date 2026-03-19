import { describe, expect, it } from "vitest";

import {
  createBridgeForwardRequest,
  createBridgeOpenRequest
} from "../protocol.js";
import { NativeHostBridgeTransport } from "../host.js";

describe("native host bridge transport classification", () => {
  it("classifies open without configured native host command as handshake failed", async () => {
    const transport = new NativeHostBridgeTransport(null);
    await expect(
      transport.open(
        createBridgeOpenRequest({
          id: "open-invalid-001",
          profile: "profile-a",
          timeoutMs: 100
        })
      )
    ).rejects.toMatchObject({
      transportCode: "ERR_TRANSPORT_HANDSHAKE_FAILED"
    });
  });

  it("classifies forward without configured native host command as disconnected", async () => {
    const transport = new NativeHostBridgeTransport(null);

    await expect(
      transport.forward(
        createBridgeForwardRequest({
          id: "forward-invalid-001",
          profile: "profile-a",
          sessionId: "nm-session-001",
          runId: "run-forward-invalid-001",
          command: "runtime.ping",
          commandParams: {},
          cwd: "/tmp",
          timeoutMs: 100
        })
      )
    ).rejects.toMatchObject({
      transportCode: "ERR_TRANSPORT_DISCONNECTED"
    });
  });
});
