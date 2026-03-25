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
const STARTUP_FINGERPRINT_INSTALL_TIMEOUT_MS = 5_000;

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

type MainWorldFingerprintInstallRequest = {
  id: string;
  type: "fingerprint-install";
  payload: {
    fingerprint_runtime: FingerprintRuntimeContext;
  };
};

type MainWorldResultEnvelope = {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  message?: unknown;
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

const createWindowEvent = (type: string, detail: unknown): Event => {
  if (typeof CustomEvent === "function") {
    return new CustomEvent(type, { detail });
  }
  return {
    type,
    detail
  } as unknown as Event;
};

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
  // Keep fingerprint runtime context in extension-private storage only.
  // Never mirror it to page-readable sessionStorage/localStorage.
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

const installStartupFingerprintPatch = async (
  fingerprintRuntime: FingerprintRuntimeContext
): Promise<Record<string, unknown> | null> => {
  if (
    typeof window === "undefined" ||
    typeof window.dispatchEvent !== "function" ||
    typeof window.addEventListener !== "function" ||
    typeof window.removeEventListener !== "function"
  ) {
    return null;
  }

  const installRequest: MainWorldFingerprintInstallRequest = {
    id:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `startup-fingerprint-install-${Date.now()}`,
    type: "fingerprint-install",
    payload: {
      fingerprint_runtime: fingerprintRuntime
    }
  };

  return await new Promise<Record<string, unknown> | null>((resolve) => {
    let settled = false;
    const finish = (state: Record<string, unknown> | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      window.removeEventListener(MAIN_WORLD_RESULT_EVENT, onResult as EventListener);
      resolve(state);
    };
    const onResult = (event: Event): void => {
      const detail = asRecord((event as CustomEvent<MainWorldResultEnvelope>).detail);
      if (!detail || detail.id !== installRequest.id) {
        return;
      }
      if (detail.ok !== true) {
        const message = asNonEmptyString(detail.message);
        finish({
          installed: false,
          error: message ?? "startup fingerprint install failed"
        });
        return;
      }
      const installState = asRecord(detail.result);
      if (!installState) {
        finish({
          installed: false,
          error: "startup fingerprint install result missing"
        });
        return;
      }
      finish(installState);
    };
    const timeout = setTimeout(() => {
      finish({
        installed: false,
        error: "startup fingerprint install timeout"
      });
    }, STARTUP_FINGERPRINT_INSTALL_TIMEOUT_MS);
    window.addEventListener(MAIN_WORLD_RESULT_EVENT, onResult as EventListener);

    try {
      window.dispatchEvent(createWindowEvent(MAIN_WORLD_REQUEST_EVENT, installRequest));
    } catch {
      finish({
        installed: false,
        error: "startup fingerprint install dispatch failed"
      });
    }
  });
};

const installAndEmitStartupFingerprintTrust = (
  runtime: ContentScriptRuntime,
  input: {
    runId: string | null;
    fingerprintRuntime: FingerprintRuntimeContext;
  }
): void => {
  void installStartupFingerprintPatch(input.fingerprintRuntime).then((installState) => {
    if (!input.runId) {
      return;
    }
    const trusted = installState?.installed === true;
    const withInjection = installState
      ? {
          ...input.fingerprintRuntime,
          injection: installState
        }
      : input.fingerprintRuntime;
    runtime.sendMessage?.({
      kind: "result",
      id: `startup-fingerprint-trust:${input.runId}`,
      ok: true,
      payload: {
        startup_fingerprint_trust: {
          run_id: input.runId,
          profile: input.fingerprintRuntime.profile,
          trusted,
          fingerprint_runtime: withInjection,
          install_state: {
            status: trusted ? "installed" : "failed",
            ...(installState ?? {})
          }
        }
      }
    });
  });
};

export const bootstrapContentScript = (runtime: ContentScriptRuntime): boolean => {
  if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
    return false;
  }

  const handler = new ContentScriptHandler();
  const bootstrapInput = resolveBootstrapFingerprintContext(readBootstrapFingerprintContext());
  const bootstrapContext = bootstrapInput.fingerprintRuntime;
  if (bootstrapContext) {
    persistExtensionFingerprintContext(bootstrapContext, bootstrapInput.runId);
    installAndEmitStartupFingerprintTrust(runtime, {
      runId: bootstrapInput.runId,
      fingerprintRuntime: bootstrapContext
    });
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
