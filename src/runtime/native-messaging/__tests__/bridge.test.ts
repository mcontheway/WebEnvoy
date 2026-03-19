import { describe, expect, it } from "vitest";

import {
  NativeMessagingBridge,
  NativeMessagingTransportError,
  createFakeNativeBridgeTransport
} from "../bridge.js";

describe("native messaging bridge", () => {
  it("returns pong via forward round trip", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport()
    });

    const result = await bridge.runtimePing({
      runId: "run-001",
      profile: "profile-a",
      cwd: "/tmp",
      params: {}
    });

    expect(result).toMatchObject({
      message: "pong",
      transport: {
        state: "ready",
        protocol: "webenvoy.native-bridge.v1"
      }
    });
  });

  it("maps timeout to transport timeout error", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        forwardDelayMs: 40
      })
    });

    await expect(
      bridge.runtimePing({
        runId: "run-timeout",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_TIMEOUT"
    });
  });

  it("maps socket transport timeout marker to ERR_TRANSPORT_TIMEOUT", async () => {
    const bridge = new NativeMessagingBridge({
      transport: {
        async open(request) {
          return {
            id: request.id,
            status: "success",
            summary: {
              protocol: "webenvoy.native-bridge.v1",
              session_id: "nm-session-001",
              state: "ready"
            },
            error: null
          };
        },
        async heartbeat(request) {
          return {
            id: request.id,
            status: "success",
            summary: {
              session_id: "nm-session-001"
            },
            error: null
          };
        },
        async forward() {
          throw Object.assign(new Error("native bridge socket timeout"), {
            transportCode: "ERR_TRANSPORT_TIMEOUT"
          });
        }
      }
    });

    await expect(
      bridge.runtimePing({
        runId: "run-socket-timeout",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_TIMEOUT"
    });
  });

  it("prioritizes disconnected over timeout", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        disconnectOnForward: true,
        forwardDelayMs: 40
      })
    });

    await expect(
      bridge.runtimePing({
        runId: "run-disconnect",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
  });

  it("fails when handshake cannot be established", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        failHandshake: true
      })
    });

    await expect(
      bridge.runtimePing({
        runId: "run-handshake-fail",
        profile: "profile-a",
        cwd: "/tmp",
        params: {}
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_HANDSHAKE_FAILED"
    });
  });

  it("fails handshake on incompatible protocol version", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        incompatibleProtocol: true
      })
    });

    await expect(
      bridge.runtimePing({
        runId: "run-protocol-fail",
        profile: "profile-a",
        cwd: "/tmp",
        params: {}
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_HANDSHAKE_FAILED"
    });
  });

  it("returns disconnected after recovery window/timeout is exhausted", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        disconnectOnForward: true,
        failHandshakeAfterFirstOpen: true
      }),
      recoveryPollIntervalMs: 1
    });

    await expect(
      bridge.runtimePing({
        runId: "run-trigger-disconnect",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });

    await expect(
      bridge.runtimePing({
        runId: "run-recover-fail",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
  });

  it("maps heartbeat disconnect to ERR_TRANSPORT_DISCONNECTED", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        heartbeatDisconnect: true
      })
    });

    await expect(
      bridge.runtimePing({
        runId: "run-heartbeat-disconnect",
        profile: "profile-a",
        cwd: "/tmp",
        params: {}
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
  });

  it("maps heartbeat timeout to ERR_TRANSPORT_DISCONNECTED", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createFakeNativeBridgeTransport({
        heartbeatDelayMs: 20
      }),
      heartbeatTimeoutMs: 5
    });

    await expect(
      bridge.runtimePing({
        runId: "run-heartbeat-timeout",
        profile: "profile-a",
        cwd: "/tmp",
        params: {}
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
  });
});
