import { executeXhsSearch, type SearchExecutionResult, type XhsSearchEnvironment } from "./xhs-search.js";
import { performEditorInputValidation } from "./xhs-editor-input.js";
import {
  ensureFingerprintRuntimeContext,
  type FingerprintRuntimeContext
} from "../shared/fingerprint-profile.js";

export type BackgroundToContentMessage = {
  kind: "forward";
  id: string;
  runId: string;
  tabId: number | null;
  profile: string | null;
  cwd: string;
  timeoutMs: number;
  command: string;
  params: Record<string, unknown>;
  commandParams: Record<string, unknown>;
  fingerprintContext?: FingerprintRuntimeContext | null;
};

export type ContentToBackgroundMessage = {
  kind: "result";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string };
};

type XhsSignRequestMessage = {
  kind: "xhs-sign-request";
  uri: string;
  body: Record<string, unknown>;
};

type XhsSignResponseMessage = {
  ok: boolean;
  result?: { "X-s": string; "X-t": string | number };
  error?: { code?: string; message?: string };
};

export type ContentMessageListener = (message: ContentToBackgroundMessage) => void;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const cloneFingerprintRuntimeContextWithInjection = (
  runtime: FingerprintRuntimeContext,
  injection: Record<string, unknown> | null
): FingerprintRuntimeContext =>
  injection
    ? ({
        ...runtime,
        injection: JSON.parse(JSON.stringify(injection))
      } as FingerprintRuntimeContext)
    : { ...runtime };

const resolveRequestedExecutionMode = (message: BackgroundToContentMessage): string | null => {
  const topLevelMode = asString(asRecord(message.commandParams)?.requested_execution_mode);
  if (topLevelMode) {
    return topLevelMode;
  }
  const options = asRecord(message.commandParams.options);
  return asString(options?.requested_execution_mode);
};

const resolveAttestedFingerprintRuntimeContext = (
  value: unknown
): FingerprintRuntimeContext | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const injection = asRecord(record.injection);
  const direct = ensureFingerprintRuntimeContext(record);
  if (direct) {
    return cloneFingerprintRuntimeContextWithInjection(direct, injection);
  }

  const sanitized = { ...record };
  delete sanitized.injection;
  const normalized = ensureFingerprintRuntimeContext(sanitized);
  return normalized ? cloneFingerprintRuntimeContextWithInjection(normalized, injection) : null;
};

const resolveFingerprintContextFromCommandParams = (
  commandParams: Record<string, unknown>
): unknown =>
  asRecord(commandParams.fingerprint_context) ?? asRecord(commandParams.fingerprint_runtime) ?? null;

const resolveFingerprintContextFromMessage = (
  message: BackgroundToContentMessage
): FingerprintRuntimeContext | null => {
  const direct = resolveAttestedFingerprintRuntimeContext(message.fingerprintContext ?? null);
  if (direct) {
    return direct;
  }

  const fallback = resolveAttestedFingerprintRuntimeContext(
    resolveFingerprintContextFromCommandParams(message.commandParams)
  );
  return fallback ?? null;
};

const buildFailedFingerprintInjectionContext = (
  fingerprintRuntime: FingerprintRuntimeContext,
  errorMessage: string
): Record<string, unknown> => {
  const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
  return {
    ...fingerprintRuntime,
    injection: {
      installed: false,
      required_patches: requiredPatches,
      missing_required_patches: requiredPatches,
      error: errorMessage
    }
  };
};

const hasInstalledFingerprintInjection = (
  fingerprintRuntime: FingerprintRuntimeContext
): boolean => {
  const existingInjection = asRecord(
    (fingerprintRuntime as unknown as Record<string, unknown>).injection
  );
  return (
    existingInjection?.installed === true &&
    asStringArray(existingInjection.missing_required_patches).length === 0
  );
};

