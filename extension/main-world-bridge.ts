import {
  CAPTURED_REQUEST_CONTEXT_PATHS,
  DETAIL_ENDPOINT,
  SEARCH_ENDPOINT,
  USER_HOME_ENDPOINT,
  WEBENVOY_SYNTHETIC_REQUEST_HEADER,
  createPageContextNamespace,
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
};

type FingerprintPatchInstallContext = {
  bundle: RecordValue | null;
  requiredPatches: Set<string>;
  appliedPatches: string[];
  pluginAndMimeTypes: ReturnType<typeof createPluginAndMimeTypeArrays>;
};

type CapturedRequestCandidate = {
  transport: "fetch" | "xhr";
  method: CapturedRequestContextMethod;
  path: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  synthetic: boolean;
};

type CapturedContextShape = {
  routeScope: {
    command: CapturedRequestContextCommand;
    method: CapturedRequestContextMethod;
    pathname: string;
  };
  routeScopeKey: string;
  shape: RecordValue;
  shapeKey: string;
};

type CapturedContextBucket = {
  admittedTemplate: CapturedRequestContextArtifact | null;
  rejectedObservation: CapturedRequestContextArtifact | null;
};

type CapturedContextNamespaceBuckets = Map<string, Map<string, CapturedContextBucket>>;

type XhrCaptureState = Omit<CapturedRequestCandidate, "synthetic"> & {
  synthetic: boolean;
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
const capturedRequestContextBucketsByNamespace = new Map<
  PageContextNamespace,
  CapturedContextNamespaceBuckets
>();
const capturedRequestContextPathSet = new Set<string>(CAPTURED_REQUEST_CONTEXT_PATHS);
const FETCH_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.fetch.v1");
const XHR_CAPTURE_PATCH_SYMBOL = Symbol.for("webenvoy.main_world.capture.xhr.v1");
const XHR_CAPTURE_STATE_SYMBOL = Symbol.for("webenvoy.main_world.capture.xhr_state.v1");
const SYNTHETIC_REQUEST_QUEUE_SYMBOL = Symbol.for(
  "webenvoy.main_world.synthetic_request_queue.v1"
);

type SyntheticRequestQueueEntry = {
  id: string;
  method: CapturedRequestContextMethod;
  url: string;
  body: unknown;
  expires_at: number;
};

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
  const normalized = value.trim().toUpperCase();
  return normalized === "POST" || normalized === "GET" ? normalized : null;
};

const isCapturedRequestContextCommand = (
  value: unknown
): value is CapturedRequestContextCommand =>
  value === "xhs.search" || value === "xhs.detail" || value === "xhs.user_home";

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
  pathname: string
): CapturedContextShape["routeScope"] => ({
  command,
  method,
  pathname
});

const serializeCapturedContextRouteScope = (
  scope: CapturedContextShape["routeScope"]
): string => JSON.stringify(scope);

const parseSearchShape = (value: unknown): CapturedContextShape | null => {
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
  } as const;
  return {
    routeScope: createCapturedContextRouteScope("xhs.search", "POST", SEARCH_ENDPOINT),
    routeScopeKey: serializeCapturedContextRouteScope(
      createCapturedContextRouteScope("xhs.search", "POST", SEARCH_ENDPOINT)
    ),
    shape,
    shapeKey: JSON.stringify(shape)
  };
};

const resolveDetailResponseNoteId = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const data = asRecord(record.data);
  const note = asRecord(data?.note);
  const items = Array.isArray(data?.items) ? data.items : null;
  const firstItem = items ? asRecord(items[0]) : null;
  const metadata = asRecord(data?.metadata);
  return (
    toTrimmedString(record.note_id) ??
    toTrimmedString(data?.note_id) ??
    toTrimmedString(note?.note_id) ??
    toTrimmedString(note?.id) ??
    toTrimmedString(firstItem?.note_id) ??
    toTrimmedString(firstItem?.id) ??
    toTrimmedString(metadata?.current_note_id)
  );
};

