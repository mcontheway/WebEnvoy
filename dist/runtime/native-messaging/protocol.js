export const BRIDGE_PROTOCOL = "webenvoy.native-bridge.v1";
export const DEFAULT_TRANSPORT_TIMEOUT_MS = 30_000;
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isKnownMethod = (value) => value === "bridge.open" || value === "bridge.forward" || value === "__ping__";
export const ensureBridgeRequestEnvelope = (input) => {
    const value = input;
    const timeoutOk = value?.timeout_ms === undefined ||
        (typeof value.timeout_ms === "number" && Number.isFinite(value.timeout_ms) && value.timeout_ms > 0);
    if (!value ||
        !isNonEmptyString(value.id) ||
        !isKnownMethod(value.method) ||
        typeof value.params !== "object" ||
        value.params === null ||
        (value.profile !== null && value.profile !== undefined && typeof value.profile !== "string") ||
        !timeoutOk) {
        throw new Error("invalid request envelope");
    }
};
export const createBridgeOpenRequest = (input) => ({
    id: input.id,
    method: "bridge.open",
    profile: input.profile,
    timeout_ms: input.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS,
    params: {
        protocol: BRIDGE_PROTOCOL,
        capabilities: ["relay", "heartbeat"]
    }
});
export const createBridgeForwardRequest = (input) => ({
    id: input.id,
    method: "bridge.forward",
    profile: input.profile,
    timeout_ms: input.timeoutMs,
    params: {
        session_id: input.sessionId,
        run_id: input.runId,
        command: input.command,
        command_params: input.commandParams,
        cwd: input.cwd
    }
});
export const createHeartbeatRequest = (input) => ({
    id: input.id,
    method: "__ping__",
    profile: null,
    params: {
        session_id: input.sessionId,
        timestamp: new Date().toISOString()
    }
});
export const ensureBridgeSuccess = (response, errorMessage) => {
    if (response.status !== "success") {
        throw new Error(`${errorMessage}: ${response.error.code}`);
    }
    return response;
};
