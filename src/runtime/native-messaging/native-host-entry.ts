import { mkdir, rm } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";

import {
  BRIDGE_PROTOCOL,
  ensureBridgeRequestEnvelope,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope
} from "./protocol.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "./host.js";

const DEFAULT_SESSION_ID = "nm-session-001";
const RELAY_PATH = "host>background>content-script>background>host";
const PROFILE_DIR = process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR?.trim() ?? "";
const SOCKET_PATH = PROFILE_DIR
  ? join(PROFILE_DIR, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME)
  : null;

let nativeReadBuffer = Buffer.alloc(0);
let sessionId = DEFAULT_SESSION_ID;
let extensionOpened = false;
let shuttingDown = false;
let socketServer: Server | null = null;
const socketBuffers = new WeakMap<Socket, Buffer>();
const pendingSocketResponses = new Map<
  string,
  {
    socket: Socket;
  }
>();
const activeSockets = new Set<Socket>();

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const isBridgeResponse = (value: unknown): value is BridgeResponseEnvelope => {
  const record = asRecord(value);
  return (
    typeof record.id === "string" &&
    (record.status === "success" || record.status === "error") &&
    record.error !== undefined
  );
};

type NativeEnvelope = BridgeRequestEnvelope | BridgeResponseEnvelope | Record<string, unknown>;

const encodeEnvelope = (envelope: NativeEnvelope): Buffer => {
  const payload = Buffer.from(JSON.stringify(envelope), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
};

const writeNativeEnvelope = (
  envelope: NativeEnvelope,
  onFlushed?: () => void
): void => {
  process.stdout.write(encodeEnvelope(envelope), () => {
    onFlushed?.();
  });
};

const writeSocketEnvelope = (socket: Socket, envelope: NativeEnvelope): void => {
  if (socket.destroyed) {
    return;
  }
  socket.end(encodeEnvelope(envelope));
};

const buildErrorEnvelope = (
  request: Pick<BridgeRequestEnvelope, "id">,
  input: {
    code: string;
    message: string;
    summary?: Record<string, unknown>;
  }
): BridgeResponseEnvelope => ({
  id: request.id,
  status: "error",
  summary: input.summary ?? {},
  error: {
    code: input.code,
    message: input.message
  }
});

const buildSuccessEnvelope = (
  request: Pick<BridgeRequestEnvelope, "id">,
  input: {
    summary: Record<string, unknown>;
    payload?: Record<string, unknown>;
  }
): BridgeResponseEnvelope => ({
  id: request.id,
  status: "success",
  summary: input.summary,
  ...(input.payload ? { payload: input.payload } : {}),
  error: null
});

const buildStubForwardPayload = (request: BridgeRequestEnvelope): Record<string, unknown> => {
  const command = asString(request.params.command) ?? "runtime.ping";
  const runId = asString(request.params.run_id) ?? request.id;
  const cwd = asString(request.params.cwd) ?? "";
  const commandParams = asRecord(request.params.command_params);
  const runtimeContextId = asString(commandParams.runtime_context_id) ?? "runtime-context-001";

  if (command === "runtime.bootstrap") {
    return {
      result: {
        version: asString(commandParams.version) ?? "v1",
        run_id: runId,
        runtime_context_id: runtimeContextId,
        profile: request.profile,
        status: "ready"
      }
    };
  }

  return {
    message: "pong",
    run_id: runId,
    profile: request.profile ?? null,
    cwd
  };
};

const writeNativeSuccess = (
  request: Pick<BridgeRequestEnvelope, "id">,
  input: {
    summary: Record<string, unknown>;
    payload?: Record<string, unknown>;
  },
  onFlushed?: () => void
): void => {
  writeNativeEnvelope(buildSuccessEnvelope(request, input), onFlushed);
};

const writeNativeError = (
  request: Pick<BridgeRequestEnvelope, "id">,
  input: {
    code: string;
    message: string;
    summary?: Record<string, unknown>;
  }
): void => {
  writeNativeEnvelope(buildErrorEnvelope(request, input));
};

const failPendingSocketResponses = (input: { code: string; message: string }): void => {
  for (const [id, pending] of pendingSocketResponses.entries()) {
    writeSocketEnvelope(
      pending.socket,
      buildErrorEnvelope(
        {
          id
        },
        {
          code: input.code,
          message: input.message,
          summary: {
            relay_path: RELAY_PATH
          }
        }
      )
    );
    pendingSocketResponses.delete(id);
  }
};

const cleanupSocketServer = async (): Promise<void> => {
  const current = socketServer;
  if (current) {
    await new Promise<void>((resolve) => {
      socketServer = null;
      current.close(() => resolve());
    });
  }
  if (SOCKET_PATH) {
    await rm(SOCKET_PATH, { force: true }).catch(() => undefined);
  }
};

const shutdown = async (code = 0): Promise<void> => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  failPendingSocketResponses({
    code: "ERR_TRANSPORT_DISCONNECTED",
    message: "native messaging disconnected"
  });
  for (const socket of activeSockets) {
    socket.destroy();
  }
  await cleanupSocketServer();
  process.exit(code);
};

