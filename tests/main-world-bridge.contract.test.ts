import { afterEach, describe, expect, it, vi } from "vitest";

type MockEventListener = (event: Event) => void;

const createMockMainWorldEnvironment = () => {
  const listeners = new Map<string, MockEventListener[]>();
  const added: Array<{ type: string; listener: MockEventListener }> = [];
  const dispatched: Array<{ type: string; detail: unknown }> = [];

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
    navigator: {}
  };
  const mockDocument = {
    createElement: () => ({ textContent: "", remove: () => {} }),
    documentElement: {
      appendChild: (node: unknown) => node
    }
  };

  return { added, dispatched, listeners, mockWindow, mockDocument };
};

describe("main-world bridge contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
  });

  it("does not expose a page-observable control listener when no staged event channel is present", async () => {
    const { added, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    (globalThis as { window?: unknown }).window = mockWindow;
    (globalThis as { document?: unknown }).document = mockDocument;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent<T> {
      readonly type: string;
      readonly detail: T;

      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    };

    await import("../extension/main-world-bridge.js");

    expect(added).toHaveLength(1);
    expect(added[0]?.type).toBe("__mw_bootstrap__");
  });

  it("attaches a secret-derived request listener after receiving bootstrap event", async () => {
    const { added, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    (globalThis as { window?: unknown }).window = mockWindow;
    (globalThis as { document?: unknown }).document = mockDocument;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent<T> {
      readonly type: string;
      readonly detail: T;

      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    };

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

  it("routes fingerprint install and verify through the bootstrapped event channel", async () => {
    const { added, dispatched, mockWindow, mockDocument } = createMockMainWorldEnvironment();

    (globalThis as { window?: unknown }).window = mockWindow;
    (globalThis as { document?: unknown }).document = mockDocument;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent<T> {
      readonly type: string;
      readonly detail: T;

      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    };

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

  it("routes xhs search request through the bootstrapped event channel with structured fetch result", async () => {
    const { added, dispatched, mockWindow, mockDocument } = createMockMainWorldEnvironment();
    const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;

    try {
      (globalThis as { window?: unknown }).window = mockWindow;
      (globalThis as { document?: unknown }).document = mockDocument;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent<T> {
        readonly type: string;
        readonly detail: T;

        constructor(type: string, init: { detail: T }) {
          this.type = type;
          this.detail = init.detail;
        }
      };

      const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
      await import("../extension/main-world-bridge.js");

      const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
      const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-003");
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
          id: "xhs-request-001",
          type: "xhs-search-request",
          payload: {
            url: "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes",
            method: "POST",
            headers: {
              "Content-Type": "application/json;charset=utf-8",
              "X-s": "signed",
              "X-t": "1"
            },
            body: "{\"keyword\":\"露营\"}",
            timeoutMs: 1_000,
            referrer: "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5",
            referrerPolicy: "strict-origin-when-cross-origin"
          }
        }
      } as unknown as Event);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchMock).toHaveBeenCalledWith(
        "https://edith.xiaohongshu.com/api/sns/web/v1/search/notes",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: "{\"keyword\":\"露营\"}",
          referrer:
            "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5",
          referrerPolicy: "strict-origin-when-cross-origin"
        })
      );

      const resultEvent = dispatched.find((entry) => entry.type === secretChannel.resultEvent);
      expect(resultEvent?.detail).toMatchObject({
        id: "xhs-request-001",
        ok: true,
        result: {
          status: 200,
          body: {
            code: 0,
            data: {
              items: []
            }
          }
        }
      });
    } finally {
      (globalThis as { fetch?: typeof fetch }).fetch = previousFetch;
    }
  });

  it("rejects xhs search requests outside the approved endpoint allowlist", async () => {
    const { added, dispatched, mockWindow, mockDocument } = createMockMainWorldEnvironment();
    const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch;
    const fetchMock = vi.fn();
    (globalThis as { fetch?: typeof fetch }).fetch = fetchMock;

    try {
      (globalThis as { window?: unknown }).window = mockWindow;
      (globalThis as { document?: unknown }).document = mockDocument;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = class MockCustomEvent<T> {
        readonly type: string;
        readonly detail: T;

        constructor(type: string, init: { detail: T }) {
          this.type = type;
          this.detail = init.detail;
        }
      };

      const { resolveMainWorldEventNamesForSecret } = await import("../extension/content-script-handler.js");
      await import("../extension/main-world-bridge.js");

      const bootstrapListener = added.find((entry) => entry.type === "__mw_bootstrap__")?.listener;
      const secretChannel = resolveMainWorldEventNamesForSecret("contract-secret-004");
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
          id: "xhs-request-denied-001",
          type: "xhs-search-request",
          payload: {
            url: "https://evil.example/api/sns/web/v1/search/notes",
            method: "POST",
            headers: {
              "Content-Type": "application/json;charset=utf-8"
            },
            body: "{\"keyword\":\"露营\"}",
            timeoutMs: 1_000
          }
        }
      } as unknown as Event);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(fetchMock).not.toHaveBeenCalled();
      const resultEvent = dispatched.find((entry) => entry.type === secretChannel.resultEvent);
      expect(resultEvent?.detail).toMatchObject({
        id: "xhs-request-denied-001",
        ok: false,
        message: "invalid xhs search request payload"
      });
    } finally {
      (globalThis as { fetch?: typeof fetch }).fetch = previousFetch;
    }
  });
});
