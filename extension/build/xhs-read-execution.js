import { createUserHomeRequestShape, createPageContextNamespace } from "./xhs-search-types.js";
import { createAuditRecord, resolveGate } from "./xhs-search-gate.js";
import { classifyXhsAccountSafetySurface, containsCookie, createDiagnosis, createFailure, resolveRiskStateOutput, resolveXsCommon } from "./xhs-search-telemetry.js";
const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";
const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60_000;
const REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS = 10;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 150;
const BACKEND_REJECTED_SOURCE_REASONS = new Set([
    "XHS_LOGIN_REQUIRED",
    "SESSION_EXPIRED",
    "ACCOUNT_ABNORMAL",
    "XHS_ACCOUNT_RISK_PAGE",
    "BROWSER_ENV_ABNORMAL",
    "GATEWAY_INVOKER_FAILED",
    "CAPTCHA_REQUIRED",
    "TARGET_API_RESPONSE_INVALID"
]);
const XHS_DETAIL_SPEC = {
    command: "xhs.detail",
    endpoint: DETAIL_ENDPOINT,
    method: "POST",
    pageKind: "detail",
    requestClass: "xhs.detail",
    buildPayload: (params) => ({
        source_note_id: params.note_id
    }),
    buildUrl: () => "/api/sns/web/v1/feed",
    buildSignatureUri: () => DETAIL_ENDPOINT,
    buildDataRef: (params) => ({
        note_id: params.note_id
    })
};
const XHS_USER_HOME_SPEC = {
    command: "xhs.user_home",
    endpoint: USER_HOME_ENDPOINT,
    method: "GET",
    pageKind: "user_home",
    requestClass: "xhs.user_home",
    buildPayload: () => ({}),
    buildUrl: (params) => `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent(params.user_id)}`,
    buildSignatureUri: (params) => `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent(params.user_id)}`,
    buildDataRef: (params) => ({
        user_id: params.user_id
    })
};
const READ_COMMAND_SPECS = {
    "xhs.detail": XHS_DETAIL_SPEC,
    "xhs.user_home": XHS_USER_HOME_SPEC
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asArray = (value) => (Array.isArray(value) ? value : null);
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
const parseJsonRecord = (value) => {
    if (typeof value === "string") {
        try {
            return asRecord(JSON.parse(value));
        }
        catch {
            return null;
        }
    }
    return asRecord(value);
};
const normalizeCapturedHeaders = (value) => {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    return Object.fromEntries(Object.entries(record).filter((entry) => typeof entry[1] === "string"));
};
const getCapturedHeader = (headers, key) => {
    const matchedEntry = Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    return matchedEntry && matchedEntry[1].trim().length > 0 ? matchedEntry[1].trim() : null;
};
const resolveCapturedArtifactHeaders = (value) => {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    const request = asRecord(record.request);
    return normalizeCapturedHeaders(record.template_headers ?? request?.headers);
};
const resolveCapturedArtifactReferrer = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return asString(record.referrer);
};
const resolveCapturedArtifactRequestUrl = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const rawUrl = asString(record.url);
    if (rawUrl) {
        try {
            const url = new URL(rawUrl, "https://www.xiaohongshu.com");
            return `${url.pathname}${url.search}`;
        }
        catch {
            return rawUrl;
        }
    }
    return asString(record.path);
};
const resolveCapturedArtifactRequestBody = (value) => {
    const record = asRecord(value);
    const request = asRecord(record?.request);
    return asRecord(request?.body);
};
const resolveCapturedArtifactStatus = (value) => {
    const record = asRecord(value);
    const requestStatus = asRecord(record?.request_status);
    const sourceKind = asString(record?.source_kind);
    const httpStatus = asInteger(requestStatus?.http_status) ?? asInteger(record?.status);
    const completion = asString(requestStatus?.completion);
    const templateReady = typeof record?.template_ready === "boolean" ? record.template_ready : null;
    const explicitReason = asString(record?.rejection_reason);
    const rejectionReason = explicitReason === "synthetic_request_rejected" ||
        explicitReason === "failed_request_rejected" ||
        explicitReason === "shape_mismatch"
        ? explicitReason
        : sourceKind !== null && sourceKind !== "page_request"
            ? "synthetic_request_rejected"
            : (completion !== null && completion !== "completed") ||
                (httpStatus !== null && (httpStatus < 200 || httpStatus >= 300))
                ? "failed_request_rejected"
                : templateReady === false
                    ? "failed_request_rejected"
                    : null;
    return {
        sourceKind,
        httpStatus,
        templateReady,
        rejectionReason
    };
};
const resolveCapturedArtifactObservedAt = (value) => {
    const record = asRecord(value);
    return asInteger(record?.observed_at) ?? asInteger(record?.captured_at);
};
const isCapturedArtifactStale = (value, now) => {
    const observedAt = resolveCapturedArtifactObservedAt(value);
    return observedAt === null || now - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS;
};
const resolveRejectedSourceDiagnostics = (spec, artifact) => {
    const status = resolveCapturedArtifactStatus(artifact);
    const response = asRecord(artifact.response);
    const responseBody = response?.body;
    const responseRecord = asRecord(responseBody);
    const platformCode = asInteger(responseRecord?.code);
    if (status.rejectionReason === "synthetic_request_rejected" ||
        status.rejectionReason === "shape_mismatch") {
        return {
            reason: status.rejectionReason,
            statusCode: status.httpStatus,
            platformCode
        };
    }
    if (status.rejectionReason === "failed_request_rejected") {
        const inferred = inferReadFailure(spec, status.httpStatus ?? 0, responseBody);
        if (BACKEND_REJECTED_SOURCE_REASONS.has(inferred.reason)) {
            return {
                reason: inferred.reason,
                statusCode: status.httpStatus,
                platformCode
            };
        }
        return {
            reason: "failed_request_rejected",
            statusCode: status.httpStatus,
            platformCode
        };
    }
    return {
        reason: "failed_request_rejected",
        statusCode: status.httpStatus,
        platformCode
    };
};
const resolveRejectedSourceMessage = (spec, reason) => {
    switch (reason) {
        case "XSEC_TOKEN_MISSING":
            return `当前页面现场缺少 ${spec.command} signed URL 或 xsec_token，无法继续执行`;
        case "XSEC_TOKEN_EMPTY":
            return `当前页面现场的 ${spec.command} xsec_token 为空，无法继续执行`;
        case "XSEC_TOKEN_STALE":
            return `当前页面现场的 ${spec.command} xsec_token 已过期，无法继续执行`;
        case "XSEC_SOURCE_MISMATCH":
            return `当前页面现场的 ${spec.command} xsec_source 与来源不匹配，无法继续执行`;
        case "SECURITY_REDIRECT":
            return "当前页面被安全重定向拦截，无法继续执行";
        case "SESSION_EXPIRED":
            return `登录已失效，无法执行 ${spec.command}`;
        case "XHS_LOGIN_REQUIRED":
            return "当前页面要求登录小红书，无法继续执行";
        case "ACCOUNT_ABNORMAL":
            return "账号异常，平台拒绝当前请求";
        case "XHS_ACCOUNT_RISK_PAGE":
            return "当前页面命中小红书账号风险或安全验证页面";
        case "BROWSER_ENV_ABNORMAL":
            return "浏览器环境异常，平台拒绝当前请求";
        case "GATEWAY_INVOKER_FAILED":
            return `网关调用失败，当前上下文不足以完成 ${spec.command} 请求`;
        case "CAPTCHA_REQUIRED":
            return "平台要求额外人机验证，无法继续执行";
        case "TARGET_API_RESPONSE_INVALID":
            return `${spec.command} 接口返回了未识别的失败响应`;
        default:
            return null;
    }
};
const isBackendRejectedSourceLookup = (lookupResult) => lookupResult.state === "rejected_source" &&
    (BACKEND_REJECTED_SOURCE_REASONS.has(lookupResult.reason) ||
        lookupResult.reason === "failed_request_rejected");
