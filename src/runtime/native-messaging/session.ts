export type NativeMessagingSessionState =
  | "idle"
  | "handshaking"
  | "ready"
  | "forwarding"
  | "disconnected"
  | "failed";

export type TransportFailureCode =
  | "ERR_TRANSPORT_HANDSHAKE_FAILED"
  | "ERR_TRANSPORT_NOT_READY"
  | "ERR_TRANSPORT_FORWARD_FAILED"
  | "ERR_TRANSPORT_TIMEOUT"
  | "ERR_TRANSPORT_DISCONNECTED";

export const RECOVERY_WINDOW_MS = 30_000;
export const MAX_PENDING_DURING_RECOVERY = 5;

export interface NativeMessagingSessionSnapshot {
  state: NativeMessagingSessionState;
  sessionId: string | null;
  disconnectedReason: string | null;
  disconnectedAt: number | null;
  pendingCount: number;
}

export const classifyTransportFailure = (input: {
  disconnectedObserved: boolean;
  timeoutElapsed: boolean;
}): TransportFailureCode => {
  if (input.disconnectedObserved) {
    return "ERR_TRANSPORT_DISCONNECTED";
  }

  if (input.timeoutElapsed) {
    return "ERR_TRANSPORT_TIMEOUT";
  }

  return "ERR_TRANSPORT_FORWARD_FAILED";
};

export class NativeMessagingSession {
  #state: NativeMessagingSessionState = "idle";
  #sessionId: string | null = null;
  #disconnectedReason: string | null = null;
  #disconnectedAt: number | null = null;
  #pendingCount = 0;

  beginHandshake(): void {
    if (this.#state === "forwarding") {
      throw new Error("cannot start handshake while forwarding");
    }
    this.#state = "handshaking";
  }

  markReady(sessionId: string): void {
    this.#state = "ready";
    this.#sessionId = sessionId;
    this.#disconnectedReason = null;
    this.#disconnectedAt = null;
    this.#pendingCount = 0;
  }

  beginForward(): void {
    if (this.#state !== "ready") {
      throw new Error("session not ready");
    }
    this.#state = "forwarding";
  }

  completeForward(): void {
    if (this.#state === "forwarding") {
      this.#state = "ready";
    }
  }

  observeDisconnect(reason: string, nowMs: number): void {
    this.#state = "disconnected";
    this.#disconnectedReason = reason;
    this.#disconnectedAt = nowMs;
  }

  markFailed(): void {
    this.#state = "failed";
  }

  tryQueuePending(nowMs: number): boolean {
    if (!this.canRecover(nowMs) || this.#pendingCount >= MAX_PENDING_DURING_RECOVERY) {
      return false;
    }

    this.#pendingCount += 1;
    return true;
  }

  releasePending(): void {
    if (this.#pendingCount > 0) {
      this.#pendingCount -= 1;
    }
  }

  canRecover(nowMs: number): boolean {
    if (this.#state !== "disconnected" || this.#disconnectedAt === null) {
      return false;
    }

    return nowMs - this.#disconnectedAt <= RECOVERY_WINDOW_MS;
  }

  recoveryDeadlineMs(): number | null {
    if (this.#disconnectedAt === null) {
      return null;
    }

    return this.#disconnectedAt + RECOVERY_WINDOW_MS;
  }

  sessionIdOrThrow(): string {
    if (!this.#sessionId) {
      throw new Error("session id missing");
    }

    return this.#sessionId;
  }

  snapshot(): NativeMessagingSessionSnapshot {
    return {
      state: this.#state,
      sessionId: this.#sessionId,
      disconnectedReason: this.#disconnectedReason,
      disconnectedAt: this.#disconnectedAt,
      pendingCount: this.#pendingCount
    };
  }
}
