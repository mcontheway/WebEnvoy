import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope, type BridgeRequestEnvelope } from "./protocol.js";

const DEFAULT_SESSION_ID = "nm-session-001";
const RELAY_PATH = "host>background>content-script>background>host";

let readBuffer = Buffer.alloc(0);
let sessionId = DEFAULT_SESSION_ID;
let opened = false;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const writeEnvelope = (envelope: Record<string, unknown>, onFlushed?: () => void): void => {
  const payload = Buffer.from(JSON.stringify(envelope), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]), () => {
    onFlushed?.();
  });
};

const writeSuccess = (
  request: BridgeRequestEnvelope,
  input: {
    summary: Record<string, unknown>;
    payload?: Record<string, unknown>;
  },
  onFlushed?: () => void
): void => {
  writeEnvelope({
    id: request.id,
    status: "success",
    summary: input.summary,
    ...(input.payload ? { payload: input.payload } : {}),
    error: null
  }, onFlushed);
};

const writeError = (
  request: BridgeRequestEnvelope,
  input: {
    code: string;
    message: string;
    summary?: Record<string, unknown>;
  }
): void => {
  writeEnvelope({
    id: request.id,
    status: "error",
    summary: input.summary ?? {},
    error: {
      code: input.code,
      message: input.message
    }
  });
};

const handleBridgeOpen = (request: BridgeRequestEnvelope): void => {
  opened = true;
  writeSuccess(request, {
    summary: {
      protocol: BRIDGE_PROTOCOL,
      state: "ready",
      session_id: sessionId
    }
  });
};

const handleHeartbeat = (request: BridgeRequestEnvelope): void => {
  const requestedSessionId = asString(request.params.session_id);
  if (requestedSessionId) {
    sessionId = requestedSessionId;
  }
  writeSuccess(request, {
    summary: {
      session_id: sessionId
    }
  });
};

const buildForwardPayload = (request: BridgeRequestEnvelope): Record<string, unknown> => {
  const command = asString(request.params.command) ?? "runtime.ping";
  const runId = asString(request.params.run_id) ?? request.id;
  const cwd = asString(request.params.cwd) ?? "";
  const commandParams = asRecord(request.params.command_params);
  const runtimeContextId =
    asString(commandParams.runtime_context_id) ?? "runtime-context-001";

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

const handleBridgeForward = (request: BridgeRequestEnvelope): void => {
  if (!opened) {
    writeError(request, {
      code: "ERR_TRANSPORT_NOT_READY",
      message: "bridge.open is required before bridge.forward"
    });
    return;
  }

  const command = asString(request.params.command) ?? "runtime.ping";
  const requestedSessionId = asString(request.params.session_id);
  if (requestedSessionId) {
    sessionId = requestedSessionId;
  }

  writeSuccess(request, {
    summary: {
      session_id: sessionId,
      run_id: asString(request.params.run_id) ?? request.id,
      command,
      relay_path: RELAY_PATH
    },
    payload: buildForwardPayload(request)
  }, () => {
    process.exit(0);
  });
};

const handleRequest = (rawRequest: unknown): void => {
  try {
    ensureBridgeRequestEnvelope(rawRequest);
    const request = rawRequest;
    if (request.method === "bridge.open") {
      handleBridgeOpen(request);
      return;
    }
    if (request.method === "__ping__") {
      handleHeartbeat(request);
      return;
    }
    handleBridgeForward(request);
  } catch (error) {
    const safeRequest =
      typeof rawRequest === "object" && rawRequest !== null ? asRecord(rawRequest) : {};
    writeEnvelope({
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
  readBuffer = Buffer.concat([readBuffer, chunk]);

  while (readBuffer.length >= 4) {
    const frameLength = readBuffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (readBuffer.length < frameEnd) {
      return;
    }

    const frame = readBuffer.subarray(4, frameEnd);
    readBuffer = readBuffer.subarray(frameEnd);

    const request = JSON.parse(frame.toString("utf8")) as unknown;
    handleRequest(request);
  }
});

process.stdin.resume();
