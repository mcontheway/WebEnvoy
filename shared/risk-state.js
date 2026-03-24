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
    conditional_actions: [],
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
    conditional_actions: [],
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
    conditional_actions: [],
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
    conditional_actions: [],
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
    allowed_actions: ["dry_run", "recon"],
    conditional_actions: [
      {
        action: "live_read_limited",
        requires: [
          "approval_record_approved_true",
          "approval_record_approver_present",
          "approval_record_approved_at_present",
          "approval_record_checks_all_true"
        ]
      }
    ],
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
    allowed_actions: ["dry_run", "recon"],
    conditional_actions: [
      {
        action: "live_read_limited",
        requires: [
          "approval_record_approved_true",
          "approval_record_approver_present",
          "approval_record_approved_at_present",
          "approval_record_checks_all_true"
        ]
      },
      {
        action: "live_read_high_risk",
        requires: [
          "approval_record_approved_true",
          "approval_record_approver_present",
          "approval_record_approved_at_present",
          "approval_record_checks_all_true"
        ]
      }
    ],
    blocked_actions: ["live_write", "irreversible_write", "expand_new_live_surface_without_gate"]
  }
];
const SESSION_RHYTHM_POLICY = {
  min_action_interval_ms: 3_000,
  min_experiment_interval_ms: 30_000,
  cooldown_strategy: "exponential_backoff",
  cooldown_base_minutes: 30,
  cooldown_cap_minutes: 720,
  resume_probe_mode: "recon_only"
};
const RISK_STATE_MACHINE = {
  states: RISK_STATES,
  transitions: RISK_STATE_TRANSITIONS,
  hard_block_when_paused: ["live_read_limited", "live_read_high_risk", "live_write"]
};
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const RISK_SIGNAL_REASONS = new Set([
  "MANUAL_CONFIRMATION_MISSING",
  "APPROVAL_CHECKS_INCOMPLETE",
  "ISSUE_ACTION_MATRIX_BLOCKED",
  "RISK_STATE_PAUSED",
  "RISK_STATE_LIMITED"
]);

const isRiskState = (value) => typeof value === "string" && RISK_STATES.includes(value);
const resolveRiskState = (value) => (isRiskState(value) ? value : "paused");

const isIssueScope = (value) => typeof value === "string" && ISSUE_SCOPES.includes(value);
const resolveIssueScope = (value) => (isIssueScope(value) ? value : "issue_209");

const listRiskStateTransitions = () => RISK_STATE_TRANSITIONS.map((entry) => ({ ...entry }));

const listIssueActionMatrix = () =>
  ISSUE_ACTION_MATRIX.map((entry) => ({
    ...entry,
    allowed_actions: [...entry.allowed_actions],
    conditional_actions: entry.conditional_actions.map((item) => ({
      action: item.action,
      requires: [...item.requires]
    })),
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
      conditional_actions: [],
      blocked_actions: ["expand_new_live_surface_without_gate"]
    };
  }
  return {
    ...matched,
    allowed_actions: [...matched.allowed_actions],
    conditional_actions: matched.conditional_actions.map((item) => ({
      action: item.action,
      requires: [...item.requires]
    })),
    blocked_actions: [...matched.blocked_actions]
  };
};

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asBoolean = (value) => value === true;
const parseTimestamp = (value) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.length > 0) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
};
const toIsoString = (value) => {
  const parsed = parseTimestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
};
const isLiveExecutionMode = (value) =>
  typeof value === "string" && LIVE_EXECUTION_MODES.has(value);
const isApprovalRecordComplete = (approvalRecord) => {
  const record = asRecord(approvalRecord);
  const checks = asRecord(record?.checks);
  return (
    asBoolean(record?.approved) &&
    asString(record?.approver) !== null &&
    asString(record?.approved_at) !== null &&
    APPROVAL_CHECK_KEYS.every((key) => asBoolean(checks?.[key]))
  );
};
const isRiskSignalRecord = (record) => {
  if (!record) {
    return false;
  }
  if (asBoolean(record.risk_signal)) {
    return true;
  }
  if (!isLiveExecutionMode(record.requested_execution_mode)) {
    return false;
  }
  if (record.gate_decision === "blocked") {
    return true;
  }
  const reasons = Array.isArray(record.gate_reasons)
    ? record.gate_reasons.filter((item) => typeof item === "string")
    : [];
  return reasons.some((reason) => RISK_SIGNAL_REASONS.has(reason));
};
const isRecoverySignalRecord = (record) => {
  if (!record) {
    return false;
  }
  if (asBoolean(record.recovery_signal)) {
    return true;
  }
  return record.gate_decision === "allowed" && isLiveExecutionMode(record.requested_execution_mode);
};
const normalizeAuditRecords = (auditRecords) =>
  (Array.isArray(auditRecords) ? auditRecords : [])
    .map((record) => asRecord(record))
    .filter((record) => record !== null)
    .sort((left, right) => {
      const rightTime = parseTimestamp(right.recorded_at) ?? 0;
      const leftTime = parseTimestamp(left.recorded_at) ?? 0;
      return rightTime - leftTime;
    });
