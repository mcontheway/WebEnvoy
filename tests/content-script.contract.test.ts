import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentScriptHandler, bootstrapContentScript } from "../extension/content-script.js";
import * as contentScriptHandlerModule from "../extension/content-script-handler.js";
import {
  createPageContextNamespace,
  createSearchRequestShape,
  createVisitedPageContextNamespace,
  serializeSearchRequestShape
} from "../extension/xhs-search-types.js";

const { resetMainWorldEventChannelForContract } = contentScriptHandlerModule;

const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";

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

const buildScopedCacheKey = (
  context: ReturnType<typeof createFingerprintContext>,
  runId: string | null
): string => {
  const runToken = runId && runId.trim().length > 0 ? runId.trim() : "run_unknown";
  const allowedModes = [...context.execution.allowed_execution_modes].sort().join(",");
  const reasonCodes = [...context.execution.reason_codes].sort().join(",");
  const executionToken = `${context.execution.live_decision}|${allowedModes}|${reasonCodes}`.replace(
    /[^a-zA-Z0-9._-]/g,
    "_"
  );
  return `${FINGERPRINT_CONTEXT_CACHE_KEY}:${context.profile}:${runToken}:${executionToken}`;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const createShapeKey = (keyword: string): string => {
  const shape = createSearchRequestShape({ keyword });
  if (!shape) {
    throw new Error("shape must be valid in test");
  }
  return serializeSearchRequestShape(shape);
};

const createSessionStorage = (
  initial?: Record<string, string>
): Storage & {
  read: (key: string) => string | null;
} => {
  const values = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.has(key) ? values.get(key) ?? null : null;
    },
    key(index) {
      if (index < 0 || index >= values.size) {
        return null;
      }
      return [...values.keys()][index] ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    read(key) {
      return values.has(key) ? values.get(key) ?? null : null;
    }
  };
};

const createExtensionStorageArea = (
  initial?: Record<string, unknown>
): {
  get: (
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ) => void;
  set: (items: Record<string, unknown>, callback?: () => void) => void;
  read: (key: string) => unknown;
} => {
  const values = new Map<string, unknown>(Object.entries(initial ?? {}));
  return {
    get(keys, callback) {
      const requestedKeys = Array.isArray(keys)
        ? keys
        : typeof keys === "string"
          ? [keys]
          : keys && typeof keys === "object"
            ? Object.keys(keys)
            : [];
      const result: Record<string, unknown> = {};
      for (const key of requestedKeys) {
        if (values.has(key)) {
          result[key] = values.get(key);
        }
      }
      callback?.(result);
    },
    set(items, callback) {
      for (const [key, value] of Object.entries(items)) {
        values.set(key, value);
      }
      callback?.();
    },
    read(key) {
      return values.has(key) ? values.get(key) : null;
    }
  };
};

const createRuntime = () => {
  const listeners = new Set<(message: unknown) => void>();
  return {
    runtime: {
      onMessage: {
        addListener(callback: (message: unknown) => void) {
          listeners.add(callback);
        },
        removeListener(callback: (message: unknown) => void) {
          listeners.delete(callback);
        }
      },
      sendMessage: vi.fn(),
      getURL: vi.fn((path: string) => `chrome-extension://unit-test/${path}`)
    },
    dispatch(message: unknown) {
      for (const listener of listeners) {
        listener(message);
      }
    },
    listenerCount() {
      return listeners.size;
    }
  };
};