const resolveMissingRequiredFingerprintPatches = (
  fingerprintRuntime: Record<string, unknown>
): string[] => {
  const injection = asRecord(fingerprintRuntime.injection);
  const requiredPatches = asStringArray(injection?.required_patches);
  const missingRequiredPatches = asStringArray(injection?.missing_required_patches);
  if (missingRequiredPatches.length > 0) {
    return missingRequiredPatches;
  }
  if (injection?.installed === true) {
    return [];
  }
  return requiredPatches;
};

const summarizeFingerprintRuntimeContext = (
  fingerprintRuntime: Record<string, unknown> | FingerprintRuntimeContext | null
): Record<string, unknown> | null => {
  if (!fingerprintRuntime) {
    return null;
  }
  const record = fingerprintRuntime as Record<string, unknown>;
  const execution = asRecord(record.execution);
  const injection = asRecord(record.injection);
  return {
    profile: asString(record.profile),
    source: asString(record.source),
    execution: execution
      ? {
          live_allowed: execution.live_allowed === true,
          live_decision: asString(execution.live_decision),
          allowed_execution_modes: asStringArray(execution.allowed_execution_modes),
          reason_codes: asStringArray(execution.reason_codes)
        }
      : null,
    injection: injection
      ? {
          installed: injection.installed === true,
          source: asString(injection.source),
          required_patches: asStringArray(injection.required_patches),
          missing_required_patches: asStringArray(injection.missing_required_patches),
          error: asString(injection.error)
        }
      : null
  };
};

export const resolveFingerprintContextForContract = (
  message: Pick<BackgroundToContentMessage, "fingerprintContext" | "commandParams">
): FingerprintRuntimeContext | null =>
  resolveFingerprintContextFromMessage({
    kind: "forward",
    id: "contract",
    runId: "contract",
    tabId: null,
    profile: null,
    cwd: "",
    timeoutMs: 1_000,
    command: "runtime.ping",
    params: {},
    commandParams: message.commandParams,
    fingerprintContext: message.fingerprintContext
  });

const extractFetchBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {
      message: text
    };
  }
};

const encodeUtf8Base64 = (value: string): string => {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)));
  }
  const bufferCtor = (globalThis as { Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } } }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64");
  }
  throw new Error("base64 encoder is unavailable");
};

export const encodeMainWorldPayload = (value: Record<string, unknown>): string =>
  encodeUtf8Base64(JSON.stringify(value));

const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
export const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const MAIN_WORLD_CALL_TIMEOUT_MS = 5_000;
const AUDIO_PATCH_EPSILON = 1e-12;

type MainWorldResultEnvelope = {
  id?: unknown;
  ok?: unknown;
  result?: unknown;
  message?: unknown;
};

type MainWorldEventChannel = {
  secret: string;
  requestEvent: string;
  resultEvent: string;
};

