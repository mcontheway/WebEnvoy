import {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
} from "./content-script-handler.js";
import { ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";

export {
  ContentScriptHandler,
  type BackgroundToContentMessage,
  type ContentToBackgroundMessage
};

const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";

type ContentScriptStorageArea = {
  get?: (
    keys?: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void
  ) => Promise<Record<string, unknown>> | void;
  set?: (
    items: Record<string, unknown>,
    callback?: () => void
  ) => Promise<void> | void;
};

type ContentScriptRuntime = {
  onMessage?: {
    addListener(listener: (message: unknown) => void): void;
  };
  sendMessage?: (message: ContentToBackgroundMessage) => void;
};

type ContentScriptChromeApi = {
  runtime?: ContentScriptRuntime;
  storage?: {
    session?: ContentScriptStorageArea;
    local?: ContentScriptStorageArea;
  };
};

type ContentScriptBootstrapHost = {
  [FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY]?: unknown;
};

const normalizeForwardMessage = (
  request: Partial<BackgroundToContentMessage> & { id: string }
): BackgroundToContentMessage => ({
  kind: "forward",
  id: request.id,
  runId: typeof request.runId === "string" ? request.runId : request.id,
  tabId:
    typeof request.tabId === "number" && Number.isInteger(request.tabId) ? request.tabId : null,
  profile: typeof request.profile === "string" ? request.profile : null,
  cwd: typeof request.cwd === "string" ? request.cwd : "",
  timeoutMs:
    typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
      ? Math.floor(request.timeoutMs)
      : 30_000,
  command: typeof request.command === "string" ? request.command : "",
  params:
    typeof request.params === "object" && request.params !== null
      ? (request.params as Record<string, unknown>)
      : {},
  commandParams:
    typeof request.commandParams === "object" && request.commandParams !== null
      ? (request.commandParams as Record<string, unknown>)
      : {},
  fingerprintContext: ensureFingerprintRuntimeContext(
    request.fingerprintContext ??
      (typeof request.commandParams === "object" &&
      request.commandParams !== null &&
      "fingerprint_context" in request.commandParams
        ? (request.commandParams as Record<string, unknown>).fingerprint_context
        : null)
  )
});

const readWindowCachedFingerprintContext = (): unknown => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage?.getItem(FINGERPRINT_CONTEXT_CACHE_KEY) ?? null;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const readBootstrapFingerprintContext = (): unknown =>
  (globalThis as ContentScriptBootstrapHost)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] ?? null;

const persistWindowFingerprintContext = (fingerprintContext: unknown): void => {
  if (typeof window === "undefined" || fingerprintContext === null || fingerprintContext === undefined) {
    return;
  }
  try {
    window.sessionStorage?.setItem(
      FINGERPRINT_CONTEXT_CACHE_KEY,
      JSON.stringify(fingerprintContext)
    );
  } catch {
    // ignore cache failures (quota, privacy mode, etc.)
  }
};

const getExtensionStorageArea = (): ContentScriptStorageArea | null => {
  const chromeApi = (globalThis as { chrome?: ContentScriptChromeApi }).chrome;
  const storage = chromeApi?.storage;
  if (!storage) {
    return null;
  }
  const area = storage.session ?? storage.local ?? null;
  if (!area || typeof area.get !== "function" || typeof area.set !== "function") {
    return null;
  }
  return area;
};

const readExtensionCachedFingerprintContext = async (): Promise<unknown> => {
  const storageArea = getExtensionStorageArea();
  const storageGet = storageArea?.get;
  if (typeof storageGet !== "function") {
    return null;
  }

  return await new Promise<unknown>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(null);
    }, 50);
    const finish = (value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    try {
      const maybePromise = storageGet(
        [FINGERPRINT_CONTEXT_CACHE_KEY],
        (items) => finish(items?.[FINGERPRINT_CONTEXT_CACHE_KEY] ?? null)
      );
      if (maybePromise && typeof (maybePromise as Promise<Record<string, unknown>>).then === "function") {
        (maybePromise as Promise<Record<string, unknown>>)
          .then((items) => finish(items?.[FINGERPRINT_CONTEXT_CACHE_KEY] ?? null))
          .catch(() => finish(null));
      }
    } catch {
      finish(null);
    }
  });
};

const persistExtensionFingerprintContext = (fingerprintContext: unknown): void => {
  if (fingerprintContext === null || fingerprintContext === undefined) {
    return;
  }
  const storageArea = getExtensionStorageArea();
  if (!storageArea || typeof storageArea.set !== "function") {
    return;
  }

  try {
    const maybePromise = storageArea.set({
      [FINGERPRINT_CONTEXT_CACHE_KEY]: fingerprintContext
    });
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
      void (maybePromise as Promise<void>).catch(() => undefined);
    }
  } catch {
    // ignore cache failures
  }
};

export const bootstrapContentScript = (runtime: ContentScriptRuntime): boolean => {
  if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
    return false;
  }

  const handler = new ContentScriptHandler();
  let bootstrapInstalled = false;
  const installBootstrapFingerprintPatch = (fingerprintContext: unknown): void => {
    if (bootstrapInstalled) {
      return;
    }
    const normalizedContext = ensureFingerprintRuntimeContext(fingerprintContext);
    if (!normalizedContext) {
      return;
    }
    bootstrapInstalled = true;
    handler.onBackgroundMessage(
      normalizeForwardMessage({
        id: "__webenvoy-bootstrap-fingerprint__",
        runId: "__webenvoy-bootstrap-fingerprint__",
        command: "runtime.ping",
        commandParams: {},
        params: {},
        timeoutMs: 1_000,
        cwd: "",
        fingerprintContext: normalizedContext
      })
    );
  };

  installBootstrapFingerprintPatch(readBootstrapFingerprintContext());
  installBootstrapFingerprintPatch(readWindowCachedFingerprintContext());
  void readExtensionCachedFingerprintContext().then((cachedContext) => {
    installBootstrapFingerprintPatch(cachedContext);
  });

  handler.onResult((message) => {
    runtime.sendMessage?.(message);
  });

  runtime.onMessage.addListener((message: unknown) => {
    const request = message as Partial<BackgroundToContentMessage> | null;
    if (!request || request.kind !== "forward" || typeof request.id !== "string") {
      return;
    }
    const normalized = normalizeForwardMessage(
      request as Partial<BackgroundToContentMessage> & { id: string }
    );
    persistWindowFingerprintContext(normalized.fingerprintContext);
    persistExtensionFingerprintContext(normalized.fingerprintContext);
    const accepted = handler.onBackgroundMessage(normalized);
    if (!accepted) {
      runtime.sendMessage?.({
        kind: "result",
        id: request.id,
        ok: false,
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "content script unreachable"
        }
      });
    }
  });

  return true;
};

const globalChrome = (globalThis as { chrome?: { runtime?: ContentScriptRuntime } }).chrome;
const runtime = globalChrome?.runtime;
const isLikelyContentScriptEnv =
  typeof window !== "undefined" && typeof document !== "undefined";

if (isLikelyContentScriptEnv && runtime) {
  bootstrapContentScript(runtime);
}
