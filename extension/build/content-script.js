export class ContentScriptHandler {
    #listeners = new Set();
    onResult(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    onBackgroundMessage(message) {
        const result = this.#handleForward(message);
        for (const listener of this.#listeners) {
            listener(result);
        }
    }
    #handleForward(message) {
        if (message.command !== "runtime.ping") {
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported command: ${message.command}`
                }
            };
        }
        return {
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong"
            }
        };
    }
}