let mainWorldEventChannel: MainWorldEventChannel | null = null;
let mainWorldResultListener: ((event: Event) => void) | null = null;
let mainWorldResultListenerEventName: string | null = null;
const pendingMainWorldRequests = new Map<
  string,
  {
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const hashMainWorldEventChannel = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

const normalizeMainWorldSecret = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const createMainWorldBootstrapDetail = (
  channel: MainWorldEventChannel
): { request_event: string; result_event: string } => ({
  request_event: channel.requestEvent,
  result_event: channel.resultEvent
});

export const resolveMainWorldEventNamesForSecret = (
  secret: string
): { requestEvent: string; resultEvent: string } => {
  const channel = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
  return {
    requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${channel}`,
    resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${channel}`
  };
};

const createWindowEvent = (type: string, detail: unknown): Event => {
  if (typeof CustomEvent === "function") {
    return new CustomEvent(type, { detail });
  }
  return {
    type,
    detail
  } as unknown as Event;
};

const onMainWorldResultEvent = (event: Event): void => {
  const detail = asRecord((event as CustomEvent<unknown>).detail) as MainWorldResultEnvelope | null;
  if (!detail || typeof detail.id !== "string") {
    return;
  }
  const pending = pendingMainWorldRequests.get(detail.id);
  if (!pending) {
    return;
  }
  pendingMainWorldRequests.delete(detail.id);
  clearTimeout(pending.timeout);
  if (detail.ok === true) {
    pending.resolve(detail.result);
    return;
  }
  pending.reject(
    new Error(typeof detail.message === "string" ? detail.message : "main world call failed")
  );
};

const detachMainWorldResultListener = (): void => {
  if (
    !mainWorldResultListener ||
    !mainWorldResultListenerEventName ||
    typeof window === "undefined" ||
    typeof window.removeEventListener !== "function"
  ) {
    mainWorldResultListener = null;
    mainWorldResultListenerEventName = null;
    return;
  }
  window.removeEventListener(mainWorldResultListenerEventName, mainWorldResultListener as EventListener);
  mainWorldResultListener = null;
  mainWorldResultListenerEventName = null;
};

export const installMainWorldEventChannelSecret = (secret: string | null): boolean => {
  const normalizedSecret = normalizeMainWorldSecret(secret);
  if (
    typeof window === "undefined" ||
    typeof window.addEventListener !== "function" ||
    typeof window.dispatchEvent !== "function"
  ) {
    mainWorldEventChannel = null;
    detachMainWorldResultListener();
    return false;
  }
  if (!normalizedSecret) {
    mainWorldEventChannel = null;
    detachMainWorldResultListener();
    return false;
  }

  const names = resolveMainWorldEventNamesForSecret(normalizedSecret);
  if (
    mainWorldEventChannel &&
    mainWorldEventChannel.secret === normalizedSecret &&
    mainWorldResultListenerEventName === names.resultEvent
  ) {
    return true;
  }

  detachMainWorldResultListener();
  window.addEventListener(names.resultEvent, onMainWorldResultEvent as EventListener);
  mainWorldResultListener = onMainWorldResultEvent;
  mainWorldResultListenerEventName = names.resultEvent;
  mainWorldEventChannel = {
    secret: normalizedSecret,
    requestEvent: names.requestEvent,
    resultEvent: names.resultEvent
  };
  window.dispatchEvent(
    createWindowEvent(MAIN_WORLD_EVENT_BOOTSTRAP, createMainWorldBootstrapDetail(mainWorldEventChannel))
  );
  return true;
};

export const resetMainWorldEventChannelForContract = (): void => {
  for (const pending of pendingMainWorldRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("main world event channel reset"));
  }
  pendingMainWorldRequests.clear();
  mainWorldEventChannel = null;
  detachMainWorldResultListener();
};

const mainWorldCall = async <T>(request: {
  type: "fingerprint-install" | "fingerprint-verify";
  payload: Record<string, unknown>;
}): Promise<T> => {
  const requestId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `mw-${Date.now()}`;

  return await new Promise<T>((resolve, reject) => {
    if (
      !mainWorldEventChannel ||
      typeof window === "undefined" ||
      typeof window.dispatchEvent !== "function"
    ) {
      reject(new Error("main world event channel unavailable"));
      return;
    }
    const timeout = setTimeout(() => {
      pendingMainWorldRequests.delete(requestId);
      reject(new Error("main world event channel response timeout"));
    }, MAIN_WORLD_CALL_TIMEOUT_MS);
    pendingMainWorldRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
      timeout
    });
    const requestDetail = {
      id: requestId,
      ...request
    };
    try {
      window.dispatchEvent(createWindowEvent(mainWorldEventChannel.requestEvent, requestDetail));
    } catch (error) {
      clearTimeout(timeout);
      pendingMainWorldRequests.delete(requestId);
      reject(error);
    }
  });
};

export const installFingerprintRuntimeViaMainWorld = async (
  fingerprintRuntime: FingerprintRuntimeContext
): Promise<Record<string, unknown>> =>
  await mainWorldCall<Record<string, unknown>>({
    type: "fingerprint-install",
    payload: {
      fingerprint_runtime: fingerprintRuntime
    }
  });

