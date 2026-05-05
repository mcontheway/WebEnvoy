import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DETAIL_ENDPOINT,
  SEARCH_ENDPOINT,
  USER_HOME_ENDPOINT,
  createPageContextNamespace,
  createDetailRequestShape,
  createSearchRequestShape,
  createUserHomeRequestShape,
  createVisitedPageContextNamespace,
  serializeDetailRequestShape,
  serializeSearchRequestShape,
  serializeUserHomeRequestShape
} from "../extension/xhs-search-types.js";

type MockEventListener = (event: Event) => void;

class MockCustomEvent<T> {
  readonly type: string;
  readonly detail: T;

  constructor(type: string, init: { detail: T }) {
    this.type = type;
    this.detail = init.detail;
  }
}

const SEARCH_PAGE_HREF = "https://www.xiaohongshu.com/search_result?keyword=contract";
const DETAIL_PAGE_HREF = "https://www.xiaohongshu.com/explore/note-001";
const USER_HOME_PAGE_HREF = "https://www.xiaohongshu.com/user/profile/user-001";

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const createShapeKey = (input: {
  keyword: string;
  page?: number;
  page_size?: number;
  sort?: string;
  note_type?: number;
}): string => {
  const shape = createSearchRequestShape(input);
  if (!shape) {
    throw new Error("shape must be valid in test");
  }
  return serializeSearchRequestShape(shape);
};

const createDetailShapeKey = (noteId: string): string => {
  const shape = createDetailRequestShape({ source_note_id: noteId });
  if (!shape) {
    throw new Error("detail shape must be valid in test");
  }
  return serializeDetailRequestShape(shape);
};

const createUserHomeShapeKey = (userId: string): string => {
  const shape = createUserHomeRequestShape({ user_id: userId });
  if (!shape) {
    throw new Error("user_home shape must be valid in test");
  }
  return serializeUserHomeRequestShape(shape);
};

const createMockMainWorldEnvironment = (href = SEARCH_PAGE_HREF) => {
  const listeners = new Map<string, MockEventListener[]>();
  const added: Array<{ type: string; listener: MockEventListener }> = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  let fetchHandler: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null =
    null;
  const xhrRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }> = [];

  class MockXMLHttpRequest {
    method = "GET";
    url = "";
    headers: Record<string, string> = {};
    status = 200;
    responseText = JSON.stringify({ code: 0, data: { items: [{ id: "note-xhr-001" }] } });
    response = this.responseText;
    responseType = "";
    completionEvent = "loadend";
    readonly listeners = new Map<string, MockEventListener[]>();

    open(method: string, url: string | URL): void {
      this.method = method;
      this.url = String(url);
    }

    setRequestHeader(name: string, value: string): void {
      this.headers[name] = value;
    }

    send(body?: unknown): void {
      xhrRequests.push({
        method: this.method,
        url: this.url,
        headers: { ...this.headers },
        body
      });
      void Promise.resolve().then(() => {
        this.dispatch(this.completionEvent);
      });
    }

    addEventListener(type: string, listener: MockEventListener): void {
      const existing = this.listeners.get(type) ?? [];
      existing.push(listener);
      this.listeners.set(type, existing);
    }

    removeEventListener(type: string, listener: MockEventListener): void {
      const existing = this.listeners.get(type) ?? [];
      this.listeners.set(
        type,
        existing.filter((entry) => entry !== listener)
      );
    }

    getAllResponseHeaders(): string {
      return "content-type: application/json\r\n";
    }

    private dispatch(type: string): void {
      for (const listener of this.listeners.get(type) ?? []) {
        listener({ type } as unknown as Event);
      }
    }
  }

  const mockWindow = {
    addEventListener: (type: string, listener: MockEventListener) => {
      added.push({ type, listener });
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    removeEventListener: vi.fn((type: string, listener: MockEventListener) => {
      const existing = listeners.get(type) ?? [];
      listeners.set(
        type,
        existing.filter((entry) => entry !== listener)
      );
    }),
    dispatchEvent: vi.fn((event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      dispatched.push({ type: event.type, detail });
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    }),
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!fetchHandler) {
        throw new Error("mock fetch handler unavailable");
      }
      return await fetchHandler(input, init);
    }),
    location: {
      href
    },
    navigator: {},
    XMLHttpRequest: MockXMLHttpRequest
  };
  const updateHref = (url?: string | URL | null): void => {
    if (url === undefined || url === null) {
      return;
    }
    mockWindow.location.href = new URL(String(url), mockWindow.location.href).toString();
  };
  (mockWindow as typeof mockWindow & { history?: History }).history = {
    pushState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
      updateHref(url);
    }),
    replaceState: vi.fn((_state: unknown, _unused: string, url?: string | URL | null) => {
      updateHref(url);
    })
  } as unknown as History;
  const mockDocument = {
    createElement: () => ({ textContent: "", remove: () => {} }),
    documentElement: {
      appendChild: (node: unknown) => node
    }
  };

  return {
    added,
    dispatched,
    listeners,
    mockWindow,
    mockDocument,
    xhrRequests,
    setFetchHandler: (
      handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
    ) => {
      fetchHandler = handler;
    }
  };
};

