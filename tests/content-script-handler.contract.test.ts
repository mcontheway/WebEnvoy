import { describe, expect, it } from "vitest";

import {
  ContentScriptHandler,
  encodeMainWorldPayload,
  resolveFingerprintContextForContract
} from "../extension/content-script-handler.js";

interface MockEvent {
  type: string;
}

interface MockCustomEvent<T = unknown> extends MockEvent {
  detail: T;
}

const createFingerprintContext = () => ({
  profile: "profile-a",
  source: "profile_meta" as const,
  fingerprint_profile_bundle: {
    ua: "Mozilla/5.0",
    hardwareConcurrency: 8,
    deviceMemory: 8,
    screen: {
      width: 1440,
      height: 900,
      colorDepth: 30,
      pixelDepth: 30
    },
    battery: {
      level: 0.75,
      charging: false
    },
    timezone: "Asia/Shanghai",
    audioNoiseSeed: 0.00012,
    canvasNoiseSeed: 0.00034,
    environment: {
      os_family: "linux",
      os_version: "6.8",
      arch: "x64"
    }
  },
  fingerprint_patch_manifest: {
    profile: "profile-a",
    manifest_version: "1",
    required_patches: [
      "audio_context",
      "battery",
      "navigator_plugins",
      "navigator_mime_types"
    ],
    optional_patches: [],
    field_dependencies: {
      audio_context: ["audioNoiseSeed"],
      battery: ["battery.level", "battery.charging"],
      navigator_plugins: [],
      navigator_mime_types: []
    },
    unsupported_reason_codes: []
  },
  fingerprint_consistency_check: {
    profile: "profile-a",
    expected_environment: {
      os_family: "linux",
      os_version: "6.8",
      arch: "x64"
    },
    actual_environment: {
      os_family: "linux",
      os_version: "6.8",
      arch: "x64"
    },
    decision: "match" as const,
    reason_codes: []
  },
  execution: {
    live_allowed: true,
    live_decision: "allowed" as const,
    allowed_execution_modes: ["dry_run", "recon", "live_read_limited"],
    reason_codes: []
  }
});

const withMockMainWorld = async (
  run: (context: { mockWindow: Window & Record<string, unknown> }) => Promise<void>
): Promise<void> => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;

  const listeners = new Map<string, Set<(event: MockEvent) => void>>();
  const addListener = (type: string, listener: (event: MockEvent) => void) => {
    const current = listeners.get(type) ?? new Set<(event: MockEvent) => void>();
    current.add(listener);
    listeners.set(type, current);
  };
  const removeListener = (type: string, listener: (event: MockEvent) => void) => {
    listeners.get(type)?.delete(listener);
  };
  const dispatch = (event: MockEvent) => {
    const current = listeners.get(event.type);
    if (!current) {
      return;
    }
    for (const listener of current) {
      listener(event);
    }
  };

  class MockCustomEventImpl<T> implements MockCustomEvent<T> {
    readonly type: string;
    readonly detail: T;

    constructor(type: string, init: { detail: T }) {
      this.type = type;
      this.detail = init.detail;
    }
  }

  const atobFn = (input: string): string => Buffer.from(input, "base64").toString("utf8");
  const escapeFn = (value: string): string => {
    if (typeof (globalThis as { escape?: unknown }).escape === "function") {
      return ((globalThis as { escape: (input: string) => string }).escape)(value);
    }
    return value;
  };

  const mockWindow = {
    location: {
      href: "https://www.xiaohongshu.com/search_result?keyword=test"
    },
    navigator: {},
    OfflineAudioContext: class MockOfflineAudioContext {
      async startRendering() {
        const channelData = new Float32Array(1);
        channelData[0] = 1;
        return {
          getChannelData() {
            return channelData;
          }
        };
      }
    },
    addEventListener: addListener,
    removeEventListener: removeListener,
    dispatchEvent: dispatch
  } as unknown as Window & Record<string, unknown>;
  const mockDocument = {
    title: "contract-test",
    readyState: "complete",
    cookie: "",
    createElement: () => ({
      textContent: "",
      remove: () => {}
    }),
    documentElement: {
      appendChild: (node: { textContent?: string }) => {
        const source = typeof node.textContent === "string" ? node.textContent : "";
        const executor = new Function(
          "window",
          "document",
          "CustomEvent",
          "atob",
          "decodeURIComponent",
          "escape",
          "Error",
          source
        );
        executor(
          mockWindow,
          mockDocument,
          MockCustomEventImpl,
          atobFn,
          decodeURIComponent,
          escapeFn,
          Error
        );
        return node;
      }
    }
  } as unknown as Document;

  (globalThis as { window?: unknown }).window = mockWindow;
  (globalThis as { document?: unknown }).document = mockDocument;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEventImpl;

  try {
    await run({ mockWindow });
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
    (globalThis as { document?: unknown }).document = previousDocument;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
  }
};

const waitForResult = async (results: Array<Record<string, unknown>>): Promise<void> => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (results.length > 0) {
      return;
    }
    await Promise.resolve();
  }
};

