import {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
} from "./content-script-handler.js";
import {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  buildUnifiedRiskStateOutput,
  getIssueActionMatrixEntry,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState,
  type ExecutionMode,
  type IssueActionMatrixEntry,
  type IssueScope,
  type RiskState
} from "../shared/risk-state.js";

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
  consumerGateResult?: XhsTargetGateResult["consumerGateResult"];
  gatePayload?: XhsTargetGateResult["gatePayload"];
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

type ExtensionTab = {
  id?: number;
  url?: string;
  active?: boolean;
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
    query(filter: {
      active?: boolean;
      currentWindow?: boolean;
      url?: string | string[];
    }): Promise<ExtensionTab[]>;
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
type XhsActionType = "read" | "write" | "irreversible_write";
type XhsExecutionMode = ExecutionMode;
type XhsRiskState = RiskState;
type XhsIssueScope = IssueScope;

type XhsIssueActionMatrixEntry = IssueActionMatrixEntry;

interface XhsApprovalRecord {
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Record<string, boolean>;
}

interface XhsTargetGateResult {
  allowed: boolean;
  targetTabId: number | null;
  errorMessage: string;
  consumerGateResult: {
    risk_state: XhsRiskState;
    issue_scope: XhsIssueScope;
    target_domain: string | null;
    target_tab_id: number | null;
    target_page: string | null;
    action_type: XhsActionType;
    requested_execution_mode: XhsExecutionMode | null;
    effective_execution_mode: XhsExecutionMode;
    gate_decision: "allowed" | "blocked";
    gate_reasons: string[];
  };
  gatePayload: Record<string, unknown>;
}

const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_DOMAIN_ALLOWLIST = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_EXECUTION_MODES = new Set<XhsExecutionMode>(EXECUTION_MODES);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_SCOPE_CONTEXT = {
  platform: "xhs",
  read_domain: XHS_READ_DOMAIN,
  write_domain: XHS_WRITE_DOMAIN,
  domain_mixing_forbidden: true
} as const;
const XHS_GATE_CONTRACT_MARKERS = {
  recovery_requirements: "recovery_requirements"
} as const;
const XHS_PLUGIN_GATE_OWNERSHIP = {
  background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
  content_script_gate: ["page_context_check", "action_tier_check"],
  main_world_gate: ["signed_call_scope_check"],
  cli_role: "request_and_result_shell_only"
} as const;

const scoreXhsTab = (tab: ExtensionTab): number => {
  const url = typeof tab.url === "string" ? tab.url : "";
  if (url.includes("/search_result")) {
    return 0;
  }
  if (url.includes("/explore/")) {
    return 1;
  }
  if (url.includes("/user/profile/")) {
    return 2;
  }
  return 3;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const asBoolean = (value: unknown): boolean => value === true;

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const classifyXhsPage = (url: string, domain: string): string => {
  const parsed = parseUrl(url);
  if (!parsed) {
    return "unknown_tab";
  }

  const pathname = parsed.pathname;
  if (domain === XHS_READ_DOMAIN) {
    if (pathname.includes("/search_result")) {
      return "search_result_tab";
    }
    if (pathname.includes("/explore/")) {
      return "explore_detail_tab";
    }
    if (pathname.includes("/user/profile/")) {
      return "profile_tab";
    }
    if (pathname.includes("/home")) {
      return "home_tab";
    }
    return "read_unknown_tab";
  }

  if (pathname.includes("/publish")) {
    return "creator_publish_tab";
  }
  return "creator_home_tab";
};

const xhsGateReasonMessage = (reason: string): string => {
  const mapping: Record<string, string> = {
    REQUESTED_EXECUTION_MODE_NOT_EXPLICIT: "requested_execution_mode must be explicit",
    LIVE_EXECUTION_MODE_BLOCKED_BY_BACKGROUND_GATE:
      "live execution mode is blocked by background target gate",
    ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX: "requested action is blocked by issue/state matrix",
    ISSUE_ACTION_MATRIX_BLOCKED: "requested action is blocked by issue/state matrix",
    TARGET_DOMAIN_NOT_EXPLICIT: "target domain must be explicit",
    TARGET_DOMAIN_OUT_OF_SCOPE: "target domain is out of xhs read/write scope",
    TARGET_TAB_NOT_EXPLICIT: "target tab is not explicit",
    TARGET_PAGE_NOT_EXPLICIT: "target page is not explicit",
    ACTION_DOMAIN_MISMATCH: "read action cannot target write domain",
    EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND: "execution mode is unsupported for xhs.search",
    RISK_STATE_PAUSED: "risk state paused blocks live read",
    RISK_STATE_LIMITED: "risk state limited blocks high-risk live read",
    MANUAL_CONFIRMATION_MISSING: "manual confirmation is required for live mode",
    APPROVAL_CHECKS_INCOMPLETE: "approval checks are incomplete",
    TARGET_TAB_NOT_FOUND: "target tab is unavailable",
    TARGET_DOMAIN_MISMATCH: "target tab domain does not match target_domain",
    TARGET_PAGE_MISMATCH: "target tab page does not match target_page",
    TARGET_TAB_URL_INVALID: "target tab url is invalid"
  };
  return mapping[reason] ?? "xhs target gate blocked";
};

const parseRequestedExecutionMode = (value: unknown): XhsExecutionMode | null =>
  typeof value === "string" && XHS_EXECUTION_MODES.has(value as XhsExecutionMode)
    ? (value as XhsExecutionMode)
    : null;

const resolveRiskState = (value: unknown): XhsRiskState => resolveSharedRiskState(value);

const resolveIssueScope = (value: unknown): XhsIssueScope => resolveSharedIssueScope(value);

const normalizeApprovalRecord = (value: unknown): XhsApprovalRecord => {
  const approval = asRecord(value);
  const checks = asRecord(approval?.checks);
  return {
    approved: asBoolean(approval?.approved),
    approver: asNonEmptyString(approval?.approver),
    approved_at: asNonEmptyString(approval?.approved_at),
    checks: Object.fromEntries(
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checks?.[key])])
    )
  };
};

