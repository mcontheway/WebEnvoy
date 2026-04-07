export class NativeBridgePendingForwardState {
    #pending = new Map();
    register(id, pending) {
        this.#pending.set(id, pending);
    }
    take(id) {
        const pending = this.#pending.get(id);
        if (!pending) {
            return null;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(id);
        return pending;
    }
    fail(id, error, emit) {
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
    failAll(error, emit) {
        for (const id of [...this.#pending.keys()]) {
            this.fail(id, error, emit);
        }
    }
}
