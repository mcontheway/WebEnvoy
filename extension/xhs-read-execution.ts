import type {
  JsonRecord,
  SearchExecutionResult,
  XhsExecutionContext,
  XhsSearchEnvironment,
  XhsSearchOptions
} from "./xhs-search-types.js";
import { createAuditRecord, resolveGate } from "./xhs-search-gate.js";
import {
  containsCookie,
  createDiagnosis,
  createFailure,
  resolveRiskStateOutput,
  resolveXsCommon
} from "./xhs-search-telemetry.js";

type XhsReadCommandName = "xhs.detail" | "xhs.user_home";

type XhsDetailParams = {
  note_id: string;
};

type XhsUserHomeParams = {
  user_id: string;
};

type XhsReadExecutionInput =
  | {
      command: "xhs.detail";
      abilityId: string;
      abilityLayer: string;
      abilityAction: string;
      params: XhsDetailParams;
      options: XhsSearchOptions;
      executionContext: XhsExecutionContext;
    }
  | {
      command: "xhs.user_home";
      abilityId: string;
      abilityLayer: string;
      abilityAction: string;
      params: XhsUserHomeParams;
      options: XhsSearchOptions;
      executionContext: XhsExecutionContext;
    };

type XhsReadCommandSpec = {
  command: XhsReadCommandName;
  endpoint: string;
  method: "POST" | "GET";
  pageKind: "detail" | "user_home";
  requestClass: string;
  buildPayload: (params: XhsDetailParams | XhsUserHomeParams, env: XhsSearchEnvironment) => JsonRecord;
  buildUrl: (params: XhsDetailParams | XhsUserHomeParams) => string;
  buildSignatureUri: (params: XhsDetailParams | XhsUserHomeParams) => string;
  buildDataRef: (params: XhsDetailParams | XhsUserHomeParams, payload: JsonRecord) => JsonRecord;
};

const XHS_DETAIL_SPEC: XhsReadCommandSpec = {
  command: "xhs.detail",
  endpoint: "/api/sns/web/v1/feed",
  method: "POST",
  pageKind: "detail",
  requestClass: "xhs.detail",
  buildPayload: (params) => ({
    source_note_id: (params as XhsDetailParams).note_id
  }),
  buildUrl: () => "/api/sns/web/v1/feed",
  buildSignatureUri: () => "/api/sns/web/v1/feed",
  buildDataRef: (params) => ({
    note_id: (params as XhsDetailParams).note_id
  })
};

const XHS_USER_HOME_SPEC: XhsReadCommandSpec = {
  command: "xhs.user_home",
  endpoint: "/api/sns/web/v1/user/otherinfo",
  method: "GET",
  pageKind: "user_home",
  requestClass: "xhs.user_home",
  buildPayload: () => ({}),
  buildUrl: (params) =>
    `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent((params as XhsUserHomeParams).user_id)}`,
  buildSignatureUri: (params) =>
    `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent((params as XhsUserHomeParams).user_id)}`,
  buildDataRef: (params) => ({
    user_id: (params as XhsUserHomeParams).user_id
  })
};

