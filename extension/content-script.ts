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
const MAIN_WORLD_REQUEST_EVENT = "__webenvoy_main_world_request__";
const MAIN_WORLD_RESULT_EVENT = "__webenvoy_main_world_result__";
const STARTUP_FINGERPRINT_TRUST_ID_PREFIX = "startup-fingerprint-trust";
const MAIN_WORLD_INSTALL_TIMEOUT_MS = 800;
const STARTUP_INSTALL_RETRY_DELAYS_MS = [0, 40, 120] as const;

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

type FingerprintRuntimeContext = NonNullable<
  ReturnType<typeof ensureFingerprintRuntimeContext>
>;

type BootstrapFingerprintContext = {
  fingerprintRuntime: FingerprintRuntimeContext | null;
  runId: string | null;
};

type MainWorldRequestWindow = Window &
  typeof globalThis & {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
    dispatchEvent: (event: Event) => boolean;
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

const readBootstrapFingerprintContext = (): unknown =>
  (globalThis as ContentScriptBootstrapHost)[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] ?? null;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const resolveBootstrapFingerprintContext = (value: unknown): BootstrapFingerprintContext => {
  const direct = ensureFingerprintRuntimeContext(value);
  if (direct) {
    return {
      fingerprintRuntime: direct,
      runId: null
    };
  }
  const record = asRecord(value);
  if (!record) {
    return {
      fingerprintRuntime: null,
      runId: null
    };
  }
  return {
    fingerprintRuntime: ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null),
    runId: asNonEmptyString(record.run_id ?? record.runId)
  };
};

const sanitizeScopePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]/g, "_");

const resolveRunToken = (
  normalized: FingerprintRuntimeContext,
  runId: string | null | undefined
): string => {
  if (typeof runId === "string" && runId.trim().length > 0) {
    return sanitizeScopePart(runId.trim());
  }
  const record = asRecord(normalized);
  const directRunId = record?.runId ?? record?.run_id;
  if (typeof directRunId === "string" && directRunId.trim().length > 0) {
    return sanitizeScopePart(directRunId.trim());
  }
  return "run_unknown";
};

const buildExecutionScopeToken = (normalized: FingerprintRuntimeContext): string => {
  const execution = asRecord(asRecord(normalized)?.execution ?? null);
  if (!execution) {
    return "execution_unknown";
  }
  const liveDecision =
    typeof execution.live_decision === "string" ? execution.live_decision : "unknown";
  const allowedModes = Array.isArray(execution.allowed_execution_modes)
    ? execution.allowed_execution_modes
        .filter((mode): mode is string => typeof mode === "string")
        .sort()
        .join(",")
    : "";
  const reasonCodes = Array.isArray(execution.reason_codes)
    ? execution.reason_codes
        .filter((code): code is string => typeof code === "string")
        .sort()
        .join(",")
    : "";
  const token = `${liveDecision}|${allowedModes}|${reasonCodes}`;
  return sanitizeScopePart(token.length > 0 ? token : "execution_unknown");
};

const buildScopedCacheKey = (
  normalized: FingerprintRuntimeContext,
  runId: string | null | undefined
): string => {
  const profile = sanitizeScopePart(normalized.profile);
  const runToken = resolveRunToken(normalized, runId);
  const executionToken = buildExecutionScopeToken(normalized);
  return `${FINGERPRINT_CONTEXT_CACHE_KEY}:${profile}:${runToken}:${executionToken}`;
};

