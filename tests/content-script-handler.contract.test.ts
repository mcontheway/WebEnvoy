import { describe, expect, it, vi } from "vitest";

import {
  ContentScriptHandler,
  encodeMainWorldPayload,
  installMainWorldEventChannelSecret,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  requestXhsSearchJsonViaMainWorld,
  resetMainWorldEventChannelForContract,
  resolveFingerprintContextForContract,
  resolveMainWorldEventNamesForSecret
} from "../extension/content-script-handler.js";

interface MockEvent {
  type: string;
}

interface MockCustomEvent<T = unknown> extends MockEvent {
  detail: T;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

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

const createApprovedReadApprovalRecord = () => ({
  approved: true,
  approver: "qa-reviewer",
  approved_at: "2026-03-23T10:00:00Z",
  checks: {
    target_domain_confirmed: true,
    target_tab_confirmed: true,
    target_page_confirmed: true,
    risk_state_checked: true,
    action_type_confirmed: true
  }
});

const createIssue209InvocationLinkage = (runId: string, suffix: string) => {
  const gateInvocationId = `issue209-gate-${runId}-${suffix}`;
  const decisionId = `gate_decision_${gateInvocationId}`;
  return {
    gateInvocationId,
    decisionId,
    approvalId: `gate_appr_${decisionId}`
  };
};

const createApprovedReadAuditRecord = (linkage: {
  runId: string;
  requestId: string;
  commandRequestId?: string;
  gateInvocationId?: string;
}) => {
  const decisionId =
    linkage.gateInvocationId
      ? `gate_decision_${linkage.gateInvocationId}`
      : linkage.commandRequestId
        ? `gate_decision_${linkage.runId}_${linkage.commandRequestId}`
        : `gate_decision_${linkage.runId}`;
  return {
  event_id: `gate_evt_${decisionId}`,
  decision_id: decisionId,
  approval_id: `gate_appr_${decisionId}`,
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 1,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_limited",
  gate_decision: "allowed",
  recorded_at: "2026-03-23T10:00:30Z"
  };
};

const createApprovedReadAdmissionContext = (linkage: {
  runId: string;
  requestId: string;
  commandRequestId?: string;
  gateInvocationId?: string;
}) => {
  const requestId = linkage.commandRequestId ?? linkage.requestId;
  const refSuffix = requestId ? `${linkage.runId}_${requestId}` : linkage.runId;
  const internalLinkage = linkage.gateInvocationId
    ? {
        decisionId: `gate_decision_${linkage.gateInvocationId}`,
        approvalId: `gate_appr_gate_decision_${linkage.gateInvocationId}`
      }
    : null;
  return ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${refSuffix}`,
    ...(internalLinkage
      ? {
          decision_id: internalLinkage.decisionId,
          approval_id: internalLinkage.approvalId
        }
      : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: linkage.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 1,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: "live_read_limited",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(internalLinkage
      ? {
          decision_id: internalLinkage.decisionId,
          approval_id: internalLinkage.approvalId
        }
      : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: linkage.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 1,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: "live_read_limited",
    risk_state: "limited",
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:30Z"
  }
});
};

const MAIN_WORLD_CHANNEL_SECRET = "contract-main-world-secret-001";

const withMockMainWorld = async (
  run: (context: {
    mockWindow: Window & Record<string, unknown>;
    mainWorldRequestEvent: string;
    mainWorldResultEvent: string;
  }) => Promise<void>
): Promise<void> => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const previousDocument = (globalThis as { document?: unknown }).document;
  const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
  const previousChrome = (globalThis as { chrome?: unknown }).chrome;
  const { requestEvent: mainWorldRequestEvent, resultEvent: mainWorldResultEvent } =
    resolveMainWorldEventNamesForSecret(MAIN_WORLD_CHANNEL_SECRET);

  const listeners = new Map<string, Set<(event: MockEvent) => void>>();
  const addListener = (type: string, listener: (event: MockEvent) => void) => {
    const current = listeners.get(type) ?? new Set<(event: MockEvent) => void>();
    current.add(listener);
    listeners.set(type, current);
  };
  const removeListener = (type: string, listener: (event: MockEvent) => void) => {
    listeners.get(type)?.delete(listener);
  };
  const dispatchToListeners = (event: MockEvent) => {
    const current = listeners.get(event.type);
    if (!current) {
      return;
    }
    for (const listener of current) {
      listener(event);
    }
  };

  class MockCustomEventImpl<T> implements MockCustomEvent<T> {
    readonly type: string;
    readonly detail: T;

    constructor(type: string, init: { detail: T }) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  const patchedAudioContextPrototypes = new WeakSet<object>();
  const audioNoiseSeedByPrototype = new WeakMap<object, number>();

  const mockWindow = {
    location: {
      href: "https://www.xiaohongshu.com/search_result?keyword=test"
    },
    navigator: {},
    OfflineAudioContext: class MockOfflineAudioContext {
      async startRendering() {
        const channelData = new Float32Array(1);
        channelData[0] = 1;
        return {
          getChannelData() {
            return channelData;
          }
        };
      }
    },
    addEventListener: addListener,
    removeEventListener: removeListener,
    dispatchEvent: (event: MockEvent) => {
      dispatchToListeners(event);
      const customEvent = event as MockCustomEvent<Record<string, unknown>>;
      const detail = customEvent?.detail;
      if (!detail || typeof detail !== "object") {
        return;
      }
      if ("ok" in detail) {
        return;
      }
      const requestId = detail.id;
      const requestType = detail.type;
      const requestPayload =
        typeof detail.payload === "object" && detail.payload !== null
          ? (detail.payload as Record<string, unknown>)
          : null;
      if (typeof requestId !== "string" || requestId.length === 0 || typeof requestType !== "string") {
        return;
      }

      if (event.type !== mainWorldRequestEvent) {
        return;
      }
      const emitResult = (result: Record<string, unknown>) => {
        dispatchToListeners(new MockCustomEventImpl(mainWorldResultEvent, { detail: result }));
      };

      if (requestType === "captured-request-context-read") {
        if (
          (mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeRequestContext__ ===
          true
        ) {
          return;
        }
        const shapeKey =
          typeof requestPayload?.shape_key === "string" ? requestPayload.shape_key : "";
        let parsedShape: Record<string, unknown> | null = null;
        try {
          parsedShape =
            shapeKey.length > 0 ? (JSON.parse(shapeKey) as Record<string, unknown>) : null;
        } catch {
          parsedShape = null;
        }
        const keyword =
          typeof parsedShape?.keyword === "string" ? parsedShape.keyword : "露营";
        const page = typeof parsedShape?.page === "number" ? parsedShape.page : 1;
        const pageSize = typeof parsedShape?.page_size === "number" ? parsedShape.page_size : 20;
        const sort = typeof parsedShape?.sort === "string" ? parsedShape.sort : "general";
        const noteType = typeof parsedShape?.note_type === "number" ? parsedShape.note_type : 0;
        const namespace =
          typeof requestPayload?.page_context_namespace === "string"
            ? requestPayload.page_context_namespace
            : "https://www.xiaohongshu.com/search_result?keyword=test";
        emitResult({
          id: requestId,
          ok: true,
          result: {
            page_context_namespace: namespace,
            shape_key: shapeKey,
            admitted_template: {
              source_kind: "page_request",
              transport: "fetch",
              method: "POST",
              path: "/api/sns/web/v1/search/notes",
              url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
              status: 200,
              captured_at: Date.now(),
              observed_at: Date.now(),
              page_context_namespace: namespace,
              shape_key: shapeKey,
              shape: {
                command: "xhs.search",
                method: "POST",
                pathname: "/api/sns/web/v1/search/notes",
                keyword,
                page,
                page_size: pageSize,
                sort,
                note_type: noteType
              },
              referrer: "https://www.xiaohongshu.com/search_result?keyword=test",
              template_ready: true,
              request_status: {
                completion: "completed",
                http_status: 200
              },
              request: {
                headers: {
                  accept: "application/json, text/plain, */*",
                  "content-type": "application/json;charset=utf-8",
                  "x-s": "signed-template",
                  "x-t": "1700000000"
                },
                body: {
                  keyword,
                  page,
                  page_size: pageSize,
                  search_id: "captured-search-id",
                  sort,
                  note_type: noteType
                }
              },
              response: {
                headers: {
                  "content-type": "application/json"
                },
                body: {
                  code: 0,
                  data: {
                    items: []
                  }
                }
              }
            },
            rejected_observation: null,
            incompatible_observation: null,
            available_shape_keys: [shapeKey]
          }
        });
        return;
      }

      if (requestType === "xhs-sign") {
        if ((mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeXhsSign__ === true) {
          return;
        }
        const fn = (mockWindow as Window & { _webmsxyw?: unknown })._webmsxyw;
        if (typeof fn !== "function") {
          emitResult({ id: requestId, ok: false, message: "window._webmsxyw is not available" });
          return;
        }
        try {
          const uri = typeof requestPayload?.uri === "string" ? requestPayload.uri : "";
          const body =
            typeof requestPayload?.body === "object" && requestPayload.body !== null
              ? requestPayload.body
              : {};
          const value = (fn as (uri: string, body: unknown) => Record<string, unknown>)(uri, body);
          emitResult({ id: requestId, ok: true, result: value });
        } catch (error) {
          emitResult({
            id: requestId,
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
        return;
      }

      if (requestType === "xhs-search-request") {
        if (
          (mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeXhsRequest__ ===
          true
        ) {
          return;
        }
        const fetchHandler =
          (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ ??
          (globalThis as { fetch?: typeof fetch }).fetch;
        if (typeof fetchHandler !== "function") {
          emitResult({ id: requestId, ok: false, message: "main world fetch handler unavailable" });
          return;
        }
        const url = typeof requestPayload?.url === "string" ? requestPayload.url : "";
        const method =
          requestPayload?.method === "GET" ? "GET" : requestPayload?.method === "POST" ? "POST" : "POST";
        const headers =
          typeof requestPayload?.headers === "object" && requestPayload.headers !== null
            ? (requestPayload.headers as Record<string, string>)
            : {};
        const body = typeof requestPayload?.body === "string" ? requestPayload.body : undefined;
        const referrer =
          typeof requestPayload?.referrer === "string" ? requestPayload.referrer : undefined;
        const referrerPolicy =
          typeof requestPayload?.referrerPolicy === "string"
            ? requestPayload.referrerPolicy
            : undefined;
        void Promise.resolve(
          fetchHandler(url, {
            method,
            headers,
            body,
            credentials: "include",
            ...(referrer ? { referrer } : {}),
            ...(referrerPolicy ? { referrerPolicy } : {})
          })
        )
          .then(async (response: Response) => {
            const text = await response.text();
            let parsedBody: unknown = null;
            if (text.length > 0) {
              try {
                parsedBody = JSON.parse(text);
              } catch {
                parsedBody = { message: text };
              }
            }
            emitResult({
              id: requestId,
              ok: true,
              result: {
                status: response.status,
                body: parsedBody
              }
            });
          })
          .catch((error: unknown) => {
            emitResult({
              id: requestId,
              ok: false,
              message: error instanceof Error ? error.message : String(error)
            });
          });
        return;
      }

      if (requestType === "fingerprint-verify") {
        emitResult({
          id: requestId,
          ok: true,
          result: {
            has_get_battery:
              typeof (mockWindow.navigator as Navigator & { getBattery?: unknown }).getBattery ===
              "function",
            plugins_length:
              typeof (mockWindow.navigator as Navigator & { plugins?: { length?: unknown } }).plugins
                ?.length === "number"
                ? Number(
                    (mockWindow.navigator as Navigator & { plugins?: { length?: unknown } }).plugins
                      ?.length
                  )
                : null,
            mime_types_length:
              typeof (mockWindow.navigator as Navigator & { mimeTypes?: { length?: unknown } }).mimeTypes
                ?.length === "number"
                ? Number(
                    (mockWindow.navigator as Navigator & { mimeTypes?: { length?: unknown } }).mimeTypes
                      ?.length
                  )
                : null
          }
        });
        return;
      }

      if (requestType !== "fingerprint-install") {
        return;
      }

      if (
        (mockWindow as Window & Record<string, unknown>)
          .__disableMainWorldBridgeFingerprintInstall__ === true
      ) {
        return;
      }

      try {
        const runtime =
          typeof requestPayload?.fingerprint_runtime === "object" &&
          requestPayload.fingerprint_runtime !== null
            ? (requestPayload.fingerprint_runtime as Record<string, unknown>)
            : null;
        const bundle =
          typeof runtime?.fingerprint_profile_bundle === "object" &&
          runtime.fingerprint_profile_bundle !== null
            ? (runtime.fingerprint_profile_bundle as Record<string, unknown>)
            : null;
        const requiredPatches = Array.isArray(runtime?.fingerprint_patch_manifest)
          ? []
          : Array.isArray(
                (runtime?.fingerprint_patch_manifest as Record<string, unknown> | undefined)
                  ?.required_patches
              )
            ? (((runtime?.fingerprint_patch_manifest as Record<string, unknown>).required_patches ??
                []) as string[])
            : [];
        const patchNameSet = new Set(requiredPatches);
        const appliedPatches: string[] = [];

        if (patchNameSet.has("battery")) {
          const battery =
            typeof bundle?.battery === "object" && bundle.battery !== null
              ? (bundle.battery as Record<string, unknown>)
              : {};
          const level = typeof battery.level === "number" ? battery.level : 1;
          const charging = battery.charging === true;
          Object.defineProperty(mockWindow.navigator, "getBattery", {
            configurable: true,
            value: async () => ({ level, charging })
          });
          appliedPatches.push("battery");
        }

        if (patchNameSet.has("navigator_plugins") || patchNameSet.has("navigator_mime_types")) {
          const defineValue = (
            target: object,
            property: string | number | symbol,
            value: unknown
          ) => {
            Object.defineProperty(target, property, {
              configurable: true,
              enumerable: false,
              writable: false,
              value
            });
          };
          const defineMethod = (
            target: object,
            property: string | symbol,
            fn: (...args: unknown[]) => unknown
          ) => {
            Object.defineProperty(target, property, {
              configurable: true,
              enumerable: false,
              writable: true,
              value: fn
            });
          };
          const resolveIndex = (input: unknown): number | null => {
            const numeric =
              typeof input === "number"
                ? input
                : typeof input === "string" && input.length > 0
                  ? Number.parseInt(input, 10)
                  : NaN;
            const index = Number.isFinite(numeric) ? Math.trunc(numeric) : NaN;
            if (!Number.isFinite(index) || index < 0) {
              return null;
            }
            return index;
          };
          const getIndexedValue = (collection: Record<string, unknown>, index: unknown) => {
            const resolved = resolveIndex(index);
            if (resolved === null) {
              return null;
            }
            return collection[resolved] ?? null;
          };

          const pluginPrototype: Record<string | symbol, unknown> = {};
          defineMethod(
            pluginPrototype,
            "item",
            function (this: Record<string, unknown>, index: unknown) {
              return getIndexedValue(this, index);
            }
          );
          defineMethod(
            pluginPrototype,
            "namedItem",
            function (this: Record<string, unknown>, name: unknown) {
              return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
            }
          );
          defineValue(pluginPrototype, Symbol.toStringTag, "Plugin");

          const mimeTypePrototype: Record<string | symbol, unknown> = {};
          defineValue(mimeTypePrototype, Symbol.toStringTag, "MimeType");

          const pluginArrayPrototype: Record<string | symbol, unknown> = {};
          defineMethod(
            pluginArrayPrototype,
            "item",
            function (this: Record<string, unknown>, index: unknown) {
              return getIndexedValue(this, index);
            }
          );
          defineMethod(
            pluginArrayPrototype,
            "namedItem",
            function (this: Record<string, unknown>, name: unknown) {
              return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
            }
          );
          defineMethod(pluginArrayPrototype, "refresh", () => undefined);
          defineValue(pluginArrayPrototype, Symbol.toStringTag, "PluginArray");

          const mimeTypeArrayPrototype: Record<string | symbol, unknown> = {};
          defineMethod(
            mimeTypeArrayPrototype,
            "item",
            function (this: Record<string, unknown>, index: unknown) {
              return getIndexedValue(this, index);
            }
          );
          defineMethod(
            mimeTypeArrayPrototype,
            "namedItem",
            function (this: Record<string, unknown>, name: unknown) {
              return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
            }
          );
          defineValue(mimeTypeArrayPrototype, Symbol.toStringTag, "MimeTypeArray");

          const plugin = Object.create(pluginPrototype) as Record<string, unknown>;
          defineValue(plugin, "name", "Chrome PDF Viewer");
          defineValue(plugin, "filename", "internal-pdf-viewer");
          defineValue(plugin, "description", "Portable Document Format");

          const secondPlugin = Object.create(pluginPrototype) as Record<string, unknown>;
          defineValue(secondPlugin, "name", "Chromium PDF Viewer");
          defineValue(secondPlugin, "filename", "internal-pdf-viewer");
          defineValue(secondPlugin, "description", "Portable Document Format");

          const mimeType = Object.create(mimeTypePrototype) as Record<string, unknown>;
          defineValue(mimeType, "type", "application/pdf");
          defineValue(mimeType, "suffixes", "pdf");
          defineValue(mimeType, "description", "Portable Document Format");
          defineValue(mimeType, "enabledPlugin", plugin);

          const secondMimeType = Object.create(mimeTypePrototype) as Record<string, unknown>;
          defineValue(secondMimeType, "type", "application/x-google-chrome-pdf");
          defineValue(secondMimeType, "suffixes", "pdf");
          defineValue(secondMimeType, "description", "Portable Document Format");
          defineValue(secondMimeType, "enabledPlugin", plugin);

          defineValue(plugin, 0, mimeType);
          defineValue(plugin, "application/pdf", mimeType);
          defineValue(plugin, 1, secondMimeType);
          defineValue(plugin, "application/x-google-chrome-pdf", secondMimeType);
          defineValue(plugin, "length", 2);
          defineValue(secondPlugin, "length", 0);

          const pluginArray = Object.create(pluginArrayPrototype) as Record<string, unknown>;
          defineValue(pluginArray, 0, plugin);
          defineValue(pluginArray, "Chrome PDF Viewer", plugin);
          defineValue(pluginArray, 1, secondPlugin);
          defineValue(pluginArray, "Chromium PDF Viewer", secondPlugin);
          defineValue(pluginArray, "length", 2);

          const mimeTypeArray = Object.create(mimeTypeArrayPrototype) as Record<string, unknown>;
          defineValue(mimeTypeArray, 0, mimeType);
          defineValue(mimeTypeArray, "application/pdf", mimeType);
          defineValue(mimeTypeArray, 1, secondMimeType);
          defineValue(
            mimeTypeArray,
            "application/x-google-chrome-pdf",
            secondMimeType
          );
          defineValue(mimeTypeArray, "length", 2);

          Object.defineProperty(mockWindow.navigator, "plugins", {
            configurable: true,
            get: () => pluginArray
          });
          Object.defineProperty(mockWindow.navigator, "mimeTypes", {
            configurable: true,
            get: () => mimeTypeArray
          });
          if (patchNameSet.has("navigator_plugins")) {
            appliedPatches.push("navigator_plugins");
          }
          if (patchNameSet.has("navigator_mime_types")) {
            appliedPatches.push("navigator_mime_types");
          }
        }

        if (patchNameSet.has("audio_context")) {
          const noiseSeed =
            typeof bundle?.audioNoiseSeed === "number"
              ? bundle.audioNoiseSeed
              : 0.000001;
          const BaseOfflineAudioContext = mockWindow.OfflineAudioContext;
          const prototype =
            BaseOfflineAudioContext && BaseOfflineAudioContext.prototype
              ? (BaseOfflineAudioContext.prototype as {
                  startRendering?: (...args: unknown[]) => Promise<{
                    getChannelData(channel: number): Float32Array;
                  }>;
                })
              : null;
          const originalStartRendering = prototype?.startRendering;
          if (prototype && typeof originalStartRendering === "function") {
            audioNoiseSeedByPrototype.set(prototype, noiseSeed);
            if (!patchedAudioContextPrototypes.has(prototype)) {
              prototype.startRendering = async function (...args: unknown[]) {
                const rendered = await originalStartRendering.apply(this, args);
                const channelData = rendered.getChannelData(0);
                const baseSeed = audioNoiseSeedByPrototype.get(prototype) ?? noiseSeed;
                if (channelData.length > 0) {
                  channelData[0] += baseSeed;
                }
                return rendered;
              };
              patchedAudioContextPrototypes.add(prototype);
            }
          }
          appliedPatches.push("audio_context");
        }

        const missingRequiredPatches = requiredPatches.filter(
          (patch) => !appliedPatches.includes(patch)
        );
        emitResult({
          id: requestId,
          ok: true,
          result: {
            installed: missingRequiredPatches.length === 0,
            applied_patches: appliedPatches,
            missing_required_patches: missingRequiredPatches,
            required_patches: requiredPatches,
            source: typeof runtime?.source === "string" ? runtime.source : null
          }
        });
      } catch (error) {
        emitResult({
          id: requestId,
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  } as unknown as Window & Record<string, unknown>;
  const mockDocument = {
    title: "contract-test",
    readyState: "complete",
    cookie: "",
    createElement: () => ({
      textContent: "",
      remove: () => {}
    }),
    documentElement: {
      appendChild: (node: unknown) => node
    }
  } as unknown as Document;

  (globalThis as { window?: unknown }).window = mockWindow;
  (globalThis as { document?: unknown }).document = mockDocument;
  (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEventImpl;
  installMainWorldEventChannelSecret(MAIN_WORLD_CHANNEL_SECRET);
  (globalThis as {
    chrome?: {
      runtime?: {
        sendMessage?: (
          message: Record<string, unknown>,
          callback?: (response?: Record<string, unknown>) => void
        ) => Promise<Record<string, unknown> | undefined>;
      };
    };
  }).chrome = {
    runtime: {
      sendMessage: async (
        message: Record<string, unknown>,
        callback?: (response?: Record<string, unknown>) => void
      ) => {
        let response: Record<string, unknown>;
        if (message.kind === "xhs-main-world-request") {
          const fetchHandler =
            (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ ??
            (globalThis as { fetch?: typeof fetch }).fetch;
          if (typeof fetchHandler !== "function") {
            response = {
              ok: false,
              error: {
                code: "ERR_XHS_MAIN_WORLD_REQUEST_FAILED",
                message: "main world fetch handler unavailable"
              }
            };
          } else {
            try {
              const url = typeof message.url === "string" ? message.url : "";
              const method = message.method === "GET" ? "GET" : "POST";
              const headers =
                typeof message.headers === "object" && message.headers !== null
                  ? (message.headers as Record<string, string>)
                  : {};
              const body = typeof message.body === "string" ? message.body : undefined;
              const referrer =
                typeof message.referrer === "string" ? message.referrer : undefined;
              const referrerPolicy =
                typeof message.referrerPolicy === "string"
                  ? message.referrerPolicy
                  : undefined;
              const fetchResult = await fetchHandler(url, {
                method,
                headers,
                body,
                credentials: "include",
                ...(referrer ? { referrer } : {}),
                ...(referrerPolicy ? { referrerPolicy } : {})
              });
              response = {
                ok: true,
                result: {
                  status: fetchResult.status,
                  body: await fetchResult.json()
                }
              };
            } catch (error) {
              response = {
                ok: false,
                error: {
                  code: "ERR_XHS_MAIN_WORLD_REQUEST_FAILED",
                  message: error instanceof Error ? error.message : String(error),
                  ...(error instanceof Error && typeof error.name === "string" && error.name.length > 0
                    ? { name: error.name }
                    : {})
                }
              };
            }
          }
        } else if (message.kind !== "xhs-sign-request") {
          response = {
            ok: false,
            error: {
              code: "ERR_UNSUPPORTED_MESSAGE",
              message: "unsupported message"
            }
          };
        } else if (
          (mockWindow as Window & Record<string, unknown>).__disableExtensionXhsSign__ === true
        ) {
          response = {
            ok: false,
            error: {
              code: "ERR_XHS_SIGN_FAILED",
              message: "xhs-sign request blocked"
            }
          };
        } else {
          const fn = (mockWindow as Window & { _webmsxyw?: unknown })._webmsxyw;
          if (typeof fn !== "function") {
            response = {
              ok: false,
              error: {
                code: "ERR_XHS_SIGN_FAILED",
                message: "window._webmsxyw is not available"
              }
            };
          } else {
            try {
              const uri = typeof message.uri === "string" ? message.uri : "";
              const body =
                typeof message.body === "object" && message.body !== null ? message.body : {};
              response = {
                ok: true,
                result: (fn as (uri: string, body: unknown) => Record<string, unknown>)(uri, body)
              };
            } catch (error) {
              response = {
                ok: false,
                error: {
                  code: "ERR_XHS_SIGN_FAILED",
                  message: error instanceof Error ? error.message : String(error)
                }
              };
            }
          }
        }
        callback?.(response);
        return response;
      }
    }
  };

  try {
    await run({
      mockWindow,
      mainWorldRequestEvent,
      mainWorldResultEvent
    });
  } finally {
    resetMainWorldEventChannelForContract();
    (globalThis as { window?: unknown }).window = previousWindow;
    (globalThis as { document?: unknown }).document = previousDocument;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    (globalThis as { chrome?: unknown }).chrome = previousChrome;
  }
};

const waitForResult = async (results: Array<Record<string, unknown>>): Promise<void> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (results.length > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("content-script handler contract", () => {
  it("encodes payload for main-world transport without exposing raw input", () => {
    const payload = {
      id: "req-001",
      type: "xhs-sign",
      payload: {
        uri: "/api/sns/web/v1/search/notes",
        body: {
          keyword: "</script><script>alert('x')</script>"
        }
      }
    };

    const encoded = encodeMainWorldPayload(payload);
    expect(encoded).not.toContain("</script>");
    expect(encoded).not.toContain("alert('x')");
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    expect(JSON.parse(decoded)).toEqual(payload);
  });

  it("only broadcasts a bootstrap event instead of request/result channel names", () => {
    const previousWindow = (globalThis as { window?: unknown }).window;
    const previousCustomEvent = (globalThis as { CustomEvent?: unknown }).CustomEvent;
    const dispatchedTypes: string[] = [];
    const addedEvents: string[] = [];

    class MockCustomEventImpl<T> implements MockCustomEvent<T> {
      readonly type: string;
      readonly detail: T;

      constructor(type: string, init: { detail: T }) {
        this.type = type;
        this.detail = init.detail;
      }
    }

    const mockWindow = {
      addEventListener: (type: string) => {
        addedEvents.push(type);
      },
      removeEventListener: () => {},
      dispatchEvent: (event: MockEvent) => {
        dispatchedTypes.push(event.type);
      }
    };

    (globalThis as { window?: unknown }).window = mockWindow;
    (globalThis as { CustomEvent?: unknown }).CustomEvent = MockCustomEventImpl;
    resetMainWorldEventChannelForContract();

    try {
      expect(installMainWorldEventChannelSecret(MAIN_WORLD_CHANNEL_SECRET)).toBe(true);
      expect(addedEvents).toEqual(
        expect.arrayContaining([resolveMainWorldEventNamesForSecret(MAIN_WORLD_CHANNEL_SECRET).resultEvent])
      );
      expect(dispatchedTypes).toEqual([MAIN_WORLD_EVENT_BOOTSTRAP]);
    } finally {
      resetMainWorldEventChannelForContract();
      (globalThis as { window?: unknown }).window = previousWindow;
      (globalThis as { CustomEvent?: unknown }).CustomEvent = previousCustomEvent;
    }
  });

  it("normalizes fingerprint_context from command params", () => {
    const fingerprintContext = createFingerprintContext();
    const resolved = resolveFingerprintContextForContract({
      commandParams: {
        fingerprint_context: fingerprintContext
      },
      fingerprintContext: null
    });
    expect(resolved).toEqual(fingerprintContext);
  });

  it("normalizes fingerprint_runtime from command params when fingerprint_context is absent", () => {
    const fingerprintRuntime = createFingerprintContext();
    const resolved = resolveFingerprintContextForContract({
      commandParams: {
        fingerprint_runtime: fingerprintRuntime
      },
      fingerprintContext: null
    });
    expect(resolved).toEqual(fingerprintRuntime);
  });

  it("prefers the top-level fingerprintContext over commandParams fallback", () => {
    const directFingerprintContext = createFingerprintContext();
    const fallbackFingerprintContext = {
      profile: "profile-a",
      source: "profile_missing" as const,
      fingerprint_profile_bundle: null,
      fingerprint_patch_manifest: null,
      fingerprint_consistency_check: {
        profile: "profile-a",
        expected_environment: {
          os_family: "unknown",
          os_version: "unknown",
          arch: "unknown"
        },
        actual_environment: {
          os_family: "linux",
          os_version: "6.8",
          arch: "x64"
        },
        decision: "mismatch" as const,
        reason_codes: ["profile_missing"]
      },
      execution: {
        live_allowed: false,
        live_decision: "dry_run_only" as const,
        allowed_execution_modes: ["dry_run", "recon"],
        reason_codes: ["profile_missing"]
      }
    };

    const resolved = resolveFingerprintContextForContract({
      commandParams: {
        fingerprint_context: fallbackFingerprintContext
      },
      fingerprintContext: directFingerprintContext
    });

    expect(resolved).toEqual(directFingerprintContext);
  });

  it("returns fingerprint_runtime injection status for runtime.ping", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-ping-001",
        runId: "run-ping-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "runtime.ping",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(injection?.installed).toBe(true);
      expect(injection?.applied_patches).toEqual(
        expect.arrayContaining([
          "audio_context",
          "battery",
          "navigator_plugins",
          "navigator_mime_types"
        ])
      );
      expect(injection?.source).toBe("profile_meta");
      const battery = await (mockWindow.navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }).getBattery?.();
      expect(battery?.level).toBe(0.75);
      const plugins = (mockWindow.navigator as Navigator & { plugins?: Record<string, unknown>[] }).plugins;
      const mimeTypes =
        (mockWindow.navigator as Navigator & { mimeTypes?: Record<string, unknown>[] }).mimeTypes;
      expect(plugins?.length).toBeGreaterThan(1);
      expect(mimeTypes?.length).toBeGreaterThan(1);
      expect(Array.isArray(plugins)).toBe(false);
      expect(Array.isArray(mimeTypes)).toBe(false);
      expect(Object.prototype.toString.call(plugins)).toBe("[object PluginArray]");
      expect(Object.prototype.toString.call(mimeTypes)).toBe("[object MimeTypeArray]");
      const pluginItemDescriptor = plugins
        ? Object.getOwnPropertyDescriptor(plugins, "item")
        : undefined;
      const mimeTypeItemDescriptor = mimeTypes
        ? Object.getOwnPropertyDescriptor(mimeTypes, "item")
        : undefined;
      expect(pluginItemDescriptor).toBeUndefined();
      expect(mimeTypeItemDescriptor).toBeUndefined();
      const chromePdfViewer = (plugins as unknown as { namedItem?: (name: string) => Record<string, unknown> | null })
        ?.namedItem?.("Chrome PDF Viewer");
      const applicationPdfMimeType = (mimeTypes as unknown as {
        namedItem?: (name: string) => Record<string, unknown> | null;
      })?.namedItem?.("application/pdf");
      expect(chromePdfViewer).toBeTruthy();
      expect(applicationPdfMimeType?.enabledPlugin).toBe(chromePdfViewer);
      expect(Object.prototype.toString.call(chromePdfViewer)).toBe("[object Plugin]");
      expect(Object.prototype.toString.call(applicationPdfMimeType)).toBe("[object MimeType]");
      expect(
        (
          chromePdfViewer as {
            namedItem?: (name: string) => Record<string, unknown> | null;
          }
        )?.namedItem?.("application/pdf")
      ).toBe(applicationPdfMimeType);
      const offlineAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const renderedBuffer = await offlineAudioContext.startRendering();
      const channelData = renderedBuffer.getChannelData(0);
      expect(channelData[0]).toBeGreaterThan(1);
      expect(
        (mockWindow as Window & Record<string, unknown>).__webenvoy_fingerprint_runtime__
      ).toBeUndefined();
      expect(
        (mockWindow as Window & Record<string, unknown>).__webenvoy_main_world_bridge_installed__
      ).toBeUndefined();
    });
  });

  it("does not trust forged main-world fingerprint-install success by request id only", async () => {
    await withMockMainWorld(async ({ mockWindow, mainWorldRequestEvent, mainWorldResultEvent }) => {
      (mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeFingerprintInstall__ =
        true;

      mockWindow.addEventListener(mainWorldRequestEvent, (event: Event) => {
        const detail = (event as MockCustomEvent<Record<string, unknown>>).detail;
        if (!detail || detail.type !== "fingerprint-install" || typeof detail.id !== "string") {
          return;
        }
        mockWindow.dispatchEvent({
          type: mainWorldResultEvent,
          detail: {
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
          }
        } as unknown as Event);
      });

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-ping-forged-001",
        runId: "run-ping-forged-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "runtime.ping",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      const verification = injection?.verification as Record<string, unknown>;
      const probes = verification?.probes as Record<string, unknown>;
      expect(injection?.installed).toBe(false);
      expect(injection?.missing_required_patches).toEqual(
        expect.arrayContaining(["battery", "navigator_plugins", "navigator_mime_types"])
      );
      expect(verification?.channel).toBe("isolated_world_probes");
      expect((probes?.battery as Record<string, unknown>)?.verified).toBe(false);
      expect((probes?.navigator_plugins as Record<string, unknown>)?.verified).toBe(false);
      expect((probes?.navigator_mime_types as Record<string, unknown>)?.verified).toBe(false);
    });
  });

  it("ignores forged main-world result when event name is derived from an invalid secret", async () => {
    await withMockMainWorld(async ({ mockWindow, mainWorldRequestEvent }) => {
      const forgedEventNames = resolveMainWorldEventNamesForSecret("forged-secret");
      let forgedReplySent = false;
      mockWindow.addEventListener(mainWorldRequestEvent, (event: Event) => {
        const detail = (event as MockCustomEvent<Record<string, unknown>>).detail;
        if (!detail || typeof detail.id !== "string") {
          return;
        }
        forgedReplySent = true;
        mockWindow.dispatchEvent({
          type: forgedEventNames.resultEvent,
          detail: {
            id: detail.id,
            ok: true,
            result: {
              installed: true
            }
          }
        } as unknown as Event);
      });

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-ping-forged-secret-001",
        runId: "run-ping-forged-secret-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "runtime.ping",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(forgedReplySent).toBe(true);
      expect(injection?.installed).toBe(true);
      expect(injection?.missing_required_patches).toEqual([]);
    });
  });

  it("ignores forged main-world xhs-sign success and falls back to captured exact-hit signature", async () => {
    await withMockMainWorld(async ({ mockWindow, mainWorldResultEvent }) => {
      const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch;
      (mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeXhsSign__ = true;
      (globalThis as { document?: { cookie?: string } }).document!.cookie = "a1=session-token";
      const mainWorldFetch = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: { items: [] }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      });
      (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ = mainWorldFetch;
      (globalThis as { fetch?: typeof fetch }).fetch = async () => {
        throw new Error("content script fetch should not be used for exact-hit xhs.search");
      };

      let forgedReplySent = false;
      const emitForgedMainWorldResult = () => {
        forgedReplySent = true;
        mockWindow.dispatchEvent({
          type: mainWorldResultEvent,
          detail: {
            id: "forged-main-world-result",
            ok: true,
            result: {
              "X-s": "forged-signature",
              "X-t": "1700000000"
            }
          }
        } as unknown as Event);
      };

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      try {
        const issue209Linkage = createIssue209InvocationLinkage(
          "run-xhs-sign-forged-001",
          "sign-forged-001"
        );
        handler.onBackgroundMessage({
          kind: "forward",
          id: "run-xhs-sign-forged-001",
          runId: "run-xhs-sign-forged-001",
          tabId: 1,
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          timeoutMs: 1_000,
          command: "xhs.search",
          params: {
            session_id: "nm-session-001"
          },
          commandParams: {
            request_id: "issue209-sign-forged-001",
            gate_invocation_id: issue209Linkage.gateInvocationId,
            requested_execution_mode: "live_read_limited",
            ability: {
              id: "xhs.search",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 1,
              target_page: "search_result_tab",
              action_type: "read",
              risk_state: "limited",
              limited_read_rollout_ready_true: true,
              approval_record: createApprovedReadApprovalRecord(),
              audit_record: createApprovedReadAuditRecord({
                runId: "run-xhs-sign-forged-001",
                requestId: "run-xhs-sign-forged-001",
                commandRequestId: "issue209-sign-forged-001",
                gateInvocationId: issue209Linkage.gateInvocationId
              }),
              admission_context: createApprovedReadAdmissionContext({
                runId: "run-xhs-sign-forged-001",
                requestId: "run-xhs-sign-forged-001",
                commandRequestId: "issue209-sign-forged-001",
                gateInvocationId: issue209Linkage.gateInvocationId
              })
            }
          },
          fingerprintContext: createFingerprintContext()
        });
        emitForgedMainWorldResult();

        await waitForResult(results);

        expect(forgedReplySent).toBe(true);
        expect(results[0]?.ok).toBe(true);
        expect(mainWorldFetch).toHaveBeenCalledTimes(1);
        expect(mainWorldFetch).toHaveBeenCalledWith(
          "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              keyword: "露营",
              page: 1,
              page_size: 20,
              search_id: "captured-search-id",
              sort: "general",
              note_type: 0
            }),
            headers: expect.objectContaining({
              "X-s": "signed-template",
              "X-t": "1700000000"
            })
          })
        );
        const payload = results[0]?.payload as Record<string, unknown>;
        const summary = payload?.summary as Record<string, unknown>;
        expect(summary?.request_context).toMatchObject({ status: "exact_hit" });
      } finally {
        (globalThis as { fetch?: typeof fetch }).fetch = previousFetch;
      }
    });
  });

  it("routes xhs.search live request through main-world fetch and preserves canonical gate fields", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const previousFetch = (globalThis as { fetch?: typeof fetch }).fetch;
      (globalThis as { document?: { cookie?: string } }).document!.cookie = "a1=session-token";
      (mockWindow as Window & Record<string, unknown>)._webmsxyw = () => ({
        "X-s": "signed",
        "X-t": "1700000000"
      });

      const mainWorldFetch = vi.fn(async (_url: string, init?: RequestInit) => {
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              items: [{ id: "note-001" }]
            }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      });
      (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ = mainWorldFetch;
      (globalThis as { fetch?: typeof fetch }).fetch = async () => {
        throw new Error("content script fetch should not be used for live xhs.search");
      };

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      try {
        const runId = "run-xhs-main-world-request-001";
        const issue209Linkage = createIssue209InvocationLinkage(runId, "main-world-request");
        handler.onBackgroundMessage({
          kind: "forward",
          id: runId,
          runId,
          tabId: 1,
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          timeoutMs: 1_000,
          command: "xhs.search",
          params: {
            session_id: "nm-session-001"
          },
          commandParams: {
            request_id: "issue209-main-world-request-001",
            gate_invocation_id: issue209Linkage.gateInvocationId,
            requested_execution_mode: "live_read_limited",
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 1,
              target_page: "search_result_tab",
              action_type: "read",
              risk_state: "limited",
              limited_read_rollout_ready_true: true,
              approval_record: createApprovedReadApprovalRecord(),
              audit_record: createApprovedReadAuditRecord({
                runId,
                requestId: runId,
                commandRequestId: "issue209-main-world-request-001",
                gateInvocationId: issue209Linkage.gateInvocationId
              }),
              admission_context: createApprovedReadAdmissionContext({
                runId,
                requestId: runId,
                commandRequestId: "issue209-main-world-request-001",
                gateInvocationId: issue209Linkage.gateInvocationId
              })
            }
          },
          fingerprintContext: createFingerprintContext()
        });

        await waitForResult(results);

        expect(results[0]?.ok).toBe(true);
        expect(mainWorldFetch).toHaveBeenCalledTimes(1);
        expect(mainWorldFetch).toHaveBeenCalledWith(
          "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          expect.objectContaining({
            method: "POST",
            credentials: "include",
            headers: expect.not.objectContaining({
              "x-webenvoy-synthetic-request": expect.any(String)
            }),
            referrer: "https://www.xiaohongshu.com/search_result?keyword=test",
            referrerPolicy: "strict-origin-when-cross-origin"
          })
        );

        const payload = results[0]?.payload as Record<string, unknown>;
        const summary = payload?.summary as Record<string, unknown>;
        expect((summary?.request_admission_result as Record<string, unknown>)?.admission_decision).toBe(
          "allowed"
        );
        expect(payload?.observability).toBeTruthy();
        expect(payload?.observability).not.toHaveProperty("execution_audit");
      } finally {
        (globalThis as { fetch?: typeof fetch }).fetch = previousFetch;
      }
    });
  });

  it("keeps xhs.search main-world requests alive past the default channel timeout when request timeout is longer", async () => {
    vi.useFakeTimers();
    try {
      await withMockMainWorld(async ({ mockWindow }) => {
        const mainWorldFetch = vi.fn(
          async () =>
            await new Promise<Response>((resolve) => {
              setTimeout(() => {
                resolve(
                  new Response(JSON.stringify({ code: 0, data: { items: [] } }), {
                    status: 200,
                    headers: { "content-type": "application/json" }
                  })
                );
              }, 6_000);
            })
        );
        (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ = mainWorldFetch;

        let settled = false;
        const request = requestXhsSearchJsonViaMainWorld({
          url: "/api/sns/web/v1/search/notes",
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            "X-s": "signed",
            "X-t": "1"
          },
          body: "{\"keyword\":\"露营\"}",
          timeoutMs: 7_000,
          referrer: "https://www.xiaohongshu.com/search_result?keyword=test",
          referrerPolicy: "strict-origin-when-cross-origin"
        }).then((result) => {
          settled = true;
          return result;
        });

        await vi.advanceTimersByTimeAsync(5_500);
        expect(settled).toBe(false);

        await vi.advanceTimersByTimeAsync(600);
        await expect(request).resolves.toMatchObject({
          status: 200,
          body: {
            code: 0,
            data: {
              items: []
            }
          }
        });
        expect(mainWorldFetch).toHaveBeenCalledTimes(1);
        expect(mainWorldFetch).toHaveBeenCalledWith(
          "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
          expect.objectContaining({
            method: "POST",
            credentials: "include"
          })
        );
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves AbortError name when main-world search request times out via extension rpc", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const timeoutError = new Error("request aborted by timeout");
      timeoutError.name = "AbortError";
      (mockWindow as Window & Record<string, unknown>).__mainWorldFetchHandler__ = vi.fn(async () => {
        throw timeoutError;
      });

      await expect(
        requestXhsSearchJsonViaMainWorld({
          url: "/api/sns/web/v1/search/notes",
          method: "POST",
          headers: {
            "Content-Type": "application/json;charset=utf-8",
            "X-s": "signed",
            "X-t": "1"
          },
          body: "{\"keyword\":\"露营\"}",
          timeoutMs: 7_000
        })
      ).rejects.toMatchObject({
        name: "AbortError",
        message: "request aborted by timeout"
      });
    });
  });

  it.each([
    {
      simulateResult: "login_required",
      reason: "SESSION_EXPIRED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "browser_env_abnormal",
      reason: "BROWSER_ENV_ABNORMAL",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "gateway_invoker_failed",
      reason: "GATEWAY_INVOKER_FAILED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      category: "request_failed",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "signature_entry_missing",
      reason: "SIGNATURE_ENTRY_MISSING",
      category: "page_changed",
      failureTarget: "window._webmsxyw",
      failureStage: "action",
      keyRequestCount: 0
    }
  ])(
    "returns structured xhs.search failure for $simulateResult at content-script layer",
    async ({
      simulateResult,
      reason,
      category,
      failureTarget,
      failureStage,
      keyRequestCount
    }) => {
      await withMockMainWorld(async () => {
        const handler = new ContentScriptHandler();
        const results: Array<Record<string, unknown>> = [];
        handler.onResult((message) => {
          results.push(message as unknown as Record<string, unknown>);
        });

        const issue209Linkage = createIssue209InvocationLinkage(
          `run-xhs-simulated-${simulateResult}-001`,
          simulateResult
        );
        handler.onBackgroundMessage({
          kind: "forward",
          id: `run-xhs-simulated-${simulateResult}-001`,
          runId: `run-xhs-simulated-${simulateResult}-001`,
          tabId: 1,
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          timeoutMs: 1_000,
          command: "xhs.search",
          params: {
            session_id: "nm-session-001"
          },
          commandParams: {
            request_id: `issue209-simulated-${simulateResult}-001`,
            gate_invocation_id: issue209Linkage.gateInvocationId,
            requested_execution_mode: "live_read_limited",
            ability: {
              id: "xhs.search",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              simulate_result: simulateResult,
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 1,
              target_page: "search_result_tab",
              action_type: "read",
              risk_state: "limited",
              limited_read_rollout_ready_true: true,
              approval_record: createApprovedReadApprovalRecord(),
              audit_record: createApprovedReadAuditRecord({
                runId: `run-xhs-simulated-${simulateResult}-001`,
                requestId: `run-xhs-simulated-${simulateResult}-001`,
                commandRequestId: `issue209-simulated-${simulateResult}-001`,
                gateInvocationId: issue209Linkage.gateInvocationId
              }),
              admission_context: createApprovedReadAdmissionContext({
                runId: `run-xhs-simulated-${simulateResult}-001`,
                requestId: `run-xhs-simulated-${simulateResult}-001`,
                commandRequestId: `issue209-simulated-${simulateResult}-001`,
                gateInvocationId: issue209Linkage.gateInvocationId
              })
            }
          },
          fingerprintContext: createFingerprintContext()
        });

        await waitForResult(results);

        expect(results[0]?.ok).toBe(false);
        const payload = results[0]?.payload as Record<string, unknown>;
        const details = payload?.details as Record<string, unknown>;
        const observability = payload?.observability as Record<string, unknown>;
        const diagnosis = payload?.diagnosis as Record<string, unknown>;
        const failureSite = observability?.failure_site as Record<string, unknown>;
        const keyRequests = Array.isArray(observability?.key_requests)
          ? (observability.key_requests as Array<Record<string, unknown>>)
          : [];

        expect(details?.reason).toBe(reason);
        expect(diagnosis?.category).toBe(category);
        expect((diagnosis?.failure_site as Record<string, unknown>)?.target).toBe(failureTarget);
        expect(failureSite?.target).toBe(failureTarget);
        expect(failureSite?.stage).toBe(failureStage);
        expect(keyRequests).toHaveLength(keyRequestCount);
      });
    }
  );

  it("classifies xhs.search login overlay separately from request-context missing", async () => {
    await withMockMainWorld(async () => {
      const readCapturedRequestContext = vi.fn(async () => null);
      const fetchJson = vi.fn(async () => ({
        status: 200,
        body: {
          code: 0,
          data: {
            items: []
          }
        }
      }));
      const handler = new ContentScriptHandler({
        xhsEnv: {
          now: () => Date.now(),
          randomId: () => "req-login-modal-001",
          getLocationHref: () => "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5",
          getDocumentTitle: () => "小红书 - 你的生活兴趣社区",
          getReadyState: () => "complete",
          getCookie: () => "a1=cookie-token",
          getBodyText: () => "登录后推荐更懂你的笔记 扫码登录 输入手机号",
          getAccountSafetyOverlay: () => ({
            source: "dom_overlay",
            selector: '.login-modal',
            text: "登录后推荐更懂你的笔记 可用小红书或微信扫码 输入手机号"
          }),
          readCapturedRequestContext,
          callSignature: async () => ({
            "X-s": "signature",
            "X-t": "1700000000"
          }),
          fetchJson
        }
      });
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });
      const issue209Linkage = createIssue209InvocationLinkage(
        "run-xhs-login-modal-001",
        "login-modal"
      );

    handler.onBackgroundMessage({
      kind: "forward",
      id: "run-xhs-login-modal-001",
      runId: "run-xhs-login-modal-001",
      tabId: 1,
      profile: "profile-a",
      cwd: "/workspace/WebEnvoy",
      timeoutMs: 1_000,
      command: "xhs.search",
      params: {
        session_id: "nm-session-001"
      },
      commandParams: {
        request_id: "issue209-login-modal-001",
        gate_invocation_id: issue209Linkage.gateInvocationId,
        requested_execution_mode: "live_read_limited",
        ability: {
          id: "xhs.search",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营"
        },
        options: {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 1,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: createApprovedReadApprovalRecord(),
          audit_record: createApprovedReadAuditRecord({
            runId: "run-xhs-login-modal-001",
            requestId: "run-xhs-login-modal-001",
            commandRequestId: "issue209-login-modal-001",
            gateInvocationId: issue209Linkage.gateInvocationId
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId: "run-xhs-login-modal-001",
            requestId: "run-xhs-login-modal-001",
            commandRequestId: "issue209-login-modal-001",
            gateInvocationId: issue209Linkage.gateInvocationId
          })
        }
      },
      fingerprintContext: createFingerprintContext()
    });

    await waitForResult(results);

    expect(results[0]?.ok).toBe(false);
    const payload = results[0]?.payload as Record<string, unknown>;
    const details = payload?.details as Record<string, unknown>;
    const observability = payload?.observability as Record<string, unknown>;
    expect(details?.reason).toBe("XHS_LOGIN_REQUIRED");
    expect(details?.reason).not.toBe("REQUEST_CONTEXT_MISSING");
    expect((observability?.failure_site as Record<string, unknown>)?.target).toBe(
      "xhs.account_safety_surface"
    );
    expect(observability?.key_requests).toEqual([]);
    expect(readCapturedRequestContext).not.toHaveBeenCalled();
      expect(fetchJson).not.toHaveBeenCalled();
    });
  });

  it("continues scanning visible overlays until an account-safety container is found", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const createOverlay = (text: string, matchedSelector: string) => ({
        innerText: text,
        textContent: text,
        getBoundingClientRect: () => ({ width: 320, height: 240 }),
        matches: (selector: string) => selector === matchedSelector
      });
      (globalThis.document as Document & {
        querySelectorAll?: (selector: string) => unknown[];
        cookie?: string;
      }).querySelectorAll = () => [
        createOverlay("普通提示弹层", '[role="dialog"]'),
        createOverlay("登录后推荐更懂你的笔记 可用小红书或微信扫码 输入手机号", ".login-modal")
      ];
      (globalThis.document as Document & { cookie?: string }).cookie = "a1=cookie-token";
      (mockWindow as Window & {
        getComputedStyle?: () => { display: string; visibility: string; opacity: string };
      }).getComputedStyle = () => ({
        display: "block",
        visibility: "visible",
        opacity: "1"
      });

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });
      const issue209Linkage = createIssue209InvocationLinkage(
        "run-xhs-login-overlay-scan-001",
        "login-overlay-scan"
      );

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-login-overlay-scan-001",
        runId: "run-xhs-login-overlay-scan-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {
          session_id: "nm-session-001"
        },
        commandParams: {
          request_id: "issue209-login-overlay-scan-001",
          gate_invocation_id: issue209Linkage.gateInvocationId,
          requested_execution_mode: "live_read_limited",
          ability: {
            id: "xhs.search",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营"
          },
          options: {
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 1,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            limited_read_rollout_ready_true: true,
            approval_record: createApprovedReadApprovalRecord(),
            audit_record: createApprovedReadAuditRecord({
              runId: "run-xhs-login-overlay-scan-001",
              requestId: "run-xhs-login-overlay-scan-001",
              commandRequestId: "issue209-login-overlay-scan-001",
              gateInvocationId: issue209Linkage.gateInvocationId
            }),
            admission_context: createApprovedReadAdmissionContext({
              runId: "run-xhs-login-overlay-scan-001",
              requestId: "run-xhs-login-overlay-scan-001",
              commandRequestId: "issue209-login-overlay-scan-001",
              gateInvocationId: issue209Linkage.gateInvocationId
            })
          }
        },
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      expect(results[0]?.ok).toBe(false);
      const payload = results[0]?.payload as Record<string, unknown>;
      const details = payload?.details as Record<string, unknown>;
      expect(details?.reason).toBe("XHS_LOGIN_REQUIRED");
    });
  });

  it("keeps audio noise stable across repeated runtime.ping fingerprint installs", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      const sendPing = (id: string): void => {
        handler.onBackgroundMessage({
          kind: "forward",
          id,
          runId: id,
          tabId: 1,
          profile: "profile-a",
          cwd: "/workspace/WebEnvoy",
          timeoutMs: 1_000,
          command: "runtime.ping",
          params: {},
          commandParams: {},
          fingerprintContext: createFingerprintContext()
        });
      };

      sendPing("run-ping-idempotent-001");
      await waitForResult(results);

      const firstAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const firstRenderedBuffer = await firstAudioContext.startRendering();
      const firstValue = firstRenderedBuffer.getChannelData(0)[0];

      sendPing("run-ping-idempotent-002");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if (results.length >= 2) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      const secondAudioContext = new ((mockWindow as unknown as { OfflineAudioContext: new () => { startRendering(): Promise<{ getChannelData(channel: number): Float32Array }> } }).OfflineAudioContext)();
      const secondRenderedBuffer = await secondAudioContext.startRendering();
      const secondValue = secondRenderedBuffer.getChannelData(0)[0];

      expect(firstValue).toBeGreaterThan(1);
      expect(secondValue).toBeCloseTo(firstValue, 12);
      const secondPayload = results[1]?.payload as Record<string, unknown>;
      const secondFingerprintRuntime = secondPayload?.fingerprint_runtime as Record<string, unknown>;
      const secondInjection = secondFingerprintRuntime?.injection as Record<string, unknown>;
      expect(secondInjection?.applied_patches).toContain("audio_context");
    });
  });

  it("keeps fingerprint_runtime on xhs.search validation failures", async () => {
    await withMockMainWorld(async () => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-001",
        runId: "run-xhs-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {},
        fingerprintContext: createFingerprintContext()
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect(injection?.installed).toBe(true);
      expect(injection?.source).toBe("profile_meta");
    });
  });

  it("reuses already-attested fingerprint runtime for xhs.search when main-world install is unavailable", async () => {
    await withMockMainWorld(async ({ mockWindow }) => {
      (mockWindow as Window & Record<string, unknown>).__disableMainWorldBridgeFingerprintInstall__ = true;
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      const fingerprintContext = {
        ...createFingerprintContext(),
        injection: {
          installed: true,
          applied_patches: [
            "audio_context",
            "battery",
            "navigator_plugins",
            "navigator_mime_types"
          ],
          required_patches: [
            "audio_context",
            "battery",
            "navigator_plugins",
            "navigator_mime_types"
          ],
          missing_required_patches: [],
          source: "profile_meta"
        }
      };

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-attested-001",
        runId: "run-xhs-attested-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {},
        fingerprintContext
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect(injection?.installed).toBe(true);
      expect(injection?.missing_required_patches).toEqual([]);
      expect(injection?.source).toBe("profile_meta");
    });
  });

  it("preserves attested injection when fingerprint_context is provided through commandParams", async () => {
    await withMockMainWorld(async () => {
      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      const fingerprintContext = {
        ...createFingerprintContext(),
        injection: {
          installed: true,
          applied_patches: [
            "audio_context",
            "battery",
            "navigator_plugins",
            "navigator_mime_types"
          ],
          required_patches: [
            "audio_context",
            "battery",
            "navigator_plugins",
            "navigator_mime_types"
          ],
          missing_required_patches: [],
          source: "main_world"
        }
      };

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-attested-command-params-001",
        runId: "run-xhs-attested-command-params-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 1,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-31T05:36:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          validation_action: "editor_input",
          input: {
            query: "测试发布文案"
          },
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          fingerprint_context: fingerprintContext
        },
        fingerprintContext: null
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const returnedFingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = returnedFingerprintRuntime?.injection as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect(injection?.installed).toBe(true);
      expect(injection?.missing_required_patches).toEqual([]);
      expect(injection?.source).toBe("main_world");
    });
  });

  it("blocks live xhs.search when required fingerprint patches are missing (top-level requested_execution_mode)", async () => {
    await withMockMainWorld(async () => {
      const fingerprintContext = createFingerprintContext();
      fingerprintContext.fingerprint_patch_manifest.required_patches.push("unknown_required_patch");

      const handler = new ContentScriptHandler();
      const results: Array<Record<string, unknown>> = [];
      handler.onResult((message) => {
        results.push(message as unknown as Record<string, unknown>);
      });

      handler.onBackgroundMessage({
        kind: "forward",
        id: "run-xhs-live-block-001",
        runId: "run-xhs-live-block-001",
        tabId: 1,
        profile: "profile-a",
        cwd: "/workspace/WebEnvoy",
        timeoutMs: 1_000,
        command: "xhs.search",
        params: {},
        commandParams: {
          requested_execution_mode: "live_read_limited",
          ability: {
            id: "xhs.search",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "test"
          }
        },
        fingerprintContext
      });

      await waitForResult(results);

      const payload = results[0]?.payload as Record<string, unknown>;
      const details = payload?.details as Record<string, unknown>;
      const fingerprintRuntime = payload?.fingerprint_runtime as Record<string, unknown>;
      const injection = fingerprintRuntime?.injection as Record<string, unknown>;
      const diagnostics = payload?.fingerprint_forward_diagnostics as Record<string, unknown>;
      const directMessageContext = diagnostics?.direct_message_context as Record<string, unknown>;
      const resolvedMessageContext = diagnostics?.resolved_message_context as Record<string, unknown>;
      const installedRuntimeContext = diagnostics?.installed_runtime_context as Record<string, unknown>;
      expect(results[0]?.ok).toBe(false);
      expect((results[0]?.error as { code?: string } | undefined)?.code).toBe("ERR_EXECUTION_FAILED");
      expect(details?.reason).toBe("FINGERPRINT_REQUIRED_PATCH_MISSING");
      expect(details?.requested_execution_mode).toBe("live_read_limited");
      expect(details?.missing_required_patches).toContain("unknown_required_patch");
      expect(injection?.installed).toBe(false);
      expect(injection?.missing_required_patches).toContain("unknown_required_patch");
      expect(directMessageContext?.injection ?? null).toBeNull();
      expect(resolvedMessageContext?.injection ?? null).toBeNull();
      expect(
        (installedRuntimeContext?.injection as Record<string, unknown> | undefined)?.installed
      ).toBe(false);
    });
  });

  it("returns structured xhs.search failure when pre-execution content-script env access throws", async () => {
    const handler = new ContentScriptHandler({
      xhsEnv: {
        now: () => Date.now(),
        randomId: () => "req-test-001",
        getLocationHref: () => {
          throw new Error("location unavailable");
        },
        getDocumentTitle: () => "Search",
        getReadyState: () => "complete",
        getCookie: () => "",
        callSignature: async () => ({
          "X-s": "signature",
          "X-t": "1700000000"
        }),
        fetchJson: async () => ({
          status: 200,
          body: {
            code: 0,
            data: {
              items: []
            }
          }
        })
      }
    });
    const results: Array<Record<string, unknown>> = [];
    handler.onResult((message) => {
      results.push(message as unknown as Record<string, unknown>);
    });

    handler.onBackgroundMessage({
      kind: "forward",
      id: "run-xhs-location-throw-001",
      runId: "run-xhs-location-throw-001",
      tabId: 1,
      profile: "profile-a",
      cwd: "/workspace/WebEnvoy",
      timeoutMs: 1_000,
      command: "xhs.search",
      params: {
        session_id: "nm-session-001"
      },
      commandParams: {
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营"
        },
        options: {
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "dry_run",
          risk_state: "limited"
        }
      },
      fingerprintContext: null
    });

    await waitForResult(results);

    expect(results[0]?.ok).toBe(false);
    expect((results[0]?.error as { code?: string } | undefined)?.code).toBe(
      "ERR_EXECUTION_FAILED"
    );
    expect((results[0]?.error as { message?: string } | undefined)?.message).toBe(
      "location unavailable"
    );
  });
});