const READ_COMMAND_SPECS: Record<XhsReadCommandName, XhsReadCommandSpec> = {
  "xhs.detail": XHS_DETAIL_SPEC,
  "xhs.user_home": XHS_USER_HOME_SPEC
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const classifyPageKind = (href: string, fallback: XhsReadCommandSpec["pageKind"]): string => {
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

const createReadObservability = (input: {
  spec: XhsReadCommandSpec;
  href: string;
  title: string;
  readyState: string;
  requestId: string;
  outcome: "completed" | "failed";
  statusCode?: number;
  failureReason?: string;
  includeKeyRequest?: boolean;
  failureSite?: {
    stage: string;
    component: string;
    target: string;
    summary: string;
  };
}): JsonRecord => ({
  page_state: {
    page_kind: classifyPageKind(input.href, input.spec.pageKind),
    url: input.href,
    title: input.title,
    ready_state: input.readyState
  },
  key_requests:
    input.includeKeyRequest === false
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
  failure_site:
    input.outcome === "failed"
      ? (input.failureSite ?? {
          stage: "request",
          component: "network",
          target: input.spec.endpoint,
          summary: input.failureReason ?? "request failed"
        })
      : null
});

const inferReadFailure = (
  spec: XhsReadCommandSpec,
  status: number,
  body: unknown
): { reason: string; message: string } => {
  const record = asRecord(body);
  const businessCode = record?.code;
  const message =
    typeof record?.msg === "string"
      ? record.msg
      : typeof record?.message === "string"
        ? record.message
        : "";
  const normalized = `${message}`.toLowerCase();

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
  if (status === 429 || normalized.includes("captcha")) {
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

const inferReadRequestException = (
  spec: XhsReadCommandSpec,
  error: unknown
): { reason: string; message: string; detail: string } => {
  const errorName =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
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

const hasDetailPageStateFallback = (params: XhsDetailParams, root: JsonRecord | null): boolean => {
  const note = asRecord(root?.note);
  const noteDetailMap = asRecord(note?.noteDetailMap);
  return asRecord(noteDetailMap?.[params.note_id]) !== null;
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const hasUserHomePageStateFallback = (params: XhsUserHomeParams, root: JsonRecord | null): boolean => {
  const user = asRecord(root?.user);
  if (!user) {
    return false;
  }

  const candidateUserIds = [
    asNonEmptyString(user.userId),
    asNonEmptyString(user.user_id),
    asNonEmptyString(user.id),
    asNonEmptyString(asRecord(user.basicInfo)?.userId),
    asNonEmptyString(asRecord(user.basicInfo)?.user_id),
    asNonEmptyString(asRecord(user.profile)?.userId),
    asNonEmptyString(asRecord(user.profile)?.user_id)
  ].filter((value): value is string => value !== null);

  if (!candidateUserIds.some((userId) => userId === params.user_id)) {
    return false;
  }

  return asRecord(root?.board) !== null || asRecord(root?.note) !== null || user !== null;
};

const canUsePageStateFallback = (
  spec: XhsReadCommandSpec,
  params: XhsDetailParams | XhsUserHomeParams,
  root: JsonRecord | null
): boolean =>
  spec.command === "xhs.detail"
    ? hasDetailPageStateFallback(params as XhsDetailParams, root)
    : hasUserHomePageStateFallback(params as XhsUserHomeParams, root);

const createPageStateFallbackFailure = (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  gate: ReturnType<typeof resolveGate>,
  auditRecord: ReturnType<typeof createAuditRecord>,
  env: XhsSearchEnvironment,
  payload: JsonRecord,
  startedAt: number,
  requestFailure: {
    reason: string;
    message: string;
    detail: string;
    statusCode?: number;
  }
): SearchExecutionResult => {
  const requestId = `req-${env.randomId()}`;
  return createFailure(
    "ERR_EXECUTION_FAILED",
    requestFailure.message,
    {
      ability_id: input.abilityId,
      stage: "execution",
      reason: requestFailure.reason
    },
    {
      page_state: {
        page_kind: classifyPageKind(env.getLocationHref(), spec.pageKind),
        url: env.getLocationHref(),
        title: env.getDocumentTitle(),
        ready_state: env.getReadyState(),
        fallback_used: true
      },
      key_requests: [
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
        },
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
      failure_site: {
        stage: "request",
        component: "network",
        target: spec.endpoint,
        summary: requestFailure.message
      }
    },
    createDiagnosis({
      reason: requestFailure.reason,
      summary: requestFailure.message
    }),
    gate,
    auditRecord
  );
};

const createGateOnlySuccess = (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  gate: ReturnType<typeof resolveGate>,
  auditRecord: ReturnType<typeof createAuditRecord>,
  env: XhsSearchEnvironment,
  payload: JsonRecord
): SearchExecutionResult => ({
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

const resolveSimulatedResult = (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  payload: JsonRecord,
  env: XhsSearchEnvironment
): SearchExecutionResult | null => {
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

  const mapped = inferReadFailure(spec, input.options.simulate_result === "account_abnormal" ? 461 : 500, {
    code: input.options.simulate_result === "account_abnormal" ? 300011 : undefined,
    msg:
      input.options.simulate_result === "browser_env_abnormal"
        ? "Browser environment abnormal"
        : input.options.simulate_result === "gateway_invoker_failed"
          ? "create invoker failed"
          : input.options.simulate_result
  });
  return createFailure(
    "ERR_EXECUTION_FAILED",
    mapped.message,
    {
      ability_id: input.abilityId,
      stage: "execution",
      reason: mapped.reason
    },
    createReadObservability({
      spec,
      href: env.getLocationHref(),
      title: env.getDocumentTitle(),
      readyState: env.getReadyState(),
      requestId,
      outcome: "failed",
      failureReason: input.options.simulate_result
    }),
    createDiagnosis({
      reason: mapped.reason,
      summary: mapped.message
    })
  );
};

const buildHeaders = (
  env: XhsSearchEnvironment,
  options: XhsSearchOptions,
  signature: { "X-s": string; "X-t": string | number }
): Record<string, string> => ({
  Accept: "application/json, text/plain, */*",
  ...(options.target_domain === "www.xiaohongshu.com" || options.target_domain === undefined
    ? {}
    : {}),
  ...(signature
    ? {
        "X-s": String(signature["X-s"]),
        "X-t": String(signature["X-t"]),
        "X-S-Common": resolveXsCommon(options.x_s_common),
        "x-b3-traceid": env.randomId().replace(/-/g, ""),
        "x-xray-traceid": env.randomId().replace(/-/g, "")
      }
    : {}),
  "Content-Type": "application/json;charset=utf-8"
});

const executeXhsRead = async (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> => {
  const gate = resolveGate(input.options, input.executionContext);
  const auditRecord = createAuditRecord(input.executionContext, gate, env);
  const startedAt = env.now();
  const payload = spec.buildPayload(input.params, env);
  const resolvePageStateRoot = async (): Promise<JsonRecord | null> => {
    const mainWorldState =
      typeof env.readPageStateRoot === "function"
        ? await env.readPageStateRoot().catch(() => null)
        : null;
    const mainWorldRecord = asRecord(mainWorldState);
    if (mainWorldRecord) {
      return mainWorldRecord;
    }
    return asRecord(env.getPageStateRoot?.());
  };

  if (gate.consumer_gate_result.gate_decision === "blocked") {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      `执行模式门禁阻断了当前 ${spec.command} 请求`,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "EXECUTION_MODE_GATE_BLOCKED"
      },
      createReadObservability({
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
      }),
      createDiagnosis({
        reason: "EXECUTION_MODE_GATE_BLOCKED",
        summary: "执行模式门禁阻断"
      }),
      gate,
      auditRecord
    );
  }

  if (
    gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
    gate.consumer_gate_result.effective_execution_mode === "recon"
  ) {
    return createGateOnlySuccess(input, spec, gate, auditRecord, env, payload);
  }

  const simulated = resolveSimulatedResult(input, spec, payload, env);
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
        approval_record: gate.approval_record,
        audit_record: auditRecord
      }
    };
  }

  if (!containsCookie(env.getCookie(), "a1")) {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      `登录态缺失，无法执行 ${spec.command}`,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SESSION_EXPIRED"
      },
      createReadObservability({
        spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: "SESSION_EXPIRED"
      }),
      createDiagnosis({
        reason: "SESSION_EXPIRED",
        summary: `登录态缺失，无法执行 ${spec.command}`
      }),
      gate,
      auditRecord
    );
  }

  let signature: { "X-s": string; "X-t": string | number };
  try {
    signature = await env.callSignature(spec.buildSignatureUri(input.params), payload);
  } catch (error) {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "页面签名入口不可用",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SIGNATURE_ENTRY_MISSING"
      },
      createReadObservability({
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
      }),
      createDiagnosis({
        reason: "SIGNATURE_ENTRY_MISSING",
        summary: "页面签名入口不可用",
        category: "page_changed"
      }),
      gate,
      auditRecord
    );
  }

  let response: { status: number; body: unknown };
  try {
    response = await env.fetchJson({
      url: spec.buildUrl(input.params),
      method: spec.method,
      headers: buildHeaders(env, input.options, signature),
      ...(spec.method === "POST" ? { body: JSON.stringify(payload) } : {}),
      timeoutMs:
        typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
          ? Math.max(1, Math.floor(input.options.timeout_ms))
          : 30_000
    });
  } catch (error) {
    const failure = inferReadRequestException(spec, error);
    const pageStateRoot = await resolvePageStateRoot();
    if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
      return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
        reason: failure.reason,
        message: failure.message,
        detail: failure.detail
      });
    }
    return createFailure(
      "ERR_EXECUTION_FAILED",
      failure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failure.reason
      },
      createReadObservability({
        spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: failure.detail
      }),
      createDiagnosis({
        reason: failure.reason,
        summary: failure.message
      }),
      gate,
      auditRecord
    );
  }

  const responseRecord = asRecord(response.body);
  const businessCode = responseRecord?.code;
  if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
    const failure = inferReadFailure(spec, response.status, response.body);
    const pageStateRoot = await resolvePageStateRoot();
    if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
      return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
        reason: failure.reason,
        message: failure.message,
        detail: failure.message,
        statusCode: response.status
      });
    }
    return createFailure(
      "ERR_EXECUTION_FAILED",
      failure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failure.reason
      },
      createReadObservability({
        spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        statusCode: response.status,
        failureReason: failure.reason
      }),
      createDiagnosis({
        reason: failure.reason,
        summary: failure.message
      }),
      gate,
      auditRecord
    );
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
          data_ref: spec.buildDataRef(input.params, payload),
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
        approval_record: gate.approval_record,
        risk_state_output: resolveRiskStateOutput(gate, auditRecord),
        audit_record: auditRecord
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

export const executeXhsDetail = async (
  input: Omit<Extract<XhsReadExecutionInput, { command: "xhs.detail" }>, "command">,
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> =>
  executeXhsRead(
    {
      command: "xhs.detail",
      ...input
    },
    READ_COMMAND_SPECS["xhs.detail"],
    env
  );

export const executeXhsUserHome = async (
  input: Omit<Extract<XhsReadExecutionInput, { command: "xhs.user_home" }>, "command">,
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> =>
  executeXhsRead(
    {
      command: "xhs.user_home",
      ...input
    },
    READ_COMMAND_SPECS["xhs.user_home"],
    env
  );
