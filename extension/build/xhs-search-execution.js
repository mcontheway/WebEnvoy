import { createPageContextNamespace, createSearchRequestShape, SEARCH_ENDPOINT, serializeSearchRequestShape } from "./xhs-search-types.js";
import { createAuditRecord, createGateOnlySuccess, resolveGate } from "./xhs-search-gate.js";
import { buildEditorInputEvidence, classifyXhsAccountSafetySurface, containsCookie, createDiagnosis, createFailure, createObservability, inferFailure, isTrustedEditorInputValidation, parseCount, resolveSimulatedResult, resolveRiskStateOutput } from "./xhs-search-telemetry.js";
import { buildXhsSearchLayer2InteractionEvidence } from "./layer2-humanized-events.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
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
const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
const REQUEST_CONTEXT_WAIT_MAX_MS = 15_000;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 250;
const REQUEST_CONTEXT_FORWARD_DEADLINE_SAFETY_MS = 1_000;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const toIsoString = (value) => new Date(value).toISOString();
const normalizeSearchQueryText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
};
const isCurrentSearchPageForQuery = (href, query) => {
    const expectedQuery = normalizeSearchQueryText(query);
    if (!expectedQuery) {
        return false;
    }
    try {
        const url = new URL(href);
        if (url.hostname !== "www.xiaohongshu.com" || !url.pathname.includes("/search_result")) {
            return false;
        }
        return normalizeSearchQueryText(url.searchParams.get("keyword")) === expectedQuery;
    }
    catch {
        return false;
    }
};
const pickFirstString = (record, keys) => {
    for (const key of keys) {
        const value = asString(record[key]);
        if (value) {
            return value;
        }
    }
    return null;
};
const normalizeXhsUrl = (value) => {
    if (!value) {
        return null;
    }
    try {
        return new URL(value, "https://www.xiaohongshu.com").toString();
    }
    catch {
        return value;
    }
};
const isXhsNoteCardUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return (url.hostname === "www.xiaohongshu.com" &&
            (url.pathname.startsWith("/explore/") || url.pathname.startsWith("/discovery/item/")));
    }
    catch {
        return false;
    }
};
const isXhsUserProfileUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/user/profile/");
    }
    catch {
        return false;
    }
};
const parseXsecFromUrl = (value) => {
    if (!value) {
        return {
            xsec_token: null,
            xsec_source: null
        };
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return {
            xsec_token: asString(url.searchParams.get("xsec_token")),
            xsec_source: asString(url.searchParams.get("xsec_source"))
        };
    }
    catch {
        return {
            xsec_token: null,
            xsec_source: null
        };
    }
};
const buildXhsContinuityUrl = (input) => {
    if (!input.id || !input.xsecToken) {
        return null;
    }
    const path = input.kind === "note"
        ? `/explore/${encodeURIComponent(input.id)}`
        : `/user/profile/${encodeURIComponent(input.id)}`;
    const url = new URL(path, "https://www.xiaohongshu.com");
    url.searchParams.set("xsec_token", input.xsecToken);
    if (input.xsecSource) {
        url.searchParams.set("xsec_source", input.xsecSource);
    }
    return url.toString();
};
const collectSearchDomCards = (value, seen = new Set()) => {
    const record = asRecord(value);
    if (record) {
        if (seen.has(record)) {
            return [];
        }
        seen.add(record);
        const userRecord = asRecord(record.user) ?? asRecord(record.author);
        const noteCardRecord = asRecord(record.note_card) ?? asRecord(record.noteCard);
        const hasKnownSearchCardShape = noteCardRecord !== null ||
            "display_title" in record ||
            "displayTitle" in record ||
            "interact_info" in record ||
            "cover" in record ||
            "image_list" in record ||
            "video_info" in record;
        const noteCardUserRecord = asRecord(noteCardRecord?.user) ?? asRecord(noteCardRecord?.author) ?? null;
        const noteId = pickFirstString(record, ["note_id", "noteId", "id"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["note_id", "noteId", "id"]) : null);
        const userId = pickFirstString(record, ["user_id", "userId"]) ??
            (userRecord ? pickFirstString(userRecord, ["user_id", "userId", "id"]) : null) ??
            (noteCardUserRecord ? pickFirstString(noteCardUserRecord, ["user_id", "userId", "id"]) : null);
        const rawDetailUrl = normalizeXhsUrl(pickFirstString(record, ["detail_url", "detailUrl", "note_url", "noteUrl", "href", "url", "link"]) ??
            (noteCardRecord
                ? pickFirstString(noteCardRecord, ["detail_url", "detailUrl", "note_url", "noteUrl", "href", "url", "link"])
                : null));
        const rawUserHomeUrl = normalizeXhsUrl(pickFirstString(record, ["user_home_url", "userHomeUrl", "author_url", "authorUrl", "user_url", "userUrl"]) ??
            (userRecord ? pickFirstString(userRecord, ["user_home_url", "userHomeUrl", "url", "link"]) : null) ??
            (noteCardUserRecord
                ? pickFirstString(noteCardUserRecord, ["user_home_url", "userHomeUrl", "url", "link"])
                : null));
        const parsedDetail = parseXsecFromUrl(rawDetailUrl);
        const parsedUser = parseXsecFromUrl(rawUserHomeUrl);
        const xsecToken = pickFirstString(record, ["xsec_token", "xsecToken"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["xsec_token", "xsecToken"]) : null) ??
            parsedDetail.xsec_token ??
            parsedUser.xsec_token;
        const xsecSource = pickFirstString(record, ["xsec_source", "xsecSource"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["xsec_source", "xsecSource"]) : null) ??
            parsedDetail.xsec_source ??
            parsedUser.xsec_source;
        const detailUrl = isXhsNoteCardUrl(rawDetailUrl)
            ? rawDetailUrl
            : hasKnownSearchCardShape
                ? buildXhsContinuityUrl({
                    kind: "note",
                    id: noteId,
                    xsecToken,
                    xsecSource
                })
                : null;
        const userHomeUrl = isXhsUserProfileUrl(rawUserHomeUrl)
            ? rawUserHomeUrl
            : hasKnownSearchCardShape
                ? buildXhsContinuityUrl({
                    kind: "user",
                    id: userId,
                    xsecToken,
                    xsecSource
                })
                : null;
        const card = {
            title: pickFirstString(record, ["title", "display_title", "displayTitle", "desc"]) ??
                (noteCardRecord ? pickFirstString(noteCardRecord, ["title", "display_title", "displayTitle"]) : null),
            note_id: noteId,
            user_id: userId,
            detail_url: detailUrl,
            user_home_url: userHomeUrl,
            xsec_token: xsecToken,
            xsec_source: xsecSource
        };
        const hasCardSignal = card.detail_url !== null || card.user_home_url !== null;
        return [
            ...(hasCardSignal ? [card] : []),
            ...Object.values(record).flatMap((entry) => collectSearchDomCards(entry, seen))
        ];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectSearchDomCards(entry, seen));
    }
    return [];
};
const resolveSearchDomExtraction = async (env) => {
    const state = (typeof env.readPageStateRoot === "function" ? await env.readPageStateRoot().catch(() => null) : null) ??
        (typeof env.getPageStateRoot === "function" ? env.getPageStateRoot() : null);
    const stateCards = collectSearchDomCards(state);
    if (stateCards.length > 0) {
        return {
            extraction_layer: "hydration_state",
            extraction_locator: "window.__INITIAL_STATE__",
            cards: stateCards
        };
    }
    const domState = typeof env.readSearchDomState === "function" ? await env.readSearchDomState().catch(() => null) : null;
    const domStateRecord = asRecord(domState);
    const domCards = collectSearchDomCards(domStateRecord?.cards ?? domState);
    if (domCards.length > 0) {
        return {
            extraction_layer: domStateRecord?.extraction_layer === "script_json" ? "script_json" : "dom_selector",
            extraction_locator: asString(domStateRecord?.extraction_locator) ??
                (domStateRecord?.extraction_layer === "script_json"
                    ? "script[type='application/json']"
                    : ".search-result-container"),
            cards: domCards
        };
    }
    return null;
};
const buildSearchTargetContinuity = (cards) => cards.map((card) => ({
    target_url: card.detail_url ?? card.user_home_url,
    note_id: card.note_id,
    user_id: card.user_id,
    detail_url: card.detail_url,
    user_home_url: card.user_home_url,
    xsec_token: card.xsec_token,
    xsec_source: card.xsec_source,
    token_presence: card.xsec_token && card.xsec_token.trim().length > 0
        ? "present"
        : card.xsec_token === ""
            ? "empty"
            : "missing",
    source_route: "xhs.search"
}));
const performSearchPassiveAction = async (input, env) => {
    if (typeof env.performSearchPassiveAction !== "function") {
        return null;
    }
    try {
        return asRecord(await env.performSearchPassiveAction({
            query: input.params.query,
            pageUrl: env.getLocationHref(),
            runId: input.executionContext.runId,
            actionRef: input.executionContext.gateInvocationId ?? input.executionContext.runId
        }));
    }
    catch {
        return null;
    }
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
const withLayer2InteractionInSuccessPayload = (result, layer2Interaction) => {
    if (!result.ok || !layer2Interaction) {
        return result;
    }
    const summary = asRecord(result.payload.summary);
    if (!summary) {
        return result;
    }
    return {
        ...result,
        payload: {
            ...result.payload,
            summary: {
                ...summary,
                layer2_interaction: layer2Interaction
            }
        }
    };
};
const withLayer2InteractionInPayload = (result, layer2Interaction) => {
    if (!layer2Interaction) {
        return result;
    }
    return {
        ...result,
        payload: {
            ...result.payload,
            layer2_interaction: layer2Interaction
        }
    };
};
const serializeCanonicalShape = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const shape = createSearchRequestShape({
        keyword: record.keyword,
        page: record.page,
        page_size: record.page_size,
        limit: record.limit,
        sort: record.sort,
        note_type: record.note_type
    });
    return shape ? serializeSearchRequestShape(shape) : null;
};
const layer2InteractionSummary = (layer2Interaction) => layer2Interaction ? { layer2_interaction: layer2Interaction } : {};
const XHS_SEARCH_REPLAY_ORIGIN_ALLOWLIST = new Set([
    "https://www.xiaohongshu.com",
    "https://edith.xiaohongshu.com"
]);
const resolveTrustedSearchTemplateUrl = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" ||
            !XHS_SEARCH_REPLAY_ORIGIN_ALLOWLIST.has(parsed.origin) ||
            parsed.pathname !== SEARCH_ENDPOINT) {
            return null;
        }
        return `${parsed.origin}${SEARCH_ENDPOINT}`;
    }
    catch {
        return null;
    }
};
const isTrustedCapturedTemplate = (template, expected) => {
    const templateRecord = asRecord(template);
    if (!templateRecord) {
        return false;
    }
    if (templateRecord.method !== "POST" ||
        templateRecord.path !== SEARCH_ENDPOINT ||
        templateRecord.page_context_namespace !== expected.pageContextNamespace ||
        templateRecord.shape_key !== expected.shapeKey) {
        return false;
    }
    const templateShape = asRecord(templateRecord.shape);
    if (templateShape?.command !== "xhs.search" ||
        templateShape?.method !== "POST" ||
        templateShape?.pathname !== SEARCH_ENDPOINT ||
        serializeCanonicalShape(templateShape) !== expected.shapeKey) {
        return false;
    }
    if (resolveTrustedSearchTemplateUrl(templateRecord.url) === null) {
        return false;
    }
    const request = asRecord(templateRecord.request);
    if (!request || !asRecord(request.headers)) {
        return false;
    }
    const response = asRecord(templateRecord.response);
    if (!response || !("body" in response)) {
        return false;
    }
    return serializeCanonicalShape(request.body) === expected.shapeKey;
};
const isTrustedRejectedObservation = (observation, expected) => {
    const observationRecord = asRecord(observation);
    if (!observationRecord) {
        return false;
    }
    if (observationRecord.method !== "POST" ||
        observationRecord.path !== SEARCH_ENDPOINT ||
        observationRecord.page_context_namespace !== expected.pageContextNamespace ||
        observationRecord.shape_key !== expected.shapeKey) {
        return false;
    }
    const reason = observationRecord.rejection_reason;
    if (reason !== "synthetic_request_rejected" &&
        reason !== "failed_request_rejected") {
        return false;
    }
    return serializeCanonicalShape(asRecord(observationRecord.shape) ?? asRecord(asRecord(observationRecord.request)?.body)) ===
        expected.shapeKey;
};
const isTransientFailedRequestObservation = (observation) => {
    const observationRecord = asRecord(observation);
    if (observationRecord?.rejection_reason !== "failed_request_rejected") {
        return false;
    }
    const requestStatus = asRecord(observationRecord.request_status);
    return requestStatus?.http_status === null;
};
const BACKEND_REJECTED_SOURCE_REASONS = new Set([
    "SESSION_EXPIRED",
    "ACCOUNT_ABNORMAL",
    "XHS_ACCOUNT_RISK_PAGE",
    "BROWSER_ENV_ABNORMAL",
    "GATEWAY_INVOKER_FAILED",
    "CAPTCHA_REQUIRED",
    "TARGET_API_RESPONSE_INVALID"
]);
const resolveRejectedSourceDetail = (observation) => {
    const observationRecord = asRecord(observation);
    const rejectionReason = observationRecord?.rejection_reason;
    if (!observationRecord || rejectionReason !== "failed_request_rejected") {
        return { reason: "synthetic_request_rejected" };
    }
    const requestStatus = asRecord(observationRecord.request_status);
    const statusCode = asInteger(requestStatus?.http_status) ?? asInteger(observationRecord.status);
    const responseBody = asRecord(asRecord(observationRecord.response)?.body);
    const platformCode = asInteger(responseBody?.code);
    const inferred = inferFailure(statusCode ?? 0, responseBody);
    if (BACKEND_REJECTED_SOURCE_REASONS.has(inferred.reason)) {
        return {
            reason: inferred.reason,
            message: inferred.message,
            ...(typeof statusCode === "number" ? { statusCode } : {}),
            ...(typeof platformCode === "number" ? { platformCode } : {})
        };
    }
    return {
        reason: "failed_request_rejected",
        ...(typeof statusCode === "number" ? { statusCode } : {}),
        ...(typeof platformCode === "number" ? { platformCode } : {})
    };
};
const isTrustedIncompatibleObservation = (observation, expected) => {
    const observationRecord = asRecord(observation);
    if (!observationRecord) {
        return false;
    }
    if (observationRecord.method !== "POST" ||
        observationRecord.path !== SEARCH_ENDPOINT ||
        observationRecord.page_context_namespace !== expected.pageContextNamespace ||
        observationRecord.shape_key === expected.shapeKey) {
        return false;
    }
    const inferredShapeKey = serializeCanonicalShape(asRecord(observationRecord.shape) ?? asRecord(asRecord(observationRecord.request)?.body));
    return inferredShapeKey !== null && inferredShapeKey === observationRecord.shape_key;
};
const waitForRequestContextRetry = async (env, ms) => {
    if (typeof env.sleep === "function") {
        await env.sleep(ms);
        return;
    }
    if (typeof setTimeout !== "function") {
        await Promise.resolve();
        return;
    }
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};
const resolveRequestContextWaitMaxAttempts = (options, elapsedBeforeWaitMs = 0) => {
    const timeoutMs = typeof options.timeout_ms === "number" &&
        Number.isFinite(options.timeout_ms) &&
        options.timeout_ms > 0
        ? Math.floor(options.timeout_ms)
        : null;
    const elapsedMs = Math.max(0, Math.floor(elapsedBeforeWaitMs));
    const waitBudgetMs = timeoutMs === null
        ? REQUEST_CONTEXT_WAIT_MAX_MS
        : Math.max(0, timeoutMs - REQUEST_CONTEXT_FORWARD_DEADLINE_SAFETY_MS - elapsedMs);
    const maxWaitMs = Math.min(REQUEST_CONTEXT_WAIT_MAX_MS, waitBudgetMs);
    return Math.max(1, Math.floor(maxWaitMs / REQUEST_CONTEXT_WAIT_RETRY_MS) + 1);
};
const resolveRequestContextState = async (requestInput, env) => {
    const shape = createSearchRequestShape({
        keyword: requestInput.params.query,
        page: requestInput.params.page ?? 1,
        page_size: requestInput.params.limit ?? 20,
        sort: requestInput.params.sort ?? "general",
        note_type: requestInput.params.note_type ?? 0
    });
    const fallbackNamespace = createPageContextNamespace(env.getLocationHref());
    const readCapturedRequestContext = env.readCapturedRequestContext;
    if (!shape || !readCapturedRequestContext) {
        return {
            status: "miss",
            failureReason: "template_missing",
            pageContextNamespace: fallbackNamespace,
            shapeKey: shape ? serializeSearchRequestShape(shape) : "",
            availableShapeKeys: [],
            diagnostics: {
                lookup_unavailable: !readCapturedRequestContext,
                shape_available: Boolean(shape)
            }
        };
    }
    const shapeKey = serializeSearchRequestShape(shape);
    let pageContextNamespace = fallbackNamespace;
    const lookupOnce = async (input) => {
        let lookup = null;
        try {
            pageContextNamespace = createPageContextNamespace(env.getLocationHref());
            lookup = await readCapturedRequestContext({
                method: "POST",
                path: SEARCH_ENDPOINT,
                page_context_namespace: pageContextNamespace,
                shape_key: shapeKey,
                ...(requestInput.expectedProvenance
                    ? {
                        profile_ref: requestInput.expectedProvenance.profile_ref,
                        session_id: requestInput.expectedProvenance.session_id,
                        ...(typeof requestInput.expectedProvenance.target_tab_id === "number"
                            ? { target_tab_id: requestInput.expectedProvenance.target_tab_id }
                            : {}),
                        run_id: requestInput.expectedProvenance.run_id,
                        action_ref: requestInput.expectedProvenance.action_ref,
                        page_url: requestInput.expectedProvenance.page_url
                    }
                    : {}),
                ...(typeof requestInput.minObservedAt === "number"
                    ? { min_observed_at: requestInput.minObservedAt }
                    : {})
            });
        }
        catch {
            return {
                status: "miss",
                failureReason: "template_missing",
                pageContextNamespace,
                shapeKey,
                availableShapeKeys: [],
                diagnostics: {
                    lookup_transport_failed: true
                }
            };
        }
        pageContextNamespace = lookup?.page_context_namespace ?? pageContextNamespace;
        const availableShapeKeys = lookup?.available_shape_keys ?? [];
        const diagnostics = asRecord(lookup?.diagnostics) ?? undefined;
        const siblingShapeKeys = availableShapeKeys.filter((candidate) => candidate !== shapeKey);
        const admittedTemplate = isTrustedCapturedTemplate(lookup?.admitted_template ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.admitted_template ?? null
            : null;
        const rejectedObservation = isTrustedRejectedObservation(lookup?.rejected_observation ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.rejected_observation ?? null
            : null;
        const incompatibleObservation = isTrustedIncompatibleObservation(lookup?.incompatible_observation ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.incompatible_observation ?? null
            : null;
        if (admittedTemplate && admittedTemplate.template_ready !== false) {
            const templateUrl = resolveTrustedSearchTemplateUrl(admittedTemplate.url);
            if (!templateUrl) {
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    diagnostics
                };
            }
            const admittedResponseRecord = asRecord(admittedTemplate.response.body);
            const admittedBusinessCode = asInteger(admittedResponseRecord?.code);
            if (admittedTemplate.status >= 400 || admittedBusinessCode !== 0) {
                const failure = inferFailure(admittedTemplate.status, admittedTemplate.response.body);
                return {
                    status: "miss",
                    failureReason: "rejected_source",
                    detailReason: BACKEND_REJECTED_SOURCE_REASONS.has(failure.reason)
                        ? failure.reason
                        : "TARGET_API_RESPONSE_INVALID",
                    detailMessage: failure.message,
                    statusCode: admittedTemplate.status,
                    ...(admittedBusinessCode !== null ? { platformCode: admittedBusinessCode } : {}),
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt: admittedTemplate.observed_at ?? admittedTemplate.captured_at,
                    diagnostics
                };
            }
            const observedAt = admittedTemplate.observed_at ?? admittedTemplate.captured_at;
            if (env.now() - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS) {
                return {
                    status: "miss",
                    failureReason: "template_stale",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt,
                    diagnostics
                };
            }
            return {
                status: "hit",
                template: {
                    request: {
                        url: templateUrl,
                        headers: admittedTemplate.request.headers,
                        body: admittedTemplate.request.body
                    },
                    response: {
                        body: admittedTemplate.response.body
                    },
                    referrer: typeof admittedTemplate.referrer === "string" ? admittedTemplate.referrer : null,
                    capturedAt: admittedTemplate.captured_at,
                    pageContextNamespace
                },
                pageContextNamespace,
                shapeKey
            };
        }
        if (rejectedObservation) {
            if (input?.deferTransientMisses === true &&
                isTransientFailedRequestObservation(rejectedObservation)) {
                const rejectedDetail = resolveRejectedSourceDetail(rejectedObservation);
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    detailReason: rejectedDetail.reason,
                    detailMessage: rejectedDetail.message,
                    statusCode: rejectedDetail.statusCode,
                    platformCode: rejectedDetail.platformCode,
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt: rejectedObservation.observed_at ?? rejectedObservation.captured_at,
                    diagnostics
                };
            }
            const rejectedDetail = resolveRejectedSourceDetail(rejectedObservation);
            return {
                status: "miss",
                failureReason: "rejected_source",
                detailReason: rejectedDetail.reason,
                detailMessage: rejectedDetail.message,
                statusCode: rejectedDetail.statusCode,
                platformCode: rejectedDetail.platformCode,
                pageContextNamespace,
                shapeKey,
                availableShapeKeys,
                observedAt: rejectedObservation.observed_at ?? rejectedObservation.captured_at,
                diagnostics
            };
        }
        if (incompatibleObservation || siblingShapeKeys.length > 0) {
            if (input?.deferTransientMisses === true) {
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys: siblingShapeKeys,
                    observedAt: incompatibleObservation?.observed_at ?? incompatibleObservation?.captured_at ?? undefined,
                    diagnostics
                };
            }
            return {
                status: "miss",
                failureReason: "shape_mismatch",
                pageContextNamespace,
                shapeKey,
                availableShapeKeys: siblingShapeKeys,
                observedAt: incompatibleObservation?.observed_at ?? incompatibleObservation?.captured_at ?? undefined,
                diagnostics
            };
        }
        return {
            status: "miss",
            failureReason: "template_missing",
            pageContextNamespace,
            shapeKey,
            availableShapeKeys,
            diagnostics
        };
    };
    const maxAttempts = resolveRequestContextWaitMaxAttempts(requestInput.options, requestInput.elapsedBeforeWaitMs);
    let lastState = await lookupOnce({
        deferTransientMisses: maxAttempts > 1
    });
    for (let attempt = 1; attempt < maxAttempts &&
        lastState.status === "miss" &&
        lastState.failureReason === "template_missing"; attempt += 1) {
        await waitForRequestContextRetry(env, REQUEST_CONTEXT_WAIT_RETRY_MS);
        lastState = await lookupOnce({
            deferTransientMisses: attempt + 1 < maxAttempts
        });
    }
    return lastState;
};
export const executeXhsSearch = async (input, env) => {
    const executionStartedAt = env.now();
    const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const layer2Interaction = buildXhsSearchLayer2InteractionEvidence({
        writeInteractionTierName: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
        requestedExecutionMode: input.options.requested_execution_mode,
        recoveryProbe: input.options.xhs_recovery_probe === true
    });
    const startedAt = env.now();
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return withLayer2InteractionInPayload(withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, createObservability({
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
        }), createDiagnosis({
            reason: "EXECUTION_MODE_GATE_BLOCKED",
            summary: "执行模式门禁阻断"
        }), gate, auditRecord), gate.execution_audit), layer2Interaction);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return withLayer2InteractionInSuccessPayload(createGateOnlySuccess(input, gate, auditRecord, env), layer2Interaction);
    }
    if (input.options.validation_action === "editor_input" &&
        input.options.issue_scope === "issue_208" &&
        input.options.action_type === "write" &&
        input.options.requested_execution_mode === "live_write") {
        const validationText = typeof input.options.validation_text === "string" && input.options.validation_text.trim().length > 0
            ? input.options.validation_text.trim()
            : "WebEnvoy editor_input validation";
        const focusAttestation = input.options.editor_focus_attestation ?? null;
        let validationResult;
        if (env.performEditorInputValidation) {
            try {
                validationResult = await env.performEditorInputValidation({
                    text: validationText,
                    focusAttestation: focusAttestation
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
                    ability_id: input.abilityId,
                    stage: "execution",
                    reason: "EDITOR_INPUT_VALIDATION_FAILED",
                    validation_exception: message
                }, createObservability({
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId: `req-${env.randomId()}`,
                    outcome: "failed",
                    failureReason: message,
                    failureSite: {
                        stage: "execution",
                        component: "page",
                        target: "editor_input",
                        summary: message || "editor_input validation failed"
                    }
                }), createDiagnosis({
                    reason: "EDITOR_INPUT_VALIDATION_FAILED",
                    summary: message || "editor_input validation failed",
                    category: "page_changed"
                }), gate, auditRecord), gate.execution_audit);
            }
        }
        else {
            validationResult = {
                ok: false,
                mode: "dom_editor_input_validation",
                attestation: "dom_self_certified",
                editor_locator: null,
                input_text: validationText,
                before_text: "",
                visible_text: "",
                post_blur_text: "",
                focus_confirmed: false,
                focus_attestation_source: null,
                focus_attestation_reason: null,
                preserved_after_blur: false,
                success_signals: [],
                failure_signals: ["missing_focus_attestation", "dom_variant"],
                minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
            };
        }
        if (!isTrustedEditorInputValidation(validationResult)) {
            return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
                ability_id: input.abilityId,
                stage: "execution",
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                ...buildEditorInputEvidence(validationResult)
            }, createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "failed",
                failureReason: "EDITOR_INPUT_VALIDATION_FAILED",
                failureSite: {
                    stage: "execution",
                    component: "page",
                    target: validationResult.editor_locator ?? "editor_input",
                    summary: validationResult.failure_signals[0] ?? "editor_input validation failed"
                }
            }), createDiagnosis({
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                summary: validationResult.failure_signals[0] ?? "editor_input validation failed",
                category: "page_changed"
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
                        data_ref: {
                            validation_action: "editor_input"
                        },
                        metrics: {
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
                    write_interaction_tier: gate.write_interaction_tier,
                    write_action_matrix_decisions: gate.write_action_matrix_decisions,
                    consumer_gate_result: gate.consumer_gate_result,
                    request_admission_result: gate.request_admission_result,
                    execution_audit: gate.execution_audit,
                    approval_record: gate.approval_record,
                    risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                    audit_record: auditRecord,
                    ...layer2InteractionSummary(layer2Interaction),
                    interaction_result: buildEditorInputEvidence(validationResult)
                },
                observability: createObservability({
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId: `req-${env.randomId()}`,
                    outcome: "completed"
                })
            }
        };
    }
    const simulated = resolveSimulatedResult(input.options.simulate_result, input.params, input.options, env);
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
                        audit_record: auditRecord,
                        ...layer2InteractionSummary(layer2Interaction)
                    }
                }
            };
        }
        return {
            ...simulated,
            payload: {
                ...simulated.payload,
                details: {
                    ability_id: input.abilityId,
                    ...(asRecord(simulated.payload.details) ?? {})
                },
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
        }, createObservability({
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
        }), createDiagnosis({
            reason: accountSafetySurface.reason,
            summary: accountSafetySurface.message,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "登录态缺失，无法执行 xhs.search", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createDiagnosis({
            reason: "SESSION_EXPIRED",
            summary: "登录态缺失，无法执行 xhs.search"
        }), gate, auditRecord), gate.execution_audit);
    }
    const buildExpectedRequestContextProvenance = () => ({
        profile_ref: input.executionContext.profile,
        session_id: input.executionContext.sessionId,
        target_tab_id: typeof gate.consumer_gate_result.target_tab_id === "number"
            ? gate.consumer_gate_result.target_tab_id
            : null,
        run_id: input.executionContext.runId,
        action_ref: input.abilityAction,
        page_url: env.getLocationHref()
    });
    const createProvenanceUnconfirmedFailure = () => {
        const expectedProvenance = buildExpectedRequestContextProvenance();
        const summary = "当前页面现场的搜索请求来源未完成 provenance 绑定";
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "REQUEST_CONTEXT_MISSING",
            request_context_reason: "provenance_unconfirmed",
            page_context_namespace: createPageContextNamespace(env.getLocationHref()),
            profile_ref: expectedProvenance.profile_ref,
            session_id: expectedProvenance.session_id,
            target_tab_id: expectedProvenance.target_tab_id,
            run_id: expectedProvenance.run_id,
            action_ref: expectedProvenance.action_ref,
            page_url: expectedProvenance.page_url
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "REQUEST_CONTEXT_MISSING",
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "captured_request_context",
                summary
            }
        }), createDiagnosis({
            reason: "REQUEST_CONTEXT_MISSING",
            summary,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    };
    const confirmCurrentRequestContextProvenance = async () => {
        if (typeof env.configureCapturedRequestContextProvenance !== "function") {
            return true;
        }
        const expectedProvenance = buildExpectedRequestContextProvenance();
        const result = await env.configureCapturedRequestContextProvenance({
            page_context_namespace: createPageContextNamespace(env.getLocationHref()),
            ...expectedProvenance
        }).catch(() => null);
        const record = asRecord(result);
        return (record?.configured === true &&
            record.profile_ref === expectedProvenance.profile_ref &&
            record.session_id === expectedProvenance.session_id &&
            (expectedProvenance.target_tab_id === null ||
                record.target_tab_id === expectedProvenance.target_tab_id) &&
            record.run_id === expectedProvenance.run_id &&
            record.action_ref === expectedProvenance.action_ref &&
            record.page_url === expectedProvenance.page_url);
    };
    if (input.options.__request_context_provenance_confirmed === false) {
        return createProvenanceUnconfirmedFailure();
    }
    const payload = {
        keyword: input.params.query,
        page: input.params.page ?? 1,
        page_size: input.params.limit ?? 20,
        search_id: input.params.search_id ?? env.randomId(),
        sort: input.params.sort ?? "general",
        note_type: input.params.note_type ?? 0
    };
    const passiveActionStartedAt = env.now();
    const passiveActionEvidence = await performSearchPassiveAction(input, env);
    if (!(await confirmCurrentRequestContextProvenance())) {
        return createProvenanceUnconfirmedFailure();
    }
    const requestContextState = await resolveRequestContextState({
        params: input.params,
        options: input.options,
        minObservedAt: passiveActionEvidence ? passiveActionStartedAt : null,
        elapsedBeforeWaitMs: env.now() - executionStartedAt,
        expectedProvenance: buildExpectedRequestContextProvenance()
    }, env);
    if (requestContextState.status !== "hit") {
        const backendRejectedReason = requestContextState.detailReason &&
            BACKEND_REJECTED_SOURCE_REASONS.has(requestContextState.detailReason)
            ? requestContextState.detailReason
            : null;
        const reason = backendRejectedReason ??
            (requestContextState.failureReason === "shape_mismatch" ||
                requestContextState.failureReason === "rejected_source"
                ? "REQUEST_CONTEXT_INCOMPATIBLE"
                : "REQUEST_CONTEXT_MISSING");
        const summaryMap = {
            template_missing: "当前页面现场缺少可复用的搜索请求模板",
            template_stale: "当前页面现场的搜索请求模板已过期",
            shape_mismatch: "当前页面现场存在不同 shape 的搜索请求模板",
            rejected_source: "当前页面现场的搜索请求来源已被拒绝"
        };
        const summary = requestContextState.detailMessage ?? summaryMap[requestContextState.failureReason];
        const isBackendRejectedSource = backendRejectedReason !== null;
        if (requestContextState.failureReason === "rejected_source") {
            return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
                ability_id: input.abilityId,
                stage: "execution",
                reason,
                request_context_reason: requestContextState.failureReason,
                page_context_namespace: requestContextState.pageContextNamespace,
                shape_key: requestContextState.shapeKey,
                available_shape_keys: requestContextState.availableShapeKeys,
                ...(requestContextState.diagnostics
                    ? { request_context_diagnostics: requestContextState.diagnostics }
                    : {}),
                ...(requestContextState.statusCode !== undefined
                    ? { status_code: requestContextState.statusCode }
                    : {}),
                ...(requestContextState.platformCode !== undefined
                    ? { platform_code: requestContextState.platformCode }
                    : {}),
                ...(backendRejectedReason ? { rejected_source_reason: backendRejectedReason } : {}),
                ...(requestContextState.observedAt !== undefined
                    ? { observed_at: requestContextState.observedAt }
                    : {})
            }, createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "failed",
                ...(requestContextState.statusCode !== undefined
                    ? { statusCode: requestContextState.statusCode }
                    : {}),
                failureReason: reason,
                includeKeyRequest: false,
                failureSite: {
                    stage: "action",
                    component: "page",
                    target: isBackendRejectedSource ? SEARCH_ENDPOINT : "captured_request_context",
                    summary
                }
            }), createDiagnosis({
                reason,
                summary,
                category: isBackendRejectedSource ? "request_failed" : "page_changed"
            }), gate, auditRecord), gate.execution_audit);
        }
        const domExtraction = isCurrentSearchPageForQuery(env.getLocationHref(), input.params.query)
            ? await resolveSearchDomExtraction(env)
            : null;
        if (domExtraction) {
            const count = domExtraction.cards.length;
            return {
                ok: true,
                payload: {
                    summary: {
                        capability_result: {
                            ability_id: input.abilityId,
                            layer: input.abilityLayer,
                            action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                            outcome: "success",
                            data_ref: {
                                query: input.params.query
                            },
                            metrics: {
                                count,
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
                        ...layer2InteractionSummary(layer2Interaction),
                        route_evidence: {
                            evidence_class: "dom_state_extraction",
                            profile_ref: input.executionContext.profile,
                            target_tab_id: gate.consumer_gate_result.target_tab_id,
                            page_url: env.getLocationHref(),
                            run_id: input.executionContext.runId,
                            action_ref: input.executionContext.gateInvocationId ?? input.executionContext.runId,
                            extraction_layer: domExtraction.extraction_layer,
                            extraction_locator: domExtraction.extraction_locator,
                            extracted_at: toIsoString(env.now()),
                            target_continuity: buildSearchTargetContinuity(domExtraction.cards),
                            risk_surface_classification: "none",
                            ...(passiveActionEvidence ? { humanized_action: passiveActionEvidence } : {}),
                            item_kind: "search_card",
                            cards: domExtraction.cards
                        },
                        request_context: {
                            status: "missing",
                            reason: requestContextState.failureReason,
                            page_context_namespace: requestContextState.pageContextNamespace,
                            shape_key: requestContextState.shapeKey,
                            available_shape_keys: requestContextState.availableShapeKeys,
                            ...(requestContextState.diagnostics
                                ? { diagnostics: requestContextState.diagnostics }
                                : {})
                        }
                    },
                    observability: createObservability({
                        href: env.getLocationHref(),
                        title: env.getDocumentTitle(),
                        readyState: env.getReadyState(),
                        requestId: `req-${env.randomId()}`,
                        outcome: "completed",
                        includeKeyRequest: false
                    })
                }
            };
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
            ability_id: input.abilityId,
            stage: "execution",
            reason,
            request_context_reason: requestContextState.failureReason,
            page_context_namespace: requestContextState.pageContextNamespace,
            shape_key: requestContextState.shapeKey,
            available_shape_keys: requestContextState.availableShapeKeys,
            ...(requestContextState.diagnostics
                ? { request_context_diagnostics: requestContextState.diagnostics }
                : {}),
            ...(requestContextState.detailReason
                ? { rejected_source_reason: requestContextState.detailReason }
                : {}),
            ...(typeof requestContextState.statusCode === "number"
                ? { status_code: requestContextState.statusCode }
                : {}),
            ...(typeof requestContextState.platformCode === "number"
                ? { platform_code: requestContextState.platformCode }
                : {}),
            ...(typeof requestContextState.observedAt === "number"
                ? { request_context_observed_at: requestContextState.observedAt }
                : {})
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: reason,
            includeKeyRequest: isBackendRejectedSource,
            statusCode: requestContextState.statusCode,
            failureSite: {
                stage: isBackendRejectedSource ? "request" : "action",
                component: isBackendRejectedSource ? "network" : "page",
                target: isBackendRejectedSource ? SEARCH_ENDPOINT : "captured_request_context",
                summary
            }
        }), createDiagnosis({
            reason,
            summary,
            category: isBackendRejectedSource ? "request_failed" : "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    const headers = {
        ...requestContextState.template.request.headers
    };
    const capturedRequestBody = asRecord(requestContextState.template.request.body);
    if (!capturedRequestBody) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "当前页面现场缺少可复用的搜索请求模板", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "REQUEST_CONTEXT_MISSING",
            request_context_reason: "template_missing",
            page_context_namespace: requestContextState.pageContextNamespace,
            shape_key: requestContextState.shapeKey,
            available_shape_keys: []
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "REQUEST_CONTEXT_MISSING",
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "captured_request_context",
                summary: "当前页面现场缺少可复用的搜索请求模板"
            }
        }), createDiagnosis({
            reason: "REQUEST_CONTEXT_MISSING",
            summary: "当前页面现场缺少可复用的搜索请求模板"
        }), gate, auditRecord), gate.execution_audit);
    }
    const passiveCards = collectSearchDomCards(requestContextState.template.response.body);
    const passiveTargetContinuity = passiveCards.length > 0
        ? buildSearchTargetContinuity(passiveCards)
        : [
            {
                target_url: env.getLocationHref(),
                xsec_token: null,
                xsec_source: null,
                token_presence: "missing",
                source_route: "xhs.search"
            }
        ];
    const count = parseCount(requestContextState.template.response.body);
    return {
        ok: true,
        payload: {
            summary: {
                capability_result: {
                    ability_id: input.abilityId,
                    layer: input.abilityLayer,
                    action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                    outcome: "success",
                    data_ref: {
                        query: input.params.query,
                        search_id: typeof capturedRequestBody.search_id === "string"
                            ? capturedRequestBody.search_id
                            : payload.search_id
                    },
                    metrics: {
                        count,
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
                ...layer2InteractionSummary(layer2Interaction),
                route_evidence: {
                    evidence_class: "passive_api_capture",
                    profile_ref: input.executionContext.profile,
                    target_tab_id: gate.consumer_gate_result.target_tab_id,
                    page_url: env.getLocationHref(),
                    run_id: input.executionContext.runId,
                    action_ref: input.executionContext.gateInvocationId ?? input.executionContext.runId,
                    captured_at: requestContextState.template.capturedAt,
                    page_context_namespace: requestContextState.pageContextNamespace,
                    shape_key: requestContextState.shapeKey,
                    ...(passiveActionEvidence ? { humanized_action: passiveActionEvidence } : {}),
                    target_continuity: passiveTargetContinuity,
                    ...(passiveCards.length > 0
                        ? {
                            item_kind: "search_card",
                            cards: passiveCards
                        }
                        : {})
                },
                request_context: {
                    status: "exact_hit",
                    page_context_namespace: requestContextState.pageContextNamespace,
                    shape_key: requestContextState.shapeKey,
                    captured_at: requestContextState.template.capturedAt
                }
            },
            observability: createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "completed",
                statusCode: 200
            })
        }
    };
};