describe("content-script handler contract", () => {
  it("encodes payload for inline main-world script without exposing raw input", () => {
    const payload = {
      id: "req-001",
      type: "xhs-sign",
      payload: {
        uri: "/api/sns/web/v1/search/notes",
        body: {
          keyword: "</script><script>alert('x')</script>"
        }
      }
    };

    const encoded = encodeMainWorldPayload(payload);
    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("alert('x')");
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(JSON.parse(decoded)).toEqual(payload);
  });

  it("normalizes fingerprint_context from command params", () => {
    const fingerprintContext = createFingerprintContext();
    const resolved = resolveFingerprintContextForContract({
      commandParams: {
        fingerprint_context: fingerprintContext
      },
      fingerprintContext: null
    });
    expect(resolved).toEqual(fingerprintContext);
  });

  it("returns fingerprint_runtime injection status for runtime.ping", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-ping-001",
        runId: "run-ping-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "runtime.ping",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(injection?.installed).toBe(true);
      expect(injection?.applied_patches).toEqual([
        "audio_context",
        "battery",
        "navigator_plugins",
        "navigator_mime_types"
      ]);
      expect(injection?.source).toBe("profile_meta");
      const battery = await (mockWindow.navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
      expect(battery?.level).toBe(0.75);
      const plugins = (mockWindow.navigator as Navigator & { plugins?: Record<string, unknown>[] }).plugins;
      const mimeTypes =
        (mockWindow.navigator as Navigator & { mimeTypes?: Record<string, unknown>[] }).mimeTypes;
      expect(plugins?.length).toBeGreaterThan(1);
      expect(mimeTypes?.length).toBeGreaterThan(1);
      const chromePdfViewer = (plugins as unknown as { namedItem?: (name: string) => Record<string, unknown> | null })
        ?.namedItem?.("Chrome PDF Viewer");
      const applicationPdfMimeType = (mimeTypes as unknown as {
        namedItem?: (name: string) => Record<string, unknown> | null;
      })?.namedItem?.("application/pdf");
      expect(chromePdfViewer).toBeTruthy();
      expect(applicationPdfMimeType?.enabledPlugin).toBe(chromePdfViewer);
      expect(
        (
          chromePdfViewer as {
            namedItem?: (name: string) => Record<string, unknown> | null;
          }
        )?.namedItem?.("application/pdf")
      ).toBe(applicationPdfMimeType);
      const offlineAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const renderedBuffer = await offlineAudioContext.startRendering();
      const channelData = renderedBuffer.getChannelData(0);
      expect(channelData[0]).toBeGreaterThan(1);
    });
  });

  it("keeps audio noise stable across repeated runtime.ping fingerprint installs", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      const sendPing = (id: string): void => {
        handler.onBackgroundMessage({
          kind: "forward",
          id,
          runId: id,
          tabId: 1,
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          timeoutMs: 1_000,
          command: "runtime.ping",
          params: {},
          commandParams: {},
          fingerprintContext: createFingerprintContext()
        });
      };

      sendPing("run-ping-idempotent-001");
      await waitForResult(results);

      const firstAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const firstRenderedBuffer = await firstAudioContext.startRendering();
      const firstValue = firstRenderedBuffer.getChannelData(0)[0];

      sendPing("run-ping-idempotent-002");
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (results.length >= 2) {
          break;
        }
        await Promise.resolve();
      }

      const secondAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const secondRenderedBuffer = await secondAudioContext.startRendering();
      const secondValue = secondRenderedBuffer.getChannelData(0)[0];

      expect(firstValue).toBeGreaterThan(1);
      expect(secondValue).toBeCloseTo(firstValue, 12);
      const secondPayload = results[1]?.payload as Record<string, unknown>;
      const secondFingerprintRuntime = secondPayload?.fingerprint_runtime as Record<string, unknown>;
      const secondInjection = secondFingerprintRuntime?.injection as Record<string, unknown>;
      expect(secondInjection?.applied_patches).toContain("audio_context");
    });
  });

  it("keeps fingerprint_runtime on xhs.search validation failures", async () => {
    await withMockMainWorld(async () => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-001",
        runId: "run-xhs-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect(injection?.installed).toBe(true);
      expect(injection?.source).toBe("profile_meta");
    });
  });

  it("blocks live xhs.search when required fingerprint patches are missing (top-level requested_execution_mode)", async () => {
    await withMockMainWorld(async () => {
      const fingerprintContext = createFingerprintContext();
      fingerprintContext.fingerprint_patch_manifest.required_patches.push("unknown_required_patch");

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-live-block-001",
        runId: "run-xhs-live-block-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {
          requested_execution_mode: "live_read_limited",
          ability: {
            id: "xhs.search",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "test"
          }
        },
        fingerprintContext
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const details = payload?.details as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect((results[0]?.error as { code?: string } | undefined)?.code).toBe("ERR_EXECUTION_FAILED");
      expect(details?.reason).toBe("FINGERPRINT_REQUIRED_PATCH_MISSING");
      expect(details?.requested_execution_mode).toBe("live_read_limited");
      expect(details?.missing_required_patches).toContain("unknown_required_patch");
      expect(injection?.installed).toBe(false);
      expect(injection?.missing_required_patches).toContain("unknown_required_patch");
    });
  });
});
