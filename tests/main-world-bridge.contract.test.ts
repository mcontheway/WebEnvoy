import { afterEach, describe, expect, it, vi } from "vitest";

type MockEventListener = (event: Event) => void;

describe("main-world bridge contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
  });

  it("rebinds the active channel when runtime.bootstrap rotates the secret", async () => {
    const controlEventPrefix = "__mw_ctl__bridge__";
    const controlSeedAttribute = "data-webenvoy-main-world-bridge-seed";
    const added: Array<{ type: string; listener: MockEventListener }> = [];
    const removed: Array<{ type: string; listener: MockEventListener }> = [];
    const listeners = new Map<string, MockEventListener[]>();
    const documentAttributes = new Map<string, string>();
    const mockWindow = {
      addEventListener: (type: string, listener: MockEventListener) => {
        added.push({ type, listener });
        listeners.set(type, [...(listeners.get(type) ?? []), listener]);
      },
      removeEventListener: (type: string, listener: MockEventListener) => {
        removed.push({ type, listener });
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((candidate) => candidate !== listener)
        );
      },
      dispatchEvent: (event: Event) => {
        for (const listener of listeners.get(event.type) ?? []) {
          listener(event);
        }
        return true;
      }
    };
    const mockDocument = {
      createElement: () => ({ textContent: "", remove: () => {} }),
      documentElement: {
        appendChild: (node: unknown) => node,
        getAttribute: (name: string) => documentAttributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => {
          documentAttributes.set(name, value);
        }
      }
    };

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

    const controlSeed = documentAttributes.get(controlSeedAttribute);
    expect(typeof controlSeed).toBe("string");
    expect(controlSeed?.length).toBeGreaterThan(0);
    const controlEvent = `${controlEventPrefix}${controlSeed}`;

    const firstControlRequest = new CustomEvent(controlEvent, {
      detail: {
        kind: "attach-channel",
        requestEvent: "__mw_req__secret_a",
        resultEvent: "__mw_res__secret_a",
        attached: false
      }
    });
    const secondControlRequest = new CustomEvent(controlEvent, {
      detail: {
        kind: "attach-channel",
        requestEvent: "__mw_req__secret_b",
        resultEvent: "__mw_res__secret_b",
        attached: false
      }
    });

    mockWindow.dispatchEvent(firstControlRequest);
    mockWindow.dispatchEvent(secondControlRequest);

    expect(firstControlRequest.detail.attached).toBe(true);
    expect(secondControlRequest.detail.attached).toBe(true);

    expect(added.map((entry) => entry.type)).toEqual([
      controlEvent,
      "__mw_req__secret_a",
      "__mw_req__secret_b"
    ]);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.type).toBe("__mw_req__secret_a");
    expect(removed[0]?.listener).toBe(added[1]?.listener);
  });
});
