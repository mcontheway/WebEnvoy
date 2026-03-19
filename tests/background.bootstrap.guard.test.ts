import { describe, expect, it, vi } from "vitest";

describe("background import bootstrap guard", () => {
  it("does not bootstrap content-script listeners when importing background module", async () => {
    vi.resetModules();

    const originalWindow = (globalThis as { window?: unknown }).window;
    const originalDocument = (globalThis as { document?: unknown }).document;
    const originalChrome = (globalThis as { chrome?: unknown }).chrome;

    const addListener = vi.fn();
    const sendMessage = vi.fn();

    Object.assign(globalThis as Record<string, unknown>, {
      window: {},
      document: {},
      chrome: {
        runtime: {
          onMessage: {
            addListener
          },
          sendMessage
        }
      }
    });

    try {
      await import("../extension/background.js");
      expect(addListener).toHaveBeenCalledTimes(0);
      expect(sendMessage).toHaveBeenCalledTimes(0);
    } finally {
      if (originalWindow === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window?: unknown }).window = originalWindow;
      }
      if (originalDocument === undefined) {
        delete (globalThis as { document?: unknown }).document;
      } else {
        (globalThis as { document?: unknown }).document = originalDocument;
      }
      if (originalChrome === undefined) {
        delete (globalThis as { chrome?: unknown }).chrome;
      } else {
        (globalThis as { chrome?: unknown }).chrome = originalChrome;
      }
    }
  });
});
