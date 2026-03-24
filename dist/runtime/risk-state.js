import { APPROVAL_CHECK_KEYS as SHARED_APPROVAL_CHECK_KEYS, EXECUTION_MODES as SHARED_EXECUTION_MODES, ISSUE_ACTION_MATRIX as SHARED_ISSUE_ACTION_MATRIX, ISSUE_SCOPES as SHARED_ISSUE_SCOPES, RISK_STATES as SHARED_RISK_STATES, RISK_STATE_MACHINE as SHARED_RISK_STATE_MACHINE, RISK_STATE_TRANSITIONS as SHARED_RISK_STATE_TRANSITIONS, buildUnifiedRiskStateOutput, getIssueActionMatrixEntry, getRiskRecoveryRequirements, isIssueScope, isRiskState, listIssueActionMatrix, listRiskStateTransitions, resolveIssueScope, resolveRiskState } from "../../shared/risk-state.js";
export const RISK_STATES = [...SHARED_RISK_STATES];
export const ISSUE_SCOPES = [...SHARED_ISSUE_SCOPES];
export const EXECUTION_MODES = [...SHARED_EXECUTION_MODES];
export const APPROVAL_CHECK_KEYS = [...SHARED_APPROVAL_CHECK_KEYS];
export const RISK_STATE_TRANSITIONS = SHARED_RISK_STATE_TRANSITIONS.map((entry) => ({ ...entry }));
export const ISSUE_ACTION_MATRIX = SHARED_ISSUE_ACTION_MATRIX.map((entry) => ({
    ...entry,
    allowed_actions: [...entry.allowed_actions],
    blocked_actions: [...entry.blocked_actions]
}));
export const RISK_STATE_MACHINE = {
    states: [...SHARED_RISK_STATE_MACHINE.states],
    transitions: SHARED_RISK_STATE_MACHINE.transitions.map((entry) => ({ ...entry })),
    hard_block_when_paused: [...SHARED_RISK_STATE_MACHINE.hard_block_when_paused]
};
export { buildUnifiedRiskStateOutput, getIssueActionMatrixEntry, getRiskRecoveryRequirements, isIssueScope, isRiskState, listIssueActionMatrix, listRiskStateTransitions, resolveIssueScope, resolveRiskState };
