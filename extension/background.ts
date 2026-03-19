import {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
} from "./content-script.js";

type BridgeRequest = {
  id: string;
  method: "bridge.open" | "bridge.forward" | "__ping__";
  profile: string | null;
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

interface PendingForward {
  request: BridgeRequest;
  timeout: ReturnType<typeof setTimeout>;
}

const defaultForwardTimeoutMs = 3_000;
const defaultNativeHostName = "com.webenvoy.host";

type RuntimeMessageSender = {
  tab?: {
    id?: number;
  };
};

interface ExtensionPort {
  postMessage(message: BridgeResponse): void;
  onMessage: {
    addListener(listener: (message: BridgeRequest) => void): void;
  };
  onDisconnect: {
    addListener(listener: () => void): void;
  };
}

interface ExtensionChromeApi {
  runtime: {
    connectNative(hostName: string): ExtensionPort;
    onMessage: {
      addListener(listener: (message: unknown, sender: RuntimeMessageSender) => void): void;
    };
    onInstalled?: {
      addListener(listener: () => void): void;
    };
    onStartup?: {
      addListener(listener: () => void): void;
    };
  };
  tabs: {
    query(filter: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number }>>;
    sendMessage(tabId: number, message: BackgroundToContentMessage): Promise<void>;
  };
}

export class BackgroundRelay {
  #listeners = new Set<NativeMessageListener>();
  #pending = new Map<string, PendingForward>();
  #sessionId = "nm-session-001";
  #forwardTimeoutMs: number;

  constructor(
    private readonly contentScript: ContentScriptHandler,
    options?: { forwardTimeoutMs?: number }
  ) {
    this.#forwardTimeoutMs = options?.forwardTimeoutMs ?? defaultForwardTimeoutMs;
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

    const timeout = setTimeout(() => {
      this.#failPending(request.id, {
        code: "ERR_TRANSPORT_TIMEOUT",
        message: "content script forward timed out"
      });
    }, this.#forwardTimeoutMs);
    this.#pending.set(request.id, { request, timeout });
    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      runId: String(request.params.run_id ?? request.id),
      profile: typeof request.profile === "string" ? request.profile : null,
      cwd: String(request.params.cwd ?? ""),
      command: String(request.params.command ?? ""),
      params:
        typeof request.params === "object" && request.params !== null
          ? { ...(request.params as Record<string, unknown>) }
          : {},
      commandParams:
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {}
    };
    try {
      const accepted = this.contentScript.onBackgroundMessage(forward);
      if (!accepted) {
        this.#failPending(request.id, {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "content script unreachable"
        });
      }
    } catch {
      this.#failPending(request.id, {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: "content script dispatch failed"
      });
    }
  }

  #onContentResult(message: ContentToBackgroundMessage): void {
    const pending = this.#pending.get(message.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(message.id);
    const request = pending.request;

    if (!message.ok) {
      this.#emit({
        id: request.id,
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
      id: request.id,
      status: "success",
      summary: {
        session_id: String(request.params.session_id ?? this.#sessionId),
        run_id: String(request.params.run_id ?? request.id),
        command: String(request.params.command ?? "runtime.ping"),
        profile: typeof request.profile === "string" ? request.profile : null,
        cwd: String(request.params.cwd ?? ""),
        relay_path: "host>background>content-script>background>host"
      },
      payload: message.payload ?? {},
      error: null
    });
  }

  #failPending(id: string, error: { code: string; message: string }): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    this.#emit({
      id: pending.request.id,
      status: "error",
      summary: {
        relay_path: "host>background>content-script>background>host"
      },
      error
    });
  }

  #emit(message: BridgeResponse): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}

class ChromeBackgroundBridge {
  #port: ExtensionPort | null = null;
  #pending = new Map<string, PendingForward>();

  constructor(
    private readonly chromeApi: ExtensionChromeApi,
    private readonly options?: { nativeHostName?: string; forwardTimeoutMs?: number }
  ) {}

