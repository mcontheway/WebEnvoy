const defaultForwardTimeoutMs = 3_000;
const readTimeoutMs = (value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return null;
    }
    if (value < 1) {
        return null;
    }
    return Math.floor(value);
};
export class NativeBridgeRecoveryState {
    hooks;
    options;
    maxRecoveryQueuedForwards;
    #recoveryQueue = [];
    constructor(hooks, options, maxRecoveryQueuedForwards = 5) {
        this.hooks = hooks;
        this.options = options;
        this.maxRecoveryQueuedForwards = maxRecoveryQueuedForwards;
    }
    queueForward(request) {
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
    async replayQueuedForwards(dispatchForward) {
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
    failRecoveryQueue(message) {
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
    expireQueuedForwards(nowMs) {
        this.#expireQueuedForwards(nowMs);
    }
    #expireQueuedForwards(nowMs) {
        if (this.#recoveryQueue.length === 0) {
            return;
        }
        const keep = [];
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
    #resolveForwardTimeoutMs(request) {
        const timeoutMs = readTimeoutMs(request.timeout_ms);
        return timeoutMs ?? (this.options?.forwardTimeoutMs ?? defaultForwardTimeoutMs);
    }
}
