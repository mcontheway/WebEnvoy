(() => {
/* WebEnvoy classic main-world bridge bundle for Chrome MV3 content_scripts. */

const __webenvoy_module_xhs_search_types = (() => {
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";
const WEBENVOY_SYNTHETIC_REQUEST_HEADER = "x-webenvoy-synthetic-request";
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX = "__mw_ns__";
const hashMainWorldEventChannel = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const toTrimmedString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const normalizeSearchRequestShapeInput = (input) => {
    const keyword = toTrimmedString(input.keyword);
    const page = input.page === undefined ? 1 : asInteger(input.page);
    const pageSizeInput = input.page_size !== undefined ? input.page_size : input.limit !== undefined ? input.limit : 20;
    const pageSize = asInteger(pageSizeInput);
    const sort = input.sort === undefined ? "general" : toTrimmedString(input.sort);
    const noteType = input.note_type === undefined ? 0 : asInteger(input.note_type);
    if (!keyword || page === null || pageSize === null || sort === null || noteType === null) {
        return null;
    }
    return {
        keyword,
        page,
        page_size: pageSize,
        sort,
        note_type: noteType
    };
};
const createSearchRequestShape = (input) => {
    const normalized = normalizeSearchRequestShapeInput(input);
    if (!normalized) {
        return null;
    }
    return {
        command: "xhs.search",
        method: "POST",
        pathname: SEARCH_ENDPOINT,
        ...normalized
    };
};
const serializeSearchRequestShape = (shape) => JSON.stringify(shape);
const createDetailRequestShape = (input) => {
    const noteId = toTrimmedString(input.note_id ?? input.source_note_id);
    if (!noteId) {
        return null;
    }
    return {
        command: "xhs.detail",
        method: "POST",
        pathname: DETAIL_ENDPOINT,
        note_id: noteId
    };
};
const serializeDetailRequestShape = (shape) => JSON.stringify(shape);
const createUserHomeRequestShape = (input) => {
    const userId = toTrimmedString(input.user_id);
    if (!userId) {
        return null;
    }
    return {
        command: "xhs.user_home",
        method: "GET",
        pathname: USER_HOME_ENDPOINT,
        user_id: userId
    };
};
const serializeUserHomeRequestShape = (shape) => JSON.stringify(shape);
const resolveMainWorldPageContextNamespaceEventName = (secret) => `${MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX}${hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|namespace|${secret.trim()}`)}`;
const createPageContextNamespace = (href) => {
    const normalized = href.trim();
    if (normalized.length === 0) {
        return "about:blank";
    }
    try {
        const parsed = new URL(normalized, "https://www.xiaohongshu.com/");
        const pathname = parsed.pathname.length > 0 ? parsed.pathname : "/";
        const queryIdentity = parsed.search.length > 0 ? `${pathname}${parsed.search}` : pathname;
        const documentTimeOrigin = typeof globalThis.performance?.timeOrigin === "number" &&
            Number.isFinite(globalThis.performance.timeOrigin)
            ? Math.trunc(globalThis.performance.timeOrigin)
            : null;
        return documentTimeOrigin === null
            ? `${parsed.origin}${queryIdentity}`
            : `${parsed.origin}${queryIdentity}#doc=${documentTimeOrigin}`;
    }
    catch {
        return normalized;
    }
};
const createVisitedPageContextNamespace = (href, visitSequence) => {
    const baseNamespace = createPageContextNamespace(href);
    return visitSequence > 0 ? `${baseNamespace}|visit=${visitSequence}` : baseNamespace;
};
const stripVisitedPageContextNamespace = (namespace) => {
    const visitSuffixIndex = namespace.indexOf("|visit=");
    return visitSuffixIndex >= 0 ? namespace.slice(0, visitSuffixIndex) : namespace;
};
const resolveActiveVisitedPageContextNamespace = (requestedNamespace, currentVisitedNamespace) => {
    const normalizedRequested = typeof requestedNamespace === "string" && requestedNamespace.length > 0
        ? requestedNamespace
        : null;
    const normalizedCurrentVisited = typeof currentVisitedNamespace === "string" && currentVisitedNamespace.length > 0
        ? currentVisitedNamespace
        : null;
    if (normalizedRequested &&
        normalizedCurrentVisited &&
        normalizedRequested === stripVisitedPageContextNamespace(normalizedCurrentVisited)) {
        return normalizedCurrentVisited;
    }
    return normalizedRequested ?? normalizedCurrentVisited;
};
return { DETAIL_ENDPOINT, SEARCH_ENDPOINT, USER_HOME_ENDPOINT, WEBENVOY_SYNTHETIC_REQUEST_HEADER, createPageContextNamespace, createDetailRequestShape, createSearchRequestShape, createUserHomeRequestShape, createVisitedPageContextNamespace, resolveActiveVisitedPageContextNamespace };
})();
const __webenvoy_module_main_world_bridge = (() => {
const __webenvoy_install_scope = globalThis;
const __webenvoy_install_key = Symbol.for("webenvoy.main_world.bridge.bundle.v1");
if (__webenvoy_install_scope[__webenvoy_install_key]) {
  return {};
}
Object.defineProperty(__webenvoy_install_scope, __webenvoy_install_key, {
  value: true,
  configurable: false,
  enumerable: false,
  writable: false
});
const {
  DETAIL_ENDPOINT,
  SEARCH_ENDPOINT,
  USER_HOME_ENDPOINT,
  WEBENVOY_SYNTHETIC_REQUEST_HEADER,
  createPageContextNamespace,
  createDetailRequestShape,
  createSearchRequestShape,
  createUserHomeRequestShape,
  createVisitedPageContextNamespace,
  resolveActiveVisitedPageContextNamespace
} = __webenvoy_module_xhs_search_types;
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const MAIN_WORLD_BRIDGE_SHARED_STATE_SYMBOL = Symbol.for("webenvoy.main_world.bridge.state.v1");
const FETCH_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.fetch.v1");
const XHR_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.xhr.v1");
const PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.page_context_navigation.v1");
const SYNTHETIC_REQUEST_SYMBOL = Symbol.for("webenvoy.main_world.synthetic_request.v1");
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
const resolveMainWorldBridgeSharedState = () => {
    const existing = mainWindow[MAIN_WORLD_BRIDGE_SHARED_STATE_SYMBOL];
    if (typeof existing === "object" && existing !== null) {
        return existing;
    }
    const state = {
        activeMainWorldEventChannel: null,
        activeMainWorldRequestListener: null,
        activeMainWorldBootstrapListener: null,
        patchedAudioContextPrototypes: new WeakSet(),
        audioNoiseSeedByPrototype: new WeakMap(),
        capturedRequestContextBucketsByNamespace: new Map(),
        capturedRequestContextIncompatibleByNamespace: new Map(),
        capturedRequestContextCaptureInstalled: false,
        pageContextVisitSequence: 0,
        lastObservedPageContextHref: typeof window.location?.href === "string" ? window.location.href : "about:blank"
    };
    Object.defineProperty(mainWindow, MAIN_WORLD_BRIDGE_SHARED_STATE_SYMBOL, {
        value: state,
        configurable: false,
        enumerable: false,
        writable: false
    });
    return state;
};
const mainWorldBridgeSharedState = resolveMainWorldBridgeSharedState();
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const asNumber = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const normalizeCapturedRequestMethod = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim().toUpperCase();
    return normalized === "POST" || normalized === "GET" ? normalized : null;
};
const normalizeHeaderName = (value) => value.trim().toLowerCase();
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const toTrimmedString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const createCapturedContextRouteScope = (command, method, pathname) => ({
    command,
    method,
    pathname
});
const serializeCapturedContextRouteScope = (scope) => JSON.stringify(scope);
const parseSearchShape = (value) => {
    const shape = createSearchRequestShape(typeof value === "object" && value !== null && !Array.isArray(value)
        ? value
        : { keyword: null });
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
const parseDetailShape = (value) => {
    const shape = createDetailRequestShape(asRecord(value) ?? {});
    if (!shape) {
        return null;
    }
    const routeScope = createCapturedContextRouteScope("xhs.detail", "POST", DETAIL_ENDPOINT);
    return {
        routeScope,
        routeScopeKey: serializeCapturedContextRouteScope(routeScope),
        shape,
        shapeKey: JSON.stringify(shape)
    };
};
const resolveUserIdFromUrl = (value) => {
    try {
        const url = new URL(value);
        return toTrimmedString(url.searchParams.get("user_id"));
    }
    catch {
        return null;
    }
};
const parseUserHomeShape = (input) => {
    const bodyRecord = asRecord(input.body);
    const shape = createUserHomeRequestShape({
        user_id: bodyRecord?.user_id ?? resolveUserIdFromUrl(input.url)
    });
    if (!shape) {
        return null;
    }
    const routeScope = createCapturedContextRouteScope("xhs.user_home", "GET", USER_HOME_ENDPOINT);
    return {
        routeScope,
        routeScopeKey: serializeCapturedContextRouteScope(routeScope),
        shape,
        shapeKey: JSON.stringify(shape)
    };
};
const resolveCapturedContextShape = (candidate) => {
    if (candidate.path === SEARCH_ENDPOINT) {
        return parseSearchShape(candidate.body);
    }
    if (candidate.path === DETAIL_ENDPOINT) {
        return parseDetailShape(candidate.body);
    }
    if (candidate.path === USER_HOME_ENDPOINT) {
        return parseUserHomeShape(candidate);
    }
    return null;
};
const collectNestedResponseRecords = (value, nestedKeys, seen = new Set()) => {
    const record = asRecord(value);
    if (record) {
        if (seen.has(record)) {
            return [];
        }
        seen.add(record);
        return [record, ...nestedKeys.flatMap((key) => collectNestedResponseRecords(record[key], nestedKeys, seen))];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectNestedResponseRecords(entry, nestedKeys, seen));
    }
    return [];
};
const hasDetailResponseDataShape = (record) => [
    "title",
    "desc",
    "user",
    "interact_info",
    "image_list",
    "video_info",
    "note_card",
    "note_card_list"
].some((key) => key in record);
const detailResponseContainsCanonicalNoteId = (body, expectedNoteId) => {
    const responseRecord = asRecord(body);
    const dataRecord = asRecord(responseRecord?.data ?? body);
    if (!dataRecord) {
        return false;
    }
    const candidates = [
        ...collectNestedResponseRecords(dataRecord.note, ["note", "note_card", "current_note", "item"]),
        ...collectNestedResponseRecords(dataRecord.note_card, ["note", "note_card", "current_note", "item"]),
        ...collectNestedResponseRecords(dataRecord.note_card_list, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedResponseRecords(dataRecord.current_note, ["note", "note_card", "current_note", "item"]),
        ...collectNestedResponseRecords(dataRecord.item, ["note", "note_card", "current_note", "item"]),
        ...collectNestedResponseRecords(dataRecord.items, ["note", "note_card", "current_note", "item"]),
        ...collectNestedResponseRecords(dataRecord.notes, ["note", "note_card", "current_note", "item"]),
        ...(hasDetailResponseDataShape(dataRecord) ? [dataRecord] : [])
    ];
    return candidates.some((candidate) => {
        const canonicalNoteId = asString(candidate.note_id) ?? asString(candidate.noteId);
        return canonicalNoteId === expectedNoteId;
    });
};
const getCapturedContextNamespaceBuckets = (namespace) => {
    let namespaceBuckets = mainWorldBridgeSharedState.capturedRequestContextBucketsByNamespace.get(namespace);
    if (!namespaceBuckets) {
        namespaceBuckets = new Map();
        mainWorldBridgeSharedState.capturedRequestContextBucketsByNamespace.set(namespace, namespaceBuckets);
    }
    return namespaceBuckets;
};
const getCapturedContextRouteBucket = (namespace, routeScopeKey) => {
    const namespaceBuckets = getCapturedContextNamespaceBuckets(namespace);
    let routeBucket = namespaceBuckets.get(routeScopeKey);
    if (!routeBucket) {
        routeBucket = new Map();
        namespaceBuckets.set(routeScopeKey, routeBucket);
    }
    return routeBucket;
};
const getCapturedContextBucket = (namespace, routeScopeKey, shapeKey) => {
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
const setRouteBucketIncompatibleObservation = (namespace, routeScopeKey, artifact) => {
    let routeIncompatible = mainWorldBridgeSharedState.capturedRequestContextIncompatibleByNamespace.get(namespace);
    if (!routeIncompatible) {
        routeIncompatible = new Map();
        mainWorldBridgeSharedState.capturedRequestContextIncompatibleByNamespace.set(namespace, routeIncompatible);
    }
    if (artifact) {
        routeIncompatible.set(routeScopeKey, artifact);
        return;
    }
    routeIncompatible.delete(routeScopeKey);
    if (routeIncompatible.size === 0) {
        mainWorldBridgeSharedState.capturedRequestContextIncompatibleByNamespace.delete(namespace);
    }
};
const getRouteBucketIncompatibleObservation = (namespace, routeScopeKey) => mainWorldBridgeSharedState.capturedRequestContextIncompatibleByNamespace
    .get(namespace)
    ?.get(routeScopeKey) ?? null;
const parseArtifactPayloadText = (text) => {
    if (text.length === 0) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
};
const readBodyText = async (body) => {
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
const readArtifactPayload = async (body) => {
    const text = await readBodyText(body);
    return text === null ? null : parseArtifactPayloadText(text);
};
const headersToRecord = (headers) => {
    const record = {};
    const assignHeader = (name, value) => {
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
const mergeHeaders = (base, extra) => ({
    ...base,
    ...extra
});
const isRequestLike = (value) => typeof value === "object" && value !== null && typeof value.url === "string";
const resolveAbsoluteUrl = (value) => {
    try {
        const baseHref = typeof window.location?.href === "string" && window.location.href.length > 0
            ? window.location.href
            : "https://www.xiaohongshu.com/";
        return new URL(value, baseHref).toString();
    }
    catch {
        return null;
    }
};
const resolvePathname = (value) => {
    try {
        const pathname = new URL(value).pathname;
        return pathname === SEARCH_ENDPOINT ||
            pathname === DETAIL_ENDPOINT ||
            pathname === USER_HOME_ENDPOINT
            ? pathname
            : null;
    }
    catch {
        return null;
    }
};
const isSupportedReadPage = (href) => {
    try {
        const url = new URL(href, "https://www.xiaohongshu.com/");
        if (url.hostname !== "www.xiaohongshu.com") {
            return false;
        }
        return (url.pathname.startsWith("/search_result") ||
            url.pathname.startsWith("/explore/") ||
            url.pathname.startsWith("/user/profile/"));
    }
    catch {
        return false;
    }
};
const resolveCurrentPageCaptureContext = () => {
    const href = typeof window.location?.href === "string" ? window.location.href : "about:blank";
    return {
        pageContextNamespace: createVisitedPageContextNamespace(href, mainWorldBridgeSharedState.pageContextVisitSequence),
        referrer: href
    };
};
const emitCurrentPageContextNamespace = () => {
    const namespaceEvent = mainWorldBridgeSharedState.activeMainWorldEventChannel?.namespaceEvent;
    if (!namespaceEvent || typeof mainWindow.dispatchEvent !== "function") {
        return;
    }
    const { pageContextNamespace, referrer } = resolveCurrentPageCaptureContext();
    mainWindow.dispatchEvent(createWindowEvent(namespaceEvent, {
        page_context_namespace: pageContextNamespace,
        href: referrer,
        visit_sequence: mainWorldBridgeSharedState.pageContextVisitSequence
    }));
};
const isSyntheticRequest = (headers) => {
    const marker = headers[WEBENVOY_SYNTHETIC_REQUEST_HEADER];
    if (typeof marker !== "string") {
        return false;
    }
    const normalized = marker.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
};
const isSyntheticRequestInput = (value) => typeof value === "object" &&
    value !== null &&
    value[SYNTHETIC_REQUEST_SYMBOL] === true;
const hasCapturedRequestBusinessFailure = (body) => {
    const record = asRecord(body);
    const code = record?.code;
    return typeof code === "number" && Number.isFinite(code) && code !== 0;
};
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
const installAudioContextPatch = (context) => {
    if (!context.bundle || !context.requiredPatches.has("audio_context")) {
        return;
    }
    const audioNoiseSeed = asNumber(context.bundle.audioNoiseSeed);
    const webkitOfflineAudioContextCtor = window.webkitOfflineAudioContext;
    const OfflineCtor = typeof window.OfflineAudioContext === "function"
        ? window.OfflineAudioContext
        : typeof webkitOfflineAudioContextCtor === "function"
            ? webkitOfflineAudioContextCtor
            : null;
    if (audioNoiseSeed === null || !OfflineCtor) {
        return;
    }
    const prototype = OfflineCtor.prototype;
    const originalStartRendering = prototype.startRendering;
    if (typeof originalStartRendering !== "function") {
        return;
    }
    context.appliedPatches.push("audio_context");
    mainWorldBridgeSharedState.audioNoiseSeedByPrototype.set(prototype, audioNoiseSeed);
    if (mainWorldBridgeSharedState.patchedAudioContextPrototypes.has(prototype)) {
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
            if (channelData &&
                typeof channelData.length === "number" &&
                channelData.length > 0 &&
                !patchedChannelData.has(channelData)) {
                const noiseSeed = mainWorldBridgeSharedState.audioNoiseSeedByPrototype.get(prototype) ?? audioNoiseSeed;
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
    mainWorldBridgeSharedState.patchedAudioContextPrototypes.add(prototype);
};
const installBatteryPatch = (context) => {
    if (!context.bundle || !context.requiredPatches.has("battery")) {
        return;
    }
    const battery = asRecord(context.bundle.battery);
    const level = asNumber(battery?.level);
    const charging = typeof battery?.charging === "boolean" ? battery.charging : null;
    if (charging === null || level === null) {
        return;
    }
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
    context.appliedPatches.push("battery");
};
const installNavigatorPluginsPatch = (context) => {
    if (!context.requiredPatches.has("navigator_plugins")) {
        return;
    }
    defineGetter(window.navigator, "plugins", () => context.pluginAndMimeTypes.plugins);
    context.appliedPatches.push("navigator_plugins");
};
const installNavigatorMimeTypesPatch = (context) => {
    if (!context.requiredPatches.has("navigator_mime_types")) {
        return;
    }
    defineGetter(window.navigator, "mimeTypes", () => context.pluginAndMimeTypes.mimeTypes);
    context.appliedPatches.push("navigator_mime_types");
};
const installFingerprintRuntime = (runtime) => {
    const bundle = asRecord(runtime?.fingerprint_profile_bundle ?? null);
    const requiredPatches = asStringArray(asRecord(runtime?.fingerprint_patch_manifest ?? null)?.required_patches);
    const requiredPatchNames = new Set(requiredPatches);
    const appliedPatches = [];
    const pluginAndMimeTypes = createPluginAndMimeTypeArrays();
    const context = {
        bundle,
        requiredPatches: requiredPatchNames,
        appliedPatches,
        pluginAndMimeTypes
    };
    installAudioContextPatch(context);
    installBatteryPatch(context);
    installNavigatorPluginsPatch(context);
    installNavigatorMimeTypesPatch(context);
    const missingRequiredPatches = requiredPatches.filter((patchName) => !appliedPatches.includes(patchName));
    return {
        installed: missingRequiredPatches.length === 0,
        applied_patches: appliedPatches,
        required_patches: requiredPatches,
        missing_required_patches: missingRequiredPatches,
        source: typeof runtime?.source === "string" ? runtime.source : "unknown"
    };
};
const resolveLatestBucketArtifact = (bucket) => {
    const candidates = [bucket.admittedTemplate, bucket.rejectedObservation].filter((item) => item !== null);
    if (candidates.length === 0) {
        return null;
    }
    return (candidates.sort((left, right) => (right.observed_at ?? right.captured_at) - (left.observed_at ?? left.captured_at))[0] ?? null);
};
const isSyntheticRejectedArtifact = (artifact) => artifact?.source_kind === "synthetic_request" ||
    artifact?.rejection_reason === "synthetic_request_rejected";
const resolveRouteScopeKeyFromLookup = (method, path, shapeKey) => {
    try {
        const parsed = JSON.parse(shapeKey);
        const record = asRecord(parsed);
        if (!record) {
            return null;
        }
        const command = record.command;
        const pathname = toTrimmedString(record.pathname);
        const shapeMethod = normalizeCapturedRequestMethod(record.method);
        if (pathname !== path || shapeMethod !== method) {
            return null;
        }
        if (command === "xhs.search" && pathname === SEARCH_ENDPOINT && method === "POST") {
            return serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.search", method, SEARCH_ENDPOINT));
        }
        if (command === "xhs.detail" && pathname === DETAIL_ENDPOINT && method === "POST") {
            return serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.detail", method, DETAIL_ENDPOINT));
        }
        if (command === "xhs.user_home" && pathname === USER_HOME_ENDPOINT && method === "GET") {
            return serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.user_home", method, USER_HOME_ENDPOINT));
        }
        return null;
    }
    catch {
        return null;
    }
};
const storeCapturedRequestContext = (candidate, input) => {
    const baseTemplateReady = !candidate.synthetic &&
        input.status >= 200 &&
        input.status < 300 &&
        !hasCapturedRequestBusinessFailure(input.responseBody);
    const contextShape = resolveCapturedContextShape(candidate);
    if (!contextShape) {
        return;
    }
    const templateReady = baseTemplateReady &&
        (contextShape.routeScope.command !== "xhs.detail" ||
            detailResponseContainsCanonicalNoteId(input.responseBody, contextShape.shape.note_id ?? ""));
    const artifact = {
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
                    ? "synthetic_request_rejected"
                    : "failed_request_rejected"
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
    const bucket = getCapturedContextBucket(candidate.pageContextNamespace, contextShape.routeScopeKey, contextShape.shapeKey);
    if (templateReady) {
        setRouteBucketIncompatibleObservation(candidate.pageContextNamespace, contextShape.routeScopeKey, null);
        if (isSyntheticRejectedArtifact(bucket.rejectedObservation)) {
            bucket.rejectedObservation = null;
        }
        bucket.admittedTemplate = artifact;
        return;
    }
    const routeBucket = getCapturedContextRouteBucket(candidate.pageContextNamespace, contextShape.routeScopeKey);
    const incompatibleObservation = resolveLatestBucketArtifact(bucket);
    const latestSiblingAdmitted = [...routeBucket.entries()]
        .filter(([shapeKey]) => shapeKey !== contextShape.shapeKey)
        .map(([, siblingBucket]) => siblingBucket.admittedTemplate)
        .filter((entry) => entry !== null)
        .sort((left, right) => (right.observed_at ?? right.captured_at) - (left.observed_at ?? left.captured_at))[0] ?? null;
    if (latestSiblingAdmitted) {
        setRouteBucketIncompatibleObservation(candidate.pageContextNamespace, contextShape.routeScopeKey, {
            ...latestSiblingAdmitted,
            incompatibility_reason: "shape_mismatch"
        });
    }
    else if (!incompatibleObservation) {
        setRouteBucketIncompatibleObservation(candidate.pageContextNamespace, contextShape.routeScopeKey, null);
    }
    if (artifact.rejection_reason === "failed_request_rejected" && input.status > 0) {
        bucket.admittedTemplate = null;
    }
    bucket.rejectedObservation = artifact;
};
const resolveFetchCandidate = async (input, init) => {
    if (!isSupportedReadPage(typeof window.location?.href === "string" ? window.location.href : "")) {
        return null;
    }
    const baseHeaders = isRequestLike(input) ? headersToRecord(input.headers) : {};
    const initHeaders = headersToRecord(init?.headers);
    const headers = mergeHeaders(baseHeaders, initHeaders);
    const method = normalizeCapturedRequestMethod(init?.method ?? (isRequestLike(input) ? input.method : "GET"));
    if (!method) {
        return null;
    }
    const inputUrl = typeof input === "string"
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
    if (!url || !path) {
        return null;
    }
    const bodySource = init?.body !== undefined
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
const captureFetchResponse = async (candidate, response) => {
    const clone = response.clone();
    const responseText = await clone.text();
    storeCapturedRequestContext(candidate, {
        status: response.status,
        responseHeaders: headersToRecord(clone.headers),
        responseBody: parseArtifactPayloadText(responseText)
    });
};
const captureFetchFailure = (candidate, error) => {
    storeCapturedRequestContext(candidate, {
        status: 0,
        responseHeaders: {},
        responseBody: {
            error: error instanceof Error
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
const resolveXhrCandidate = async (state, bodySource) => {
    if (!state?.method || !state.url) {
        return null;
    }
    const url = resolveAbsoluteUrl(state.url);
    const path = url ? resolvePathname(url) : null;
    if (!url || !path) {
        return null;
    }
    const body = await readArtifactPayload(bodySource);
    const pageCaptureContext = resolveCurrentPageCaptureContext();
    return {
        transport: "xhr",
        method: state.method,
        path,
        url,
        headers: state.headers,
        body,
        synthetic: isSyntheticRequest(state.headers),
        pageContextNamespace: pageCaptureContext.pageContextNamespace,
        referrer: pageCaptureContext.referrer
    };
};
const captureXhrResponse = (candidate, xhr) => {
    const responseBody = readXhrResponseBody(xhr);
    storeCapturedRequestContext(candidate, {
        status: typeof xhr.status === "number" ? xhr.status : 0,
        responseHeaders: headersToRecord(typeof xhr.getAllResponseHeaders === "function" ? xhr.getAllResponseHeaders() : ""),
        responseBody
    });
};
const readXhrResponseBody = (xhr) => {
    const responseType = typeof xhr.responseType === "string" ? xhr.responseType : "";
    if (responseType === "" || responseType === "text") {
        const responseText = readXhrProperty(xhr, "responseText");
        if (typeof responseText === "string") {
            return parseArtifactPayloadText(responseText);
        }
        const response = readXhrProperty(xhr, "response");
        return typeof response === "string" ? parseArtifactPayloadText(response) : response;
    }
    const response = readXhrProperty(xhr, "response");
    if (responseType === "json") {
        return response;
    }
    return {
        response_type: responseType,
        response_available: response !== null && response !== undefined
    };
};
const readXhrProperty = (xhr, property) => {
    try {
        return xhr[property];
    }
    catch {
        return undefined;
    }
};
const installFetchCapture = () => {
    const originalFetch = window.fetch;
    if (typeof originalFetch !== "function") {
        return;
    }
    const existingPatched = originalFetch;
    if (existingPatched[FETCH_CAPTURE_PATCH_SYMBOL] === true) {
        return;
    }
    const patchedFetch = async (input, init) => {
        const candidate = await resolveFetchCandidate(input, init);
        try {
            const response = await originalFetch.call(window, input, init);
            if (candidate) {
                void captureFetchResponse(candidate, response).catch(() => { });
            }
            return response;
        }
        catch (error) {
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
const installXhrCapture = () => {
    const XhrCtor = window.XMLHttpRequest;
    if (typeof XhrCtor !== "function") {
        return;
    }
    const prototype = XhrCtor.prototype;
    if (prototype[XHR_CAPTURE_PATCH_SYMBOL] === true) {
        return;
    }
    const originalOpen = prototype.open;
    const originalSend = prototype.send;
    const originalSetRequestHeader = prototype.setRequestHeader;
    const stateByXhr = new WeakMap();
    prototype.open = function patchedOpen(method, url, ...args) {
        stateByXhr.set(this, {
            method: normalizeCapturedRequestMethod(method),
            url: String(url),
            headers: {}
        });
        Reflect.apply(originalOpen, this, [method, url, ...args]);
    };
    prototype.setRequestHeader = function patchedSetRequestHeader(name, value) {
        const state = stateByXhr.get(this);
        if (state) {
            state.headers = mergeHeaders(state.headers, headersToRecord([[name, value]]));
        }
        Reflect.apply(originalSetRequestHeader, this, [name, value]);
    };
    prototype.send = function patchedSend(body) {
        const state = stateByXhr.get(this);
        const candidatePromise = resolveXhrCandidate(state, body);
        let captured = false;
        const finalize = () => {
            if (captured) {
                return;
            }
            captured = true;
            void candidatePromise.then((candidate) => {
                if (candidate) {
                    captureXhrResponse(candidate, this);
                }
            });
        };
        this.addEventListener("loadend", finalize, { once: true });
        this.addEventListener("error", finalize, { once: true });
        this.addEventListener("abort", finalize, { once: true });
        this.addEventListener("timeout", finalize, { once: true });
        Reflect.apply(originalSend, this, [body]);
    };
    Object.defineProperty(prototype, XHR_CAPTURE_PATCH_SYMBOL, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });
};
const installCapturedRequestContextCapture = () => {
    if (mainWorldBridgeSharedState.capturedRequestContextCaptureInstalled) {
        return;
    }
    installFetchCapture();
    installXhrCapture();
    mainWorldBridgeSharedState.capturedRequestContextCaptureInstalled = true;
};
const refreshPageContextLifecycle = (options) => {
    if (options?.advanceVisit === true) {
        mainWorldBridgeSharedState.pageContextVisitSequence += 1;
    }
    if (isSupportedReadPage(typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "")) {
        installCapturedRequestContextCapture();
    }
    emitCurrentPageContextNamespace();
};
const refreshPageContextLifecycleForHistoryMutation = () => {
    const currentHref = typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
    if (currentHref === mainWorldBridgeSharedState.lastObservedPageContextHref) {
        if (isSupportedReadPage(currentHref)) {
            installCapturedRequestContextCapture();
            emitCurrentPageContextNamespace();
        }
        return;
    }
    mainWorldBridgeSharedState.lastObservedPageContextHref = currentHref;
    refreshPageContextLifecycle({ advanceVisit: true });
};
const installPageContextNavigationTracking = () => {
    if (typeof mainWindow.addEventListener === "function") {
        mainWindow.addEventListener("popstate", () => {
            mainWorldBridgeSharedState.lastObservedPageContextHref =
                typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
            refreshPageContextLifecycle({ advanceVisit: true });
        });
        mainWindow.addEventListener("hashchange", () => {
            mainWorldBridgeSharedState.lastObservedPageContextHref =
                typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
            refreshPageContextLifecycle({ advanceVisit: true });
        });
        mainWindow.addEventListener("pageshow", (event) => {
            const pageTransitionEvent = event;
            if (pageTransitionEvent.persisted === true) {
                mainWorldBridgeSharedState.lastObservedPageContextHref =
                    typeof mainWindow.location?.href === "string" ? mainWindow.location.href : "about:blank";
                refreshPageContextLifecycle({ advanceVisit: true });
            }
        });
    }
    const history = mainWindow.history;
    if (history && history[PAGE_CONTEXT_NAVIGATION_PATCH_SYMBOL] !== true) {
        const patchStateMethod = (methodName) => {
            const original = history[methodName];
            if (typeof original !== "function") {
                return;
            }
            history[methodName] = function patchedHistoryState(...args) {
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
const parseMainWorldRequest = (event) => {
    const detail = asRecord(event.detail);
    if (!detail) {
        return null;
    }
    const id = asString(detail.id);
    const type = detail.type;
    if (!id ||
        (type !== "fingerprint-install" &&
            type !== "fingerprint-verify" &&
            type !== "page-state-read" &&
            type !== "captured-request-context-read")) {
        return null;
    }
    return {
        id,
        type,
        payload: asRecord(detail.payload) ?? {}
    };
};
const emitMainWorldResult = async (result) => {
    if (!mainWorldBridgeSharedState.activeMainWorldEventChannel) {
        return;
    }
    await emitResult(mainWorldBridgeSharedState.activeMainWorldEventChannel.resultEvent, result);
};
const buildMainWorldVerifyResult = () => {
    const hasGetBattery = typeof window.navigator.getBattery === "function";
    return {
        has_get_battery: hasGetBattery,
        plugins_length: typeof window.navigator.plugins?.length === "number" ? window.navigator.plugins.length : null,
        mime_types_length: typeof window.navigator.mimeTypes?.length === "number" ? window.navigator.mimeTypes.length : null
    };
};
const handleFingerprintVerifyRequest = async (request) => {
    await emitMainWorldResult({
        id: request.id,
        ok: true,
        result: buildMainWorldVerifyResult()
    });
};
const handlePageStateReadRequest = async (request) => {
    const initialState = asRecord(window.__INITIAL_STATE__);
    await emitMainWorldResult({
        id: request.id,
        ok: true,
        result: initialState ?? null
    });
};
const resolveIncompatibleObservation = (routeBucket, requestedShapeKey) => {
    let latest = null;
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
const handleCapturedRequestContextReadRequest = async (request) => {
    const method = normalizeCapturedRequestMethod(request.payload.method);
    const path = asString(request.payload.path);
    const currentPageCaptureContext = resolveCurrentPageCaptureContext();
    const namespace = resolveActiveVisitedPageContextNamespace(asString(request.payload.page_context_namespace), currentPageCaptureContext.pageContextNamespace);
    const shapeKey = asString(request.payload.shape_key);
    const routeScopeKey = method && path && shapeKey ? resolveRouteScopeKeyFromLookup(method, path, shapeKey) : null;
    const result = method && path && namespace && shapeKey && routeScopeKey
        ? (() => {
            const namespaceBuckets = mainWorldBridgeSharedState.capturedRequestContextBucketsByNamespace.get(namespace);
            const routeBucket = namespaceBuckets?.get(routeScopeKey) ?? null;
            const exactBucket = routeBucket?.get(shapeKey) ?? null;
            return {
                page_context_namespace: namespace,
                shape_key: shapeKey,
                admitted_template: exactBucket?.admittedTemplate &&
                    exactBucket.admittedTemplate.method === method &&
                    exactBucket.admittedTemplate.path === path
                    ? exactBucket.admittedTemplate
                    : null,
                rejected_observation: exactBucket?.rejectedObservation &&
                    exactBucket.rejectedObservation.method === method &&
                    exactBucket.rejectedObservation.path === path
                    ? exactBucket.rejectedObservation
                    : null,
                incompatible_observation: getRouteBucketIncompatibleObservation(namespace, routeScopeKey) ??
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
const handleFingerprintInstallRequest = async (request) => {
    const runtime = asRecord(request.payload.fingerprint_runtime ?? null);
    const result = installFingerprintRuntime(runtime);
    await emitMainWorldResult({
        id: request.id,
        ok: true,
        result
    });
};
const handleRequest = async (request) => {
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
const isValidChannelEventName = (value, prefix) => value.startsWith(prefix) && /^[A-Za-z0-9_.:-]+$/.test(value) && value.length <= 128;
const attachMainWorldEventChannelIfValid = (requestEvent, resultEvent) => {
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
const resolveExpectedMainWorldEventChannel = () => {
    const requestEvent = typeof EXPECTED_MAIN_WORLD_REQUEST_EVENT === "string"
        ? EXPECTED_MAIN_WORLD_REQUEST_EVENT
        : null;
    const resultEvent = typeof EXPECTED_MAIN_WORLD_RESULT_EVENT === "string"
        ? EXPECTED_MAIN_WORLD_RESULT_EVENT
        : null;
    const namespaceEvent = typeof EXPECTED_MAIN_WORLD_NAMESPACE_EVENT === "string"
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
        namespaceEvent: namespaceEvent && isValidChannelEventName(namespaceEvent, "__mw_ns__")
            ? namespaceEvent
            : null
    };
};
const resolveBootstrappedMainWorldEventChannel = (event) => {
    const detail = asRecord(event.detail);
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
        namespaceEvent: namespaceEvent && isValidChannelEventName(namespaceEvent, "__mw_ns__")
            ? namespaceEvent
            : null
    };
};
const attachMainWorldEventChannel = (channel) => {
    if (mainWorldBridgeSharedState.activeMainWorldEventChannel) {
        if (mainWorldBridgeSharedState.activeMainWorldEventChannel.requestEvent === channel.requestEvent &&
            mainWorldBridgeSharedState.activeMainWorldEventChannel.resultEvent === channel.resultEvent &&
            mainWorldBridgeSharedState.activeMainWorldEventChannel.namespaceEvent === channel.namespaceEvent) {
            return;
        }
        if (mainWorldBridgeSharedState.activeMainWorldRequestListener) {
            window.removeEventListener(mainWorldBridgeSharedState.activeMainWorldEventChannel.requestEvent, mainWorldBridgeSharedState.activeMainWorldRequestListener);
        }
        mainWorldBridgeSharedState.activeMainWorldEventChannel = null;
        mainWorldBridgeSharedState.activeMainWorldRequestListener = null;
    }
    mainWorldBridgeSharedState.activeMainWorldEventChannel = channel;
    mainWorldBridgeSharedState.activeMainWorldRequestListener = (event) => {
        const request = parseMainWorldRequest(event);
        if (!request) {
            return;
        }
        void handleRequest(request).catch(async (error) => {
            if (!mainWorldBridgeSharedState.activeMainWorldEventChannel) {
                return;
            }
            const errorName = typeof error === "object" && error !== null && "name" in error
                ? String(error.name)
                : undefined;
            const errorCode = typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
                : undefined;
            await emitResult(mainWorldBridgeSharedState.activeMainWorldEventChannel.resultEvent, {
                id: request.id,
                ok: false,
                message: error instanceof Error ? error.message : String(error),
                ...(errorName ? { error_name: errorName } : {}),
                ...(errorCode ? { error_code: errorCode } : {})
            });
        });
    };
    window.addEventListener(channel.requestEvent, mainWorldBridgeSharedState.activeMainWorldRequestListener);
};
const ensureBootstrapListener = () => {
    if (mainWorldBridgeSharedState.activeMainWorldBootstrapListener ||
        typeof window.addEventListener !== "function") {
        return;
    }
    mainWorldBridgeSharedState.activeMainWorldBootstrapListener = (event) => {
        const channel = resolveBootstrappedMainWorldEventChannel(event);
        if (!channel) {
            return;
        }
        attachMainWorldEventChannel(channel);
    };
    window.addEventListener(MAIN_WORLD_EVENT_BOOTSTRAP, mainWorldBridgeSharedState.activeMainWorldBootstrapListener);
};
const expectedMainWorldEventChannel = resolveExpectedMainWorldEventChannel();
installPageContextNavigationTracking();
if (expectedMainWorldEventChannel) {
    attachMainWorldEventChannel(expectedMainWorldEventChannel);
}
else {
    ensureBootstrapListener();
}
return {  };
})();
})();