const persistWindowFingerprintContext = (
  normalized: FingerprintRuntimeContext,
  runId: string | null | undefined
): void => {
  if (typeof window === "undefined") {
    return;
  }
  const scopedKey = buildScopedCacheKey(normalized, runId);
  try {
    window.sessionStorage?.setItem(scopedKey, JSON.stringify(normalized));
    window.sessionStorage?.removeItem(FINGERPRINT_CONTEXT_CACHE_KEY);
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

const persistExtensionFingerprintContext = (
  normalized: FingerprintRuntimeContext,
  runId: string | null | undefined
): void => {
  const storageArea = getExtensionStorageArea();
  if (!storageArea || typeof storageArea.set !== "function") {
    return;
  }
  const scopedKey = buildScopedCacheKey(normalized, runId);

  try {
    const maybePromise = storageArea.set({
      [scopedKey]: normalized
    });
    if (maybePromise && typeof (maybePromise as Promise<void>).catch === "function") {
      void (maybePromise as Promise<void>).catch(() => undefined);
    }
  } catch {
    // ignore cache failures
  }
};

const hasMainWorldBridgeApi = (candidate: unknown): candidate is MainWorldRequestWindow => {
  const value = candidate as Partial<MainWorldRequestWindow> | null;
  return (
    !!value &&
    typeof value.addEventListener === "function" &&
    typeof value.removeEventListener === "function" &&
    typeof value.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  );
};

const createMainWorldRequestId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `mw-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

const installFingerprintRuntimeInMainWorld = async (
  normalized: FingerprintRuntimeContext
): Promise<Record<string, unknown>> => {
  if (typeof window === "undefined" || !hasMainWorldBridgeApi(window)) {
    throw new Error("main world bridge unavailable");
  }

  const requestId = createMainWorldRequestId();
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    const listener = (event: Event): void => {
      const detail = asRecord((event as CustomEvent<unknown>).detail);
      if (!detail || detail.id !== requestId) {
        return;
      }
      clearTimeout(timer);
      window.removeEventListener(MAIN_WORLD_RESULT_EVENT, listener as EventListener);
      if (detail.ok === true) {
        resolve(asRecord(detail.result) ?? {});
        return;
      }
      reject(
        new Error(
          typeof detail.message === "string" ? detail.message : "main world fingerprint install failed"
        )
      );
    };

    const timer = setTimeout(() => {
      window.removeEventListener(MAIN_WORLD_RESULT_EVENT, listener as EventListener);
      reject(new Error("main world bridge response timeout"));
    }, MAIN_WORLD_INSTALL_TIMEOUT_MS);

    window.addEventListener(MAIN_WORLD_RESULT_EVENT, listener as EventListener);
    window.dispatchEvent(
      new CustomEvent(MAIN_WORLD_REQUEST_EVENT, {
        detail: {
          id: requestId,
          type: "fingerprint-install",
          payload: {
            fingerprint_runtime: normalized
          }
        }
      })
    );
  });
};

const emitStartupFingerprintTrust = (
  runtime: ContentScriptRuntime,
  normalized: FingerprintRuntimeContext,
  runId: string | null,
  state: {
    status: "installed" | "failed";
    requiredPatches: string[];
    appliedPatches: string[];
    missingRequiredPatches: string[];
    error: string | null;
  }
): void => {
  const runToken = runId && runId.length > 0 ? runId : "run_unknown";
  const fingerprintRuntimeForTrust = {
    ...normalized,
    injection: {
      installed: state.status === "installed",
      required_patches: state.requiredPatches,
      applied_patches: state.appliedPatches,
      missing_required_patches: state.missingRequiredPatches,
      ...(state.error ? { error: state.error } : {})
    }
  };
  runtime.sendMessage?.({
    kind: "result",
    id: `${STARTUP_FINGERPRINT_TRUST_ID_PREFIX}:${runToken}`,
    ok: true,
    payload: {
      startup_fingerprint_trust: {
        run_id: runToken,
        profile: normalized.profile,
        fingerprint_runtime: fingerprintRuntimeForTrust,
        install_state: {
          status: state.status,
          required_patches: state.requiredPatches,
          applied_patches: state.appliedPatches,
          missing_required_patches: state.missingRequiredPatches,
          ...(state.error ? { error: state.error } : {})
        }
      }
    }
  });
};

const scheduleStartupFingerprintInstall = (
  runtime: ContentScriptRuntime,
  normalized: FingerprintRuntimeContext,
  runId: string | null
): void => {
  const requiredPatches = asStringArray(
    asRecord(normalized.fingerprint_patch_manifest)?.required_patches
  );
  let attempts = 0;

  const runAttempt = (): void => {
    attempts += 1;
    void installFingerprintRuntimeInMainWorld(normalized)
      .then((installResult) => {
        const appliedPatches = asStringArray(installResult.applied_patches);
        const missingRequiredPatches = asStringArray(installResult.missing_required_patches);
        const effectiveMissing =
          missingRequiredPatches.length > 0
            ? missingRequiredPatches
            : requiredPatches.filter((patch) => !appliedPatches.includes(patch));
        const installed = installResult.installed !== false && effectiveMissing.length === 0;
        emitStartupFingerprintTrust(runtime, normalized, runId, {
          status: installed ? "installed" : "failed",
          requiredPatches,
          appliedPatches,
          missingRequiredPatches: effectiveMissing,
          error:
            installed
              ? null
              : asNonEmptyString(installResult.error) ?? "startup fingerprint install incomplete"
        });
      })
      .catch((error) => {
        if (attempts < STARTUP_INSTALL_RETRY_DELAYS_MS.length) {
          const delay = STARTUP_INSTALL_RETRY_DELAYS_MS[attempts] ?? 0;
          setTimeout(runAttempt, delay);
          return;
        }
        emitStartupFingerprintTrust(runtime, normalized, runId, {
          status: "failed",
          requiredPatches,
          appliedPatches: [],
          missingRequiredPatches: requiredPatches,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  };

  runAttempt();
};

export const bootstrapContentScript = (runtime: ContentScriptRuntime): boolean => {
  if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
    return false;
  }

  const handler = new ContentScriptHandler();
  const bootstrapInput = resolveBootstrapFingerprintContext(readBootstrapFingerprintContext());
  const bootstrapContext = bootstrapInput.fingerprintRuntime;
  if (bootstrapContext) {
    // Startup install goes directly to main-world bridge; do not proxy through runtime.ping.
    scheduleStartupFingerprintInstall(runtime, bootstrapContext, bootstrapInput.runId);
    persistWindowFingerprintContext(bootstrapContext, bootstrapInput.runId);
    persistExtensionFingerprintContext(bootstrapContext, bootstrapInput.runId);
  }

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
    if (normalized.fingerprintContext) {
      persistWindowFingerprintContext(normalized.fingerprintContext, normalized.runId);
      persistExtensionFingerprintContext(normalized.fingerprintContext, normalized.runId);
    }
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