const SECURITY_REDIRECT_URL_PATTERN = /\/(security|captcha|verify|risk|safe|login)(\/|$)/i;
const classifySignedContinuitySourceRoute = (xsecSource) => {
    switch (xsecSource) {
        case "pc_search":
            return "xhs.search";
        case "pc_note":
            return "xhs.detail";
        case "pc_profile":
        case "pc_user":
            return "xhs.user_home";
        default:
            return "unknown";
    }
};
const isSecurityRedirectUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return SECURITY_REDIRECT_URL_PATTERN.test(url.pathname);
    }
    catch {
        return SECURITY_REDIRECT_URL_PATTERN.test(value);
    }
};
const resolveSignedContinuityUrl = (spec, expectedShape, value) => {
    if (!value || isSecurityRedirectUrl(value)) {
        return null;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        if (url.protocol !== "https:" || url.hostname !== "www.xiaohongshu.com") {
            return null;
        }
        if (spec.command === "xhs.detail") {
            const noteId = expectedShape.note_id;
            const expectedPaths = [`/explore/${noteId}`, `/discovery/item/${noteId}`];
            return expectedPaths.includes(url.pathname) ? url : null;
        }
        const userId = expectedShape.user_id;
        return url.pathname === `/user/profile/${userId}` ? url : null;
    }
    catch {
        return null;
    }
};
const resolveSignedContinuity = (spec, expectedShape, artifact) => {
    const record = asRecord(artifact);
    const referrer = resolveCapturedArtifactReferrer(record);
    const url = asString(record?.url);
    const signedUrl = resolveSignedContinuityUrl(spec, expectedShape, referrer) ??
        resolveSignedContinuityUrl(spec, expectedShape, url);
    const sourceUrl = referrer ?? url;
    const rawToken = signedUrl?.searchParams.get("xsec_token") ?? null;
    const xsecToken = rawToken === null ? null : rawToken.trim();
    const rawSource = signedUrl?.searchParams.get("xsec_source") ?? null;
    const xsecSource = rawSource === null ? null : rawSource.trim() || null;
    const tokenPresence = rawToken === null ? "missing" : rawToken.trim().length > 0 ? "present" : "empty";
    const targetUrl = signedUrl ? signedUrl.toString() : null;
    return {
        source_url: sourceUrl,
        target_url: targetUrl,
        ...(spec.command === "xhs.detail" ? { detail_url: targetUrl } : { user_home_url: targetUrl }),
        xsec_token: xsecToken,
        xsec_source: xsecSource,
        token_presence: tokenPresence,
        observed_at: resolveCapturedArtifactObservedAt(record),
        source_route: classifySignedContinuitySourceRoute(xsecSource)
    };
};
const resolveSignedContinuityFailure = (continuity, observedAt, now, pageUrl) => {
    if (isSecurityRedirectUrl(pageUrl) || isSecurityRedirectUrl(continuity.source_url)) {
        return "SECURITY_REDIRECT";
    }
    if (!continuity.target_url) {
        return "XSEC_TOKEN_MISSING";
    }
    if (continuity.token_presence === "missing") {
        return "XSEC_TOKEN_MISSING";
    }
    if (continuity.token_presence === "empty") {
        return "XSEC_TOKEN_EMPTY";
    }
    if (continuity.source_route !== "xhs.search" || continuity.xsec_source !== "pc_search") {
        return "XSEC_SOURCE_MISMATCH";
    }
    if (observedAt === null || now - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS) {
        return "XSEC_TOKEN_STALE";
    }
    return null;
};
const waitForRequestContextRetry = async (env, ms) => {
    if (typeof env.sleep === "function") {
        await env.sleep(ms);
        return;
    }
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};
const resolveExactShapeLookupArtifacts = (lookupRecord) => {
    const admittedTemplate = asRecord(lookupRecord.admitted_template);
    const rejectedObservation = asRecord(lookupRecord.rejected_observation);
    if (!admittedTemplate || !rejectedObservation) {
        return {
            admittedTemplate,
            rejectedObservation
        };
    }
    if (resolveCapturedArtifactStatus(rejectedObservation).rejectionReason === "synthetic_request_rejected") {
        return {
            admittedTemplate,
            rejectedObservation: null
        };
    }
    const admittedObservedAt = resolveCapturedArtifactObservedAt(admittedTemplate);
    const rejectedObservedAt = resolveCapturedArtifactObservedAt(rejectedObservation);
    if (rejectedObservedAt !== null &&
        (admittedObservedAt === null || rejectedObservedAt > admittedObservedAt)) {
        return {
            admittedTemplate: null,
            rejectedObservation
        };
    }
    return {
        admittedTemplate,
        rejectedObservation: null
    };
};
const parseUserIdFromUrl = (value) => {
    if (!value) {
        return null;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return asString(url.searchParams.get("user_id"));
    }
    catch {
        return null;
    }
};
const resolveDetailResponseNoteId = (value, preferredNoteId, options) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    let fallbackNoteId = null;
    for (const candidate of getDetailResponseCandidates(record)) {
        const candidateNoteId = asString(candidate.note_id) ?? asString(candidate.noteId);
        if (candidateNoteId) {
            if (preferredNoteId && candidateNoteId === preferredNoteId) {
                return candidateNoteId;
            }
            fallbackNoteId ??= candidateNoteId;
            continue;
        }
        if (options?.allowBareIdAlias &&
            asString(candidate.id)) {
            const bareId = asString(candidate.id);
            if (!preferredNoteId || bareId === preferredNoteId) {
                return bareId;
            }
            return bareId;
        }
    }
    return preferredNoteId ? null : fallbackNoteId;
};
const hasUserHomeResponseDataShape = (record) => [
    "nickname",
    "avatar",
    "avatar_url",
    "images",
    "follows",
    "fans",
    "basicInfo",
    "basic_info",
    "interactions"
].some((key) => key in record);
const iterateUserHomeResponseCandidates = (value) => {
    const collectCandidates = (candidate, seen = new Set()) => {
        const record = asRecord(candidate);
        if (record) {
            if (seen.has(record)) {
                return [];
            }
            seen.add(record);
            return [
                record,
                ...collectCandidates(record.basic_info, seen),
                ...collectCandidates(record.basicInfo, seen),
                ...collectCandidates(record.profile, seen),
                ...collectCandidates(record.user, seen)
            ];
        }
        if (Array.isArray(candidate)) {
            return candidate.flatMap((entry) => collectCandidates(entry, seen));
        }
        return [];
    };
    const responseRecord = asRecord(value);
    const dataRecord = asRecord(responseRecord?.data ?? value);
    if (!dataRecord) {
        return [];
    }
    return [
        ...collectCandidates(dataRecord.user),
        ...collectCandidates(dataRecord.basic_info),
        ...collectCandidates(dataRecord.basicInfo),
        ...collectCandidates(dataRecord.profile),
        ...(hasUserHomeResponseDataShape(dataRecord) ? [dataRecord] : [])
    ];
};
const resolveUserHomeResponseUserId = (value, preferredUserId) => {
    let fallbackUserId = null;
    for (const candidate of iterateUserHomeResponseCandidates(value)) {
        const userId = asString(candidate.user_id) ?? asString(candidate.userId);
        if (userId) {
            if (preferredUserId && userId === preferredUserId) {
                return userId;
            }
            fallbackUserId ??= userId;
        }
    }
    return preferredUserId ? null : fallbackUserId;
};
const createDetailShape = (noteId) => ({
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
});
const deriveReadShapeFromCommand = (spec, params) => spec.command === "xhs.detail"
    ? {
        command: "xhs.detail",
        method: "POST",
        pathname: DETAIL_ENDPOINT,
        note_id: params.note_id
    }
    : {
        command: "xhs.user_home",
        method: "GET",
        pathname: USER_HOME_ENDPOINT,
        user_id: params.user_id
    };
