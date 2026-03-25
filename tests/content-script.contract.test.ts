import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentScriptHandler, bootstrapContentScript } from "../extension/content-script.js";

const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
const MAIN_WORLD_REQUEST_EVENT = "__webenvoy_main_world_request__";
const MAIN_WORLD_RESULT_EVENT = "__webenvoy_main_world_result__";

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
  let listener: ((message: unknown) => void) | null = null;
  return {
    runtime: {
      onMessage: {
        addListener(callback: (message: unknown) => void) {
          listener = callback;
        }
      },
      sendMessage: vi.fn()
    },
    dispatch(message: unknown) {
      listener?.(message);
    }
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
        if (customEvent.type !== MAIN_WORLD_REQUEST_EVENT) {
          return true;
        }
        const detail = asRecord(customEvent.detail);
        if (detail?.type === "fingerprint-install") {
          startupInstallRequests.push(detail);
          emit(MAIN_WORLD_RESULT_EVENT, {
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
        return true;
      }
    },
    startupInstallRequests
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY];
});

describe("content-script bootstrap contract", () => {
  it("auto-installs fingerprint patch from startup bootstrap payload and emits startup trust via extension runtime", async () => {
    const context = createFingerprintContext();
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] = {
      run_id: "run-bootstrap-001",
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
            profile: "profile-a",
            trusted: true,
            install_state: expect.objectContaining({
              status: "installed",
              installed: true
            })
          })
        }
      })
    );
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

  it("still auto-installs fingerprint patch at bootstrap when cached context exists", () => {
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
});
