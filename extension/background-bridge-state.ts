export class PendingRequestState<
  TPending extends {
    timeout: ReturnType<typeof setTimeout>;
    suppressHostResponse?: boolean;
  }
> {
  #pending = new Map<string, TPending>();

  register(id: string, pending: TPending): void {
    this.#pending.set(id, pending);
  }

  take(id: string): TPending | null {
    const pending = this.#pending.get(id);
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    return pending;
  }

  fail(
    id: string,
    error: { code: string; message: string },
    emit: (payload: {
      id: string;
      status: "error";
      summary: Record<string, unknown>;
      error: { code: string; message: string };
    }) => void
  ): void {
    const pending = this.take(id);
    if (!pending || pending.suppressHostResponse) {
      return;
    }
    emit({
      id,
      status: "error",
      summary: {
        relay_path: "host>background>content-script>background>host"
      },
      error
    });
  }

  failAll(
    error: { code: string; message: string },
    emit: (payload: {
      id: string;
      status: "error";
      summary: Record<string, unknown>;
      error: { code: string; message: string };
    }) => void
  ): void {
    for (const id of [...this.#pending.keys()]) {
      this.fail(id, error, emit);
    }
  }
}

export interface RecoveryQueueHooks {
  getState(): "connecting" | "ready" | "recovering" | "disconnected";
  emit(message: {
    id: string;
    status: "error";
    summary: Record<string, unknown>;
    error: { code: string; message: string };
  }): void;
}

interface QueuedRequest<TRequest> {
  request: TRequest;
  deadlineMs: number;
}

export class RecoveryQueueState<TRequest> {
  #queue: QueuedRequest<TRequest>[] = [];

  constructor(
    private readonly hooks: RecoveryQueueHooks,
    private readonly maxQueueSize: number,
    private readonly resolveTimeoutMs: (request: TRequest) => number,
    private readonly resolveRequestId: (request: TRequest) => string
  ) {}

  queueRequest(request: TRequest): void {
    const timeoutMs = this.resolveTimeoutMs(request);
    const deadlineMs = Date.now() + timeoutMs;
    if (Date.now() >= deadlineMs) {
      this.hooks.emit(this.#createTimeoutResponse(request));
      return;
    }
    if (this.#queue.length >= this.maxQueueSize) {
      this.hooks.emit({
        id: this.resolveRequestId(request),
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_DISCONNECTED",
          message: `recovery queue exhausted (${this.maxQueueSize})`
        }
      });
      return;
    }
    this.#queue.push({ request, deadlineMs });
  }

  async replayQueuedRequests(
    dispatchRequest: (request: TRequest, deadlineMs: number) => Promise<void>
  ): Promise<void> {
    if (this.#queue.length === 0) {
      return;
    }
    this.expireQueuedRequests(Date.now());
    const queued = [...this.#queue];
    this.#queue.length = 0;
    for (const entry of queued) {
      if (Date.now() >= entry.deadlineMs) {
        this.hooks.emit(this.#createTimeoutResponse(entry.request));
        continue;
      }
      if (this.hooks.getState() !== "ready") {
        this.#queue.push(entry);
        continue;
      }
      await dispatchRequest(entry.request, entry.deadlineMs);
    }
  }

  failQueue(message: string): void {
    const queued = [...this.#queue];
    this.#queue.length = 0;
    for (const entry of queued) {
      this.hooks.emit({
        id: this.resolveRequestId(entry.request),
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

  expireQueuedRequests(nowMs: number): void {
    if (this.#queue.length === 0) {
      return;
    }
    const keep: QueuedRequest<TRequest>[] = [];
    for (const entry of this.#queue) {
      if (nowMs < entry.deadlineMs) {
        keep.push(entry);
        continue;
      }
      this.hooks.emit(this.#createTimeoutResponse(entry.request));
    }
    this.#queue = keep;
  }

  #createTimeoutResponse(request: TRequest) {
    return {
      id: this.resolveRequestId(request),
      status: "error" as const,
      summary: {
        relay_path: "host>background>content-script>background>host"
      },
      error: {
        code: "ERR_TRANSPORT_TIMEOUT",
        message: "forward request timed out during recovery"
      }
    };
  }
}
