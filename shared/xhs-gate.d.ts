import type {
  ActionType,
  ExecutionMode,
  IssueActionMatrixEntry,
  IssueScope,
  RiskState,
  WriteActionMatrixDecision,
  WriteActionMatrixDecisionsOutput,
  WriteInteractionTier
} from "./risk-state.js";

export interface XhsApprovalRecord {
  approval_id: string | null;
  decision_id: string | null;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Record<string, boolean>;
}

export interface XhsAuditRecord {
  event_id: string | null;
  decision_id: string | null;
  approval_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  gate_decision: string | null;
  audited_checks?: Record<string, boolean>;
  recorded_at: string | null;
}

export interface XhsApprovalAdmissionEvidence {
  approval_admission_ref: string | null;
  decision_id: string | null;
  approval_id: string | null;
  request_id?: string | null;
  run_id: string | null;
  session_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Record<string, boolean>;
  recorded_at: string | null;
}

export interface XhsAuditAdmissionEvidence {
  audit_admission_ref: string | null;
  decision_id: string | null;
  approval_id: string | null;
  request_id?: string | null;
  run_id: string | null;
  session_id: string | null;
  issue_scope: string | null;
  target_domain: string | null;
  target_tab_id: number | null;
  target_page: string | null;
  action_type: string | null;
  requested_execution_mode: string | null;
  risk_state: string | null;
  audited_checks: Record<string, boolean>;
  recorded_at: string | null;
}

export interface XhsAdmissionContext {
  approval_admission_evidence: XhsApprovalAdmissionEvidence;
  audit_admission_evidence: XhsAuditAdmissionEvidence;
}

export interface XhsUpstreamAuthorizationRequest {
  action_request: {
    request_ref: string | null;
    action_name: string | null;
    action_category: ActionType | null;
    requested_at: string | null;
  } | null;
  resource_binding: {
    binding_ref: string | null;
    resource_kind: "anonymous_context" | "profile_session" | null;
    profile_ref?: string | null;
    binding_constraints:
      | {
          anonymous_required: boolean;
          reuse_logged_in_context_forbidden: boolean;
        }
      | null;
  } | null;
  authorization_grant: {
    grant_ref: string | null;
    allowed_actions: string[];
    binding_scope: {
      allowed_resource_kinds: string[];
      allowed_profile_refs: string[];
    };
    target_scope: {
      allowed_domains: string[];
      allowed_pages: string[];
    };
    approval_refs: string[];
    audit_refs: string[];
    resource_state_snapshot: string | null;
  } | null;
  runtime_target: {
    target_ref: string | null;
    domain: string | null;
    page: string | null;
    tab_id: number | null;
    url: string | null;
  } | null;
}

export interface XhsRequestAdmissionResult {
  request_ref: string | null;
  admission_decision: "allowed" | "blocked" | "deferred";
  normalized_action_type: ActionType | null;
  normalized_resource_kind: "anonymous_context" | "profile_session" | null;
  runtime_target_match: boolean;
  grant_match: boolean;
  anonymous_isolation_ok: boolean;
  effective_runtime_mode: ExecutionMode | null;
  reason_codes: string[];
  derived_from: {
    gate_input_ref: string | null;
    action_request_ref: string | null;
    resource_binding_ref: string | null;
    authorization_grant_ref: string | null;
    runtime_target_ref: string | null;
    approval_admission_ref: string | null;
    audit_admission_ref: string | null;
  };
}

