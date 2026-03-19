export class ContentScriptHandler {
    #listeners = new Set();
    #reachable = true;
    onResult(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    setReachable(reachable) {
        this.#reachable = reachable;
    }
    onBackgroundMessage(message) {
        if (!this.#reachable) {
            return false;
        }
        if (message.commandParams.simulate_no_response === true) {
            return true;
        }
        const result = this.#handleForward(message);
        for (const listener of this.#listeners) {
            listener(result);
        }
        return true;
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
                message: "pong",
                run_id: message.runId,
                profile: message.profile,
                cwd: message.cwd
            }
        };
    }
}
const chromeApi = globalThis.chrome;
const runtime = chromeApi?.runtime;
if (runtime?.onMessage?.addListener && runtime.sendMessage) {
    const handler = new ContentScriptHandler();
    handler.onResult((message) => {
        runtime.sendMessage?.(message);
    });
    runtime.onMessage.addListener((message) => {
        const request = message;
        if (!request || request.kind !== "forward" || typeof request.id !== "string") {
            return;
        }
        const accepted = handler.onBackgroundMessage({
            kind: "forward",
            id: request.id,
            runId: typeof request.runId === "string" ? request.runId : request.id,
            profile: typeof request.profile === "string" ? request.profile : null,
            cwd: typeof request.cwd === "string" ? request.cwd : "",
            command: typeof request.command === "string" ? request.command : "",
            params: typeof request.params === "object" && request.params !== null
                ? request.params
                : {},
            commandParams: typeof request.commandParams === "object" && request.commandParams !== null
                ? request.commandParams
                : {}
        });
        if (!accepted) {
            runtime.sendMessage?.({
                kind: "result",
                id: request.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script unreachable"
                }
            });
        }
    });
}
