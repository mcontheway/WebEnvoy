import { createPageContextNamespace, SEARCH_ENDPOINT } from "./xhs-search-types.js";
import { createAuditRecord, createGateOnlySuccess, resolveGate } from "./xhs-search-gate.js";
import { buildEditorInputEvidence, containsCookie, createDiagnosis, createFailure, createObservability, inferFailure, inferRequestException, isTrustedEditorInputValidation, parseCount, resolveSimulatedResult, resolveRiskStateOutput, resolveXsCommon } from "./xhs-search-telemetry.js";
import { REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS, REQUEST_CONTEXT_WAIT_RETRY_MS } from "./request-context-wait-policy.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60_000;
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
const deriveSearchShapeFromSource = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const keyword = asString(record.keyword);
    if (!keyword) {
        return null;
    }
    const page = record.page === undefined ? 1 : asInteger(record.page);
    const pageSize = record.page_size === undefined ? 20 : asInteger(record.page_size);
    const sort = record.sort === undefined ? "general" : asString(record.sort);
    const noteType = record.note_type === undefined ? 0 : asInteger(record.note_type);
    if (page === null || pageSize === null || sort === null || noteType === null) {
        return null;
    }
    return {
        command: "xhs.search",
        method: "POST",
        pathname: SEARCH_ENDPOINT,
        keyword,
        page,
        page_size: pageSize,
        sort,
        note_type: noteType
    };
};
const deriveSearchShapeFromCommand = (params) => ({
    command: "xhs.search",
    method: "POST",
    pathname: SEARCH_ENDPOINT,
    keyword: params.query,
    page: params.page ?? 1,
    page_size: params.limit ?? 20,
    sort: params.sort ?? "general",
    note_type: asInteger(params.note_type) ?? 0
});
const deriveSearchShapeFromArtifact = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const explicitShape = deriveSearchShapeFromSource(record.shape);
    if (explicitShape) {
        return explicitShape;
    }
    const request = asRecord(record.request);
    const requestShape = deriveSearchShapeFromSource(request?.body);
    if (requestShape) {
        return requestShape;
    }
    return deriveSearchShapeFromSource(record.template_body);
};
const serializeSearchShape = (shape) => JSON.stringify({
    command: shape.command,
    method: shape.method,
    pathname: shape.pathname,
    keyword: shape.keyword,
    page: shape.page,
    page_size: shape.page_size,
    sort: shape.sort,
    note_type: shape.note_type
});
const resolveCapturedArtifactHeaders = (value) => {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    const request = asRecord(record.request);
    return normalizeCapturedHeaders(record.template_headers ?? request?.headers);
};
const resolveCapturedArtifactSearchId = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const explicitTemplateBody = parseJsonRecord(record.template_body);
    const request = asRecord(record.request);
    const requestBody = parseJsonRecord(request?.body);
    return (asString(record.search_id) ??
        asString(explicitTemplateBody?.search_id) ??
        asString(requestBody?.search_id) ??
        null);
};
const resolveCapturedArtifactReferrer = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return asString(record.referrer);
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
const resolveSearchRequestContext = (artifact, expectedShape, now) => {
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
        if (admittedTemplate) {
            return resolveSearchRequestContext(admittedTemplate, expectedShape, now);
        }
        if (rejectedObservation) {
            const shape = deriveSearchShapeFromArtifact(rejectedObservation);
            const status = resolveCapturedArtifactStatus(rejectedObservation);
            return {
                state: "rejected_source",
                reason: status.rejectionReason ?? "failed_request_rejected",
                shape: shape ?? expectedShape
            };
        }
        const incompatibleObservation = asRecord(lookupRecord.incompatible_observation);
        if (incompatibleObservation) {
            return {
                state: "incompatible",
                reason: "shape_mismatch",
                shape: deriveSearchShapeFromArtifact(incompatibleObservation)
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
    const derivedShape = deriveSearchShapeFromArtifact(artifact);
    if (!derivedShape) {
        return {
            state: "miss",
            reason: "template_missing"
        };
    }
    const status = resolveCapturedArtifactStatus(artifact);
    if (serializeSearchShape(derivedShape) !== serializeSearchShape(expectedShape)) {
        return {
            state: "incompatible",
            reason: "shape_mismatch",
            shape: derivedShape
        };
    }
    if (status.rejectionReason) {
        return {
            state: "rejected_source",
            reason: status.rejectionReason,
            shape: derivedShape
        };
    }
    const capturedAt = asInteger(asRecord(artifact)?.captured_at);
    if (capturedAt === null || now - capturedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS) {
        return {
            state: "stale",
            reason: "template_stale",
            shape: derivedShape
        };
    }
    return {
        state: "hit",
        shape: derivedShape,
        headers: resolveCapturedArtifactHeaders(artifact),
        searchId: resolveCapturedArtifactSearchId(artifact),
        referrer: resolveCapturedArtifactReferrer(artifact)
    };
};
const failClosedForRequestContext = (input, env) => {
    const isIncompatible = input.lookupResult.state === "incompatible" || input.lookupResult.reason === "shape_mismatch";
    const resultKind = isIncompatible ? "request_context_incompatible" : "request_context_missing";
    const message = isIncompatible
        ? "当前页面现场不存在与 xhs.search 完全一致的请求上下文"
        : "当前页面现场缺少可复用的 xhs.search 请求上下文";
    const reasonCode = isIncompatible ? "REQUEST_CONTEXT_INCOMPATIBLE" : "REQUEST_CONTEXT_MISSING";
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: reasonCode,
        request_context_result: resultKind,
        request_context_lookup_state: input.lookupResult.state,
        request_context_miss_reason: input.lookupResult.reason,
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeSearchShape(input.expectedShape),
        ...("shape" in input.lookupResult && input.lookupResult.shape
            ? { captured_request_shape: input.lookupResult.shape }
            : {})
    }, createObservability({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: input.lookupResult.reason,
        includeKeyRequest: false,
        failureSite: {
            stage: "execution",
            component: "page",
            target: "captured_request_context",
            summary: input.lookupResult.reason
        }
    }), createDiagnosis({
        reason: input.lookupResult.reason,
        summary: message,
        category: "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const readCapturedSearchContextWithRetry = async (expectedShape, env) => {
    const readCapturedRequestContext = env.readCapturedRequestContext;
    if (!readCapturedRequestContext) {
        return resolveSearchRequestContext(null, expectedShape, env.now());
    }
    let lastResult = resolveSearchRequestContext(await readCapturedRequestContext({
        method: "POST",
        path: SEARCH_ENDPOINT,
        page_context_namespace: createPageContextNamespace(env.getLocationHref()),
        shape_key: serializeSearchShape(expectedShape)
    }).catch(() => null), expectedShape, env.now());
    for (let attempt = 1; attempt < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS && lastResult.state !== "hit"; attempt += 1) {
        await env.sleep?.(REQUEST_CONTEXT_WAIT_RETRY_MS);
        lastResult = resolveSearchRequestContext(await readCapturedRequestContext({
            method: "POST",
            path: SEARCH_ENDPOINT,
            page_context_namespace: createPageContextNamespace(env.getLocationHref()),
            shape_key: serializeSearchShape(expectedShape)
        }).catch(() => null), expectedShape, env.now());
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
export const executeXhsSearch = async (input, env) => {
    const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const startedAt = env.now();
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
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
        }), gate, auditRecord), gate.execution_audit);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, gate, auditRecord, env);
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
                        audit_record: auditRecord
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
    const expectedShape = deriveSearchShapeFromCommand(input.params);
    const requestContextResult = await readCapturedSearchContextWithRetry(expectedShape, env);
    if (requestContextResult.state !== "hit") {
        return failClosedForRequestContext({
            abilityId: input.abilityId,
            expectedShape,
            lookupResult: requestContextResult,
            gate,
            auditRecord
        }, env);
    }
    if (!requestContextResult.searchId) {
        return failClosedForRequestContext({
            abilityId: input.abilityId,
            expectedShape,
            lookupResult: {
                state: "miss",
                reason: "captured_search_id_missing"
            },
            gate,
            auditRecord
        }, env);
    }
    if (typeof input.params.search_id === "string" &&
        input.params.search_id.trim().length > 0 &&
        input.params.search_id.trim() !== requestContextResult.searchId) {
        return failClosedForRequestContext({
            abilityId: input.abilityId,
            expectedShape,
            lookupResult: {
                state: "incompatible",
                reason: "captured_search_id_mismatch",
                shape: requestContextResult.shape
            },
            gate,
            auditRecord
        }, env);
    }
    const payload = {
        keyword: expectedShape.keyword,
        page: expectedShape.page,
        page_size: expectedShape.page_size,
        search_id: requestContextResult.searchId,
        sort: expectedShape.sort,
        note_type: expectedShape.note_type
    };
    let signature;
    try {
        signature = await env.callSignature(SEARCH_ENDPOINT, payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SIGNATURE_ENTRY_MISSING"
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: message,
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "window._webmsxyw",
                summary: "页面签名入口不可用"
            }
        }), createDiagnosis({
            reason: "SIGNATURE_ENTRY_MISSING",
            summary: "页面签名入口不可用"
        }), gate, auditRecord), gate.execution_audit);
    }
    const headers = {
        Accept: getCapturedHeader(requestContextResult.headers, "Accept") ?? "application/json, text/plain, */*",
        "Content-Type": getCapturedHeader(requestContextResult.headers, "Content-Type") ??
            "application/json;charset=utf-8",
        "X-s": String(signature["X-s"]),
        "X-t": String(signature["X-t"]),
        "X-S-Common": input.options.x_s_common ??
            getCapturedHeader(requestContextResult.headers, "X-S-Common") ??
            resolveXsCommon(undefined),
        "x-b3-traceid": getCapturedHeader(requestContextResult.headers, "x-b3-traceid") ??
            env.randomId().replace(/-/g, ""),
        "x-xray-traceid": getCapturedHeader(requestContextResult.headers, "x-xray-traceid") ??
            env.randomId().replace(/-/g, "")
    };
    let response;
    try {
        response = await env.fetchJson({
            url: SEARCH_ENDPOINT,
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            pageContextRequest: true,
            referrer: requestContextResult.referrer ?? env.getLocationHref(),
            referrerPolicy: "strict-origin-when-cross-origin",
            timeoutMs: typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
                ? Math.max(1, Math.floor(input.options.timeout_ms))
                : 30_000
        });
    }
    catch (error) {
        const failure = inferRequestException(error);
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: failure.detail
        }), createDiagnosis({
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = responseRecord?.code;
    if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
        const failure = inferFailure(response.status, response.body);
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            statusCode: response.status,
            failureReason: failure.reason
        }), createDiagnosis({
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
    }
    const count = parseCount(response.body);
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
                        search_id: payload.search_id
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
                audit_record: auditRecord
            },
            observability: createObservability({
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
