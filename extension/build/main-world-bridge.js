"use strict";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
let activeMainWorldEventChannel = null;
let activeMainWorldRequestListener = null;
const patchedAudioContextPrototypes = new WeakSet();
const audioNoiseSeedByPrototype = new WeakMap();
const DEFAULT_PLUGIN_DESCRIPTORS = [
    {
        name: "Chrome PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format"
    },
    {
        name: "Chromium PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format"
    },
    {
        name: "Microsoft Edge PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format"
    },
    {
        name: "PDF Viewer",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format"
    }
];
const DEFAULT_MIME_TYPE_DESCRIPTORS = [
    {
        type: "application/pdf",
        suffixes: "pdf",
        description: "Portable Document Format",
        enabledPlugin: "Chrome PDF Viewer"
    },
    {
        type: "text/pdf",
        suffixes: "pdf",
        description: "Portable Document Format",
        enabledPlugin: "Chrome PDF Viewer"
    }
];
const mainWindow = window;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const asNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const createWindowEvent = (type, detail) => {
    if (typeof CustomEvent === "function") {
        return new CustomEvent(type, { detail });
    }
    return {
        type,
        detail
    };
};
const emitResult = async (resultEvent, result) => {
    if (typeof mainWindow.dispatchEvent !== "function") {
        return;
    }
    mainWindow.dispatchEvent(createWindowEvent(resultEvent, result));
};
const defineGetter = (target, property, getter) => {
    Object.defineProperty(target, property, {
        configurable: true,
        get: getter
    });
};
const createPluginAndMimeTypeArrays = () => {
    const defineValue = (target, property, value) => {
        Object.defineProperty(target, property, {
            configurable: true,
            enumerable: false,
            writable: false,
            value
        });
    };
    const defineMethod = (target, property, value) => {
        Object.defineProperty(target, property, {
            configurable: true,
            enumerable: false,
            writable: true,
            value
        });
    };
    const resolveIndex = (input) => {
        const numeric = typeof input === "number"
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
    const getIndexedValue = (collection, index) => {
        const resolvedIndex = resolveIndex(index);
        if (resolvedIndex === null) {
            return null;
        }
        return collection[resolvedIndex] ?? null;
    };
    const pluginPrototype = {};
    defineMethod(pluginPrototype, "item", function (index) {
        return getIndexedValue(this, index);
    });
    defineMethod(pluginPrototype, "namedItem", function (name) {
        return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
    });
    defineValue(pluginPrototype, Symbol.toStringTag, "Plugin");
    const mimeTypePrototype = {};
    defineValue(mimeTypePrototype, Symbol.toStringTag, "MimeType");
    const pluginArrayPrototype = {};
    defineMethod(pluginArrayPrototype, "item", function (index) {
        return getIndexedValue(this, index);
    });
    defineMethod(pluginArrayPrototype, "namedItem", function (name) {
        return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
    });
    defineMethod(pluginArrayPrototype, "refresh", () => undefined);
    defineValue(pluginArrayPrototype, Symbol.toStringTag, "PluginArray");
    const mimeTypeArrayPrototype = {};
    defineMethod(mimeTypeArrayPrototype, "item", function (index) {
        return getIndexedValue(this, index);
    });
    defineMethod(mimeTypeArrayPrototype, "namedItem", function (name) {
        return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
    });
    defineValue(mimeTypeArrayPrototype, Symbol.toStringTag, "MimeTypeArray");
    const pluginByName = new Map();
    const pluginMimeTypes = new Map();
    const pluginsList = DEFAULT_PLUGIN_DESCRIPTORS.map((descriptor) => {
        const plugin = Object.create(pluginPrototype);
        defineValue(plugin, "name", descriptor.name);
        defineValue(plugin, "filename", descriptor.filename);
        defineValue(plugin, "description", descriptor.description);
        pluginByName.set(descriptor.name, plugin);
        pluginMimeTypes.set(plugin, []);
        return plugin;
    });
    const mimeTypesList = DEFAULT_MIME_TYPE_DESCRIPTORS.map((descriptor) => {
        const linkedPlugin = pluginByName.get(descriptor.enabledPlugin) ?? pluginsList[0] ?? null;
        const mimeType = Object.create(mimeTypePrototype);
        defineValue(mimeType, "type", descriptor.type);
        defineValue(mimeType, "suffixes", descriptor.suffixes);
        defineValue(mimeType, "description", descriptor.description);
        defineValue(mimeType, "enabledPlugin", linkedPlugin);
        if (linkedPlugin) {
            const linkedMimeTypes = pluginMimeTypes.get(linkedPlugin) ?? [];
            const nextIndex = linkedMimeTypes.length;
            linkedMimeTypes.push(mimeType);
            pluginMimeTypes.set(linkedPlugin, linkedMimeTypes);
            defineValue(linkedPlugin, nextIndex, mimeType);
            defineValue(linkedPlugin, descriptor.type, mimeType);
        }
        return mimeType;
    });
    for (const plugin of pluginsList) {
        const linkedMimeTypes = pluginMimeTypes.get(plugin) ?? [];
        defineValue(plugin, "length", linkedMimeTypes.length);
    }
    const plugins = Object.create(pluginArrayPrototype);
    for (let index = 0; index < pluginsList.length; index += 1) {
        const plugin = pluginsList[index];
        defineValue(plugins, index, plugin);
        if (typeof plugin.name === "string") {
            defineValue(plugins, plugin.name, plugin);
        }
    }
    defineValue(plugins, "length", pluginsList.length);
    const mimeTypes = Object.create(mimeTypeArrayPrototype);
    for (let index = 0; index < mimeTypesList.length; index += 1) {
        const mimeType = mimeTypesList[index];
        defineValue(mimeTypes, index, mimeType);
        if (typeof mimeType.type === "string") {
            defineValue(mimeTypes, mimeType.type, mimeType);
        }
    }
    defineValue(mimeTypes, "length", mimeTypesList.length);
    return {
        plugins,
        mimeTypes
    };
};
const installFingerprintRuntime = (runtime) => {
    const bundle = asRecord(runtime?.fingerprint_profile_bundle ?? null);
    const requiredPatches = asStringArray(asRecord(runtime?.fingerprint_patch_manifest ?? null)?.required_patches);
    const patchNameSet = new Set(requiredPatches);
    const appliedPatches = [];
    const missingRequiredPatches = [];
    const pluginAndMimeTypes = createPluginAndMimeTypeArrays();
    if (bundle && patchNameSet.has("audio_context")) {
        const audioNoiseSeed = asNumber(bundle.audioNoiseSeed);
        const webkitOfflineAudioContextCtor = window.webkitOfflineAudioContext;
        const OfflineCtor = typeof window.OfflineAudioContext === "function"
            ? window.OfflineAudioContext
            : typeof webkitOfflineAudioContextCtor === "function"
                ? webkitOfflineAudioContextCtor
                : null;
        if (audioNoiseSeed !== null && OfflineCtor) {
            const prototype = OfflineCtor.prototype;
            const originalStartRendering = prototype.startRendering;
            if (typeof originalStartRendering === "function") {
                audioNoiseSeedByPrototype.set(prototype, audioNoiseSeed);
                if (patchedAudioContextPrototypes.has(prototype)) {
                    appliedPatches.push("audio_context");
                }
                else {
                    const patchedChannelData = new WeakSet();
                    const patchAudioBuffer = (audioBuffer) => {
                        if (!audioBuffer || typeof audioBuffer.getChannelData !== "function") {
                            return audioBuffer;
                        }
                        const originalGetChannelData = audioBuffer.getChannelData.bind(audioBuffer);
                        audioBuffer.getChannelData = (channel) => {
                            const channelData = originalGetChannelData(channel);
                            if (channelData &&
                                typeof channelData.length === "number" &&
                                channelData.length > 0 &&
                                !patchedChannelData.has(channelData)) {
                                const noiseSeed = audioNoiseSeedByPrototype.get(prototype) ?? audioNoiseSeed;
                                channelData[0] = channelData[0] + noiseSeed;
                                patchedChannelData.add(channelData);
                            }
                            return channelData;
                        };
                        return audioBuffer;
                    };
                    const originalStartRenderingFn = originalStartRendering;
                    prototype.startRendering = function (...args) {
                        const renderingResult = originalStartRenderingFn.apply(this, args);
                        if (renderingResult && typeof renderingResult.then === "function") {
                            return renderingResult.then((audioBuffer) => patchAudioBuffer(audioBuffer));
                        }
                        return patchAudioBuffer(renderingResult);
                    };
                    patchedAudioContextPrototypes.add(prototype);
                    appliedPatches.push("audio_context");
                }
            }
        }
    }
    if (bundle && patchNameSet.has("battery")) {
        const battery = asRecord(bundle.battery);
        const level = asNumber(battery?.level);
        const charging = typeof battery?.charging === "boolean" ? battery.charging : null;
        if (charging !== null && level !== null) {
            window.navigator.getBattery = () => Promise.resolve({
                charging,
                level,
                chargingTime: charging ? 0 : Infinity,
                dischargingTime: charging ? Infinity : 3600,
                addEventListener() { },
                removeEventListener() { },
                dispatchEvent() {
                    return true;
                }
            });
            appliedPatches.push("battery");
        }
    }
    if (patchNameSet.has("navigator_plugins")) {
        defineGetter(window.navigator, "plugins", () => pluginAndMimeTypes.plugins);
        appliedPatches.push("navigator_plugins");
    }
    if (patchNameSet.has("navigator_mime_types")) {
        defineGetter(window.navigator, "mimeTypes", () => pluginAndMimeTypes.mimeTypes);
        appliedPatches.push("navigator_mime_types");
    }
    for (const patchName of requiredPatches) {
        if (!appliedPatches.includes(patchName)) {
            missingRequiredPatches.push(patchName);
        }
    }
    return {
        installed: missingRequiredPatches.length === 0,
        applied_patches: appliedPatches,
        required_patches: requiredPatches,
        missing_required_patches: missingRequiredPatches,
        source: typeof runtime?.source === "string" ? runtime.source : "unknown"
    };
};
const parseMainWorldRequest = (event) => {
    const detail = asRecord(event.detail);
    if (!detail) {
        return null;
    }
    const id = asString(detail.id);
    const type = detail.type;
    if (!id || type !== "fingerprint-install") {
        return null;
    }
    return {
        id,
        type,
        payload: asRecord(detail.payload) ?? {}
    };
};
const handleRequest = async (request) => {
    const runtime = asRecord(request.payload.fingerprint_runtime ?? null);
    const result = installFingerprintRuntime(runtime);
    if (!activeMainWorldEventChannel) {
        return;
    }
    await emitResult(activeMainWorldEventChannel.resultEvent, {
        id: request.id,
        ok: true,
        result
    });
};
const isValidChannelEventName = (value, prefix) => value.startsWith(prefix) && /^[A-Za-z0-9_.:-]+$/.test(value) && value.length <= 128;
const resolveExpectedMainWorldEventChannel = () => {
    const requestEvent = typeof EXPECTED_MAIN_WORLD_REQUEST_EVENT === "string"
        ? EXPECTED_MAIN_WORLD_REQUEST_EVENT
        : null;
    const resultEvent = typeof EXPECTED_MAIN_WORLD_RESULT_EVENT === "string"
        ? EXPECTED_MAIN_WORLD_RESULT_EVENT
        : null;
    if (!requestEvent || !resultEvent) {
        return null;
    }
    if (!isValidChannelEventName(requestEvent, MAIN_WORLD_EVENT_REQUEST_PREFIX)) {
        return null;
    }
    if (!isValidChannelEventName(resultEvent, MAIN_WORLD_EVENT_RESULT_PREFIX)) {
        return null;
    }
    return {
        requestEvent,
        resultEvent
    };
};
const attachMainWorldEventChannel = (channel) => {
    if (activeMainWorldEventChannel) {
        if (activeMainWorldEventChannel.requestEvent === channel.requestEvent &&
            activeMainWorldEventChannel.resultEvent === channel.resultEvent) {
            return;
        }
        return;
    }
    activeMainWorldEventChannel = channel;
    activeMainWorldRequestListener = (event) => {
        const request = parseMainWorldRequest(event);
        if (!request) {
            return;
        }
        void handleRequest(request).catch(async (error) => {
            if (!activeMainWorldEventChannel) {
                return;
            }
            await emitResult(activeMainWorldEventChannel.resultEvent, {
                id: request.id,
                ok: false,
                message: error instanceof Error ? error.message : String(error)
            });
        });
    };
    window.addEventListener(channel.requestEvent, activeMainWorldRequestListener);
};
const expectedMainWorldEventChannel = resolveExpectedMainWorldEventChannel();
if (expectedMainWorldEventChannel) {
    attachMainWorldEventChannel(expectedMainWorldEventChannel);
}
