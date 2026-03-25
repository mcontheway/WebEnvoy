type RecordValue = Record<string, unknown>;

type MainWorldRequestType = "xhs-sign" | "fingerprint-install";

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

type MainWorldWindow = Window &
  typeof globalThis & {
    _webmsxyw?: (uri: string, body: unknown) => unknown;
  };

const MAIN_WORLD_REQUEST_EVENT = "__webenvoy_main_world_request__";
const MAIN_WORLD_RESULT_EVENT = "__webenvoy_main_world_result__";
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

const emitResult = (result: MainWorldResult): void => {
  window.dispatchEvent(
    new CustomEvent(MAIN_WORLD_RESULT_EVENT, {
      detail: result
    })
  );
};

const defineGetter = (target: object, property: string, getter: () => unknown): void => {
  Object.defineProperty(target, property, {
    configurable: true,
    get: getter
  });
};

const createPluginAndMimeTypeArrays = () => {
  const pluginByName = new Map<string, any>();
  const plugins = DEFAULT_PLUGIN_DESCRIPTORS.map((descriptor) => {
    const plugin: any = {
      name: descriptor.name,
      filename: descriptor.filename,
      description: descriptor.description,
      length: 0
    };
    plugin.item = (index: number) => plugin[index] ?? null;
    plugin.namedItem = (name: unknown) => {
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
  (plugins as any).item = (index: number) => plugins[index] ?? null;
  (plugins as any).namedItem = (name: string) =>
    plugins.find((plugin) => plugin.name === name) ?? null;
  (plugins as any).refresh = () => undefined;

  const mimeTypes = DEFAULT_MIME_TYPE_DESCRIPTORS.map((descriptor) => {
    const linkedPlugin = pluginByName.get(descriptor.enabledPlugin) ?? plugins[0] ?? null;
    const mimeType: any = {
      type: descriptor.type,
      suffixes: descriptor.suffixes,
      description: descriptor.description,
      enabledPlugin: linkedPlugin
    };
    if (linkedPlugin) {
      const nextIndex = typeof linkedPlugin.length === "number" ? linkedPlugin.length : 0;
      linkedPlugin[nextIndex] = mimeType;
      linkedPlugin.length = nextIndex + 1;
    }
    return mimeType;
  });
  (mimeTypes as any).item = (index: number) => mimeTypes[index] ?? null;
  (mimeTypes as any).namedItem = (name: string) =>
    mimeTypes.find((mimeType) => mimeType.type === name) ?? null;
  return {
    plugins,
    mimeTypes
  };
};

const installFingerprintRuntime = (runtime: RecordValue | null): RecordValue => {
  const bundle = asRecord(runtime?.fingerprint_profile_bundle ?? null);
  const requiredPatches = asStringArray(
    asRecord(runtime?.fingerprint_patch_manifest ?? null)?.required_patches
  );
  const patchNameSet = new Set(requiredPatches);
  const appliedPatches: string[] = [];
  const missingRequiredPatches: string[] = [];
  const pluginAndMimeTypes = createPluginAndMimeTypeArrays();

  if (bundle && patchNameSet.has("audio_context")) {
    const audioNoiseSeed = asNumber(bundle.audioNoiseSeed);
    const webkitOfflineAudioContextCtor = (
      window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext }
    ).webkitOfflineAudioContext;
    const OfflineCtor =
      typeof window.OfflineAudioContext === "function"
        ? window.OfflineAudioContext
        : typeof webkitOfflineAudioContextCtor === "function"
          ? webkitOfflineAudioContextCtor
          : null;
    if (audioNoiseSeed !== null && OfflineCtor) {
      const prototype = OfflineCtor.prototype as object & {
        startRendering?: (...args: unknown[]) => unknown;
      };
      const originalStartRendering = prototype.startRendering;
      if (typeof originalStartRendering === "function") {
        audioNoiseSeedByPrototype.set(prototype, audioNoiseSeed);
        if (patchedAudioContextPrototypes.has(prototype)) {
          appliedPatches.push("audio_context");
        } else {
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

const parseMainWorldRequest = (event: Event): MainWorldRequest | null => {
  const detail = asRecord((event as CustomEvent<unknown>).detail);
  if (!detail) {
    return null;
  }
  const id = asString(detail.id);
  const type = detail.type;
  if (!id || (type !== "xhs-sign" && type !== "fingerprint-install")) {
    return null;
  }
  return {
    id,
    type,
    payload: asRecord(detail.payload) ?? {}
  };
};

const handleRequest = (request: MainWorldRequest): void => {
  if (request.type === "xhs-sign") {
    const signatureFn = mainWindow._webmsxyw;
    if (typeof signatureFn !== "function") {
      emitResult({
        id: request.id,
        ok: false,
        message: "window._webmsxyw is not available"
      });
      return;
    }
    const uri = asString(request.payload.uri);
    if (!uri) {
      emitResult({
        id: request.id,
        ok: false,
        message: "xhs-sign requires uri"
      });
      return;
    }
    const result = signatureFn(uri, request.payload.body);
    emitResult({
      id: request.id,
      ok: true,
      result
    });
    return;
  }

  const runtime = asRecord(request.payload.fingerprint_runtime ?? null);
  const result = installFingerprintRuntime(runtime);
  emitResult({
    id: request.id,
    ok: true,
    result
  });
};

window.addEventListener(MAIN_WORLD_REQUEST_EVENT, (event: Event) => {
  const request = parseMainWorldRequest(event);
  if (!request) {
    return;
  }
  try {
    handleRequest(request);
  } catch (error) {
    emitResult({
      id: request.id,
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
});
