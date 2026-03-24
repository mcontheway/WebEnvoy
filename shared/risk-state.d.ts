export type RiskState = "paused" | "limited" | "allowed";
export type IssueScope = "issue_208" | "issue_209";
export type ExecutionMode =
  | "dry_run"
  | "recon"
  | "live_read_limited"
  | "live_read_high_risk"
  | "live_write";
export type ActionType = "read" | "write" | "irreversible_write";
export type ApprovalCheckKey =
  | "target_domain_confirmed"
  | "target_tab_confirmed"
  | "target_page_confirmed"
  | "risk_state_checked"
  | "action_type_confirmed";
export type WriteInteractionTierName =
  | "observe_only"
  | "reversible_interaction"
  | "irreversible_write";

export interface RiskStateTransition {
  from: RiskState;
  to: RiskState;
  trigger: string;
}

export interface IssueActionMatrixEntry {
  issue_scope: IssueScope;
  state: RiskState;
  allowed_actions: string[];
  conditional_actions: Array<{
    action: string;
    requires: string[];
  }>;
  blocked_actions: string[];
}

export interface SessionRhythmPolicy {
  min_action_interval_ms: number;
  min_experiment_interval_ms: number;
  cooldown_strategy: "exponential_backoff";
  cooldown_base_minutes: number;
  cooldown_cap_minutes: number;
  resume_probe_mode: "recon_only";
}

export interface WriteInteractionTier {
  tiers: Array<{
    name: WriteInteractionTierName;
    live_allowed: false | "limited";
  }>;
  synthetic_event_default: "blocked";
  upload_injection_default: "blocked";
}

export interface WriteActionMatrixDecision {
  state: RiskState;
  decision: "allowed" | "conditional" | "blocked" | "not_applicable";
  requires: string[];
}

export interface WriteActionMatrixDecisionsOutput {
  issue_scope: IssueScope;
  action_type: ActionType;
  requested_execution_mode: ExecutionMode | null;
  write_interaction_tier: WriteInteractionTierName;
  matrix_actions: string[];
  decisions: WriteActionMatrixDecision[];
}

export interface SessionRhythmOutput {
  state: "normal" | "cooldown" | "recovery";
  triggered_by: string | null;
  cooldown_until: string | null;
  recovery_started_at: string | null;
  last_event_at: string | null;
  source_event_id: string | null;
}

export interface RiskStateMachine {
  states: readonly RiskState[];
  transitions: readonly RiskStateTransition[];
  hard_block_when_paused: readonly string[];
}

export declare const RISK_STATES: readonly RiskState[];
export declare const ISSUE_SCOPES: readonly IssueScope[];
export declare const EXECUTION_MODES: readonly ExecutionMode[];
export declare const APPROVAL_CHECK_KEYS: readonly ApprovalCheckKey[];
export declare const RISK_STATE_TRANSITIONS: readonly RiskStateTransition[];
export declare const ISSUE_ACTION_MATRIX: readonly IssueActionMatrixEntry[];
export declare const SESSION_RHYTHM_POLICY: SessionRhythmPolicy;
export declare const RISK_STATE_MACHINE: RiskStateMachine;
export declare const WRITE_INTERACTION_TIER: WriteInteractionTier;

export declare const isRiskState: (value: unknown) => value is RiskState;
export declare const resolveRiskState: (value: unknown) => RiskState;
export declare const isIssueScope: (value: unknown) => value is IssueScope;
export declare const resolveIssueScope: (value: unknown) => IssueScope;
export declare const listRiskStateTransitions: () => RiskStateTransition[];
export declare const listIssueActionMatrix: () => IssueActionMatrixEntry[];
export declare const getIssueActionMatrixEntry: (
  issueScope: IssueScope,
  state: RiskState
) => IssueActionMatrixEntry;
export declare const getWriteActionMatrixDecisions: (
  issueScope: unknown,
  actionType: unknown,
  requestedExecutionMode: unknown
) => WriteActionMatrixDecisionsOutput;
export declare const isApprovalRecordComplete: (approvalRecord: unknown) => boolean;
export declare const buildSessionRhythmOutput: (
  state: RiskState,
  options?: {
    auditRecords?: Array<Record<string, unknown>>;
    now?: number | string | Date;
  }
) => SessionRhythmOutput;
export declare const buildRiskTransitionAudit: (input: {
  runId: string;
  sessionId: string;
  issueScope: IssueScope;
  prevState: RiskState;
  decision: "allowed" | "blocked";
  gateReasons: string[];
  requestedExecutionMode?: string | null;
  approvalRecord?: unknown;
  auditRecords?: Array<Record<string, unknown>>;
  now?: number | string | Date;
}) => {
  run_id: string;
  session_id: string;
  issue_scope: IssueScope;
  prev_state: RiskState;
  next_state: RiskState;
  trigger: string;
  decision: "allowed" | "blocked";
  reason: string;
  approver: string | null;
};
export declare const getRiskRecoveryRequirements: (state: RiskState) => string[];
export declare const buildUnifiedRiskStateOutput: (
  state: RiskState,
  options?: {
    auditRecords?: Array<Record<string, unknown>>;
    now?: number | string | Date;
  }
) => {
  current_state: RiskState;
  session_rhythm_policy: SessionRhythmPolicy;
  session_rhythm: SessionRhythmOutput;
  risk_state_machine: {
    states: RiskState[];
    transitions: RiskStateTransition[];
    hard_block_when_paused: string[];
  };
  issue_action_matrix: [IssueActionMatrixEntry, IssueActionMatrixEntry];
  recovery_requirements: string[];
};
