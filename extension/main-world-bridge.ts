type RecordValue = Record<string, unknown>;

type MainWorldRequestType = "fingerprint-install" | "fingerprint-verify" | "page-state-read";

type MainWorldRequest = {
  id: string;
  type: MainWorldRequestType;
  payload: RecordValue;
};

type MainWorldResult = {
  id: string;
  ok: boolean;
  result?: unknown;
  message?: string;
};

type MainWorldWindow = Window & typeof globalThis;

type MainWorldEventChannel = {
  requestEvent: string;
  resultEvent: string;
};

type FingerprintPatchInstallContext = {
  bundle: RecordValue | null;
  requiredPatches: Set<string>;
  appliedPatches: string[];
  pluginAndMimeTypes: ReturnType<typeof createPluginAndMimeTypeArrays>;
};

const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
declare const EXPECTED_MAIN_WORLD_REQUEST_EVENT: string | undefined;
declare const EXPECTED_MAIN_WORLD_RESULT_EVENT: string | undefined;
let activeMainWorldEventChannel: MainWorldEventChannel | null = null;
let activeMainWorldRequestListener: ((event: Event) => void) | null = null;
let activeMainWorldBootstrapListener: ((event: Event) => void) | null = null;
const patchedAudioContextPrototypes = new WeakSet<object>();
const audioNoiseSeedByPrototype = new WeakMap<object, number>();

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
] as const;

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
] as const;

const mainWindow = window as MainWorldWindow;

const asRecord = (value: unknown): RecordValue | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as RecordValue)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const createWindowEvent = (type: string, detail: unknown): Event => {
  if (typeof CustomEvent === "function") {
    return new CustomEvent(type, { detail });
  }
  return {
    type,
    detail
  } as unknown as Event;
};

const emitResult = async (resultEvent: string, result: MainWorldResult): Promise<void> => {
  if (typeof mainWindow.dispatchEvent !== "function") {
    return;
  }
  mainWindow.dispatchEvent(createWindowEvent(resultEvent, result));
};

const defineGetter = (target: object, property: string, getter: () => unknown): void => {
  Object.defineProperty(target, property, {
    configurable: true,
    get: getter
  });
};

