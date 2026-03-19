import { describe, expect, it } from "vitest";

import { NativeMessagingBridge } from "../bridge.js";
import { createLoopbackNativeBridgeTransport } from "../loopback.js";

describe("native messaging default loopback chain", () => {
  it("uses host -> background -> content-script -> background -> host path by default", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });
    const result = await bridge.runtimePing({
      runId: "run-loopback-001",
      profile: "profile-a",
      cwd: "/tmp",
      params: {}
    });

    expect(result.transport).toMatchObject({
      relay_path: "host>background>content-script>background>host",
      state: "ready",
      protocol: "webenvoy.native-bridge.v1"
    });
    expect(result.message).toBe("pong");
  });
});
