export const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
export const WEBENVOY_SYNTHETIC_REQUEST_HEADER = "x-webenvoy-synthetic-request";
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
export const normalizeSearchRequestShapeInput = (input) => {
    const keyword = toTrimmedString(input.keyword);
    const page = input.page === undefined ? 1 : asInteger(input.page);
    const pageSize = input.page_size === undefined ? 20 : asInteger(input.page_size);
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
export const createSearchRequestShape = (input) => {
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
export const serializeSearchRequestShape = (shape) => JSON.stringify(shape);
export const resolveMainWorldPageContextNamespaceEventName = (secret) => `${MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX}${hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|namespace|${secret.trim()}`)}`;
export const createPageContextNamespace = (href) => {
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
export const createVisitedPageContextNamespace = (href, visitSequence) => {
    const baseNamespace = createPageContextNamespace(href);
    return visitSequence > 0 ? `${baseNamespace}|visit=${visitSequence}` : baseNamespace;
};
export const stripVisitedPageContextNamespace = (namespace) => {
    const visitSuffixIndex = namespace.indexOf("|visit=");
    return visitSuffixIndex >= 0 ? namespace.slice(0, visitSuffixIndex) : namespace;
};
export const resolveActiveVisitedPageContextNamespace = (requestedNamespace, currentVisitedNamespace) => {
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
