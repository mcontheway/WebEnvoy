import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SEARCH_ENDPOINT,
  createPageContextNamespace,
  createSearchRequestShape,
  createVisitedPageContextNamespace,
  serializeSearchRequestShape
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

const createMockMainWorldEnvironment = () => {
  const listeners = new Map<string, MockEventListener[]>();
  const added: Array<{ type: string; listener: MockEventListener }> = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];
  let fetchHandler: ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | null =
    null;

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
      href: SEARCH_PAGE_HREF
    },
    navigator: {}
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
        method: "POST",
        path: SEARCH_ENDPOINT,
        page_context_namespace: input.pageContextNamespace,
        shape_key: input.shapeKey
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
      ok: true
    });
    expect(resultEvents[1]?.detail).toMatchObject({
      id: "verify-request-001",
      ok: true
    });
  });

  it("arms request-context capture before an SPA transition enters a search page", async () => {
    const env = createMockMainWorldEnvironment();
    const originalFetch = env.mockWindow.fetch;
    env.mockWindow.location.href = "https://www.xiaohongshu.com/explore";
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
    expect(env.mockWindow.fetch).toBe(originalFetch);

    env.mockWindow.history?.pushState({}, "", SEARCH_PAGE_HREF);
    expect(env.mockWindow.fetch).not.toBe(originalFetch);
    const transitionedNamespace =
      asRecord(
        env.dispatched.filter((entry) => entry.type === channel.namespaceEvent).at(-1)?.detail
      )?.page_context_namespace ?? createVisitedPageContextNamespace(SEARCH_PAGE_HREF, 1);

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
      pageContextNamespace: String(transitionedNamespace),
      shapeKey: createShapeKey({ keyword: "contract" })
    });

    expect(captured).toMatchObject({
      ok: true,
      result: {
        admitted_template: {
          source_kind: "page_request"
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
