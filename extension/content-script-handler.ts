import { executeXhsSearch, type SearchExecutionResult, type XhsSearchEnvironment } from "./xhs-search.js";
import { executeXhsDetail } from "./xhs-detail.js";
import { executeXhsUserHome } from "./xhs-user-home.js";
import { performEditorInputValidation } from "./xhs-editor-input.js";
import {
  ensureFingerprintRuntimeContext,
  type FingerprintRuntimeContext
} from "../shared/fingerprint-profile.js";
import {
  buildFailedFingerprintInjectionContext,
  hasInstalledFingerprintInjection,
  installFingerprintRuntimeWithVerification,
  resolveFingerprintContextForContract,
  resolveFingerprintContextFromMessage,
  resolveMissingRequiredFingerprintPatches,
  summarizeFingerprintRuntimeContext
} from "./content-script-fingerprint.js";
import {
  encodeMainWorldPayload,
  installMainWorldEventChannelSecret,
  installFingerprintRuntimeViaMainWorld,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  readPageStateViaMainWorld,
  requestXhsSearchJsonViaMainWorld,
  resetMainWorldEventChannelForContract,
  resolveMainWorldEventNamesForSecret
} from "./content-script-main-world.js";
import {
  ExtensionContractError,
  validateXhsCommandInputForExtension
} from "./xhs-command-contract.js";
import { containsCookie } from "./xhs-search-telemetry.js";

export {
  encodeMainWorldPayload,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  readPageStateViaMainWorld,
  requestXhsSearchJsonViaMainWorld,
  resetMainWorldEventChannelForContract,
  resolveMainWorldEventNamesForSecret
};
export { resolveFingerprintContextForContract };

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
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
const XHS_READ_DOMAIN = "www.xiaohongshu.com";

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const toCliInvalidArgsResult = (input: {
  id: string;
  error: ExtensionContractError;
  fingerprintRuntime: Record<string, unknown> | null;
}): ContentToBackgroundMessage => ({
  kind: "result",
  id: input.id,
  ok: false,
  error: {
    code: input.error.code,
    message: input.error.message
  },
  payload: {
    ...(input.error.details ? { details: input.error.details } : {}),
    ...(input.fingerprintRuntime ? { fingerprint_runtime: input.fingerprintRuntime } : {})
  }
});

