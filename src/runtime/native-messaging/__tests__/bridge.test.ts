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

  it("exposes the real bridge session id after handshake", async () => {
    const bridge = new NativeMessagingBridge({
      transport: {
        async open(request) {
          return {
            id: request.id,
            status: "success",
            summary: {
              protocol: "webenvoy.native-bridge.v1",
              session_id: "nm-session-real-209",
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
              session_id: "nm-session-real-209"
            },
            error: null
          };
        },
        async forward(request) {
          return {
            id: request.id,
            status: "success",
            summary: {
              session_id: "nm-session-real-209",
              run_id: String(request.params.run_id ?? request.id),
              command: String(request.params.command ?? "runtime.ping")
            },
            payload: {
              message: "pong"
            },
            error: null
          };
        }
      }
    });

    expect(bridge.currentSessionId()).toBeNull();
    await expect(
      bridge.ensureSession({
        profile: "profile-a"
      })
    ).resolves.toBe("nm-session-real-209");
    expect(bridge.currentSessionId()).toBe("nm-session-real-209");
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

  it("closes the underlying transport when the bridge is disposed", async () => {
    let closeCount = 0;
    const bridge = new NativeMessagingBridge({
      transport: {
        ...createFakeNativeBridgeTransport(),
        close() {
          closeCount += 1;
        }
      }
    });

    await bridge.close();

    expect(closeCount).toBe(1);
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

  it("does not replay non-idempotent live_write editor_input commands after forward disconnect", async () => {
    let forwardCall = 0;
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
      async forward(): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_DISCONNECTED",
          "forward disconnected"
        );
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
      transport
    });

    await expect(
      bridge.runCommand({
        runId: "run-no-replay-001",
        profile: "profile-a",
        cwd: "/tmp",
        command: "xhs.search",
        params: {
          requested_execution_mode: "live_write",
          options: {
            validation_action: "editor_input"
          }
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
    expect(forwardCall).toBe(1);
  });

  it("does not replay runtime.bootstrap after forward disconnect", async () => {
    let forwardCall = 0;
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
      async forward(): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_DISCONNECTED",
          "forward disconnected"
        );
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
      transport
    });

    await expect(
      bridge.runCommand({
        runId: "run-no-bootstrap-replay-001",
        profile: "profile-a",
        cwd: "/tmp",
        command: "runtime.bootstrap",
        params: {
          target_tab_id: 1362079329,
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
    expect(forwardCall).toBe(1);
  });

  it("does not replay runtime.start after forward disconnect", async () => {
    let forwardCall = 0;
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
      async forward(): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_DISCONNECTED",
          "forward disconnected"
        );
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
      transport
    });

    await expect(
      bridge.runCommand({
        runId: "run-no-start-replay-001",
        profile: "profile-a",
        cwd: "/tmp",
        command: "runtime.start",
        params: {
          profile: "profile-a",
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
    expect(forwardCall).toBe(1);
  });

  it("does not replay runtime.login after forward disconnect", async () => {
    let forwardCall = 0;
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
      async forward(): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_DISCONNECTED",
          "forward disconnected"
        );
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
      transport
    });

    await expect(
      bridge.runCommand({
        runId: "run-no-login-replay-001",
        profile: "profile-a",
        cwd: "/tmp",
        command: "runtime.login",
        params: {
          profile: "profile-a",
          timeout_ms: 10
        }
      })
    ).rejects.toMatchObject<Partial<NativeMessagingTransportError>>({
      code: "ERR_TRANSPORT_DISCONNECTED"
    });
    expect(forwardCall).toBe(1);
  });

  it("retries idempotent runCommand after recoverable forward disconnect", async () => {
    let forwardCall = 0;
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
            relay_path: "host>background>content-script>background>host"
          },
          payload: {
            summary: {
              capability_result: {
                outcome: "success"
              }
            }
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

    const result = await bridge.runCommand({
      runId: "run-replay-idempotent-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        requested_execution_mode: "live_read_limited",
        options: {}
      }
    });

    expect(result).toMatchObject({
      ok: true
    });
    expect(forwardCall).toBe(2);
  });

  it("rebinds synthesized issue_209 admission_context after session recovery", async () => {
    const decisionId = "gate_decision_issue209-gate-run-recovery-admission-session-001-001";
    const approvalId = "gate_appr_gate_decision_issue209-gate-run-recovery-admission-session-001-001";
    let openCall = 0;
    let forwardCall = 0;
    const forwardedSessions: Array<{
      requestSessionId: string;
      admissionContextSessionId: string | null;
    }> = [];
    const currentSessionId = (): string => (openCall >= 2 ? "nm-session-002" : "nm-session-001");

    const transport = {
      async open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        openCall += 1;
        return {
          id: request.id,
          status: "success",
          summary: {
            protocol: "webenvoy.native-bridge.v1",
            session_id: currentSessionId(),
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
            session_id: currentSessionId()
          },
          error: null
        };
      },
      async forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        const commandParams = request.params.command_params as Record<string, unknown>;
        const options = commandParams.options as Record<string, unknown>;
        const admissionContext = options.admission_context as Record<string, unknown> | undefined;
        const approvalEvidence = admissionContext?.approval_admission_evidence as
          | Record<string, unknown>
          | undefined;
        forwardedSessions.push({
          requestSessionId: String(request.params.session_id ?? ""),
          admissionContextSessionId:
            typeof approvalEvidence?.session_id === "string" ? approvalEvidence.session_id : null
        });

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
            relay_path: "host>background>content-script>background>host"
          },
          payload: {
            summary: {
              capability_result: {
                outcome: "success"
              }
            }
          },
          error: null
        };
      }
    };

    const bridge = new NativeMessagingBridge({
      transport,
      recoveryPollIntervalMs: 1
    });

    const result = await bridge.runCommand({
      runId: "run-recovery-admission-session-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: "issue209-live-recovery-001",
        requested_execution_mode: "live_read_limited",
        gate_invocation_id: "issue209-gate-run-recovery-admission-session-001-001",
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: {
            event_id: "gate_evt_issue209_live_recovery_001",
            decision_id: decisionId,
            approval_id: approvalId,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 12,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            gate_decision: "allowed",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:05:00Z"
          }
        }
      }
    });

    expect(result).toMatchObject({
      ok: true
    });
    expect(forwardedSessions).toEqual([
      {
        requestSessionId: "nm-session-001",
        admissionContextSessionId: "nm-session-001"
      },
      {
        requestSessionId: "nm-session-002",
        admissionContextSessionId: "nm-session-002"
      }
    ]);
  });

  it("rebinds explicit issue_209 admission_context after session recovery", async () => {
    let openCall = 0;
    let forwardCall = 0;
    const forwardedSessions: Array<{
      requestSessionId: string;
      approvalSessionId: string | null;
      auditSessionId: string | null;
    }> = [];
    const currentSessionId = (): string => (openCall >= 2 ? "nm-session-002" : "nm-session-001");

    const transport = {
      async open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        openCall += 1;
        return {
          id: request.id,
          status: "success",
          summary: {
            protocol: "webenvoy.native-bridge.v1",
            session_id: currentSessionId(),
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
            session_id: currentSessionId()
          },
          error: null
        };
      },
      async forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
        forwardCall += 1;
        const commandParams = request.params.command_params as Record<string, unknown>;
        const options = commandParams.options as Record<string, unknown>;
        const admissionContext = options.admission_context as Record<string, unknown> | undefined;
        const approvalEvidence = admissionContext?.approval_admission_evidence as
          | Record<string, unknown>
          | undefined;
        const auditEvidence = admissionContext?.audit_admission_evidence as
          | Record<string, unknown>
          | undefined;
        forwardedSessions.push({
          requestSessionId: String(request.params.session_id ?? ""),
          approvalSessionId:
            typeof approvalEvidence?.session_id === "string" ? approvalEvidence.session_id : null,
          auditSessionId: typeof auditEvidence?.session_id === "string" ? auditEvidence.session_id : null
        });

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
            relay_path: "host>background>content-script>background>host"
          },
          payload: {
            summary: {
              capability_result: {
                outcome: "success"
              }
            }
          },
          error: null
        };
      }
    };

    const bridge = new NativeMessagingBridge({
      transport,
      recoveryPollIntervalMs: 1
    });

    const result = await bridge.runCommand({
      runId: "run-recovery-admission-explicit-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: "issue209-live-recovery-explicit-001",
        requested_execution_mode: "live_read_limited",
        gate_invocation_id: "issue209-gate-run-recovery-admission-explicit-001-001",
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          admission_context: {
            approval_admission_evidence: {
              approval_admission_ref: "approval_admission_explicit_001",
              run_id: "run-recovery-admission-explicit-001",
              session_id: "nm-session-stale-001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 12,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              approved: true,
              approver: "qa-reviewer",
              approved_at: "2026-03-23T10:00:00Z",
              checks: {
                target_domain_confirmed: true,
                target_tab_confirmed: true,
                target_page_confirmed: true,
                risk_state_checked: true,
                action_type_confirmed: true
              },
              recorded_at: "2026-03-23T10:00:00Z"
            },
            audit_admission_evidence: {
              audit_admission_ref: "audit_admission_explicit_001",
              run_id: "run-recovery-admission-explicit-001",
              session_id: "nm-session-stale-001",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 12,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              risk_state: "limited",
              audited_checks: {
                target_domain_confirmed: true,
                target_tab_confirmed: true,
                target_page_confirmed: true,
                risk_state_checked: true,
                action_type_confirmed: true
              },
              recorded_at: "2026-03-23T10:05:00Z"
            }
          }
        }
      }
    });

    expect(result).toMatchObject({
      ok: true
    });
    expect(forwardedSessions).toEqual([
      {
        requestSessionId: "nm-session-001",
        approvalSessionId: "nm-session-001",
        auditSessionId: "nm-session-001"
      },
      {
        requestSessionId: "nm-session-002",
        approvalSessionId: "nm-session-002",
        auditSessionId: "nm-session-002"
      }
    ]);
  });

  it("materializes granted_at from requested_at before forwarding canonical live admission", async () => {
    let forwardedCommandParams: Record<string, unknown> | null = null;

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
        async forward(request) {
          forwardedCommandParams = request.params.command_params as Record<string, unknown>;
          return {
            id: request.id,
            status: "success",
            summary: {
              relay_path: "host>background>content-script>background>host"
            },
            payload: {
              summary: {
                capability_result: {
                  outcome: "success"
                }
              }
            },
            error: null
          };
        }
      }
    });

    await bridge.runCommand({
      runId: "run-canonical-requested-at-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: "issue493-canonical-live-001",
        upstream_authorization_request: {
          action_request: {
            action_name: "xhs.read_search_results",
            requested_at: "2026-04-18T01:02:03.000Z"
          },
          authorization_grant: {
            grant_ref: "grant-001",
            approval_refs: ["approval-001"],
            audit_refs: ["audit-001"],
            resource_state_snapshot: "active"
          }
        },
        options: {}
      }
    });

    const topLevelUpstream = forwardedCommandParams?.upstream_authorization_request as
      | Record<string, unknown>
      | undefined;
    const topLevelGrant = topLevelUpstream?.authorization_grant as Record<string, unknown> | undefined;
    const optionUpstream = (forwardedCommandParams?.options as Record<string, unknown> | undefined)
      ?.upstream_authorization_request as Record<string, unknown> | undefined;
    const optionGrant = optionUpstream?.authorization_grant as Record<string, unknown> | undefined;

    expect(topLevelGrant?.granted_at).toBe("2026-04-18T01:02:03.000Z");
    expect(optionGrant?.granted_at).toBe("2026-04-18T01:02:03.000Z");
  });
});
