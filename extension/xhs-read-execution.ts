import {
  createUserHomeRequestShape,
  createPageContextNamespace,
  type JsonRecord,
  type SearchExecutionResult,
  type XhsExecutionContext,
  type XhsSearchEnvironment,
  type XhsSearchOptions
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
const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";

type CapturedReadRequestContextArtifact = {
  source_kind?: "page_request" | "synthetic_request" | string;
  transport?: "fetch" | string;
  method?: "POST" | "GET" | string;
  path?: string;
  url?: string;
  status?: number;
  captured_at?: number;
  observed_at?: number;
  page_context_namespace?: string;
  shape_key?: string;
  shape?: unknown;
  referrer?: string | null;
  template_ready?: boolean;
  rejection_reason?: "synthetic_request_rejected" | "failed_request_rejected" | "shape_mismatch" | null;
  incompatibility_reason?: "shape_mismatch" | null;
  request_status?: {
    completion?: "completed" | "failed" | string;
    http_status?: number | null;
  };
  request?: {
    headers?: Record<string, string>;
    body?: unknown;
  };
  response?: {
    headers?: Record<string, string>;
    body?: unknown;
  };
  template_headers?: Record<string, string>;
};

type CapturedReadRequestContextLookupResponse = {
  page_context_namespace?: string;
  shape_key?: string;
  admitted_template?: CapturedReadRequestContextArtifact | null;
  rejected_observation?: CapturedReadRequestContextArtifact | null;
  incompatible_observation?: CapturedReadRequestContextArtifact | null;
  available_shape_keys?: string[];
};

type CapturedReadRequestContextLookupInput = {
  method: "POST" | "GET";
  path: string;
  page_context_namespace: string;
  shape_key: string;
};

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

type DetailRequestShape = {
  command: "xhs.detail";
  method: "POST";
  pathname: typeof DETAIL_ENDPOINT;
  note_id: string;
};

type UserHomeRequestShape = {
  command: "xhs.user_home";
  method: "GET";
  pathname: typeof USER_HOME_ENDPOINT;
  user_id: string;
};

type ReadRequestShape = DetailRequestShape | UserHomeRequestShape;

type RequestContextMissReason =
  | "template_missing"
  | "shape_mismatch"
  | "template_stale"
  | "request_context_read_failed"
  | "synthetic_request_rejected"
  | "failed_request_rejected"
  | "SESSION_EXPIRED"
  | "ACCOUNT_ABNORMAL"
  | "BROWSER_ENV_ABNORMAL"
  | "GATEWAY_INVOKER_FAILED"
  | "CAPTCHA_REQUIRED"
  | "TARGET_API_RESPONSE_INVALID";

type ReadRequestContextLookupResult =
  | {
      state: "hit";
      shape: ReadRequestShape;
      headers: Record<string, string>;
      referrer: string | null;
      requestUrl: string | null;
      requestBody: JsonRecord | null;
    }
  | {
      state: "miss";
      reason: "template_missing" | "shape_mismatch";
    }
  | {
      state: "incompatible";
      reason: "shape_mismatch";
      shape: ReadRequestShape | null;
    }
  | {
      state: "stale";
      reason: "template_stale";
      shape: ReadRequestShape;
    }
  | {
      state: "rejected_source";
      reason: RequestContextMissReason;
      shape: ReadRequestShape;
    }
  | {
      state: "error";
      reason: "request_context_read_failed";
      detail: string | null;
    };

const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60_000;
const REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS = 10;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 150;
const BACKEND_REJECTED_SOURCE_REASONS = new Set<RequestContextMissReason>([
  "SESSION_EXPIRED",
  "ACCOUNT_ABNORMAL",
  "BROWSER_ENV_ABNORMAL",
  "GATEWAY_INVOKER_FAILED",
  "CAPTCHA_REQUIRED",
  "TARGET_API_RESPONSE_INVALID"
]);

const XHS_DETAIL_SPEC: XhsReadCommandSpec = {
  command: "xhs.detail",
  endpoint: DETAIL_ENDPOINT,
  method: "POST",
  pageKind: "detail",
  requestClass: "xhs.detail",
  buildPayload: (params) => ({
    source_note_id: (params as XhsDetailParams).note_id
  }),
  buildUrl: () => "/api/sns/web/v1/feed",
  buildSignatureUri: () => DETAIL_ENDPOINT,
  buildDataRef: (params) => ({
    note_id: (params as XhsDetailParams).note_id
  })
};

const XHS_USER_HOME_SPEC: XhsReadCommandSpec = {
  command: "xhs.user_home",
  endpoint: USER_HOME_ENDPOINT,
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

const asArray = (value: unknown): unknown[] | null => (Array.isArray(value) ? value : null);

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

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

const parseJsonRecord = (value: unknown): JsonRecord | null => {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return asRecord(value);
};

const normalizeCapturedHeaders = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
};

const getCapturedHeader = (headers: Record<string, string>, key: string): string | null => {
  const matchedEntry = Object.entries(headers).find(
    ([candidate]) => candidate.toLowerCase() === key.toLowerCase()
  );
  return matchedEntry && matchedEntry[1].trim().length > 0 ? matchedEntry[1].trim() : null;
};

const resolveCapturedArtifactHeaders = (value: unknown): Record<string, string> => {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const request = asRecord(record.request);
  return normalizeCapturedHeaders(record.template_headers ?? request?.headers);
};

const resolveCapturedArtifactReferrer = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  return asString(record.referrer);
};