const verifyFingerprintRuntimeViaMainWorld = async (): Promise<Record<string, unknown>> =>
  await mainWorldCall<Record<string, unknown>>({
    type: "fingerprint-verify",
    payload: {}
  });

const requestXhsSignatureViaExtension = async (
  uri: string,
  body: Record<string, unknown>
): Promise<{ "X-s": string; "X-t": string | number }> => {
  const runtime = (globalThis as {
    chrome?: {
      runtime?: {
        sendMessage?: (
          message: XhsSignRequestMessage,
          callback?: (response?: XhsSignResponseMessage) => void
        ) => Promise<XhsSignResponseMessage | undefined> | void;
      };
    };
  }).chrome?.runtime;
  const sendMessage = runtime?.sendMessage;
  if (!sendMessage) {
    throw new Error("extension runtime.sendMessage is unavailable");
  }

  const request: XhsSignRequestMessage = {
    kind: "xhs-sign-request",
    uri,
    body
  };

  const response = await new Promise<XhsSignResponseMessage>((resolve, reject) => {
    try {
      const maybePromise = sendMessage(request, (message?: XhsSignResponseMessage) => {
        resolve(message ?? { ok: false, error: { message: "xhs-sign response missing" } });
      });
      if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
        void (maybePromise as Promise<XhsSignResponseMessage | undefined>)
          .then((message) => {
            if (message) {
              resolve(message);
            }
          })
          .catch((error) => {
            reject(error);
          });
      }
    } catch (error) {
      reject(error);
    }
  });

  if (!response.ok || !response.result) {
    throw new Error(
      typeof response.error?.message === "string" ? response.error.message : "xhs-sign failed"
    );
  }
  return response.result;
};

const resolveRequiredFingerprintPatches = (
  fingerprintRuntime: FingerprintRuntimeContext
): string[] =>
  asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);

const installFingerprintRuntimeWithVerification = async (
  fingerprintRuntime: FingerprintRuntimeContext
): Promise<Record<string, unknown>> => {
  const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
  const preInstallAudioSample = requiredPatches.includes("audio_context")
    ? await probeAudioFirstSample()
    : null;
  const installResult = await installFingerprintRuntimeViaMainWorld(fingerprintRuntime);
  return await verifyFingerprintInstallResult({
    fingerprintRuntime,
    installResult: asRecord(installResult),
    preInstallAudioSample
  });
};

