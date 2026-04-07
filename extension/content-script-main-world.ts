import type { FingerprintRuntimeContext } from "../shared/fingerprint-profile.js";

const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
export const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const MAIN_WORLD_CALL_TIMEOUT_MS = 5_000;

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
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
>();

const encodeUtf8Base64 = (value: string): string => {
  if (typeof btoa === "function") {
    return btoa(unescape(encodeURIComponent(value)));
  }
  const bufferCtor = (globalThis as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64");
  }
  throw new Error("base64 encoder is unavailable");
};

export const encodeMainWorldPayload = (value: Record<string, unknown>): string =>
  encodeUtf8Base64(JSON.stringify(value));

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
  secret: string
): { request_event: string; result_event: string } => {
  const names = resolveMainWorldEventNamesForSecret(secret);
  return {
    request_event: names.requestEvent,
    result_event: names.resultEvent
  };
};

export const resolveMainWorldEventNamesForSecret = (
  secret: string
): { requestEvent: string; resultEvent: string } => {
  const hashed = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
  return {
    requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${hashed}`,
    resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${hashed}`
  };
};

const createWindowEvent = (type: string, detail: unknown): Event => {
  const CustomEventCtor = globalThis.CustomEvent;
  if (typeof CustomEventCtor === "function") {
    return new CustomEventCtor(type, { detail });
  }
  return { type, detail } as unknown as Event;
};

const onMainWorldResultEvent = (event: Event): void => {
  const detail = ((event as CustomEvent<unknown>).detail ?? null) as MainWorldResultEnvelope | null;
  if (!detail || typeof detail.id !== "string") {
    return;
  }
  const pending = pendingMainWorldRequests.get(detail.id);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timeout);
  pendingMainWorldRequests.delete(detail.id);
  if (detail.ok === true) {
    pending.resolve(detail.result);
    return;
  }
  const message = typeof detail.message === "string" ? detail.message : "main world call failed";
  pending.reject(new Error(message));
};

const detachMainWorldResultListener = (): void => {
  if (!mainWorldResultListener || !mainWorldResultListenerEventName) {
    return;
  }
  try {
    window.removeEventListener(
      mainWorldResultListenerEventName,
      mainWorldResultListener as EventListener
    );
  } catch {
    // noop in contract environments
  }
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
    detachMainWorldResultListener();
    mainWorldEventChannel = null;
    return false;
  }
  if (!normalizedSecret) {
    detachMainWorldResultListener();
    mainWorldEventChannel = null;
    return false;
  }

  const names = resolveMainWorldEventNamesForSecret(normalizedSecret);
  if (
    mainWorldEventChannel?.secret === normalizedSecret &&
    mainWorldResultListenerEventName === names.resultEvent
  ) {
    return true;
  }

  detachMainWorldResultListener();
  window.addEventListener(names.resultEvent, onMainWorldResultEvent as EventListener);
  mainWorldEventChannel = {
    secret: normalizedSecret,
    requestEvent: names.requestEvent,
    resultEvent: names.resultEvent
  };
  mainWorldResultListener = onMainWorldResultEvent;
  mainWorldResultListenerEventName = names.resultEvent;
  window.dispatchEvent(
    createWindowEvent(MAIN_WORLD_EVENT_BOOTSTRAP, createMainWorldBootstrapDetail(normalizedSecret))
  );
  return true;
};

export const resetMainWorldEventChannelForContract = (): void => {
  for (const pending of pendingMainWorldRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error("main world request reset"));
  }
  pendingMainWorldRequests.clear();
  detachMainWorldResultListener();
  mainWorldEventChannel = null;
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
  fingerprintRuntime: FingerprintRuntimeContext | Record<string, unknown>
): Promise<Record<string, unknown>> =>
  await mainWorldCall<Record<string, unknown>>({
    type: "fingerprint-install",
    payload: {
      fingerprint_runtime: fingerprintRuntime
    }
  });

export const verifyFingerprintRuntimeViaMainWorld = async (): Promise<Record<string, unknown>> =>
  await mainWorldCall<Record<string, unknown>>({
    type: "fingerprint-verify",
    payload: {}
  });
