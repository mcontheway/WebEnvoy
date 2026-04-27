import type {
  EditorInputFocusAttestation,
  EditorInputValidationResult
} from "./xhs-editor-input.js";
import type { ExecutionMode, IssueActionMatrixEntry, IssueScope, RiskState, WriteActionMatrixDecisionsOutput, WriteInteractionTier } from "../shared/risk-state.js";

export type JsonRecord = Record<string, unknown>;

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
  issue_scope?: string;
  target_domain?: string;
  target_tab_id?: number;
  target_page?: string;
  actual_target_domain?: string;
  actual_target_tab_id?: number;
  actual_target_page?: string;
  ability_action?: string;
  action_type?: string;
  requested_execution_mode?: string;
  upstream_authorization_request?: Record<string, unknown>;
  __legacy_requested_execution_mode?: string;
  __runtime_profile_ref?: string;
  __session_rhythm_window_id?: string;
  __session_rhythm_decision_id?: string;
  __anonymous_isolation_verified?: boolean;
  target_site_logged_in?: boolean;
  risk_state?: string;
  approval?: Record<string, unknown>;
  approval_record?: Record<string, unknown>;
  audit_record?: Record<string, unknown>;
  admission_context?: Record<string, unknown>;
  limited_read_rollout_ready_true?: boolean;
  xhs_recovery_probe?: boolean;
  validation_action?: string;
  validation_text?: string;
  editor_focus_attestation?: EditorInputFocusAttestation | Record<string, unknown>;
}

export interface SignatureResult {
  "X-s": string;
  "X-t": string | number;
}

export interface FetchResult {
  status: number;
  body: unknown;
}

export interface XhsAccountSafetyOverlay {
  source: "dom_overlay";
  selector: string | null;
  text: string;
}

export type CapturedRequestContextMethod = "POST" | "GET";
export type CapturedRequestContextCommand = "xhs.search" | "xhs.detail" | "xhs.user_home";
export type PageContextNamespace = string;
export type CapturedRequestContextRejectionReason =
  | "synthetic_request_rejected"
  | "failed_request_rejected"
  | "shape_mismatch";

export interface SearchRequestShape {
  command: "xhs.search";
  method: "POST";
  pathname: typeof SEARCH_ENDPOINT;
  keyword: string;
  page: number;
  page_size: number;
  sort: string;
  note_type: number;
}

export interface DetailRequestShape {
  command: "xhs.detail";
  method: "POST";
  pathname: typeof DETAIL_ENDPOINT;
  note_id: string;
}

export interface UserHomeRequestShape {
  command: "xhs.user_home";
  method: "GET";
  pathname: typeof USER_HOME_ENDPOINT;
  user_id: string;
}

export type CapturedRequestContextShape =
  | SearchRequestShape
  | DetailRequestShape
  | UserHomeRequestShape;

export type CapturedRequestContextPath =
  | typeof SEARCH_ENDPOINT
  | typeof DETAIL_ENDPOINT
  | typeof USER_HOME_ENDPOINT;

export interface CapturedRequestContextLookup {
  method: CapturedRequestContextMethod;
  path: CapturedRequestContextPath;
  page_context_namespace: PageContextNamespace;
  shape_key: string;
}

export interface CapturedRequestContextArtifact {
  source_kind: "page_request" | "synthetic_request";
  transport: "fetch" | "xhr";
  method: CapturedRequestContextMethod;
  path: CapturedRequestContextPath;
  url: string;
  status: number;
  captured_at: number;
  observed_at?: number;
  page_context_namespace: PageContextNamespace;
  shape_key: string;
  shape: CapturedRequestContextShape;
  referrer?: string | null;
  template_ready?: boolean;
  rejection_reason?: CapturedRequestContextRejectionReason | null;
  incompatibility_reason?: "shape_mismatch" | null;
  request_status?: {
    completion: "completed" | "failed";
    http_status: number | null;
  };
  request: {
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    headers: Record<string, string>;
    body: unknown;
  };
}

export interface CapturedRequestContextLookupResult {
  page_context_namespace: PageContextNamespace;
  shape_key: string;
  admitted_template: CapturedRequestContextArtifact | null;
  rejected_observation: CapturedRequestContextArtifact | null;
  incompatible_observation: CapturedRequestContextArtifact | null;
  available_shape_keys: string[];
}

export interface XhsSearchEnvironment {
  now(): number;
  randomId(): string;
  getLocationHref(): string;
  getDocumentTitle(): string;
  getReadyState(): string;
  getCookie(): string;
  getBodyText?(): string;
  getAccountSafetyOverlay?(): XhsAccountSafetyOverlay | null;
  getPageStateRoot?(): unknown;
  readPageStateRoot?(): Promise<unknown>;
  readCapturedRequestContext?(
    input: CapturedRequestContextLookup
  ): Promise<CapturedRequestContextLookupResult | null>;
  sleep?(ms: number): Promise<void>;
  callSignature(uri: string, payload: JsonRecord): Promise<SignatureResult>;
  fetchJson(input: {
    url: string;
    method: "POST" | "GET";
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    pageContextRequest?: boolean;
    referrer?: string;
    referrerPolicy?: string;
  }): Promise<FetchResult>;
  performEditorInputValidation?(
    input: { text: string; focusAttestation?: EditorInputFocusAttestation | null }
  ): Promise<EditorInputValidationResult>;
}

