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
import {
  NativeMessagingSession,
  classifyTransportFailure,
  type TransportFailureCode
} from "./session.js";

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

export interface NativeBridgeTransport {
  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope>;
}

interface FakeTransportOptions {
  failHandshake?: boolean;
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
): NativeBridgeTransport => ({
  async open(request: BridgeRequestEnvelope) {
    ensureBridgeRequestEnvelope(request);

    if (options?.failHandshake) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        "native host unavailable"
      );
    }

    return {
      id: request.id,
      status: "success",
      summary: {
        protocol: BRIDGE_PROTOCOL,
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
});

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
  };
}

interface BridgeOptions {
  transport?: NativeBridgeTransport;
  now?: () => number;
}

export class NativeMessagingBridge {
  readonly #session = new NativeMessagingSession();
  readonly #transport: NativeBridgeTransport;
  readonly #now: () => number;
  #idSeq = 0;

  constructor(options?: BridgeOptions) {
    this.#transport = options?.transport ?? createFakeNativeBridgeTransport();
    this.#now = options?.now ?? (() => Date.now());
  }

  async runtimePing(input: RuntimePingInput): Promise<RuntimePingResult> {
    if (asBoolean(input.params.simulate_transport_handshake_fail)) {
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_HANDSHAKE_FAILED",
        "handshake failed by simulation"
      );
    }

    await this.#ensureReady(input.profile);
    await this.#pulseHeartbeat();

    if (asBoolean(input.params.simulate_transport_disconnect)) {
      this.#session.observeDisconnect("simulated_disconnect", this.#now());
      throw new NativeMessagingTransportError(
        "ERR_TRANSPORT_DISCONNECTED",
        "simulated transport disconnect"
      );
    }

    const timeoutMs = readTimeoutMs(input.params.timeout_ms) ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
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

      return {
        message,
        transport: {
          protocol: BRIDGE_PROTOCOL,
          state: snapshot.state,
          session_id: this.#session.sessionIdOrThrow(),
          heartbeat_ok: true
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

      if (sessionId.length === 0) {
        throw new NativeMessagingTransportError(
          "ERR_TRANSPORT_HANDSHAKE_FAILED",
          "missing session id"
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

  #nextId(prefix: string): string {
    this.#idSeq += 1;
    return `${prefix}-${this.#idSeq.toString().padStart(4, "0")}`;
  }
}
