import { CAPTURED_REQUEST_CONTEXT_PATHS, DETAIL_ENDPOINT, SEARCH_ENDPOINT, USER_HOME_ENDPOINT, WEBENVOY_SYNTHETIC_REQUEST_HEADER, createPageContextNamespace } from "./xhs-search-types.js";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
let activeMainWorldEventChannel = null;
let activeMainWorldRequestListener = null;
let activeMainWorldBootstrapListener = null;
const patchedAudioContextPrototypes = new WeakSet();
const audioNoiseSeedByPrototype = new WeakMap();
const capturedRequestContextBucketsByNamespace = new Map();
const capturedRequestContextPathSet = new Set(CAPTURED_REQUEST_CONTEXT_PATHS);
const FETCH_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.fetch.v1");
const XHR_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.xhr.v1");
const XHR_CAPTURE_STATE_SYMBOL = Symbol.for("webenvoy.main_world.capture.xhr_state.v1");
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
const isCapturedRequestContextCommand = (value) => value === "xhs.search" || value === "xhs.detail" || value === "xhs.user_home";
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
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const keyword = toTrimmedString(record.keyword);
    if (!keyword) {
        return null;
    }
    const page = record.page === undefined ? 1 : asInteger(record.page);
    const pageSize = record.page_size === undefined ? 20 : asInteger(record.page_size);
    const sort = record.sort === undefined ? "general" : toTrimmedString(record.sort);
    const noteType = record.note_type === undefined ? 0 : asInteger(record.note_type);
    if (page === null || pageSize === null || sort === null || noteType === null) {
        return null;
    }
    const shape = {
        command: "xhs.search",
        method: "POST",
        pathname: SEARCH_ENDPOINT,
        keyword,
        page,
        page_size: pageSize,
        sort,
        note_type: noteType
    };
    return {
        routeScope: createCapturedContextRouteScope("xhs.search", "POST", SEARCH_ENDPOINT),
        routeScopeKey: serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.search", "POST", SEARCH_ENDPOINT)),
        shape,
        shapeKey: JSON.stringify(shape)
    };
};
const collectArtifactRecordCandidates = (value) => {
    const direct = asRecord(value);
    if (direct) {
        return [direct];
    }
    if (Array.isArray(value)) {
        return value.map((entry) => asRecord(entry)).filter((entry) => entry !== null);
    }
    return [];
};
const collectNestedArtifactRecordCandidates = (value, nestedKeys, seen = new Set()) => {
    const directCandidates = collectArtifactRecordCandidates(value);
    const nestedCandidates = [];
    for (const candidate of directCandidates) {
        if (seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        nestedCandidates.push(candidate);
        for (const key of nestedKeys) {
            nestedCandidates.push(...collectNestedArtifactRecordCandidates(candidate[key], nestedKeys, seen));
        }
    }
    return nestedCandidates;
};
const hasDetailArtifactDataShape = (record) => [
    "title",
    "desc",
    "user",
    "interact_info",
    "image_list",
    "video_info",
    "note_card",
    "note_card_list"
].some((key) => key in record);
const getAcceptedDetailResponseCandidates = (body) => {
    const responseRecord = asRecord(body);
    const data = responseRecord?.data ?? body;
    const dataRecord = asRecord(data);
    if (!dataRecord) {
        return [];
    }
    return [
        ...collectNestedArtifactRecordCandidates(dataRecord.note, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.note_card, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.note_card_list, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.current_note, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.item, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.items, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedArtifactRecordCandidates(dataRecord.notes, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...(hasDetailArtifactDataShape(dataRecord) ? [dataRecord] : [])
    ];
};
const resolveDetailResponseNoteId = (value, preferredNoteId) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    let fallbackNoteId = null;
    for (const candidate of getAcceptedDetailResponseCandidates(record)) {
        const candidateNoteId = toTrimmedString(candidate.note_id) ??
            toTrimmedString(candidate.noteId) ??
            toTrimmedString(candidate.id);
        if (candidateNoteId) {
            if (preferredNoteId && candidateNoteId === preferredNoteId) {
                return candidateNoteId;
            }
            fallbackNoteId ??= candidateNoteId;
        }
    }
    return preferredNoteId ? null : fallbackNoteId;
};
const parseDetailShape = (requestBody, responseBody, templateReady) => {
    const record = asRecord(requestBody);
    const requestedNoteId = (record ? toTrimmedString(record.note_id) : null) ??
        (record ? toTrimmedString(record.source_note_id) : null);
    const matchedResponseNoteId = resolveDetailResponseNoteId(responseBody, requestedNoteId);
    const responseNoteId = resolveDetailResponseNoteId(responseBody);
    const noteId = templateReady
        ? matchedResponseNoteId ?? responseNoteId
        : requestedNoteId ??
            responseNoteId ??
            (!templateReady && record ? toTrimmedString(record.source_note_id) : null);
    if (!noteId) {
        return null;
    }
    const shape = {
        command: "xhs.detail",
        method: "POST",
        pathname: DETAIL_ENDPOINT,
        note_id: noteId
    };
    return {
        routeScope: createCapturedContextRouteScope("xhs.detail", "POST", DETAIL_ENDPOINT),
        routeScopeKey: serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.detail", "POST", DETAIL_ENDPOINT)),
        shape,
        shapeKey: JSON.stringify(shape)
    };
};
const parseUserHomeShape = (url, value) => {
    const record = asRecord(value);
    let userId = record ? toTrimmedString(record.user_id) ?? toTrimmedString(record.userId) : null;
    if (!userId) {
        try {
            userId = toTrimmedString(new URL(url).searchParams.get("user_id"));
        }
        catch {
            userId = null;
        }
    }
    if (!userId) {
        return null;
    }
    const shape = {
        command: "xhs.user_home",
        method: "GET",
        pathname: USER_HOME_ENDPOINT,
        user_id: userId
    };
    return {
        routeScope: createCapturedContextRouteScope("xhs.user_home", "GET", USER_HOME_ENDPOINT),
        routeScopeKey: serializeCapturedContextRouteScope(createCapturedContextRouteScope("xhs.user_home", "GET", USER_HOME_ENDPOINT)),
        shape,
        shapeKey: JSON.stringify(shape)
    };
};
const deriveCapturedContextShape = (candidate, input) => {
    if (candidate.path === SEARCH_ENDPOINT && candidate.method === "POST") {
        return parseSearchShape(candidate.body);
    }
    if (candidate.path === DETAIL_ENDPOINT && candidate.method === "POST") {
        return parseDetailShape(candidate.body, input.responseBody, input.templateReady);
    }
    if (candidate.path === USER_HOME_ENDPOINT && candidate.method === "GET") {
        return parseUserHomeShape(candidate.url, candidate.body);
    }
    return null;
};
const getCapturedContextNamespaceBuckets = (namespace) => {
    let namespaceBuckets = capturedRequestContextBucketsByNamespace.get(namespace);
    if (!namespaceBuckets) {
        namespaceBuckets = new Map();
        capturedRequestContextBucketsByNamespace.set(namespace, namespaceBuckets);
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
    if (typeof FormData === "function" && body instanceof FormData) {
        const record = {};
        for (const [key, value] of body.entries()) {
            const nextValue = typeof value === "string" ? value : value.name;
            record[key] = [...(record[key] ?? []), nextValue];
        }
        return JSON.stringify(record);
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
        if (normalizedName.length === 0) {
            return;
        }
        record[normalizedName] = value;
    };
    if (typeof headers === "string") {
        for (const line of headers.split(/\r?\n/)) {
            const separatorIndex = line.indexOf(":");
            if (separatorIndex <= 0) {
                continue;
            }
            assignHeader(line.slice(0, separatorIndex), line.slice(separatorIndex + 1).trim());
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
    if (headerRecord) {
        for (const [name, value] of Object.entries(headerRecord)) {
            assignHeader(name, String(value));
        }
    }
    return record;
};
const mergeHeaders = (base, extra) => ({
    ...base,
    ...extra
});
const isRequestLike = (value) => {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    return typeof value.url === "string";
};
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
        return new URL(value).pathname || null;
    }
    catch {
        return null;
    }
};
const resolveCurrentPageCaptureContext = () => {
    const referrer = typeof window.location?.href === "string" ? window.location.href : null;
    return {
        pageContextNamespace: createPageContextNamespace(referrer ?? "about:blank"),
        referrer
    };
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
const shouldCaptureRequest = (path) => capturedRequestContextPathSet.has(path);
const resolveLatestBucketArtifact = (bucket) => {
    const candidates = [bucket.admittedTemplate, bucket.rejectedObservation].filter((item) => item !== null);
    if (candidates.length === 0) {
        return null;
    }
    return (candidates.sort((left, right) => (right.observed_at ?? right.captured_at) - (left.observed_at ?? left.captured_at))[0] ?? null);
};
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
        if (!isCapturedRequestContextCommand(command) || pathname !== path || shapeMethod !== method) {
            return null;
        }
        return serializeCapturedContextRouteScope(createCapturedContextRouteScope(command, method, path));
    }
    catch {
        return null;
    }
};
const storeCapturedRequestContext = (candidate, input) => {
    const templateReady = !candidate.synthetic && input.status >= 200 && input.status < 300;
    const contextShape = deriveCapturedContextShape(candidate, {
        responseBody: input.responseBody,
        templateReady
    });
    if (!contextShape) {
        return;
    }
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
        ...(candidate.synthetic
            ? { rejection_reason: "synthetic_request_rejected" }
            : !templateReady
                ? { rejection_reason: "failed_request_rejected" }
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
        bucket.admittedTemplate = artifact;
        return;
    }
    bucket.rejectedObservation = artifact;
};
const resolveFetchCandidate = async (input, init) => {
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
    if (!url) {
        return null;
    }
    const path = resolvePathname(url);
    if (!path || !shouldCaptureRequest(path)) {
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
const getXhrCaptureState = (xhr) => (xhr[XHR_CAPTURE_STATE_SYMBOL] ?? null);
const setXhrCaptureState = (xhr, state) => {
    Object.defineProperty(xhr, XHR_CAPTURE_STATE_SYMBOL, {
        configurable: true,
        enumerable: false,
        writable: true,
        value: state
    });
};
const installXhrCapture = () => {
    const XhrCtor = globalThis.XMLHttpRequest;
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
    if (typeof originalOpen !== "function" ||
        typeof originalSend !== "function" ||
        typeof originalSetRequestHeader !== "function") {
        return;
    }
    prototype.open = function (method, url, async, username, password) {
        const normalizedMethod = normalizeCapturedRequestMethod(method);
        const resolvedUrl = resolveAbsoluteUrl(String(url));
        const resolvedPath = resolvedUrl ? resolvePathname(resolvedUrl) : null;
        const pageCaptureContext = resolveCurrentPageCaptureContext();
        setXhrCaptureState(this, normalizedMethod && resolvedUrl && resolvedPath
            ? {
                transport: "xhr",
                method: normalizedMethod,
                path: resolvedPath,
                url: resolvedUrl,
                headers: {},
                body: null,
                synthetic: false,
                pageContextNamespace: pageCaptureContext.pageContextNamespace,
                referrer: pageCaptureContext.referrer
            }
            : null);
        originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
    };
    prototype.setRequestHeader = function (name, value) {
        const state = getXhrCaptureState(this);
        if (state) {
            const normalizedName = normalizeHeaderName(name);
            state.headers[normalizedName] = value;
            state.synthetic = isSyntheticRequest(state.headers);
        }
        originalSetRequestHeader.call(this, name, value);
    };
    prototype.send = function (body) {
        const state = getXhrCaptureState(this);
        if (state && shouldCaptureRequest(state.path)) {
            const requestBodyReady = readArtifactPayload(body).then((payload) => {
                state.body = payload;
            });
            this.addEventListener("loadend", () => {
                void requestBodyReady.then(() => {
                    storeCapturedRequestContext(state, {
                        status: this.status,
                        responseHeaders: headersToRecord(this.getAllResponseHeaders()),
                        responseBody: parseArtifactPayloadText(typeof this.responseText === "string" ? this.responseText : "")
                    });
                });
            });
        }
        originalSend.call(this, body);
    };
    Object.defineProperty(prototype, XHR_CAPTURE_PATCH_SYMBOL, {
        configurable: false,
        enumerable: false,
        writable: false,
        value: true
    });
};
const installCapturedRequestContextCapture = () => {
    installFetchCapture();
    installXhrCapture();
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
    audioNoiseSeedByPrototype.set(prototype, audioNoiseSeed);
    if (patchedAudioContextPrototypes.has(prototype)) {
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
    if (!activeMainWorldEventChannel) {
        return;
    }
    await emitResult(activeMainWorldEventChannel.resultEvent, result);
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
        if (shapeKey === requestedShapeKey) {
            continue;
        }
        const candidate = bucket.admittedTemplate;
        if (!candidate) {
            continue;
        }
        const candidateObservedAt = candidate.observed_at ?? candidate.captured_at;
        if (!latest) {
            latest = candidate;
            continue;
        }
        const latestObservedAt = latest.observed_at ?? latest.captured_at;
        if (candidateObservedAt > latestObservedAt) {
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
    const namespace = asString(request.payload.page_context_namespace);
    const shapeKey = asString(request.payload.shape_key);
    const routeScopeKey = method && path && shapeKey ? resolveRouteScopeKeyFromLookup(method, path, shapeKey) : null;
    const result = method && path && namespace && shapeKey && routeScopeKey
        ? (() => {
            const namespaceBuckets = capturedRequestContextBucketsByNamespace.get(namespace);
            const routeBucket = namespaceBuckets?.get(routeScopeKey) ?? null;
            const exactBucket = routeBucket?.get(shapeKey) ?? null;
            const availableShapeKeys = routeBucket ? [...routeBucket.keys()] : [];
            const admittedTemplate = exactBucket?.admittedTemplate &&
                exactBucket.admittedTemplate.method === method &&
                exactBucket.admittedTemplate.path === path
                ? exactBucket.admittedTemplate
                : null;
            const rejectedObservation = exactBucket?.rejectedObservation &&
                exactBucket.rejectedObservation.method === method &&
                exactBucket.rejectedObservation.path === path
                ? exactBucket.rejectedObservation
                : null;
            return {
                page_context_namespace: namespace,
                shape_key: shapeKey,
                admitted_template: admittedTemplate,
                rejected_observation: rejectedObservation,
                incompatible_observation: routeBucket
                    ? resolveIncompatibleObservation(routeBucket, shapeKey)
                    : null,
                available_shape_keys: availableShapeKeys
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
        resultEvent
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
const resolveBootstrappedMainWorldEventChannel = (event) => {
    const detail = asRecord(event.detail);
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
const attachMainWorldEventChannel = (channel) => {
    installCapturedRequestContextCapture();
    if (activeMainWorldEventChannel) {
        if (activeMainWorldEventChannel.requestEvent === channel.requestEvent &&
            activeMainWorldEventChannel.resultEvent === channel.resultEvent) {
            return;
        }
        if (activeMainWorldRequestListener) {
            window.removeEventListener(activeMainWorldEventChannel.requestEvent, activeMainWorldRequestListener);
        }
        activeMainWorldEventChannel = null;
        activeMainWorldRequestListener = null;
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
            const errorName = typeof error === "object" && error !== null && "name" in error
                ? String(error.name)
                : undefined;
            const errorCode = typeof error === "object" && error !== null && "code" in error
                ? String(error.code)
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
    window.addEventListener(channel.requestEvent, activeMainWorldRequestListener);
};
const ensureBootstrapListener = () => {
    if (activeMainWorldBootstrapListener || typeof window.addEventListener !== "function") {
        return;
    }
    activeMainWorldBootstrapListener = (event) => {
        const channel = resolveBootstrappedMainWorldEventChannel(event);
        if (!channel) {
            return;
        }
        attachMainWorldEventChannel(channel);
    };
    window.addEventListener(MAIN_WORLD_EVENT_BOOTSTRAP, activeMainWorldBootstrapListener);
};
const expectedMainWorldEventChannel = resolveExpectedMainWorldEventChannel();
if (expectedMainWorldEventChannel) {
    attachMainWorldEventChannel(expectedMainWorldEventChannel);
}
else {
    ensureBootstrapListener();
}
