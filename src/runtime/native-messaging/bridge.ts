import type { JsonObject } from "../../core/types.js";
import {
  BRIDGE_PROTOCOL,
  DEFAULT_TRANSPORT_TIMEOUT_MS,
  createBridgeForwardRequest,
  createBridgeOpenRequest,
  createHeartbeatRequest,
  ensureBridgeRequestEnvelope,
  ensureBridgeSuccess,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope
} from "./protocol.js";
import { NativeHostBridgeTransport } from "./host.js";
import {
  MAX_PENDING_DURING_RECOVERY,
  NativeMessagingSession,
  RECOVERY_WINDOW_MS,
  classifyTransportFailure,
  type TransportFailureCode
} from "./session.js";
import type { NativeBridgeTransport } from "./transport.js";

export class NativeMessagingTransportError extends Error {
  code: TransportFailureCode;
  retryable: boolean;

  constructor(code: TransportFailureCode, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = "NativeMessagingTransportError";
    this.code = code;
    this.retryable = options?.retryable ?? true;
  }
}

interface FakeTransportOptions {
  failHandshake?: boolean;
  failHandshakeAfterFirstOpen?: boolean;
  incompatibleProtocol?: boolean;
  openFailureSequence?: TransportFailureCode[];
  disconnectOnForward?: boolean;
  heartbeatDisconnect?: boolean;
  heartbeatDelayMs?: number;
  forwardDelayMs?: number;
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const asBoolean = (value: unknown): value is true => value === true;

const transportCodeOf = (
  error: unknown
):
  | "ERR_TRANSPORT_HANDSHAKE_FAILED"
  | "ERR_TRANSPORT_TIMEOUT"
  | "ERR_TRANSPORT_DISCONNECTED"
  | "ERR_TRANSPORT_FORWARD_FAILED"
  | null => {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { transportCode?: unknown }).transportCode;
  if (
    code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
    code === "ERR_TRANSPORT_TIMEOUT" ||
    code === "ERR_TRANSPORT_DISCONNECTED" ||
    code === "ERR_TRANSPORT_FORWARD_FAILED"
  ) {
    return code;
  }
  return null;
};

const readTimeoutMs = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  if (value < 1) {
    return null;
  }

  return Math.floor(value);
};

const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | null = null;

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "transport timeout"));
      }, timeoutMs);
    });

    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const createFakeNativeBridgeTransport = (
  options?: FakeTransportOptions
): NativeBridgeTransport => {
  let openCount = 0;
  const openFailureSequence = [...(options?.openFailureSequence ?? [])];

  return {
  async open(request: BridgeRequestEnvelope) {
    ensureBridgeRequestEnvelope(request);
    openCount += 1;

    const forcedFailure = openFailureSequence.shift();
    if (forcedFailure) {
      throw new NativeMessagingTransportError(forcedFailure, `forced open failure: ${forcedFailure}`);
    }

    if (options?.failHandshake || (options?.failHandshakeAfterFirstOpen && openCount > 1)) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        "native host unavailable"
      );
    }

    return {
      id: request.id,
      status: "success",
      summary: {
        protocol: options?.incompatibleProtocol ? "webenvoy.native-bridge.v0" : BRIDGE_PROTOCOL,
        session_id: "nm-session-001",
        state: "ready"
      },
      error: null
    };
  },

  async forward(request: BridgeRequestEnvelope) {
    ensureBridgeRequestEnvelope(request);

    if (options?.disconnectOnForward) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        "native channel disconnected"
      );
    }

    if (options?.forwardDelayMs && options.forwardDelayMs > 0) {
      await delay(options.forwardDelayMs);
    }

    return {
      id: request.id,
      status: "success",
      summary: {
        session_id: String(request.params.session_id ?? "nm-session-001"),
        run_id: String(request.params.run_id ?? request.id),
        command: String(request.params.command ?? "runtime.ping")
      },
      payload: {
        message: "pong"
      },
      error: null
    };
  },

  async heartbeat(request: BridgeRequestEnvelope) {
    ensureBridgeRequestEnvelope(request);

    if (options?.heartbeatDelayMs && options.heartbeatDelayMs > 0) {
      await delay(options.heartbeatDelayMs);
    }

    if (options?.heartbeatDisconnect) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        "heartbeat failed: disconnected"
      );
    }

    return {
      id: request.id,
      status: "success",
      summary: {
        session_id: String(request.params.session_id ?? "nm-session-001")
      },
      error: null
    };
  }
};
};