const resolveCapturedArtifactRequestUrl = (value: unknown): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const rawUrl = asString(record.url);
  if (rawUrl) {
    try {
      const url = new URL(rawUrl, "https://www.xiaohongshu.com");
      return `${url.pathname}${url.search}`;
    } catch {
      return rawUrl;
    }
  }
  return asString(record.path);
};

const resolveCapturedArtifactRequestBody = (value: unknown): JsonRecord | null => {
  const record = asRecord(value);
  const request = asRecord(record?.request);
  return asRecord(request?.body);
};

const resolveCapturedArtifactStatus = (value: unknown): {
  sourceKind: string | null;
  httpStatus: number | null;
  templateReady: boolean | null;
  rejectionReason:
    | "synthetic_request_rejected"
    | "failed_request_rejected"
    | "shape_mismatch"
    | null;
} => {
  const record = asRecord(value);
  const requestStatus = asRecord(record?.request_status);
  const sourceKind = asString(record?.source_kind);
  const httpStatus = asInteger(requestStatus?.http_status) ?? asInteger(record?.status);
  const completion = asString(requestStatus?.completion);
  const templateReady =
    typeof record?.template_ready === "boolean" ? (record.template_ready as boolean) : null;
  const explicitReason = asString(record?.rejection_reason);
  const rejectionReason =
    explicitReason === "synthetic_request_rejected" ||
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

const resolveCapturedArtifactObservedAt = (value: unknown): number | null => {
  const record = asRecord(value);
  return asInteger(record?.observed_at) ?? asInteger(record?.captured_at);
};

const isCapturedArtifactStale = (value: unknown, now: number): boolean => {
  const observedAt = resolveCapturedArtifactObservedAt(value);
  return observedAt === null || now - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS;
};

const resolveRejectedSourceReason = (
  spec: XhsReadCommandSpec,
  artifact: Record<string, unknown>
): RequestContextMissReason => {
  const status = resolveCapturedArtifactStatus(artifact);
  if (
    status.rejectionReason === "synthetic_request_rejected" ||
    status.rejectionReason === "shape_mismatch"
  ) {
    return status.rejectionReason;
  }
  if (status.rejectionReason === "failed_request_rejected") {
    const response = asRecord(artifact.response);
    const responseBody = response?.body;
    const inferred = inferReadFailure(spec, status.httpStatus ?? 0, responseBody);
    if (BACKEND_REJECTED_SOURCE_REASONS.has(inferred.reason as RequestContextMissReason)) {
      return inferred.reason as RequestContextMissReason;
    }
    return "failed_request_rejected";
  }
  return "failed_request_rejected";
};

const resolveRejectedSourceMessage = (
  spec: XhsReadCommandSpec,
  reason: RequestContextMissReason
): string | null => {
  switch (reason) {
    case "SESSION_EXPIRED":
      return `登录已失效，无法执行 ${spec.command}`;
    case "ACCOUNT_ABNORMAL":
      return "账号异常，平台拒绝当前请求";
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

const waitForRequestContextRetry = async (
  env: XhsSearchEnvironment,
  ms: number
): Promise<void> => {
  if (typeof env.sleep === "function") {
    await env.sleep(ms);
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

const resolveExactShapeLookupArtifacts = (lookupRecord: Record<string, unknown>): {
  admittedTemplate: Record<string, unknown> | null;
  rejectedObservation: Record<string, unknown> | null;
} => {
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
  if (
    rejectedObservedAt !== null &&
    (admittedObservedAt === null || rejectedObservedAt > admittedObservedAt)
  ) {
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

const parseUserIdFromUrl = (value: string | null): string | null => {
  if (!value) {
    return null;
  }
  try {
    const url = new URL(value, "https://www.xiaohongshu.com");
    return asString(url.searchParams.get("user_id"));
  } catch {
    return null;
  }
};

const resolveDetailResponseNoteId = (
  value: unknown,
  preferredNoteId?: string | null,
  options?: {
    allowBareIdAlias?: boolean;
  }
): string | null => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  let fallbackNoteId: string | null = null;
  for (const candidate of getDetailResponseCandidates(record)) {
    const candidateNoteId = asString(candidate.note_id) ?? asString(candidate.noteId);
    if (candidateNoteId) {
      if (preferredNoteId && candidateNoteId === preferredNoteId) {
        return candidateNoteId;
      }
      fallbackNoteId ??= candidateNoteId;
      continue;
    }
    if (
      options?.allowBareIdAlias &&
      asString(candidate.id)
    ) {
      const bareId = asString(candidate.id) as string;
      if (!preferredNoteId || bareId === preferredNoteId) {
        return bareId;
      }
      return bareId;
    }
  }
  return preferredNoteId ? null : fallbackNoteId;
};

const hasUserHomeResponseDataShape = (record: JsonRecord): boolean =>
  [
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

const iterateUserHomeResponseCandidates = (value: unknown): JsonRecord[] => {
  const collectCandidates = (candidate: unknown, seen = new Set<JsonRecord>()): JsonRecord[] => {
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

const resolveUserHomeResponseUserId = (
  value: unknown,
  preferredUserId?: string | null
): string | null => {
  let fallbackUserId: string | null = null;
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

const createDetailShape = (noteId: string): DetailRequestShape => ({
  command: "xhs.detail",
  method: "POST",
  pathname: DETAIL_ENDPOINT,
  note_id: noteId
});

const deriveReadShapeFromCommand = (
  spec: XhsReadCommandSpec,
  params: XhsDetailParams | XhsUserHomeParams
): ReadRequestShape =>
  spec.command === "xhs.detail"
    ? {
        command: "xhs.detail",
        method: "POST",
        pathname: DETAIL_ENDPOINT,
        note_id: (params as XhsDetailParams).note_id
      }
    : {
        command: "xhs.user_home",
        method: "GET",
        pathname: USER_HOME_ENDPOINT,
        user_id: (params as XhsUserHomeParams).user_id
      };

const deriveDetailShapeFromSource = (value: unknown): DetailRequestShape | null => {
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

const deriveDetailRejectedShapeFromRequestSource = (value: unknown): DetailRequestShape | null => {
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

const deriveUserHomeShapeFromSource = (value: unknown): UserHomeRequestShape | null => {
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

const deriveReadShapeFromArtifact = (
  spec: XhsReadCommandSpec,
  artifact: CapturedReadRequestContextArtifact | Record<string, unknown> | null,
  options?: {
    preferredDetailNoteId?: string | null;
    allowDetailRequestFallback?: boolean;
    allowDetailResponseBareIdAlias?: boolean;
  }
): ReadRequestShape | null => {
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
        const responseNoteId =
          resolveDetailResponseNoteId(response?.body, preferredNoteId, {
            allowBareIdAlias: options?.allowDetailResponseBareIdAlias
          }) ??
          resolveDetailResponseNoteId(response?.body);
        return responseNoteId ? createDetailShape(responseNoteId) : null;
      })();
      if (
        explicitDetailShape &&
        responseDetailShape &&
        responseDetailShape.note_id !== explicitDetailShape.note_id
      ) {
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
    const responseUserId = resolveUserHomeResponseUserId(
      response?.body,
      explicitUserHomeShape?.user_id ?? null
    );
    return explicitUserHomeShape &&
      responseUserId &&
      responseUserId === explicitUserHomeShape.user_id
      ? explicitUserHomeShape
      : null;
  }
  if (spec.command === "xhs.detail") {
    const noteIdFromResponse =
      resolveDetailResponseNoteId(response?.body, options?.preferredDetailNoteId) ??
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
    return (
      createUserHomeRequestShape({
        user_id: expectedUserId
      }) ?? null
    );
  }
  return null;
};

const serializeReadShape = (shape: ReadRequestShape): string =>
  shape.command === "xhs.detail"
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

const resolveReadRequestContext = (
  spec: XhsReadCommandSpec,
  artifact: CapturedReadRequestContextLookupResponse | Record<string, unknown> | null,
  expectedShape: ReadRequestShape,
  now: number,
  options?: {
    allowDetailRequestFallback?: boolean;
    allowDetailResponseBareIdAlias?: boolean;
  }
): ReadRequestContextLookupResult => {
  if (!artifact) {
    return {
      state: "miss",
      reason: "template_missing"
    };
  }
  const lookupRecord = asRecord(artifact);
  if (
    lookupRecord &&
    ("admitted_template" in lookupRecord ||
      "rejected_observation" in lookupRecord ||
      "incompatible_observation" in lookupRecord)
  ) {
    const { admittedTemplate, rejectedObservation } = resolveExactShapeLookupArtifacts(lookupRecord);
    const incompatibleObservation = asRecord(lookupRecord.incompatible_observation);
    if (admittedTemplate) {
      return resolveReadRequestContext(
        spec,
        admittedTemplate as CapturedReadRequestContextArtifact | Record<string, unknown>,
        expectedShape,
        now,
        {
          allowDetailResponseBareIdAlias: false,
          allowDetailRequestFallback: false
        }
      );
    }
    if (rejectedObservation) {
      const derivedShape = deriveReadShapeFromArtifact(spec, rejectedObservation, {
        preferredDetailNoteId:
          spec.command === "xhs.detail" ? (expectedShape as DetailRequestShape).note_id : null,
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
      return {
        state: "rejected_source",
        reason: resolveRejectedSourceReason(spec, rejectedObservation),
        shape: derivedShape ?? expectedShape
      };
    }
    if (incompatibleObservation) {
      return {
        state: "incompatible",
        reason: "shape_mismatch",
        shape: deriveReadShapeFromArtifact(spec, incompatibleObservation, {
          preferredDetailNoteId:
            spec.command === "xhs.detail" ? (expectedShape as DetailRequestShape).note_id : null,
          allowDetailResponseBareIdAlias: true,
          allowDetailRequestFallback: true
        })
      };
    }
    const availableShapeKeys = Array.isArray(lookupRecord.available_shape_keys)
      ? lookupRecord.available_shape_keys.filter((item): item is string => typeof item === "string")
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
  const derivedShape = deriveReadShapeFromArtifact(
    spec,
    artifact as CapturedReadRequestContextArtifact | Record<string, unknown> | null,
    {
      preferredDetailNoteId:
        spec.command === "xhs.detail" ? (expectedShape as DetailRequestShape).note_id : null,
      allowDetailResponseBareIdAlias: options?.allowDetailResponseBareIdAlias ?? false,
      allowDetailRequestFallback:
        spec.command === "xhs.detail" && !resolveCapturedArtifactStatus(artifact).rejectionReason
          ? false
          : (options?.allowDetailRequestFallback ?? true)
    }
  );
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
    return {
      state: "rejected_source",
      reason: resolveRejectedSourceReason(spec, artifact as Record<string, unknown>),
      shape: derivedShape
    };
  }

  return {
    state: "hit",
    shape: derivedShape,
    headers: resolveCapturedArtifactHeaders(artifact),
    referrer: resolveCapturedArtifactReferrer(artifact),
    requestUrl: resolveCapturedArtifactRequestUrl(artifact),
    requestBody: resolveCapturedArtifactRequestBody(artifact)
  };
};

const failClosedForRequestContext = (
  input: {
    abilityId: string;
    spec: XhsReadCommandSpec;
    expectedShape: ReadRequestShape;
    lookupResult: Exclude<ReadRequestContextLookupResult, { state: "hit" }>;
    gate: ReturnType<typeof resolveGate>;
    auditRecord: ReturnType<typeof createAuditRecord>;
  },
  env: XhsSearchEnvironment
): SearchExecutionResult => {
  const failureSurface = resolveRequestContextFailureSurface(input.spec, input.lookupResult);
  return withExecutionAuditInFailurePayload(
    createFailure(
      "ERR_EXECUTION_FAILED",
      failureSurface.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failureSurface.reasonCode,
        request_context_result: failureSurface.resultKind,
        request_context_lookup_state: input.lookupResult.state,
        request_context_miss_reason: input.lookupResult.reason,
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        ...("shape" in input.lookupResult && input.lookupResult.shape
          ? { captured_request_shape: input.lookupResult.shape }
          : {})
      },
      createReadObservability({
        spec: input.spec,
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
      }),
      createReadDiagnosis(input.spec, {
        reason: input.lookupResult.reason,
        summary: failureSurface.message,
        category: "page_changed"
      }),
      input.gate,
      input.auditRecord
    ),
    input.gate.execution_audit as JsonRecord | null
  );
};

const resolveRequestContextFailureSurface = (
  spec: XhsReadCommandSpec,
  lookupResult: Exclude<ReadRequestContextLookupResult, { state: "hit" }>
): {
  resultKind: "request_context_missing" | "request_context_incompatible";
  message: string;
  reasonCode: string;
} => {
  const isIncompatible =
    lookupResult.state === "incompatible" || lookupResult.reason === "shape_mismatch";
  if (lookupResult.state === "error") {
    return {
      resultKind: "request_context_missing",
      message: `当前页面现场请求上下文读取失败，无法继续执行 ${spec.command}`,
      reasonCode: "REQUEST_CONTEXT_READ_FAILED"
    };
  }
  const rejectedSourceMessage =
    lookupResult.state === "rejected_source"
      ? resolveRejectedSourceMessage(spec, lookupResult.reason)
      : null;
  const resultKind = isIncompatible ? "request_context_incompatible" : "request_context_missing";
  const message =
    rejectedSourceMessage ??
    (isIncompatible
      ? `当前页面现场不存在与 ${spec.command} 完全一致的请求上下文`
      : `当前页面现场缺少可复用的 ${spec.command} 请求上下文`);
  const reasonCode =
    rejectedSourceMessage && BACKEND_REJECTED_SOURCE_REASONS.has(lookupResult.reason)
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

const readCapturedReadContextWithRetry = async (
  spec: XhsReadCommandSpec,
  expectedShape: ReadRequestShape,
  env: XhsSearchEnvironment
): Promise<ReadRequestContextLookupResult> => {
  const readCapturedRequestContext = env.readCapturedRequestContext as
    | ((input: CapturedReadRequestContextLookupInput) => Promise<CapturedReadRequestContextLookupResponse | null>)
    | undefined;
  if (!readCapturedRequestContext) {
    return resolveReadRequestContext(spec, null, expectedShape, env.now());
  }

  let pageContextNamespace = createPageContextNamespace(env.getLocationHref());
  const lookupOnce = async (): Promise<ReadRequestContextLookupResult> => {
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
    } catch (error) {
      return {
        state: "error",
        reason: "request_context_read_failed",
        detail: error instanceof Error ? error.message : String(error)
      };
    }
  };

  let lastResult = await lookupOnce();

  for (
    let attempt = 1;
    attempt < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS && lastResult.state !== "hit";
    attempt += 1
  ) {
    await waitForRequestContextRetry(env, REQUEST_CONTEXT_WAIT_RETRY_MS);
    lastResult = await lookupOnce();
  }

  return lastResult;
};

const withExecutionAuditInFailurePayload = (
  result: SearchExecutionResult,
  executionAudit: JsonRecord | null
): SearchExecutionResult => {
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

const containsTargetIdentifier = (
  value: unknown,
  target: string,
  candidateKeys: readonly string[]
): boolean => {
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

const collectCandidateRecords = (value: unknown): JsonRecord[] => {
  const record = asRecord(value);
  if (record) {
    return [record];
  }

  const array = asArray(value);
  if (array) {
    return array.map((entry) => asRecord(entry)).filter((entry): entry is JsonRecord => entry !== null);
  }

  return [];
};

const collectNestedRecordCandidates = (
  value: unknown,
  nestedKeys: readonly string[],
  seen = new Set<JsonRecord>()
): JsonRecord[] => {
  const directCandidates = collectCandidateRecords(value);
  const nestedCandidates: JsonRecord[] = [];

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

const hasDetailDataShape = (record: JsonRecord): boolean =>
  [
    "title",
    "desc",
    "user",
    "interact_info",
    "image_list",
    "video_info",
    "note_card",
    "note_card_list"
  ].some((key) => key in record);

const hasUserDataShape = (record: JsonRecord): boolean =>
  [
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

const getDetailResponseCandidates = (body: unknown): JsonRecord[] => {
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

const getUserHomeResponseCandidates = (body: unknown): JsonRecord[] => {
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

const responseContainsRequestedTarget = (
  spec: XhsReadCommandSpec,
  params: XhsDetailParams | XhsUserHomeParams,
  body: unknown
): boolean => {
  if (spec.command === "xhs.detail") {
    return getDetailResponseCandidates(body).some((candidate) =>
      containsTargetIdentifier(candidate, (params as XhsDetailParams).note_id, [
        "note_id",
        "noteId"
      ])
    );
  }
  return getUserHomeResponseCandidates(body).some((candidate) =>
    containsTargetIdentifier(candidate, (params as XhsUserHomeParams).user_id, [
      "user_id",
      "userId"
    ])
  );
};

const createReadDiagnosis = (
  spec: XhsReadCommandSpec,
  input: {
    reason: string;
    summary: string;
    category?: "request_failed" | "page_changed";
  }
): JsonRecord => {
  const diagnosis = createDiagnosis(input);
  const failureSite = asRecord(diagnosis.failure_site);
  const shouldUseEndpointTarget =
    (typeof failureSite?.component === "string" ? failureSite.component : null) === "network";
  return {
    ...diagnosis,
    failure_site: {
      ...(failureSite ?? {}),
      ...(shouldUseEndpointTarget ? { target: spec.endpoint } : {}),
      summary: input.summary
    }
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
  ].filter((value): value is string => value !== null);

  if (!candidateUserIds.some((userId) => userId === params.user_id)) {
    return false;
  }

  return (
    asRecord(root?.board) !== null ||
    asRecord(root?.note) !== null ||
    hasUserHomeResponseDataShape(user) ||
    asRecord(user.basic_info) !== null ||
    asRecord(user.basicInfo) !== null ||
    asRecord(user.profile) !== null
  );
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
    requestContextDetails?: JsonRecord;
    requestAttempted?: boolean;
    failureSite?: {
      stage: string;
      component: string;
      target: string;
      summary: string;
    };
  }
): SearchExecutionResult => {
  const requestId = `req-${env.randomId()}`;
  const requestAttempted = requestFailure.requestAttempted !== false;
  return withExecutionAuditInFailurePayload(
    createFailure(
      "ERR_EXECUTION_FAILED",
      requestFailure.message,
      {
        ability_id: input.abilityId,
        stage: "execution",
        reason: requestFailure.reason,
        ...(requestFailure.requestContextDetails ?? {})
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
        failure_site:
          requestFailure.failureSite ??
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
      },
      createReadDiagnosis(spec, {
        reason: requestFailure.reason,
        summary: requestFailure.message
      }),
      gate,
      auditRecord
    ),
    gate.execution_audit as JsonRecord | null
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

const resolveSimulatedResult = (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  payload: JsonRecord,
  env: XhsSearchEnvironment,
  gate?: ReturnType<typeof resolveGate>,
  auditRecord?: ReturnType<typeof createAuditRecord>
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

  const simulatedReasonMap: Record<string, { reason: string; message: string; statusCode?: number }> = {
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
  const mapped =
    simulatedReasonMap[input.options.simulate_result] ??
    inferReadFailure(spec, input.options.simulate_result === "account_abnormal" ? 461 : 500, {
      code: input.options.simulate_result === "account_abnormal" ? 300011 : undefined,
      msg:
        input.options.simulate_result === "browser_env_abnormal"
          ? "Browser environment abnormal"
          : input.options.simulate_result === "gateway_invoker_failed"
            ? "create invoker failed"
            : input.options.simulate_result
    });
  return withExecutionAuditInFailurePayload(
    createFailure(
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
        ...(typeof mapped.statusCode === "number" ? { statusCode: mapped.statusCode } : {}),
        failureReason: input.options.simulate_result
      }),
      createReadDiagnosis(spec, {
        reason: mapped.reason,
        summary: mapped.message
      }),
      gate,
      auditRecord
    ),
    (gate?.execution_audit as JsonRecord | null) ?? null
  );
};

const buildHeaders = (
  env: XhsSearchEnvironment,
  options: XhsSearchOptions,
  signature: { "X-s": string; "X-t": string | number },
  capturedHeaders?: Record<string, string> | null
): Record<string, string> => ({
  Accept:
    getCapturedHeader(capturedHeaders ?? {}, "Accept") ?? "application/json, text/plain, */*",
  ...(options.target_domain === "www.xiaohongshu.com" || options.target_domain === undefined
    ? {}
    : {}),
  ...(signature
    ? {
        "X-s": String(signature["X-s"]),
        "X-t": String(signature["X-t"]),
        "X-S-Common":
          getCapturedHeader(capturedHeaders ?? {}, "X-S-Common") ??
          options.x_s_common ??
          resolveXsCommon(undefined),
        "x-b3-traceid": env.randomId().replace(/-/g, ""),
        "x-xray-traceid": env.randomId().replace(/-/g, "")
      }
    : {}),
  "Content-Type":
    getCapturedHeader(capturedHeaders ?? {}, "Content-Type") ?? "application/json;charset=utf-8"
});

const executeXhsRead = async (
  input: XhsReadExecutionInput,
  spec: XhsReadCommandSpec,
  env: XhsSearchEnvironment
): Promise<SearchExecutionResult> => {
  const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
  const auditRecord = createAuditRecord(input.executionContext, gate, env);
  const startedAt = env.now();
  const builtPayload = spec.buildPayload(input.params, env);
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
    return withExecutionAuditInFailurePayload(
      createFailure(
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
        createReadDiagnosis(spec, {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          summary: "执行模式门禁阻断"
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
    );
  }

  if (
    gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
    gate.consumer_gate_result.effective_execution_mode === "recon"
  ) {
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

  if (!containsCookie(env.getCookie(), "a1")) {
    return withExecutionAuditInFailurePayload(
      createFailure(
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
        createReadDiagnosis(spec, {
          reason: "SESSION_EXPIRED",
          summary: `登录态缺失，无法执行 ${spec.command}`
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
    );
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
        requestAttempted: false,
        failureSite: {
          stage: "execution",
          component: "page",
          target: "captured_request_context",
          summary: failureSurface.message
        },
        requestContextDetails: {
          request_context_result: failureSurface.resultKind,
          request_context_lookup_state: requestContextResult.state,
          request_context_miss_reason: requestContextResult.reason,
          request_context_shape: expectedShape,
          request_context_shape_key: serializeReadShape(expectedShape),
          ...("shape" in requestContextResult && requestContextResult.shape
            ? { captured_request_shape: requestContextResult.shape }
            : {})
        }
      });
    }
    return failClosedForRequestContext(
      {
        abilityId: input.abilityId,
        spec,
        expectedShape,
        lookupResult: requestContextResult,
        gate,
        auditRecord
      },
      env
    );
  }

  const requestPayload = requestContextResult.requestBody ?? builtPayload;
  const requestUrl = requestContextResult.requestUrl ?? spec.buildUrl(input.params);
  const signatureUri = requestContextResult.requestUrl ?? spec.buildSignatureUri(input.params);

  let signature: { "X-s": string; "X-t": string | number };
  try {
    signature = await env.callSignature(signatureUri, requestPayload);
  } catch (error) {
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
    return withExecutionAuditInFailurePayload(
      createFailure(
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
        createReadDiagnosis(spec, {
          reason: "SIGNATURE_ENTRY_MISSING",
          summary: "页面签名入口不可用",
          category: "page_changed"
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
    );
  }

  let response: { status: number; body: unknown };
  try {
    response = await env.fetchJson({
      url: requestUrl,
      method: spec.method,
      headers: buildHeaders(env, input.options, signature, requestContextResult.headers),
      ...(spec.method === "POST" ? { body: JSON.stringify(requestPayload) } : {}),
      pageContextRequest: true,
      referrer: requestContextResult.referrer ?? env.getLocationHref(),
      referrerPolicy: "strict-origin-when-cross-origin",
      timeoutMs:
        typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
          ? Math.max(1, Math.floor(input.options.timeout_ms))
          : 30_000
    });
  } catch (error) {
    const failure = inferReadRequestException(spec, error);
    const pageStateRoot = await resolvePageStateRoot();
    if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
      return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
        reason: failure.reason,
        message: failure.message,
        detail: failure.detail
      });
    }
    return withExecutionAuditInFailurePayload(
      createFailure(
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
        createReadDiagnosis(spec, {
          reason: failure.reason,
          summary: failure.message
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
    );
  }

  const responseRecord = asRecord(response.body);
  const businessCode = responseRecord?.code;
  if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
    const failure = inferReadFailure(spec, response.status, response.body);
    const pageStateRoot = await resolvePageStateRoot();
    if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
      return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
        reason: failure.reason,
        message: failure.message,
        detail: failure.message,
        statusCode: response.status
      });
    }
    return withExecutionAuditInFailurePayload(
      createFailure(
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
        createReadDiagnosis(spec, {
          reason: failure.reason,
          summary: failure.message
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
    );
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
    return withExecutionAuditInFailurePayload(
      createFailure(
        "ERR_EXECUTION_FAILED",
        `${spec.command} 接口返回成功但未包含目标数据`,
        {
          ability_id: input.abilityId,
          stage: "execution",
          reason: "TARGET_DATA_NOT_FOUND"
        },
        createReadObservability({
          spec,
          href: env.getLocationHref(),
          title: env.getDocumentTitle(),
          readyState: env.getReadyState(),
          requestId: `req-${env.randomId()}`,
          outcome: "failed",
          statusCode: response.status,
          failureReason: "TARGET_DATA_NOT_FOUND"
        }),
        createReadDiagnosis(spec, {
          reason: "TARGET_DATA_NOT_FOUND",
          summary: `${spec.command} 接口返回成功但未包含目标数据`
        }),
        gate,
        auditRecord
      ),
      gate.execution_audit as JsonRecord | null
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
