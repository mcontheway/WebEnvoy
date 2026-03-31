import { afterEach, describe, expect, it, vi } from "vitest";

type MockEventListener = (event: Event) => void;

describe("main-world bridge contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { CustomEvent?: unknown }).CustomEvent;
  });

  it("does not expose a page-observable control listener when no staged event channel is present", async () => {
    const added: Array<{ type: string; listener: MockEventListener }> = [];
    const mockWindow = {
      addEventListener: (type: string, listener: MockEventListener) => {
        added.push({ type, listener });
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    };
    const mockDocument = {
      createElement: () => ({ textContent: "", remove: () => {} }),
      documentElement: {
        appendChild: (node: unknown) => node
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

    expect(added).toEqual([]);
  });
});