const parseDetailShape = (
  requestBody: unknown,
  responseBody: unknown,
  templateReady: boolean
): CapturedContextShape | null => {
  const record = asRecord(requestBody);
  const noteId =
    (record ? toTrimmedString(record.note_id) : null) ??
    resolveDetailResponseNoteId(responseBody) ??
    (!templateReady && record ? toTrimmedString(record.source_note_id) : null);
  if (!noteId) {
    return null;
  }
  const shape = {
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
  } as const;
  return {
    routeScope: createCapturedContextRouteScope("xhs.detail", "POST", DETAIL_ENDPOINT),
    routeScopeKey: serializeCapturedContextRouteScope(
      createCapturedContextRouteScope("xhs.detail", "POST", DETAIL_ENDPOINT)
    ),
    shape,
    shapeKey: JSON.stringify(shape)
  };
};

const parseUserHomeShape = (url: string, value: unknown): CapturedContextShape | null => {
  const record = asRecord(value);
  let userId = record ? toTrimmedString(record.user_id) ?? toTrimmedString(record.userId) : null;
  if (!userId) {
    try {
      userId = toTrimmedString(new URL(url).searchParams.get("user_id"));
    } catch {
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
  } as const;
  return {
    routeScope: createCapturedContextRouteScope("xhs.user_home", "GET", USER_HOME_ENDPOINT),
    routeScopeKey: serializeCapturedContextRouteScope(
      createCapturedContextRouteScope("xhs.user_home", "GET", USER_HOME_ENDPOINT)
    ),
    shape,
    shapeKey: JSON.stringify(shape)
  };
};

const deriveCapturedContextShape = (
  candidate: CapturedRequestCandidate,
  input: {
    responseBody: unknown;
    templateReady: boolean;
  }
): CapturedContextShape | null => {
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
  if (typeof FormData === "function" && body instanceof FormData) {
    const record: Record<string, string[]> = {};
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
} => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof (value as { url?: unknown }).url === "string";
};

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
    return new URL(value).pathname || null;
  } catch {
    return null;
  }
};

const isSyntheticRequest = (headers: Record<string, string>): boolean => {
  const marker = headers[WEBENVOY_SYNTHETIC_REQUEST_HEADER];
  if (typeof marker !== "string") {
    return false;
  }
  const normalized = marker.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
};

const getSyntheticRequestQueue = (): SyntheticRequestQueueEntry[] => {
  const globalRecord = globalThis as typeof globalThis & {
    [SYNTHETIC_REQUEST_QUEUE_SYMBOL]?: unknown;
  };
  const queue = globalRecord[SYNTHETIC_REQUEST_QUEUE_SYMBOL];
  if (!Array.isArray(queue)) {
    return [];
  }
  return queue.filter((entry): entry is SyntheticRequestQueueEntry => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record.id === "string" &&
      (record.method === "POST" || record.method === "GET") &&
      typeof record.url === "string" &&
      typeof record.expires_at === "number"
    );
  });
};

const setSyntheticRequestQueue = (queue: SyntheticRequestQueueEntry[]): void => {
  const globalRecord = globalThis as typeof globalThis & {
    [SYNTHETIC_REQUEST_QUEUE_SYMBOL]?: unknown;
  };
  if (queue.length === 0) {
    delete globalRecord[SYNTHETIC_REQUEST_QUEUE_SYMBOL];
    return;
  }
  globalRecord[SYNTHETIC_REQUEST_QUEUE_SYMBOL] = queue;
};

const consumePendingSyntheticRequest = (input: {
  method: CapturedRequestContextMethod;
  url: string;
  body: unknown;
}): boolean => {
  const now = Date.now();
  const queue = getSyntheticRequestQueue();
  if (queue.length === 0) {
    return false;
  }

  const serializedBody = JSON.stringify(input.body ?? null);
  let matched = false;
  const remaining = queue.filter((entry) => {
    if (entry.expires_at <= now) {
      return false;
    }
    if (!matched && entry.method === input.method && entry.url === input.url) {
      if (JSON.stringify(entry.body ?? null) === serializedBody) {
        matched = true;
        return false;
      }
    }
    return true;
  });
  setSyntheticRequestQueue(remaining);
  return matched;
};