export interface RuntimePingInput {
  runId: string;
  profile: string | null;
  cwd: string;
  params: JsonObject;
}

export interface RuntimePingResult {
  [key: string]: unknown;
  message: string;
  transport: {
    protocol: string;
    state: string;
    session_id: string;
    heartbeat_ok: boolean;
    relay_path: string;
  };
}

export interface BridgeCommandInput {
  runId: string;
  profile: string | null;
  cwd: string;
  command: string;
  params: JsonObject;
}

export interface BridgeCommandSuccess {
  ok: true;
  payload: Record<string, unknown>;
  relay_path: string;
}

export interface BridgeCommandFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  payload: Record<string, unknown>;
  relay_path: string;
}

export type BridgeCommandResult = BridgeCommandSuccess | BridgeCommandFailure;

interface BridgeOptions {
  transport?: NativeBridgeTransport;
  now?: () => number;
  recoveryPollIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

const defaultRecoveryPollIntervalMs = 100;
const defaultHeartbeatTimeoutMs = 3_000;

interface TimeoutBudget {
  deadlineMs: number;
  remainingMs(): number;
}

const createTimeoutBudget = (timeoutMs: number, now: () => number): TimeoutBudget => {
  const deadlineMs = now() + timeoutMs;
  return {
    deadlineMs,
    remainingMs(): number {
      const remaining = deadlineMs - now();
      if (remaining <= 0) {
        throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "transport timeout");
      }
      return Math.max(1, Math.floor(remaining));
    }
  };
};

export class NativeMessagingBridge {
  readonly #session = new NativeMessagingSession();
  readonly #transport: NativeBridgeTransport;
  readonly #now: () => number;
  readonly #recoveryPollIntervalMs: number;
  readonly #heartbeatTimeoutMs: number;
  #idSeq = 0;

  constructor(options?: BridgeOptions) {
    this.#transport = options?.transport ?? new NativeHostBridgeTransport();
    this.#now = options?.now ?? (() => Date.now());
    this.#recoveryPollIntervalMs =
      options?.recoveryPollIntervalMs ?? defaultRecoveryPollIntervalMs;
    this.#heartbeatTimeoutMs = options?.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs;
  }

  async runtimePing(input: RuntimePingInput): Promise<RuntimePingResult> {
    const timeoutMs = readTimeoutMs(input.params.timeout_ms) ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    const budget = createTimeoutBudget(timeoutMs, this.#now);

    if (asBoolean(input.params.simulate_transport_handshake_fail)) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        "handshake failed by simulation"
      );
    }

    await this.#recoverIfDisconnected(input.profile, budget);
    await this.#ensureReady(input.profile, budget);
    await this.#pulseHeartbeat(budget);

