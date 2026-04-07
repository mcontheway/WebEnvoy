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

interface PendingForward {
  request: BridgeRequest;
  timeout: ReturnType<typeof setTimeout>;
  consumerGateResult?: Record<string, unknown>;
  gatePayload?: Record<string, unknown>;
  suppressHostResponse?: boolean;
}

export class NativeBridgePendingForwardState {
  #pending = new Map<string, PendingForward>();

  register(id: string, pending: PendingForward): void {
    this.#pending.set(id, pending);
  }

  take(id: string): PendingForward | null {
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
    emit: (payload: BridgeResponse) => void
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
    emit: (payload: BridgeResponse) => void
  ): void {
    for (const id of [...this.#pending.keys()]) {
      this.fail(id, error, emit);
    }
  }
}