const probeAudioFirstSample = async (): Promise<number | null> => {
  const offlineAudioCtor =
    typeof window.OfflineAudioContext === "function"
      ? window.OfflineAudioContext
      : typeof (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext === "function"
        ? (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext ?? null
        : null;
  if (!offlineAudioCtor) {
    return null;
  }

  try {
    const offlineAudioContext = new offlineAudioCtor(1, 256, 44_100);
    const renderedBuffer = await offlineAudioContext.startRendering();
    if (!renderedBuffer || typeof renderedBuffer.getChannelData !== "function") {
      return null;
    }
    const channelData = renderedBuffer.getChannelData(0);
    if (!channelData || typeof channelData.length !== "number" || channelData.length < 1) {
      return null;
    }
    const firstSample = Number(channelData[0]);
    return Number.isFinite(firstSample) ? firstSample : null;
  } catch {
    return null;
  }
};

const buildRuntimeBootstrapAckPayload = (input: {
  version: string;
  runId: string;
  runtimeContextId: string;
  profile: string;
  attested: boolean;
  runtimeWithInjection: Record<string, unknown> | null;
}): Record<string, unknown> => ({
  method: "runtime.bootstrap.ack",
  result: {
    version: input.version,
    run_id: input.runId,
    runtime_context_id: input.runtimeContextId,
    profile: input.profile,
    status: input.attested ? "ready" : "pending"
  },
  runtime_bootstrap_attested: input.attested,
  ...(input.runtimeWithInjection ? { fingerprint_runtime: input.runtimeWithInjection } : {})
});

const probeBatteryApi = async (): Promise<boolean> => {
  const getBattery = (window.navigator as Navigator & { getBattery?: () => Promise<unknown> })
    .getBattery;
  if (typeof getBattery !== "function") {
    return false;
  }
  try {
    const battery = asRecord(await getBattery());
    return typeof battery?.level === "number" && typeof battery?.charging === "boolean";
  } catch {
    return false;
  }
};

const probeNavigatorPlugins = (): boolean => {
  const plugins = (window.navigator as Navigator & { plugins?: unknown }).plugins;
  return (
    typeof plugins === "object" &&
    plugins !== null &&
    typeof (plugins as { length?: unknown }).length === "number" &&
    Number((plugins as { length?: unknown }).length) > 0
  );
};

const probeNavigatorMimeTypes = (): boolean => {
  const mimeTypes = (window.navigator as Navigator & { mimeTypes?: unknown }).mimeTypes;
  return (
    typeof mimeTypes === "object" &&
    mimeTypes !== null &&
    typeof (mimeTypes as { length?: unknown }).length === "number" &&
    Number((mimeTypes as { length?: unknown }).length) > 0
  );
};

const verifyFingerprintInstallResult = async (input: {
  fingerprintRuntime: FingerprintRuntimeContext;
  installResult: Record<string, unknown> | null;
  preInstallAudioSample: number | null;
}): Promise<Record<string, unknown>> => {
  const requiredPatches = resolveRequiredFingerprintPatches(input.fingerprintRuntime);
  const reportedAppliedPatches = asStringArray(input.installResult?.applied_patches);
  const mainWorldVerification =
    requiredPatches.includes("battery")
      ? asRecord(await verifyFingerprintRuntimeViaMainWorld().catch(() => null))
      : null;
  const appliedPatches: string[] = [];
  const missingRequiredPatches: string[] = [];
  const probeDetails: Record<string, unknown> = {};

  if (requiredPatches.includes("audio_context")) {
    const postInstallAudioSample = await probeAudioFirstSample();
    const audioPatched =
      postInstallAudioSample !== null &&
      (input.preInstallAudioSample === null ||
        Math.abs(postInstallAudioSample - input.preInstallAudioSample) > AUDIO_PATCH_EPSILON ||
        reportedAppliedPatches.includes("audio_context"));
    probeDetails.audio_context = {
      pre_install_first_sample: input.preInstallAudioSample,
      post_install_first_sample: postInstallAudioSample,
      verified: audioPatched
    };
    if (audioPatched) {
      appliedPatches.push("audio_context");
    } else {
      missingRequiredPatches.push("audio_context");
    }
  }

  if (requiredPatches.includes("battery")) {
    const isolatedWorldBatteryPatched = await probeBatteryApi();
    const mainWorldBatteryPatched = mainWorldVerification?.has_get_battery === true;
    const batteryPatched = isolatedWorldBatteryPatched || mainWorldBatteryPatched;
    probeDetails.battery = {
      verified: batteryPatched,
      isolated_world_verified: isolatedWorldBatteryPatched,
      main_world_verified: mainWorldBatteryPatched,
      reported_applied: reportedAppliedPatches.includes("battery")
    };
    if (batteryPatched) {
      appliedPatches.push("battery");
    } else {
      missingRequiredPatches.push("battery");
    }
  }

  if (requiredPatches.includes("navigator_plugins")) {
    const pluginsPatched = probeNavigatorPlugins();
    probeDetails.navigator_plugins = { verified: pluginsPatched };
    if (pluginsPatched) {
      appliedPatches.push("navigator_plugins");
    } else {
      missingRequiredPatches.push("navigator_plugins");
    }
  }

  if (requiredPatches.includes("navigator_mime_types")) {
    const mimeTypesPatched = probeNavigatorMimeTypes();
    probeDetails.navigator_mime_types = { verified: mimeTypesPatched };
    if (mimeTypesPatched) {
      appliedPatches.push("navigator_mime_types");
    } else {
      missingRequiredPatches.push("navigator_mime_types");
    }
  }

  for (const patchName of requiredPatches) {
    if (!appliedPatches.includes(patchName) && !missingRequiredPatches.includes(patchName)) {
      missingRequiredPatches.push(patchName);
    }
  }

  return {
    ...(input.installResult ?? {}),
    installed: missingRequiredPatches.length === 0,
    required_patches: requiredPatches,
    applied_patches: appliedPatches,
    missing_required_patches: missingRequiredPatches,
    verification: {
      channel: "isolated_world_probes",
      probes: probeDetails
    }
  };
};

const createBrowserEnvironment = (): XhsSearchEnvironment => ({
  now: () => Date.now(),
  randomId: () =>
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `id-${Date.now()}`,
  getLocationHref: () => window.location.href,
  getDocumentTitle: () => document.title,
  getReadyState: () => document.readyState,
  getCookie: () => document.cookie,
  callSignature: async (
    uri: Parameters<XhsSearchEnvironment["callSignature"]>[0],
    payload: Parameters<XhsSearchEnvironment["callSignature"]>[1]
  ) => await requestXhsSignatureViaExtension(uri, payload),
  fetchJson: async (input: Parameters<XhsSearchEnvironment["fetchJson"]>[0]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, input.timeoutMs);

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body,
        credentials: "include",
        signal: controller.signal
      });

      return {
        status: response.status,
        body: await extractFetchBody(response)
      };
    } finally {
      clearTimeout(timer);
    }
  },
  performEditorInputValidation: async (
    input: Parameters<NonNullable<XhsSearchEnvironment["performEditorInputValidation"]>>[0]
  ) => await performEditorInputValidation(input)
});

