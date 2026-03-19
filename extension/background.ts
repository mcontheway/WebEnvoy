import {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
} from "./content-script-handler.js";

type BridgeRequest = {
  id: string;
  method: "bridge.open" | "bridge.forward" | "__ping__";
  profile: string | null;
  params: Record<string, unknown>;
  timeout_ms?: number;
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

interface QueuedForwardRequest {
  request: BridgeRequest;
  deadlineMs: number;
}

const defaultForwardTimeoutMs = 3_000;
const defaultHandshakeTimeoutMs = 30_000;
const defaultNativeHostName = "com.webenvoy.host";
const bridgeProtocol = "webenvoy.native-bridge.v1";
const maxRecoveryQueuedForwards = 5;
const readTimeoutMs = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value < 1) {
    return null;
  }
  return Math.floor(value);
};

type RuntimeMessageSender = {
  tab?: {
    id?: number;
  };
};

interface ExtensionPort {
  postMessage(message: unknown): void;
  disconnect?(): void;
  onMessage: {
    addListener(listener: (message: unknown) => void): void;
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

interface NativeHeartbeatMessage {
  id: string;
  method: "__ping__";
  profile: null;
  params: {
    session_id: string;
    timestamp: string;
  };
  timeout_ms: number;
}

type NativeBridgeState = "connecting" | "ready" | "recovering" | "disconnected";

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

    const timeoutMs = readTimeoutMs(request.timeout_ms) ?? this.#forwardTimeoutMs;
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
      timeoutMs,
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
  #recoveryQueue: QueuedForwardRequest[] = [];
  #heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  #heartbeatTimeout: ReturnType<typeof setTimeout> | null = null;
  #handshakeTimeout: ReturnType<typeof setTimeout> | null = null;
  #recoveryTimer: ReturnType<typeof setInterval> | null = null;
  #recoveryDeadlineMs: number | null = null;
  #pendingHeartbeatId: string | null = null;
  #pendingHandshakeId: string | null = null;
  #sessionId = "nm-session-001";
  #heartbeatSeq = 0;
  #handshakeSeq = 0;
  #missedHeartbeatCount = 0;
  #state: NativeBridgeState = "connecting";

  constructor(
    private readonly chromeApi: ExtensionChromeApi,
    private readonly options?: ChromeBackgroundBridgeOptions
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
    if (this.#port && this.#state !== "recovering" && this.#state !== "disconnected") {
      return;
    }

    if (this.#port) {
      this.#disposeCurrentPort();
    }

    const hostName = this.options?.nativeHostName ?? defaultNativeHostName;
    const port = this.chromeApi.runtime.connectNative(hostName);
    this.#port = port;
    this.#state = "connecting";
    this.#missedHeartbeatCount = 0;
    this.#pendingHeartbeatId = null;
    this.#clearHeartbeatTimeout();
    this.#clearHandshakeTimeout();
    this.#pendingHandshakeId = null;

    port.onMessage.addListener((message) => {
      if (this.#port !== port) {
        return;
      }
      void this.#onNativeMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.#port !== port) {
        return;
      }
      this.#handleDisconnect("native messaging disconnected");
    });

    this.#sendHandshakeOpen(port);
    this.#startHeartbeatLoop();
  }

