import { describe, expect, it } from "vitest";

import {
  NativeMessagingBridge,
  NativeMessagingTransportError,
  createFakeNativeBridgeTransport
} from "../bridge.js";
import type { BridgeRequestEnvelope, BridgeResponseEnvelope } from "../protocol.js";

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

  it("uses one shared timeout budget across open heartbeat and forward", async () => {
    let nowMs = 0;
    const now = (): number => {
      const current = nowMs;
      nowMs += 5;
      return current;
    };

    const transport = {
      async open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
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
      async heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        return {
          id: request.id,
          status: "success",
          summary: {
            session_id: "nm-session-001"
          },
          error: null
        };
      },
      async forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        if ((request.timeout_ms ?? 0) < 5) {
          throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "transport timeout");
        }
        return {
          id: request.id,
          status: "success",
          summary: {
            session_id: "nm-session-001",
            run_id: String(request.params.run_id ?? request.id),
            command: "runtime.ping"
          },
          payload: {
            message: "pong"
          },
          error: null
        };
      }
    };

    const bridge = new NativeMessagingBridge({
      transport,
      now
    });

    await expect(
      bridge.runtimePing({
        runId: "run-budget-chain",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 15
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

  it("returns timeout when request budget exhausts before recovery window", async () => {
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
      code: "ERR_TRANSPORT_TIMEOUT"
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

  it("keeps retrying recoverable failures within recovery window", async () => {
    let openCall = 0;
    let forwardCall = 0;

    const transport = {
      async open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        openCall += 1;
        if (openCall === 2) {
          throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "open timeout");
        }
        if (openCall === 3) {
          throw new NativeMessagingTransportError(
            "ERR_TRANSPORT_DISCONNECTED",
            "open disconnected"
          );
        }
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
      async forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        if (forwardCall === 1) {
          throw new NativeMessagingTransportError(
            "ERR_TRANSPORT_DISCONNECTED",
            "forward disconnected"
          );
        }
        return {
          id: request.id,
          status: "success",
          summary: {
            session_id: "nm-session-001",
            run_id: String(request.params.run_id ?? request.id),
            command: "runtime.ping",
            relay_path: "host>background>content-script>background>host"
          },
          payload: {
            message: "pong"
          },
          error: null
        };
      },
      async heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        return {
          id: request.id,
          status: "success",
          summary: {
            session_id: "nm-session-001"
          },
          error: null
        };
      }
    };

    const bridge = new NativeMessagingBridge({
      transport,
      recoveryPollIntervalMs: 1
    });

    await expect(
      bridge.runtimePing({
        runId: "run-retry-phase-1",
        profile: "profile-a",
        cwd: "/tmp",
        params: {
          timeout_ms: 80
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });

    const result = await bridge.runtimePing({
      runId: "run-retry-phase-2",
      profile: "profile-a",
      cwd: "/tmp",
      params: {
        timeout_ms: 80
      }
    });
    expect(result.message).toBe("pong");
    expect(result.transport.state).toBe("ready");
    expect(openCall).toBeGreaterThanOrEqual(4);
  });
});