  start(): void {
    this.#connectNativePort();
    this.chromeApi.runtime.onMessage.addListener((message, sender) => {
      this.#onContentScriptResult(message, sender);
    });
    this.chromeApi.runtime.onInstalled?.addListener(() => this.#connectNativePort());
    this.chromeApi.runtime.onStartup?.addListener(() => this.#connectNativePort());
  }

  #connectNativePort(): void {
    if (this.#port) {
      return;
    }

    const hostName = this.options?.nativeHostName ?? defaultNativeHostName;
    const port = this.chromeApi.runtime.connectNative(hostName);
    this.#port = port;

    port.onMessage.addListener((request) => {
      void this.#onNativeRequest(request);
    });
    port.onDisconnect.addListener(() => {
      this.#port = null;
      this.#failAllPending({
        code: "ERR_TRANSPORT_DISCONNECTED",
        message: "native messaging disconnected"
      });
    });
  }

  async #onNativeRequest(request: BridgeRequest): Promise<void> {
    if (request.method === "bridge.open") {
      this.#emit({
        id: request.id,
        status: "success",
        summary: {
          protocol: "webenvoy.native-bridge.v1",
          state: "ready",
          session_id: String(request.params.session_id ?? "nm-session-001")
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
          session_id: String(request.params.session_id ?? "nm-session-001")
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

    const tabId = await this.#resolveTargetTabId(request);
    if (!tabId) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "target tab is unavailable"
        }
      });
      return;
    }

    const timeoutMs = this.options?.forwardTimeoutMs ?? defaultForwardTimeoutMs;
    const timeout = setTimeout(() => {
      this.#failPending(request.id, {
        code: "ERR_TRANSPORT_TIMEOUT",
        message: "content script forward timed out"
      });
    }, timeoutMs);
    this.#pending.set(request.id, { request, timeout });

    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      runId: String(request.params.run_id ?? request.id),
      profile: typeof request.profile === "string" ? request.profile : null,
      cwd: String(request.params.cwd ?? ""),
      command: String(request.params.command ?? ""),
      params:
        typeof request.params === "object" && request.params !== null
          ? { ...(request.params as Record<string, unknown>) }
          : {},
      commandParams:
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {}
    };

    try {
      await this.chromeApi.tabs.sendMessage(tabId, forward);
    } catch {
      this.#failPending(request.id, {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: "content script dispatch failed"
      });
    }
  }

  #onContentScriptResult(message: unknown, sender: RuntimeMessageSender): void {
    const result = message as Partial<ContentToBackgroundMessage> | null;
    if (!result || result.kind !== "result" || typeof result.id !== "string") {
      return;
    }

    const pending = this.#pending.get(result.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.#pending.delete(result.id);
    const request = pending.request;

    if (result.ok !== true) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error:
          result.error ?? {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: "content script failed"
          }
      });
      return;
    }

    this.#emit({
      id: request.id,
      status: "success",
      summary: {
        session_id: String(request.params.session_id ?? "nm-session-001"),
        run_id: String(request.params.run_id ?? request.id),
        command: String(request.params.command ?? "runtime.ping"),
        profile: typeof request.profile === "string" ? request.profile : null,
        cwd: String(request.params.cwd ?? ""),
        tab_id: sender.tab?.id ?? null,
        relay_path: "host>background>content-script>background>host"
      },
      payload:
        typeof result.payload === "object" && result.payload !== null
          ? (result.payload as Record<string, unknown>)
          : {},
      error: null
    });
  }

  async #resolveTargetTabId(request: BridgeRequest): Promise<number | null> {
    if (typeof request.params.tab_id === "number" && Number.isInteger(request.params.tab_id)) {
      return request.params.tab_id;
    }

    const tabs = await this.chromeApi.tabs.query({
      active: true,
      currentWindow: true
    });
    const first = tabs[0];
    return typeof first?.id === "number" ? first.id : null;
  }

  #failPending(id: string, error: { code: string; message: string }): void {
    const pending = this.#pending.get(id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.#pending.delete(id);
    this.#emit({
      id,
      status: "error",
      summary: {
        relay_path: "host>background>content-script>background>host"
      },
      error
    });
  }

  #failAllPending(error: { code: string; message: string }): void {
    for (const [id] of this.#pending.entries()) {
      this.#failPending(id, error);
    }
  }

  #emit(message: BridgeResponse): void {
    this.#port?.postMessage(message);
  }
}

export const startChromeBackgroundBridge = (chromeApi: ExtensionChromeApi): void => {
  const bridge = new ChromeBackgroundBridge(chromeApi);
  bridge.start();
};

const chromeApi = (globalThis as { chrome?: ExtensionChromeApi }).chrome;
if (chromeApi?.runtime?.connectNative) {
  startChromeBackgroundBridge(chromeApi);
}
