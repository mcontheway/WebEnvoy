type BridgeRequest = {
  id: string;
  method: "bridge.open" | "bridge.forward" | "__ping__";
  profile: string | null;
  params: Record<string, unknown>;
  timeout_ms?: number;
};

type BridgeResponse = {
  id: string;
  status: "success" | "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null | { code: string; message: string };
};

type NativeBridgeState = "connecting" | "ready" | "recovering" | "disconnected";

interface NativeBridgeRecoveryStateHooks {
  getState(): NativeBridgeState;
  emit(message: BridgeResponse): void;
}

interface QueuedForwardRequest {
  request: BridgeRequest;
  deadlineMs: number;
}

interface NativeBridgeRecoveryStateOptions {
  forwardTimeoutMs?: number;
}

const defaultForwardTimeoutMs = 3_000;

const readTimeoutMs = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 1) {
    return null;
  }
  return Math.floor(value);
};

export class NativeBridgeRecoveryState {
  #recoveryQueue: QueuedForwardRequest[] = [];

  constructor(
    private readonly hooks: NativeBridgeRecoveryStateHooks,
    private readonly options?: NativeBridgeRecoveryStateOptions,
    private readonly maxRecoveryQueuedForwards = 5
  ) {}

  queueForward(request: BridgeRequest): void {
    const timeoutMs = this.#resolveForwardTimeoutMs(request);
    const deadlineMs = Date.now() + timeoutMs;
    if (Date.now() >= deadlineMs) {
      this.hooks.emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_TIMEOUT",
          message: "forward request timed out during recovery"
        }
      });
      return;
    }
    if (this.#recoveryQueue.length >= this.maxRecoveryQueuedForwards) {
      this.hooks.emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_DISCONNECTED",
          message: `recovery queue exhausted (${this.maxRecoveryQueuedForwards})`
        }
      });
      return;
    }
    this.#recoveryQueue.push({
      request,
      deadlineMs
    });
  }

  async replayQueuedForwards(
    dispatchForward: (request: BridgeRequest, deadlineMs: number) => Promise<void>
  ): Promise<void> {
    if (this.#recoveryQueue.length === 0) {
      return;
    }
    this.#expireQueuedForwards(Date.now());
    const queued = [...this.#recoveryQueue];
    this.#recoveryQueue.length = 0;
    for (const queuedForward of queued) {
      const request = queuedForward.request;
      if (Date.now() >= queuedForward.deadlineMs) {
        this.hooks.emit({
          id: request.id,
          status: "error",
          summary: {
            relay_path: "host>background>content-script>background>host"
          },
          error: {
            code: "ERR_TRANSPORT_TIMEOUT",
            message: "forward request timed out during recovery"
          }
        });
        continue;
      }
      if (this.hooks.getState() !== "ready") {
        this.#recoveryQueue.push(queuedForward);
        continue;
      }
      await dispatchForward(request, queuedForward.deadlineMs);
    }
  }

  failRecoveryQueue(message: string): void {
    const queued = [...this.#recoveryQueue];
    this.#recoveryQueue.length = 0;
    for (const queuedForward of queued) {
      this.hooks.emit({
        id: queuedForward.request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_DISCONNECTED",
          message
        }
      });
    }
  }

  expireQueuedForwards(nowMs: number): void {
    this.#expireQueuedForwards(nowMs);
  }

  #expireQueuedForwards(nowMs: number): void {
    if (this.#recoveryQueue.length === 0) {
      return;
    }
    const keep: QueuedForwardRequest[] = [];
    for (const queuedForward of this.#recoveryQueue) {
      if (nowMs < queuedForward.deadlineMs) {
        keep.push(queuedForward);
        continue;
      }
      this.hooks.emit({
        id: queuedForward.request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_TIMEOUT",
          message: "forward request timed out during recovery"
        }
      });
    }
    this.#recoveryQueue = keep;
  }

  #resolveForwardTimeoutMs(request: BridgeRequest): number {
    const timeoutMs = readTimeoutMs(request.timeout_ms);
    return timeoutMs ?? (this.options?.forwardTimeoutMs ?? defaultForwardTimeoutMs);
  }
}
