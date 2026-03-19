import net from "node:net";
import { DEFAULT_TRANSPORT_TIMEOUT_MS, ensureBridgeRequestEnvelope } from "./protocol.js";
const withTransportCode = (error, code) => Object.assign(error, { transportCode: code });
const readSocketPath = () => {
    const value = process.env.WEBENVOY_NATIVE_BRIDGE_SOCKET;
    if (!value || value.trim().length === 0) {
        return null;
    }
    return value;
};
const parseResponse = (line) => {
    const parsed = JSON.parse(line);
    return parsed;
};
const sendEnvelope = (socketPath, request) => new Promise((resolve, reject) => {
    const timeoutMs = request.timeout_ms ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    let buffer = "";
    const done = (fn) => {
        if (settled) {
            return;
        }
        settled = true;
        socket.removeAllListeners();
        socket.destroy();
        fn();
    };
    socket.setTimeout(timeoutMs, () => {
        done(() => reject(withTransportCode(new Error("native bridge socket timeout"), "ERR_TRANSPORT_TIMEOUT")));
    });
    socket.on("error", (error) => {
        done(() => reject(withTransportCode(error, "ERR_TRANSPORT_FORWARD_FAILED")));
    });
    socket.on("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
    });
    socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            if (line.length > 0) {
                try {
                    const response = parseResponse(line);
                    if (response.id === request.id) {
                        done(() => resolve(response));
                        return;
                    }
                }
                catch (error) {
                    done(() => reject(withTransportCode(error, "ERR_TRANSPORT_FORWARD_FAILED")));
                    return;
                }
            }
            newlineIndex = buffer.indexOf("\n");
        }
    });
    socket.on("end", () => {
        done(() => reject(withTransportCode(new Error("native bridge socket closed before response"), "ERR_TRANSPORT_DISCONNECTED")));
    });
});
export class SocketNativeBridgeTransport {
    #socketPath;
    constructor(socketPath = readSocketPath()) {
        this.#socketPath = socketPath;
    }
    open(request) {
        return this.#request(request);
    }
    forward(request) {
        return this.#request(request);
    }
    heartbeat(request) {
        return this.#request(request);
    }
    #request(request) {
        ensureBridgeRequestEnvelope(request);
        if (!this.#socketPath) {
            return Promise.reject(new Error("native bridge socket is not configured"));
        }
        return sendEnvelope(this.#socketPath, request);
    }
}
