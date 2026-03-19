export const RECOVERY_WINDOW_MS = 30_000;
export const MAX_PENDING_DURING_RECOVERY = 5;
export const classifyTransportFailure = (input) => {
    if (input.disconnectedObserved) {
        return "ERR_TRANSPORT_DISCONNECTED";
    }
    if (input.timeoutElapsed) {
        return "ERR_TRANSPORT_TIMEOUT";
    }
    return "ERR_TRANSPORT_FORWARD_FAILED";
};
export class NativeMessagingSession {
    #state = "idle";
    #sessionId = null;
    #disconnectedReason = null;
    #disconnectedAt = null;
    #pendingCount = 0;
    beginHandshake() {
        if (this.#state === "forwarding") {
            throw new Error("cannot start handshake while forwarding");
        }
        this.#state = "handshaking";
    }
    markReady(sessionId) {
        this.#state = "ready";
        this.#sessionId = sessionId;
        this.#disconnectedReason = null;
        this.#disconnectedAt = null;
        this.#pendingCount = 0;
    }
    beginForward() {
        if (this.#state !== "ready") {
            throw new Error("session not ready");
        }
        this.#state = "forwarding";
    }
    completeForward() {
        if (this.#state === "forwarding") {
            this.#state = "ready";
        }
    }
    observeDisconnect(reason, nowMs) {
        this.#state = "disconnected";
        this.#disconnectedReason = reason;
        this.#disconnectedAt = nowMs;
    }
    markFailed() {
        this.#state = "failed";
    }
    tryQueuePending(nowMs) {
        if (!this.canRecover(nowMs) || this.#pendingCount >= MAX_PENDING_DURING_RECOVERY) {
            return false;
        }
        this.#pendingCount += 1;
        return true;
    }
    releasePending() {
        if (this.#pendingCount > 0) {
            this.#pendingCount -= 1;
        }
    }
    canRecover(nowMs) {
        if (this.#state !== "disconnected" || this.#disconnectedAt === null) {
            return false;
        }
        return nowMs - this.#disconnectedAt <= RECOVERY_WINDOW_MS;
    }
    recoveryDeadlineMs() {
        if (this.#disconnectedAt === null) {
            return null;
        }
        return this.#disconnectedAt + RECOVERY_WINDOW_MS;
    }
    sessionIdOrThrow() {
        if (!this.#sessionId) {
            throw new Error("session id missing");
        }
        return this.#sessionId;
    }
    snapshot() {
        return {
            state: this.#state,
            sessionId: this.#sessionId,
            disconnectedReason: this.#disconnectedReason,
            disconnectedAt: this.#disconnectedAt,
            pendingCount: this.#pendingCount
        };
    }
}
