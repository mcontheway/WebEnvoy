import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope, type BridgeRequestEnvelope, type BridgeResponseEnvelope } from "./protocol.js";
import type { NativeBridgeTransport } from "./transport.js";

type HostMessage =
  | { kind: "request"; envelope: BridgeRequestEnvelope }
  | { kind: "response"; envelope: BridgeResponseEnvelope };

type ContentMessage =
  | {
      kind: "forward";
      id: string;
      command: string;
      commandParams: Record<string, unknown>;
      runId: string;
      sessionId: string;
    }
  | {
      kind: "result";
      id: string;
      ok: boolean;
      payload?: Record<string, unknown>;
      error?: { code: string; message: string };
    };

const RELAY_PATH = "host>background>content-script>background>host";

class InMemoryPort<TMessage> {
  #listeners = new Set<(message: TMessage) => void>();
  #peer: InMemoryPort<TMessage> | null = null;

  connect(peer: InMemoryPort<TMessage>): void {
    this.#peer = peer;
  }

  onMessage(listener: (message: TMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  postMessage(message: TMessage): void {
    const peer = this.#peer;
    if (!peer) {
      return;
    }

    queueMicrotask(() => {
      for (const listener of peer.#listeners) {
        listener(message);
      }
    });
  }
}

const createPortPair = <TMessage>(): [InMemoryPort<TMessage>, InMemoryPort<TMessage>] => {
  const left = new InMemoryPort<TMessage>();
  const right = new InMemoryPort<TMessage>();
  left.connect(right);
  right.connect(left);
  return [left, right];
};

class InMemoryContentScriptRuntime {
  constructor(private readonly port: InMemoryPort<ContentMessage>) {
    this.port.onMessage((message) => {
      if (message.kind !== "forward") {
        return;
      }

      this.port.postMessage(this.handleForward(message));
    });
  }

  private handleForward(message: Extract<ContentMessage, { kind: "forward" }>): ContentMessage {
    if (message.command === "runtime.ping") {
      return {
        kind: "result",
        id: message.id,
        ok: true,
        payload: {
          message: "pong"
        }
      };
    }

    if (message.command === "xhs.search") {
      const simulated =
        typeof message.commandParams.options === "object" &&
        message.commandParams.options !== null &&
        typeof (message.commandParams.options as Record<string, unknown>).simulate_result === "string"
          ? String((message.commandParams.options as Record<string, unknown>).simulate_result)
          : "success";
      const ability =
        typeof message.commandParams.ability === "object" && message.commandParams.ability !== null
          ? (message.commandParams.ability as Record<string, unknown>)
          : {};
      const input =
        typeof message.commandParams.input === "object" && message.commandParams.input !== null
          ? (message.commandParams.input as Record<string, unknown>)
          : {};

      if (simulated === "success") {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                layer: String(ability.layer ?? "L3"),
                action: String(ability.action ?? "read"),
                outcome: "success",
                data_ref: {
                  query: String(input.query ?? ""),
                  search_id: "loopback-search-id"
                },
                metrics: {
                  count: 2,
                  duration_ms: 12
                }
              }
            },
            observability: {
              page_state: {
                page_kind: "search",
                url: "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete"
              },
              key_requests: [
                {
                  request_id: "req-loopback-001",
                  stage: "request",
                  method: "POST",
                  url: "/api/sns/web/v1/search/notes",
                  outcome: "completed",
                  status_code: 200
                }
              ],
              failure_site: null
            }
          }
        };
      }

