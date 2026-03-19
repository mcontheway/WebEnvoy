import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  createBridgeForwardRequest,
  createBridgeOpenRequest
} from "../protocol.js";
import { NativeHostBridgeTransport, parseNativeHostCommand } from "../host.js";

describe("native host bridge transport classification", () => {
  it("parses quoted native host command with spaces", () => {
    const parsed = parseNativeHostCommand(
      `"${process.execPath}" "/tmp/mock folder/native-host.mjs" --mode smoke`
    );
    expect(parsed).toEqual({
      file: process.execPath,
      args: ["/tmp/mock folder/native-host.mjs", "--mode", "smoke"]
    });
  });

  it("rejects empty native host command", () => {
    expect(parseNativeHostCommand("   ")).toBeNull();
  });

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

  it("classifies open response timeout as timeout error", async () => {
    const mockNativeHostPath = path.resolve(
      path.join(import.meta.dirname, "../../../../tests/fixtures/native-host-mock.mjs")
    );
    const hostCommand = `"${process.execPath}" "${mockNativeHostPath}"`;
    const previousMode = process.env.WEBENVOY_NATIVE_HOST_MODE;
    process.env.WEBENVOY_NATIVE_HOST_MODE = "drop-open";

    try {
      const transport = new NativeHostBridgeTransport(hostCommand);
      await expect(
        transport.open(
          createBridgeOpenRequest({
            id: "open-timeout-001",
            profile: "profile-a",
            timeoutMs: 50
          })
        )
      ).rejects.toMatchObject({
        transportCode: "ERR_TRANSPORT_TIMEOUT"
      });
    } finally {
      if (previousMode === undefined) {
        delete process.env.WEBENVOY_NATIVE_HOST_MODE;
      } else {
        process.env.WEBENVOY_NATIVE_HOST_MODE = previousMode;
      }
    }
  });
});