const createPluginAndMimeTypeArrays = () => {
  const defineValue = (
    target: object,
    property: string | number | symbol,
    value: unknown
  ): void => {
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
    value: (...args: unknown[]) => unknown
  ): void => {
    Object.defineProperty(target, property, {
      configurable: true,
      enumerable: false,
      writable: true,
      value
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
    const resolvedIndex = resolveIndex(index);
    if (resolvedIndex === null) {
      return null;
    }
    return collection[resolvedIndex] ?? null;
  };

  const pluginPrototype: Record<string | symbol, unknown> = {};
  defineMethod(pluginPrototype, "item", function (this: Record<string, unknown>, index: unknown) {
    return getIndexedValue(this, index);
  });
  defineMethod(pluginPrototype, "namedItem", function (this: Record<string, unknown>, name: unknown) {
    return typeof name === "string" && name.length > 0 ? this[name] ?? null : null;
  });
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

  const pluginByName = new Map<string, Record<string, unknown>>();
  const pluginMimeTypes = new Map<Record<string, unknown>, Record<string, unknown>[]>();
  const pluginsList = DEFAULT_PLUGIN_DESCRIPTORS.map((descriptor) => {
    const plugin = Object.create(pluginPrototype) as Record<string, unknown>;
    defineValue(plugin, "name", descriptor.name);
    defineValue(plugin, "filename", descriptor.filename);
    defineValue(plugin, "description", descriptor.description);
    pluginByName.set(descriptor.name, plugin);
    pluginMimeTypes.set(plugin, []);
    return plugin;
  });

  const mimeTypesList = DEFAULT_MIME_TYPE_DESCRIPTORS.map((descriptor) => {
    const linkedPlugin = pluginByName.get(descriptor.enabledPlugin) ?? pluginsList[0] ?? null;
    const mimeType = Object.create(mimeTypePrototype) as Record<string, unknown>;
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

  const plugins = Object.create(pluginArrayPrototype) as Record<string, unknown>;
  for (let index = 0; index < pluginsList.length; index += 1) {
    const plugin = pluginsList[index];
    defineValue(plugins, index, plugin);
    if (typeof plugin.name === "string") {
      defineValue(plugins, plugin.name, plugin);
    }
  }
  defineValue(plugins, "length", pluginsList.length);

  const mimeTypes = Object.create(mimeTypeArrayPrototype) as Record<string, unknown>;
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

const installAudioContextPatch = (context: FingerprintPatchInstallContext): void => {
  if (!context.bundle || !context.requiredPatches.has("audio_context")) {
    return;
  }

  const audioNoiseSeed = asNumber(context.bundle.audioNoiseSeed);
  const webkitOfflineAudioContextCtor = (
    window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }
  ).webkitOfflineAudioContext;
  const OfflineCtor =
    typeof window.OfflineAudioContext === "function"
      ? window.OfflineAudioContext
      : typeof webkitOfflineAudioContextCtor === "function"
        ? webkitOfflineAudioContextCtor
        : null;
  if (audioNoiseSeed === null || !OfflineCtor) {
    return;
  }

  const prototype = OfflineCtor.prototype as object & {
    startRendering?: (...args: unknown[]) => unknown;
  };
  const originalStartRendering = prototype.startRendering;
  if (typeof originalStartRendering !== "function") {
    return;
  }

  context.appliedPatches.push("audio_context");
  audioNoiseSeedByPrototype.set(prototype, audioNoiseSeed);
  if (patchedAudioContextPrototypes.has(prototype)) {
    return;
  }

  const patchedChannelData = new WeakSet<Float32Array>();
  const patchAudioBuffer = (audioBuffer: any) => {
    if (!audioBuffer || typeof audioBuffer.getChannelData !== "function") {
      return audioBuffer;
    }
    const originalGetChannelData = audioBuffer.getChannelData.bind(audioBuffer);
    audioBuffer.getChannelData = (channel: number) => {
      const channelData = originalGetChannelData(channel);
      if (
        channelData &&
        typeof channelData.length === "number" &&
        channelData.length > 0 &&
        !patchedChannelData.has(channelData)
      ) {
        const noiseSeed = audioNoiseSeedByPrototype.get(prototype) ?? audioNoiseSeed;
        channelData[0] = channelData[0] + noiseSeed;
        patchedChannelData.add(channelData);
      }
      return channelData;
    };
    return audioBuffer;
  };
  const originalStartRenderingFn = originalStartRendering as (...args: unknown[]) => unknown;
  prototype.startRendering = function (...args: unknown[]) {
    const renderingResult = originalStartRenderingFn.apply(this, args);
    if (renderingResult && typeof (renderingResult as Promise<unknown>).then === "function") {
      return (renderingResult as Promise<unknown>).then((audioBuffer) =>
        patchAudioBuffer(audioBuffer)
      );
    }
    return patchAudioBuffer(renderingResult);
  };
  patchedAudioContextPrototypes.add(prototype);
};

const installBatteryPatch = (context: FingerprintPatchInstallContext): void => {
  if (!context.bundle || !context.requiredPatches.has("battery")) {
    return;
  }

  const battery = asRecord(context.bundle.battery);
  const level = asNumber(battery?.level);
  const charging = typeof battery?.charging === "boolean" ? battery.charging : null;
  if (charging === null || level === null) {
    return;
  }

  (window.navigator as Navigator & { getBattery?: () => Promise<unknown> }).getBattery = () =>
    Promise.resolve({
      charging,
      level,
      chargingTime: charging ? 0 : Infinity,
      dischargingTime: charging ? Infinity : 3600,
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return true;
      }
    });
  context.appliedPatches.push("battery");
};

const installNavigatorPluginsPatch = (context: FingerprintPatchInstallContext): void => {
  if (!context.requiredPatches.has("navigator_plugins")) {
    return;
  }

  defineGetter(window.navigator, "plugins", () => context.pluginAndMimeTypes.plugins);
  context.appliedPatches.push("navigator_plugins");
};

const installNavigatorMimeTypesPatch = (context: FingerprintPatchInstallContext): void => {
  if (!context.requiredPatches.has("navigator_mime_types")) {
    return;
  }

  defineGetter(window.navigator, "mimeTypes", () => context.pluginAndMimeTypes.mimeTypes);
  context.appliedPatches.push("navigator_mime_types");
};

const installFingerprintRuntime = (runtime: RecordValue | null): RecordValue => {
  const bundle = asRecord(runtime?.fingerprint_profile_bundle ?? null);
  const requiredPatches = asStringArray(
    asRecord(runtime?.fingerprint_patch_manifest ?? null)?.required_patches
  );
  const requiredPatchNames = new Set(requiredPatches);
  const appliedPatches: string[] = [];
  const pluginAndMimeTypes = createPluginAndMimeTypeArrays();
  const context: FingerprintPatchInstallContext = {
    bundle,
    requiredPatches: requiredPatchNames,
    appliedPatches,
    pluginAndMimeTypes
  };

  installAudioContextPatch(context);
  installBatteryPatch(context);
  installNavigatorPluginsPatch(context);
  installNavigatorMimeTypesPatch(context);

  const missingRequiredPatches = requiredPatches.filter(
    (patchName) => !appliedPatches.includes(patchName)
  );

  return {
    installed: missingRequiredPatches.length === 0,
    applied_patches: appliedPatches,
    required_patches: requiredPatches,
    missing_required_patches: missingRequiredPatches,
    source: typeof runtime?.source === "string" ? runtime.source : "unknown"
  };
};

const parseMainWorldRequest = (event: Event): MainWorldRequest | null => {
  const detail = asRecord((event as CustomEvent<unknown>).detail);
  if (!detail) {
    return null;
  }
  const id = asString(detail.id);
  const type = detail.type;
  if (
    !id ||
    (type !== "fingerprint-install" &&
      type !== "fingerprint-verify" &&
      type !== "page-state-read")
  ) {
    return null;
  }
  return {
    id,
    type,
    payload: asRecord(detail.payload) ?? {}
  };
};

const emitMainWorldResult = async (result: MainWorldResult): Promise<void> => {
  if (!activeMainWorldEventChannel) {
    return;
  }
  await emitResult(activeMainWorldEventChannel.resultEvent, result);
};

const buildMainWorldVerifyResult = (): RecordValue => {
  const hasGetBattery =
    typeof (window.navigator as Navigator & { getBattery?: unknown }).getBattery === "function";
  return {
    has_get_battery: hasGetBattery,
    plugins_length:
      typeof window.navigator.plugins?.length === "number" ? window.navigator.plugins.length : null,
    mime_types_length:
      typeof window.navigator.mimeTypes?.length === "number" ? window.navigator.mimeTypes.length : null
  };
};

const handleFingerprintVerifyRequest = async (request: MainWorldRequest): Promise<void> => {
  await emitMainWorldResult({
    id: request.id,
    ok: true,
    result: buildMainWorldVerifyResult()
  });
};

const handlePageStateReadRequest = async (request: MainWorldRequest): Promise<void> => {
  const initialState = asRecord((window as Window & { __INITIAL_STATE__?: unknown }).__INITIAL_STATE__);
  await emitMainWorldResult({
    id: request.id,
    ok: true,
    result: initialState ?? null
  });
};

const handleFingerprintInstallRequest = async (request: MainWorldRequest): Promise<void> => {
  const runtime = asRecord(request.payload.fingerprint_runtime ?? null);
  const result = installFingerprintRuntime(runtime);
  await emitMainWorldResult({
    id: request.id,
    ok: true,
    result
  });
};

const handleRequest = async (request: MainWorldRequest): Promise<void> => {
  if (request.type === "fingerprint-verify") {
    await handleFingerprintVerifyRequest(request);
    return;
  }
  if (request.type === "page-state-read") {
    await handlePageStateReadRequest(request);
    return;
  }
  await handleFingerprintInstallRequest(request);
};

const isValidChannelEventName = (value: string, prefix: string): boolean =>
  value.startsWith(prefix) && /^[A-Za-z0-9_.:-]+$/.test(value) && value.length <= 128;

const attachMainWorldEventChannelIfValid = (requestEvent: unknown, resultEvent: unknown): boolean => {
  if (typeof requestEvent !== "string" || typeof resultEvent !== "string") {
    return false;
  }
  if (!isValidChannelEventName(requestEvent, MAIN_WORLD_EVENT_REQUEST_PREFIX)) {
    return false;
  }
  if (!isValidChannelEventName(resultEvent, MAIN_WORLD_EVENT_RESULT_PREFIX)) {
    return false;
  }
  attachMainWorldEventChannel({
    requestEvent,
    resultEvent
  });
  return true;
};

const resolveExpectedMainWorldEventChannel = (): MainWorldEventChannel | null => {
  const requestEvent =
    typeof EXPECTED_MAIN_WORLD_REQUEST_EVENT === "string"
      ? EXPECTED_MAIN_WORLD_REQUEST_EVENT
      : null;
  const resultEvent =
    typeof EXPECTED_MAIN_WORLD_RESULT_EVENT === "string"
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

const resolveBootstrappedMainWorldEventChannel = (event: Event): MainWorldEventChannel | null => {
  const detail = asRecord((event as CustomEvent<unknown>).detail);
  const requestEvent = asString(detail?.request_event);
  const resultEvent = asString(detail?.result_event);
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

const attachMainWorldEventChannel = (channel: MainWorldEventChannel): void => {
  if (activeMainWorldEventChannel) {
    if (
      activeMainWorldEventChannel.requestEvent === channel.requestEvent &&
      activeMainWorldEventChannel.resultEvent === channel.resultEvent
    ) {
      return;
    }
    if (activeMainWorldRequestListener) {
      window.removeEventListener(
        activeMainWorldEventChannel.requestEvent,
        activeMainWorldRequestListener as EventListener
      );
    }
    activeMainWorldEventChannel = null;
    activeMainWorldRequestListener = null;
  }
  activeMainWorldEventChannel = channel;
  activeMainWorldRequestListener = (event: Event) => {
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
  window.addEventListener(channel.requestEvent, activeMainWorldRequestListener as EventListener);
};

const ensureBootstrapListener = (): void => {
  if (activeMainWorldBootstrapListener || typeof window.addEventListener !== "function") {
    return;
  }
  activeMainWorldBootstrapListener = (event: Event) => {
    const channel = resolveBootstrappedMainWorldEventChannel(event);
    if (!channel) {
      return;
    }
    attachMainWorldEventChannel(channel);
  };
  window.addEventListener(
    MAIN_WORLD_EVENT_BOOTSTRAP,
    activeMainWorldBootstrapListener as EventListener
  );
};

const expectedMainWorldEventChannel = resolveExpectedMainWorldEventChannel();
if (expectedMainWorldEventChannel) {
  attachMainWorldEventChannel(expectedMainWorldEventChannel);
} else {
  ensureBootstrapListener();
}
