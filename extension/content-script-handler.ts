export type BackgroundToContentMessage = {
  kind: "forward";
  id: string;
  runId: string;
  profile: string | null;
  cwd: string;
  timeoutMs: number;
  command: string;
  params: Record<string, unknown>;
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
  #reachable = true;

  onResult(listener: ContentMessageListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setReachable(reachable: boolean): void {
    this.#reachable = reachable;
  }

  onBackgroundMessage(message: BackgroundToContentMessage): boolean {
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
        message: "pong",
        run_id: message.runId,
        profile: message.profile,
        cwd: message.cwd
      }
    };
  }
}
