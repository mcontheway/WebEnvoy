import { resolveRiskStateOutput } from "./xhs-search-gate.js";
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
const DIAGNOSIS_SEMANTICS = {
    SIGNATURE_ENTRY_MISSING: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "window._webmsxyw",
        includeKeyRequest: false
    },
    SESSION_EXPIRED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    ACCOUNT_ABNORMAL: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    BROWSER_ENV_ABNORMAL: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    GATEWAY_INVOKER_FAILED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    CAPTCHA_REQUIRED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    }
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asArray = (value) => (Array.isArray(value) ? value : null);
export const classifyPageKind = (href) => {
    if (href.includes("/login")) {
        return "login";
    }
    if (href.includes("creator.xiaohongshu.com/publish")) {
        return "compose";
    }
    if (href.includes("/search_result")) {
        return "search";
    }
    if (href.includes("/explore/")) {
        return "detail";
    }
    return "unknown";
};
export const resolveDiagnosisSemantics = (reason, fallbackCategory) => DIAGNOSIS_SEMANTICS[reason] ?? {
    category: fallbackCategory ?? "request_failed",
    stage: "request",
    component: "network",
    target: SEARCH_ENDPOINT,
    includeKeyRequest: true
};
export const createObservability = (input) => ({
    page_state: {
        page_kind: classifyPageKind(input.href),
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
                method: "POST",
                url: SEARCH_ENDPOINT,
                outcome: input.outcome,
                ...(typeof input.statusCode === "number" ? { status_code: input.statusCode } : {}),
                ...(input.failureReason
                    ? { failure_reason: input.failureReason, request_class: "xhs.search" }
                    : {})
            }
        ],
    failure_site: input.outcome === "failed"
        ? (input.failureSite ?? {
            stage: "request",
            component: "network",
            target: SEARCH_ENDPOINT,
            summary: input.failureReason ?? "request failed"
        })
        : null
});
export const createDiagnosis = (input) => {
    const semantics = resolveDiagnosisSemantics(input.reason, input.category);
    return {
        category: semantics.category,
        stage: semantics.stage,
        component: semantics.component,
        failure_site: {
            stage: semantics.stage,
            component: semantics.component,
            target: semantics.target,
            summary: input.summary
        },
        evidence: [input.reason, input.summary]
    };
};
export const createFailure = (code, message, details, observability, diagnosis, gate, auditRecord) => ({
    ok: false,
    error: {
        code,
        message
    },
    payload: {
        details,
        observability,
        diagnosis,
        ...(gate
            ? {
                scope_context: gate.scope_context,
                gate_input: {
                    run_id: auditRecord?.run_id ?? "unknown",
                    session_id: auditRecord?.session_id ?? "unknown",
                    profile: auditRecord?.profile ?? "unknown",
                    ...gate.gate_input
                },
                gate_outcome: gate.gate_outcome,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                write_interaction_tier: gate.write_interaction_tier,
                write_action_matrix_decisions: gate.write_action_matrix_decisions,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                ...(auditRecord ? { audit_record: auditRecord } : {})
            }
            : {})
    }
});
export const resolveSimulatedResult = (simulated, params, options, env) => {
    if (!simulated) {
        return null;
    }
    const requestId = `req-${env.randomId()}`;
    if (simulated === "success") {
        const observability = createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId,
            outcome: "completed"
        });
        return {
            ok: true,
            payload: {
                summary: {
                    capability_result: {
                        ability_id: "xhs.note.search.v1",
                        layer: "L3",
                        action: "read",
                        outcome: "success",
                        data_ref: {
                            query: params.query,
                            search_id: params.search_id ?? "simulated-search-id"
                        },
                        metrics: {
                            count: Number(options.timeout_ms ?? 2) > 0 ? 2 : 2
                        }
                    }
                },
                observability
            }
        };
    }
    const reasonMap = {
        login_required: {
            reason: "SESSION_EXPIRED",
            message: "登录态缺失，无法执行 xhs.search"
        },
        signature_entry_missing: {
            reason: "SIGNATURE_ENTRY_MISSING",
            message: "页面签名入口不可用"
        },
        account_abnormal: {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求"
        },
        browser_env_abnormal: {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求"
        },
        captcha_required: {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        },
        gateway_invoker_failed: {
            reason: "GATEWAY_INVOKER_FAILED",
            message: "网关调用失败，当前上下文不足以完成搜索请求"
        }
    };
    const mapped = reasonMap[simulated] ?? reasonMap.gateway_invoker_failed;
    const semantics = resolveDiagnosisSemantics(mapped.reason);
    const observability = createObservability({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId,
        outcome: "failed",
        statusCode: simulated === "account_abnormal"
            ? 461
            : simulated === "browser_env_abnormal"
                ? 200
                : simulated === "captcha_required"
                    ? 429
                    : simulated === "gateway_invoker_failed"
                        ? 500
                        : undefined,
        failureReason: simulated,
        includeKeyRequest: semantics.includeKeyRequest,
        failureSite: {
            stage: semantics.stage,
            component: semantics.component,
            target: semantics.target,
            summary: mapped.message
        }
    });
    return createFailure("ERR_EXECUTION_FAILED", mapped.message, {
        stage: "execution",
        reason: mapped.reason
    }, observability, createDiagnosis({
        reason: mapped.reason,
        summary: mapped.message
    }));
};
export const parseCount = (body) => {
    const record = asRecord(body);
    if (!record) {
        return 0;
    }
    const data = asRecord(record.data);
    const candidateArrays = [
        asArray(record.items),
        asArray(record.notes),
        data ? asArray(data.items) : null,
        data ? asArray(data.notes) : null
    ];
    for (const candidate of candidateArrays) {
        if (candidate) {
            return candidate.length;
        }
    }
    const total = data?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
};
export const inferFailure = (status, body) => {
    const record = asRecord(body);
    const businessCode = record?.code;
    const message = typeof record?.msg === "string"
        ? record.msg
        : typeof record?.message === "string"
            ? record.message
            : "";
    const normalized = `${message}`.toLowerCase();
    if (status === 401 || normalized.includes("login")) {
        return {
            reason: "SESSION_EXPIRED",
            message: "登录已失效，无法执行 xhs.search"
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
            message: "网关调用失败，当前上下文不足以完成搜索请求"
        };
    }
    if (status === 429 || normalized.includes("captcha")) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    return {
        reason: "TARGET_API_RESPONSE_INVALID",
        message: "搜索接口返回了未识别的失败响应"
    };
};
export const inferRequestException = (error) => {
    const errorName = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorName === "AbortError") {
        return {
            reason: "REQUEST_TIMEOUT",
            message: "请求超时，无法完成 xhs.search",
            detail: errorMessage
        };
    }
    return {
        reason: "REQUEST_DISPATCH_FAILED",
        message: "搜索请求发送失败，无法完成 xhs.search",
        detail: errorMessage
    };
};
