import { mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { isAbsolute, join, relative, resolve } from "node:path";
import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME } from "./host.js";
const DEFAULT_SESSION_ID = "nm-session-001";
const RELAY_PATH = "host>background>content-script>background>host";
const PROFILE_ROOT = process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT?.trim() ?? "";
const LEGACY_PROFILE_DIR = process.env.WEBENVOY_NATIVE_BRIDGE_PROFILE_DIR?.trim() ?? "";
let nativeReadBuffer = Buffer.alloc(0);
let sessionId = DEFAULT_SESSION_ID;
let extensionOpened = false;
let shuttingDown = false;
let socketServer = null;
let activeProfileDir = null;
let activeSocketPath = null;
const socketBuffers = new WeakMap();
const pendingSocketResponses = new Map();
const activeSockets = new Set();
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : {};
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const isPathInside = (baseDir, targetPath) => {
    const normalizedBase = resolve(baseDir);
    const normalizedTarget = resolve(targetPath);
    const rel = relative(normalizedBase, normalizedTarget);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};
const resolveSocketTarget = (request) => {
    if (LEGACY_PROFILE_DIR) {
        const profileDir = resolve(LEGACY_PROFILE_DIR);
        return {
            profileDir,
            socketPath: join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME)
        };
    }
    const profileName = asString(request.profile);
    if (PROFILE_ROOT) {
        const profileRoot = resolve(PROFILE_ROOT);
        if (profileName) {
            const profileDir = resolve(profileRoot, profileName);
            if (!isPathInside(profileRoot, profileDir)) {
                throw new Error("native bridge profile escapes controlled root");
            }
            return {
                profileDir,
                socketPath: join(profileDir, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME)
            };
        }
        return {
            profileDir: profileRoot,
            socketPath: join(profileRoot, PROFILE_NATIVE_BRIDGE_SOCKET_FILENAME)
        };
    }
    return null;
};
const shouldPromoteToProfileSocket = (request) => !LEGACY_PROFILE_DIR &&
    typeof request.profile === "string" &&
    request.profile.trim().length > 0 &&
    !!PROFILE_ROOT;
