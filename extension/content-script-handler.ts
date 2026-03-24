import { executeXhsSearch, type SearchExecutionResult, type XhsSearchEnvironment } from "./xhs-search.js";

export type BackgroundToContentMessage = {
  kind: "forward";
  id: string;
  runId: string;
  tabId: number | null;
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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const extractFetchBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      message: text
    };
  }
};

const encodeUtf8Base64 = (value: string): string => {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)));
  }
  const bufferCtor = (globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64");
  }
  throw new Error("base64 encoder is unavailable");
};

export const encodeMainWorldPayload = (value: Record<string, unknown>): string =>
  encodeUtf8Base64(JSON.stringify(value));

const mainWorldCall = async <T>(request: {
  type: "xhs-sign";
  payload: Record<string, unknown>;
}): Promise<T> => {
  const eventName = "__webenvoy_main_world_result__";
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `mw-${Date.now()}`;

  return await new Promise<T>((resolve, reject) => {
    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<Record<string, unknown>>;
      if (!customEvent.detail || customEvent.detail.id !== requestId) {
        return;
      }

      window.removeEventListener(eventName, listener as EventListener);

      if (customEvent.detail.ok === true) {
        resolve(customEvent.detail.result as T);
        return;
      }

      reject(
        new Error(
          typeof customEvent.detail.message === "string"
            ? customEvent.detail.message
            : "main world call failed"
        )
      );
    };

    window.addEventListener(eventName, listener as EventListener);
    const encodedRequest = encodeMainWorldPayload({
      id: requestId,
      ...request
    });
    const script = document.createElement("script");
    script.textContent = `
      (() => {
        const decodeRequest = (encoded) => JSON.parse(decodeURIComponent(escape(atob(encoded))));
        const request = decodeRequest(${JSON.stringify(encodedRequest)});
        const emit = (detail) => {
          window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail }));
        };
        try {
          if (request.type === "xhs-sign") {
            const fn = window._webmsxyw;
            if (typeof fn !== "function") {
              emit({ id: request.id, ok: false, message: "window._webmsxyw is not available" });
              return;
            }
            const result = fn(request.payload.uri, request.payload.body);
            emit({ id: request.id, ok: true, result });
            return;
          }
          emit({ id: request.id, ok: false, message: "unsupported main world call" });
        } catch (error) {
          emit({
            id: request.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    `;
    (document.documentElement ?? document.head ?? document.body).appendChild(script);
    script.remove();
  });
};

const createBrowserEnvironment = (): XhsSearchEnvironment => ({
  now: () => Date.now(),
  randomId: () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `id-${Date.now()}`,
  getLocationHref: () => window.location.href,
  getDocumentTitle: () => document.title,
  getReadyState: () => document.readyState,
  getCookie: () => document.cookie,
  callSignature: async (uri, payload) =>
    await mainWorldCall<{ "X-s": string; "X-t": string | number }>({
      type: "xhs-sign",
      payload: {
        uri,
        body: payload
      }
    }),
  fetchJson: async (input) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, input.timeoutMs);

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        credentials: "include",
        signal: controller.signal
      });

      return {
        status: response.status,
        body: await extractFetchBody(response)
      };
    } finally {
      clearTimeout(timer);
    }
  }
});

const resolveTargetDomainFromHref = (href: string): string | null => {
  try {
    return new URL(href).hostname || null;
  } catch {
    return null;
  }
};

const resolveTargetPageFromHref = (href: string): string | null => {
  try {
    const url = new URL(href);
    if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
      return "search_result_tab";
    }
    if (url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish")) {
      return "creator_publish_tab";
    }
    return null;
  } catch {
    return null;
  }
};

export class ContentScriptHandler {
  #listeners = new Set<ContentMessageListener>();
  #reachable = true;
  #xhsEnv: XhsSearchEnvironment;

  constructor(options?: { xhsEnv?: XhsSearchEnvironment }) {
    this.#xhsEnv = options?.xhsEnv ?? createBrowserEnvironment();
  }

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

    if (message.command === "xhs.search") {
      void this.#handleXhsSearch(message);
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

  async #handleXhsSearch(message: BackgroundToContentMessage): Promise<void> {
    const ability = asRecord(message.commandParams.ability);
    const input = asRecord(message.commandParams.input);
    const options = asRecord(message.commandParams.options) ?? {};
    const locationHref = this.#xhsEnv.getLocationHref();
    const actualTargetDomain = resolveTargetDomainFromHref(locationHref);
    const actualTargetPage = resolveTargetPageFromHref(locationHref);

    if (!ability || !input) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "xhs.search payload missing ability or input"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "ABILITY_PAYLOAD_MISSING"
          }
        }
      });
      return;
    }

    try {
      const result = await executeXhsSearch(
        {
          abilityId: String(ability.id ?? "unknown"),
          abilityLayer: String(ability.layer ?? "L3"),
          abilityAction: String(ability.action ?? "read"),
          params: {
            query: String(input.query ?? ""),
            ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
            ...(typeof input.page === "number" ? { page: input.page } : {}),
            ...(typeof input.search_id === "string" ? { search_id: input.search_id } : {}),
            ...(typeof input.sort === "string" ? { sort: input.sort } : {}),
            ...(typeof input.note_type === "string" || typeof input.note_type === "number"
              ? { note_type: input.note_type }
              : {})
          },
          options: {
            ...(typeof options.timeout_ms === "number" ? { timeout_ms: options.timeout_ms } : {}),
            ...(typeof options.simulate_result === "string"
              ? { simulate_result: options.simulate_result }
              : {}),
            ...(typeof options.x_s_common === "string" ? { x_s_common: options.x_s_common } : {}),
            ...(typeof options.target_domain === "string"
              ? { target_domain: options.target_domain }
              : {}),
            ...(typeof options.target_tab_id === "number"
              ? { target_tab_id: options.target_tab_id }
              : {}),
            ...(typeof options.target_page === "string"
              ? { target_page: options.target_page }
              : {}),
            ...(typeof message.tabId === "number" ? { actual_target_tab_id: message.tabId } : {}),
            ...(actualTargetDomain ? { actual_target_domain: actualTargetDomain } : {}),
            ...(actualTargetPage ? { actual_target_page: actualTargetPage } : {}),
            ...(typeof ability.action === "string" ? { ability_action: ability.action } : {}),
            ...(typeof options.action_type === "string"
              ? { action_type: options.action_type }
              : {}),
            ...(typeof options.issue_scope === "string"
              ? { issue_scope: options.issue_scope }
              : {}),
            ...(typeof options.requested_execution_mode === "string"
              ? { requested_execution_mode: options.requested_execution_mode }
              : {}),
            ...(typeof options.risk_state === "string" ? { risk_state: options.risk_state } : {}),
            ...(asRecord(options.approval_record)
              ? { approval_record: asRecord(options.approval_record) ?? {} }
              : {}),
            ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {})
          },
          executionContext: {
            runId: message.runId,
            sessionId: String(message.params.session_id ?? "nm-session-001"),
            profile: message.profile ?? "unknown"
          }
        },
        this.#xhsEnv
      );

      this.#emit(this.#toContentMessage(message.id, result));
    } catch (error) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  }

  #toContentMessage(id: string, result: SearchExecutionResult): ContentToBackgroundMessage {
    if (!result.ok) {
      return {
        kind: "result",
        id,
        ok: false,
        error: result.error,
        payload: result.payload
      };
    }

    return {
      kind: "result",
      id,
      ok: true,
      payload: result.payload
    };
  }

  #emit(message: ContentToBackgroundMessage): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}