    if (asBoolean(input.params.simulate_transport_disconnect)) {
      this.#session.observeDisconnect("simulated_disconnect", this.#now());
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        "simulated transport disconnect"
      );
    }

    if (asBoolean(input.params.simulate_transport_timeout)) {
      throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "simulated transport timeout");
    }

    const forwardTimeoutMs = budget.remainingMs();
    const request = createBridgeForwardRequest({
      id: this.#nextId("run"),
      profile: input.profile,
      sessionId: this.#session.sessionIdOrThrow(),
      runId: input.runId,
      command: "runtime.ping",
      commandParams: input.params,
      cwd: input.cwd,
      timeoutMs: forwardTimeoutMs
    });

    try {
      this.#session.beginForward();
      const response = await runWithTimeout(this.#transport.forward(request), forwardTimeoutMs);
      const success = ensureBridgeSuccess(response, "forward failed");
      const payload = success.payload ?? {};
      const message = typeof payload.message === "string" ? payload.message : "pong";
      this.#session.completeForward();
      const snapshot = this.#session.snapshot();
      const relayPath = String(success.summary.relay_path ?? "host>unknown");

      return {
        message,
        transport: {
          protocol: BRIDGE_PROTOCOL,
          state: snapshot.state,
          session_id: this.#session.sessionIdOrThrow(),
          heartbeat_ok: true,
          relay_path: relayPath
        }
      };
    } catch (error) {
      throw this.#normalizeForwardFailure(error);
    } finally {
      this.#session.completeForward();
    }
  }

  async runCommand(input: BridgeCommandInput): Promise<BridgeCommandResult> {
    const response = await this.#forwardCommand(input);
    const relayPath = String(response.summary.relay_path ?? "host>unknown");

    if (response.status === "error") {
      return {
        ok: false,
        error: response.error,
        payload: response.payload ?? {},
        relay_path: relayPath
      };
    }

    return {
      ok: true,
      payload: response.payload ?? {},
      relay_path: relayPath
    };
  }

  #normalizeForwardFailure(error: unknown): NativeMessagingTransportError {
    if (error instanceof NativeMessagingTransportError) {
      if (error.code === "ERR_TRANSPORT_DISCONNECTED") {
        this.#session.observeDisconnect("forward_disconnect", this.#now());
      }
      return error;
    }

    const coded = transportCodeOf(error);
    if (coded === "ERR_TRANSPORT_HANDSHAKE_FAILED") {
      return new NativeMessagingTransportError(coded, asError(error).message);
    }
    if (coded === "ERR_TRANSPORT_DISCONNECTED") {
      this.#session.observeDisconnect("forward_disconnect", this.#now());
      return new NativeMessagingTransportError(coded, asError(error).message);
    }
    if (coded === "ERR_TRANSPORT_TIMEOUT") {
      return new NativeMessagingTransportError(coded, asError(error).message);
    }
    if (coded === "ERR_TRANSPORT_FORWARD_FAILED") {
      return new NativeMessagingTransportError(coded, asError(error).message);
    }

    const raw = asError(error);
    const disconnectedObserved = this.#session.snapshot().state === "disconnected";
    const timeoutElapsed = /timeout/i.test(raw.message);
    const code = classifyTransportFailure({
      disconnectedObserved,
      timeoutElapsed
    });

    if (code === "ERR_TRANSPORT_DISCONNECTED") {
      this.#session.observeDisconnect("forward_disconnect", this.#now());
    }

    return new NativeMessagingTransportError(code, raw.message);
  }

  async #forwardCommand(input: BridgeCommandInput): Promise<BridgeResponseEnvelope> {
    const timeoutMs = readTimeoutMs(input.params.timeout_ms) ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    const budget = createTimeoutBudget(timeoutMs, this.#now);

    await this.#recoverIfDisconnected(input.profile, budget);
    await this.#ensureReady(input.profile, budget);
    await this.#pulseHeartbeat(budget);

    const forwardTimeoutMs = budget.remainingMs();
    const request = createBridgeForwardRequest({
      id: this.#nextId("run"),
      profile: input.profile,
      sessionId: this.#session.sessionIdOrThrow(),
      runId: input.runId,
      command: input.command,
      commandParams: input.params,
      cwd: input.cwd,
      timeoutMs: forwardTimeoutMs
    });

    try {
      this.#session.beginForward();
      const response = await runWithTimeout(this.#transport.forward(request), forwardTimeoutMs);
      this.#session.completeForward();
      return response;
    } catch (error) {
      throw this.#normalizeForwardFailure(error);
    } finally {
      this.#session.completeForward();
    }
  }

  async #ensureReady(profile: string | null, budget: TimeoutBudget): Promise<void> {
    if (this.#session.snapshot().state === "ready") {
      return;
    }

    const openTimeoutMs = budget.remainingMs();
    this.#session.beginHandshake();
    const request = createBridgeOpenRequest({
      id: this.#nextId("bridge-open"),
      profile,
      timeoutMs: openTimeoutMs
    });

    try {
      const response = await runWithTimeout(this.#transport.open(request), openTimeoutMs);
      const success = ensureBridgeSuccess(response, "handshake failed");
      const sessionId = String(success.summary.session_id ?? "");
      const protocol = String(success.summary.protocol ?? "");

      if (sessionId.length === 0) {
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_HANDSHAKE_FAILED",
          "missing session id"
        );
      }
      if (protocol !== BRIDGE_PROTOCOL) {
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_HANDSHAKE_FAILED",
          `incompatible protocol: ${protocol || "unknown"}`
        );
      }

      this.#session.markReady(sessionId);
    } catch (error) {
      this.#session.markFailed();
      if (error instanceof NativeMessagingTransportError) {
        throw error;
      }
      const coded = transportCodeOf(error);
      if (coded === "ERR_TRANSPORT_TIMEOUT") {
        throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", asError(error).message);
      }
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        asError(error).message
      );
    }
  }

  async #pulseHeartbeat(budget: TimeoutBudget): Promise<void> {
    const heartbeatTimeoutMs = Math.min(this.#heartbeatTimeoutMs, budget.remainingMs());
    const request = {
      ...createHeartbeatRequest({
      id: this.#nextId("hb"),
      sessionId: this.#session.sessionIdOrThrow()
      }),
      timeout_ms: heartbeatTimeoutMs
    };

    try {
      const response = await runWithTimeout(this.#transport.heartbeat(request), heartbeatTimeoutMs);
      ensureBridgeSuccess(response, "heartbeat failed");
    } catch (error) {
      this.#session.observeDisconnect("heartbeat_timeout", this.#now());
      const reason =
        error instanceof NativeMessagingTransportError ? error.message : asError(error).message;
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        `heartbeat failed: ${reason}`
      );
    }
  }

  async #recoverIfDisconnected(profile: string | null, budget: TimeoutBudget): Promise<void> {
    const now = this.#now();
    const snapshot = this.#session.snapshot();
    if (snapshot.state !== "disconnected") {
      return;
    }

    if (!this.#session.tryQueuePending(now)) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        `recovery queue exhausted (${MAX_PENDING_DURING_RECOVERY}) or window elapsed`,
        { retryable: true }
      );
    }

    try {
      const recoveryDeadline = this.#session.recoveryDeadlineMs() ?? now + RECOVERY_WINDOW_MS;
      const stopAt = Math.min(recoveryDeadline, budget.deadlineMs);

      while (this.#now() < stopAt) {
        try {
          await this.#ensureReady(profile, budget);
          return;
        } catch (error) {
          if (error instanceof NativeMessagingTransportError) {
            const recoverable =
              error.code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
              error.code === "ERR_TRANSPORT_DISCONNECTED" ||
              error.code === "ERR_TRANSPORT_TIMEOUT";
            if (!recoverable) {
              throw error;
            }
            const remaining = stopAt - this.#now();
            if (remaining <= 0) {
              break;
            }
            await delay(Math.min(this.#recoveryPollIntervalMs, remaining));
            continue;
          }

          const remaining = stopAt - this.#now();
          if (remaining <= 0) {
            break;
          }
          await delay(Math.min(this.#recoveryPollIntervalMs, remaining));
          continue;
        }
      }

      if (this.#now() >= budget.deadlineMs) {
        throw new NativeMessagingTransportError("ERR_TRANSPORT_TIMEOUT", "transport timeout");
      }

      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        "recovery window exhausted before reconnect",
        { retryable: true }
      );
    } finally {
      this.#session.releasePending();
    }
  }

  #nextId(prefix: string): string {
    this.#idSeq += 1;
    return `${prefix}-${this.#idSeq.toString().padStart(4, "0")}`;
  }
}