      return {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message:
            simulated === "login_required"
              ? "登录态缺失，无法执行 xhs.search"
              : simulated === "account_abnormal"
                ? "账号异常，平台拒绝当前请求"
                : simulated === "browser_env_abnormal"
                  ? "浏览器环境异常，平台拒绝当前请求"
                  : simulated === "signature_entry_missing"
                    ? "页面签名入口不可用"
                    : "网关调用失败，当前上下文不足以完成搜索请求"
        },
        payload: {
          details: {
            ability_id: String(ability.id ?? "xhs.note.search.v1"),
            stage: "execution",
            reason:
              simulated === "login_required"
                ? "SESSION_EXPIRED"
                : simulated === "account_abnormal"
                  ? "ACCOUNT_ABNORMAL"
                  : simulated === "browser_env_abnormal"
                    ? "BROWSER_ENV_ABNORMAL"
                    : simulated === "signature_entry_missing"
                      ? "SIGNATURE_ENTRY_MISSING"
                      : "GATEWAY_INVOKER_FAILED"
          },
          observability: {
            page_state: {
              page_kind: simulated === "login_required" ? "login" : "search",
              url:
                simulated === "login_required"
                  ? "https://www.xiaohongshu.com/login"
                  : "https://www.xiaohongshu.com/search_result",
              title: "Search Result",
              ready_state: "complete"
            },
            key_requests: [
              {
                request_id: "req-loopback-001",
                stage: "request",
                method: "POST",
                url: "/api/sns/web/v1/search/notes",
                outcome: "failed",
                status_code:
                  simulated === "account_abnormal"
                    ? 461
                    : simulated === "browser_env_abnormal"
                      ? 200
                      : simulated === "gateway_invoker_failed"
                        ? 500
                        : undefined,
                failure_reason: simulated
              }
            ],
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "execution" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            }
          },
          diagnosis: {
            category: simulated === "signature_entry_missing" ? "page_changed" : "request_failed",
            stage: simulated === "signature_entry_missing" ? "execution" : "request",
            component: simulated === "signature_entry_missing" ? "page" : "network",
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "execution" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            },
            evidence: [simulated]
          }
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

class InMemoryBackgroundRelay {
  #pendingForward = new Map<
    string,
    {
      request: BridgeRequestEnvelope;
    }
  >();
  #sessionId = "nm-session-001";

  constructor(
    private readonly hostPort: InMemoryPort<HostMessage>,
    private readonly contentPort: InMemoryPort<ContentMessage>
  ) {
    this.hostPort.onMessage((message) => {
      if (message.kind !== "request") {
        return;
      }

      this.handleHostRequest(message.envelope);
    });

    this.contentPort.onMessage((message) => {
      if (message.kind !== "result") {
        return;
      }

      this.handleContentResult(message);
    });
  }

  private handleHostRequest(request: BridgeRequestEnvelope): void {
    ensureBridgeRequestEnvelope(request);

    if (request.method === "bridge.open") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            protocol: BRIDGE_PROTOCOL,
            session_id: this.#sessionId,
            state: "ready",
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "__ping__") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            session_id: this.#sessionId,
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "bridge.forward") {
      const command = String(request.params.command ?? "");
      const commandParams =
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {};
      const runId = String(request.params.run_id ?? request.id);
      const sessionId = String(request.params.session_id ?? this.#sessionId);

      this.#pendingForward.set(request.id, { request });
      this.contentPort.postMessage({
        kind: "forward",
        id: request.id,
        command,
        commandParams,
        runId,
        sessionId
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: `unknown method: ${request.method}`
        }
      }
    });
  }

  private handleContentResult(result: Extract<ContentMessage, { kind: "result" }>): void {
    const pending = this.#pendingForward.get(result.id);
    if (!pending) {
      return;
    }
    this.#pendingForward.delete(result.id);

    const request = pending.request;
    if (!result.ok) {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "error",
          summary: {
            relay_path: RELAY_PATH
          },
          payload: result.payload ?? {},
          error: result.error ?? {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: "content script failed"
          }
        }
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "success",
        summary: {
          session_id: String(request.params.session_id ?? this.#sessionId),
          run_id: String(request.params.run_id ?? request.id),
          command: String(request.params.command ?? "runtime.ping"),
          relay_path: RELAY_PATH
        },
        payload: result.payload ?? {},
        error: null
      }
    });
  }
}

class InMemoryHostTransport implements NativeBridgeTransport {
  #pending = new Map<
    string,
    {
      resolve: (response: BridgeResponseEnvelope) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(private readonly hostPort: InMemoryPort<HostMessage>) {
    this.hostPort.onMessage((message) => {
      if (message.kind !== "response") {
        return;
      }

      const pending = this.#pending.get(message.envelope.id);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.envelope.id);
      pending.resolve(message.envelope);
    });
  }

  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  private request(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    ensureBridgeRequestEnvelope(request);
    return new Promise<BridgeResponseEnvelope>((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.hostPort.postMessage({
        kind: "request",
        envelope: request
      });
    });
  }
}

export const createLoopbackNativeBridgeTransport = (): NativeBridgeTransport => {
  const [hostPort, backgroundHostPort] = createPortPair<HostMessage>();
  const [backgroundContentPort, contentPort] = createPortPair<ContentMessage>();

  new InMemoryContentScriptRuntime(contentPort);
  new InMemoryBackgroundRelay(backgroundHostPort, backgroundContentPort);

  return new InMemoryHostTransport(hostPort);
};

export const loopbackRelayPath = (): string => RELAY_PATH;
