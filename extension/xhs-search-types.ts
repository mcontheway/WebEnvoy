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
  __anonymous_isolation_verified?: boolean;
  target_site_logged_in?: boolean;
  risk_state?: string;
  approval?: Record<string, unknown>;
  approval_record?: Record<string, unknown>;
  audit_record?: Record<string, unknown>;
  admission_context?: Record<string, unknown>;
  limited_read_rollout_ready_true?: boolean;
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

export interface XhsSearchEnvironment {
  now(): number;
  randomId(): string;
  getLocationHref(): string;
  getDocumentTitle(): string;
  getReadyState(): string;
  getCookie(): string;
  getPageStateRoot?(): unknown;
  readPageStateRoot?(): Promise<unknown>;
  callSignature(uri: string, payload: JsonRecord): Promise<SignatureResult>;
  fetchJson(input: {
    url: string;
    method: "POST" | "GET";
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
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
  request_admission_result: RequestAdmissionResult;
  approval_record: {
    approval_id: string | null;
    decision_id: string;
    approved: boolean;
    approver: string | null;
    approved_at: string | null;
    checks: Record<string, boolean>;
  };
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
