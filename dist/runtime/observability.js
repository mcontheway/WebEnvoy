const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_MAX_TITLE_LENGTH = 120;
const DEFAULT_MAX_FAILURE_SUMMARY_LENGTH = 160;
const DEFAULT_MAX_REQUEST_REASON_LENGTH = 120;
const DEFAULT_MAX_FAILURE_TARGET_LENGTH = 160;
const REDACTED = "[REDACTED]";
const nonEmpty = (value, fallback) => {
    const normalized = typeof value === "string" ? value.trim() : "";
    return normalized.length > 0 ? normalized : fallback;
};
const truncate = (value, maxLength) => {
    if (maxLength <= 0) {
        return {
            value: "",
            truncated: value.length > 0
        };
    }
    if (value.length <= maxLength) {
        return {
            value,
            truncated: false
        };
    }
    return {
        value: value.slice(0, maxLength),
        truncated: true
    };
};
const stripQueryAndFragment = (value) => {
    const noFragment = value.split("#", 1)[0];
    return noFragment.split("?", 1)[0];
};
export const sanitizeUrl = (url) => {
    const normalized = nonEmpty(url ?? "", "");
    if (normalized.length === 0) {
        return "";
    }
    const isAbsolute = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalized);
    if (!isAbsolute) {
        return stripQueryAndFragment(normalized);
    }
    try {
        const parsed = new URL(normalized);
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
    catch {
        return stripQueryAndFragment(normalized);
    }
};
const pushUniqueField = (fields, field) => {
    if (!fields.includes(field)) {
        fields.push(field);
    }
};
const sanitizeFailureTarget = (value) => {
    const normalized = value.trim();
    const isAbsolute = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(normalized);
    const isPathLike = normalized.startsWith("/") || normalized.startsWith("./") || normalized.startsWith("../");
    if (isAbsolute || isPathLike) {
        return sanitizeUrl(normalized);
    }
    if (normalized.includes("?")) {
        return normalized.split("?", 1)[0] ?? normalized;
    }
    return normalized;
};
const sanitizeFreeText = (value) => value
    .replace(/\bauthorization\s*:\s*[^\n\r]+/gi, `authorization: ${REDACTED}`)
    .replace(/\bcookie\s*:\s*[^\n\r]+/gi, `cookie: ${REDACTED}`)
    .replace(/([?&])(token|access_token|id_token|refresh_token|signature|sig|auth|code)=([^&#\s]+)/gi, (_match, prefix, key) => `${prefix}${key}=${REDACTED}`)
    .replace(/\b(token|access_token|id_token|refresh_token|signature|sig|auth|code)\s*=\s*([^&\s,;]+)/gi, (_match, key) => `${key}=${REDACTED}`)
    .replace(/\b(token|access_token|id_token|refresh_token|signature|sig|auth|code)\s*:\s*([^\s,;]+)/gi, (_match, key) => `${key}: ${REDACTED}`);
export const normalizePageState = (input, options) => {
    if (input === null || input === undefined) {
        return null;
    }
    const maxTitleLength = options?.maxTitleLength ?? DEFAULT_MAX_TITLE_LENGTH;
    const pageKindRaw = typeof input.page_kind === "string" ? input.page_kind.trim() : "";
    const urlRaw = sanitizeUrl(input.url);
    const titleRaw = typeof input.title === "string" ? input.title.trim() : "";
    const readyStateRaw = typeof input.ready_state === "string" ? input.ready_state.trim() : "";
    const titleNormalized = nonEmpty(titleRaw, "unknown");
    const title = truncate(titleNormalized, maxTitleLength);
    const pageState = {
        page_kind: pageKindRaw.length > 0 ? pageKindRaw : "unknown",
        url: urlRaw.length > 0 ? urlRaw : "about:blank",
        title: title.value,
        ready_state: readyStateRaw.length > 0 ? readyStateRaw : "unknown"
    };
    const partialObservable = pageKindRaw.length === 0 || urlRaw.length === 0 || titleRaw.length === 0 || readyStateRaw.length === 0;
    if (partialObservable) {
        pageState.partial_observable = true;
    }
    if (title.truncated) {
        pageState.title_truncated = true;
    }
    return pageState;
};
const normalizeKeyRequest = (input, options) => {
    const maxReasonLength = options?.maxRequestReasonLength ?? DEFAULT_MAX_REQUEST_REASON_LENGTH;
    const output = {
        request_id: nonEmpty(input.request_id, "unknown"),
        stage: nonEmpty(input.stage, "unknown"),
        method: nonEmpty(input.method, "UNKNOWN").toUpperCase(),
        url: sanitizeUrl(input.url) || "/",
        outcome: nonEmpty(input.outcome, "unknown")
    };
    if (typeof input.status_code === "number") {
        output.status_code = input.status_code;
    }
    const failureReason = nonEmpty(input.failure_reason, "");
    if (failureReason.length > 0) {
        const truncated = truncate(sanitizeFreeText(failureReason), maxReasonLength);
        output.failure_reason = truncated.value;
        if (truncated.truncated) {
            output.failure_reason_truncated = true;
        }
    }
    const requestClass = nonEmpty(input.request_class, "");
    if (requestClass.length > 0) {
        output.request_class = requestClass;
    }
    return output;
};
export const normalizeKeyRequests = (input, options) => {
    const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;
    const list = Array.isArray(input) ? input : [];
    const normalized = list
        .filter((item) => item !== null && typeof item === "object" && !Array.isArray(item))
        .slice(0, Math.max(0, maxRequests));
    return normalized.map((item) => normalizeKeyRequest(item, options));
};
export const normalizeFailureSite = (input, options) => {
    if (input === null || input === undefined) {
        return null;
    }
    const maxTargetLength = options?.maxFailureTargetLength ?? DEFAULT_MAX_FAILURE_TARGET_LENGTH;
    const maxSummaryLength = options?.maxFailureSummaryLength ?? DEFAULT_MAX_FAILURE_SUMMARY_LENGTH;
    const target = truncate(nonEmpty(sanitizeFailureTarget(nonEmpty(input.target, "unknown")), "unknown"), maxTargetLength);
    const summary = truncate(sanitizeFreeText(nonEmpty(input.summary, "unknown")), maxSummaryLength);
    return {
        stage: nonEmpty(input.stage, "unknown"),
        component: nonEmpty(input.component, "unknown"),
        target: target.value,
        ...(target.truncated ? { target_truncated: true } : {}),
        summary: summary.value,
        ...(summary.truncated ? { summary_truncated: true } : {})
    };
};
export const buildObservabilityPayload = (input, options) => {
    const truncationFields = [];
    const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;
    const originalRequests = Array.isArray(input.key_requests) ? input.key_requests : [];
    const keyRequests = normalizeKeyRequests(input.key_requests, options);
    if (originalRequests.length > Math.max(0, maxRequests)) {
        pushUniqueField(truncationFields, "key_requests");
    }
    if (keyRequests.some((item) => item.failure_reason_truncated === true)) {
        pushUniqueField(truncationFields, "key_requests[].failure_reason");
    }
    const pageState = normalizePageState(input.page_state, options);
    if (pageState?.title_truncated) {
        pushUniqueField(truncationFields, "page_state.title");
    }
    const failureSite = normalizeFailureSite(input.failure_site, options);
    if (failureSite?.target_truncated) {
        pushUniqueField(truncationFields, "failure_site.target");
    }
    if (failureSite?.summary_truncated) {
        pushUniqueField(truncationFields, "failure_site.summary");
    }
    const hasSupplementalEvidence = keyRequests.length > 0 || failureSite !== null;
    const coverage = pageState === null
        ? hasSupplementalEvidence
            ? "partial"
            : "unavailable"
        : pageState.partial_observable
            ? "partial"
            : "complete";
    const requestEvidence = keyRequests.length > 0 ? "available" : "none";
    return {
        coverage,
        request_evidence: requestEvidence,
        truncation: {
            truncated: truncationFields.length > 0,
            fields: truncationFields
        },
        page_state: pageState,
        key_requests: keyRequests,
        failure_site: failureSite
    };
};
