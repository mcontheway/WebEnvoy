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
    delete (globalThis as Record<string, unknown>).__WEBENVOY_MAIN_WORLD_BRIDGE_INSTALLED_V1__;
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

  it("does not publish a page-visible install marker when reinjected into the same page", async () => {
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
    expect(added.filter((entry) => entry.type === "__mw_bootstrap__")).toHaveLength(1);

    vi.resetModules();
    await import("../extension/main-world-bridge.js");

    expect(
      (globalThis as Record<string, unknown>).__WEBENVOY_MAIN_WORLD_BRIDGE_INSTALLED_V1__
    ).toBeUndefined();
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

  it("captures recent xhs request context from main-world fetch and exposes it through the event channel", async () => {
    const { added, dispatched, mockWindow, mockDocument } = createMockMainWorldEnvironment();
    (mockWindow as typeof mockWindow & { location?: { href: string }; fetch?: typeof fetch }).location = {
      href: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51"
    };
    (mockWindow as typeof mockWindow & { fetch?: typeof fetch }).fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );

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

    await (mockWindow as typeof mockWindow & { fetch: typeof fetch }).fetch(
      "/api/sns/web/v1/search/notes",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "X-S-Common": "{\"page\":\"search\"}"
        },
        body: "{\"keyword\":\"AI\",\"search_id\":\"search-ctx-001\"}"
      }
    );

    const requestListener = added.find((entry) => entry.type === secretChannel.requestEvent)?.listener;
    requestListener?.({
      type: secretChannel.requestEvent,
      detail: {
        id: "request-context-001",
        type: "xhs-request-context-read",
        payload: {
          url: "/api/sns/web/v1/search/notes",
          method: "POST",
          scope_key: "AI"
        }
      }
    } as unknown as Event);

    const resultEvents = dispatched.filter((entry) => entry.type === secretChannel.resultEvent);
    expect(resultEvents.at(-1)?.detail).toMatchObject({
      id: "request-context-001",
      ok: true,
      result: {
        url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
        method: "POST",
        headers: {
          "Content-Type": "application/json;charset=utf-8",
          "X-S-Common": "{\"page\":\"search\"}"
        },
        body: "{\"keyword\":\"AI\",\"search_id\":\"search-ctx-001\"}",
        referrer: "https://www.xiaohongshu.com/search_result/?keyword=AI&type=51"
      }
    });
  });

});