export interface XhsRequestExecutionAudit {
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

export interface XhsReadExecutionPolicy {
  default_mode: "dry_run";
  allowed_modes: Array<"dry_run" | "recon" | "live_read_limited" | "live_read_high_risk">;
  blocked_actions: string[];
  live_entry_requirements: string[];
}

export interface XhsScopeContext {
  platform: "xhs";
  read_domain: string;
  write_domain: string;
  domain_mixing_forbidden: true;
}

export interface XhsGateCoreInput {
  targetDomain: unknown;
  targetTabId: unknown;
  targetPage: unknown;
  requestId?: unknown;
  commandRequestId?: unknown;
  actualTargetDomain?: unknown;
  actualTargetTabId?: unknown;
  actualTargetPage?: unknown;
  actualTargetUrl?: unknown;
  __actual_target_url?: unknown;
  requireActualTargetPage?: boolean;
  actionType: unknown;
  requestedExecutionMode: unknown;
  issueScope: unknown;
  riskState: unknown;
  runId?: unknown;
  sessionId?: unknown;
  gateInvocationId?: unknown;
  abilityAction?: unknown;
  approvalRecord: unknown;
  auditRecord?: unknown;
  admissionContext?: unknown;
  limitedReadRolloutReadyTrue?: boolean;
  decisionId?: unknown;
  approvalId?: unknown;
  issue208EditorInputValidation?: boolean;
  includeWriteInteractionTierReason?: boolean;
  treatMissingEditorValidationAsUnsupported?: boolean;
  writeGateOnlyEligibleBehavior?: "allow" | "block";
  legacyRequestedExecutionMode?: unknown;
  legacy_requested_execution_mode?: unknown;
  runtimeProfileRef?: unknown;
  __runtime_profile_ref?: unknown;
  sessionRhythmWindowId?: unknown;
  sessionRhythmDecisionId?: unknown;
  __session_rhythm_window_id?: unknown;
  __session_rhythm_decision_id?: unknown;
  upstreamAuthorizationRequest?: unknown;
  upstream_authorization_request?: unknown;
  anonymousIsolationVerified?: boolean;
  __anonymous_isolation_verified?: boolean;
  targetSiteLoggedIn?: boolean;
  target_site_logged_in?: boolean;
}

export interface XhsGateCoreResult {
  targetDomain: string | null;
  targetTabId: number | null;
  targetPage: string | null;
  actionType: ActionType | null;
  requestedExecutionMode: ExecutionMode | null;
  legacyRequestedExecutionMode: ExecutionMode | null;
  upstreamAuthorizationRequest: XhsUpstreamAuthorizationRequest;
  issueScope: IssueScope;
  riskState: RiskState;
  approvalRecord: XhsApprovalRecord;
  admissionContext: XhsAdmissionContext;
  issueActionMatrix: IssueActionMatrixEntry;
  writeActionMatrixDecisions: WriteActionMatrixDecisionsOutput;
  writeMatrixDecision: WriteActionMatrixDecision;
  issue208WriteGateOnly: boolean;
  issue208EditorInputValidation: boolean;
  writeTierReason: string;
  gateReasons: string[];
  isLiveReadMode: boolean;
  isBlockedByStateMatrix: boolean;
  liveModeCanEnter: boolean;
  fallbackMode: ExecutionMode;
  writeGateOnlyEligible: boolean;
  writeGateOnlyDecision: Record<string, unknown> | null;
}

export declare const XHS_ALLOWED_DOMAINS: ReadonlySet<string>;
export declare const XHS_READ_DOMAIN: string;
export declare const XHS_WRITE_DOMAIN: string;
export declare const XHS_REQUIRED_APPROVAL_CHECKS: readonly string[];
export declare const XHS_WRITE_APPROVAL_REQUIREMENTS: readonly string[];
export declare const XHS_SCOPE_CONTEXT: XhsScopeContext;
export declare const XHS_READ_EXECUTION_POLICY: XhsReadExecutionPolicy;
export declare const XHS_ACTION_TYPES: ReadonlySet<ActionType>;
export declare const WRITE_INTERACTION_TIER: WriteInteractionTier;
export declare const resolveXhsActionType: (value: unknown) => ActionType | null;
export declare const resolveXhsExecutionMode: (value: unknown) => ExecutionMode | null;
export declare const resolveXhsRiskState: (value: unknown) => RiskState;
export declare const resolveXhsIssueScope: (value: unknown) => IssueScope;
export declare const normalizeXhsApprovalRecord: (value: unknown) => XhsApprovalRecord;
export declare const normalizeXhsApprovalAdmissionEvidence: (
  value: unknown
) => XhsApprovalAdmissionEvidence;
export declare const normalizeXhsAuditAdmissionEvidence: (
  value: unknown
) => XhsAuditAdmissionEvidence;
export declare const normalizeXhsAdmissionContext: (value: unknown) => XhsAdmissionContext;
export declare const resolveXhsGateDecisionId: (input: {
  decisionId?: unknown;
  runId?: unknown;
  requestId?: unknown;
  commandRequestId?: unknown;
  gateInvocationId?: unknown;
  issueScope?: unknown;
  requestedExecutionMode?: unknown;
  targetPage?: unknown;
  targetTabId?: unknown;
}) => string;
export declare const resolveXhsGateApprovalId: (input: {
  decisionId?: unknown;
  runId?: unknown;
  requestId?: unknown;
  commandRequestId?: unknown;
  gateInvocationId?: unknown;
  issueScope?: unknown;
  requestedExecutionMode?: unknown;
  targetPage?: unknown;
  targetTabId?: unknown;
  approvalRecord?: unknown;
  approvalId?: unknown;
}) => string | null;
export declare const resolveXhsIssueActionMatrixEntry: (
  issueScope: IssueScope,
  state: RiskState
) => IssueActionMatrixEntry;
export declare const resolveXhsWriteMatrixDecision: (
  output: WriteActionMatrixDecisionsOutput,
  state: RiskState
) => WriteActionMatrixDecision;
export declare const resolveXhsApprovalRequirementGaps: (
  requirements: string[],
  approvalRecord: XhsApprovalRecord
) => string[];
export declare const resolveXhsApprovalAdmissionRequirementGaps: (
  requirements: string[],
  approvalAdmissionEvidence: XhsApprovalAdmissionEvidence,
  expected: {
    runId: string | null;
    sessionId: string | null;
    issueScope: IssueScope;
    targetDomain: string | null;
    targetTabId: number | null;
    targetPage: string | null;
    actionType: ActionType | null;
    requestedExecutionMode: ExecutionMode | null;
  }
) => string[];
export declare const resolveXhsAuditAdmissionRequirementGaps: (
  auditAdmissionEvidence: XhsAuditAdmissionEvidence,
  expected: {
    runId: string | null;
    sessionId: string | null;
    issueScope: IssueScope;
    targetDomain: string | null;
    targetTabId: number | null;
    targetPage: string | null;
    actionType: ActionType | null;
    requestedExecutionMode: ExecutionMode | null;
    riskState: RiskState;
  },
  requirements: string[]
) => string[];
export declare const resolveXhsFallbackMode: (
  requestedExecutionMode: ExecutionMode | null,
  riskState: RiskState
) => ExecutionMode;
export declare const evaluateXhsGateCore: (
  input: XhsGateCoreInput
) => XhsGateCoreResult;
export declare const buildXhsGatePolicyState: (input: {
  issueScope: unknown;
  riskState: unknown;
  actionType: unknown;
  requestedExecutionMode: unknown;
  legacyRequestedExecutionMode?: unknown;
  upstreamAuthorizationRequest?: unknown;
  upstream_authorization_request?: unknown;
  limitedReadRolloutReadyTrue?: boolean;
}) => {
  issueScope: IssueScope;
  riskState: RiskState;
  actionType: ActionType | null;
  requestedExecutionMode: ExecutionMode | null;
  legacyRequestedExecutionMode: ExecutionMode | null;
  upstreamAuthorizationRequest: XhsUpstreamAuthorizationRequest;
  issueActionMatrix: IssueActionMatrixEntry;
  writeActionMatrixDecisions: WriteActionMatrixDecisionsOutput;
  writeMatrixDecision: WriteActionMatrixDecision;
  issue208WriteGateOnly: boolean;
  writeTierReason: string;
  isLiveReadMode: boolean;
  isBlockedByStateMatrix: boolean;
  liveModeCanEnter: boolean;
  limitedReadRolloutReadyTrue: boolean;
  fallbackMode: ExecutionMode;
};
export declare const collectXhsCommandGateReasons: (input: {
  gateReasons: string[];
  actionType?: unknown;
  requestedExecutionMode?: unknown;
  abilityAction?: unknown;
  abilityActionType?: unknown;
  targetDomain?: unknown;
  targetTabId?: unknown;
  targetPage?: unknown;
  actualTargetDomain?: unknown;
  actualTargetTabId?: unknown;
  actualTargetPage?: unknown;
  requireActualTargetPage?: boolean;
  issue208WriteGateOnly?: boolean;
  issue208EditorInputValidation?: boolean;
  treatMissingEditorValidationAsUnsupported?: boolean;
  includeWriteInteractionTierReason?: boolean;
  writeTierReason?: string;
}) => string[];
export declare const collectXhsMatrixGateReasons: (input: {
  gateReasons: string[];
  state: ReturnType<typeof buildXhsGatePolicyState>;
  decisionId?: string | null;
  expectedApprovalId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  approvalRecord: unknown;
  auditRecord?: unknown;
  admissionContext?: unknown;
  targetDomain?: unknown;
  targetTabId?: unknown;
  targetPage?: unknown;
  issue208EditorInputValidation?: boolean;
  includeWriteInteractionTierReason?: boolean;
  allowIssue208EligibleExecution?: boolean;
}) => {
  gateReasons: string[];
  approvalRecord: XhsApprovalRecord;
  admissionContext: XhsAdmissionContext;
  writeGateOnlyEligible: boolean;
  writeGateOnlyDecision: Record<string, unknown> | null;
  writeGateOnlyApprovalDecision: Record<string, unknown> | null;
};
export declare const finalizeXhsGateOutcome: (input: {
  requestedExecutionMode?: ExecutionMode | null;
  fallbackMode?: ExecutionMode;
  issue208WriteGateOnly?: boolean;
  actionType?: ActionType | null;
  writeMatrixDecision?: WriteActionMatrixDecision | null;
  writeGateOnlyEligible: boolean;
  liveModeCanEnter?: boolean;
  gateReasons: string[];
  state?: ReturnType<typeof buildXhsGatePolicyState>;
  writeGateOnlyEligibleBehavior?: "allow" | "block";
  allowIssue208EligibleExecution?: boolean;
  supportsIssue208ValidatedLiveWrite?: boolean;
  nonBlockingReasons?: string[];
}) => {
  allowed: boolean;
  gateDecision: "allowed" | "blocked";
  effectiveExecutionMode: ExecutionMode | null;
  gateReasons: string[];
};
export declare const evaluateXhsGate: (input: XhsGateCoreInput & {
  abilityActionType?: unknown;
  supportsIssue208ValidatedLiveWrite?: boolean;
  additionalGateReasons?: string[];
}) => {
  scope_context: XhsScopeContext;
  read_execution_policy: XhsReadExecutionPolicy;
  issue_action_matrix: IssueActionMatrixEntry;
  write_interaction_tier: WriteInteractionTier;
  write_action_matrix_decisions: WriteActionMatrixDecisionsOutput | null;
  gate_input: {
    issue_scope: IssueScope;
    target_domain: string | null;
    target_tab_id: number | null;
    target_page: string | null;
    action_type: ActionType | null;
    requested_execution_mode: ExecutionMode | null;
    risk_state: RiskState;
    admission_context: XhsAdmissionContext;
  };
  gate_outcome: {
    decision_id: string;
    effective_execution_mode: ExecutionMode | null;
    gate_decision: "allowed" | "blocked";
    gate_reasons: string[];
    requires_manual_confirmation: boolean;
  };
  consumer_gate_result: {
    issue_scope: IssueScope;
    target_domain: string | null;
    target_tab_id: number | null;
    target_page: string | null;
    action_type: ActionType | null;
    requested_execution_mode: ExecutionMode | null;
    effective_execution_mode: ExecutionMode | null;
    gate_decision: "allowed" | "blocked";
    gate_reasons: string[];
    write_interaction_tier: string | null;
  };
  request_admission_result: XhsRequestAdmissionResult;
  approval_record: XhsApprovalRecord;
  execution_audit: XhsRequestExecutionAudit | null;
};
export declare const buildIssue209PostGateArtifacts: (input: {
  runId: string;
  sessionId: string;
  profile: string | null;
  executionAuditRiskSignals?: string[] | null;
  gate: {
    gate_input: {
      issue_scope: IssueScope;
      target_domain: string | null;
      target_tab_id: number | null;
      target_page: string | null;
      action_type: ActionType | null;
      requested_execution_mode: ExecutionMode | null;
      risk_state: RiskState;
      admission_context: XhsAdmissionContext;
    };
    gate_outcome: {
      decision_id: string;
      effective_execution_mode: ExecutionMode | null;
      gate_decision: "allowed" | "blocked";
      gate_reasons: string[];
      requires_manual_confirmation: boolean;
    };
    consumer_gate_result: {
      issue_scope: IssueScope;
      target_domain: string | null;
      target_tab_id: number | null;
      target_page: string | null;
      action_type: ActionType | null;
      requested_execution_mode: ExecutionMode | null;
      effective_execution_mode: ExecutionMode | null;
      gate_decision: "allowed" | "blocked";
      gate_reasons: string[];
      write_interaction_tier: string | null;
    };
    request_admission_result: XhsRequestAdmissionResult;
    approval_record: XhsApprovalRecord;
    write_action_matrix_decisions: WriteActionMatrixDecisionsOutput | null;
  };
  now?: () => number;
}) => {
  approval_record: XhsApprovalRecord;
  audit_record: Record<string, unknown>;
  execution_audit: XhsRequestExecutionAudit | null;
};
