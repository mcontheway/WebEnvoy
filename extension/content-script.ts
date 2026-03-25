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

type FingerprintRuntimeContext = NonNullable<
  ReturnType<typeof ensureFingerprintRuntimeContext>
>;

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

const normalizeFingerprintRuntimeContextInput = (
  value: unknown
): FingerprintRuntimeContext | null => {
  const direct = ensureFingerprintRuntimeContext(value);
  if (direct) {
    return direct;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null);
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

export const bootstrapContentScript = (runtime: ContentScriptRuntime): boolean => {
  if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
    return false;
  }

  const handler = new ContentScriptHandler();
  const bootstrapContext = normalizeFingerprintRuntimeContextInput(
    readBootstrapFingerprintContext()
  );
  if (bootstrapContext) {
    // Keep startup bootstrap context as cache only. Do not auto-trigger fingerprint patch install.
    persistWindowFingerprintContext(bootstrapContext, null);
    persistExtensionFingerprintContext(bootstrapContext, null);
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