const deriveDetailShapeFromSource = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const noteId = asString(record.note_id);
    if (!noteId) {
        return null;
    }
    return createDetailShape(noteId);
};
const deriveDetailRejectedShapeFromRequestSource = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const noteId = asString(record.source_note_id);
    if (!noteId) {
        return null;
    }
    return createDetailShape(noteId);
};
const deriveUserHomeShapeFromSource = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const userId = asString(record.user_id) ?? asString(record.userId) ?? parseUserIdFromUrl(asString(record.url));
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
const deriveReadShapeFromArtifact = (spec, artifact, options) => {
    if (!artifact) {
        return null;
    }
    const record = asRecord(artifact);
    if (!record) {
        return null;
    }
    const artifactStatus = resolveCapturedArtifactStatus(record);
    const explicitShape = parseJsonRecord(record.shape);
    const response = asRecord(record.response);
    if (explicitShape) {
        if (spec.command === "xhs.detail") {
            const explicitDetailShape = deriveDetailShapeFromSource(explicitShape);
            const responseDetailShape = (() => {
                const preferredNoteId = options?.preferredDetailNoteId ?? explicitDetailShape?.note_id ?? null;
                const responseNoteId = resolveDetailResponseNoteId(response?.body, preferredNoteId, {
                    allowBareIdAlias: options?.allowDetailResponseBareIdAlias
                }) ??
                    resolveDetailResponseNoteId(response?.body);
                return responseNoteId ? createDetailShape(responseNoteId) : null;
            })();
            if (explicitDetailShape &&
                responseDetailShape &&
                responseDetailShape.note_id !== explicitDetailShape.note_id) {
                return responseDetailShape;
            }
            if (options?.allowDetailRequestFallback === false) {
                return responseDetailShape;
            }
            return explicitDetailShape;
        }
        const explicitUserHomeShape = deriveUserHomeShapeFromSource(explicitShape);
        if (artifactStatus.rejectionReason && explicitUserHomeShape) {
            return explicitUserHomeShape;
        }
        const responseUserId = resolveUserHomeResponseUserId(response?.body, explicitUserHomeShape?.user_id ?? null);
        return explicitUserHomeShape &&
            responseUserId &&
            responseUserId === explicitUserHomeShape.user_id
            ? explicitUserHomeShape
            : null;
    }
    if (spec.command === "xhs.detail") {
        const noteIdFromResponse = resolveDetailResponseNoteId(response?.body, options?.preferredDetailNoteId) ??
            resolveDetailResponseNoteId(response?.body);
        if (noteIdFromResponse) {
            return createDetailShape(noteIdFromResponse);
        }
    }
    const request = asRecord(record.request);
    if (spec.command === "xhs.detail" && resolveCapturedArtifactStatus(record).rejectionReason) {
        const rejectedRequestShape = deriveDetailRejectedShapeFromRequestSource(request?.body);
        if (rejectedRequestShape) {
            return rejectedRequestShape;
        }
    }
    if (spec.command === "xhs.detail" && options?.allowDetailRequestFallback !== false) {
        return deriveDetailShapeFromSource(request?.body);
    }
    const urlShape = deriveUserHomeShapeFromSource({ url: asString(record.url) });
    const requestShape = deriveUserHomeShapeFromSource(request?.body);
    const expectedUserId = urlShape?.user_id ?? requestShape?.user_id ?? null;
    if (artifactStatus.rejectionReason && expectedUserId) {
        return (createUserHomeRequestShape({
            user_id: expectedUserId
        }) ?? null);
    }
    return null;
};
const serializeReadShape = (shape) => shape.command === "xhs.detail"
    ? JSON.stringify({
        command: shape.command,
        method: shape.method,
        pathname: shape.pathname,
        note_id: shape.note_id
    })
    : JSON.stringify({
        command: shape.command,
        method: shape.method,
        pathname: shape.pathname,
        user_id: shape.user_id
    });