const createCapturedRequestContextProbeWindow = (): {
  window: {
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
    dispatchEvent: (event: Event) => boolean;
    location: {
      href: string;
    };
  };
  readRequests: Record<string, unknown>[];
} => {
  const listeners = new Map<string, Set<EventListener>>();
  const readRequests: Record<string, unknown>[] = [];
  let requestEventName: string | null = null;
  let resultEventName: string | null = null;
  const locationHref = "https://www.xiaohongshu.com/search_result?keyword=contract";

  const emit = (type: string, detail: unknown): void => {
    const handlers = listeners.get(type);
    if (!handlers) {
      return;
    }
    const event = {
      type,
      detail
    } as unknown as Event;
    for (const listener of handlers) {
      listener(event);
    }
  };

  return {
    window: {
      addEventListener(type, listener) {
        const handlers = listeners.get(type) ?? new Set<EventListener>();
        handlers.add(listener);
        listeners.set(type, handlers);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: Event) {
        const customEvent = event as CustomEvent<unknown>;
        const detail = asRecord(customEvent.detail);
        if (
          typeof customEvent.type === "string" &&
          customEvent.type.startsWith("__mw_req__") &&
          typeof detail?.id === "string"
        ) {
          requestEventName ??= customEvent.type;
          resultEventName ??= customEvent.type.replace("__mw_req__", "__mw_res__");
          if (detail.type === "captured-request-context-read") {
            readRequests.push(detail);
            const requestedNamespace =
              typeof detail.payload?.page_context_namespace === "string"
                ? detail.payload.page_context_namespace
                : null;
            const activeNamespace = createVisitedPageContextNamespace(locationHref, 1);
            emit(resultEventName, {
              id: detail.id,
              ok: true,
              result: {
                page_context_namespace:
                  requestedNamespace === createPageContextNamespace(locationHref)
                    ? activeNamespace
                    : requestedNamespace,
                shape_key: detail.payload?.shape_key,
                admitted_template: null,
                rejected_observation: null,
                incompatible_observation: null,
                available_shape_keys: []
              }
            });
            return true;
          }
        }
        emit(customEvent.type, customEvent.detail);
        return true;
      },
      location: {
        href: locationHref
      }
    },
    readRequests
  };
};

const createStartupInstallProbeWindow = (
  sessionStorage: Storage & { read: (key: string) => string | null }
): {
  window: {
    sessionStorage: Storage & { read: (key: string) => string | null };
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
    dispatchEvent: (event: Event) => boolean;
  };
  startupInstallRequests: Record<string, unknown>[];
} => {
  const startupInstallRequests: Record<string, unknown>[] = [];
  const listeners = new Map<string, Set<EventListener>>();
  let requestEventName: string | null = null;
  let resultEventName: string | null = null;

  const emit = (type: string, detail: unknown): void => {
    const handlers = listeners.get(type);
    if (!handlers) {
      return;
    }
    const event = {
      type,
      detail
    } as unknown as Event;
    for (const listener of handlers) {
      listener(event);
    }
  };

  return {
    window: {
      sessionStorage,
      addEventListener(type, listener) {
        const handlers = listeners.get(type) ?? new Set<EventListener>();
        handlers.add(listener);
        listeners.set(type, handlers);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      dispatchEvent(event: Event) {
        const customEvent = event as CustomEvent<unknown>;
        const detailRecord = asRecord(customEvent.detail);
        if (
          !requestEventName &&
          typeof customEvent.type === "string" &&
          customEvent.type.startsWith("__mw_req__") &&
          detailRecord?.type === "fingerprint-install" &&
          typeof detailRecord.id === "string"
        ) {
          requestEventName = customEvent.type;
          resultEventName = customEvent.type.replace("__mw_req__", "__mw_res__");
        }

        if (requestEventName && customEvent.type === requestEventName) {
          const detail = asRecord(customEvent.detail);
          if (detail?.type !== "fingerprint-install") {
            return true;
          }
          startupInstallRequests.push(detail);
          if (resultEventName) {
            emit(resultEventName, {
              id: detail.id,
              ok: true,
              result: {
                installed: true,
                required_patches: [
                  "audio_context",
                  "battery",
                  "navigator_plugins",
                  "navigator_mime_types"
                ],
                applied_patches: [
                  "audio_context",
                  "battery",
                  "navigator_plugins",
                  "navigator_mime_types"
                ],
                missing_required_patches: []
              }
            });
          }
        }

        emit(customEvent.type, customEvent.detail);
        return true;
      }
    },
    startupInstallRequests
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  resetMainWorldEventChannelForContract();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { fetch?: unknown }).fetch;
  delete (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY];
});

