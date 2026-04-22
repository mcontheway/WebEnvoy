import {
  ContentScriptHandler,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret,
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
const EXTENSION_BOOTSTRAP_FILENAME = "__webenvoy_fingerprint_bootstrap.json";
const STARTUP_TRUST_SOURCE = "extension_bootstrap_context";
const MAIN_WORLD_SECRET_NAMESPACE = "webenvoy.main_world.secret.v1";
const CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY = "__webenvoy_content_script_bootstrap_state__";
const STAGED_STARTUP_TRUST_RUN_ID = undefined;
const STAGED_STARTUP_TRUST_SESSION_ID = undefined;
const STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME = undefined;

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
  [CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY]?: ContentScriptBootstrapState;
  onMessage?: {
    addListener(listener: (message: unknown) => void): void;
    removeListener?(listener: (message: unknown) => void): void;
  };
  sendMessage?: (message: ContentToBackgroundMessage) => Promise<unknown> | void;
  getURL?: (path: string) => string;
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
  runtimeContextId: string | null;
  sessionId: string | null;
  mainWorldSecret: string | null;
};

type ContentScriptBootstrapState = {
  generation: number;
  handler: ContentScriptHandler | null;
  detachResultRelay: (() => void) | null;
  messageListener: ((message: unknown) => void) | null;
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

const hashMainWorldSecret = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `mwsec_${(hash >>> 0).toString(36)}`;
};

