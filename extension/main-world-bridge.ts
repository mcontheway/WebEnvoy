import {
  SEARCH_ENDPOINT,
  WEBENVOY_SYNTHETIC_REQUEST_HEADER,
  createPageContextNamespace,
  createSearchRequestShape,
  createVisitedPageContextNamespace,
  resolveActiveVisitedPageContextNamespace,
  type CapturedRequestContextArtifact,
  type CapturedRequestContextCommand,
  type CapturedRequestContextLookupResult,
  type CapturedRequestContextMethod,
  type PageContextNamespace
} from "./xhs-search-types.js";

type RecordValue = Record<string, unknown>;

type MainWorldRequestType =
  | "fingerprint-install"
  | "fingerprint-verify"
  | "page-state-read"
  | "captured-request-context-read";

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
  error_name?: string;
  error_code?: string;
};

type MainWorldWindow = Window & typeof globalThis;

type MainWorldEventChannel = {
  requestEvent: string;
  resultEvent: string;
  namespaceEvent: string | null;
};

type FingerprintPatchInstallContext = {
  bundle: RecordValue | null;
  requiredPatches: Set<string>;
  appliedPatches: string[];
  pluginAndMimeTypes: ReturnType<typeof createPluginAndMimeTypeArrays>;
};

type CapturedRequestCandidate = {
  transport: "fetch";
  method: CapturedRequestContextMethod;
  path: typeof SEARCH_ENDPOINT;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  synthetic: boolean;
  pageContextNamespace: PageContextNamespace;
  referrer: string | null;
};

type CapturedContextShape = {
  routeScope: {
    command: CapturedRequestContextCommand;
    method: CapturedRequestContextMethod;
    pathname: typeof SEARCH_ENDPOINT;
  };
  routeScopeKey: string;
  shape: CapturedRequestContextArtifact["shape"];
  shapeKey: string;
};

type CapturedContextBucket = {
  admittedTemplate: CapturedRequestContextArtifact | null;
  rejectedObservation: CapturedRequestContextArtifact | null;
};

type CapturedContextNamespaceBuckets = Map<string, Map<string, CapturedContextBucket>>;

const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
declare const EXPECTED_MAIN_WORLD_REQUEST_EVENT: string | undefined;
declare const EXPECTED_MAIN_WORLD_RESULT_EVENT: string | undefined;
declare const EXPECTED_MAIN_WORLD_NAMESPACE_EVENT: string | undefined;
let activeMainWorldEventChannel: MainWorldEventChannel | null = null;
let activeMainWorldRequestListener: ((event: Event) => void) | null = null;
let activeMainWorldBootstrapListener: ((event: Event) => void) | null = null;
const patchedAudioContextPrototypes = new WeakSet<object>();
const audioNoiseSeedByPrototype = new WeakMap<object, number>();
const capturedRequestContextBucketsByNamespace = new Map<
  PageContextNamespace,
  CapturedContextNamespaceBuckets
>();
const capturedRequestContextIncompatibleByNamespace = new Map<
  PageContextNamespace,
  Map<string, CapturedRequestContextArtifact>
>();
const FETCH_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.fetch.v1");
const PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL = Symbol.for(
  "webenvoy.main_world.page_context_navigation.v1"
);
const SYNTHETIC_REQUEST_SYMBOL = Symbol.for("webenvoy.main_world.synthetic_request.v1");
let capturedRequestContextCaptureInstalled = false;
let pageContextVisitSequence = 0;
let lastObservedPageContextHref =
  typeof window.location?.href === "string" ? window.location.href : "about:blank";

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

const normalizeCapturedRequestMethod = (value: unknown): CapturedRequestContextMethod | null => {
  if (typeof value !== "string") {
    return null;
  }
  return value.trim().toUpperCase() === "POST" ? "POST" : null;
};

const normalizeHeaderName = (value: string): string => value.trim().toLowerCase();

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
};

const toTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const createCapturedContextRouteScope = (
  command: CapturedRequestContextCommand,
  method: CapturedRequestContextMethod,
  pathname: typeof SEARCH_ENDPOINT
): CapturedContextShape["routeScope"] => ({
  command,
  method,
  pathname
});

const serializeCapturedContextRouteScope = (
  scope: CapturedContextShape["routeScope"]
): string => JSON.stringify(scope);

const parseSearchShape = (value: unknown): CapturedContextShape | null => {
  const shape = createSearchRequestShape(
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as {
          keyword: unknown;
          page?: unknown;
          page_size?: unknown;
          limit?: unknown;
          sort?: unknown;
          note_type?: unknown;
        })
      : { keyword: null }
  );
  if (!shape) {
    return null;
  }
  const routeScope = createCapturedContextRouteScope("xhs.search", "POST", SEARCH_ENDPOINT);
  return {
    routeScope,
    routeScopeKey: serializeCapturedContextRouteScope(routeScope),
    shape,
    shapeKey: JSON.stringify(shape)
  };
};

const getCapturedContextNamespaceBuckets = (
  namespace: PageContextNamespace
): CapturedContextNamespaceBuckets => {
  let namespaceBuckets = capturedRequestContextBucketsByNamespace.get(namespace);
  if (!namespaceBuckets) {
    namespaceBuckets = new Map<string, Map<string, CapturedContextBucket>>();
    capturedRequestContextBucketsByNamespace.set(namespace, namespaceBuckets);
  }
  return namespaceBuckets;
};

const getCapturedContextRouteBucket = (
  namespace: PageContextNamespace,
  routeScopeKey: string
): Map<string, CapturedContextBucket> => {
  const namespaceBuckets = getCapturedContextNamespaceBuckets(namespace);
  let routeBucket = namespaceBuckets.get(routeScopeKey);
  if (!routeBucket) {
    routeBucket = new Map<string, CapturedContextBucket>();
    namespaceBuckets.set(routeScopeKey, routeBucket);
  }
  return routeBucket;
};

const getCapturedContextBucket = (
  namespace: PageContextNamespace,
  routeScopeKey: string,
  shapeKey: string
): CapturedContextBucket => {
  const routeBucket = getCapturedContextRouteBucket(namespace, routeScopeKey);
  let bucket = routeBucket.get(shapeKey);
  if (!bucket) {
    bucket = {
      admittedTemplate: null,
      rejectedObservation: null
    };
    routeBucket.set(shapeKey, bucket);
  }
  return bucket;
};

const setRouteBucketIncompatibleObservation = (
  namespace: PageContextNamespace,
  routeScopeKey: string,
  artifact: CapturedRequestContextArtifact | null
): void => {
  let routeIncompatible = capturedRequestContextIncompatibleByNamespace.get(namespace);
  if (!routeIncompatible) {
    routeIncompatible = new Map<string, CapturedRequestContextArtifact>();
    capturedRequestContextIncompatibleByNamespace.set(namespace, routeIncompatible);
  }
  if (artifact) {
    routeIncompatible.set(routeScopeKey, artifact);
    return;
  }
  routeIncompatible.delete(routeScopeKey);
  if (routeIncompatible.size === 0) {
    capturedRequestContextIncompatibleByNamespace.delete(namespace);
  }
};

const getRouteBucketIncompatibleObservation = (
  namespace: PageContextNamespace,
  routeScopeKey: string
): CapturedRequestContextArtifact | null =>
  capturedRequestContextIncompatibleByNamespace.get(namespace)?.get(routeScopeKey) ?? null;

const parseArtifactPayloadText = (text: string): unknown => {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const readBodyText = async (body: unknown): Promise<string | null> => {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  if (typeof URLSearchParams === "function" && body instanceof URLSearchParams) {
    return body.toString();
  }
  if (typeof Blob === "function" && body instanceof Blob) {
    return await body.text();
  }
  if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(body));
  }
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  return String(body);
};

