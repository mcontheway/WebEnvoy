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