const installMockDomGlobals = (input: {
  mockWindow: Window & Record<string, unknown>;
  mockDocument: Record<string, unknown>;
}): void => {
  (globalThis as { window?: unknown }).window = input.mockWindow;
  (globalThis as { document?: unknown }).document = input.mockDocument;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEvent;
};

const bootstrapMainWorldBridge = async (
  added: Array<{ type: string; listener: MockEventListener }>
) => {
  const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
  await import("../extension/main-world-bridge.js");

  const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
  const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-capture");
  bootstrapListener?.({
    type: "__mw_bootstrap__",
    detail: {
      request_event: secretChannel.requestEvent,
      result_event: secretChannel.resultEvent,
      namespace_event: secretChannel.namespaceEvent
    }
  } as unknown as Event);

  const requestListener = added.find((entry) => entry.type === secretChannel.requestEvent)?.listener;
  if (!requestListener) {
    throw new Error("secret request listener was not installed");
  }

  return {
    requestEvent: secretChannel.requestEvent,
    resultEvent: secretChannel.resultEvent,
    namespaceEvent: secretChannel.namespaceEvent,
    requestListener
  };
};

const readCapturedContext = async (input: {
  dispatched: Array<{ type: string; detail: unknown }>;
  requestEvent: string;
  resultEvent: string;
  requestListener: MockEventListener;
  pageContextNamespace: string;
  shapeKey: string;
  method?: "POST" | "GET";
  path?: string;
  profileRef?: string;
  sessionId?: string;
  targetTabId?: number;
  runId?: string;
  actionRef?: string;
  pageUrl?: string;
  minObservedAt?: number;
}) => {
  await flushMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushMicrotasks();
  input.requestListener({
    type: input.requestEvent,
    detail: {
      id: `read-${Date.now()}`,
      type: "captured-request-context-read",
      payload: {
        method: input.method ?? "POST",
        path: input.path ?? SEARCH_ENDPOINT,
        page_context_namespace: input.pageContextNamespace,
        shape_key: input.shapeKey,
        ...(typeof input.profileRef === "string" ? { profile_ref: input.profileRef } : {}),
        ...(typeof input.sessionId === "string" ? { session_id: input.sessionId } : {}),
        ...(typeof input.targetTabId === "number" ? { target_tab_id: input.targetTabId } : {}),
        ...(typeof input.runId === "string" ? { run_id: input.runId } : {}),
        ...(typeof input.actionRef === "string" ? { action_ref: input.actionRef } : {}),
        ...(typeof input.pageUrl === "string" ? { page_url: input.pageUrl } : {}),
        ...(typeof input.minObservedAt === "number" ? { min_observed_at: input.minObservedAt } : {})
      }
    }
  } as unknown as Event);
  await flushMicrotasks();
  return (input.dispatched.filter((entry) => entry.type === input.resultEvent).at(-1)?.detail ??
    {}) as Record<string, unknown>;
};

const configureCapturedContextProvenance = async (input: {
  dispatched: Array<{ type: string; detail: unknown }>;
  requestEvent: string;
  resultEvent: string;
  requestListener: MockEventListener;
  pageContextNamespace: string;
  profileRef: string;
  sessionId: string;
  targetTabId: number;
  runId: string;
  actionRef: string;
  pageUrl: string;
}) => {
  input.requestListener({
    type: input.requestEvent,
    detail: {
      id: `configure-provenance-${Date.now()}`,
      type: "captured-request-context-provenance-set",
      payload: {
        page_context_namespace: input.pageContextNamespace,
        profile_ref: input.profileRef,
        session_id: input.sessionId,
        target_tab_id: input.targetTabId,
        run_id: input.runId,
        action_ref: input.actionRef,
        page_url: input.pageUrl
      }
    }
  } as unknown as Event);
  await flushMicrotasks();
  return (input.dispatched.filter((entry) => entry.type === input.resultEvent).at(-1)?.detail ??
    {}) as Record<string, unknown>;
};

