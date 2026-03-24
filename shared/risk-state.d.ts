export type RiskState = "paused" | "limited" | "allowed";
export type IssueScope = "issue_208" | "issue_209";
export type ExecutionMode =
  | "dry_run"
  | "recon"
  | "live_read_limited"
  | "live_read_high_risk"
  | "live_write";
export type ApprovalCheckKey =
  | "target_domain_confirmed"
  | "target_tab_confirmed"
  | "target_page_confirmed"
  | "risk_state_checked"
  | "action_type_confirmed";

export interface RiskStateTransition {
  from: RiskState;
  to: RiskState;
  trigger: string;
}

export interface IssueActionMatrixEntry {
  issue_scope: IssueScope;
  state: RiskState;
  allowed_actions: string[];
  blocked_actions: string[];
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
export declare const RISK_STATE_MACHINE: RiskStateMachine;

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
export declare const getRiskRecoveryRequirements: (state: RiskState) => string[];
export declare const buildUnifiedRiskStateOutput: (state: RiskState) => {
  current_state: RiskState;
  risk_state_machine: {
    states: RiskState[];
    transitions: RiskStateTransition[];
    hard_block_when_paused: string[];
  };
  issue_action_matrix: [IssueActionMatrixEntry, IssueActionMatrixEntry];
  recovery_requirements: string[];
};