const shouldCaptureRequest = (path: string): boolean => capturedRequestContextPathSet.has(path);

const resolveLatestBucketArtifact = (bucket: CapturedContextBucket): CapturedRequestContextArtifact | null => {
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
    if (!isCapturedRequestContextCommand(command) || pathname !== path || shapeMethod !== method) {
      return null;
    }
    return serializeCapturedContextRouteScope(
      createCapturedContextRouteScope(command, method, path)
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
  const referrer = typeof window.location?.href === "string" ? window.location.href : null;
  const pageContextNamespace = createPageContextNamespace(referrer ?? "about:blank");
  const templateReady = !candidate.synthetic && input.status >= 200 && input.status < 300;
  const contextShape = deriveCapturedContextShape(candidate, {
    responseBody: input.responseBody,
    templateReady
  });
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
    page_context_namespace: pageContextNamespace,
    shape_key: contextShape.shapeKey,
    shape: contextShape.shape,
    referrer,
    template_ready: templateReady,
    ...(candidate.synthetic
      ? { rejection_reason: "synthetic_request_rejected" as const }
      : !templateReady
        ? { rejection_reason: "failed_request_rejected" as const }
        : {}),
    request_status: {
      completion: templateReady ? "completed" : "failed",
      http_status: input.status
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
    pageContextNamespace,
    contextShape.routeScopeKey,
    contextShape.shapeKey
  );
  if (templateReady) {
    bucket.admittedTemplate = artifact;
    return;
  }
  bucket.rejectedObservation = artifact;
};

const resolveFetchCandidate = async (
  input: unknown,
  init?: RequestInit
): Promise<CapturedRequestCandidate | null> => {
  const baseHeaders = isRequestLike(input) ? headersToRecord(input.headers) : {};
  const initHeaders = headersToRecord(init?.headers);
  const headers = mergeHeaders(baseHeaders, initHeaders);
  const method = normalizeCapturedRequestMethod(init?.method ?? (isRequestLike(input) ? input.method : null));
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
  if (!url) {
    return null;
  }
  const path = resolvePathname(url);
  if (!path || !shouldCaptureRequest(path)) {
    return null;
  }
  const bodySource =
    init?.body !== undefined
      ? init.body
      : isRequestLike(input) && typeof input.clone === "function"
        ? await input.clone().text().catch(() => null)
        : null;
  const body = await readArtifactPayload(bodySource);
  return {
    transport: "fetch",
    method,
    path,
    url,
    headers,
    body,
    synthetic:
      isSyntheticRequest(headers) ||
      consumePendingSyntheticRequest({
        method,
        url,
        body
      })
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
    const response = await originalFetch.call(window, input, init);
    if (candidate) {
      await captureFetchResponse(candidate, response);
    }
    return response;
  };
  Object.defineProperty(patchedFetch, FETCH_CAPTURE_PATCH_SYMBOL, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true
  });
  window.fetch = patchedFetch;
};

const getXhrCaptureState = (xhr: XMLHttpRequest): XhrCaptureState | null =>
  ((xhr as XMLHttpRequest & { [XHR_CAPTURE_STATE_SYMBOL]?: XhrCaptureState | null })[
    XHR_CAPTURE_STATE_SYMBOL
  ] ?? null);

const setXhrCaptureState = (xhr: XMLHttpRequest, state: XhrCaptureState | null): void => {
  Object.defineProperty(xhr, XHR_CAPTURE_STATE_SYMBOL, {
    configurable: true,
    enumerable: false,
    writable: true,
    value: state
  });
};

type XMLHttpRequestPrototypeWithCapture = {
  open: XMLHttpRequest["open"];
  send: XMLHttpRequest["send"];
  setRequestHeader: XMLHttpRequest["setRequestHeader"];
  [XHR_CAPTURE_PATCH_SYMBOL]?: boolean;
};

