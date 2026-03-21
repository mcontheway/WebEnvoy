type JsonRecord = Record<string, unknown>;

export interface XhsSearchParams {
  query: string;
  limit?: number;
  page?: number;
  search_id?: string;
  sort?: string;
  note_type?: string | number;
}

export interface XhsSearchOptions {
  timeout_ms?: number;
  simulate_result?: string;
  x_s_common?: string;
}

interface SignatureResult {
  "X-s": string;
  "X-t": string | number;
}

interface FetchResult {
  status: number;
  body: unknown;
}

export interface XhsSearchEnvironment {
  now(): number;
  randomId(): string;
  getLocationHref(): string;
  getDocumentTitle(): string;
  getReadyState(): string;
  getCookie(): string;
  callSignature(uri: string, payload: JsonRecord): Promise<SignatureResult>;
  fetchJson(input: {
    url: string;
    method: "POST";
    headers: Record<string, string>;
    body: string;
    timeoutMs: number;
  }): Promise<FetchResult>;
}

interface SearchExecutionSuccess {
  ok: true;
  payload: JsonRecord;
}

interface SearchExecutionFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  payload: JsonRecord;
}

export type SearchExecutionResult = SearchExecutionSuccess | SearchExecutionFailure;

const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const containsCookie = (cookie: string, key: string): boolean =>
  cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${key}=`));

const classifyPageKind = (href: string): string => {
  if (href.includes("/login")) {
    return "login";
  }
  if (href.includes("/search_result")) {
    return "search";
  }
  if (href.includes("/explore/")) {
    return "detail";
  }
  return "unknown";
};

const createObservability = (input: {
  href: string;
  title: string;
  readyState: string;
  requestId: string;
  outcome: "completed" | "failed";
  statusCode?: number;
  failureReason?: string;
}): JsonRecord => ({
  page_state: {
    page_kind: classifyPageKind(input.href),
    url: input.href,
    title: input.title,
    ready_state: input.readyState
  },
  key_requests: [
    {
      request_id: input.requestId,
      stage: "request",
      method: "POST",
      url: SEARCH_ENDPOINT,
      outcome: input.outcome,
      ...(typeof input.statusCode === "number" ? { status_code: input.statusCode } : {}),
      ...(input.failureReason ? { failure_reason: input.failureReason, request_class: "xhs.search" } : {})
    }
  ],
  failure_site:
    input.outcome === "failed"
      ? {
          stage: "request",
          component: "network",
          target: SEARCH_ENDPOINT,
          summary: input.failureReason ?? "request failed"
        }
      : null
});

const createDiagnosis = (input: {
  category: "request_failed" | "page_changed";
  reason: string;
  summary: string;
}): JsonRecord => ({
  category: input.category,
  stage: input.category === "page_changed" ? "execution" : "request",
  component: input.category === "page_changed" ? "page" : "network",
  failure_site: {
    stage: input.category === "page_changed" ? "execution" : "request",
    component: input.category === "page_changed" ? "page" : "network",
    target: input.category === "page_changed" ? "window._webmsxyw" : SEARCH_ENDPOINT,
    summary: input.summary
  },
  evidence: [input.reason, input.summary]
});

const createFailure = (
  code: string,
  message: string,
  details: JsonRecord,
  observability: JsonRecord,
  diagnosis: JsonRecord
): SearchExecutionFailure => ({
  ok: false,
  error: {
    code,
    message
  },
  payload: {
    details,
    observability,
    diagnosis
  }
});

const resolveSimulatedResult = (
  simulated: string | undefined,
  params: XhsSearchParams,
  options: XhsSearchOptions,
  env: XhsSearchEnvironment
): SearchExecutionResult | null => {
  if (!simulated) {
    return null;
  }

  const requestId = `req-${env.randomId()}`;
  const observability = createObservability({
    href: env.getLocationHref(),
    title: env.getDocumentTitle(),
    readyState: env.getReadyState(),
    requestId,
    outcome: simulated === "success" ? "completed" : "failed",
    statusCode:
      simulated === "account_abnormal"
        ? 461
        : simulated === "browser_env_abnormal"
          ? 200
          : simulated === "gateway_invoker_failed"
            ? 500
            : undefined,
    failureReason: simulated === "success" ? undefined : simulated
  });

  if (simulated === "success") {
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

  const reasonMap: Record<string, { reason: string; message: string; category: "request_failed" | "page_changed" }> = {
    login_required: {
      reason: "SESSION_EXPIRED",
      message: "登录态缺失，无法执行 xhs.search",
      category: "request_failed"
    },
    signature_entry_missing: {
      reason: "SIGNATURE_ENTRY_MISSING",
      message: "页面签名入口不可用",
      category: "page_changed"
    },
    account_abnormal: {
      reason: "ACCOUNT_ABNORMAL",
      message: "账号异常，平台拒绝当前请求",
      category: "request_failed"
    },
    browser_env_abnormal: {
      reason: "BROWSER_ENV_ABNORMAL",
      message: "浏览器环境异常，平台拒绝当前请求",
      category: "request_failed"
    },
    gateway_invoker_failed: {
      reason: "GATEWAY_INVOKER_FAILED",
      message: "网关调用失败，当前上下文不足以完成搜索请求",
      category: "request_failed"
    }
  };

  const mapped = reasonMap[simulated] ?? reasonMap.gateway_invoker_failed;
  return createFailure(
    "ERR_EXECUTION_FAILED",
    mapped.message,
    {
      stage: "execution",
      reason: mapped.reason
    },
    observability,
    createDiagnosis({
      category: mapped.category,
      reason: mapped.reason,
      summary: mapped.message
    })
  );
};

const parseCount = (body: unknown): number => {
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

const inferFailure = (status: number, body: unknown): { reason: string; message: string } => {
  const record = asRecord(body);
  const businessCode = record?.code;
  const message = typeof record?.msg === "string" ? record.msg : typeof record?.message === "string" ? record.message : "";
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

const resolveXsCommon = (value: unknown): string => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "{}";
};

export const executeXhsSearch = async (
  input: {
    abilityId: string;
    abilityLayer: string;
    abilityAction: string;
    params: XhsSearchParams;
    options: XhsSearchOptions;
  },
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> => {
  const simulated = resolveSimulatedResult(input.options.simulate_result, input.params, input.options, env);
  if (simulated) {
    if (simulated.ok) {
      const summary = asRecord(simulated.payload.summary) ?? {};
      const capability = asRecord(summary.capability_result) ?? {};
      capability.ability_id = input.abilityId;
      capability.layer = input.abilityLayer;
      capability.action = input.abilityAction;
      return {
        ok: true,
        payload: {
          ...simulated.payload,
          summary: {
            capability_result: capability
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
        }
      }
    };
  }

  const startedAt = env.now();
  const href = env.getLocationHref();
  const title = env.getDocumentTitle();
  const readyState = env.getReadyState();
  const requestId = `req-${env.randomId()}`;
  const timeoutMs =
    typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
      ? Math.max(1, Math.floor(input.options.timeout_ms))
      : 30_000;

  if (!containsCookie(env.getCookie(), "a1")) {
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "登录态缺失，无法执行 xhs.search",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SESSION_EXPIRED"
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        failureReason: "SESSION_EXPIRED"
      }),
      createDiagnosis({
        category: "request_failed",
        reason: "SESSION_EXPIRED",
        summary: "登录态缺失，无法执行 xhs.search"
      })
    );
  }

  const payload: JsonRecord = {
    keyword: input.params.query,
    page: input.params.page ?? 1,
    page_size: input.params.limit ?? 20,
    search_id: input.params.search_id ?? env.randomId(),
    sort: input.params.sort ?? "general",
    note_type: input.params.note_type ?? 0
  };

  let signature: SignatureResult;
  try {
    signature = await env.callSignature(SEARCH_ENDPOINT, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFailure(
      "ERR_EXECUTION_FAILED",
      "页面签名入口不可用",
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "SIGNATURE_ENTRY_MISSING"
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        failureReason: message
      }),
      createDiagnosis({
        category: "page_changed",
        reason: "SIGNATURE_ENTRY_MISSING",
        summary: "页面签名入口不可用"
      })
    );
  }

  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json;charset=utf-8",
    "X-s": String(signature["X-s"]),
    "X-t": String(signature["X-t"]),
    "X-S-Common": resolveXsCommon(input.options.x_s_common),
    "x-b3-traceid": env.randomId().replace(/-/g, ""),
    "x-xray-traceid": env.randomId().replace(/-/g, "")
  };

  const response = await env.fetchJson({
    url: SEARCH_ENDPOINT,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs
  });

  const responseRecord = asRecord(response.body);
  const businessCode = responseRecord?.code;
  if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
    const failure = inferFailure(response.status, response.body);
    return createFailure(
      "ERR_EXECUTION_FAILED",
      failure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failure.reason
      },
      createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "failed",
        statusCode: response.status,
        failureReason: failure.reason
      }),
      createDiagnosis({
        category: "request_failed",
        reason: failure.reason,
        summary: failure.message
      })
    );
  }

  const count = parseCount(response.body);
  return {
    ok: true,
    payload: {
      summary: {
        capability_result: {
          ability_id: input.abilityId,
          layer: input.abilityLayer,
          action: input.abilityAction,
          outcome: "success",
          data_ref: {
            query: input.params.query,
            search_id: payload.search_id
          },
          metrics: {
            count,
            duration_ms: Math.max(0, env.now() - startedAt)
          }
        }
      },
      observability: createObservability({
        href,
        title,
        readyState,
        requestId,
        outcome: "completed",
        statusCode: response.status
      })
    }
  };
};
