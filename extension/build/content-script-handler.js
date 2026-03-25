import { executeXhsSearch } from "./xhs-search.js";
import { DEFAULT_MIME_TYPE_DESCRIPTORS, DEFAULT_PLUGIN_DESCRIPTORS, ensureFingerprintRuntimeContext } from "../shared/fingerprint-profile.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const resolveRequestedExecutionMode = (message) => {
    const topLevelMode = asString(asRecord(message.commandParams)?.requested_execution_mode);
    if (topLevelMode) {
        return topLevelMode;
    }
    const options = asRecord(message.commandParams.options);
    return asString(options?.requested_execution_mode);
};
const resolveFingerprintContextFromMessage = (message) => {
    const direct = ensureFingerprintRuntimeContext(message.fingerprintContext ?? null);
    if (direct) {
        return direct;
    }
    const fallback = ensureFingerprintRuntimeContext(asRecord(message.commandParams)?.fingerprint_context ?? null);
    return fallback ?? null;
};
const resolveMissingRequiredFingerprintPatches = (fingerprintRuntime) => {
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
export const resolveFingerprintContextForContract = (message) => resolveFingerprintContextFromMessage({
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
const extractFetchBody = async (response) => {
    const text = await response.text();
    if (text.length === 0) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return {
            message: text
        };
    }
};
const encodeUtf8Base64 = (value) => {
    if (typeof btoa === "function") {
        return btoa(unescape(encodeURIComponent(value)));
    }
    const bufferCtor = globalThis.Buffer;
    if (bufferCtor) {
        return bufferCtor.from(value, "utf8").toString("base64");
    }
    throw new Error("base64 encoder is unavailable");
};
export const encodeMainWorldPayload = (value) => encodeUtf8Base64(JSON.stringify(value));
const mainWorldCall = async (request) => {
    const eventName = "__webenvoy_main_world_result__";
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `mw-${Date.now()}`;
    return await new Promise((resolve, reject) => {
        const listener = (event) => {
            const customEvent = event;
            if (!customEvent.detail || customEvent.detail.id !== requestId) {
                return;
            }
            window.removeEventListener(eventName, listener);
            if (customEvent.detail.ok === true) {
                resolve(customEvent.detail.result);
                return;
            }
            reject(new Error(typeof customEvent.detail.message === "string"
                ? customEvent.detail.message
                : "main world call failed"));
        };
        window.addEventListener(eventName, listener);
        const encodedRequest = encodeMainWorldPayload({
            id: requestId,
            ...request
        });
        const script = document.createElement("script");
        script.textContent = `
      (() => {
        const decodeRequest = (encoded) => JSON.parse(decodeURIComponent(escape(atob(encoded))));
        const request = decodeRequest(${JSON.stringify(encodedRequest)});
        const emit = (detail) => {
          window.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}, { detail }));
        };
        try {
          if (request.type === "xhs-sign") {
            const fn = window._webmsxyw;
            if (typeof fn !== "function") {
              emit({ id: request.id, ok: false, message: "window._webmsxyw is not available" });
              return;
            }
            const result = fn(request.payload.uri, request.payload.body);
            emit({ id: request.id, ok: true, result });
            return;
          }
          if (request.type === "fingerprint-install") {
            const runtime = request.payload.fingerprint_runtime ?? null;
            const bundle =
              runtime && typeof runtime === "object" ? runtime.fingerprint_profile_bundle ?? null : null;
            const requiredPatches = Array.isArray(runtime?.fingerprint_patch_manifest?.required_patches)
              ? runtime.fingerprint_patch_manifest.required_patches
              : [];
            const patchNameSet = new Set(requiredPatches);
            const appliedPatches = [];
            const missingRequiredPatches = [];
            const pluginDescriptors = ${JSON.stringify(DEFAULT_PLUGIN_DESCRIPTORS)};
            const mimeTypeDescriptors = ${JSON.stringify(DEFAULT_MIME_TYPE_DESCRIPTORS)};
            const AUDIO_PATCH_MARKER = "__webenvoy_audio_context_patched__";
            const AUDIO_NOISE_SEED_KEY = "__webenvoy_audio_noise_seed__";
            const defineGetter = (target, property, getter) => {
              Object.defineProperty(target, property, {
                configurable: true,
                get: getter
              });
            };
            const createPluginAndMimeTypeArrays = () => {
              const pluginByName = new Map();
              const plugins = pluginDescriptors.map((descriptor) => {
                const plugin = {
                  name: descriptor.name,
                  filename: descriptor.filename,
                  description: descriptor.description,
                  length: 0
                };
                plugin.item = (index) => plugin[index] ?? null;
                plugin.namedItem = (name) => {
                  if (typeof name !== "string") {
                    return null;
                  }
                  for (let index = 0; index < plugin.length; index += 1) {
                    const entry = plugin[index];
                    if (entry && entry.type === name) {
                      return entry;
                    }
                  }
                  return null;
                };
                pluginByName.set(plugin.name, plugin);
                return plugin;
              });
              plugins.item = (index) => plugins[index] ?? null;
              plugins.namedItem = (name) =>
                plugins.find((plugin) => plugin.name === name) ?? null;
              plugins.refresh = () => undefined;

              const mimeTypes = mimeTypeDescriptors.map((descriptor) => {
                const linkedPlugin =
                  pluginByName.get(descriptor.enabledPlugin) ??
                  plugins[0] ??
                  null;
                const mimeType = {
                  type: descriptor.type,
                  suffixes: descriptor.suffixes,
                  description: descriptor.description,
                  enabledPlugin: linkedPlugin
                };
                if (linkedPlugin) {
                  const nextIndex =
                    typeof linkedPlugin.length === "number" ? linkedPlugin.length : 0;
                  linkedPlugin[nextIndex] = mimeType;
                  linkedPlugin.length = nextIndex + 1;
                }
                return mimeType;
              });
              mimeTypes.item = (index) => mimeTypes[index] ?? null;
              mimeTypes.namedItem = (name) =>
                mimeTypes.find((mimeType) => mimeType.type === name) ?? null;
              return { plugins, mimeTypes };
            };
            const pluginAndMimeTypes = createPluginAndMimeTypeArrays();
            const markAudioContextPatched = () => {
              if (!bundle || !patchNameSet.has("audio_context")) {
                return;
              }
              const OfflineCtor =
                typeof window.OfflineAudioContext === "function"
                  ? window.OfflineAudioContext
                  : typeof window.webkitOfflineAudioContext === "function"
                    ? window.webkitOfflineAudioContext
                    : null;
              if (!OfflineCtor) {
                return;
              }
              const prototype = OfflineCtor.prototype;
              const originalStartRendering = prototype?.startRendering;
              if (typeof originalStartRendering !== "function") {
                return;
              }
              prototype[AUDIO_NOISE_SEED_KEY] = bundle.audioNoiseSeed;
              if (prototype[AUDIO_PATCH_MARKER] === true) {
                appliedPatches.push("audio_context");
                return;
              }
              const patchedChannelData = new WeakSet();
              const patchAudioBuffer = (audioBuffer) => {
                if (!audioBuffer || typeof audioBuffer.getChannelData !== "function") {
                  return audioBuffer;
                }
                const originalGetChannelData = audioBuffer.getChannelData.bind(audioBuffer);
                audioBuffer.getChannelData = (channel) => {
                  const channelData = originalGetChannelData(channel);
                  if (
                    channelData &&
                    typeof channelData.length === "number" &&
                    channelData.length > 0 &&
                    !patchedChannelData.has(channelData)
                  ) {
                    const noiseSeed =
                      typeof prototype[AUDIO_NOISE_SEED_KEY] === "number"
                        ? prototype[AUDIO_NOISE_SEED_KEY]
                        : bundle.audioNoiseSeed;
                    channelData[0] = channelData[0] + noiseSeed;
                    patchedChannelData.add(channelData);
                  }
                  return channelData;
                };
                return audioBuffer;
              };
              prototype.startRendering = function (...args) {
                const renderingResult = originalStartRendering.apply(this, args);
                if (renderingResult && typeof renderingResult.then === "function") {
                  return renderingResult.then((audioBuffer) => patchAudioBuffer(audioBuffer));
                }
                return patchAudioBuffer(renderingResult);
              };
              prototype[AUDIO_PATCH_MARKER] = true;
              appliedPatches.push("audio_context");
            };
            markAudioContextPatched();
            if (bundle && patchNameSet.has("battery") && window.navigator) {
              window.navigator.getBattery = () =>
                Promise.resolve({
                  charging: bundle.battery.charging,
                  level: bundle.battery.level,
                  chargingTime: bundle.battery.charging ? 0 : Infinity,
                  dischargingTime: bundle.battery.charging ? Infinity : 3600,
                  addEventListener() {},
                  removeEventListener() {},
                  dispatchEvent() {
                    return true;
                  }
                });
              appliedPatches.push("battery");
            }
            if (patchNameSet.has("navigator_plugins") && window.navigator) {
              const plugins = pluginAndMimeTypes.plugins;
              defineGetter(window.navigator, "plugins", () => plugins);
              appliedPatches.push("navigator_plugins");
            }
            if (patchNameSet.has("navigator_mime_types") && window.navigator) {
              const mimeTypes = pluginAndMimeTypes.mimeTypes;
              defineGetter(window.navigator, "mimeTypes", () => mimeTypes);
              appliedPatches.push("navigator_mime_types");
            }
            for (const patchName of requiredPatches) {
              if (!appliedPatches.includes(patchName)) {
                missingRequiredPatches.push(patchName);
              }
            }
            window.__webenvoy_fingerprint_runtime__ = runtime;
            emit({
              id: request.id,
              ok: true,
              result: {
                installed: missingRequiredPatches.length === 0,
                applied_patches: appliedPatches,
                required_patches: requiredPatches,
                missing_required_patches: missingRequiredPatches,
                source: typeof runtime?.source === "string" ? runtime.source : "unknown"
              }
            });
            return;
          }
          emit({ id: request.id, ok: false, message: "unsupported main world call" });
        } catch (error) {
          emit({
            id: request.id,
            ok: false,
            message: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    `;
        (document.documentElement ?? document.head ?? document.body).appendChild(script);
        script.remove();
    });
};
const createBrowserEnvironment = () => ({
    now: () => Date.now(),
    randomId: () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}`,
    getLocationHref: () => window.location.href,
    getDocumentTitle: () => document.title,
    getReadyState: () => document.readyState,
    getCookie: () => document.cookie,
    callSignature: async (uri, payload) => await mainWorldCall({
        type: "xhs-sign",
        payload: {
            uri,
            body: payload
        }
    }),
    fetchJson: async (input) => {
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
        }
        finally {
            clearTimeout(timer);
        }
    }
});
const resolveTargetDomainFromHref = (href) => {
    try {
        return new URL(href).hostname || null;
    }
    catch {
        return null;
    }
};
const resolveTargetPageFromHref = (href) => {
    try {
        const url = new URL(href);
        if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
            return "search_result_tab";
        }
        if (url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish")) {
            return "creator_publish_tab";
        }
        return null;
    }
    catch {
        return null;
    }
};
export class ContentScriptHandler {
    #listeners = new Set();
    #reachable = true;
    #xhsEnv;
    constructor(options) {
        this.#xhsEnv = options?.xhsEnv ?? createBrowserEnvironment();
    }
    onResult(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    setReachable(reachable) {
        this.#reachable = reachable;
    }
    onBackgroundMessage(message) {
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
    async #installFingerprintIfPresent(message) {
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (!fingerprintRuntime) {
            return null;
        }
        try {
            const installResult = await mainWorldCall({
                type: "fingerprint-install",
                payload: {
                    fingerprint_runtime: fingerprintRuntime
                }
            });
            return {
                ...fingerprintRuntime,
                injection: installResult
            };
        }
        catch (error) {
            const requiredPatches = asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);
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
    async #handleRuntimePing(message) {
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
    #handleForward(message) {
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
    async #handleXhsSearch(message) {
        const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
        const requestedExecutionMode = resolveRequestedExecutionMode(message);
        const missingRequiredPatches = fingerprintRuntime !== null ? resolveMissingRequiredFingerprintPatches(fingerprintRuntime) : [];
        if (requestedExecutionMode !== null &&
            LIVE_EXECUTION_MODES.has(requestedExecutionMode) &&
            missingRequiredPatches.length > 0) {
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
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
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
            const result = await executeXhsSearch({
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
            }, this.#xhsEnv);
            this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
        }
        catch (error) {
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
    #toContentMessage(id, result, fingerprintRuntime) {
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
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
