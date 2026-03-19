export type BackgroundToContentMessage = {
  kind: "forward";
  id: string;
  command: string;
  commandParams: Record<string, unknown>;
};

export type ContentToBackgroundMessage = {
  kind: "result";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
};

export type ContentMessageListener = (message: ContentToBackgroundMessage) => void;

export class ContentScriptHandler {
  #listeners = new Set<ContentMessageListener>();

  onResult(listener: ContentMessageListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  onBackgroundMessage(message: BackgroundToContentMessage): void {
    const result = this.#handleForward(message);
    for (const listener of this.#listeners) {
      listener(result);
    }
  }

  #handleForward(message: BackgroundToContentMessage): ContentToBackgroundMessage {
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