const installXhrCapture = (): void => {
  const XhrCtor = globalThis.XMLHttpRequest as
    | ({
        new (): XMLHttpRequest;
        prototype: XMLHttpRequestPrototypeWithCapture;
      })
    | undefined;
  if (typeof XhrCtor !== "function") {
    return;
  }
  const prototype = XhrCtor.prototype as XMLHttpRequestPrototypeWithCapture;
  if (prototype[XHR_CAPTURE_PATCH_SYMBOL] === true) {
    return;
  }
  const originalOpen = prototype.open;
  const originalSend = prototype.send;
  const originalSetRequestHeader = prototype.setRequestHeader;
  if (
    typeof originalOpen !== "function" ||
    typeof originalSend !== "function" ||
    typeof originalSetRequestHeader !== "function"
  ) {
    return;
  }

  prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ): void {
    const normalizedMethod = normalizeCapturedRequestMethod(method);
    const resolvedUrl = resolveAbsoluteUrl(String(url));
    const resolvedPath = resolvedUrl ? resolvePathname(resolvedUrl) : null;
    setXhrCaptureState(
      this,
      normalizedMethod && resolvedUrl && resolvedPath
        ? {
            transport: "xhr",
            method: normalizedMethod,
            path: resolvedPath,
            url: resolvedUrl,
            headers: {},
            body: null,
            synthetic: false
          }
        : null
    );
    originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
  };

  prototype.setRequestHeader = function (
    this: XMLHttpRequest,
    name: string,
    value: string
  ): void {
    const state = getXhrCaptureState(this);
    if (state) {
      const normalizedName = normalizeHeaderName(name);
      state.headers[normalizedName] = value;
      state.synthetic = isSyntheticRequest(state.headers);
    }
    originalSetRequestHeader.call(this, name, value);
  };

  prototype.send = function (
    this: XMLHttpRequest,
    body?: Document | XMLHttpRequestBodyInit | null
  ): void {
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
            responseBody: parseArtifactPayloadText(
              typeof this.responseText === "string" ? this.responseText : ""
            )
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

const installCapturedRequestContextCapture = (): void => {
  installFetchCapture();
  installXhrCapture();
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
    if (shapeKey === requestedShapeKey) {
      continue;
    }
    const candidate = resolveLatestBucketArtifact(bucket);
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
        rejection_reason: "shape_mismatch"
      }
    : null;
};

const handleCapturedRequestContextReadRequest = async (request: MainWorldRequest): Promise<void> => {
  const method = normalizeCapturedRequestMethod(request.payload.method);
  const path = asString(request.payload.path);
  const namespace = asString(request.payload.page_context_namespace) as PageContextNamespace | null;
  const shapeKey = asString(request.payload.shape_key);
  const routeScopeKey = method && path && shapeKey ? resolveRouteScopeKeyFromLookup(method, path, shapeKey) : null;
  const result: CapturedRequestContextLookupResult | null =
    method && path && namespace && shapeKey && routeScopeKey
      ? (() => {
          const namespaceBuckets = capturedRequestContextBucketsByNamespace.get(namespace);
          const routeBucket = namespaceBuckets?.get(routeScopeKey) ?? null;
          const exactBucket = routeBucket?.get(shapeKey) ?? null;
          const availableShapeKeys = routeBucket ? [...routeBucket.keys()] : [];
          const admittedTemplate =
            exactBucket?.admittedTemplate &&
            exactBucket.admittedTemplate.method === method &&
            exactBucket.admittedTemplate.path === path
              ? exactBucket.admittedTemplate
              : null;
          const rejectedObservation =
            exactBucket?.rejectedObservation &&
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
installCapturedRequestContextCapture();
if (expectedMainWorldEventChannel) {
  attachMainWorldEventChannel(expectedMainWorldEventChannel);
} else {
  ensureBootstrapListener();
}