const resolveReadRequestContext = (spec, artifact, expectedShape, now, options) => {
    if (!artifact) {
        return {
            state: "miss",
            reason: "template_missing"
        };
    }
    const lookupRecord = asRecord(artifact);
    if (lookupRecord &&
        ("admitted_template" in lookupRecord ||
            "rejected_observation" in lookupRecord ||
            "incompatible_observation" in lookupRecord)) {
        const { admittedTemplate, rejectedObservation } = resolveExactShapeLookupArtifacts(lookupRecord);
        const incompatibleObservation = asRecord(lookupRecord.incompatible_observation);
        if (admittedTemplate) {
            return resolveReadRequestContext(spec, admittedTemplate, expectedShape, now, {
                allowDetailResponseBareIdAlias: false,
                allowDetailRequestFallback: false
            });
        }
        if (rejectedObservation) {
            const derivedShape = deriveReadShapeFromArtifact(spec, rejectedObservation, {
                preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
                allowDetailResponseBareIdAlias: true,
                allowDetailRequestFallback: true
            });
            if (derivedShape && serializeReadShape(derivedShape) !== serializeReadShape(expectedShape)) {
                return {
                    state: "incompatible",
                    reason: "shape_mismatch",
                    shape: derivedShape
                };
            }
            if (isCapturedArtifactStale(rejectedObservation, now)) {
                return {
                    state: "stale",
                    reason: "template_stale",
                    shape: derivedShape ?? expectedShape
                };
            }
            const rejectedDiagnostics = resolveRejectedSourceDiagnostics(spec, rejectedObservation);
            return {
                state: "rejected_source",
                reason: rejectedDiagnostics.reason,
                shape: derivedShape ?? expectedShape,
                statusCode: rejectedDiagnostics.statusCode,
                platformCode: rejectedDiagnostics.platformCode
            };
        }
        if (incompatibleObservation) {
            return {
                state: "incompatible",
                reason: "shape_mismatch",
                shape: deriveReadShapeFromArtifact(spec, incompatibleObservation, {
                    preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
                    allowDetailResponseBareIdAlias: true,
                    allowDetailRequestFallback: true
                })
            };
        }
        const availableShapeKeys = Array.isArray(lookupRecord.available_shape_keys)
            ? lookupRecord.available_shape_keys.filter((item) => typeof item === "string")
            : [];
        if (availableShapeKeys.some((candidateShapeKey) => candidateShapeKey !== lookupRecord.shape_key)) {
            return {
                state: "miss",
                reason: "shape_mismatch",
            };
        }
        return {
            state: "miss",
            reason: "template_missing"
        };
    }
    const derivedShape = deriveReadShapeFromArtifact(spec, artifact, {
        preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
        allowDetailResponseBareIdAlias: options?.allowDetailResponseBareIdAlias ?? false,
        allowDetailRequestFallback: spec.command === "xhs.detail" && !resolveCapturedArtifactStatus(artifact).rejectionReason
            ? false
            : (options?.allowDetailRequestFallback ?? true)
    });
    if (!derivedShape) {
        return {
            state: "miss",
            reason: "template_missing"
        };
    }
    const status = resolveCapturedArtifactStatus(artifact);
    if (serializeReadShape(derivedShape) !== serializeReadShape(expectedShape)) {
        return {
            state: "incompatible",
            reason: "shape_mismatch",
            shape: derivedShape
        };
    }
    if (isCapturedArtifactStale(artifact, now)) {
        return {
            state: "stale",
            reason: "template_stale",
            shape: derivedShape
        };
    }
    if (status.rejectionReason) {
        const rejectedDiagnostics = resolveRejectedSourceDiagnostics(spec, artifact);
        return {
            state: "rejected_source",
            reason: rejectedDiagnostics.reason,
            shape: derivedShape,
            statusCode: rejectedDiagnostics.statusCode,
            platformCode: rejectedDiagnostics.platformCode
        };
    }
    return {
        state: "hit",
        shape: derivedShape,
        headers: resolveCapturedArtifactHeaders(artifact),
        referrer: resolveCapturedArtifactReferrer(artifact),
        requestUrl: resolveCapturedArtifactRequestUrl(artifact),
        requestBody: resolveCapturedArtifactRequestBody(artifact),
        observedAt: resolveCapturedArtifactObservedAt(artifact),
        signedContinuity: resolveSignedContinuity(spec, expectedShape, artifact)
    };
};
const failClosedForRequestContext = (input, env) => {
    const failureSurface = resolveRequestContextFailureSurface(input.spec, input.lookupResult);
    const backendRejectedSource = isBackendRejectedSourceLookup(input.lookupResult);
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failureSurface.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failureSurface.reasonCode,
        request_context_result: failureSurface.resultKind,
        request_context_lookup_state: input.lookupResult.state,
        request_context_miss_reason: input.lookupResult.reason,
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        ...(input.lookupResult.state === "rejected_source" &&
            typeof input.lookupResult.statusCode === "number"
            ? { status_code: input.lookupResult.statusCode }
            : {}),
        ...(input.lookupResult.state === "rejected_source" &&
            typeof input.lookupResult.platformCode === "number"
            ? { platform_code: input.lookupResult.platformCode }
            : {}),
        ...("shape" in input.lookupResult && input.lookupResult.shape
            ? { captured_request_shape: input.lookupResult.shape }
            : {})
    }, createReadObservability({
        spec: input.spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        statusCode: input.lookupResult.state === "rejected_source" ? (input.lookupResult.statusCode ?? undefined) : undefined,
        failureReason: input.lookupResult.reason,
        includeKeyRequest: input.lookupResult.state === "rejected_source" &&
            BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason),
        failureSite: {
            stage: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? "request"
                : "execution",
            component: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? "network"
                : "page",
            target: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? input.spec.endpoint
                : "captured_request_context",
            summary: input.lookupResult.reason
        }
    }), createReadDiagnosis(input.spec, {
        reason: input.lookupResult.reason,
        summary: failureSurface.message,
        category: backendRejectedSource ? "request_failed" : "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const failClosedForSignedContinuity = (input, env) => {
    const message = resolveRejectedSourceMessage(input.spec, input.reason) ??
        `当前页面现场缺少可复用的 ${input.spec.command} signed continuity`;
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: input.reason,
        request_context_result: "signed_continuity_invalid",
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        signed_continuity: input.continuity
    }, createReadObservability({
        spec: input.spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: input.reason,
        includeKeyRequest: false,
        failureSite: {
            stage: "execution",
            component: "page",
            target: "xhs.signed_continuity",
            summary: message
        }
    }), createReadDiagnosis(input.spec, {
        reason: input.reason,
        summary: message,
        category: "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const resolveRequestContextFailureSurface = (spec, lookupResult) => {
    const isIncompatible = lookupResult.state === "incompatible" || lookupResult.reason === "shape_mismatch";
    if (lookupResult.state === "error") {
        return {
            resultKind: "request_context_missing",
            message: `当前页面现场请求上下文读取失败，无法继续执行 ${spec.command}`,
            reasonCode: "REQUEST_CONTEXT_READ_FAILED"
        };
    }
    const rejectedSourceMessage = lookupResult.state === "rejected_source"
        ? resolveRejectedSourceMessage(spec, lookupResult.reason)
        : null;
    const resultKind = isIncompatible ? "request_context_incompatible" : "request_context_missing";
    const message = rejectedSourceMessage ??
        (isIncompatible
            ? `当前页面现场不存在与 ${spec.command} 完全一致的请求上下文`
            : `当前页面现场缺少可复用的 ${spec.command} 请求上下文`);
    const reasonCode = rejectedSourceMessage && BACKEND_REJECTED_SOURCE_REASONS.has(lookupResult.reason)
        ? lookupResult.reason
        : isIncompatible
            ? "REQUEST_CONTEXT_INCOMPATIBLE"
            : "REQUEST_CONTEXT_MISSING";
    return {
        resultKind,
        message,
        reasonCode
    };
};
const readCapturedReadContextWithRetry = async (spec, expectedShape, env) => {
    const readCapturedRequestContext = env.readCapturedRequestContext;
    if (!readCapturedRequestContext) {
        return resolveReadRequestContext(spec, null, expectedShape, env.now());
    }
    let pageContextNamespace = createPageContextNamespace(env.getLocationHref());
    const lookupOnce = async () => {
        try {
            const result = await readCapturedRequestContext({
                method: spec.method,
                path: spec.endpoint,
                page_context_namespace: pageContextNamespace,
                shape_key: serializeReadShape(expectedShape)
            });
            const nextNamespace = asString(asRecord(result)?.page_context_namespace);
            if (nextNamespace) {
                pageContextNamespace = nextNamespace;
            }
            return resolveReadRequestContext(spec, result, expectedShape, env.now());
        }
        catch (error) {
            return {
                state: "error",
                reason: "request_context_read_failed",
                detail: error instanceof Error ? error.message : String(error)
            };
        }
    };
    let lastResult = await lookupOnce();
    for (let attempt = 1; attempt < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS && lastResult.state !== "hit"; attempt += 1) {
        await waitForRequestContextRetry(env, REQUEST_CONTEXT_WAIT_RETRY_MS);
        lastResult = await lookupOnce();
    }
    return lastResult;
};
const withExecutionAuditInFailurePayload = (result, executionAudit) => {
    if (result.ok) {
        return result;
    }
    return {
        ...result,
        payload: {
            ...result.payload,
            execution_audit: executionAudit
        }
    };
};
const classifyPageKind = (href, fallback) => {
    if (href.includes("/login")) {
        return "login";
    }
    if (href.includes("/search_result")) {
        return "search";
    }
    if (href.includes("/explore/")) {
        return "detail";
    }
    if (href.includes("/user/profile/")) {
        return "user_home";
    }
    return fallback;
};
const createReadObservability = (input) => ({
    page_state: {
        page_kind: classifyPageKind(input.href, input.spec.pageKind),
        url: input.href,
        title: input.title,
        ready_state: input.readyState
    },
    key_requests: input.includeKeyRequest === false
        ? []
        : [
            {
                request_id: input.requestId,
                stage: "request",
                method: input.spec.method,
                url: input.spec.endpoint,
                outcome: input.outcome,
                ...(typeof input.statusCode === "number" ? { status_code: input.statusCode } : {}),
                ...(input.failureReason
                    ? { failure_reason: input.failureReason, request_class: input.spec.requestClass }
                    : {})
            }
        ],
    failure_site: input.outcome === "failed"
        ? (input.failureSite ?? {
            stage: "request",
            component: "network",
            target: input.spec.endpoint,
            summary: input.failureReason ?? "request failed"
        })
        : null
});
const inferReadFailure = (spec, status, body) => {
    const record = asRecord(body);
    const businessCode = asInteger(record?.code);
    const message = typeof record?.msg === "string"
        ? record.msg
        : typeof record?.message === "string"
            ? record.message
            : "";
    const normalized = `${message}`.toLowerCase();
    const hasCaptchaEvidence = normalized.includes("captcha") ||
        message.includes("验证码") ||
        message.includes("人机验证") ||
        message.includes("滑块");
    if (status === 401 || normalized.includes("login")) {
        return {
            reason: "SESSION_EXPIRED",
            message: `登录已失效，无法执行 ${spec.command}`
        };
    }
    if (status === 461 || businessCode === 300011) {
        return {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求"
        };
    }
    if (businessCode === 300015 || normalized.includes("browser environment abnormal")) {
        return {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求"
        };
    }
    if (status >= 500 || normalized.includes("create invoker failed")) {
        return {
            reason: "GATEWAY_INVOKER_FAILED",
            message: `网关调用失败，当前上下文不足以完成 ${spec.command} 请求`
        };
    }
    if (hasCaptchaEvidence) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    return {
        reason: "TARGET_API_RESPONSE_INVALID",
        message: `${spec.command} 接口返回了未识别的失败响应`
    };
};
const inferReadRequestException = (spec, error) => {
    const errorName = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorName === "AbortError") {
        return {
            reason: "REQUEST_TIMEOUT",
            message: `请求超时，无法完成 ${spec.command}`,
            detail: errorMessage
        };
    }
    return {
        reason: "REQUEST_DISPATCH_FAILED",
        message: `${spec.command} 请求发送失败，无法完成执行`,
        detail: errorMessage
    };
};
const containsTargetIdentifier = (value, target, candidateKeys) => {
    const record = asRecord(value);
    if (record) {
        for (const key of candidateKeys) {
            if (typeof record[key] === "string" && record[key] === target) {
                return true;
            }
        }
    }
    return false;
};
const collectCandidateRecords = (value) => {
    const record = asRecord(value);
    if (record) {
        return [record];
    }
    const array = asArray(value);
    if (array) {
        return array.map((entry) => asRecord(entry)).filter((entry) => entry !== null);
    }
    return [];
};
const collectNestedRecordCandidates = (value, nestedKeys, seen = new Set()) => {
    const directCandidates = collectCandidateRecords(value);
    const nestedCandidates = [];
    for (const candidate of directCandidates) {
        if (seen.has(candidate)) {
            continue;
        }
        seen.add(candidate);
        nestedCandidates.push(candidate);
        for (const key of nestedKeys) {
            nestedCandidates.push(...collectNestedRecordCandidates(candidate[key], nestedKeys, seen));
        }
    }
    return nestedCandidates;
};
const hasDetailDataShape = (record) => [
    "title",
    "desc",
    "user",
    "interact_info",
    "image_list",
    "video_info",
    "note_card",
    "note_card_list"
].some((key) => key in record);
const hasUserDataShape = (record) => [
    "nickname",
    "avatar",
    "avatar_url",
    "images",
    "follows",
    "fans",
    "basicInfo",
    "basic_info",
    "interactions"
].some((key) => key in record);
const getDetailResponseCandidates = (body) => {
    const responseRecord = asRecord(body);
    const data = responseRecord?.data ?? body;
    const dataRecord = asRecord(data);
    if (!dataRecord) {
        return [];
    }
    return [
        ...collectNestedRecordCandidates(dataRecord.note, ["note", "note_card", "current_note", "item"]),
        ...collectNestedRecordCandidates(dataRecord.note_card, ["note", "note_card", "current_note", "item"]),
        ...collectNestedRecordCandidates(dataRecord.note_card_list, [
            "note",
            "note_card",
            "current_note",
            "item"
        ]),
        ...collectNestedRecordCandidates(dataRecord.current_note, ["note", "note_card", "current_note", "item"]),
        ...collectNestedRecordCandidates(dataRecord.item, ["note", "note_card", "current_note", "item"]),
        ...collectNestedRecordCandidates(dataRecord.items, ["note", "note_card", "current_note", "item"]),
        ...collectNestedRecordCandidates(dataRecord.notes, ["note", "note_card", "current_note", "item"]),
        ...(hasDetailDataShape(dataRecord) ? [dataRecord] : [])
    ];
};
const getUserHomeResponseCandidates = (body) => {
    const responseRecord = asRecord(body);
    const data = responseRecord?.data ?? body;
    const dataRecord = asRecord(data);
    if (!dataRecord) {
        return [];
    }
    return [
        ...collectNestedRecordCandidates(dataRecord.user, ["basic_info", "basicInfo", "profile", "user"]),
        ...collectNestedRecordCandidates(dataRecord.basic_info, [
            "basic_info",
            "basicInfo",
            "profile",
            "user"
        ]),
        ...collectNestedRecordCandidates(dataRecord.basicInfo, [
            "basic_info",
            "basicInfo",
            "profile",
            "user"
        ]),
        ...collectNestedRecordCandidates(dataRecord.profile, ["basic_info", "basicInfo", "profile", "user"]),
        ...(hasUserDataShape(dataRecord) ? [dataRecord] : [])
    ];
};
const responseContainsRequestedTarget = (spec, params, body) => {
    if (spec.command === "xhs.detail") {
        return getDetailResponseCandidates(body).some((candidate) => containsTargetIdentifier(candidate, params.note_id, [
            "note_id",
            "noteId"
        ]));
    }
    return getUserHomeResponseCandidates(body).some((candidate) => containsTargetIdentifier(candidate, params.user_id, [
        "user_id",
        "userId"
    ]));
};
const createReadDiagnosis = (spec, input) => {
    const diagnosis = createDiagnosis(input);
    const failureSite = asRecord(diagnosis.failure_site);
    const shouldUseEndpointTarget = (typeof failureSite?.component === "string" ? failureSite.component : null) === "network";
    return {
        ...diagnosis,
        failure_site: {
            ...(failureSite ?? {}),
            ...(shouldUseEndpointTarget ? { target: spec.endpoint } : {}),
            summary: input.summary
        }
    };
};
const hasDetailPageStateFallback = (params, root) => {
    const note = asRecord(root?.note);
    const noteDetailMap = asRecord(note?.noteDetailMap);
    return asRecord(noteDetailMap?.[params.note_id]) !== null;
};
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const hasUserHomePageStateFallback = (params, root) => {
    const user = asRecord(root?.user);
    if (!user) {
        return false;
    }
    const candidateUserIds = [
        asNonEmptyString(user.userId),
        asNonEmptyString(user.user_id),
        asNonEmptyString(user.id),
        asNonEmptyString(asRecord(user.basic_info)?.userId),
        asNonEmptyString(asRecord(user.basic_info)?.user_id),
        asNonEmptyString(asRecord(user.basicInfo)?.userId),
        asNonEmptyString(asRecord(user.basicInfo)?.user_id),
        asNonEmptyString(asRecord(asRecord(user.profile)?.basic_info)?.userId),
        asNonEmptyString(asRecord(asRecord(user.profile)?.basic_info)?.user_id),
        asNonEmptyString(asRecord(asRecord(user.profile)?.basicInfo)?.userId),
        asNonEmptyString(asRecord(asRecord(user.profile)?.basicInfo)?.user_id),
        asNonEmptyString(asRecord(user.profile)?.userId),
        asNonEmptyString(asRecord(user.profile)?.user_id)
    ].filter((value) => value !== null);
    if (!candidateUserIds.some((userId) => userId === params.user_id)) {
        return false;
    }
    return (asRecord(root?.board) !== null ||
        asRecord(root?.note) !== null ||
        hasUserHomeResponseDataShape(user) ||
        asRecord(user.basic_info) !== null ||
        asRecord(user.basicInfo) !== null ||
        asRecord(user.profile) !== null);
};
const canUsePageStateFallback = (spec, params, root) => spec.command === "xhs.detail"
    ? hasDetailPageStateFallback(params, root)
    : hasUserHomePageStateFallback(params, root);
const createPageStateFallbackFailure = (input, spec, gate, auditRecord, env, payload, startedAt, requestFailure) => {
    const requestId = `req-${env.randomId()}`;
    const requestAttempted = requestFailure.requestAttempted !== false;
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", requestFailure.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: requestFailure.reason,
        ...(typeof requestFailure.statusCode === "number" ? { status_code: requestFailure.statusCode } : {}),
        ...(typeof requestFailure.platformCode === "number" ? { platform_code: requestFailure.platformCode } : {}),
        ...(requestFailure.requestContextDetails ?? {})
    }, {
        page_state: {
            page_kind: classifyPageKind(env.getLocationHref(), spec.pageKind),
            url: env.getLocationHref(),
            title: env.getDocumentTitle(),
            ready_state: env.getReadyState(),
            fallback_used: true
        },
        key_requests: [
            ...(requestAttempted
                ? [
                    {
                        request_id: requestId,
                        stage: "request",
                        method: spec.method,
                        url: spec.endpoint,
                        outcome: "failed",
                        ...(typeof requestFailure.statusCode === "number"
                            ? { status_code: requestFailure.statusCode }
                            : {}),
                        failure_reason: requestFailure.reason,
                        request_class: spec.requestClass
                    }
                ]
                : []),
            {
                request_id: `${requestId}-page-state`,
                stage: "page_state_fallback",
                method: "N/A",
                url: env.getLocationHref(),
                outcome: "completed",
                fallback_reason: requestFailure.reason,
                data_ref: spec.buildDataRef(input.params, payload),
                duration_ms: Math.max(0, env.now() - startedAt)
            }
        ],
        failure_site: requestFailure.failureSite ??
            (requestAttempted
                ? {
                    stage: "request",
                    component: "network",
                    target: spec.endpoint,
                    summary: requestFailure.message
                }
                : {
                    stage: "execution",
                    component: "page",
                    target: "captured_request_context",
                    summary: requestFailure.message
                })
    }, createReadDiagnosis(spec, {
        reason: requestFailure.reason,
        summary: requestFailure.message
    }), gate, auditRecord), gate.execution_audit);
};
const createGateOnlySuccess = (input, spec, gate, auditRecord, env, payload) => ({
    ok: true,
    payload: {
        summary: {
            capability_result: {
                ability_id: input.abilityId,
                layer: input.abilityLayer,
                action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                outcome: "partial",
                data_ref: spec.buildDataRef(input.params, payload),
                metrics: {
                    count: 0
                }
            },
            scope_context: gate.scope_context,
            gate_input: {
                run_id: auditRecord.run_id,
                session_id: auditRecord.session_id,
                profile: auditRecord.profile,
                ...gate.gate_input
            },
            gate_outcome: gate.gate_outcome,
            read_execution_policy: gate.read_execution_policy,
            issue_action_matrix: gate.issue_action_matrix,
            write_interaction_tier: gate.write_interaction_tier,
            write_action_matrix_decisions: gate.write_action_matrix_decisions,
            consumer_gate_result: gate.consumer_gate_result,
            request_admission_result: gate.request_admission_result,
            execution_audit: gate.execution_audit,
            approval_record: gate.approval_record,
            risk_state_output: resolveRiskStateOutput(gate, auditRecord),
            audit_record: auditRecord
        },
        observability: {
            page_state: {
                page_kind: classifyPageKind(env.getLocationHref(), spec.pageKind),
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: null
        }
    }
});
const resolveSimulatedResult = (input, spec, payload, env, gate, auditRecord) => {
    if (!input.options.simulate_result) {
        return null;
    }
    const requestId = `req-${env.randomId()}`;
    const dataRef = spec.buildDataRef(input.params, payload);
    if (input.options.simulate_result === "success") {
        return {
            ok: true,
            payload: {
                summary: {
                    capability_result: {
                        ability_id: input.abilityId,
                        layer: input.abilityLayer,
                        action: input.abilityAction,
                        outcome: "success",
                        data_ref: dataRef,
                        metrics: {
                            count: 1
                        }
                    }
                },
                observability: createReadObservability({
                    spec,
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId,
                    outcome: "completed"
                })
            }
        };
    }
    if (input.options.simulate_result === "missing_capability_result") {
        return {
            ok: true,
            payload: {
                summary: {},
                observability: createReadObservability({
                    spec,
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId,
                    outcome: "completed"
                })
            }
        };
    }
    if (input.options.simulate_result === "capability_result_invalid_outcome") {
        return {
            ok: true,
            payload: {
                summary: {
                    capability_result: {
                        ability_id: input.abilityId,
                        layer: input.abilityLayer,
                        action: input.abilityAction,
                        outcome: "blocked",
                        data_ref: dataRef,
                        metrics: {
                            count: 1
                        }
                    }
                },
                observability: createReadObservability({
                    spec,
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId,
                    outcome: "completed"
                })
            }
        };
    }
    const simulatedReasonMap = {
        signature_entry_missing: {
            reason: "SIGNATURE_ENTRY_MISSING",
            message: "页面签名入口不可用"
        },
        account_abnormal: {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求",
            statusCode: 461
        },
        browser_env_abnormal: {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求",
            statusCode: 200
        },
        captcha_required: {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行",
            statusCode: 429
        },
        gateway_invoker_failed: {
            reason: "GATEWAY_INVOKER_FAILED",
            message: `网关调用失败，当前上下文不足以完成 ${spec.command} 请求`,
            statusCode: 500
        }
    };
    const mapped = simulatedReasonMap[input.options.simulate_result] ??
        inferReadFailure(spec, input.options.simulate_result === "account_abnormal" ? 461 : 500, {
            code: input.options.simulate_result === "account_abnormal" ? 300011 : undefined,
            msg: input.options.simulate_result === "browser_env_abnormal"
                ? "Browser environment abnormal"
                : input.options.simulate_result === "gateway_invoker_failed"
                    ? "create invoker failed"
                    : input.options.simulate_result
        });
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", mapped.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: mapped.reason
    }, createReadObservability({
        spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId,
        outcome: "failed",
        ...(typeof mapped.statusCode === "number" ? { statusCode: mapped.statusCode } : {}),
        failureReason: input.options.simulate_result
    }), createReadDiagnosis(spec, {
        reason: mapped.reason,
        summary: mapped.message
    }), gate, auditRecord), gate?.execution_audit ?? null);
};
const buildHeaders = (env, options, signature, capturedHeaders) => ({
    Accept: getCapturedHeader(capturedHeaders ?? {}, "Accept") ?? "application/json, text/plain, */*",
    ...(options.target_domain === "www.xiaohongshu.com" || options.target_domain === undefined
        ? {}
        : {}),
    ...(signature
        ? {
            "X-s": String(signature["X-s"]),
            "X-t": String(signature["X-t"]),
            "X-S-Common": getCapturedHeader(capturedHeaders ?? {}, "X-S-Common") ??
                options.x_s_common ??
                resolveXsCommon(undefined),
            "x-b3-traceid": env.randomId().replace(/-/g, ""),
            "x-xray-traceid": env.randomId().replace(/-/g, "")
        }
        : {}),
    "Content-Type": getCapturedHeader(capturedHeaders ?? {}, "Content-Type") ?? "application/json;charset=utf-8"
});
const executeXhsRead = async (input, spec, env) => {
    const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const startedAt = env.now();
    const builtPayload = spec.buildPayload(input.params, env);
    const resolvePageStateRoot = async () => {
        const mainWorldState = typeof env.readPageStateRoot === "function"
            ? await env.readPageStateRoot().catch(() => null)
            : null;
        const mainWorldRecord = asRecord(mainWorldState);
        if (mainWorldRecord) {
            return mainWorldRecord;
        }
        return asRecord(env.getPageStateRoot?.());
    };
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `执行模式门禁阻断了当前 ${spec.command} 请求`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "EXECUTION_MODE_GATE_BLOCKED",
            failureSite: {
                stage: "execution",
                component: "gate",
                target: "requested_execution_mode",
                summary: "执行模式门禁阻断"
            }
        }), createReadDiagnosis(spec, {
            reason: "EXECUTION_MODE_GATE_BLOCKED",
            summary: "执行模式门禁阻断"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, spec, gate, auditRecord, env, builtPayload);
    }
    const simulated = resolveSimulatedResult(input, spec, builtPayload, env, gate, auditRecord);
    if (simulated) {
        if (simulated.ok) {
            const summary = asRecord(simulated.payload.summary) ?? {};
            const capability = asRecord(summary.capability_result) ?? {};
            capability.ability_id = input.abilityId;
            capability.layer = input.abilityLayer;
            capability.action = gate.consumer_gate_result.action_type ?? input.abilityAction;
            return {
                ok: true,
                payload: {
                    ...simulated.payload,
                    summary: {
                        capability_result: capability,
                        scope_context: gate.scope_context,
                        gate_input: {
                            run_id: auditRecord.run_id,
                            session_id: auditRecord.session_id,
                            profile: auditRecord.profile,
                            ...gate.gate_input
                        },
                        gate_outcome: gate.gate_outcome,
                        read_execution_policy: gate.read_execution_policy,
                        issue_action_matrix: gate.issue_action_matrix,
                        consumer_gate_result: gate.consumer_gate_result,
                        request_admission_result: gate.request_admission_result,
                        execution_audit: gate.execution_audit,
                        approval_record: gate.approval_record,
                        risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                        audit_record: auditRecord
                    }
                }
            };
        }
        return {
            ...simulated,
            payload: {
                ...simulated.payload,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                request_admission_result: gate.request_admission_result,
                execution_audit: gate.execution_audit,
                approval_record: gate.approval_record,
                audit_record: auditRecord
            }
        };
    }
    const accountSafetySurface = classifyXhsAccountSafetySurface({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        bodyText: env.getBodyText?.(),
        overlay: env.getAccountSafetyOverlay?.()
    });
    if (accountSafetySurface) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", accountSafetySurface.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: accountSafetySurface.reason,
            page_url: env.getLocationHref()
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: accountSafetySurface.reason,
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "xhs.account_safety_surface",
                summary: accountSafetySurface.message
            }
        }), createReadDiagnosis(spec, {
            reason: accountSafetySurface.reason,
            summary: accountSafetySurface.message,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `登录态缺失，无法执行 ${spec.command}`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createReadDiagnosis(spec, {
            reason: "SESSION_EXPIRED",
            summary: `登录态缺失，无法执行 ${spec.command}`
        }), gate, auditRecord), gate.execution_audit);
    }
    const expectedShape = deriveReadShapeFromCommand(spec, input.params);
    const requestContextResult = await readCapturedReadContextWithRetry(spec, expectedShape, env);
    if (requestContextResult.state !== "hit") {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            const failureSurface = resolveRequestContextFailureSurface(spec, requestContextResult);
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, builtPayload, startedAt, {
                reason: failureSurface.reasonCode,
                message: failureSurface.message,
                detail: requestContextResult.reason,
                statusCode: requestContextResult.state === "rejected_source" ? (requestContextResult.statusCode ?? undefined) : undefined,
                platformCode: requestContextResult.state === "rejected_source"
                    ? (requestContextResult.platformCode ?? undefined)
                    : undefined,
                requestAttempted: requestContextResult.state === "rejected_source" &&
                    BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason),
                failureSite: {
                    stage: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? "request"
                        : "execution",
                    component: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? "network"
                        : "page",
                    target: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? spec.endpoint
                        : "captured_request_context",
                    summary: failureSurface.message
                },
                requestContextDetails: {
                    request_context_result: failureSurface.resultKind,
                    request_context_lookup_state: requestContextResult.state,
                    request_context_miss_reason: requestContextResult.reason,
                    request_context_shape: expectedShape,
                    request_context_shape_key: serializeReadShape(expectedShape),
                    ...(requestContextResult.state === "rejected_source" &&
                        typeof requestContextResult.statusCode === "number"
                        ? { status_code: requestContextResult.statusCode }
                        : {}),
                    ...(requestContextResult.state === "rejected_source" &&
                        typeof requestContextResult.platformCode === "number"
                        ? { platform_code: requestContextResult.platformCode }
                        : {}),
                    ...("shape" in requestContextResult && requestContextResult.shape
                        ? { captured_request_shape: requestContextResult.shape }
                        : {})
                }
            });
        }
        return failClosedForRequestContext({
            abilityId: input.abilityId,
            spec,
            expectedShape,
            lookupResult: requestContextResult,
            gate,
            auditRecord
        }, env);
    }
    const requestPayload = requestContextResult.requestBody ?? builtPayload;
    const requestUrl = requestContextResult.requestUrl ?? spec.buildUrl(input.params);
    const signatureUri = requestContextResult.requestUrl ?? spec.buildSignatureUri(input.params);
    const continuityFailure = resolveSignedContinuityFailure(requestContextResult.signedContinuity, requestContextResult.observedAt, env.now(), env.getLocationHref());
    if (continuityFailure) {
        return failClosedForSignedContinuity({
            abilityId: input.abilityId,
            spec,
            expectedShape,
            reason: continuityFailure,
            continuity: requestContextResult.signedContinuity,
            gate,
            auditRecord
        }, env);
    }
    let signature;
    try {
        signature = await env.callSignature(signatureUri, requestPayload);
    }
    catch (error) {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: "SIGNATURE_ENTRY_MISSING",
                message: "页面签名入口不可用",
                detail: error instanceof Error ? error.message : String(error),
                requestAttempted: false,
                failureSite: {
                    stage: "action",
                    component: "page",
                    target: "window._webmsxyw",
                    summary: "页面签名入口不可用"
                }
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SIGNATURE_ENTRY_MISSING"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: error instanceof Error ? error.message : String(error),
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "window._webmsxyw",
                summary: "页面签名入口不可用"
            }
        }), createReadDiagnosis(spec, {
            reason: "SIGNATURE_ENTRY_MISSING",
            summary: "页面签名入口不可用",
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    let response;
    try {
        response = await env.fetchJson({
            url: requestUrl,
            method: spec.method,
            headers: buildHeaders(env, input.options, signature, requestContextResult.headers),
            ...(spec.method === "POST" ? { body: JSON.stringify(requestPayload) } : {}),
            pageContextRequest: true,
            referrer: requestContextResult.referrer ?? env.getLocationHref(),
            referrerPolicy: "strict-origin-when-cross-origin",
            timeoutMs: typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
                ? Math.max(1, Math.floor(input.options.timeout_ms))
                : 30_000
        });
    }
    catch (error) {
        const failure = inferReadRequestException(spec, error);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.detail
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: failure.detail
        }), createReadDiagnosis(spec, {
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = asInteger(responseRecord?.code);
    if (response.status >= 400 || (businessCode !== null && businessCode !== 0)) {
        const failure = inferReadFailure(spec, response.status, response.body);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.message,
                statusCode: response.status,
                platformCode: businessCode ?? undefined
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason,
            status_code: response.status,
            ...(businessCode !== null ? { platform_code: businessCode } : {})
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            statusCode: response.status,
            failureReason: failure.reason
        }), createReadDiagnosis(spec, {
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
    }
    if (!responseContainsRequestedTarget(spec, input.params, response.body)) {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: "TARGET_DATA_NOT_FOUND",
                message: `${spec.command} 接口返回成功但未包含目标数据`,
                detail: `${spec.command} response target missing`,
                statusCode: response.status
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `${spec.command} 接口返回成功但未包含目标数据`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "TARGET_DATA_NOT_FOUND"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            statusCode: response.status,
            failureReason: "TARGET_DATA_NOT_FOUND"
        }), createReadDiagnosis(spec, {
            reason: "TARGET_DATA_NOT_FOUND",
            summary: `${spec.command} 接口返回成功但未包含目标数据`
        }), gate, auditRecord), gate.execution_audit);
    }
    return {
        ok: true,
        payload: {
            summary: {
                capability_result: {
                    ability_id: input.abilityId,
                    layer: input.abilityLayer,
                    action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                    outcome: "success",
                    data_ref: spec.buildDataRef(input.params, requestPayload),
                    metrics: {
                        count: 1,
                        duration_ms: Math.max(0, env.now() - startedAt)
                    }
                },
                scope_context: gate.scope_context,
                gate_input: {
                    run_id: auditRecord.run_id,
                    session_id: auditRecord.session_id,
                    profile: auditRecord.profile,
                    ...gate.gate_input
                },
                gate_outcome: gate.gate_outcome,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                request_admission_result: gate.request_admission_result,
                execution_audit: gate.execution_audit,
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                audit_record: auditRecord,
                signed_continuity: requestContextResult.signedContinuity
            },
            observability: createReadObservability({
                spec,
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "completed",
                statusCode: response.status
            })
        }
    };
};
export const executeXhsDetail = async (input, env) => executeXhsRead({
    command: "xhs.detail",
    ...input
}, READ_COMMAND_SPECS["xhs.detail"], env);
export const executeXhsUserHome = async (input, env) => executeXhsRead({
    command: "xhs.user_home",
    ...input
}, READ_COMMAND_SPECS["xhs.user_home"], env);