const ensureSocketServer = async (): Promise<void> => {
  if (!SOCKET_PATH || socketServer) {
    return;
  }

  await mkdir(PROFILE_DIR, { recursive: true });
  await rm(SOCKET_PATH, { force: true }).catch(() => undefined);

  socketServer = createServer((socket) => {
    activeSockets.add(socket);
    socketBuffers.set(socket, Buffer.alloc(0));

    socket.on("data", (chunk: Buffer) => {
      const next = Buffer.concat([socketBuffers.get(socket) ?? Buffer.alloc(0), chunk]);
      socketBuffers.set(socket, next);
      let buffer = next;

      while (buffer.length >= 4) {
        const frameLength = buffer.readUInt32LE(0);
        const frameEnd = 4 + frameLength;
        if (buffer.length < frameEnd) {
          break;
        }

        const frame = buffer.subarray(4, frameEnd);
        buffer = buffer.subarray(frameEnd);
        socketBuffers.set(socket, buffer);

        try {
          const request = JSON.parse(frame.toString("utf8")) as unknown;
          void handleSocketRequest(socket, request);
        } catch (error) {
          writeSocketEnvelope(
            socket,
            buildErrorEnvelope(
              {
                id: "invalid-request"
              },
              {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: error instanceof Error ? error.message : String(error)
              }
            )
          );
          return;
        }
      }
    });

    socket.on("close", () => {
      activeSockets.delete(socket);
      socketBuffers.delete(socket);
      for (const [id, pending] of pendingSocketResponses.entries()) {
        if (pending.socket === socket) {
          pendingSocketResponses.delete(id);
        }
      }
    });

    socket.on("error", () => {
      socket.destroy();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const server = socketServer;
    if (!server || !SOCKET_PATH) {
      resolve();
      return;
    }
    server.once("error", reject);
    server.listen(SOCKET_PATH, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
};

const handleSocketRequest = async (socket: Socket, rawRequest: unknown): Promise<void> => {
  try {
    ensureBridgeRequestEnvelope(rawRequest);
    const request = rawRequest;

    if (request.method === "bridge.open") {
      if (!extensionOpened) {
        writeSocketEnvelope(
          socket,
          buildErrorEnvelope(request, {
            code: "ERR_TRANSPORT_HANDSHAKE_FAILED",
            message: "extension native bridge is not ready"
          })
        );
        return;
      }
      writeSocketEnvelope(
        socket,
        buildSuccessEnvelope(request, {
          summary: {
            protocol: BRIDGE_PROTOCOL,
            state: "ready",
            session_id: sessionId
          }
        })
      );
      return;
    }

    if (request.method === "__ping__") {
      if (!extensionOpened) {
        writeSocketEnvelope(
          socket,
          buildErrorEnvelope(request, {
            code: "ERR_TRANSPORT_DISCONNECTED",
            message: "extension native bridge is not ready"
          })
        );
        return;
      }
      writeSocketEnvelope(
        socket,
        buildSuccessEnvelope(request, {
          summary: {
            session_id: sessionId
          }
        })
      );
      return;
    }

    if (!extensionOpened) {
      writeSocketEnvelope(
        socket,
        buildErrorEnvelope(request, {
          code: "ERR_TRANSPORT_NOT_READY",
          message: "bridge.open is required before bridge.forward"
        })
      );
      return;
    }

    pendingSocketResponses.set(request.id, { socket });
    writeNativeEnvelope(request);
  } catch (error) {
    writeSocketEnvelope(
      socket,
      buildErrorEnvelope(
        {
          id: "invalid-request"
        },
        {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      )
    );
  }
};

const handleExtensionBridgeOpen = async (request: BridgeRequestEnvelope): Promise<void> => {
  extensionOpened = true;
  await ensureSocketServer();
  writeNativeSuccess(request, {
    summary: {
      protocol: BRIDGE_PROTOCOL,
      state: "ready",
      session_id: sessionId
    }
  });
};

const handleExtensionHeartbeat = (request: BridgeRequestEnvelope): void => {
  const requestedSessionId = asString(request.params.session_id);
  if (requestedSessionId) {
    sessionId = requestedSessionId;
  }
  writeNativeSuccess(request, {
    summary: {
      session_id: sessionId
    }
  });
};

const handleExtensionRequest = async (request: BridgeRequestEnvelope): Promise<void> => {
  if (request.method === "bridge.open") {
    await handleExtensionBridgeOpen(request);
    return;
  }

  if (request.method === "__ping__") {
    handleExtensionHeartbeat(request);
    return;
  }

  if (!SOCKET_PATH && request.method === "bridge.forward") {
    writeNativeSuccess(
      request,
      {
        summary: {
          session_id: asString(request.params.session_id) ?? sessionId,
          run_id: asString(request.params.run_id) ?? request.id,
          command: asString(request.params.command) ?? "runtime.ping",
          relay_path: RELAY_PATH
        },
        payload: buildStubForwardPayload(request)
      },
      () => {
        process.exit(0);
      }
    );
    return;
  }

  writeNativeError(request, {
    code: "ERR_TRANSPORT_FORWARD_FAILED",
    message: `unsupported extension request: ${request.method}`
  });
};

const handleExtensionResponse = (response: BridgeResponseEnvelope): void => {
  const pending = pendingSocketResponses.get(response.id);
  if (!pending) {
    return;
  }
  pendingSocketResponses.delete(response.id);
  writeSocketEnvelope(pending.socket, response);
};

const handleNativeInput = async (rawInput: unknown): Promise<void> => {
  if (isBridgeResponse(rawInput)) {
    handleExtensionResponse(rawInput);
    return;
  }

  try {
    ensureBridgeRequestEnvelope(rawInput);
    await handleExtensionRequest(rawInput);
  } catch (error) {
    const safeRequest =
      typeof rawInput === "object" && rawInput !== null ? asRecord(rawInput) : {};
    writeNativeEnvelope({
      id: asString(safeRequest.id) ?? "unknown-request-id",
      status: "error",
      summary: {},
      error: {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: error instanceof Error ? error.message : String(error)
      }
    });
  }
};

process.stdin.on("data", (chunk: Buffer) => {
  nativeReadBuffer = Buffer.concat([nativeReadBuffer, chunk]);

  while (nativeReadBuffer.length >= 4) {
    const frameLength = nativeReadBuffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (nativeReadBuffer.length < frameEnd) {
      return;
    }

    const frame = nativeReadBuffer.subarray(4, frameEnd);
    nativeReadBuffer = nativeReadBuffer.subarray(frameEnd);
    const request = JSON.parse(frame.toString("utf8")) as unknown;
    void handleNativeInput(request);
  }
});

process.stdin.on("end", () => {
  void shutdown(0);
});

process.stdin.on("error", () => {
  void shutdown(1);
});

process.on("SIGINT", () => {
  void shutdown(130);
});

process.on("SIGTERM", () => {
  void shutdown(143);
});

process.stdin.resume();
