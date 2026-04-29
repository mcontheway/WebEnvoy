#!/usr/bin/env node

const mode = process.env.WEBENVOY_NATIVE_HOST_MODE || "success";
let buffer = Buffer.alloc(0);
let openCompleted = false;

const writeMessage = (message) => {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
};

const success = (request, extra = {}) => ({
  id: request.id,
  status: "success",
  summary: {
    session_id: String(request.params?.session_id ?? "nm-session-001"),
    run_id: String(request.params?.run_id ?? request.id),
    command: String(request.params?.command ?? "runtime.ping"),
    relay_path: "host>background>content-script>background>host",
    ...extra
  },
  payload: {
    message: "pong",
    run_id: String(request.params?.run_id ?? request.id),
    profile: request.profile ?? null,
    cwd: String(request.params?.cwd ?? "")
  },
  error: null
});

const bootstrapAck = (request, result) => ({
  id: request.id,
  status: "success",
  summary: {
    session_id: String(request.params?.session_id ?? "nm-session-001"),
    run_id: String(request.params?.run_id ?? request.id),
    command: String(request.params?.command ?? "runtime.bootstrap"),
    relay_path: "host>background>content-script>background>host"
  },
  payload: {
    result
  },
  error: null
});

const onRequest = (request) => {
  if (request.method === "bridge.open") {
    if (mode === "drop-open") {
      setTimeout(() => process.exit(0), 300);
      return;
    }
    if (mode === "fail-open") {
      writeMessage({
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_HANDSHAKE_FAILED",
          message: "mock handshake failure"
        }
      });
      process.exit(0);
      return;
    }
    openCompleted = true;
    writeMessage({
      id: request.id,
      status: "success",
      summary: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready",
        session_id: "nm-session-001"
      },
      error: null
    });
    return;
  }

  if (request.method === "__ping__") {
    if (mode === "drop-heartbeat") {
      setTimeout(() => process.exit(0), 300);
      return;
    }
    writeMessage({
      id: request.id,
      status: "success",
      summary: {
        session_id: "nm-session-001"
      },
      error: null
    });
    return;
  }

  if (request.method === "bridge.forward") {
    if (!openCompleted) {
      writeMessage({
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_NOT_READY",
          message: "open is required"
        }
      });
      return;
    }

    if (mode === "disconnect-on-forward") {
      process.exit(0);
      return;
    }

    if (mode === "drop-forward") {
      setTimeout(() => process.exit(0), 300);
      return;
    }

    const command = String(request.params?.command ?? "runtime.ping");
    const commandParams =
      request.params?.command_params &&
      typeof request.params.command_params === "object" &&
      !Array.isArray(request.params.command_params)
        ? request.params.command_params
        : {};

    if (command === "runtime.readiness" && mode === "runtime-readiness-ready") {
      writeMessage({
        id: request.id,
        status: "success",
        summary: {
          session_id: String(request.params?.session_id ?? "nm-session-001"),
          run_id: String(request.params?.run_id ?? request.id),
          command,
          relay_path: "host>background"
        },
        payload: {
          transport_state: "ready",
          bootstrap_state: "ready"
        },
        error: null
      });
      process.exit(0);
      return;
    }

    if (command === "runtime.bootstrap") {
      if (mode === "bootstrap-ack-timeout-error") {
        writeMessage({
          id: request.id,
          status: "error",
          summary: {
            session_id: String(request.params?.session_id ?? "nm-session-001"),
            run_id: String(request.params?.run_id ?? request.id),
            command,
            relay_path: "host>background>content-script>background>host"
          },
          payload: {},
          error: {
            code: "ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT",
            message: "mock bootstrap ack timeout"
          }
        });
        process.exit(0);
        return;
      }

      if (mode === "bootstrap-stale") {
        writeMessage(
          bootstrapAck(request, {
            version: String(commandParams.version ?? "v1"),
            run_id: String(commandParams.run_id ?? request.id),
            runtime_context_id: String(commandParams.runtime_context_id ?? "runtime-context-001"),
            profile: request.profile ?? null,
            status: "stale"
          })
        );
        process.exit(0);
        return;
      }

      if (mode === "bootstrap-ready-signal-conflict") {
        writeMessage(
          bootstrapAck(request, {
            version: String(commandParams.version ?? "v1"),
            run_id: String(commandParams.run_id ?? request.id),
            runtime_context_id: "unexpected-runtime-context",
            profile: request.profile ?? null,
            status: "ready"
          })
        );
        process.exit(0);
        return;
      }
    }

    if (command === "runtime.tabs") {
      writeMessage({
        id: request.id,
        status: "success",
        summary: {
          session_id: String(request.params?.session_id ?? "nm-session-001"),
          run_id: String(request.params?.run_id ?? request.id),
          command,
          relay_path: "host>background"
        },
        payload: {
          tabs: [
            {
              tab_id: 10857874,
              active: true,
              url: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5&type=51"
            }
          ]
        },
        error: null
      });
      process.exit(0);
      return;
    }

    if (command === "runtime.restore_xhs_target" && mode === "restore-target-input-invalid") {
      writeMessage({
        id: request.id,
        status: "error",
        summary: {
          session_id: String(request.params?.session_id ?? "nm-session-001"),
          run_id: String(request.params?.run_id ?? request.id),
          command,
          profile: request.profile ?? null,
          relay_path: "host>background"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "TARGET_RESTORE_INPUT_INVALID",
            target_domain: commandParams.target_domain ?? null,
            target_page: commandParams.target_page ?? null,
            active_fetch_performed: false,
            closeout_bundle_entered: false
          }
        },
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "runtime.restore_xhs_target requires XHS search_result target and query"
        }
      });
      process.exit(0);
      return;
    }

    if (command === "runtime.restore_xhs_target" && mode === "restore-target-not-found") {
      writeMessage({
        id: request.id,
        status: "error",
        summary: {
          session_id: String(request.params?.session_id ?? "nm-session-001"),
          run_id: String(request.params?.run_id ?? request.id),
          command,
          profile: request.profile ?? null,
          relay_path: "host>background"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "TARGET_RESTORE_TARGET_TAB_NOT_FOUND",
            requested_target_tab_id: commandParams.target_tab_id ?? null,
            active_fetch_performed: false,
            closeout_bundle_entered: false
          }
        },
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "runtime.restore_xhs_target could not find target_tab_id"
        }
      });
      process.exit(0);
      return;
    }

    if (command === "runtime.restore_xhs_target" && mode === "restore-target-tab-id-unavailable") {
      writeMessage({
        id: request.id,
        status: "error",
        summary: {
          session_id: String(request.params?.session_id ?? "nm-session-001"),
          run_id: String(request.params?.run_id ?? request.id),
          command,
          profile: request.profile ?? null,
          relay_path: "host>background"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "TARGET_TAB_ID_UNAVAILABLE",
            target_url: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5&type=51",
            active_fetch_performed: false,
            closeout_bundle_entered: false
          }
        },
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "restored target tab id is unavailable"
        }
      });
      process.exit(0);
      return;
    }

    writeMessage(success(request));
    process.exit(0);
  }
};

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const frameLength = buffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (buffer.length < frameEnd) {
      return;
    }
    const frame = buffer.subarray(4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    const request = JSON.parse(frame.toString("utf8"));
    onRequest(request);
  }
});