  #sendHandshakeOpen(port: ExtensionPort): void {
    const timeoutMs = this.options?.handshakeTimeoutMs ?? defaultHandshakeTimeoutMs;
    const request: BridgeRequest = {
      id: this.#nextHandshakeId(),
      method: "bridge.open",
      profile: null,
      params: {
        protocol: bridgeProtocol,
        capabilities: ["relay", "heartbeat"]
      },
      timeout_ms: timeoutMs
    };
    this.#pendingHandshakeId = request.id;
    port.postMessage(request);
    this.#clearHandshakeTimeout();
    this.#handshakeTimeout = setTimeout(() => {
      if (this.#port !== port || this.#pendingHandshakeId !== request.id) {
        return;
      }
      this.#pendingHandshakeId = null;
      this.#handleDisconnect("handshake timeout");
    }, timeoutMs);
  }

  #startHeartbeatLoop(): void {
    if (this.#heartbeatTimer) {
      return;
    }

    const intervalMs = this.options?.heartbeatIntervalMs ?? 20_000;
    this.#heartbeatTimer = setInterval(() => {
      this.#sendHeartbeat();
    }, intervalMs);
  }

  #sendHeartbeat(): void {
    if (!this.#port || this.#state !== "ready") {
      return;
    }

    if (this.#pendingHeartbeatId) {
      return;
    }

    const timeoutMs = this.options?.heartbeatTimeoutMs ?? 5_000;
    const heartbeat: NativeHeartbeatMessage = {
      id: this.#nextHeartbeatId(),
      method: "__ping__",
      profile: null,
      params: {
        session_id: this.#sessionId,
        timestamp: new Date().toISOString()
      },
      timeout_ms: timeoutMs
    };
    this.#pendingHeartbeatId = heartbeat.id;
    this.#port.postMessage(heartbeat);

    this.#clearHeartbeatTimeout();
    this.#heartbeatTimeout = setTimeout(() => {
      if (!this.#pendingHeartbeatId) {
        return;
      }
      this.#pendingHeartbeatId = null;
      this.#missedHeartbeatCount += 1;
      const maxMissed = this.options?.maxMissedHeartbeats ?? 2;
      if (this.#missedHeartbeatCount >= maxMissed) {
        this.#handleDisconnect("heartbeat timeout");
      }
    }, timeoutMs);
  }

  #handleDisconnect(message: string): void {
    this.#clearHeartbeatTimeout();
    this.#clearHandshakeTimeout();
    this.#pendingHandshakeId = null;
    this.#pendingHeartbeatId = null;
    this.#missedHeartbeatCount = 0;
    this.#failAllPending({
      code: "ERR_TRANSPORT_DISCONNECTED",
      message
    });
    this.#disposeCurrentPort();
    this.#enterRecovery(message);
  }

  async #onNativeMessage(message: unknown): Promise<void> {
    const handshakeResponse = message as Partial<BridgeResponse> | null;
    if (
      handshakeResponse &&
      typeof handshakeResponse.id === "string" &&
      handshakeResponse.id === this.#pendingHandshakeId &&
      (handshakeResponse.status === "success" || handshakeResponse.status === "error")
    ) {
      this.#onHandshakeResponse(handshakeResponse as BridgeResponse);
      return;
    }

    const heartbeatAck = message as
      | (Partial<NativeHeartbeatMessage> & { status?: "success" | "error" })
      | null;
    if (
      heartbeatAck &&
      typeof heartbeatAck.id === "string" &&
      heartbeatAck.id === this.#pendingHeartbeatId &&
      (heartbeatAck.method === "__ping__" ||
        (heartbeatAck as { method?: string }).method === "__pong__" ||
        heartbeatAck.status === "success")
    ) {
      this.#pendingHeartbeatId = null;
      this.#missedHeartbeatCount = 0;
      this.#clearHeartbeatTimeout();
      return;
    }

    const request = message as BridgeRequest;
    await this.#onNativeRequest(request);
  }

  #onHandshakeResponse(response: BridgeResponse): void {
    this.#clearHandshakeTimeout();
    this.#pendingHandshakeId = null;

    if (response.status !== "success") {
      const message = response.error?.message ?? "handshake failed";
      this.#handleDisconnect(`handshake failed: ${message}`);
      return;
    }

    const protocol =
      typeof response.summary.protocol === "string" ? response.summary.protocol : null;
    if (protocol !== bridgeProtocol) {
      this.#handleDisconnect(`incompatible protocol: ${protocol ?? "unknown"}`);
      return;
    }

    const sessionId =
      typeof response.summary.session_id === "string" && response.summary.session_id.length > 0
        ? response.summary.session_id
        : this.#sessionId;
    this.#sessionId = sessionId;
    this.#state = "ready";
    this.#recoveryDeadlineMs = null;
    this.#stopRecoveryLoop();
    void this.#replayRecoveryQueue();
  }

  #clearHeartbeatTimeout(): void {
    if (!this.#heartbeatTimeout) {
      return;
    }
    clearTimeout(this.#heartbeatTimeout);
    this.#heartbeatTimeout = null;
  }

  #clearHandshakeTimeout(): void {
    if (!this.#handshakeTimeout) {
      return;
    }
    clearTimeout(this.#handshakeTimeout);
    this.#handshakeTimeout = null;
  }

  #disposeCurrentPort(): void {
    const current = this.#port;
    this.#port = null;
    if (!current) {
      return;
    }
    try {
      current.disconnect?.();
    } catch {
      // ignore teardown errors from stale ports
    }
  }

  #enterRecovery(message: string): void {
    const recoveryWindowMs = this.options?.recoveryWindowMs ?? 30_000;
    this.#state = "recovering";
    this.#recoveryDeadlineMs = Date.now() + recoveryWindowMs;
    this.#startRecoveryLoop();
  }

  #startRecoveryLoop(): void {
    const retryIntervalMs = this.options?.recoveryRetryIntervalMs ?? 1_000;
    if (this.#recoveryTimer) {
      return;
    }

    const tick = (): void => {
      if (this.#state !== "recovering" && this.#state !== "connecting") {
        return;
      }
      this.#expireQueuedForwards(Date.now());
      const deadline = this.#recoveryDeadlineMs;
      if (deadline !== null && Date.now() >= deadline) {
        this.#state = "disconnected";
        this.#recoveryDeadlineMs = null;
        this.#failRecoveryQueue("recovery window exhausted");
        this.#stopRecoveryLoop();
        return;
      }
      this.#connectNativePort();
    };

    tick();
    this.#recoveryTimer = setInterval(tick, retryIntervalMs);
  }

  #stopRecoveryLoop(): void {
    if (!this.#recoveryTimer) {
      return;
    }
    clearInterval(this.#recoveryTimer);
    this.#recoveryTimer = null;
  }

  #nextHeartbeatId(): string {
    this.#heartbeatSeq += 1;
    return `bg-hb-${this.#heartbeatSeq.toString().padStart(4, "0")}`;
  }

  #nextHandshakeId(): string {
    this.#handshakeSeq += 1;
    return `bg-open-${this.#handshakeSeq.toString().padStart(4, "0")}`;
  }

  async #onNativeRequest(request: BridgeRequest): Promise<void> {
    if (request.method === "bridge.open") {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_HANDSHAKE_FAILED",
          message: "bridge.open must be initiated by extension/background"
        }
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

    if (this.#state !== "ready") {
      if (this.#isRecoveryWindowOpen()) {
        this.#enqueueRecoveryForward(request);
        return;
      }
      const code = this.#state === "disconnected" ? "ERR_TRANSPORT_DISCONNECTED" : "ERR_TRANSPORT_NOT_READY";
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code,
          message:
            code === "ERR_TRANSPORT_DISCONNECTED"
              ? "native messaging disconnected"
              : "native bridge is not ready"
        }
      });
      return;
    }

    await this.#dispatchForward(request);
  }

  #isRecoveryWindowOpen(): boolean {
    const deadline = this.#recoveryDeadlineMs;
    return deadline !== null && Date.now() < deadline;
  }

  #enqueueRecoveryForward(request: BridgeRequest): void {
    const timeoutMs = this.#resolveForwardTimeoutMs(request);
    const deadlineMs = Date.now() + timeoutMs;
    if (Date.now() >= deadlineMs) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_TIMEOUT",
          message: "forward request timed out during recovery"
        }
      });
      return;
    }
    if (this.#recoveryQueue.length >= maxRecoveryQueuedForwards) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_DISCONNECTED",
          message: `recovery queue exhausted (${maxRecoveryQueuedForwards})`
        }
      });
      return;
    }
    this.#recoveryQueue.push({
      request,
      deadlineMs
    });
  }

  async #replayRecoveryQueue(): Promise<void> {
    if (this.#recoveryQueue.length === 0) {
      return;
    }
    this.#expireQueuedForwards(Date.now());
    const queued = [...this.#recoveryQueue];
    this.#recoveryQueue.length = 0;
    for (const queuedForward of queued) {
      const request = queuedForward.request;
      if (Date.now() >= queuedForward.deadlineMs) {
        this.#emit({
          id: request.id,
          status: "error",
          summary: {
            relay_path: "host>background>content-script>background>host"
          },
          error: {
            code: "ERR_TRANSPORT_TIMEOUT",
            message: "forward request timed out during recovery"
          }
        });
        continue;
      }
      if (this.#state !== "ready") {
        this.#recoveryQueue.push(queuedForward);
        continue;
      }
      await this.#dispatchForward(request, queuedForward.deadlineMs);
    }
  }

  #failRecoveryQueue(message: string): void {
    const queued = [...this.#recoveryQueue];
    this.#recoveryQueue.length = 0;
    for (const queuedForward of queued) {
      const request = queuedForward.request;
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_DISCONNECTED",
          message
        }
      });
    }
  }

  #expireQueuedForwards(nowMs: number): void {
    if (this.#recoveryQueue.length === 0) {
      return;
    }
    const keep: QueuedForwardRequest[] = [];
    for (const queuedForward of this.#recoveryQueue) {
      if (nowMs < queuedForward.deadlineMs) {
        keep.push(queuedForward);
        continue;
      }
      this.#emit({
        id: queuedForward.request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_TIMEOUT",
          message: "forward request timed out during recovery"
        }
      });
    }
    this.#recoveryQueue = keep;
  }

  async #dispatchForward(request: BridgeRequest, deadlineMs?: number): Promise<void> {
    const requestDeadlineMs = deadlineMs ?? Date.now() + this.#resolveForwardTimeoutMs(request);
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

    const timeoutMs = requestDeadlineMs - Date.now();
    if (timeoutMs <= 0) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        error: {
          code: "ERR_TRANSPORT_TIMEOUT",
          message: "forward request timed out during recovery"
        }
      });
      return;
    }
    const forwardTimeoutMs = Math.max(1, Math.floor(timeoutMs));
    const timeout = setTimeout(() => {
      this.#failPending(request.id, {
        code: "ERR_TRANSPORT_TIMEOUT",
        message: "content script forward timed out"
      });
    }, forwardTimeoutMs);
    this.#pending.set(request.id, { request, timeout });

    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      runId: String(request.params.run_id ?? request.id),
      profile: typeof request.profile === "string" ? request.profile : null,
      cwd: String(request.params.cwd ?? ""),
      timeoutMs: forwardTimeoutMs,
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

  #resolveForwardTimeoutMs(request: BridgeRequest): number {
    return (
      readTimeoutMs(request.timeout_ms) ??
      this.options?.forwardTimeoutMs ??
      defaultForwardTimeoutMs
    );
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

export interface ChromeBackgroundBridgeOptions {
  nativeHostName?: string;
  forwardTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxMissedHeartbeats?: number;
  recoveryWindowMs?: number;
  recoveryRetryIntervalMs?: number;
}

export const startChromeBackgroundBridge = (
  chromeApi: ExtensionChromeApi,
  options?: ChromeBackgroundBridgeOptions
): void => {
  const bridge = new ChromeBackgroundBridge(chromeApi, options);
  bridge.start();
};

const chromeApi = (globalThis as { chrome?: ExtensionChromeApi }).chrome;
if (chromeApi?.runtime?.connectNative) {
  startChromeBackgroundBridge(chromeApi);
}