const readArtifactPayload = async (body: unknown): Promise<unknown> => {
  const text = await readBodyText(body);
  return text === null ? null : parseArtifactPayloadText(text);
};

const headersToRecord = (headers: unknown): Record<string, string> => {
  const record: Record<string, string> = {};
  const assignHeader = (name: string, value: unknown): void => {
    if (typeof name !== "string" || typeof value !== "string") {
      return;
    }
    const normalizedName = normalizeHeaderName(name);
    if (normalizedName.length > 0) {
      record[normalizedName] = value;
    }
  };
  if (typeof headers === "string") {
    for (const line of headers.split(/\r?\n/)) {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex > 0) {
        assignHeader(line.slice(0, separatorIndex), line.slice(separatorIndex + 1).trim());
      }
    }
    return record;
  }
  if (typeof Headers === "function" && headers instanceof Headers) {
    headers.forEach((value, name) => {
      assignHeader(name, value);
    });
    return record;
  }
  if (Array.isArray(headers)) {
    for (const entry of headers) {
      if (Array.isArray(entry) && entry.length >= 2) {
        assignHeader(String(entry[0]), String(entry[1]));
      }
    }
    return record;
  }
  const headerRecord = asRecord(headers);
  if (!headerRecord) {
    return record;
  }
  for (const [name, value] of Object.entries(headerRecord)) {
    assignHeader(name, String(value));
  }
  return record;
};

const mergeHeaders = (base: Record<string, string>, extra: Record<string, string>): Record<string, string> => ({
  ...base,
  ...extra
});

const isRequestLike = (
  value: unknown
): value is {
  url: string;
  method?: string;
  headers?: unknown;
  clone?: () => { text: () => Promise<string> };
} => typeof value === "object" && value !== null && typeof (value as { url?: unknown }).url === "string";

const resolveAbsoluteUrl = (value: string): string | null => {
  try {
    const baseHref =
      typeof window.location?.href === "string" && window.location.href.length > 0
        ? window.location.href
        : "https://www.xiaohongshu.com/";
    return new URL(value, baseHref).toString();
  } catch {
    return null;
  }
};

const resolvePathname = (value: string): string | null => {
  try {
    const pathname = new URL(value).pathname;
    return pathname === SEARCH_ENDPOINT ? pathname : null;
  } catch {
    return null;
  }
};

const isSearchResultPage = (href: string): boolean => {
  try {
    const url = new URL(href, "https://www.xiaohongshu.com/");
    return url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result");
  } catch {
    return false;
  }
};

const resolveCurrentPageCaptureContext = (): {
  pageContextNamespace: PageContextNamespace;
  referrer: string | null;
} => {
  const href = typeof window.location?.href === "string" ? window.location.href : "about:blank";
  return {
    pageContextNamespace: createVisitedPageContextNamespace(href, pageContextVisitSequence),
    referrer: href
  };
};

const emitCurrentPageContextNamespace = (): void => {
  const namespaceEvent = activeMainWorldEventChannel?.namespaceEvent;
  if (!namespaceEvent || typeof mainWindow.dispatchEvent !== "function") {
    return;
  }
  const { pageContextNamespace, referrer } = resolveCurrentPageCaptureContext();
  mainWindow.dispatchEvent(
    createWindowEvent(namespaceEvent, {
      page_context_namespace: pageContextNamespace,
      href: referrer,
      visit_sequence: pageContextVisitSequence
    })
  );
};