export interface SearchExecutionSuccess {
  ok: true;
  payload: JsonRecord;
}

export interface SearchExecutionFailure {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  payload: JsonRecord;
}

export type SearchExecutionResult = SearchExecutionSuccess | SearchExecutionFailure;

export type ActionType = "read" | "write" | "irreversible_write";
export type RequestedExecutionMode = ExecutionMode;
export type EffectiveExecutionMode = RequestedExecutionMode | null;

export interface ScopeContextRecord {
  platform: "xhs";
  read_domain: string;
  write_domain: string;
  domain_mixing_forbidden: true;
}

export interface GateInputRecord {
  run_id: string;
  session_id: string;
  profile: string;
  issue_scope: IssueScope;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: ActionType | null;
  requested_execution_mode: RequestedExecutionMode | null;
  risk_state: RiskState;
  admission_context?: unknown;
}

export interface GateOutcomeRecord {
  decision_id: string;
  effective_execution_mode: EffectiveExecutionMode;
  gate_decision: "allowed" | "blocked";
  gate_reasons: string[];
  requires_manual_confirmation: boolean;
}

export interface ConsumerGateResult {
  issue_scope: IssueScope;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: ActionType | null;
  requested_execution_mode: RequestedExecutionMode | null;
  effective_execution_mode: EffectiveExecutionMode;
  gate_decision: "allowed" | "blocked";
  gate_reasons: string[];
  write_interaction_tier?: string | null;
}

export interface RequestAdmissionResult {
  request_ref: string | null;
  admission_decision: "allowed" | "blocked" | "deferred";
  normalized_action_type: ActionType | null;
  normalized_resource_kind: string | null;
  runtime_target_match: boolean;
  grant_match: boolean;
  anonymous_isolation_ok: boolean;
  effective_runtime_mode: EffectiveExecutionMode;
  reason_codes: string[];
  derived_from: Record<string, unknown>;
}

export interface RequestExecutionAudit {
  audit_ref: string | null;
  request_ref: string | null;
  consumed_inputs: {
    action_request_ref: string | null;
    resource_binding_ref: string | null;
    authorization_grant_ref: string | null;
    runtime_target_ref: string | null;
  };
  compatibility_refs: {
    gate_run_id: string | null;
    approval_admission_ref: string | null;
    audit_admission_ref: string | null;
    approval_record_ref: string | null;
    audit_record_ref: string | null;
    session_rhythm_window_id: string | null;
    session_rhythm_decision_id: string | null;
  };
  request_admission_decision: "allowed" | "blocked" | "deferred";
  risk_signals: string[];
  recorded_at: string;
}

export interface XhsSearchGate {
  scope_context: ScopeContextRecord;
  read_execution_policy: {
    default_mode: "dry_run";
    allowed_modes: RequestedExecutionMode[];
    blocked_actions: string[];
    live_entry_requirements: string[];
  };
  issue_action_matrix: IssueActionMatrixEntry;
  write_interaction_tier: WriteInteractionTier;
  write_action_matrix_decisions: WriteActionMatrixDecisionsOutput | null;
  gate_input: Omit<GateInputRecord, "run_id" | "session_id" | "profile">;
  gate_outcome: GateOutcomeRecord;
  consumer_gate_result: ConsumerGateResult;
  request_admission_result: RequestAdmissionResult | null;
  approval_record: {
    approval_id: string | null;
    decision_id: string;
    approved: boolean;
    approver: string | null;
    approved_at: string | null;
    checks: Record<string, boolean>;
  };
  execution_audit: RequestExecutionAudit | null;
}

export interface XhsExecutionAuditRecord {
  event_id: string;
  decision_id: string;
  approval_id: string | null;
  run_id: string;
  session_id: string;
  profile: string;
  issue_scope: IssueScope;
  risk_state: RiskState;
  next_state?: RiskState;
  transition_trigger?: string;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: ActionType | null;
  requested_execution_mode: RequestedExecutionMode | null;
  effective_execution_mode: EffectiveExecutionMode;
  gate_decision: "allowed" | "blocked";
  gate_reasons: string[];
  approver: string | null;
  approved_at: string | null;
  audited_checks?: Record<string, boolean>;
  write_interaction_tier?: string | null;
  write_action_matrix_decisions?: WriteActionMatrixDecisionsOutput | null;
  risk_signal?: boolean;
  recovery_signal?: boolean;
  session_rhythm_state?: "normal" | "cooldown" | "recovery";
  cooldown_until?: string | null;
  recovery_started_at?: string | null;
  recorded_at: string;
}

