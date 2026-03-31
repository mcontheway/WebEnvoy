import { spawn } from "node:child_process";
import { connect as connectSocket } from "node:net";
import { access } from "node:fs/promises";
import { DEFAULT_TRANSPORT_TIMEOUT_MS, ensureBridgeRequestEnvelope } from "./protocol.js";
const withTransportCode = (error, code) => Object.assign(error, { transportCode: code });
const readNativeHostCommand = () => {
    const value = process.env.WEBENVOY_NATIVE_HOST_CMD;
    if (!value || value.trim().length === 0) {
        return null;
    }
    return value.trim();
};
const splitNativeHostCommand = (command) => {
    const tokens = [];
    let current = "";
    let quote = null;
    let escaping = false;
    const pushCurrent = () => {
        if (current.length > 0) {
            tokens.push(current);
            current = "";
        }
    };
    for (const char of command) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }
        if (char === "\\") {
            escaping = true;
            continue;
        }
        if (quote) {
            if (char === quote) {
                quote = null;
            }
            else {
                current += char;
            }
            continue;
        }
        if (char === "'" || char === '"') {
            quote = char;
            continue;
        }
        if (/\s/.test(char)) {
            pushCurrent();
            continue;
        }
        current += char;
    }
    if (escaping || quote) {
        return null;
    }
    pushCurrent();
    return tokens.length > 0 ? tokens : null;
};
export const parseNativeHostCommand = (command) => {
    if (!command) {
        return null;
    }
    const tokens = splitNativeHostCommand(command);
    if (!tokens) {
        return null;
    }
    const [file, ...args] = tokens;
    return {
        file,
        args
    };
};
const encodeNativeMessage = (payload) => {
    const body = Buffer.from(payload, "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    return Buffer.concat([header, body]);
};
const asTransportError = (error, fallback) => {
    const normalized = error instanceof Error ? error : new Error(String(error));
    return withTransportCode(normalized, fallback);
};
export class NativeHostBridgeTransport {
    #hostCommand;
    #hostSpec;
    #socketPath;
    #child = null;
    #stdoutBuffer = Buffer.alloc(0);
    #pending = new Map();
    #closePromise = null;
    constructor(hostCommand = readNativeHostCommand(), options) {
        this.#hostCommand = hostCommand;
        this.#hostSpec = parseNativeHostCommand(hostCommand);
        this.#socketPath = options?.socketPath ?? null;
    }
    open(request) {
        return this.#send("open", request);
    }
    forward(request) {
        return this.#send("forward", request);
    }
    heartbeat(request) {
        return this.#send("heartbeat", request);
    }
    close() {
        if (this.#closePromise) {
            return this.#closePromise;
        }
        const child = this.#child;
        this.#child = null;
        this.#stdoutBuffer = Buffer.alloc(0);
        this.#drainPending(withTransportCode(new Error("native host process closed"), "ERR_TRANSPORT_DISCONNECTED"));
        if (!child) {
            return Promise.resolve();
        }
        this.#closePromise = new Promise((resolve) => {
            let settled = false;
            const settle = () => {
                if (settled) {
                    return;
                }
                settled = true;
                this.#closePromise = null;
                resolve();
            };
            const forceKillTimer = setTimeout(() => {
                if (!child.killed) {
                    child.kill("SIGTERM");
                }
                settle();
            }, 350);
            forceKillTimer.unref?.();
            child.once("exit", () => {
                clearTimeout(forceKillTimer);
                settle();
            });
            child.stdin.end();
        });
        return this.#closePromise;
    }
    #send(phase, request) {
        ensureBridgeRequestEnvelope(request);
        if (this.#socketPath) {
            return this.#sendViaSocket(phase, request);
        }
        return this.#sendViaSpawn(phase, request);
    }
    #sendViaSpawn(phase, request) {
        if (!this.#hostCommand || !this.#hostSpec) {
            const code = phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
            return Promise.reject(withTransportCode(new Error("native host command is not configured or invalid"), code));
        }
        this.#ensureChild();
        const child = this.#child;
        if (!child || child.killed) {
            const code = phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
            return Promise.reject(withTransportCode(new Error("native host process is unavailable"), code));
        }
        return new Promise((resolve, reject) => {
            const timeoutMs = request.timeout_ms ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
            const timeout = setTimeout(() => {
                const pending = this.#pending.get(request.id);
                if (!pending) {
                    return;
                }
                this.#pending.delete(request.id);
                const code = "ERR_TRANSPORT_TIMEOUT";
                pending.reject(withTransportCode(new Error("native host response timeout"), code));
            }, timeoutMs);
            this.#pending.set(request.id, {
                phase,
                timeout,
                resolve,
                reject
            });
            try {
                const payload = JSON.stringify(request);
                child.stdin.write(encodeNativeMessage(payload));
            }
            catch (error) {
                clearTimeout(timeout);
                this.#pending.delete(request.id);
                const code = phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
                reject(asTransportError(error, code));
            }
        });
    }
    async #sendViaSocket(phase, request) {
        const socketPath = this.#socketPath;
        if (!socketPath) {
            throw withTransportCode(new Error("native bridge socket is not configured"), "ERR_TRANSPORT_DISCONNECTED");
        }
        try {
            await access(socketPath);
        }
        catch {
            const code = phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
            throw withTransportCode(new Error("native bridge socket is unavailable"), code);
        }
        return await new Promise((resolve, reject) => {
            const socket = connectSocket(socketPath);
            let buffer = Buffer.alloc(0);
            let settled = false;
            const timeoutMs = request.timeout_ms ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
            const timeout = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                socket.destroy();
                reject(withTransportCode(new Error("native bridge socket timeout"), "ERR_TRANSPORT_TIMEOUT"));
            }, timeoutMs);
            const settleReject = (error, code) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                reject(withTransportCode(error, code));
            };
            socket.once("error", (error) => {
                settleReject(error instanceof Error ? error : new Error(String(error)), phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED");
            });
            socket.on("data", (chunk) => {
                if (settled) {
                    return;
                }
                buffer = Buffer.concat([buffer, chunk]);
                if (buffer.length < 4) {
                    return;
                }
                const frameLength = buffer.readUInt32LE(0);
                const frameEnd = 4 + frameLength;
                if (buffer.length < frameEnd) {
                    return;
                }
                try {
                    const response = JSON.parse(buffer.subarray(4, frameEnd).toString("utf8"));
                    settled = true;
                    clearTimeout(timeout);
                    socket.end();
                    resolve(response);
                }
                catch (error) {
                    settleReject(asTransportError(error, "ERR_TRANSPORT_FORWARD_FAILED"), "ERR_TRANSPORT_FORWARD_FAILED");
                }
            });
            socket.once("connect", () => {
                try {
                    socket.write(encodeNativeMessage(JSON.stringify(request)));
                }
                catch (error) {
                    settleReject(asTransportError(error, "ERR_TRANSPORT_DISCONNECTED"), "ERR_TRANSPORT_DISCONNECTED");
                }
            });
        });
    }
    #ensureChild() {
        if (this.#child &&
            !this.#child.killed &&
            this.#child.exitCode === null &&
            !this.#child.stdin.destroyed) {
            return;
        }
        if (!this.#hostSpec) {
            return;
        }
        const child = spawn(this.#hostSpec.file, this.#hostSpec.args, {
            shell: false,
            stdio: ["pipe", "pipe", "pipe"],
            env: process.env
        });
        this.#child = child;
        this.#stdoutBuffer = Buffer.alloc(0);
        child.stdout.on("data", (chunk) => {
            this.#onStdout(chunk);
        });
        child.on("error", (error) => {
            this.#drainPending(asTransportError(error, "ERR_TRANSPORT_DISCONNECTED"));
        });
        child.on("exit", () => {
            this.#drainPending(withTransportCode(new Error("native host process exited"), "ERR_TRANSPORT_DISCONNECTED"));
            this.#child = null;
            this.#stdoutBuffer = Buffer.alloc(0);
        });
    }
    #onStdout(chunk) {
        this.#stdoutBuffer = Buffer.concat([this.#stdoutBuffer, chunk]);
        while (this.#stdoutBuffer.length >= 4) {
            const frameLength = this.#stdoutBuffer.readUInt32LE(0);
            const frameEnd = 4 + frameLength;
            if (this.#stdoutBuffer.length < frameEnd) {
                return;
            }
            const frame = this.#stdoutBuffer.subarray(4, frameEnd);
            this.#stdoutBuffer = this.#stdoutBuffer.subarray(frameEnd);
            try {
                const response = JSON.parse(frame.toString("utf8"));
                const pending = this.#pending.get(response.id);
                if (!pending) {
                    continue;
                }
                clearTimeout(pending.timeout);
                this.#pending.delete(response.id);
                pending.resolve(response);
            }
            catch (error) {
                this.#drainPending(asTransportError(error, "ERR_TRANSPORT_FORWARD_FAILED"));
                return;
            }
        }
    }
    #drainPending(error) {
        for (const [id, pending] of this.#pending.entries()) {
            clearTimeout(pending.timeout);
            const code = pending.phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : error.transportCode;
            pending.reject(withTransportCode(new Error(error.message), code));
            this.#pending.delete(id);
        }
    }
}