const buildSessionRhythmOutput = (state, options = {}) => {
  const now = parseTimestamp(options.now ?? Date.now()) ?? Date.now();
  const auditRecords = normalizeAuditRecords(options.auditRecords);
  const latestRecovery = auditRecords.find((record) => isRecoverySignalRecord(record)) ?? null;
  const riskChain = [];

  for (const record of auditRecords) {
    if (isRecoverySignalRecord(record)) {
      break;
    }
    if (isRiskSignalRecord(record)) {
      riskChain.push(record);
      continue;
    }
    if (riskChain.length > 0) {
      break;
    }
  }

  const latestRisk = riskChain[0] ?? null;
  const latestRelevant = latestRisk ?? latestRecovery ?? auditRecords[0] ?? null;
  const triggeredBy =
    latestRelevant && Array.isArray(latestRelevant.gate_reasons) && latestRelevant.gate_reasons.length > 0
      ? asString(latestRelevant.gate_reasons[0])
      : null;
  const lastEventAt = latestRelevant ? toIsoString(latestRelevant.recorded_at) : null;
  const sourceEventId = latestRelevant ? asString(latestRelevant.event_id) : null;

  if (latestRisk) {
    const riskAt = parseTimestamp(latestRisk.recorded_at) ?? now;
    const exponentialMultiplier = Math.max(0, riskChain.length - 1);
    const cooldownWindowMinutes = Math.min(
      SESSION_RHYTHM_POLICY.cooldown_base_minutes * 2 ** exponentialMultiplier,
      SESSION_RHYTHM_POLICY.cooldown_cap_minutes
    );
    const cooldownUntilMs = riskAt + cooldownWindowMinutes * 60_000;
    if (now < cooldownUntilMs) {
      return {
        state: "cooldown",
        triggered_by: triggeredBy,
        cooldown_until: new Date(cooldownUntilMs).toISOString(),
        recovery_started_at: null,
        last_event_at: lastEventAt,
        source_event_id: sourceEventId
      };
    }
    return {
      state: "recovery",
      triggered_by: triggeredBy,
      cooldown_until: new Date(cooldownUntilMs).toISOString(),
      recovery_started_at: new Date(cooldownUntilMs).toISOString(),
      last_event_at: lastEventAt,
      source_event_id: sourceEventId
    };
  }

  if (latestRecovery && state !== "allowed") {
    return {
      state: "recovery",
      triggered_by: triggeredBy,
      cooldown_until: null,
      recovery_started_at: toIsoString(latestRecovery.recorded_at),
      last_event_at: lastEventAt,
      source_event_id: sourceEventId
    };
  }

  return {
    state: "normal",
    triggered_by: triggeredBy,
    cooldown_until: null,
    recovery_started_at: null,
    last_event_at: lastEventAt,
    source_event_id: sourceEventId
  };
};

const buildRiskTransitionAudit = (input) => {
  const gateReasons = Array.isArray(input.gateReasons)
    ? input.gateReasons.filter((item) => typeof item === "string")
    : [];
  const sessionRhythm = buildSessionRhythmOutput(input.prevState, {
    auditRecords: input.auditRecords,
    now: input.now
  });
  let nextState = input.prevState;
  let trigger = "gate_evaluation";

  if (input.decision === "blocked" && isLiveExecutionMode(input.requestedExecutionMode)) {
    if (input.prevState === "allowed") {
      nextState = "limited";
      trigger = "risk_signal_detected";
    } else if (input.prevState === "limited") {
      nextState = "paused";
      trigger = "account_alert_or_repeat_risk";
    }
  } else if (
    input.prevState === "paused" &&
    sessionRhythm.state === "recovery" &&
    isApprovalRecordComplete(input.approvalRecord)
  ) {
    nextState = "limited";
    trigger = "cooldown_backoff_window_passed_and_manual_approve";
  } else if (
    input.prevState === "limited" &&
    sessionRhythm.state === "normal" &&
    isApprovalRecordComplete(input.approvalRecord)
  ) {
    nextState = "allowed";
    trigger = "stability_window_passed_and_manual_approve";
  }

  return {
    run_id: input.runId,
    session_id: input.sessionId,
    issue_scope: input.issueScope,
    prev_state: input.prevState,
    next_state: nextState,
    trigger,
    decision: input.decision,
    reason: gateReasons[0] ?? "GATE_DECISION_RECORDED",
    approver: asString(asRecord(input.approvalRecord)?.approver)
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

const buildUnifiedRiskStateOutput = (state, options = {}) => ({
  current_state: state,
  session_rhythm_policy: {
    ...SESSION_RHYTHM_POLICY
  },
  session_rhythm: buildSessionRhythmOutput(state, options),
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
  SESSION_RHYTHM_POLICY,
  buildRiskTransitionAudit,
  buildSessionRhythmOutput,
  buildUnifiedRiskStateOutput,
  getIssueActionMatrixEntry,
  getRiskRecoveryRequirements,
  isApprovalRecordComplete,
  isIssueScope,
  isRiskState,
  listIssueActionMatrix,
  listRiskStateTransitions,
  resolveIssueScope,
  resolveRiskState
};
