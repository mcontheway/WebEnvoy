export class BackgroundRelay {
    contentScript;
    #listeners = new Set();
    #pending = new Map();
    #sessionId = "nm-session-001";
    constructor(contentScript) {
        this.contentScript = contentScript;
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
        this.#pending.set(request.id, request);
        const forward = {
            kind: "forward",
            id: request.id,
            command: String(request.params.command ?? ""),
            commandParams: typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {}
        };
        this.contentScript.onBackgroundMessage(forward);
    }
    #onContentResult(message) {
        const pending = this.#pending.get(message.id);
        if (!pending) {
            return;
        }
        this.#pending.delete(message.id);
        if (!message.ok) {
            this.#emit({
                id: pending.id,
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
            id: pending.id,
            status: "success",
            summary: {
                session_id: String(pending.params.session_id ?? this.#sessionId),
                run_id: String(pending.params.run_id ?? pending.id),
                command: String(pending.params.command ?? "runtime.ping"),
                relay_path: "host>background>content-script>background>host"
            },
            payload: message.payload ?? {},
            error: null
        });
    }
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