describe("main-world bridge contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
    delete (globalThis as Record<string, unknown>).__WEBENVOY_MAIN_WORLD_BRIDGE_INSTALLED_V1__;
  });

  it("does not expose a page-observable control listener when no staged event channel is present", async () => {
    const { added, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    installMockDomGlobals({
      mockWindow: mockWindow as Window & Record<string, unknown>,
      mockDocument
    });

    await import("../extension/main-world-bridge.js");

    expect(added.map((entry) => entry.type)).toContain("__mw_bootstrap__");
    expect(added.some((entry) => entry.type.startsWith("__mw_req__"))).toBe(false);
  });

  it("attaches a secret-derived request listener after receiving bootstrap event", async () => {
    const { added, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    installMockDomGlobals({
      mockWindow: mockWindow as Window & Record<string, unknown>,
      mockDocument
    });

    const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
    await import("../extension/main-world-bridge.js");

    const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
    const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-001");
    bootstrapListener?.({
      type: "__mw_bootstrap__",
      detail: {
        request_event: secretChannel.requestEvent,
        result_event: secretChannel.resultEvent,
        namespace_event: secretChannel.namespaceEvent
      }
    } as unknown as Event);

    expect(added.map((entry) => entry.type)).toContain(secretChannel.requestEvent);
  });

  it("does not publish a page-visible install marker when reinjected into the same page", async () => {
    const { added, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    installMockDomGlobals({
      mockWindow: mockWindow as Window & Record<string, unknown>,
      mockDocument
    });

    await import("../extension/main-world-bridge.js");
    expect(added.filter((entry) => entry.type === "__mw_bootstrap__")).toHaveLength(1);

    vi.resetModules();
    await import("../extension/main-world-bridge.js");

    expect(
      (globalThis as Record<string, unknown>).__WEBENVOY_MAIN_WORLD_BRIDGE_INSTALLED_V1__
    ).toBeUndefined();
  });

  it("routes fingerprint install and verify through the bootstrapped event channel", async () => {
    const { added, dispatched, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    installMockDomGlobals({
      mockWindow: mockWindow as Window & Record<string, unknown>,
      mockDocument
    });

    const channel = await bootstrapMainWorldBridge(added);

    channel.requestListener({
      type: channel.requestEvent,
      detail: {
        id: "install-request-001",
        type: "fingerprint-install",
        payload: {
          fingerprint_runtime: {
            source: "contract",
            fingerprint_profile_bundle: {},
            fingerprint_patch_manifest: {
              required_patches: ["navigator_plugins", "navigator_mime_types"]
            }
          }
        }
      }
    } as unknown as Event);

    channel.requestListener({
      type: channel.requestEvent,
      detail: {
        id: "verify-request-001",
        type: "fingerprint-verify",
        payload: {}
      }
    } as unknown as Event);

    const resultEvents = dispatched.filter((entry) => entry.type === channel.resultEvent);
    expect(resultEvents).toHaveLength(2);
    expect(resultEvents[0]?.detail).toMatchObject({
      id: "install-request-001",
      ok: true,
      result: {
        source: "main_world",
        runtime_source: "contract",
        missing_required_patches: []
      }
    });
    expect(resultEvents[1]?.detail).toMatchObject({
      id: "verify-request-001",
      ok: true
    });
  });

  it("resolves bare explore search capture after an SPA transition enters a search page", async () => {
    const env = createMockMainWorldEnvironment();
    const originalFetch = env.mockWindow.fetch;
    const exploreHref = "https://www.xiaohongshu.com/explore";
    const searchNamespace = createPageContextNamespace(SEARCH_PAGE_HREF);
    env.mockWindow.location.href = exploreHref;
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    expect(env.mockWindow.fetch).not.toBe(originalFetch);
    const configured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: searchNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-explore-pretransition-001",
      actionRef: "xhs.search",
      pageUrl: SEARCH_PAGE_HREF
    });
    expect(configured).toMatchObject({
      ok: true,
      result: {
        configured: true,
        page_context_namespace: searchNamespace
      }
    });

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });
    env.mockWindow.history?.pushState({}, "", SEARCH_PAGE_HREF);
    expect(env.mockWindow.fetch).not.toBe(originalFetch);

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: searchNamespace,
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-explore-pretransition-001",
      actionRef: "xhs.search",
      pageUrl: SEARCH_PAGE_HREF
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: createVisitedPageContextNamespace(SEARCH_PAGE_HREF, 1),
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          page_context_namespace: createVisitedPageContextNamespace(SEARCH_PAGE_HREF, 1),
          captured_page_context_namespace: createVisitedPageContextNamespace(exploreHref, 0),
          profile_ref: "xhs_001",
          run_id: "run-search-explore-pretransition-001",
          action_ref: "xhs.search",
          page_url: SEARCH_PAGE_HREF
        }
      }
    });
  });

  it("binds same-query search_result captures after SPA visit drift to configured provenance", async () => {
    const pageUrl = "https://www.xiaohongshu.com/search_result/?keyword=contract&type=51";
    const nextPageUrl =
      "https://www.xiaohongshu.com/search_result/?keyword=contract&type=51&source=web_search_result_notes";
    const env = createMockMainWorldEnvironment(pageUrl);
    const searchNamespace = createPageContextNamespace(pageUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const configured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: searchNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-same-query-visit-drift-001",
      actionRef: "xhs.search",
      pageUrl
    });
    expect(configured).toMatchObject({
      ok: true,
      result: {
        configured: true,
        page_context_namespace: searchNamespace
      }
    });

    env.mockWindow.history?.pushState({}, "", nextPageUrl);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    const currentNamespace =
      asRecord(
        env.dispatched.filter((entry) => entry.type === channel.namespaceEvent).at(-1)?.detail
      )?.page_context_namespace ?? createVisitedPageContextNamespace(nextPageUrl, 1);
    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(nextPageUrl),
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-same-query-visit-drift-001",
      actionRef: "xhs.search",
      pageUrl
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: String(currentNamespace),
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          page_context_namespace: String(currentNamespace),
          profile_ref: "xhs_001",
          session_id: "nm-session-001",
          target_tab_id: 1230427051,
          run_id: "run-search-same-query-visit-drift-001",
          action_ref: "xhs.search",
          page_url: pageUrl
        }
      }
    });
  });

  it("prefers the newest compatible search_result provenance after repeated SPA revisits", async () => {
    const pageUrl = "https://www.xiaohongshu.com/search_result/?keyword=contract&type=51";
    const env = createMockMainWorldEnvironment(pageUrl);
    const searchNamespace = createPageContextNamespace(pageUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: searchNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-old",
      targetTabId: 1230427051,
      runId: "run-search-revisit-old-001",
      actionRef: "xhs.search.old",
      pageUrl
    });

    let latestProvenancePageUrl = pageUrl;
    for (let visit = 1; visit <= 10; visit += 1) {
      latestProvenancePageUrl = `${pageUrl}&source=revisit-${visit}`;
      env.mockWindow.history?.pushState({}, "", latestProvenancePageUrl);
    }
    const latestProvenanceNamespace =
      asRecord(
        env.dispatched.filter((entry) => entry.type === channel.namespaceEvent).at(-1)?.detail
      )?.page_context_namespace ?? createVisitedPageContextNamespace(latestProvenancePageUrl, 10);
    await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: String(latestProvenanceNamespace),
      profileRef: "xhs_001",
      sessionId: "nm-session-new",
      targetTabId: 1230427051,
      runId: "run-search-revisit-new-001",
      actionRef: "xhs.search.new",
      pageUrl: latestProvenancePageUrl
    });

    const capturePageUrl = `${pageUrl}&source=revisit-11`;
    env.mockWindow.history?.pushState({}, "", capturePageUrl);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(capturePageUrl),
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-new",
      targetTabId: 1230427051,
      runId: "run-search-revisit-new-001",
      actionRef: "xhs.search.new",
      pageUrl: latestProvenancePageUrl
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          session_id: "nm-session-new",
          run_id: "run-search-revisit-new-001",
          action_ref: "xhs.search.new",
          page_url: latestProvenancePageUrl
        }
      }
    });
  });

  it("stores configured provenance on later passive-captured page requests", async () => {
    const env = createMockMainWorldEnvironment();
    const pageContextNamespace = createPageContextNamespace(SEARCH_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const configured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-active-fallback-provenance-001",
      actionRef: "xhs.detail",
      pageUrl: SEARCH_PAGE_HREF
    });
    expect(configured).toMatchObject({
      ok: true,
      result: {
        configured: true,
        page_context_namespace: pageContextNamespace
      }
    });

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" })
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          profile_ref: "xhs_001",
          session_id: "nm-session-001",
          target_tab_id: 1230427051,
          run_id: "run-active-fallback-provenance-001",
          action_ref: "xhs.detail",
          page_url: SEARCH_PAGE_HREF
        }
      }
    });
  });

  it("does not return passive templates when requested provenance is absent or mismatched", async () => {
    const env = createMockMainWorldEnvironment();
    const pageContextNamespace = createPageContextNamespace(SEARCH_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    const capturedWithoutProvenance = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-provenance-required-001",
      actionRef: "read",
      pageUrl: SEARCH_PAGE_HREF
    });

      expect(capturedWithoutProvenance).toMatchObject({
        ok: true,
        result: {
          admitted_template: null,
          rejected_observation: null,
          incompatible_observation: null,
          diagnostics: {
            namespace_bucket_present: true,
            route_bucket_present: true,
            route_bucket: {
              shape_count: 1,
              artifact_count: 1,
              filtered_by_provenance_count: 1
            },
            exact_bucket: {
              admitted_template: {
                provenance_match: false,
                fresh_for_lookup: true
              }
            }
          }
        }
      });
    });

    it("reports request-context miss diagnostics for absent route buckets", async () => {
      const emptyEnv = createMockMainWorldEnvironment();
      installMockDomGlobals({
        mockWindow: emptyEnv.mockWindow as Window & Record<string, unknown>,
        mockDocument: emptyEnv.mockDocument
      });
      const emptyChannel = await bootstrapMainWorldBridge(emptyEnv.added);

      const emptyCaptured = await readCapturedContext({
        dispatched: emptyEnv.dispatched,
        requestEvent: emptyChannel.requestEvent,
        resultEvent: emptyChannel.resultEvent,
        requestListener: emptyChannel.requestListener,
        pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
        shapeKey: createShapeKey({ keyword: "contract" })
      });

      expect(emptyCaptured).toMatchObject({
        ok: true,
        result: {
          admitted_template: null,
          available_shape_keys: [],
          diagnostics: {
            namespace_bucket_present: false,
            route_bucket_present: false,
            exact_bucket_present: false,
            route_bucket: {
              shape_count: 0,
              artifact_count: 0
            }
          }
        }
      });
    });

    it("reports request-context miss diagnostics for freshness filters", async () => {
      const filteredEnv = createMockMainWorldEnvironment();
      const pageContextNamespace = createPageContextNamespace(SEARCH_PAGE_HREF);
      filteredEnv.setFetchHandler(async () => {
        return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      });
      installMockDomGlobals({
        mockWindow: filteredEnv.mockWindow as Window & Record<string, unknown>,
        mockDocument: filteredEnv.mockDocument
      });
      const filteredChannel = await bootstrapMainWorldBridge(filteredEnv.added);
      await (filteredEnv.mockWindow.fetch as typeof fetch)(
        `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ keyword: "contract" })
        }
      );
      await flushMicrotasks();
      const capturedAfterFreshWindow = await readCapturedContext({
        dispatched: filteredEnv.dispatched,
        requestEvent: filteredChannel.requestEvent,
        resultEvent: filteredChannel.resultEvent,
        requestListener: filteredChannel.requestListener,
        pageContextNamespace,
        shapeKey: createShapeKey({ keyword: "contract" }),
        minObservedAt: Date.now() + 1
      });

      expect(capturedAfterFreshWindow).toMatchObject({
        ok: true,
        result: {
          admitted_template: null,
          available_shape_keys: [],
          diagnostics: {
            namespace_bucket_present: true,
            route_bucket_present: true,
            exact_bucket_present: true,
            route_bucket: {
              shape_count: 1,
              artifact_count: 1,
              filtered_by_min_observed_at_count: 1
            },
            exact_bucket: {
              admitted_template: {
                fresh_for_lookup: false,
                provenance_match: true
              }
            }
          }
        }
      });
    });

  it("binds fresh current-namespace passive templates captured just before provenance is configured", async () => {
    const pageUrl = "https://www.xiaohongshu.com/search_result?keyword=fresh-bind";
    const env = createMockMainWorldEnvironment(pageUrl);
    const pageContextNamespace = createPageContextNamespace(pageUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-old" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });
    await flushMicrotasks();
    const capturedBeforeProvenance = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" })
    });
    expect(capturedBeforeProvenance).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request"
        }
      }
    });
    const configured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-active-fallback-provenance-late-001",
      actionRef: "xhs.detail",
      pageUrl
    });
    expect(configured).toMatchObject({
      ok: true,
      result: {
        configured: true,
        page_context_namespace: pageContextNamespace,
        bound_fresh_existing_templates: 1
      }
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" })
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          profile_ref: "xhs_001",
          session_id: "nm-session-001",
          target_tab_id: 1230427051,
          run_id: "run-active-fallback-provenance-late-001",
          action_ref: "xhs.detail",
          page_url: pageUrl
        }
      }
    });

    const reconfigured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      profileRef: "xhs_002",
      sessionId: "nm-session-002",
      targetTabId: 1230427052,
      runId: "run-active-fallback-provenance-late-002",
      actionRef: "xhs.detail",
      pageUrl
    });
    expect(reconfigured).toMatchObject({
      ok: true,
      result: {
        bound_fresh_existing_templates: 0
      }
    });
  });

  it("binds fresh search_result templates when referrer spelling drifts but keyword continuity holds", async () => {
    const referrerUrl = "https://www.xiaohongshu.com/search_result?keyword=contract";
    const provenancePageUrl = "https://www.xiaohongshu.com/search_result/?keyword=contract&type=51";
    const env = createMockMainWorldEnvironment(referrerUrl);
    const pageContextNamespace = createPageContextNamespace(referrerUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });
    await flushMicrotasks();
    const capturedBeforeProvenance = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" })
    });
    expect(capturedBeforeProvenance).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request"
        }
      }
    });

    const configured = await configureCapturedContextProvenance({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-referrer-spelling-drift-001",
      actionRef: "xhs.search",
      pageUrl: provenancePageUrl
    });
    expect(configured).toMatchObject({
      ok: true,
      result: {
        configured: true,
        bound_fresh_existing_templates: 1
      }
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-referrer-spelling-drift-001",
      actionRef: "xhs.search",
      pageUrl: provenancePageUrl
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          profile_ref: "xhs_001",
          run_id: "run-search-referrer-spelling-drift-001",
          action_ref: "xhs.search",
          page_url: provenancePageUrl
        }
      }
    });
  });

  it("does not rebind stale passive templates when provenance is configured later", async () => {
    const pageUrl = "https://www.xiaohongshu.com/search_result?keyword=stale-no-rebind";
    const env = createMockMainWorldEnvironment(pageUrl);
    const pageContextNamespace = createPageContextNamespace(pageUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-old" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });
    await flushMicrotasks();
    const now = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now + 6000);
    try {
      const configured = await configureCapturedContextProvenance({
        dispatched: env.dispatched,
        requestEvent: channel.requestEvent,
        resultEvent: channel.resultEvent,
        requestListener: channel.requestListener,
        pageContextNamespace,
        profileRef: "xhs_001",
        sessionId: "nm-session-001",
        targetTabId: 1230427051,
        runId: "run-active-fallback-provenance-stale-001",
        actionRef: "xhs.detail",
        pageUrl
      });
      expect(configured).toMatchObject({
        ok: true,
        result: {
          configured: true,
          bound_fresh_existing_templates: 0
        }
      });
    } finally {
      nowSpy.mockRestore();
    }

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace,
      shapeKey: createShapeKey({ keyword: "contract" })
    });
    const admittedTemplate = asRecord(asRecord(captured.result)?.admitted_template);
    expect(admittedTemplate).not.toHaveProperty("profile_ref");
    expect(admittedTemplate).not.toHaveProperty("session_id");
    expect(admittedTemplate).not.toHaveProperty("target_tab_id");
    expect(admittedTemplate).not.toHaveProperty("run_id");
    expect(admittedTemplate).not.toHaveProperty("action_ref");
    expect(admittedTemplate).not.toHaveProperty("page_url");
  });

  it("uses numeric visit recency when resolving compatible search_result lookup namespaces", async () => {
    const pageUrl = "https://www.xiaohongshu.com/search_result/?keyword=contract&type=51";
    const env = createMockMainWorldEnvironment(pageUrl);
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    let visitNineNamespace = "";
    let visitTenNamespace = "";
    for (let visit = 1; visit <= 10; visit += 1) {
      const visitPageUrl = `${pageUrl}&source=numeric-${visit}`;
      env.mockWindow.history?.pushState({}, "", visitPageUrl);
      const currentNamespace = String(
        asRecord(
          env.dispatched.filter((entry) => entry.type === channel.namespaceEvent).at(-1)?.detail
        )?.page_context_namespace ?? createVisitedPageContextNamespace(visitPageUrl, visit)
      );
      if (visit === 9 || visit === 10) {
        await configureCapturedContextProvenance({
          dispatched: env.dispatched,
          requestEvent: channel.requestEvent,
          resultEvent: channel.resultEvent,
          requestListener: channel.requestListener,
          pageContextNamespace: currentNamespace,
          profileRef: "xhs_001",
          sessionId: "nm-session-001",
          targetTabId: 1230427051,
          runId: "run-search-numeric-visit-001",
          actionRef: "xhs.search",
          pageUrl
        });
        await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({ keyword: "contract" })
        });
        if (visit === 9) {
          visitNineNamespace = currentNamespace;
        } else {
          visitTenNamespace = currentNamespace;
        }
      }
    }

    const lookupPageUrl = `${pageUrl}&source=numeric-11`;
    env.mockWindow.history?.pushState({}, "", lookupPageUrl);
    const lookup = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(lookupPageUrl),
      shapeKey: createShapeKey({ keyword: "contract" }),
      profileRef: "xhs_001",
      sessionId: "nm-session-001",
      targetTabId: 1230427051,
      runId: "run-search-numeric-visit-001",
      actionRef: "xhs.search"
    });

    expect(visitNineNamespace).toContain("|visit=9");
    expect(visitTenNamespace).toContain("|visit=10");
    expect(lookup).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          route_evidence_class: "passive_api_capture",
          source_kind: "page_request",
          captured_page_context_namespace: visitTenNamespace
        }
      }
    });
  });

  it("captures XHR search request-context as a real page request", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const xhr = new (env.mockWindow.XMLHttpRequest as unknown as {
      new (): XMLHttpRequest;
    })();
    xhr.open("POST", `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`);
    xhr.setRequestHeader("content-type", "application/json;charset=utf-8");
    xhr.send(JSON.stringify({ keyword: "xhr-camp" }));

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "xhr-camp" })
    });

    expect(env.xhrRequests).toHaveLength(1);
    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          source_kind: "page_request",
          transport: "xhr",
          request: {
            body: {
              keyword: "xhr-camp"
            }
          }
        },
        rejected_observation: null
      }
    });
  });

  it("captures JSON XHR search response without reading responseText", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const xhr = new (env.mockWindow.XMLHttpRequest as unknown as {
      new (): XMLHttpRequest;
    })();
    Object.defineProperty(xhr, "responseType", {
      configurable: true,
      value: "json"
    });
    Object.defineProperty(xhr, "response", {
      configurable: true,
      value: { code: 0, data: { items: [{ id: "note-json-xhr-001" }] } }
    });
    Object.defineProperty(xhr, "responseText", {
      configurable: true,
      get: () => {
        throw new Error("responseText must not be read for json XHR");
      }
    });
    xhr.open("POST", `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`);
    xhr.setRequestHeader("content-type", "application/json;charset=utf-8");
    xhr.send(JSON.stringify({ keyword: "xhr-json" }));

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "xhr-json" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          source_kind: "page_request",
          transport: "xhr",
          request: {
            body: {
              keyword: "xhr-json"
            }
          }
        }
      }
    });
  });

  it("keeps an admitted XHR template when a later same-shape XHR is aborted", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const firstXhr = new (env.mockWindow.XMLHttpRequest as unknown as {
      new (): XMLHttpRequest;
    })();
    firstXhr.open("POST", `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`);
    firstXhr.setRequestHeader("content-type", "application/json;charset=utf-8");
    firstXhr.send(JSON.stringify({ keyword: "xhr-abort-safe" }));

    const firstResult = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "xhr-abort-safe" })
    });
    expect(firstResult).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          source_kind: "page_request",
          transport: "xhr"
        }
      }
    });

    const abortedXhr = new (env.mockWindow.XMLHttpRequest as unknown as {
      new (): XMLHttpRequest;
    })() as XMLHttpRequest & { completionEvent: string };
    Object.defineProperty(abortedXhr, "status", {
      configurable: true,
      value: 0
    });
    abortedXhr.completionEvent = "abort";
    abortedXhr.open("POST", `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`);
    abortedXhr.setRequestHeader("content-type", "application/json;charset=utf-8");
    abortedXhr.send(JSON.stringify({ keyword: "xhr-abort-safe" }));

    const resultAfterAbort = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "xhr-abort-safe" })
    });

    expect(resultAfterAbort).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          source_kind: "page_request",
          transport: "xhr",
          status: 200
        },
        rejected_observation: {
          request_status: {
            http_status: null
          }
        }
      }
    });
  });

  it("keeps synthetic XHR search requests out of admitted templates", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const xhr = new (env.mockWindow.XMLHttpRequest as unknown as {
      new (): XMLHttpRequest;
    })();
    xhr.open("POST", `https://www.xiaohongshu.com${SEARCH_ENDPOINT}`);
    xhr.setRequestHeader("content-type", "application/json;charset=utf-8");
    xhr.setRequestHeader("x-webenvoy-synthetic-request", "1");
    xhr.send(JSON.stringify({ keyword: "xhr-synthetic" }));

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "xhr-synthetic" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "synthetic_request",
          transport: "xhr",
          rejection_reason: "synthetic_request_rejected"
        }
      }
    });
  });

  it("captures detail request-context on real detail pages", async () => {
    const env = createMockMainWorldEnvironment(DETAIL_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            note: {
              note_id: "note-001"
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${DETAIL_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ source_note_id: "note-001" })
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(DETAIL_PAGE_HREF),
      shapeKey: createDetailShapeKey("note-001"),
      method: "POST",
      path: DETAIL_ENDPOINT
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          method: "POST",
          path: DETAIL_ENDPOINT,
          shape: {
            command: "xhs.detail",
            note_id: "note-001"
          }
        }
      }
    });
  });

  it("does not admit detail request-context when the response only exposes a bare id", async () => {
    const env = createMockMainWorldEnvironment(DETAIL_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            note: {
              id: "note-001",
              title: "bare id only"
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${DETAIL_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ source_note_id: "note-001" })
    });

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(DETAIL_PAGE_HREF),
      shapeKey: createDetailShapeKey("note-001"),
      method: "POST",
      path: DETAIL_ENDPOINT
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          rejection_reason: "failed_request_rejected",
          shape: {
            command: "xhs.detail",
            note_id: "note-001"
          }
        }
      }
    });
  });

  it("captures user_home request-context on real profile pages", async () => {
    const env = createMockMainWorldEnvironment(USER_HOME_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            user: {
              userId: "user-001"
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(
      `https://www.xiaohongshu.com${USER_HOME_ENDPOINT}?user_id=user-001`,
      {
        method: "GET",
        headers: {
          accept: "application/json"
        }
      }
    );

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(USER_HOME_PAGE_HREF),
      shapeKey: createUserHomeShapeKey("user-001"),
      method: "GET",
      path: USER_HOME_ENDPOINT
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          method: "GET",
          path: USER_HOME_ENDPOINT,
          shape: {
            command: "xhs.user_home",
            user_id: "user-001"
          }
        }
      }
    });
  });

  it("infers GET for default fetch user_home captures when method is omitted", async () => {
    const env = createMockMainWorldEnvironment(USER_HOME_PAGE_HREF);
    env.setFetchHandler(async () => {
      return new Response(
        JSON.stringify({
          code: 0,
          data: {
            user: {
              userId: "user-001"
            }
          }
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(
      `https://www.xiaohongshu.com${USER_HOME_ENDPOINT}?user_id=user-001`,
      {
        headers: {
          accept: "application/json"
        }
      }
    );

    const captured = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(USER_HOME_PAGE_HREF),
      shapeKey: createUserHomeShapeKey("user-001"),
      method: "GET",
      path: USER_HOME_ENDPOINT
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          method: "GET",
          path: USER_HOME_ENDPOINT
        }
      }
    });
  });

  it("splits page-context namespaces across same-url revisits in the same document", async () => {
    const env = createMockMainWorldEnvironment();
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    const previousNamespace =
      asRecord(env.dispatched.filter((entry) => entry.type === channel.namespaceEvent)[0]?.detail)
        ?.page_context_namespace ?? createPageContextNamespace(SEARCH_PAGE_HREF);

    env.mockWindow.dispatchEvent({
      type: "popstate",
      detail: null
    } as unknown as Event);

    const namespaceEvents = env.dispatched.filter((entry) => entry.type === channel.namespaceEvent);
    const currentNamespace =
      asRecord(namespaceEvents.at(-1)?.detail)?.page_context_namespace ??
      createVisitedPageContextNamespace(SEARCH_PAGE_HREF, 1);

    const previousVisitResult = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: String(previousNamespace),
      shapeKey: createShapeKey({ keyword: "contract" })
    });
    const currentVisitResult = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: String(currentNamespace),
      shapeKey: createShapeKey({ keyword: "contract" })
    });

    expect(previousVisitResult).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: String(currentNamespace),
        admitted_template: null
      }
    });
    expect(currentVisitResult).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: String(currentNamespace),
        admitted_template: null
      }
    });
  });

  it("maps the base namespace to the current active visited slot during lookup", async () => {
    const env = createMockMainWorldEnvironment();
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [{ id: "note-001" }] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });

    const channel = await bootstrapMainWorldBridge(env.added);

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "contract" })
    });

    env.mockWindow.dispatchEvent({
      type: "popstate",
      detail: null
    } as unknown as Event);

    const currentNamespace =
      asRecord(
        env.dispatched.filter((entry) => entry.type === channel.namespaceEvent).at(-1)?.detail
      )?.page_context_namespace ?? createVisitedPageContextNamespace(SEARCH_PAGE_HREF, 1);

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "contract" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: String(currentNamespace)
      }
    });
  });

  it("keeps header-marked synthetic WebEnvoy requests out of the exact-shape slot", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webenvoy-synthetic-request": "1"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "synthetic_request",
          rejection_reason: "synthetic_request_rejected"
        }
      }
    });
  });

  it("keeps symbol-marked synthetic WebEnvoy requests out of admitted templates without marker headers", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async (input) => {
      const headers = input instanceof Request ? input.headers : null;
      expect(headers?.has("x-webenvoy-synthetic-request")).toBe(false);
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const request = new Request(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "symbol-synthetic" })
    });
    Object.defineProperty(request, Symbol.for("webenvoy.main_world.synthetic_request.v1"), {
      configurable: true,
      enumerable: false,
      value: true
    });
    await (env.mockWindow.fetch as typeof fetch)(request);

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "symbol-synthetic" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "synthetic_request",
          transport: "fetch",
          rejection_reason: "synthetic_request_rejected"
        }
      }
    });
  });

  it("preserves a previously admitted exact-shape template when a later synthetic replay is rejected", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webenvoy-synthetic-request": "1"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          template_ready: true,
          source_kind: "page_request"
        },
        rejected_observation: {
          rejection_reason: "synthetic_request_rejected"
        }
      }
    });
  });

  it("stores rejected fetches as rejected observations with failed_request_rejected", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      throw new Error("socket closed");
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await expect(
      (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({ keyword: "露营" })
      })
    ).rejects.toThrow("socket closed");

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "page_request",
          rejection_reason: "failed_request_rejected"
        }
      }
    });
  });

  it("rejects captured templates when response platform code is a string failure", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: "300011", msg: "account abnormal" }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "page_request",
          template_ready: false,
          rejection_reason: "failed_request_rejected",
          response: {
            body: {
              code: "300011"
            }
          }
        }
      }
    });
  });

  it("returns shape_mismatch only from admitted sibling shapes", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "骑行" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        incompatible_observation: {
          source_kind: "page_request",
          incompatibility_reason: "shape_mismatch"
        }
      }
    });
  });

  it("keeps rejected-only exact-shape slots as rejected_source candidates", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 500, msg: "failed" }), {
        status: 500,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          rejection_reason: "failed_request_rejected"
        },
        incompatible_observation: null
      }
    });
  });

  it("revokes an admitted exact-shape template after a later rejection for the same shape", async () => {
    const env = createMockMainWorldEnvironment();
    let requestCount = 0;
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        });
      }
      return new Response(JSON.stringify({ code: 500, msg: "failed" }), {
        status: 500,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({ keyword: "露营" })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营" })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          rejection_reason: "failed_request_rejected"
        }
      }
    });
  });

  it("normalizes limit-only request bodies into the canonical page_size search shape", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        keyword: "露营",
        limit: 10
      })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: createShapeKey({ keyword: "露营", page_size: 10 })
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          shape_key: createShapeKey({ keyword: "露营", page_size: 10 }),
          shape: {
            page_size: 10
          }
        }
      }
    });
  });

  it.each([
    { label: "page", admitted: createShapeKey({ keyword: "露营", page: 2 }), requested: createShapeKey({ keyword: "露营", page: 1 }) },
    { label: "page_size", admitted: createShapeKey({ keyword: "露营", page_size: 10 }), requested: createShapeKey({ keyword: "露营", page_size: 20 }) },
    { label: "sort", admitted: createShapeKey({ keyword: "露营", sort: "latest" }), requested: createShapeKey({ keyword: "露营", sort: "general" }) },
    { label: "note_type", admitted: createShapeKey({ keyword: "露营", note_type: 1 }), requested: createShapeKey({ keyword: "露营", note_type: 0 }) }
  ])("keeps exact miss when $label differs inside the canonical search shape", async ({ admitted, requested }) => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async (_input, init) => {
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    const admittedBody = JSON.parse(admitted) as Record<string, unknown>;
    await (env.mockWindow.fetch as typeof fetch)(`https://www.xiaohongshu.com${SEARCH_ENDPOINT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        keyword: admittedBody.keyword,
        page: admittedBody.page,
        page_size: admittedBody.page_size,
        sort: admittedBody.sort,
        note_type: admittedBody.note_type
      })
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      pageContextNamespace: createPageContextNamespace(SEARCH_PAGE_HREF),
      shapeKey: requested
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        incompatible_observation: {
          incompatibility_reason: "shape_mismatch"
        }
      }
    });
  });
});
