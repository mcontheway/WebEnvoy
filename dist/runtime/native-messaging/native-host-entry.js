import { createServer } from "node:net";
import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { resolveProfileScopedNativeBridgeSocketPath } from "../../install/native-host.js";
const DEFAULT_SESSION_ID = "nm-session-001";
const RELAY_PATH = "host>background>content-script>background>host";
let stdinBuffer = Buffer.alloc(0);
let sessionId = DEFAULT_SESSION_ID;
let extensionOpened = false;
const profileDir = process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR ?? null;
const socketPath = profileDir ? resolveProfileScopedNativeBridgeSocketPath(profileDir) : null;
let nextSocketClientId = 1;
let nextForwardRequestSequence = 1;
const bootstrapReadiness = new Map();
const pendingSocketResponses = new Map();
const socketBuffers = new WeakMap();
const socketClientIds = new WeakMap();
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const isBridgeResponseEnvelope = (value) => {
    const record = asRecord(value);
    return typeof record.id === "string" && typeof record.status === "string";
};
const encodeFrame = (payload) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
};
const writeStdoutEnvelope = (envelope, onFlushed) => {
    process.stdout.write(encodeFrame(envelope), () => {
        onFlushed?.();
    });
};
const writeSocketEnvelope = (socket, envelope) => {
    socket.end(encodeFrame(envelope));
};
const resolveSocketClientId = (socket) => {
    const existing = socketClientIds.get(socket);
    if (typeof existing === "number") {
        return existing;
    }
    const created = nextSocketClientId;
    nextSocketClientId += 1;
    socketClientIds.set(socket, created);
    return created;
};
const createForwardCorrelationId = (socket, originalRequestId) => {
    const socketClientId = resolveSocketClientId(socket);
    const sequence = nextForwardRequestSequence;
    nextForwardRequestSequence += 1;
    return `cli-${socketClientId}:${sequence}:${originalRequestId}`;
};
const buildRuntimeReadinessPayload = (request) => {
    const commandParams = asRecord(request.params.command_params);
    const requestRunId = asString(request.params.run_id);
    const runtimeContextId = asString(commandParams.runtime_context_id);
    const readinessKey = `${request.profile ?? ""}:${requestRunId ?? ""}:${runtimeContextId ?? ""}`;
    const bootstrap = bootstrapReadiness.get(readinessKey) ?? null;
    return {
        transport_state: extensionOpened ? "ready" : "not_connected",
        bootstrap_state: bootstrap?.status ?? "not_started",
        runtime_context_id: bootstrap?.runtime_context_id ?? runtimeContextId,
        session_id: sessionId,
        run_id: bootstrap?.run_id ?? requestRunId,
        profile: bootstrap?.profile ?? request.profile ?? null,
        version: bootstrap?.version ?? null
    };
};
const writeStdoutSuccess = (request, input, onFlushed) => {
    writeStdoutEnvelope({
        id: request.id,
        status: "success",
        summary: input.summary,
        ...(input.payload ? { payload: input.payload } : {}),
        error: null
    }, onFlushed);
};
const writeStdoutError = (request, input) => {
    writeStdoutEnvelope({
        id: request.id,
        status: "error",
        summary: input.summary ?? {},
        error: {
            code: input.code,
            message: input.message
        }
    });
};
const writeSocketResponse = (correlationId, response) => {
    const timeoutEntry = pendingSocketResponses.get(correlationId);
    if (!timeoutEntry) {
        return;
    }
    clearTimeout(timeoutEntry.timeout);
    pendingSocketResponses.delete(correlationId);
    writeSocketEnvelope(timeoutEntry.socket, {
        ...response,
        id: timeoutEntry.originalRequestId
    });
};
const writeSocketError = (socket, request, code, message) => {
    writeSocketEnvelope(socket, {
        id: request.id,
        status: "error",
        summary: {},
        error: { code, message }
    });
};
const failAllPendingSocketResponses = (code, message) => {
    for (const [correlationId, pending] of pendingSocketResponses.entries()) {
        clearTimeout(pending.timeout);
        pendingSocketResponses.delete(correlationId);
        writeSocketEnvelope(pending.socket, {
            id: pending.originalRequestId,
            status: "error",
            summary: {},
            error: { code, message }
        });
    }
};
const markExtensionDisconnected = () => {
    if (!extensionOpened) {
        return;
    }
    extensionOpened = false;
    failAllPendingSocketResponses("ERR_TRANSPORT_DISCONNECTED", "native bridge disconnected");
};
const handleExtensionBridgeOpen = (request) => {
    extensionOpened = true;
    writeStdoutSuccess(request, {
        summary: {
            protocol: BRIDGE_PROTOCOL,
            state: "ready",
            session_id: sessionId
        }
    });
};
const handleExtensionHeartbeat = (request) => {
    const requestedSessionId = asString(request.params.session_id);
    if (requestedSessionId) {
        sessionId = requestedSessionId;
    }
    writeStdoutSuccess(request, {
        summary: {
            session_id: sessionId
        }
    });
};
const handleExtensionRequest = (request) => {
    if (request.method === "bridge.open") {
        handleExtensionBridgeOpen(request);
        return;
    }
    if (request.method === "__ping__") {
        handleExtensionHeartbeat(request);
        return;
    }
    if (request.method !== "bridge.forward") {
        writeStdoutError(request, {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: `unsupported method: ${request.method}`
        });
        return;
    }
    const command = asString(request.params.command) ?? "runtime.ping";
    if (command === "runtime.readiness") {
        writeStdoutSuccess(request, {
            summary: {
                session_id: sessionId,
                run_id: asString(request.params.run_id) ?? request.id,
                command,
                relay_path: RELAY_PATH
            },
            payload: buildRuntimeReadinessPayload(request)
        });
        return;
    }
    if (command === "runtime.bootstrap") {
        const commandParams = asRecord(request.params.command_params);
        const runId = asString(request.params.run_id) ?? request.id;
        const runtimeContextId = asString(commandParams.runtime_context_id) ?? "runtime-context-001";
        const readinessKey = `${request.profile ?? ""}:${runId}:${runtimeContextId}`;
        bootstrapReadiness.set(readinessKey, {
            version: asString(commandParams.version) ?? "v1",
            run_id: runId,
            runtime_context_id: runtimeContextId,
            profile: request.profile ?? null,
            status: "ready"
        });
        writeStdoutSuccess(request, {
            summary: {
                session_id: sessionId,
                run_id: runId,
                command,
                relay_path: RELAY_PATH
            },
            payload: {
                result: {
                    version: asString(commandParams.version) ?? "v1",
                    run_id: runId,
                    runtime_context_id: runtimeContextId,
                    profile: request.profile ?? null,
                    status: "ready"
                }
            }
        });
        return;
    }
    writeStdoutSuccess(request, {
        summary: {
            session_id: sessionId,
            run_id: asString(request.params.run_id) ?? request.id,
            command,
            relay_path: RELAY_PATH
        },
        payload: {
            message: "pong",
            run_id: asString(request.params.run_id) ?? request.id,
            profile: request.profile ?? null,
            cwd: asString(request.params.cwd) ?? ""
        }
    });
};
const handleCliRequest = (socket, request) => {
    if (request.method === "bridge.open") {
        if (!extensionOpened) {
            writeSocketError(socket, request, "ERR_TRANSPORT_HANDSHAKE_FAILED", "native bridge is not ready");
            return;
        }
        writeSocketEnvelope(socket, {
            id: request.id,
            status: "success",
            summary: {
                protocol: BRIDGE_PROTOCOL,
                state: "ready",
                session_id: sessionId
            },
            error: null
        });
        return;
    }
    if (request.method === "__ping__") {
        if (!extensionOpened) {
            writeSocketError(socket, request, "ERR_TRANSPORT_DISCONNECTED", "native bridge is not ready");
            return;
        }
        writeSocketEnvelope(socket, {
            id: request.id,
            status: "success",
            summary: {
                session_id: sessionId
            },
            error: null
        });
        return;
    }
    if (request.method !== "bridge.forward") {
        writeSocketError(socket, request, "ERR_TRANSPORT_FORWARD_FAILED", `unsupported method: ${request.method}`);
        return;
    }
    if (!extensionOpened) {
        writeSocketError(socket, request, "ERR_TRANSPORT_NOT_READY", "native bridge is not ready");
        return;
    }
    const command = asString(request.params.command) ?? "";
    const correlationId = createForwardCorrelationId(socket, request.id);
    const timeoutMs = typeof request.timeout_ms === "number" && Number.isFinite(request.timeout_ms) && request.timeout_ms > 0
        ? Math.floor(request.timeout_ms)
        : 30_000;
    const timeout = setTimeout(() => {
        pendingSocketResponses.delete(correlationId);
        writeSocketError(socket, request, "ERR_TRANSPORT_TIMEOUT", "native bridge socket timeout");
    }, timeoutMs);
    pendingSocketResponses.set(correlationId, { socket, timeout, originalRequestId: request.id });
    writeStdoutEnvelope({
        ...request,
        id: correlationId
    });
};
const processSocketFrame = (socket, frame) => {
    try {
        const raw = JSON.parse(frame.toString("utf8"));
        ensureBridgeRequestEnvelope(raw);
        handleCliRequest(socket, raw);
    }
    catch (error) {
        writeSocketEnvelope(socket, {
            id: "unknown-request-id",
            status: "error",
            summary: {},
            error: {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: error instanceof Error ? error.message : String(error)
            }
        });
    }
};
const startSocketBroker = () => {
    if (!socketPath) {
        return;
    }
    try {
        mkdirSync(dirname(socketPath), { recursive: true });
    }
    catch {
        // ignore directory creation failures and let server.listen surface the real error
    }
    try {
        rmSync(socketPath, { force: true });
    }
    catch {
        // ignore stale socket cleanup failures
    }
    const server = createServer((socket) => {
        resolveSocketClientId(socket);
        socketBuffers.set(socket, Buffer.alloc(0));
        socket.on("data", (chunk) => {
            let buffer = Buffer.concat([socketBuffers.get(socket) ?? Buffer.alloc(0), chunk]);
            while (buffer.length >= 4) {
                const frameLength = buffer.readUInt32LE(0);
                const frameEnd = 4 + frameLength;
                if (buffer.length < frameEnd) {
                    break;
                }
                const frame = buffer.subarray(4, frameEnd);
                buffer = buffer.subarray(frameEnd);
                processSocketFrame(socket, frame);
            }
            socketBuffers.set(socket, buffer);
        });
        socket.on("close", () => {
            socketBuffers.delete(socket);
            socketClientIds.delete(socket);
            for (const [requestId, pending] of pendingSocketResponses.entries()) {
                if (pending.socket !== socket) {
                    continue;
                }
                clearTimeout(pending.timeout);
                pendingSocketResponses.delete(requestId);
            }
        });
    });
    server.listen(socketPath);
    const cleanup = () => {
        try {
            server.close();
        }
        catch {
            // ignore
        }
        try {
            rmSync(socketPath, { force: true });
        }
        catch {
            // ignore
        }
    };
    process.on("exit", cleanup);
    process.on("SIGTERM", () => {
        cleanup();
        process.exit(0);
    });
    process.on("SIGINT", () => {
        cleanup();
        process.exit(0);
    });
};
const handleIncomingFrame = (frame) => {
    const raw = JSON.parse(frame.toString("utf8"));
    if (isBridgeResponseEnvelope(raw)) {
        const pending = pendingSocketResponses.get(raw.id);
        if (pending) {
            writeSocketResponse(raw.id, raw);
        }
        return;
    }
    ensureBridgeRequestEnvelope(raw);
    handleExtensionRequest(raw);
};
startSocketBroker();
process.stdin.on("data", (chunk) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    while (stdinBuffer.length >= 4) {
        const frameLength = stdinBuffer.readUInt32LE(0);
        const frameEnd = 4 + frameLength;
        if (stdinBuffer.length < frameEnd) {
            return;
        }
        const frame = stdinBuffer.subarray(4, frameEnd);
        stdinBuffer = stdinBuffer.subarray(frameEnd);
        try {
            handleIncomingFrame(frame);
        }
        catch (error) {
            writeStdoutEnvelope({
                id: "unknown-request-id",
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
});
process.stdin.on("end", () => {
    markExtensionDisconnected();
});
process.stdin.on("close", () => {
    markExtensionDisconnected();
});
process.stdin.on("error", () => {
    markExtensionDisconnected();
});
process.stdin.resume();
