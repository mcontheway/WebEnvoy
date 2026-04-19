import { afterEach, describe, expect, it, vi } from "vitest";

type MockEventListener = (event: Event) => void;

class MockCustomEvent<T> {
  readonly type: string;
  readonly detail: T;

  constructor(type: string, init: { detail: T }) {
    this.type = type;
    this.detail = init.detail;
  }
}

const flushMicrotasks = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const SEARCH_PAGE_HREF = "https://www.xiaohongshu.com/search_result?keyword=contract";
const SEARCH_PAGE_NAMESPACE = "https://www.xiaohongshu.com/search_result";

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
      const current = listeners.get(type) ?? [];
      listeners.set(
        type,
        current.filter((entry) => entry !== listener)
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

const bootstrapMainWorldBridge = async (added: Array<{ type: string; listener: MockEventListener }>) => {
  const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
  await import("../extension/main-world-bridge.js");

  const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
  const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-capture");
  bootstrapListener?.({
    type: "__mw_bootstrap__",
    detail: {
      request_event: secretChannel.requestEvent,
      result_event: secretChannel.resultEvent
    }
  } as unknown as Event);

  const requestListener = added.find((entry) => entry.type === secretChannel.requestEvent)?.listener;
  if (!requestListener) {
    throw new Error("secret request listener was not installed");
  }

  return {
    requestEvent: secretChannel.requestEvent,
    resultEvent: secretChannel.resultEvent,
    requestListener
  };
};

const readCapturedContext = async (input: {
  dispatched: Array<{ type: string; detail: unknown }>;
  requestEvent: string;
  resultEvent: string;
  requestListener: MockEventListener;
  method: "POST" | "GET";
  path: string;
  pageContextNamespace: string;
  shapeKey: string;
}): Promise<Record<string, unknown>> => {
  input.requestListener({
    type: input.requestEvent,
    detail: {
      id: `read-${input.pageContextNamespace}-${input.shapeKey}`,
      type: "captured-request-context-read",
      payload: {
        method: input.method,
        path: input.path,
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

    expect(added).toHaveLength(1);
    expect(added[0]?.type).toBe("__mw_bootstrap__");
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
        result_event: secretChannel.resultEvent
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

    const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
    await import("../extension/main-world-bridge.js");

    const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
    const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-002");
    bootstrapListener?.({
      type: "__mw_bootstrap__",
      detail: {
        request_event: secretChannel.requestEvent,
        result_event: secretChannel.resultEvent
      }
    } as unknown as Event);

    const requestListener = added.find((entry) => entry.type === secretChannel.requestEvent)?.listener;
    requestListener?.({
      type: secretChannel.requestEvent,
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

    requestListener?.({
      type: secretChannel.requestEvent,
      detail: {
        id: "verify-request-001",
        type: "fingerprint-verify",
        payload: {}
      }
    } as unknown as Event);

    const resultEvents = dispatched.filter((entry) => entry.type === secretChannel.resultEvent);
    expect(resultEvents).toHaveLength(2);
    expect(resultEvents[0]?.detail).toMatchObject({
      id: "install-request-001",
      ok: true,
      result: expect.objectContaining({
        installed: true,
        applied_patches: expect.arrayContaining(["navigator_plugins", "navigator_mime_types"])
      })
    });
    expect(resultEvents[1]?.detail).toMatchObject({
      id: "verify-request-001",
      ok: true,
      result: expect.objectContaining({
        has_get_battery: false,
        plugins_length: 4,
        mime_types_length: 2
      })
    });
  });

  it.each([
    {
      label: "search notes",
      method: "POST" as const,
      pageContextNamespace: SEARCH_PAGE_NAMESPACE,
      shapeKey:
        '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"露营","page":1,"page_size":20,"sort":"general","note_type":0}',
      path: "/api/sns/web/v1/search/notes",
      url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
      body: "{\"keyword\":\"露营\"}",
      responseBody: { code: 0, data: { items: [{ id: "note-001" }] } }
    },
    {
      label: "detail feed",
      method: "POST" as const,
      pageContextNamespace: "https://www.xiaohongshu.com/explore/note-001",
      shapeKey:
        '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}',
      path: "/api/sns/web/v1/feed",
      url: "https://www.xiaohongshu.com/api/sns/web/v1/feed",
      locationHref: "https://www.xiaohongshu.com/explore/note-001",
      body: "{\"source_note_id\":\"note-001\"}",
      responseBody: { code: 0, data: { items: [{ id: "note-001" }] } }
    },
    {
      label: "user home",
      method: "GET" as const,
      pageContextNamespace: "https://www.xiaohongshu.com/user/profile/user-001",
      shapeKey:
        '{"command":"xhs.user_home","method":"GET","pathname":"/api/sns/web/v1/user/otherinfo","user_id":"user-001"}',
      path: "/api/sns/web/v1/user/otherinfo",
      url: "https://www.xiaohongshu.com/api/sns/web/v1/user/otherinfo?user_id=user-001",
      locationHref: "https://www.xiaohongshu.com/user/profile/user-001",
      responseBody: { code: 0, data: { user_id: "user-001" } }
    }
  ])("captures successful real-page $label requests into the namespace/shape bucket", async (testCase) => {
    const env = createMockMainWorldEnvironment();
    if ("locationHref" in testCase && typeof testCase.locationHref === "string") {
      env.mockWindow.location.href = testCase.locationHref;
    }
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify(testCase.responseBody), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(testCase.url, {
      method: testCase.method,
      headers: {
        "content-type": "application/json"
      },
      ...(typeof testCase.body === "string" ? { body: testCase.body } : {})
    });

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: testCase.method,
      path: testCase.path,
      pageContextNamespace: testCase.pageContextNamespace,
      shapeKey: testCase.shapeKey
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        page_context_namespace: testCase.pageContextNamespace,
        shape_key: testCase.shapeKey,
        admitted_template: {
          source_kind: "page_request",
          transport: "fetch",
          method: testCase.method,
          path: testCase.path,
          url: testCase.url,
          status: 200,
          request: {
            headers: expect.objectContaining({
              "content-type": "application/json"
            }),
            body:
              typeof testCase.body === "string"
                ? JSON.parse(testCase.body)
                : null
          },
          response: {
            headers: expect.objectContaining({
              "content-type": "application/json"
            }),
            body: testCase.responseBody
          }
        },
        rejected_observation: null
      }
    });
    const admittedTemplate = (result.result as Record<string, unknown>)?.admitted_template as
      | Record<string, unknown>
      | undefined;
    expect(admittedTemplate?.captured_at).toEqual(expect.any(Number));
    if (testCase.label === "detail feed") {
      expect(admittedTemplate?.shape).toMatchObject({
        command: "xhs.detail",
        method: "POST",
        pathname: "/api/sns/web/v1/feed",
        note_id: "note-001"
      });
    }
  });

  it("stores synthetic WebEnvoy requests as rejected observations instead of admitted templates", async () => {
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
    await (env.mockWindow.fetch as typeof fetch)(
      "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-webenvoy-synthetic-request": "1"
        },
        body: "{\"keyword\":\"露营\"}"
      }
    );

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      pageContextNamespace: SEARCH_PAGE_NAMESPACE,
      shapeKey:
        '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"露营","page":1,"page_size":20,"sort":"general","note_type":0}'
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

  it("stores queued WebEnvoy main-world requests as rejected observations without leaking a network header", async () => {
    const env = createMockMainWorldEnvironment();
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async (_input, init) => {
      expect((init?.headers as Record<string, string> | undefined)?.["x-webenvoy-synthetic-request"]).toBeUndefined();
      return new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const syntheticQueueSymbol = Symbol.for("webenvoy.main_world.synthetic_request_queue.v1");
    (globalThis as Record<string | symbol, unknown>)[syntheticQueueSymbol] = [
      {
        id: "queued-main-world-request",
        method: "POST",
        url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
        body: { keyword: "露营" },
        expires_at: Date.now() + 1_000
      }
    ];

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(
      "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{\"keyword\":\"露营\"}"
      }
    );

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      pageContextNamespace: SEARCH_PAGE_NAMESPACE,
      shapeKey:
        '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"露营","page":1,"page_size":20,"sort":"general","note_type":0}'
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

  it("stores non-2xx responses as rejected observations", async () => {
    const env = createMockMainWorldEnvironment();
    env.mockWindow.location.href = "https://www.xiaohongshu.com/explore/note-001";
    installMockDomGlobals({
      mockWindow: env.mockWindow as Window & Record<string, unknown>,
      mockDocument: env.mockDocument
    });
    env.setFetchHandler(async () => {
      return new Response(JSON.stringify({ code: 500100, msg: "gateway failed" }), {
        status: 503,
        headers: {
          "content-type": "application/json"
        }
      });
    });

    const channel = await bootstrapMainWorldBridge(env.added);
    await (env.mockWindow.fetch as typeof fetch)(
      "https://www.xiaohongshu.com/api/sns/web/v1/feed",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{\"source_note_id\":\"note-001\"}"
      }
    );

    const result = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: "POST",
      path: "/api/sns/web/v1/feed",
      pageContextNamespace: "https://www.xiaohongshu.com/explore/note-001",
      shapeKey:
        '{"command":"xhs.detail","method":"POST","pathname":"/api/sns/web/v1/feed","note_id":"note-001"}'
    });

    expect(result).toMatchObject({
      ok: true,
      result: {
        admitted_template: null,
        rejected_observation: {
          source_kind: "page_request",
          rejection_reason: "failed_request_rejected",
          request_status: {
            completion: "failed",
            http_status: 503
          }
        }
      }
    });
    const rejectedObservation = (result.result as Record<string, unknown>)?.rejected_observation as
      | Record<string, unknown>
      | undefined;
    expect(rejectedObservation?.shape).toMatchObject({
      command: "xhs.detail",
      method: "POST",
      pathname: "/api/sns/web/v1/feed",
      note_id: "note-001"
    });
  });

  it("keeps same-path search shapes in separate buckets", async () => {
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
    await (env.mockWindow.fetch as typeof fetch)(
      "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{\"keyword\":\"露营\"}"
      }
    );
    await (env.mockWindow.fetch as typeof fetch)(
      "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{\"keyword\":\"骑行\"}"
      }
    );

    const campingResult = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      pageContextNamespace: SEARCH_PAGE_NAMESPACE,
      shapeKey:
        '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"露营","page":1,"page_size":20,"sort":"general","note_type":0}'
    });
    const cyclingResult = await readCapturedContext({
      dispatched: env.dispatched,
      requestEvent: channel.requestEvent,
      resultEvent: channel.resultEvent,
      requestListener: channel.requestListener,
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      pageContextNamespace: SEARCH_PAGE_NAMESPACE,
      shapeKey:
        '{"command":"xhs.search","method":"POST","pathname":"/api/sns/web/v1/search/notes","keyword":"骑行","page":1,"page_size":20,"sort":"general","note_type":0}'
    });

    expect(
      ((campingResult.result as Record<string, unknown>)?.admitted_template as Record<string, unknown>)?.shape
    ).toMatchObject({
      keyword: "露营"
    });
    expect(
      ((cyclingResult.result as Record<string, unknown>)?.admitted_template as Record<string, unknown>)?.shape
    ).toMatchObject({
      keyword: "骑行"
    });
  });
});
