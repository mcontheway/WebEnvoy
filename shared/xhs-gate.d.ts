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
  decision_id: string;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Record<string, boolean>;
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
  actualTargetDomain?: unknown;
  actualTargetTabId?: unknown;
  actualTargetPage?: unknown;
  requireActualTargetPage?: boolean;
  actionType: unknown;
  requestedExecutionMode: unknown;
  issueScope: unknown;
  riskState: unknown;
  runId?: unknown;
  abilityAction?: unknown;
  approvalRecord: unknown;
  decisionId?: unknown;
  approvalId?: unknown;
  issue208EditorInputValidation?: boolean;
  includeWriteInteractionTierReason?: boolean;
  treatMissingEditorValidationAsUnsupported?: boolean;
  writeGateOnlyEligibleBehavior?: "allow" | "block";
}

export interface XhsGateCoreResult {
  targetDomain: string | null;
  targetTabId: number | null;
  targetPage: string | null;
  actionType: ActionType | null;
  requestedExecutionMode: ExecutionMode | null;
  issueScope: IssueScope;
  riskState: RiskState;
  approvalRecord: XhsApprovalRecord;
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
export declare const resolveXhsFallbackMode: (
  requestedExecutionMode: ExecutionMode | null,
  riskState: RiskState
) => ExecutionMode;
export declare const evaluateXhsGateCore: (input: XhsGateCoreInput) => XhsGateCoreResult;
export declare const buildXhsGatePolicyState: (input: {
  issueScope: unknown;
  riskState: unknown;
  actionType: unknown;
  requestedExecutionMode: unknown;
}) => {
  issueScope: IssueScope;
  riskState: RiskState;
  actionType: ActionType | null;
  requestedExecutionMode: ExecutionMode | null;
  issueActionMatrix: IssueActionMatrixEntry;
  writeActionMatrixDecisions: WriteActionMatrixDecisionsOutput;
  writeMatrixDecision: WriteActionMatrixDecision;
  issue208WriteGateOnly: boolean;
  writeTierReason: string;
  isLiveReadMode: boolean;
  isBlockedByStateMatrix: boolean;
  liveModeCanEnter: boolean;
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
  approvalRecord: unknown;
  issue208EditorInputValidation?: boolean;
  includeWriteInteractionTierReason?: boolean;
  allowIssue208EligibleExecution?: boolean;
}) => {
  gateReasons: string[];
  approvalRecord: XhsApprovalRecord;
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
  approval_record: XhsApprovalRecord;
};