const resolveIssueActionMatrixEntry = (
  issueScope: XhsIssueScope,
  state: XhsRiskState
): XhsIssueActionMatrixEntry => {
  return getIssueActionMatrixEntry(issueScope, state);
};

const resolveBlockedFallbackMode = (
  requestedExecutionMode: XhsExecutionMode | null,
  riskState: XhsRiskState
): XhsExecutionMode =>
  requestedExecutionMode === "recon"
    ? "recon"
    : requestedExecutionMode === "live_write"
      ? "dry_run"
      : riskState === "limited"
        ? "recon"
        : "dry_run";

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
    const commandParams =
      typeof request.params.command_params === "object" && request.params.command_params !== null
        ? (request.params.command_params as Record<string, unknown>)
        : {};
    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      runId: String(request.params.run_id ?? request.id),
      tabId:
        typeof request.params.tab_id === "number" && Number.isInteger(request.params.tab_id)
          ? request.params.tab_id
          : String(request.params.command ?? "") === "xhs.search"
            ? 32
            : null,
      profile: typeof request.profile === "string" ? request.profile : null,
      cwd: String(request.params.cwd ?? ""),
      timeoutMs,
      command: String(request.params.command ?? ""),
      params:
        typeof request.params === "object" && request.params !== null
          ? { ...(request.params as Record<string, unknown>) }
          : {},
      commandParams
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
        payload: message.payload ?? {},
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
      ...(pending.gatePayload ? { payload: { ...pending.gatePayload } } : {}),
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
    const command = String(request.params.command ?? "");
    let tabId: number | null;
    let consumerGateResult: XhsTargetGateResult["consumerGateResult"] | undefined;
    let gatePayload: XhsTargetGateResult["gatePayload"] | undefined;
    if (command === "xhs.search") {
      const gateResult = await this.#evaluateXhsTargetGate(request);
      consumerGateResult = gateResult.consumerGateResult;
      gatePayload = gateResult.gatePayload;
      if (!gateResult.allowed || !gateResult.targetTabId) {
        this.#emit({
          id: request.id,
          status: "error",
          summary: {
            relay_path: "host>background>content-script>background>host"
          },
          payload: gateResult.gatePayload,
          error: {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: gateResult.errorMessage
          }
        });
        return;
      }
      tabId = gateResult.targetTabId;
    } else {
      tabId = await this.#resolveTargetTabId(request);
    }

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
    this.#pending.set(request.id, { request, timeout, consumerGateResult, gatePayload });

    const forward: BackgroundToContentMessage = {
      kind: "forward",
      id: request.id,
      runId: String(request.params.run_id ?? request.id),
      tabId,
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

  async #evaluateXhsTargetGate(request: BridgeRequest): Promise<XhsTargetGateResult> {
    const commandParams = asRecord(request.params.command_params) ?? {};
    const optionParams = asRecord(commandParams.options);
    const readGateParam = (key: string): unknown => {
      if (Object.prototype.hasOwnProperty.call(commandParams, key)) {
        return commandParams[key];
      }
      return optionParams?.[key];
    };
    const rawTargetDomain = readGateParam("target_domain");
    const rawTargetTabId = readGateParam("target_tab_id");
    const rawTargetPage = readGateParam("target_page");
    const rawRequestedExecutionMode = readGateParam("requested_execution_mode");
    const rawIssueScope = readGateParam("issue_scope");
    const rawRiskState = readGateParam("risk_state");
    const rawApprovalRecord = readGateParam("approval_record") ?? readGateParam("approval");
    const targetDomain = asNonEmptyString(rawTargetDomain);
    const targetTabId = asInteger(rawTargetTabId);
    const targetPage = asNonEmptyString(rawTargetPage);
    const issueScope = resolveIssueScope(rawIssueScope);
    const riskState = resolveRiskState(rawRiskState);
    const actionType: XhsActionType = "read";
    const requestedExecutionMode = parseRequestedExecutionMode(rawRequestedExecutionMode);
    const approvalRecord = normalizeApprovalRecord(rawApprovalRecord);
    const issueActionMatrixEntry = resolveIssueActionMatrixEntry(issueScope, riskState);
    const gateReasons: string[] = [];
    const pushReason = (reason: string): void => {
      if (!gateReasons.includes(reason)) {
        gateReasons.push(reason);
      }
    };

    if (!requestedExecutionMode) {
      pushReason("REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
    }
    if (!targetDomain) {
      pushReason("TARGET_DOMAIN_NOT_EXPLICIT");
    } else if (!XHS_DOMAIN_ALLOWLIST.has(targetDomain)) {
      pushReason("TARGET_DOMAIN_OUT_OF_SCOPE");
    }

    if (targetTabId === null) {
      pushReason("TARGET_TAB_NOT_EXPLICIT");
    }
    if (!targetPage) {
      pushReason("TARGET_PAGE_NOT_EXPLICIT");
    }
    if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
      pushReason("ACTION_DOMAIN_MISMATCH");
    }

    if (requestedExecutionMode === "live_write") {
      pushReason("EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
    }
    const isLiveReadMode =
      requestedExecutionMode === "live_read_limited" ||
      requestedExecutionMode === "live_read_high_risk";
    const isBlockedByStateMatrix =
      requestedExecutionMode !== null &&
      issueActionMatrixEntry.blocked_actions.includes(requestedExecutionMode);
    if (isBlockedByStateMatrix) {
      if (isLiveReadMode) {
        pushReason(`RISK_STATE_${riskState.toUpperCase()}`);
        pushReason("ISSUE_ACTION_MATRIX_BLOCKED");
      } else {
        pushReason("ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
      }
    }
    if (isLiveReadMode && !isBlockedByStateMatrix) {
      if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
        pushReason("MANUAL_CONFIRMATION_MISSING");
      }
      const missingChecks = XHS_REQUIRED_APPROVAL_CHECKS.filter(
        (key) => !approvalRecord.checks[key]
      );
      if (missingChecks.length > 0) {
        pushReason("APPROVAL_CHECKS_INCOMPLETE");
      }
    }

    if (gateReasons.length === 0 && targetDomain && targetTabId !== null && targetPage) {
      const domainTabs = await this.chromeApi.tabs.query({
        url: `*://${targetDomain}/*`
      });
      const targetTab = domainTabs.find((tab) => tab.id === targetTabId);
      if (!targetTab) {
        pushReason("TARGET_TAB_NOT_FOUND");
      } else {
        const tabUrl = typeof targetTab.url === "string" ? targetTab.url : "";
        const parsed = parseUrl(tabUrl);
        if (!parsed) {
          pushReason("TARGET_TAB_URL_INVALID");
        } else {
          if (parsed.hostname !== targetDomain) {
            pushReason("TARGET_DOMAIN_MISMATCH");
          }
          const actualPage = classifyXhsPage(tabUrl, targetDomain);
          if (actualPage !== targetPage) {
            pushReason("TARGET_PAGE_MISMATCH");
          }
        }
      }
    }

    const allowed = gateReasons.length === 0;
    const gateDecision: "allowed" | "blocked" = allowed ? "allowed" : "blocked";
    const requiresManualConfirmation =
      requestedExecutionMode === "live_read_limited" ||
      requestedExecutionMode === "live_read_high_risk" ||
      requestedExecutionMode === "live_write";
    const effectiveExecutionMode = allowed
      ? requestedExecutionMode ?? "dry_run"
      : resolveBlockedFallbackMode(requestedExecutionMode, riskState);
    if (allowed && requestedExecutionMode === "dry_run") {
      gateReasons.push("DEFAULT_MODE_DRY_RUN");
    }
    if (allowed && requestedExecutionMode === "recon") {
      gateReasons.push("DEFAULT_MODE_RECON");
    }
    if (
      allowed &&
      (requestedExecutionMode === "live_read_limited" ||
        requestedExecutionMode === "live_read_high_risk")
    ) {
      gateReasons.push("LIVE_MODE_APPROVED");
    }
    const consumerGateResult = {
      risk_state: riskState,
      issue_scope: issueScope,
      target_domain: targetDomain,
      target_tab_id: targetTabId,
      target_page: targetPage,
      action_type: actionType,
      requested_execution_mode: requestedExecutionMode,
      effective_execution_mode: effectiveExecutionMode,
      gate_decision: gateDecision,
      gate_reasons: gateReasons
    };
    const runId = String(request.params.run_id ?? request.id);
    const sessionId = String(request.params.session_id ?? this.#sessionId);
    const profile = typeof request.profile === "string" ? request.profile : null;
    const auditRecord = {
      event_id: `bg_gate_${request.id}`,
      run_id: runId,
      session_id: sessionId,
      profile,
      issue_scope: issueScope,
      risk_state: riskState,
      target_domain: targetDomain,
      target_tab_id: targetTabId,
      target_page: targetPage,
      action_type: actionType,
      requested_execution_mode: requestedExecutionMode,
      effective_execution_mode: effectiveExecutionMode,
      gate_decision: gateDecision,
      gate_reasons: gateReasons,
      approver: approvalRecord.approver,
      approved_at: approvalRecord.approved_at,
      recorded_at: new Date().toISOString()
    };
    const riskTransitionAudit = {
      run_id: runId,
      session_id: sessionId,
      issue_scope: issueScope,
      prev_state: riskState,
      next_state: riskState,
      trigger: "gate_evaluation",
      decision: gateDecision,
      reason: gateReasons[0] ?? "GATE_DECISION_RECORDED",
      approver: approvalRecord.approver
    };
    const gatePayload = {
      plugin_gate_ownership: XHS_PLUGIN_GATE_OWNERSHIP,
      scope_context: XHS_SCOPE_CONTEXT,
      gate_input: {
        run_id: runId,
        session_id: sessionId,
        profile,
        issue_scope: issueScope,
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        target_page: targetPage,
        action_type: actionType,
        requested_execution_mode: requestedExecutionMode,
        risk_state: riskState
      },
      gate_outcome: {
        effective_execution_mode: effectiveExecutionMode,
        gate_decision: gateDecision,
        gate_reasons: gateReasons,
        requires_manual_confirmation: requiresManualConfirmation
      },
      consumer_gate_result: consumerGateResult,
      approval_record: approvalRecord,
      issue_action_matrix: issueActionMatrixEntry,
      risk_state_output: buildUnifiedRiskStateOutput(riskState),
      audit_record: auditRecord,
      risk_transition_audit: riskTransitionAudit
    } satisfies Record<string, unknown>;

    return {
      allowed,
      targetTabId: allowed ? targetTabId : null,
      errorMessage: allowed ? "" : xhsGateReasonMessage(gateReasons[0] ?? "TARGET_TAB_NOT_EXPLICIT"),
      consumerGateResult,
      gatePayload
    };
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
    const payload =
      typeof result.payload === "object" && result.payload !== null
        ? { ...(result.payload as Record<string, unknown>) }
        : {};
    const summary =
      typeof payload.summary === "object" && payload.summary !== null
        ? (payload.summary as Record<string, unknown>)
        : null;
    if (pending.gatePayload) {
      for (const [key, value] of Object.entries(pending.gatePayload)) {
        const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
        const hasInSummary =
          summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
        if (!hasInPayload && !hasInSummary) {
          if (summary !== null) {
            summary[key] = value;
          } else {
            payload[key] = value;
          }
        }
      }
    } else if (
      pending.consumerGateResult &&
      !Object.prototype.hasOwnProperty.call(payload, "consumer_gate_result") &&
      !(summary !== null && Object.prototype.hasOwnProperty.call(summary, "consumer_gate_result"))
    ) {
      payload.consumer_gate_result = pending.consumerGateResult;
    }

    if (result.ok !== true) {
      this.#emit({
        id: request.id,
        status: "error",
        summary: {
          relay_path: "host>background>content-script>background>host"
        },
        payload,
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
      payload,
      error: null
    });
  }

  async #resolveTargetTabId(request: BridgeRequest): Promise<number | null> {
    if (typeof request.params.tab_id === "number" && Number.isInteger(request.params.tab_id)) {
      return request.params.tab_id;
    }
    const commandParams =
      typeof request.params.command_params === "object" && request.params.command_params !== null
        ? (request.params.command_params as Record<string, unknown>)
        : {};
    const options =
      typeof commandParams.options === "object" && commandParams.options !== null
        ? (commandParams.options as Record<string, unknown>)
        : {};
    if (typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)) {
      return options.target_tab_id;
    }

    const command = String(request.params.command ?? "");
    if (command === "xhs.search") {
      const xhsUrlPatterns = ["*://www.xiaohongshu.com/*", "*://edith.xiaohongshu.com/*", "*://*.xiaohongshu.com/*"];
      const xhsTabs = await this.chromeApi.tabs.query({
        currentWindow: true,
        url: xhsUrlPatterns
      });
      const ranked = xhsTabs
        .filter((tab) => typeof tab.id === "number")
        .sort((left, right) => {
          const scoreDiff = scoreXhsTab(left) - scoreXhsTab(right);
          if (scoreDiff !== 0) {
            return scoreDiff;
          }
          if (left.active === right.active) {
            return 0;
          }
          return left.active ? -1 : 1;
        });
      const candidate = ranked[0];
      return typeof candidate?.id === "number" ? candidate.id : null;
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
  void XHS_GATE_CONTRACT_MARKERS;
  const bridge = new ChromeBackgroundBridge(chromeApi, options);
  bridge.start();
};

const chromeApi = (globalThis as { chrome?: ExtensionChromeApi }).chrome;
if (chromeApi?.runtime?.connectNative) {
  startChromeBackgroundBridge(chromeApi);
}
