const defaultForwardTimeoutMs = 3_000;
export class BackgroundRelay {
    contentScript;
    #listeners = new Set();
    #pending = new Map();
    #sessionId = "nm-session-001";
    #forwardTimeoutMs;
    constructor(contentScript, options) {
        this.contentScript = contentScript;
        this.#forwardTimeoutMs = options?.forwardTimeoutMs ?? defaultForwardTimeoutMs;
        this.contentScript.onResult((message) => {
            this.#onContentResult(message);
        });
    }
    onNativeMessage(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    onNativeRequest(request) {
        if (request.method === "bridge.open") {
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    protocol: "webenvoy.native-bridge.v1",
                    state: "ready",
                    session_id: this.#sessionId
                },
                error: null
            });
            return;
        }
        if (request.method === "__ping__") {
            this.#emit({
                id: request.id,
                status: "success",
                summary: {
                    session_id: this.#sessionId
                },
                error: null
            });
            return;
        }
        if (request.method !== "bridge.forward") {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported method: ${request.method}`
                }
            });
            return;
        }
        const timeout = setTimeout(() => {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_TIMEOUT",
                message: "content script forward timed out"
            });
        }, this.#forwardTimeoutMs);
        this.#pending.set(request.id, { request, timeout });
        const forward = {
            kind: "forward",
            id: request.id,
            command: String(request.params.command ?? ""),
            commandParams: typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {}
        };
        try {
            const accepted = this.contentScript.onBackgroundMessage(forward);
            if (!accepted) {
                this.#failPending(request.id, {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script unreachable"
                });
            }
        }
        catch {
            this.#failPending(request.id, {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: "content script dispatch failed"
            });
        }
    }
    #onContentResult(message) {
        const pending = this.#pending.get(message.id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(message.id);
        const request = pending.request;
        if (!message.ok) {
            this.#emit({
                id: request.id,
                status: "error",
                summary: {
                    relay_path: "host>background>content-script>background>host"
                },
                error: message.error ?? {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script failed"
                }
            });
            return;
        }
        this.#emit({
            id: request.id,
            status: "success",
            summary: {
                session_id: String(request.params.session_id ?? this.#sessionId),
                run_id: String(request.params.run_id ?? request.id),
                command: String(request.params.command ?? "runtime.ping"),
                relay_path: "host>background>content-script>background>host"
            },
            payload: message.payload ?? {},
            error: null
        });
    }
    #failPending(id, error) {
        const pending = this.#pending.get(id);
        if (!pending) {
            return;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(id);
        this.#emit({
            id: pending.request.id,
            status: "error",
            summary: {
                relay_path: "host>background>content-script>background>host"
            },
            error
        });
    }
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
