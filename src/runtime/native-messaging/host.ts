import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  DEFAULT_TRANSPORT_TIMEOUT_MS,
  ensureBridgeRequestEnvelope,
  type BridgeRequestEnvelope,
  type BridgeResponseEnvelope
} from "./protocol.js";
import type { NativeBridgeTransport } from "./transport.js";

type TransportCodedError = Error & {
  transportCode?:
    | "ERR_TRANSPORT_HANDSHAKE_FAILED"
    | "ERR_TRANSPORT_TIMEOUT"
    | "ERR_TRANSPORT_DISCONNECTED"
    | "ERR_TRANSPORT_FORWARD_FAILED";
};

const withTransportCode = (
  error: Error,
  code: TransportCodedError["transportCode"]
): TransportCodedError => Object.assign(error, { transportCode: code });

const readNativeHostCommand = (): string | null => {
  const value = process.env.WEBENVOY_NATIVE_HOST_CMD;
  if (!value || value.trim().length === 0) {
    return null;
  }
  return value.trim();
};

const splitNativeHostCommand = (command: string): string[] | null => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;

  const pushCurrent = (): void => {
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
      } else {
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

export const parseNativeHostCommand = (
  command: string | null
): { file: string; args: string[] } | null => {
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

const encodeNativeMessage = (payload: string): Buffer => {
  const body = Buffer.from(payload, "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
};

const asTransportError = (
  error: unknown,
  fallback: TransportCodedError["transportCode"]
): TransportCodedError => {
  const normalized = error instanceof Error ? error : new Error(String(error));
  return withTransportCode(normalized, fallback);
};

type TransportPhase = "open" | "forward" | "heartbeat";

interface PendingMessage {
  phase: TransportPhase;
  timeout: NodeJS.Timeout;
  resolve: (response: BridgeResponseEnvelope) => void;
  reject: (error: TransportCodedError) => void;
}

export class NativeHostBridgeTransport implements NativeBridgeTransport {
  readonly #hostCommand: string | null;
  readonly #hostSpec: { file: string; args: string[] } | null;
  #child: ChildProcessWithoutNullStreams | null = null;
  #stdoutBuffer = Buffer.alloc(0);
  #pending = new Map<string, PendingMessage>();

  constructor(hostCommand: string | null = readNativeHostCommand()) {
    this.#hostCommand = hostCommand;
    this.#hostSpec = parseNativeHostCommand(hostCommand);
  }

  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.#send("open", request);
  }

  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.#send("forward", request);
  }

  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.#send("heartbeat", request);
  }

  #send(phase: TransportPhase, request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    ensureBridgeRequestEnvelope(request);

    if (!this.#hostCommand || !this.#hostSpec) {
      const code =
        phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
      return Promise.reject(
        withTransportCode(new Error("native host command is not configured or invalid"), code)
      );
    }

    this.#ensureChild();

    const child = this.#child;
    if (!child || child.killed) {
      const code =
        phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
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
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(request.id);
        const code =
          phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : "ERR_TRANSPORT_DISCONNECTED";
        reject(asTransportError(error, code));
      }
    });
  }

  #ensureChild(): void {
    if (this.#child && !this.#child.killed) {
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

    child.stdout.on("data", (chunk: Buffer) => {
      this.#onStdout(chunk);
    });

    child.on("error", (error) => {
      this.#drainPending(asTransportError(error, "ERR_TRANSPORT_DISCONNECTED"));
    });

    child.on("exit", () => {
      this.#drainPending(
        withTransportCode(new Error("native host process exited"), "ERR_TRANSPORT_DISCONNECTED")
      );
      this.#child = null;
      this.#stdoutBuffer = Buffer.alloc(0);
    });
  }

  #onStdout(chunk: Buffer): void {
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
        const response = JSON.parse(frame.toString("utf8")) as BridgeResponseEnvelope;
        const pending = this.#pending.get(response.id);
        if (!pending) {
          continue;
        }
        clearTimeout(pending.timeout);
        this.#pending.delete(response.id);
        pending.resolve(response);
      } catch (error) {
        this.#drainPending(asTransportError(error, "ERR_TRANSPORT_FORWARD_FAILED"));
        return;
      }
    }
  }

  #drainPending(error: TransportCodedError): void {
    for (const [id, pending] of this.#pending.entries()) {
      clearTimeout(pending.timeout);
      const code =
        pending.phase === "open" ? "ERR_TRANSPORT_HANDSHAKE_FAILED" : error.transportCode;
      pending.reject(withTransportCode(new Error(error.message), code));
      this.#pending.delete(id);
    }
  }
}