const resolveTargetDomainFromHref = (href: string): string | null => {
  try {
    return new URL(href).hostname || null;
  } catch {
    return null;
  }
};

const resolveTargetPageFromHref = (href: string): string | null => {
  try {
    const url = new URL(href);
    if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
      return "search_result_tab";
    }
    if (url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish")) {
      return "creator_publish_tab";
    }
    return null;
  } catch {
    return null;
  }
};

export class ContentScriptHandler {
  #listeners = new Set<ContentMessageListener>();
  #reachable = true;
  #xhsEnv: XhsSearchEnvironment;

  constructor(options?: { xhsEnv?: XhsSearchEnvironment }) {
    this.#xhsEnv = options?.xhsEnv ?? createBrowserEnvironment();
  }

  onResult(listener: ContentMessageListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  setReachable(reachable: boolean): void {
    this.#reachable = reachable;
  }

  onBackgroundMessage(message: BackgroundToContentMessage): boolean {
    if (!this.#reachable) {
      return false;
    }

    if (message.commandParams.simulate_no_response === true) {
      return true;
    }

    if (message.command === "runtime.ping") {
      void this.#handleRuntimePing(message);
      return true;
    }

    if (message.command === "runtime.bootstrap") {
      void this.#handleRuntimeBootstrap(message);
      return true;
    }

    if (message.command === "xhs.search") {
      void this.#handleXhsSearch(message);
      return true;
    }

    const result = this.#handleForward(message);
    for (const listener of this.#listeners) {
      listener(result);
    }
    return true;
  }

  async #installFingerprintIfPresent(
    message: BackgroundToContentMessage
  ): Promise<Record<string, unknown> | null> {
    const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
    if (!fingerprintRuntime) {
      return null;
    }
    if (hasInstalledFingerprintInjection(fingerprintRuntime)) {
      return fingerprintRuntime as unknown as Record<string, unknown>;
    }

    try {
      const verifiedInjection = await installFingerprintRuntimeWithVerification(fingerprintRuntime);
      return {
        ...fingerprintRuntime,
        injection: verifiedInjection
      };
    } catch (error) {
      const requiredPatches = asStringArray(
        asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches
      );
      return {
        ...fingerprintRuntime,
        injection: {
          installed: false,
          required_patches: requiredPatches,
          missing_required_patches: requiredPatches,
          error: error instanceof Error ? error.message : String(error)
        }
      };
    }
  }