const isSyntheticRequest = (headers: Record<string, string>): boolean => {
  const marker = headers[WEBENVOY_SYNTHETIC_REQUEST_HEADER];
  if (typeof marker !== "string") {
    return false;
  }
  const normalized = marker.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const isSyntheticRequestInput = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  (value as Record<string | symbol, unknown>)[SYNTHETIC_REQUEST_SYMBOL] === true;

const hasCapturedRequestBusinessFailure = (body: unknown): boolean => {
  const record = asRecord(body);
  const code = record?.code;
  return typeof code === "number" && Number.isFinite(code) && code !== 0;
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

const resolveLatestBucketArtifact = (
  bucket: CapturedContextBucket
): CapturedRequestContextArtifact | null => {
  const candidates = [bucket.admittedTemplate, bucket.rejectedObservation].filter(
    (item): item is CapturedRequestContextArtifact => item !== null
  );
  if (candidates.length === 0) {
    return null;
  }
  return (
    candidates.sort(
      (left, right) =>
        (right.observed_at ?? right.captured_at) - (left.observed_at ?? left.captured_at)
    )[0] ?? null
  );
};

const isSyntheticRejectedArtifact = (
  artifact: CapturedRequestContextArtifact | null
): boolean =>
  artifact?.source_kind === "synthetic_request" ||
  artifact?.rejection_reason === "synthetic_request_rejected";

const resolveRouteScopeKeyFromLookup = (
  method: CapturedRequestContextMethod,
  path: string,
  shapeKey: string
): string | null => {
  try {
    const parsed = JSON.parse(shapeKey) as unknown;
    const record = asRecord(parsed);
    if (!record) {
      return null;
    }
    const command = record.command;
    const pathname = toTrimmedString(record.pathname);
    const shapeMethod = normalizeCapturedRequestMethod(record.method);
    if (command !== "xhs.search" || pathname !== path || shapeMethod !== method) {
      return null;
    }
    return serializeCapturedContextRouteScope(
      createCapturedContextRouteScope("xhs.search", method, SEARCH_ENDPOINT)
    );
  } catch {
    return null;
  }
};

const storeCapturedRequestContext = (
  candidate: CapturedRequestCandidate,
  input: {
    status: number;
    responseHeaders: Record<string, string>;
    responseBody: unknown;
  }
): void => {
  const templateReady =
    !candidate.synthetic &&
    input.status >= 200 &&
    input.status < 300 &&
    !hasCapturedRequestBusinessFailure(input.responseBody);
  const contextShape = parseSearchShape(candidate.body);
  if (!contextShape) {
    return;
  }

  const artifact: CapturedRequestContextArtifact = {
    source_kind: candidate.synthetic ? "synthetic_request" : "page_request",
    transport: candidate.transport,
    method: candidate.method,
    path: candidate.path,
    url: candidate.url,
    status: input.status,
    captured_at: Date.now(),
    observed_at: Date.now(),
    page_context_namespace: candidate.pageContextNamespace,
    shape_key: contextShape.shapeKey,
    shape: contextShape.shape,
    referrer: candidate.referrer,
    template_ready: templateReady,
    ...(!templateReady
      ? {
          rejection_reason: candidate.synthetic
            ? ("synthetic_request_rejected" as const)
            : ("failed_request_rejected" as const)
        }
      : {}),
    request_status: {
      completion: templateReady ? "completed" : "failed",
      http_status: input.status > 0 ? input.status : null
    },
    request: {
      headers: candidate.headers,
      body: candidate.body
    },
    response: {
      headers: input.responseHeaders,
      body: input.responseBody
    }
  };

  const bucket = getCapturedContextBucket(
    candidate.pageContextNamespace,
    contextShape.routeScopeKey,
    contextShape.shapeKey
  );
  if (templateReady) {
    setRouteBucketIncompatibleObservation(
      candidate.pageContextNamespace,
      contextShape.routeScopeKey,
      null
    );
    if (isSyntheticRejectedArtifact(bucket.rejectedObservation)) {
      bucket.rejectedObservation = null;
    }
    bucket.admittedTemplate = artifact;
    return;
  }

  const routeBucket = getCapturedContextRouteBucket(
    candidate.pageContextNamespace,
    contextShape.routeScopeKey
  );
  const incompatibleObservation = resolveLatestBucketArtifact(bucket);
  const latestSiblingAdmitted = [...routeBucket.entries()]
    .filter(([shapeKey]) => shapeKey !== contextShape.shapeKey)
    .map(([, siblingBucket]) => siblingBucket.admittedTemplate)
    .filter((entry): entry is CapturedRequestContextArtifact => entry !== null)
    .sort(
      (left, right) =>
        (right.observed_at ?? right.captured_at) - (left.observed_at ?? left.captured_at)
    )[0] ?? null;
  if (latestSiblingAdmitted) {
    setRouteBucketIncompatibleObservation(
      candidate.pageContextNamespace,
      contextShape.routeScopeKey,
      {
        ...latestSiblingAdmitted,
        incompatibility_reason: "shape_mismatch"
      }
    );
  } else if (!incompatibleObservation) {
    setRouteBucketIncompatibleObservation(
      candidate.pageContextNamespace,
      contextShape.routeScopeKey,
      null
    );
  }
  if (artifact.rejection_reason === "failed_request_rejected") {
    bucket.admittedTemplate = null;
  }
  bucket.rejectedObservation = artifact;
};

const resolveFetchCandidate = async (
  input: unknown,
  init?: RequestInit
): Promise<CapturedRequestCandidate | null> => {
  if (!isSearchResultPage(typeof window.location?.href === "string" ? window.location.href : "")) {
    return null;
  }
  const baseHeaders = isRequestLike(input) ? headersToRecord(input.headers) : {};
  const initHeaders = headersToRecord(init?.headers);
  const headers = mergeHeaders(baseHeaders, initHeaders);
  const method = normalizeCapturedRequestMethod(
    init?.method ?? (isRequestLike(input) ? input.method : "POST")
  );
  if (!method) {
    return null;
  }
  const inputUrl =
    typeof input === "string"
      ? input
      : typeof URL !== "undefined" && input instanceof URL
        ? input.toString()
        : isRequestLike(input)
          ? input.url
          : null;
  if (!inputUrl) {
    return null;
  }
  const url = resolveAbsoluteUrl(inputUrl);
  const path = url ? resolvePathname(url) : null;
  if (!url || path !== SEARCH_ENDPOINT) {
    return null;
  }
  const bodySource =
    init?.body !== undefined
      ? init.body
      : isRequestLike(input) && typeof input.clone === "function"
        ? await input.clone().text().catch(() => null)
        : null;
  const body = await readArtifactPayload(bodySource);
  const pageCaptureContext = resolveCurrentPageCaptureContext();
  return {
    transport: "fetch",
    method,
    path,
    url,
    headers,
    body,
    synthetic: isSyntheticRequest(headers) || isSyntheticRequestInput(input),
    pageContextNamespace: pageCaptureContext.pageContextNamespace,
    referrer: pageCaptureContext.referrer
  };
};

const captureFetchResponse = async (
  candidate: CapturedRequestCandidate,
  response: Response
): Promise<void> => {
  const clone = response.clone();
  const responseText = await clone.text();
  storeCapturedRequestContext(candidate, {
    status: response.status,
    responseHeaders: headersToRecord(clone.headers),
    responseBody: parseArtifactPayloadText(responseText)
  });
};

const captureFetchFailure = (candidate: CapturedRequestCandidate, error: unknown): void => {
  storeCapturedRequestContext(candidate, {
    status: 0,
    responseHeaders: {},
    responseBody: {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message
            }
          : {
              message: String(error)
            }
    }
  });
};

const installFetchCapture = (): void => {
  const originalFetch = window.fetch;
  if (typeof originalFetch !== "function") {
    return;
  }
  const existingPatched = originalFetch as typeof fetch & {
    [FETCH_CAPTURE_PATCH_SYMBOL]?: boolean;
  };
  if (existingPatched[FETCH_CAPTURE_PATCH_SYMBOL] === true) {
    return;
  }

  const patchedFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const candidate = await resolveFetchCandidate(input, init);
    try {
      const response = await originalFetch.call(window, input, init);
      if (candidate) {
        void captureFetchResponse(candidate, response).catch(() => {});
      }
      return response;
    } catch (error) {
      if (candidate) {
        captureFetchFailure(candidate, error);
      }
      throw error;
    }
  };
  Object.defineProperty(patchedFetch, FETCH_CAPTURE_PATCH_SYMBOL, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
  window.fetch = patchedFetch;
};

const installCapturedRequestContextCapture = (): void => {
  if (capturedRequestContextCaptureInstalled) {
    return;
  }
  installFetchCapture();
  capturedRequestContextCaptureInstalled = true;
};

const refreshPageContextLifecycle = (options?: { advanceVisit?: boolean }): void => {
  if (options?.advanceVisit === true) {
    pageContextVisitSequence += 1;
  }
  if (isSearchResultPage(typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "")) {
    installCapturedRequestContextCapture();
  }
  emitCurrentPageContextNamespace();
};

const refreshPageContextLifecycleForHistoryMutation = (): void => {
  const currentHref =
    typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
  if (currentHref === lastObservedPageContextHref) {
    if (isSearchResultPage(currentHref)) {
      installCapturedRequestContextCapture();
      emitCurrentPageContextNamespace();
    }
    return;
  }
  lastObservedPageContextHref = currentHref;
  refreshPageContextLifecycle({ advanceVisit: true });
};

const installPageContextNavigationTracking = (): void => {
  if (typeof mainWindow.addEventListener === "function") {
    mainWindow.addEventListener("popstate", () => {
      lastObservedPageContextHref =
        typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
      refreshPageContextLifecycle({ advanceVisit: true });
    });
    mainWindow.addEventListener("hashchange", () => {
      lastObservedPageContextHref =
        typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
      refreshPageContextLifecycle({ advanceVisit: true });
    });
    mainWindow.addEventListener("pageshow", (event: Event) => {
      const pageTransitionEvent = event as PageTransitionEvent;
      if (pageTransitionEvent.persisted === true) {
        lastObservedPageContextHref =
          typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
        refreshPageContextLifecycle({ advanceVisit: true });
      }
    });
  }

  const history = mainWindow.history as
    | (History & { [PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL]?: boolean })
    | undefined;
  if (history && history[PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL] !== true) {
    const patchStateMethod = (methodName: "pushState" | "replaceState"): void => {
      const original = history[methodName];
      if (typeof original !== "function") {
        return;
      }
      history[methodName] = function patchedHistoryState(
        this: History,
        ...args: Parameters<History["pushState"]>
      ): void {
        original.apply(this, args);
        refreshPageContextLifecycleForHistoryMutation();
      };
    };
    patchStateMethod("pushState");
    patchStateMethod("replaceState");
    history[PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL] = true;
  }

  refreshPageContextLifecycle();
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
      type !== "page-state-read" &&
      type !== "captured-request-context-read")
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

const resolveIncompatibleObservation = (
  routeBucket: Map<string, CapturedContextBucket>,
  requestedShapeKey: string
): CapturedRequestContextArtifact | null => {
  let latest: CapturedRequestContextArtifact | null = null;
  for (const [shapeKey, bucket] of routeBucket.entries()) {
    if (shapeKey === requestedShapeKey || !bucket.admittedTemplate) {
      continue;
    }
    const candidate = bucket.admittedTemplate;
    const candidateObservedAt = candidate.observed_at ?? candidate.captured_at;
    if (!latest || candidateObservedAt > (latest.observed_at ?? latest.captured_at)) {
      latest = candidate;
    }
  }
  return latest
    ? {
        ...latest,
        incompatibility_reason: "shape_mismatch"
      }
    : null;
};

const handleCapturedRequestContextReadRequest = async (request: MainWorldRequest): Promise<void> => {
  const method = normalizeCapturedRequestMethod(request.payload.method);
  const path = asString(request.payload.path);
  const currentPageCaptureContext = resolveCurrentPageCaptureContext();
  const namespace = resolveActiveVisitedPageContextNamespace(
    asString(request.payload.page_context_namespace) as PageContextNamespace | null,
    currentPageCaptureContext.pageContextNamespace
  );
  const shapeKey = asString(request.payload.shape_key);
  const routeScopeKey =
    method && path && shapeKey ? resolveRouteScopeKeyFromLookup(method, path, shapeKey) : null;
  const result: CapturedRequestContextLookupResult | null =
    method && path && namespace && shapeKey && routeScopeKey
      ? (() => {
          const namespaceBuckets = capturedRequestContextBucketsByNamespace.get(namespace);
          const routeBucket = namespaceBuckets?.get(routeScopeKey) ?? null;
          const exactBucket = routeBucket?.get(shapeKey) ?? null;
          return {
            page_context_namespace: namespace,
            shape_key: shapeKey,
            admitted_template:
              exactBucket?.admittedTemplate &&
              exactBucket.admittedTemplate.method === method &&
              exactBucket.admittedTemplate.path === path
                ? exactBucket.admittedTemplate
                : null,
            rejected_observation:
              exactBucket?.rejectedObservation &&
              exactBucket.rejectedObservation.method === method &&
              exactBucket.rejectedObservation.path === path
                ? exactBucket.rejectedObservation
                : null,
            incompatible_observation:
              getRouteBucketIncompatibleObservation(namespace, routeScopeKey) ??
              (routeBucket ? resolveIncompatibleObservation(routeBucket, shapeKey) : null),
            available_shape_keys: routeBucket ? [...routeBucket.keys()] : []
          };
        })()
      : null;
  await emitMainWorldResult({
    id: request.id,
    ok: true,
    result
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
  if (request.type === "captured-request-context-read") {
    await handleCapturedRequestContextReadRequest(request);
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
    resultEvent,
    namespaceEvent: null
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
  const namespaceEvent =
    typeof EXPECTED_MAIN_WORLD_NAMESPACE_EVENT === "string"
      ? EXPECTED_MAIN_WORLD_NAMESPACE_EVENT
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
    resultEvent,
    namespaceEvent:
      namespaceEvent && isValidChannelEventName(namespaceEvent, "__mw_ns__")
        ? namespaceEvent
        : null
  };
};

const resolveBootstrappedMainWorldEventChannel = (event: Event): MainWorldEventChannel | null => {
  const detail = asRecord((event as CustomEvent<unknown>).detail);
  const requestEvent = asString(detail?.request_event);
  const resultEvent = asString(detail?.result_event);
  const namespaceEvent = asString(detail?.namespace_event);
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
    resultEvent,
    namespaceEvent:
      namespaceEvent && isValidChannelEventName(namespaceEvent, "__mw_ns__")
        ? namespaceEvent
        : null
  };
};

const attachMainWorldEventChannel = (channel: MainWorldEventChannel): void => {
  if (activeMainWorldEventChannel) {
    if (
      activeMainWorldEventChannel.requestEvent === channel.requestEvent &&
      activeMainWorldEventChannel.resultEvent === channel.resultEvent &&
      activeMainWorldEventChannel.namespaceEvent === channel.namespaceEvent
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
      const errorName =
        typeof error === "object" && error !== null && "name" in error
          ? String((error as { name?: unknown }).name)
          : undefined;
      const errorCode =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : undefined;
      await emitResult(activeMainWorldEventChannel.resultEvent, {
        id: request.id,
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        ...(errorName ? { error_name: errorName } : {}),
        ...(errorCode ? { error_code: errorCode } : {})
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
installPageContextNavigationTracking();
if (expectedMainWorldEventChannel) {
  attachMainWorldEventChannel(expectedMainWorldEventChannel);
} else {
  ensureBootstrapListener();
}
