export const BRIDGE_PROTOCOL = "webenvoy.native-bridge.v1";
export const DEFAULT_TRANSPORT_TIMEOUT_MS = 30_000;

export type BridgeMethod = "bridge.open" | "bridge.forward" | "__ping__";

export interface BridgeRequestEnvelope {
  id: string;
  method: BridgeMethod;
  profile: string | null;
  params: Record<string, unknown>;
  timeout_ms?: number;
}

export interface BridgeResponseSuccessEnvelope {
  id: string;
  status: "success";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null;
}

export interface BridgeResponseErrorEnvelope {
  id: string;
  status: "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: {
    code: string;
    message: string;
  };
}

export type BridgeResponseEnvelope =
  | BridgeResponseSuccessEnvelope
  | BridgeResponseErrorEnvelope;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const isKnownMethod = (value: unknown): value is BridgeMethod =>
  value === "bridge.open" || value === "bridge.forward" || value === "__ping__";

export const ensureBridgeRequestEnvelope: (
  input: unknown
) => asserts input is BridgeRequestEnvelope = (input: unknown) => {
  const value = input as Partial<BridgeRequestEnvelope> | null;
  const timeoutOk =
    value?.timeout_ms === undefined ||
    (typeof value.timeout_ms === "number" && Number.isFinite(value.timeout_ms) && value.timeout_ms > 0);

  if (
    !value ||
    !isNonEmptyString(value.id) ||
    !isKnownMethod(value.method) ||
    typeof value.params !== "object" ||
    value.params === null ||
    (value.profile !== null && value.profile !== undefined && typeof value.profile !== "string") ||
    !timeoutOk
  ) {
    throw new Error("invalid request envelope");
  }
};

export const createBridgeOpenRequest = (input: {
  id: string;
  profile: string | null;
  timeoutMs?: number;
}): BridgeRequestEnvelope => ({
  id: input.id,
  method: "bridge.open",
  profile: input.profile,
  timeout_ms: input.timeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS,
  params: {
    protocol: BRIDGE_PROTOCOL,
    capabilities: ["relay", "heartbeat"]
  }
});

export const createBridgeForwardRequest = (input: {
  id: string;
  profile: string | null;
  sessionId: string;
  runId: string;
  command: string;
  commandParams: Record<string, unknown>;
  cwd: string;
  timeoutMs: number;
}): BridgeRequestEnvelope => ({
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

export const createHeartbeatRequest = (input: {
  id: string;
  sessionId: string;
}): BridgeRequestEnvelope => ({
  id: input.id,
  method: "__ping__",
  profile: null,
  params: {
    session_id: input.sessionId,
    timestamp: new Date().toISOString()
  }
});

export const ensureBridgeSuccess = (
  response: BridgeResponseEnvelope,
  errorMessage: string
): BridgeResponseSuccessEnvelope => {
  if (response.status !== "success") {
    throw new Error(`${errorMessage}: ${response.error.code}`);
  }

  return response;
};
