import {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
} from "./content-script.js";

type BridgeRequest = {
  id: string;
  method: "bridge.open" | "bridge.forward" | "__ping__";
  params: Record<string, unknown>;
};

type BridgeResponse = {
  id: string;
  status: "success" | "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null | { code: string; message: string };
};

type NativeMessageListener = (message: BridgeResponse) => void;

export class BackgroundRelay {
  #listeners = new Set<NativeMessageListener>();
  #pending = new Map<string, BridgeRequest>();
  #sessionId = "nm-session-001";

  constructor(private readonly contentScript: ContentScriptHandler) {
    this.contentScript.onResult((message) => {
      this.#onContentResult(message);
    });
  }

  onNativeMessage(listener: NativeMessageListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onNativeRequest(request: BridgeRequest): void {
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
    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      command: String(request.params.command ?? ""),
      commandParams:
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {}
    };
    this.contentScript.onBackgroundMessage(forward);
  }

  #onContentResult(message: ContentToBackgroundMessage): void {
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
        error:
          message.error ?? {
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

  #emit(message: BridgeResponse): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}