  async #handleRuntimePing(message: BackgroundToContentMessage): Promise<void> {
    const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
    this.#emit({
      kind: "result",
      id: message.id,
      ok: true,
      payload: {
        message: "pong",
        run_id: message.runId,
        profile: message.profile,
        cwd: message.cwd,
        ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
      }
    });
  }

  async #handleRuntimeBootstrap(message: BackgroundToContentMessage): Promise<void> {
    const commandParams = asRecord(message.commandParams) ?? {};
    const version = asString(commandParams.version);
    const runId = asString(commandParams.run_id);
    const runtimeContextId = asString(commandParams.runtime_context_id);
    const profile = asString(commandParams.profile);
    const mainWorldSecret = asString(commandParams.main_world_secret);
    const fingerprintRuntime = resolveFingerprintContextFromMessage(message);

    if (
      version !== "v1" ||
      !runId ||
      !runtimeContextId ||
      !profile ||
      !mainWorldSecret ||
      !fingerprintRuntime
    ) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
          message: "invalid runtime bootstrap envelope"
        }
      });
      return;
    }
    if (fingerprintRuntime.profile !== profile) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
          message: "runtime bootstrap profile 与 fingerprint runtime 不一致"
        }
      });
      return;
    }

    const channelInstalled = installMainWorldEventChannelSecret(mainWorldSecret);
    const runtimeWithInjection = channelInstalled
      ? await this.#installFingerprintIfPresent({
          ...message,
          fingerprintContext: fingerprintRuntime
        })
      : buildFailedFingerprintInjectionContext(
          fingerprintRuntime,
          "main world event channel unavailable"
        );
    const injection = asRecord(runtimeWithInjection?.injection);
    const attested = injection?.installed === true;
    const ackPayload = buildRuntimeBootstrapAckPayload({
      version,
      runId,
      runtimeContextId,
      profile,
      attested,
      runtimeWithInjection
    });
    if (!attested) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
          message:
            typeof injection?.error === "string"
              ? injection.error
              : "runtime bootstrap 尚未获得执行面确认"
        },
        payload: ackPayload
      });
      return;
    }

    this.#emit({
      kind: "result",
      id: message.id,
      ok: true,
      payload: ackPayload
    });
  }

  #handleForward(message: BackgroundToContentMessage): ContentToBackgroundMessage {
    if (message.command !== "runtime.ping") {
      return {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: `unsupported command: ${message.command}`
        }
      };
    }

    return {
      kind: "result",
      id: message.id,
      ok: true,
      payload: {
        message: "pong",
        run_id: message.runId,
        profile: message.profile,
        cwd: message.cwd
      }
    };
  }

  #safeXhsEnvValue<T>(resolver: () => T, fallback: T): T {
    try {
      return resolver();
    } catch {
      return fallback;
    }
  }

  async #handleXhsSearch(message: BackgroundToContentMessage): Promise<void> {
    const messageFingerprintContext = resolveFingerprintContextFromMessage(message);
    const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
    const requestedExecutionMode = resolveRequestedExecutionMode(message);
    const missingRequiredPatches =
      fingerprintRuntime !== null ? resolveMissingRequiredFingerprintPatches(fingerprintRuntime) : [];
    if (
      requestedExecutionMode !== null &&
      LIVE_EXECUTION_MODES.has(requestedExecutionMode) &&
      missingRequiredPatches.length > 0
    ) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "fingerprint required patches missing for live execution"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
            requested_execution_mode: requestedExecutionMode,
            missing_required_patches: missingRequiredPatches
          },
          ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}),
          fingerprint_forward_diagnostics: {
            direct_message_context: summarizeFingerprintRuntimeContext(
              ensureFingerprintRuntimeContext(message.fingerprintContext ?? null)
            ),
            resolved_message_context: summarizeFingerprintRuntimeContext(messageFingerprintContext),
            installed_runtime_context: summarizeFingerprintRuntimeContext(fingerprintRuntime)
          }
        }
      });
      return;
    }
    const ability = asRecord(message.commandParams.ability);
    const input = asRecord(message.commandParams.input);
    const options = asRecord(message.commandParams.options) ?? {};
    const locationHref = this.#xhsEnv.getLocationHref();
    const actualTargetDomain = resolveTargetDomainFromHref(locationHref);
    const actualTargetPage = resolveTargetPageFromHref(locationHref);

    if (!ability || !input) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "xhs.search payload missing ability or input"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "ABILITY_PAYLOAD_MISSING"
          },
          ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
        }
      });
      return;
    }

    try {
      const result = await executeXhsSearch(
        {
          abilityId: String(ability.id ?? "unknown"),
          abilityLayer: String(ability.layer ?? "L3"),
          abilityAction: String(ability.action ?? "read"),
          params: {
            query: String(input.query ?? ""),
            ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
            ...(typeof input.page === "number" ? { page: input.page } : {}),
            ...(typeof input.search_id === "string" ? { search_id: input.search_id } : {}),
            ...(typeof input.sort === "string" ? { sort: input.sort } : {}),
            ...(typeof input.note_type === "string" || typeof input.note_type === "number"
              ? { note_type: input.note_type }
              : {})
          },
          options: {
            ...(typeof options.timeout_ms === "number" ? { timeout_ms: options.timeout_ms } : {}),
            ...(typeof options.simulate_result === "string"
              ? { simulate_result: options.simulate_result }
              : {}),
            ...(typeof options.x_s_common === "string" ? { x_s_common: options.x_s_common } : {}),
            ...(typeof options.target_domain === "string"
              ? { target_domain: options.target_domain }
              : {}),
            ...(typeof options.target_tab_id === "number"
              ? { target_tab_id: options.target_tab_id }
              : {}),
            ...(typeof options.target_page === "string"
              ? { target_page: options.target_page }
              : {}),
            ...(typeof message.tabId === "number" ? { actual_target_tab_id: message.tabId } : {}),
            ...(actualTargetDomain ? { actual_target_domain: actualTargetDomain } : {}),
            ...(actualTargetPage ? { actual_target_page: actualTargetPage } : {}),
            ...(typeof ability.action === "string" ? { ability_action: ability.action } : {}),
            ...(typeof options.action_type === "string"
              ? { action_type: options.action_type }
              : {}),
            ...(typeof options.issue_scope === "string"
              ? { issue_scope: options.issue_scope }
              : {}),
            ...(requestedExecutionMode !== null
              ? { requested_execution_mode: requestedExecutionMode }
              : {}),
            ...(typeof options.risk_state === "string" ? { risk_state: options.risk_state } : {}),
            ...(typeof options.validation_action === "string"
              ? { validation_action: options.validation_action }
              : {}),
            ...(typeof options.validation_text === "string"
              ? { validation_text: options.validation_text }
              : {}),
            ...(asRecord(options.editor_focus_attestation)
              ? {
                  editor_focus_attestation:
                    asRecord(options.editor_focus_attestation) ?? {}
                }
              : {}),
            ...(asRecord(options.approval_record)
              ? { approval_record: asRecord(options.approval_record) ?? {} }
              : {}),
            ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {})
          },
          executionContext: {
            runId: message.runId,
            sessionId: String(message.params.session_id ?? "nm-session-001"),
            profile: message.profile ?? "unknown"
          }
        },
        this.#xhsEnv
      );
      this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
    } catch (error) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        },
        payload: fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}
      });
    }
  }


  #toContentMessage(
    id: string,
    result: SearchExecutionResult,
    fingerprintRuntime: Record<string, unknown> | null
  ): ContentToBackgroundMessage {
    if (!result.ok) {
      return {
        kind: "result",
        id,
        ok: false,
        error: result.error,
        payload: {
          ...(result.payload ?? {}),
          ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
        }
      };
    }

    return {
      kind: "result",
      id,
      ok: true,
      payload: {
        ...(result.payload ?? {}),
        ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
      }
    };
  }

  #emit(message: ContentToBackgroundMessage): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}