export interface XhsExecutionContext {
  runId: string;
  sessionId: string;
  profile: string;
  requestId?: string;
  commandRequestId?: string;
  gateInvocationId?: string;
}

export const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
export const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
export const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";
export const WEBENVOY_SYNTHETIC_REQUEST_HEADER = "x-webenvoy-synthetic-request";
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX = "__mw_ns__";

const hashMainWorldEventChannel = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

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

export const normalizeSearchRequestShapeInput = (input: {
  keyword: unknown;
  page?: unknown;
  page_size?: unknown;
  limit?: unknown;
  sort?: unknown;
  note_type?: unknown;
}): Omit<SearchRequestShape, "command" | "method" | "pathname"> | null => {
  const keyword = toTrimmedString(input.keyword);
  const page = input.page === undefined ? 1 : asInteger(input.page);
  const pageSizeInput =
    input.page_size !== undefined ? input.page_size : input.limit !== undefined ? input.limit : 20;
  const pageSize = asInteger(pageSizeInput);
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

export const createSearchRequestShape = (input: {
  keyword: unknown;
  page?: unknown;
  page_size?: unknown;
  limit?: unknown;
  sort?: unknown;
  note_type?: unknown;
}): SearchRequestShape | null => {
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

export const serializeSearchRequestShape = (shape: SearchRequestShape): string =>
  JSON.stringify(shape);

export const createDetailRequestShape = (input: {
  note_id?: unknown;
  source_note_id?: unknown;
}): DetailRequestShape | null => {
  const noteId = toTrimmedString(input.note_id ?? input.source_note_id);
  if (!noteId) {
    return null;
  }
  return {
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
  };
};

export const serializeDetailRequestShape = (shape: DetailRequestShape): string =>
  JSON.stringify(shape);

export const createUserHomeRequestShape = (input: {
  user_id?: unknown;
}): UserHomeRequestShape | null => {
  const userId = toTrimmedString(input.user_id);
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

export const serializeUserHomeRequestShape = (shape: UserHomeRequestShape): string =>
  JSON.stringify(shape);

export const resolveMainWorldPageContextNamespaceEventName = (secret: string): string =>
  `${MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX}${hashMainWorldEventChannel(
    `${MAIN_WORLD_EVENT_NAMESPACE}|namespace|${secret.trim()}`
  )}`;

export const createPageContextNamespace = (href: string): PageContextNamespace => {
  const normalized = href.trim();
  if (normalized.length === 0) {
    return "about:blank";
  }

  try {
    const parsed = new URL(normalized, "https://www.xiaohongshu.com/");
    const pathname = parsed.pathname.length > 0 ? parsed.pathname : "/";
    const queryIdentity = parsed.search.length > 0 ? `${pathname}${parsed.search}` : pathname;
    const documentTimeOrigin =
      typeof globalThis.performance?.timeOrigin === "number" &&
      Number.isFinite(globalThis.performance.timeOrigin)
        ? Math.trunc(globalThis.performance.timeOrigin)
        : null;
    return documentTimeOrigin === null
      ? `${parsed.origin}${queryIdentity}`
      : `${parsed.origin}${queryIdentity}#doc=${documentTimeOrigin}`;
  } catch {
    return normalized;
  }
};

export const createVisitedPageContextNamespace = (
  href: string,
  visitSequence: number
): PageContextNamespace => {
  const baseNamespace = createPageContextNamespace(href);
  return visitSequence > 0 ? `${baseNamespace}|visit=${visitSequence}` : baseNamespace;
};

export const stripVisitedPageContextNamespace = (
  namespace: string
): PageContextNamespace => {
  const visitSuffixIndex = namespace.indexOf("|visit=");
  return visitSuffixIndex >= 0 ? namespace.slice(0, visitSuffixIndex) : namespace;
};

export const resolveActiveVisitedPageContextNamespace = (
  requestedNamespace: string | null | undefined,
  currentVisitedNamespace: string | null | undefined
): PageContextNamespace | null => {
  const normalizedRequested =
    typeof requestedNamespace === "string" && requestedNamespace.length > 0
      ? (requestedNamespace as PageContextNamespace)
      : null;
  const normalizedCurrentVisited =
    typeof currentVisitedNamespace === "string" && currentVisitedNamespace.length > 0
      ? (currentVisitedNamespace as PageContextNamespace)
      : null;
  if (
    normalizedRequested &&
    normalizedCurrentVisited &&
    normalizedRequested === stripVisitedPageContextNamespace(normalizedCurrentVisited)
  ) {
    return normalizedCurrentVisited;
  }
  return normalizedRequested ?? normalizedCurrentVisited;
};
