import { afterEach, describe, expect, it, vi } from "vitest";

import { ContentScriptHandler, bootstrapContentScript } from "../extension/content-script.js";

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

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY];
});

describe("content-script bootstrap contract", () => {
  it("installs fingerprint patch synchronously from startup bootstrap payload", () => {
    (globalThis as Record<string, unknown>)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] =
      createFingerprintContext();
    const sessionStorage = createSessionStorage();
    (globalThis as { window?: unknown }).window = { sessionStorage };

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
    const [message] = onBackgroundMessage.mock.calls[0] ?? [];
    expect((message as { command?: string }).command).toBe("runtime.ping");
    expect((message as { id?: string }).id).toBe("__webenvoy-bootstrap-fingerprint__");
  });

  it("does not install fingerprint patch during bootstrap when startup payload is missing", async () => {
    const sessionStorage = createSessionStorage();
    (globalThis as { window?: unknown }).window = { sessionStorage };

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(onBackgroundMessage).toHaveBeenCalledTimes(0);
  });

  it("installs fingerprint patch at bootstrap when cached context exists", () => {
    const sessionStorage = createSessionStorage({
      [FINGERPRINT_CONTEXT_CACHE_KEY]: JSON.stringify(createFingerprintContext())
    });
    (globalThis as { window?: unknown }).window = { sessionStorage };

    const { runtime } = createRuntime();
    const onBackgroundMessage = vi
      .spyOn(ContentScriptHandler.prototype, "onBackgroundMessage")
      .mockReturnValue(true);

    const bootstrapped = bootstrapContentScript(runtime);

    expect(bootstrapped).toBe(true);
    expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
    const [message] = onBackgroundMessage.mock.calls[0] ?? [];
    expect((message as { command?: string }).command).toBe("runtime.ping");
    expect((message as { id?: string }).id).toBe("__webenvoy-bootstrap-fingerprint__");
  });

  it("installs fingerprint patch from extension storage when window cache is missing", async () => {
    const sessionStorage = createSessionStorage();
    const extensionStorage = createExtensionStorageArea({
      [FINGERPRINT_CONTEXT_CACHE_KEY]: createFingerprintContext()
    });
    (globalThis as { window?: unknown }).window = { sessionStorage };
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

    await vi.waitFor(() => {
      expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
    });
    const [message] = onBackgroundMessage.mock.calls[0] ?? [];
    expect((message as { command?: string }).command).toBe("runtime.ping");
    expect((message as { id?: string }).id).toBe("__webenvoy-bootstrap-fingerprint__");
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

    dispatch({
      kind: "forward",
      id: "run-001",
      command: "runtime.ping",
      commandParams: {
        fingerprint_context: createFingerprintContext()
      }
    });

    expect(onBackgroundMessage).toHaveBeenCalledTimes(1);
    const persistedRaw = sessionStorage.read(FINGERPRINT_CONTEXT_CACHE_KEY);
    expect(persistedRaw).not.toBeNull();
    expect(JSON.parse(persistedRaw ?? "{}")).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
    expect(extensionStorage.read(FINGERPRINT_CONTEXT_CACHE_KEY)).toMatchObject({
      profile: "profile-a",
      source: "profile_meta"
    });
  });
});
