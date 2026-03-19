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
import { SocketNativeBridgeTransport } from "./host.js";
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
  disconnectOnForward?: boolean;
  heartbeatDisconnect?: boolean;
  forwardDelayMs?: number;
}

const delay = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const asError = (error: unknown): Error => (error instanceof Error ? error : new Error(String(error)));

const asBoolean = (value: unknown): value is true => value === true;

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

  return {
  async open(request: BridgeRequestEnvelope) {
    ensureBridgeRequestEnvelope(request);
    openCount += 1;

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

interface BridgeOptions {
  transport?: NativeBridgeTransport;
  now?: () => number;
  recoveryPollIntervalMs?: number;
}

const defaultRecoveryPollIntervalMs = 100;

export class NativeMessagingBridge {
  readonly #session = new NativeMessagingSession();
  readonly #transport: NativeBridgeTransport;
  readonly #now: () => number;
  readonly #recoveryPollIntervalMs: number;
  #idSeq = 0;

  constructor(options?: BridgeOptions) {
    this.#transport = options?.transport ?? new SocketNativeBridgeTransport();
    this.#now = options?.now ?? (() => Date.now());
    this.#recoveryPollIntervalMs =
      options?.recoveryPollIntervalMs ?? defaultRecoveryPollIntervalMs;
  }

  async runtimePing(input: RuntimePingInput): Promise<RuntimePingResult> {
    const timeoutMs = readTimeoutMs(input.params.timeout_ms) ?? DEFAULT_TRANSPORT_TIMEOUT_MS;

    if (asBoolean(input.params.simulate_transport_handshake_fail)) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        "handshake failed by simulation"
      );
    }

    await this.#recoverIfDisconnected(input.profile, timeoutMs);
    await this.#ensureReady(input.profile);
    await this.#pulseHeartbeat();

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

    const request = createBridgeForwardRequest({
      id: this.#nextId("run"),
      profile: input.profile,
      sessionId: this.#session.sessionIdOrThrow(),
      runId: input.runId,
      command: "runtime.ping",
      commandParams: input.params,
      cwd: input.cwd,
      timeoutMs
    });

    try {
      this.#session.beginForward();
      const response = await runWithTimeout(this.#transport.forward(request), timeoutMs);
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

  #normalizeForwardFailure(error: unknown): NativeMessagingTransportError {
    if (error instanceof NativeMessagingTransportError) {
      if (error.code === "ERR_TRANSPORT_DISCONNECTED") {
        this.#session.observeDisconnect("forward_disconnect", this.#now());
      }
      return error;
    }

    const raw = asError(error);
    const disconnectedObserved = this.#session.snapshot().state === "disconnected";
    const timeoutElapsed = raw.message.includes("transport timeout");
    const code = classifyTransportFailure({
      disconnectedObserved,
      timeoutElapsed
    });

    if (code === "ERR_TRANSPORT_DISCONNECTED") {
      this.#session.observeDisconnect("forward_disconnect", this.#now());
    }

    return new NativeMessagingTransportError(code, raw.message);
  }

  async #ensureReady(profile: string | null): Promise<void> {
    if (this.#session.snapshot().state === "ready") {
      return;
    }

    this.#session.beginHandshake();
    const request = createBridgeOpenRequest({
      id: this.#nextId("bridge-open"),
      profile
    });

    try {
      const response = await runWithTimeout(
        this.#transport.open(request),
        request.timeout_ms ?? DEFAULT_TRANSPORT_TIMEOUT_MS
      );
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
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        asError(error).message
      );
    }
  }

  async #pulseHeartbeat(): Promise<void> {
    const request = createHeartbeatRequest({
      id: this.#nextId("hb"),
      sessionId: this.#session.sessionIdOrThrow()
    });

    try {
      const response = await runWithTimeout(this.#transport.heartbeat(request), 3_000);
      ensureBridgeSuccess(response, "heartbeat failed");
    } catch (error) {
      this.#session.observeDisconnect("heartbeat_timeout", this.#now());
      if (error instanceof NativeMessagingTransportError) {
        throw error;
      }
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        `heartbeat failed: ${asError(error).message}`
      );
    }
  }

  async #recoverIfDisconnected(profile: string | null, timeoutMs: number): Promise<void> {
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
      const requestDeadline = now + timeoutMs;
      const stopAt = Math.min(recoveryDeadline, requestDeadline);

      while (this.#now() < stopAt) {
        try {
          await this.#ensureReady(profile);
          return;
        } catch (error) {
          if (error instanceof NativeMessagingTransportError) {
            if (error.code !== "ERR_TRANSPORT_HANDSHAKE_FAILED") {
              throw error;
            }
          }
        }

        await delay(this.#recoveryPollIntervalMs);
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