const isBridgeResponse = (value) => {
    const record = asRecord(value);
    return (typeof record.id === "string" &&
        (record.status === "success" || record.status === "error") &&
        record.error !== undefined);
};
const encodeEnvelope = (envelope) => {
    const payload = Buffer.from(JSON.stringify(envelope), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(payload.length, 0);
    return Buffer.concat([header, payload]);
};
const writeNativeEnvelope = (envelope, onFlushed) => {
    process.stdout.write(encodeEnvelope(envelope), () => {
        onFlushed?.();
    });
};
const writeSocketEnvelope = (socket, envelope) => {
    if (socket.destroyed) {
        return;
    }
    socket.end(encodeEnvelope(envelope));
};
const buildErrorEnvelope = (request, input) => ({
    id: request.id,
    status: "error",
    summary: input.summary ?? {},
    error: {
        code: input.code,
        message: input.message
    }
});
const buildSuccessEnvelope = (request, input) => ({
    id: request.id,
    status: "success",
    summary: input.summary,
    ...(input.payload ? { payload: input.payload } : {}),
    error: null
});
const buildStubForwardPayload = (request) => {
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
const writeNativeSuccess = (request, input, onFlushed) => {
    writeNativeEnvelope(buildSuccessEnvelope(request, input), onFlushed);
};
const writeNativeError = (request, input) => {
    writeNativeEnvelope(buildErrorEnvelope(request, input));
};
const failPendingSocketResponses = (input) => {
    for (const [id, pending] of pendingSocketResponses.entries()) {
        writeSocketEnvelope(pending.socket, buildErrorEnvelope({
            id
        }, {
            code: input.code,
            message: input.message,
            summary: {
                relay_path: RELAY_PATH
            }
        }));
        pendingSocketResponses.delete(id);
    }
};
const cleanupSocketServer = async (options) => {
    const current = socketServer;
    const currentSocketPath = activeSocketPath;
    socketServer = null;
    activeSocketPath = null;
    activeProfileDir = null;
    if (current) {
        if (options?.waitForConnections === false) {
            current.close();
        }
        else {
            await new Promise((resolve) => {
                current.close(() => resolve());
            });
        }
    }
    if (currentSocketPath) {
        await rm(currentSocketPath, { force: true }).catch(() => undefined);
    }
};
const shutdown = async (code = 0) => {
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
const ensureSocketServer = async (target) => {
    if (!target) {
        return;
    }
    if (socketServer && activeSocketPath === target.socketPath) {
        return;
    }
    if (socketServer && activeSocketPath !== target.socketPath) {
        await cleanupSocketServer({ waitForConnections: false });
    }
    await mkdir(target.profileDir, { recursive: true });
    await rm(target.socketPath, { force: true }).catch(() => undefined);
    activeProfileDir = target.profileDir;
    activeSocketPath = target.socketPath;
    socketServer = createServer((socket) => {
        activeSockets.add(socket);
        socketBuffers.set(socket, Buffer.alloc(0));
        socket.on("data", (chunk) => {
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
                    const request = JSON.parse(frame.toString("utf8"));
                    void handleSocketRequest(socket, request);
                }
                catch (error) {
                    writeSocketEnvelope(socket, buildErrorEnvelope({
                        id: "invalid-request"
                    }, {
                        code: "ERR_TRANSPORT_FORWARD_FAILED",
                        message: error instanceof Error ? error.message : String(error)
                    }));
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
    await new Promise((resolve, reject) => {
        const server = socketServer;
        if (!server || !activeSocketPath) {
            resolve();
            return;
        }
        server.once("error", reject);
        server.listen(activeSocketPath, () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
};
const handleSocketRequest = async (socket, rawRequest) => {
    try {
        ensureBridgeRequestEnvelope(rawRequest);
        const request = rawRequest;
        if (request.method === "bridge.open") {
            if (!extensionOpened) {
                writeSocketEnvelope(socket, buildErrorEnvelope(request, {
                    code: "ERR_TRANSPORT_HANDSHAKE_FAILED",
                    message: "extension native bridge is not ready"
                }));
                return;
            }
            if (shouldPromoteToProfileSocket(request)) {
                await ensureSocketServer(resolveSocketTarget(request));
            }
            writeSocketEnvelope(socket, buildSuccessEnvelope(request, {
                summary: {
                    protocol: BRIDGE_PROTOCOL,
                    state: "ready",
                    session_id: sessionId
                }
            }));
            return;
        }
        if (request.method === "__ping__") {
            if (!extensionOpened) {
                writeSocketEnvelope(socket, buildErrorEnvelope(request, {
                    code: "ERR_TRANSPORT_DISCONNECTED",
                    message: "extension native bridge is not ready"
                }));
                return;
            }
            writeSocketEnvelope(socket, buildSuccessEnvelope(request, {
                summary: {
                    session_id: sessionId
                }
            }));
            return;
        }
        if (!extensionOpened) {
            writeSocketEnvelope(socket, buildErrorEnvelope(request, {
                code: "ERR_TRANSPORT_NOT_READY",
                message: "bridge.open is required before bridge.forward"
            }));
            return;
        }
        pendingSocketResponses.set(request.id, { socket });
        writeNativeEnvelope(request);
    }
    catch (error) {
        writeSocketEnvelope(socket, buildErrorEnvelope({
            id: "invalid-request"
        }, {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: error instanceof Error ? error.message : String(error)
        }));
    }
};
const handleExtensionBridgeOpen = async (request) => {
    const socketTarget = resolveSocketTarget(request);
    extensionOpened = true;
    await ensureSocketServer(socketTarget);
    writeNativeSuccess(request, {
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
    writeNativeSuccess(request, {
        summary: {
            session_id: sessionId
        }
    });
};
const handleExtensionRequest = async (request) => {
    if (request.method === "bridge.open") {
        try {
            await handleExtensionBridgeOpen(request);
        }
        catch (error) {
            writeNativeError(request, {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: error instanceof Error ? error.message : String(error)
            });
        }
        return;
    }
    if (request.method === "__ping__") {
        handleExtensionHeartbeat(request);
        return;
    }
    if (request.method === "bridge.forward" && (!activeSocketPath || !!LEGACY_PROFILE_DIR)) {
        writeNativeSuccess(request, {
            summary: {
                session_id: asString(request.params.session_id) ?? sessionId,
                run_id: asString(request.params.run_id) ?? request.id,
                command: asString(request.params.command) ?? "runtime.ping",
                relay_path: RELAY_PATH
            },
            payload: buildStubForwardPayload(request)
        }, activeSocketPath
            ? undefined
            : () => {
                process.exit(0);
            });
        return;
    }
    writeNativeError(request, {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: `unsupported extension request: ${request.method}`
    });
};
const handleExtensionResponse = (response) => {
    const pending = pendingSocketResponses.get(response.id);
    if (!pending) {
        return;
    }
    pendingSocketResponses.delete(response.id);
    writeSocketEnvelope(pending.socket, response);
};
const handleNativeInput = async (rawInput) => {
    if (isBridgeResponse(rawInput)) {
        handleExtensionResponse(rawInput);
        return;
    }
    try {
        ensureBridgeRequestEnvelope(rawInput);
        await handleExtensionRequest(rawInput);
    }
    catch (error) {
        const safeRequest = typeof rawInput === "object" && rawInput !== null ? asRecord(rawInput) : {};
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
process.stdin.on("data", (chunk) => {
    nativeReadBuffer = Buffer.concat([nativeReadBuffer, chunk]);
    while (nativeReadBuffer.length >= 4) {
        const frameLength = nativeReadBuffer.readUInt32LE(0);
        const frameEnd = 4 + frameLength;
        if (nativeReadBuffer.length < frameEnd) {
            return;
        }
        const frame = nativeReadBuffer.subarray(4, frameEnd);
        nativeReadBuffer = nativeReadBuffer.subarray(frameEnd);
        const request = JSON.parse(frame.toString("utf8"));
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