const stableSerializeForSecret = (value: unknown, seen = new WeakSet<object>()): string => {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : '"NaN"';
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerializeForSecret(item, seen)).join(",")}]`;
  }
  if (typeof value !== "object") {
    return JSON.stringify(String(value));
  }
  if (seen.has(value as object)) {
    return '"[Circular]"';
  }
  seen.add(value as object);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((key) => `${JSON.stringify(key)}:${stableSerializeForSecret(record[key], seen)}`)
    .join(",");
  seen.delete(value as object);
  return `{${body}}`;
};

const resolveExplicitMainWorldSecret = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return asNonEmptyString(
    record.main_world_secret ??
      record.mainWorldSecret ??
      record.main_world_bridge_secret ??
      record.mainWorldBridgeSecret
  );
};

const deriveMainWorldSecretFromBootstrapPayload = (value: unknown): string | null => {
  const explicit = resolveExplicitMainWorldSecret(value);
  if (explicit) {
    return explicit;
  }
  if (value === null || value === undefined) {
    return null;
  }
  const serialized = stableSerializeForSecret(value);
  if (serialized.length === 0) {
    return null;
  }
  return hashMainWorldSecret(`${MAIN_WORLD_SECRET_NAMESPACE}|${serialized}`);
};

const resolveBootstrapFingerprintContext = (value: unknown): BootstrapFingerprintContext => {
  const mainWorldSecret = deriveMainWorldSecretFromBootstrapPayload(value);
  const record = asRecord(value);
  const stagedRunId = asNonEmptyString(STAGED_STARTUP_TRUST_RUN_ID);
  const stagedSessionId = asNonEmptyString(STAGED_STARTUP_TRUST_SESSION_ID);
  const stagedFingerprintRuntime = ensureFingerprintRuntimeContext(STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME);
  const runId = asNonEmptyString(record?.run_id ?? record?.runId) ?? stagedRunId;
  const runtimeContextId = asNonEmptyString(record?.runtime_context_id ?? record?.runtimeContextId);
  const sessionId = asNonEmptyString(record?.session_id ?? record?.sessionId) ?? stagedSessionId;
  const direct = ensureFingerprintRuntimeContext(value);
  if (direct) {
    return {
      fingerprintRuntime: direct,
      runId,
      runtimeContextId,
      sessionId,
      mainWorldSecret
    };
  }
  if (!record) {
    return {
      fingerprintRuntime: stagedFingerprintRuntime,
      runId,
      runtimeContextId,
      sessionId,
      mainWorldSecret: null
    };
  }
  return {
    fingerprintRuntime:
      ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null) ?? stagedFingerprintRuntime,
    runId,
    runtimeContextId,
    sessionId,
    mainWorldSecret
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

const loadBootstrapFingerprintContextFromExtension = async (
  runtime: ContentScriptRuntime
): Promise<BootstrapFingerprintContext> => {
  const bootstrapUrl =
    typeof runtime.getURL === "function" ? runtime.getURL(EXTENSION_BOOTSTRAP_FILENAME) : null;
  if (!bootstrapUrl || typeof fetch !== "function") {
    return {
      fingerprintRuntime: null,
      runId: null,
      runtimeContextId: null,
      sessionId: null,
      mainWorldSecret: null
    };
  }

  try {
    const response = await fetch(bootstrapUrl);
    if (!response.ok) {
      return {
        fingerprintRuntime: null,
        runId: null,
        runtimeContextId: null,
        sessionId: null,
        mainWorldSecret: null
      };
    }
    const envelope = asRecord(await response.json());
    const resolved = resolveBootstrapFingerprintContext(envelope?.extension_bootstrap ?? envelope ?? null);
    return {
      fingerprintRuntime: resolved.fingerprintRuntime,
      runId: resolved.runId ?? asNonEmptyString(envelope?.run_id ?? envelope?.runId),
      runtimeContextId:
        resolved.runtimeContextId ??
        asNonEmptyString(envelope?.runtime_context_id ?? envelope?.runtimeContextId),
      sessionId: resolved.sessionId ?? asNonEmptyString(envelope?.session_id ?? envelope?.sessionId),
      mainWorldSecret: resolved.mainWorldSecret
    };
  } catch {
    return {
      fingerprintRuntime: null,
      runId: null,
      runtimeContextId: null,
      sessionId: null,
      mainWorldSecret: null
    };
  }
};

const installStartupFingerprintPatch = (fingerprintRuntime: FingerprintRuntimeContext): void => {
  void installFingerprintRuntimeViaMainWorld(fingerprintRuntime).catch(() => {
    // ignore install failures; startup trust must not rely on main-world response
  });
};

const emitStartupFingerprintTrust = (
  runtime: ContentScriptRuntime,
  input: {
    runId: string | null;
    runtimeContextId: string | null;
    sessionId: string | null;
    fingerprintRuntime: FingerprintRuntimeContext;
  }
): void => {
  if (!input.runId || !input.runtimeContextId || !input.sessionId) {
    return;
  }
  runtime.sendMessage?.({
    kind: "result",
    id: `startup-fingerprint-trust:${input.runId}`,
    ok: true,
    payload: {
      startup_fingerprint_trust: {
        run_id: input.runId,
        runtime_context_id: input.runtimeContextId,
        profile: input.fingerprintRuntime.profile,
        session_id: input.sessionId,
        fingerprint_runtime: input.fingerprintRuntime,
        trust_source: STARTUP_TRUST_SOURCE,
        bootstrap_attested: true,
        main_world_result_used_for_trust: false
      }
    }
  });
};

const relayContentResultToBackground = (
  runtime: ContentScriptRuntime,
  message: ContentToBackgroundMessage,
  options?: {
    allowFallback?: boolean;
  }
): void => {
  const sendMessage = runtime.sendMessage;
  if (!sendMessage) {
    return;
  }

  const relayFailure = (
    reason: "CONTENT_RESULT_SERIALIZATION_FAILED" | "CONTENT_RESULT_RELAY_FAILED",
    error: unknown
  ): void => {
    if (options?.allowFallback === false) {
      return;
    }

    const relayErrorMessage = error instanceof Error ? error.message : String(error);
    relayContentResultToBackground(
      runtime,
      {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: "content script result relay failed"
        },
        payload: {
          details: {
            stage: "relay",
            reason,
            relay_error: relayErrorMessage
          }
        }
      },
      {
        allowFallback: false
      }
    );
  };

  let normalizedMessage: ContentToBackgroundMessage;
  try {
    normalizedMessage = JSON.parse(JSON.stringify(message)) as ContentToBackgroundMessage;
  } catch (error) {
    relayFailure("CONTENT_RESULT_SERIALIZATION_FAILED", error);
    return;
  }

  try {
    const maybePromise = sendMessage(normalizedMessage);
    if (maybePromise && typeof (maybePromise as Promise<unknown>).catch === "function") {
      void (maybePromise as Promise<unknown>).catch((error) => {
        relayFailure("CONTENT_RESULT_RELAY_FAILED", error);
      });
    }
  } catch (error) {
    relayFailure("CONTENT_RESULT_RELAY_FAILED", error);
  }
};

const resolveBootstrapState = (
  runtime: ContentScriptRuntime
): ContentScriptBootstrapState => {
  const existingState = runtime[CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY];
  if (existingState) {
    return existingState;
  }

  const state: ContentScriptBootstrapState = {
    generation: 0,
    handler: null,
    detachResultRelay: null,
    messageListener: null
  };
  runtime[CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY] = state;
  return state;
};

export const bootstrapContentScript = (runtime: ContentScriptRuntime): boolean => {
  if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
    return false;
  }

  const state = resolveBootstrapState(runtime);
  state.generation += 1;
  const generation = state.generation;
  state.detachResultRelay?.();
  if (state.handler) {
    state.handler.setReachable(false);
  }
  if (state.messageListener && runtime.onMessage.removeListener) {
    runtime.onMessage.removeListener(state.messageListener);
  }

  const handler = new ContentScriptHandler();
  state.handler = handler;
  state.detachResultRelay = null;
  state.messageListener = null;
  const bootstrapPayload = readBootstrapFingerprintContext();
  const bootstrapInput = resolveBootstrapFingerprintContext(bootstrapPayload);
  installMainWorldEventChannelSecret(bootstrapInput.mainWorldSecret);
  const bootstrapContext = bootstrapInput.fingerprintRuntime;
  if (bootstrapContext) {
    persistExtensionFingerprintContext(bootstrapContext, bootstrapInput.runId);
    installStartupFingerprintPatch(bootstrapContext);
    emitStartupFingerprintTrust(runtime, {
      runId: bootstrapInput.runId,
      runtimeContextId: bootstrapInput.runtimeContextId,
      sessionId: bootstrapInput.sessionId,
      fingerprintRuntime: bootstrapContext
    });
    if (!bootstrapInput.runId || !bootstrapInput.runtimeContextId || !bootstrapInput.sessionId) {
      void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
        if (state.generation !== generation || state.handler !== handler) {
          return;
        }
        if (
          !resolvedBootstrap.runId ||
          !resolvedBootstrap.runtimeContextId ||
          !resolvedBootstrap.sessionId
        ) {
          return;
        }
        emitStartupFingerprintTrust(runtime, {
          runId: resolvedBootstrap.runId,
          runtimeContextId: resolvedBootstrap.runtimeContextId,
          sessionId: resolvedBootstrap.sessionId,
          fingerprintRuntime: bootstrapContext
        });
      });
    }
  } else {
    void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
      if (state.generation !== generation || state.handler !== handler) {
        return;
      }
      installMainWorldEventChannelSecret(resolvedBootstrap.mainWorldSecret);
      if (!resolvedBootstrap.fingerprintRuntime) {
        runtime.sendMessage?.({
          kind: "result",
          id: "startup-background-wake",
          ok: true,
          payload: {
            startup_background_wake: {
              source: "content_script_bootstrap"
            }
          }
        });
        return;
      }
      persistExtensionFingerprintContext(
        resolvedBootstrap.fingerprintRuntime,
        resolvedBootstrap.runId
      );
      installStartupFingerprintPatch(resolvedBootstrap.fingerprintRuntime);
      emitStartupFingerprintTrust(runtime, {
        runId: resolvedBootstrap.runId,
        runtimeContextId: resolvedBootstrap.runtimeContextId,
        sessionId: resolvedBootstrap.sessionId,
        fingerprintRuntime: resolvedBootstrap.fingerprintRuntime
      });
    });
  }

  state.detachResultRelay = handler.onResult((message) => {
    if (state.generation !== generation || state.handler !== handler) {
      return;
    }
    relayContentResultToBackground(runtime, message);
  });

  const messageListener = (message: unknown) => {
    if (state.generation !== generation || state.handler !== handler) {
      return;
    }
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
  };
  runtime.onMessage.addListener(messageListener);
  state.messageListener = messageListener;

  return true;
};

const globalChrome = (globalThis as { chrome?: { runtime?: ContentScriptRuntime } }).chrome;
const runtime = globalChrome?.runtime;
const isLikelyContentScriptEnv =
  typeof window !== "undefined" && typeof document !== "undefined";

if (isLikelyContentScriptEnv && runtime) {
  bootstrapContentScript(runtime);
}
