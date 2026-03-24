const RISK_STATES = ["paused", "limited", "allowed"];
const ISSUE_SCOPES = ["issue_208", "issue_209"];
const EXECUTION_MODES = [
  "dry_run",
  "recon",
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
];
const APPROVAL_CHECK_KEYS = [
  "target_domain_confirmed",
  "target_tab_confirmed",
  "target_page_confirmed",
  "risk_state_checked",
  "action_type_confirmed"
];
const RISK_STATE_TRANSITIONS = [
  { from: "allowed", to: "limited", trigger: "risk_signal_detected" },
  { from: "limited", to: "paused", trigger: "account_alert_or_repeat_risk" },
  {
    from: "paused",
    to: "limited",
    trigger: "cooldown_backoff_window_passed_and_manual_approve"
  },
  {
    from: "limited",
    to: "allowed",
    trigger: "stability_window_passed_and_manual_approve"
  }
];
const ISSUE_ACTION_MATRIX = [
  {
    issue_scope: "issue_208",
    state: "paused",
    allowed_actions: ["dry_run", "recon"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "reversible_interaction_with_approval",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_208",
    state: "limited",
    allowed_actions: ["dry_run", "recon", "reversible_interaction_with_approval"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "irreversible_write",
      "live_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_208",
    state: "allowed",
    allowed_actions: ["dry_run", "recon", "reversible_interaction_with_approval"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "irreversible_write",
      "live_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "paused",
    allowed_actions: ["dry_run", "recon"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "limited",
    allowed_actions: ["dry_run", "recon", "live_read_limited"],
    blocked_actions: [
      "live_read_high_risk",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "allowed",
    allowed_actions: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    blocked_actions: ["live_write", "irreversible_write", "expand_new_live_surface_without_gate"]
  }
];
const RISK_STATE_MACHINE = {
  states: RISK_STATES,
  transitions: RISK_STATE_TRANSITIONS,
  hard_block_when_paused: ["live_write", "live_read_high_risk"]
};

const isRiskState = (value) => typeof value === "string" && RISK_STATES.includes(value);
const resolveRiskState = (value) => (isRiskState(value) ? value : "paused");

const isIssueScope = (value) => typeof value === "string" && ISSUE_SCOPES.includes(value);
const resolveIssueScope = (value) => (isIssueScope(value) ? value : "issue_209");

const listRiskStateTransitions = () => RISK_STATE_TRANSITIONS.map((entry) => ({ ...entry }));

const listIssueActionMatrix = () =>
  ISSUE_ACTION_MATRIX.map((entry) => ({
    ...entry,
    allowed_actions: [...entry.allowed_actions],
    blocked_actions: [...entry.blocked_actions]
  }));

const getIssueActionMatrixEntry = (issueScope, state) => {
  const matched = ISSUE_ACTION_MATRIX.find(
    (entry) => entry.issue_scope === issueScope && entry.state === state
  );
  if (!matched) {
    return {
      issue_scope: issueScope,
      state,
      allowed_actions: ["dry_run", "recon"],
      blocked_actions: ["expand_new_live_surface_without_gate"]
    };
  }
  return {
    ...matched,
    allowed_actions: [...matched.allowed_actions],
    blocked_actions: [...matched.blocked_actions]
  };
};

const getRiskRecoveryRequirements = (state) => {
  switch (state) {
    case "paused":
      return [
        "cooldown_backoff_window_passed_and_manual_approve",
        "risk_state_checked",
        "audit_record_present"
      ];
    case "limited":
      return [
        "stability_window_passed_and_manual_approve",
        "risk_state_checked",
        "audit_record_present"
      ];
    case "allowed":
      return ["manual_confirmation_recorded", "target_scope_confirmed", "audit_record_present"];
    default:
      return ["audit_record_present"];
  }
};

const buildUnifiedRiskStateOutput = (state) => ({
  current_state: state,
  risk_state_machine: {
    states: [...RISK_STATE_MACHINE.states],
    transitions: listRiskStateTransitions(),
    hard_block_when_paused: [...RISK_STATE_MACHINE.hard_block_when_paused]
  },
  issue_action_matrix: [
    getIssueActionMatrixEntry("issue_208", state),
    getIssueActionMatrixEntry("issue_209", state)
  ],
  recovery_requirements: getRiskRecoveryRequirements(state)
});

export {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  ISSUE_ACTION_MATRIX,
  ISSUE_SCOPES,
  RISK_STATES,
  RISK_STATE_MACHINE,
  RISK_STATE_TRANSITIONS,
  buildUnifiedRiskStateOutput,
  getIssueActionMatrixEntry,
  getRiskRecoveryRequirements,
  isIssueScope,
  isRiskState,
  listIssueActionMatrix,
  listRiskStateTransitions,
  resolveIssueScope,
  resolveRiskState
};