const resolveRequestedExecutionMode = (message: BackgroundToContentMessage): string | null => {
  const topLevelMode = asString(asRecord(message.commandParams)?.requested_execution_mode);
  if (topLevelMode) {
    return topLevelMode;
  }
  const options = asRecord(message.commandParams.options);
  return asString(options?.requested_execution_mode);
};

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
  getPageStateRoot: () => (window as typeof window & { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__,
  readPageStateRoot: async () => await readPageStateViaMainWorld(),
  callSignature: async (
    uri: Parameters<XhsSearchEnvironment["callSignature"]>[0],
    payload: Parameters<XhsSearchEnvironment["callSignature"]>[1]
  ) => await requestXhsSignatureViaExtension(uri, payload),
  fetchJson: async (input: Parameters<XhsSearchEnvironment["fetchJson"]>[0]) => {
    if (input.pageContextRequest === true) {
      return await requestXhsSearchJsonViaMainWorld({
        url: input.url,
        method: input.method,
        headers: input.headers,
        ...(typeof input.body === "string" ? { body: input.body } : {}),
        timeoutMs: input.timeoutMs,
        ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
        ...(typeof input.referrerPolicy === "string"
          ? { referrerPolicy: input.referrerPolicy }
          : {})
      });
    }

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
        ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
        ...(typeof input.referrerPolicy === "string"
          ? { referrerPolicy: input.referrerPolicy as ReferrerPolicy }
          : {}),
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

const resolveTargetPageFromHref = (href: string, command: string): string | null => {
  try {
    const url = new URL(href);
    if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
      return "search_result_tab";
    }
    if (command === "xhs.detail" && url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/explore/")) {
      return "explore_detail_tab";
    }
    if (
      command === "xhs.user_home" &&
      url.hostname === "www.xiaohongshu.com" &&
      url.pathname.startsWith("/user/profile/")
    ) {
      return "profile_tab";
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

    if (XHS_READ_COMMANDS.has(message.command)) {
      void this.#handleXhsReadCommand(message).catch((error) => {
        this.#emitUnexpectedXhsReadFailure(message, error);
      });
      return true;
    }

    const result = this.#handleForward(message);
    for (const listener of this.#listeners) {
      listener(result);
    }
    return true;
  }

  #emitUnexpectedXhsReadFailure(
    message: BackgroundToContentMessage,
    error: unknown
  ): void {
    const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
    if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
      this.#emit(
        toCliInvalidArgsResult({
          id: message.id,
          error,
          fingerprintRuntime: fingerprintRuntime as unknown as Record<string, unknown> | null
        })
      );
      return;
    }

    this.#emit({
      kind: "result",
      id: message.id,
      ok: false,
      error: {
        code: "ERR_EXECUTION_FAILED",
        message: error instanceof Error ? error.message : String(error)
      },
      payload: fingerprintRuntime
        ? {
            fingerprint_runtime: fingerprintRuntime as unknown as Record<string, unknown>
          }
        : {}
    });
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

  async #handleXhsReadCommand(message: BackgroundToContentMessage): Promise<void> {
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
    const actualTargetPage = resolveTargetPageFromHref(locationHref, message.command);
    const observedTargetSiteLoggedIn =
      actualTargetDomain === XHS_READ_DOMAIN && containsCookie(this.#xhsEnv.getCookie(), "a1");
    const observedAnonymousIsolationVerified =
      actualTargetDomain === XHS_READ_DOMAIN && observedTargetSiteLoggedIn === false;

    if (!ability || !input) {
      this.#emit({
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: `${message.command} payload missing ability or input`
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
      const normalizedInput = validateXhsCommandInputForExtension({
        command: message.command,
        abilityId: String(ability.id ?? "unknown"),
        abilityAction: typeof ability.action === "string" ? (ability.action as "read" | "write" | "download") : "read",
        payload: input,
        options
      });
      const commonInput = {
        abilityId: String(ability.id ?? "unknown"),
        abilityLayer: String(ability.layer ?? "L3"),
        abilityAction: String(ability.action ?? "read"),
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
          ...(asRecord(options.upstream_authorization_request)
            ? {
                upstream_authorization_request:
                  asRecord(options.upstream_authorization_request) ?? {}
              }
            : {}),
          ...(typeof options.__legacy_requested_execution_mode === "string"
            ? { __legacy_requested_execution_mode: options.__legacy_requested_execution_mode }
            : {}),
          ...(options.limited_read_rollout_ready_true === true
            ? { limited_read_rollout_ready_true: true }
            : {}),
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
          ...(asRecord(options.audit_record)
            ? { audit_record: asRecord(options.audit_record) ?? {} }
            : {}),
          ...(asRecord(options.admission_context)
            ? { admission_context: asRecord(options.admission_context) ?? {} }
            : {}),
          ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {}),
          ...(actualTargetDomain === XHS_READ_DOMAIN
            ? {
                target_site_logged_in: observedTargetSiteLoggedIn,
                __anonymous_isolation_verified: observedAnonymousIsolationVerified
              }
            : {})
        },
        executionContext: {
          runId: message.runId,
          sessionId: String(message.params.session_id ?? "nm-session-001"),
          profile: message.profile ?? "unknown",
          requestId: message.id,
          commandRequestId: asString(asRecord(message.commandParams)?.request_id) ?? undefined,
          gateInvocationId:
            asString(asRecord(message.commandParams)?.gate_invocation_id) ?? undefined
        }
      };
      let result: SearchExecutionResult;
      if (message.command === "xhs.search") {
        const searchInput = normalizedInput as {
          query: string;
          limit?: number;
          page?: number;
          search_id?: string;
          sort?: string;
          note_type?: string | number;
        };
        result = await executeXhsSearch(
          {
            ...commonInput,
            params: {
              query: searchInput.query,
              ...(typeof searchInput.limit === "number" ? { limit: searchInput.limit } : {}),
              ...(typeof searchInput.page === "number" ? { page: searchInput.page } : {}),
              ...(typeof searchInput.search_id === "string"
                ? { search_id: searchInput.search_id }
                : {}),
              ...(typeof searchInput.sort === "string" ? { sort: searchInput.sort } : {}),
              ...(typeof searchInput.note_type === "string" ||
              typeof searchInput.note_type === "number"
                ? { note_type: searchInput.note_type }
                : {})
            }
          },
          this.#xhsEnv
        );
      } else if (message.command === "xhs.detail") {
        result = await executeXhsDetail(
          {
            ...commonInput,
            params: {
              note_id: (normalizedInput as { note_id: string }).note_id
            }
          },
          this.#xhsEnv
        );
      } else {
        result = await executeXhsUserHome(
          {
            ...commonInput,
            params: {
              user_id: (normalizedInput as { user_id: string }).user_id
            }
          },
          this.#xhsEnv
        );
      }
      this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
    } catch (error) {
      if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
        this.#emit(
          toCliInvalidArgsResult({
            id: message.id,
            error,
            fingerprintRuntime
          })
        );
        return;
      }
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