describe("content-script bootstrap contract", () => {
  it("normalizes content results before relay and falls back to structured relay error on send rejection", async () => {
    const { runtime } = createRuntime();
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(new Error("message port closed"))
      .mockReturnValue(undefined);
    runtime.sendMessage = sendMessage as typeof runtime.sendMessage;

    let emitResult:
      | ((message: {
          kind: "result";
          id: string;
          ok: boolean;
          payload?: Record<string, unknown>;
          error?: { code: string; message: string };
        }) => void)
      | null = null;
    vi.spyOn(ContentScriptHandler.prototype, "onResult").mockImplementation((listener) => {
      emitResult = listener;
      return () => undefined;
    });

    expect(bootstrapContentScript(runtime)).toBe(true);
    expect(emitResult).not.toBeNull();

    emitResult?.({
      kind: "result",
      id: "relay-json-001",
      ok: true,
      payload: {
        summary: {
          completed_at: new Date("2026-04-16T05:00:00.000Z")
        }
      }
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[0]?.[0]).toEqual({
      kind: "result",
      id: "relay-json-001",
      ok: true,
      payload: {
        summary: {
          completed_at: "2026-04-16T05:00:00.000Z"
        }
      }
    });
    expect(sendMessage.mock.calls[1]?.[0]).toEqual({
      kind: "result",
      id: "relay-json-001",
      ok: false,
      error: {
        code: "ERR_TRANSPORT_FORWARD_FAILED",
        message: "content script result relay failed"
      },
      payload: {
        details: {
          stage: "relay",
          reason: "CONTENT_RESULT_RELAY_FAILED",
          relay_error: "message port closed"
        }
      }
    });
  });

  it("auto-installs fingerprint patch from startup bootstrap payload and emits startup trust via extension runtime", async () => {
    const context = createFingerprintContext();
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = {
      run_id: "run-bootstrap-001",
      runtime_context_id: "ctx-bootstrap-001",
      session_id: "nm-session-001",
      fingerprint_runtime: context,
      startup_fingerprint_trust: {
        profile: "profile-a",
        run_id: "run-bootstrap-001",
        trusted: true
      }
    };
    const scopedKey = buildScopedCacheKey(context, "run-bootstrap-001");
    const sessionStorage = createSessionStorage();
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    const extensionStorage = createExtensionStorageArea();
    (globalThis as { window?: unknown }).window = window;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: extensionStorage
      }
    };

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);
    await Promise.resolve();
    await Promise.resolve();

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    expect(startupInstallRequests).toHaveLength(1);
    const startupInstall = startupInstallRequests[0] ?? {};
    expect(startupInstall.type).toBe("fingerprint-install");
    const startupInstallPayload = asRecord(startupInstall.payload);
    expect(startupInstallPayload?.startup_fingerprint_trust).toBeUndefined();
    expect(asRecord(startupInstallPayload?.fingerprint_runtime ?? null)).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
    expect(sessionStorage.read(scopedKey)).toBeNull();
    expect(sessionStorage.read(FINGERPRINT_CONTEXT_CACHE_KEY)).toBeNull();
    expect(extensionStorage.read(scopedKey)).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
    expect(extensionStorage.read("startup_fingerprint_trust")).toBeNull();
    expect(runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "result",
        id: "startup-fingerprint-trust:run-bootstrap-001",
        ok: true,
        payload: {
          startup_fingerprint_trust: expect.objectContaining({
            run_id: "run-bootstrap-001",
            runtime_context_id: "ctx-bootstrap-001",
            session_id: "nm-session-001",
            profile: "profile-a",
            trust_source: "extension_bootstrap_context",
            bootstrap_attested: true,
            main_world_result_used_for_trust: false
          })
        }
      })
    );
    const startupTrustMessage = (
      runtime.sendMessage as unknown as { mock: { calls: Array<[unknown]> } }
    ).mock.calls[0]?.[0];
    const startupTrustPayload = asRecord(asRecord(startupTrustMessage)?.payload);
    const startupTrust = asRecord(startupTrustPayload?.startup_fingerprint_trust);
    expect(startupTrust?.trusted).toBeUndefined();
    expect(startupTrust?.install_state).toBeUndefined();
  });

  it("keeps content-script bootstrap idempotent when the bundle is reinjected into the same tab", () => {
    const { runtime, dispatch, listenerCount } = createRuntime();
    const onResult = vi.spyOn(ContentScriptHandler.prototype, "onResult");
    const setReachable = vi.spyOn(ContentScriptHandler.prototype, "setReachable");
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    expect(bootstrapContentScript(runtime)).toBe(true);
    expect(bootstrapContentScript(runtime)).toBe(true);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(setReachable).toHaveBeenCalledWith(false);
    expect(listenerCount()).toBe(1);

    dispatch({
      kind: "forward",
      id: "forward-once-001",
      runId: "forward-once-001",
      command: "runtime.ping",
      params: {},
      commandParams: {}
    });

    expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
  });

  it("ignores stale async bootstrap fallback after a newer reinjection takes ownership", async () => {
    let resolveBootstrapFetch: ((value: { ok: boolean; json: () => Promise<unknown> }) => void) | null =
      null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveBootstrapFetch = resolve as typeof resolveBootstrapFetch;
        })
    ) as typeof fetch;

    try {
      const { runtime } = createRuntime();
      (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = null;

      expect(bootstrapContentScript(runtime)).toBe(true);

      const context = createFingerprintContext();
      (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = {
        run_id: "run-bootstrap-current-002",
        runtime_context_id: "ctx-bootstrap-current-002",
        session_id: "nm-session-002",
        fingerprint_runtime: context
      };
      expect(bootstrapContentScript(runtime)).toBe(true);

      expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(runtime.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "startup-fingerprint-trust:run-bootstrap-current-002"
        })
      );

      resolveBootstrapFetch?.({
        ok: true,
        json: async () => ({
          extension_bootstrap: {
            run_id: "run-bootstrap-stale-001",
            runtime_context_id: "ctx-bootstrap-stale-001",
            session_id: "nm-session-001",
            fingerprint_runtime: createFingerprintContext()
          }
        })
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(runtime.sendMessage).toHaveBeenCalledTimes(1);
      expect(runtime.sendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({
          id: "startup-fingerprint-trust:run-bootstrap-stale-001"
        })
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not install fingerprint patch during bootstrap when startup payload is missing", async () => {
    const sessionStorage = createSessionStorage();
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    (globalThis as { window?: unknown }).window = window;

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    expect(startupInstallRequests).toHaveLength(0);
  });

  it("ignores page-forged fingerprint-install event without secret-derived event name", async () => {
    const context = createFingerprintContext();
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = {
      run_id: "run-bootstrap-secret-001",
      fingerprint_runtime: context
    };
    const sessionStorage = createSessionStorage();
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    (globalThis as { window?: unknown }).window = window;

    const { runtime } = createRuntime();
    expect(bootstrapContentScript(runtime)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(startupInstallRequests).toHaveLength(1);
    window.dispatchEvent({
      type: "__webenvoy_main_world_request__",
      detail: {
        id: "forged-request",
        type: "fingerprint-install",
        payload: {
          fingerprint_runtime: context
        }
      }
    } as unknown as Event);
    expect(startupInstallRequests).toHaveLength(1);
  });

  it("still auto-installs fingerprint patch at bootstrap when cached context exists", async () => {
    const context = createFingerprintContext();
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = context;
    const cacheKey = buildScopedCacheKey(context, null);
    const sessionStorage = createSessionStorage({
      [cacheKey]: JSON.stringify(context)
    });
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    (globalThis as { window?: unknown }).window = window;

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(startupInstallRequests).toHaveLength(1);
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("still auto-installs fingerprint patch during bootstrap when extension storage cache exists", async () => {
    const context = createFingerprintContext();
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = context;
    const cacheKey = buildScopedCacheKey(context, null);
    const sessionStorage = createSessionStorage();
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    const extensionStorage = createExtensionStorageArea({
      [cacheKey]: context
    });
    (globalThis as { window?: unknown }).window = window;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: extensionStorage
      }
    };

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    expect(startupInstallRequests).toHaveLength(1);
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("loads startup fingerprint truth-source from extension bootstrap json when page global payload is absent", async () => {
    const context = createFingerprintContext();
    const scopedKey = buildScopedCacheKey(context, "run-bootstrap-fetch-001");
    const sessionStorage = createSessionStorage();
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    const extensionStorage = createExtensionStorageArea();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        run_id: "run-bootstrap-fetch-001",
        extension_bootstrap: {
          fingerprint_runtime: context
        }
      })
    }));
    (globalThis as { fetch?: unknown }).fetch = fetchMock;
    (globalThis as { window?: unknown }).window = window;
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: extensionStorage
      }
    };

    const { runtime } = createRuntime();

    expect(bootstrapContentScript(runtime)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "chrome-extension://unit-test/__webenvoy_fingerprint_bootstrap.json"
    );
    expect(startupInstallRequests).toHaveLength(1);
    expect(extensionStorage.read(scopedKey)).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("persists normalized fingerprint context from forwarded messages", () => {
    const sessionStorage = createSessionStorage();
    const extensionStorage = createExtensionStorageArea();
    (globalThis as { window?: unknown }).window = { sessionStorage };
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        session: extensionStorage
      }
    };

    const { runtime, dispatch } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    expect(bootstrapContentScript(runtime)).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);

    const context = createFingerprintContext();
    dispatch({
      kind: "forward",
      id: "run-001",
      command: "runtime.ping",
      commandParams: {
        fingerprint_context: context
      }
    });

    expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
    const scopedKey = buildScopedCacheKey(context, "run-001");
    expect(sessionStorage.read(scopedKey)).toBeNull();
    expect(extensionStorage.read(scopedKey)).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
    expect(sessionStorage.read(FINGERPRINT_CONTEXT_CACHE_KEY)).toBeNull();
  });

  it("auto-installs from startup payload (not scoped cache) during bootstrap across profile/run", async () => {
    const bootstrapContext = createFingerprintContext();
    const foreignContext = {
      ...createFingerprintContext(),
      profile: "profile-b"
    };
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = {
      fingerprint_runtime: bootstrapContext
    };
    const sessionStorage = createSessionStorage({
      [buildScopedCacheKey(foreignContext, null)]: JSON.stringify(foreignContext)
    });
    const { window, startupInstallRequests } = createStartupInstallProbeWindow(sessionStorage);
    (globalThis as { window?: unknown }).window = window;

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);
    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    expect(startupInstallRequests).toHaveLength(1);
    expect(runtime.sendMessage).not.toHaveBeenCalled();
  });

  it("prefers the latest visited page-context namespace when the caller only has the base namespace", async () => {
    const { window, readRequests } = createCapturedRequestContextProbeWindow();
    (globalThis as { window?: unknown }).window = window;

    expect(contentScriptHandlerModule.installMainWorldEventChannelSecret("namespace-secret-001")).toBe(
      true
    );
    const { namespaceEvent } = contentScriptHandlerModule.resolveMainWorldEventNamesForSecret(
      "namespace-secret-001"
    );

    window.dispatchEvent({
      type: namespaceEvent,
      detail: {
        page_context_namespace: createVisitedPageContextNamespace(window.location.href, 1),
        href: window.location.href,
        visit_sequence: 1
      }
    } as unknown as Event);

    await contentScriptHandlerModule.readCapturedRequestContextViaMainWorld({
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      page_context_namespace: createPageContextNamespace(window.location.href),
      shape_key: createShapeKey("contract")
    });

    expect(readRequests).toHaveLength(1);
    expect(asRecord(readRequests[0]?.payload)).toMatchObject({
      page_context_namespace: createVisitedPageContextNamespace(window.location.href, 1)
    });
  });

  it("keeps an explicitly requested visited page-context namespace during request-context reads", async () => {
    const { window, readRequests } = createCapturedRequestContextProbeWindow();
    (globalThis as { window?: unknown }).window = window;

    expect(contentScriptHandlerModule.installMainWorldEventChannelSecret("namespace-secret-001b")).toBe(
      true
    );
    const { namespaceEvent } = contentScriptHandlerModule.resolveMainWorldEventNamesForSecret(
      "namespace-secret-001b"
    );

    window.dispatchEvent({
      type: namespaceEvent,
      detail: {
        page_context_namespace: createVisitedPageContextNamespace(window.location.href, 2),
        href: window.location.href,
        visit_sequence: 2
      }
    } as unknown as Event);

    await contentScriptHandlerModule.readCapturedRequestContextViaMainWorld({
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      page_context_namespace: createVisitedPageContextNamespace(window.location.href, 1),
      shape_key: createShapeKey("contract")
    });

    expect(readRequests).toHaveLength(1);
    expect(asRecord(readRequests[0]?.payload)).toMatchObject({
      page_context_namespace: createVisitedPageContextNamespace(window.location.href, 1)
    });
  });

  it("adopts the remapped active visited namespace returned by main-world before any namespace event arrives", async () => {
    const { window, readRequests } = createCapturedRequestContextProbeWindow();
    (globalThis as { window?: unknown }).window = window;

    expect(contentScriptHandlerModule.installMainWorldEventChannelSecret("namespace-secret-002")).toBe(
      true
    );

    const result = await contentScriptHandlerModule.readCapturedRequestContextViaMainWorld({
      method: "POST",
      path: "/api/sns/web/v1/search/notes",
      page_context_namespace: createPageContextNamespace(window.location.href),
      shape_key: createShapeKey("contract")
    });

    expect(readRequests).toHaveLength(1);
    expect(asRecord(readRequests[0]?.payload)).toMatchObject({
      page_context_namespace: createPageContextNamespace(window.location.href)
    });
    expect(result).toMatchObject({
      page_context_namespace: createVisitedPageContextNamespace(window.location.href, 1)
    });
  });
});
