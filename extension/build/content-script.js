/* WebEnvoy classic content script bundle for Chrome MV3 content_scripts. */

const __webenvoy_module_risk_state = (() => {
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
const APPROVAL_EVIDENCE_REQUIREMENTS = [
  "approval_record_approved_true",
  "approval_record_approver_present",
  "approval_record_approved_at_present",
  "approval_record_checks_all_true"
];
const ISSUE_209_LIVE_READ_ADMISSION_REQUIREMENTS = [
  "gate_input_risk_state_limited_or_allowed",
  "audit_admission_evidence_present",
  "audit_admission_checks_all_true",
  "risk_state_checked",
  "target_domain_confirmed",
  "target_tab_confirmed",
  "target_page_confirmed",
  "action_type_confirmed",
  "approval_admission_evidence_approved_true",
  "approval_admission_evidence_approver_present",
  "approval_admission_evidence_approved_at_present",
  "approval_admission_evidence_checks_all_true"
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
    allowed_actions: ["dry_run", "recon"],
    conditional_actions: [],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "reversible_interaction_with_approval",
      "irreversible_write",
      "live_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_208",
    state: "allowed",
    allowed_actions: ["dry_run", "recon"],
    conditional_actions: [
      {
        action: "reversible_interaction_with_approval",
        requires: [
          "approval_record_approved_true",
          "approval_record_approver_present",
          "approval_record_approved_at_present",
          "approval_record_checks_all_true"
        ]
      }
    ],
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
          ...ISSUE_209_LIVE_READ_ADMISSION_REQUIREMENTS,
          "limited_read_rollout_ready_true",
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
          ...ISSUE_209_LIVE_READ_ADMISSION_REQUIREMENTS,
          "limited_read_rollout_ready_true",
        ]
      },
      {
        action: "live_read_high_risk",
        requires: [...ISSUE_209_LIVE_READ_ADMISSION_REQUIREMENTS]
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
const WRITE_INTERACTION_TIER = {
  tiers: [
    { name: "observe_only", live_allowed: false },
    { name: "reversible_interaction", live_allowed: "limited" },
    { name: "irreversible_write", live_allowed: false }
  ],
  synthetic_event_default: "blocked",
  upload_injection_default: "blocked"
};
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
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
const resolveActionType = (value) =>
  typeof value === "string" && ACTION_TYPES.has(value) ? value : "read";
const resolveExecutionMode = (value) =>
  typeof value === "string" && EXECUTION_MODES.includes(value) ? value : null;
const resolveWriteInteractionTier = (actionType, requestedExecutionMode) => {
  if (actionType === "irreversible_write") {
    return "irreversible_write";
  }
  if (actionType === "write" || requestedExecutionMode === "live_write") {
    return "reversible_interaction";
  }
  return "observe_only";
};
const resolveWriteTierMatrixAction = (tierName) => {
  if (tierName === "reversible_interaction") {
    return "reversible_interaction_with_approval";
  }
  if (tierName === "irreversible_write") {
    return "irreversible_write";
  }
  return null;
};
const resolveMatrixActionDecision = (entry, actions) => {
  if (actions.length === 0) {
    return { decision: "not_applicable", requires: [] };
  }
  if (actions.some((action) => entry.blocked_actions.includes(action))) {
    return { decision: "blocked", requires: [] };
  }
  const conditional = entry.conditional_actions.find((item) => actions.includes(item.action)) ?? null;
  if (conditional) {
    return { decision: "conditional", requires: [...conditional.requires] };
  }
  if (actions.every((action) => entry.allowed_actions.includes(action))) {
    return { decision: "allowed", requires: [] };
  }
  return { decision: "blocked", requires: [] };
};
const getWriteActionMatrixDecisions = (issueScope, actionType, requestedExecutionMode) => {
  const resolvedIssueScope = resolveIssueScope(issueScope);
  const resolvedActionType = resolveActionType(actionType);
  const resolvedRequestedExecutionMode = resolveExecutionMode(requestedExecutionMode);
  const writeInteractionTier = resolveWriteInteractionTier(
    resolvedActionType,
    resolvedRequestedExecutionMode
  );
  const writeTierMatrixAction = resolveWriteTierMatrixAction(writeInteractionTier);
  const matrixActions =
    writeTierMatrixAction !== null
      ? [writeTierMatrixAction]
      : resolvedRequestedExecutionMode !== null
        ? [resolvedRequestedExecutionMode]
        : [];

  return {
    issue_scope: resolvedIssueScope,
    action_type: resolvedActionType,
    requested_execution_mode: resolvedRequestedExecutionMode,
    write_interaction_tier: writeInteractionTier,
    matrix_actions: [...matrixActions],
    decisions: RISK_STATES.map((state) => {
      const entry = getIssueActionMatrixEntry(resolvedIssueScope, state);
      const { decision, requires } = resolveMatrixActionDecision(entry, matrixActions);
      return {
        state,
        decision,
        requires
      };
    })
  };
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
  if (record.gate_decision === "blocked") {
    return isLiveExecutionMode(record.requested_execution_mode);
  }
  if (!isLiveExecutionMode(record.effective_execution_mode)) {
    return false;
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
  return record.gate_decision === "allowed" && isLiveExecutionMode(record.effective_execution_mode);
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
return { APPROVAL_CHECK_KEYS, EXECUTION_MODES, WRITE_INTERACTION_TIER, buildRiskTransitionAudit, buildUnifiedRiskStateOutput, getWriteActionMatrixDecisions, getIssueActionMatrixEntry, resolveIssueScope, resolveRiskState };
})();
const __webenvoy_module_fingerprint_profile = (() => {
const REQUIRED_PATCHES = [
  "audio_context",
  "battery",
  "navigator_plugins",
  "navigator_mime_types"
];

const OPTIONAL_PATCHES = [
  "hardware_concurrency",
  "device_memory",
  "performance_memory",
  "screen_color_depth",
  "screen_pixel_depth",
  "permissions_api",
  "navigator_connection"
];

const FIELD_DEPENDENCIES = {
  audio_context: ["audioNoiseSeed"],
  battery: ["battery.level", "battery.charging"],
  navigator_plugins: [],
  navigator_mime_types: [],
  hardware_concurrency: ["hardwareConcurrency"],
  device_memory: ["deviceMemory"],
  performance_memory: ["deviceMemory"],
  screen_color_depth: ["screen.colorDepth"],
  screen_pixel_depth: ["screen.pixelDepth"],
  permissions_api: [],
  navigator_connection: []
};

const LIVE_EXECUTION_MODES = new Set([
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);

const DEFAULT_PLUGIN_DESCRIPTORS = [
  {
    name: "Chrome PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "Chromium PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "Microsoft Edge PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  },
  {
    name: "PDF Viewer",
    filename: "internal-pdf-viewer",
    description: "Portable Document Format"
  }
];

const DEFAULT_MIME_TYPE_DESCRIPTORS = [
  {
    type: "application/pdf",
    suffixes: "pdf",
    description: "Portable Document Format",
    enabledPlugin: "Chrome PDF Viewer"
  },
  {
    type: "text/pdf",
    suffixes: "pdf",
    description: "Portable Document Format",
    enabledPlugin: "Chrome PDF Viewer"
  }
];

const SCREEN_CANDIDATES = [
  { width: 1440, height: 900, colorDepth: 30, pixelDepth: 30 },
  { width: 1512, height: 982, colorDepth: 24, pixelDepth: 24 },
  { width: 1680, height: 1050, colorDepth: 24, pixelDepth: 24 },
  { width: 1728, height: 1117, colorDepth: 30, pixelDepth: 30 },
  { width: 1920, height: 1080, colorDepth: 24, pixelDepth: 24 }
];

const DEVICE_MEMORY_CANDIDATES = [4, 8, 16];

const isObjectRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizePlatform = (platform) => {
  if (platform === "darwin") {
    return "macos";
  }
  if (platform === "win32") {
    return "windows";
  }
  if (platform === "linux") {
    return "linux";
  }
  return typeof platform === "string" && platform.length > 0 ? platform : "unknown";
};

const normalizeArch = (arch) => {
  if (arch === "x64") {
    return "x64";
  }
  if (arch === "arm64") {
    return "arm64";
  }
  return typeof arch === "string" && arch.length > 0 ? arch : "unknown";
};

const normalizeOsVersion = (osFamily, rawVersion) => {
  if (typeof rawVersion !== "string" || rawVersion.length === 0) {
    return "unknown";
  }

  if (osFamily !== "macos") {
    return rawVersion;
  }

  const matched = rawVersion.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!matched) {
    return rawVersion;
  }

  const darwinMajor = Number.parseInt(matched[1], 10);
  if (!Number.isInteger(darwinMajor)) {
    return rawVersion;
  }

  // `os.release()` on macOS returns Darwin kernel versions (for example: 24.4.0),
  // while browser UA must use macOS product versions.
  if (darwinMajor >= 20) {
    return `${darwinMajor - 9}.0`;
  }
  if (darwinMajor >= 4 && darwinMajor <= 19) {
    return `10.${darwinMajor - 4}`;
  }

  return rawVersion;
};

const hashString = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const stableUnit = (seed) => hashString(seed) / 0xffffffff;

const roundNumber = (value, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const selectBySeed = (seed, candidates) => candidates[hashString(seed) % candidates.length];

const extractChromeVersion = (value) => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  const uaMatch = value.match(/\b(?:Chrome|Chromium)\/(\d+\.\d+\.\d+\.\d+)\b/i);
  if (uaMatch) {
    return uaMatch[1];
  }

  const binaryVersionMatch = value.match(
    /\b(?:Google Chrome|Chrome for Testing|Chromium)\s+(\d+\.\d+\.\d+\.\d+)\b/i
  );
  if (binaryVersionMatch) {
    return binaryVersionMatch[1];
  }

  return null;
};

const resolveChromeVersion = (input) => {
  const explicitVersion = extractChromeVersion(input.browserVersion);
  if (explicitVersion) {
    return explicitVersion;
  }

  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    const fromNavigator = extractChromeVersion(navigator.userAgent);
    if (fromNavigator) {
      return fromNavigator;
    }
  }

  return null;
};

const buildDefaultUserAgent = (environment, input) => {
  const archToken = environment.arch === "arm64" ? "ARM 64" : "Win64; x64";
  const linuxArchToken = environment.arch === "arm64" ? "arm64" : "x86_64";
  const chromeVersion = resolveChromeVersion(input) ?? "0.0.0.0";

  if (environment.os_family === "macos") {
    const version = String(environment.os_version ?? "14_0").replace(/\./g, "_");
    return `Mozilla/5.0 (Macintosh; Intel Mac OS X ${version}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  if (environment.os_family === "windows") {
    return `Mozilla/5.0 (Windows NT 10.0; ${archToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
  }

  return `Mozilla/5.0 (X11; Linux ${linuxArchToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
};

const isLikelyLinuxKernelVersion = (value) =>
  typeof value === "string" &&
  /^\d+\.\d+\.\d+/.test(value);

const harmonizeExistingBundleEnvironment = (bundle, actualEnvironment) => {
  const cloned = cloneJson(bundle);
  if (!isEnvironment(cloned.environment)) {
    return cloned;
  }

  const actualOsFamily = normalizePlatform(actualEnvironment?.os_family);
  const actualOsVersion = normalizeOsVersion(actualOsFamily, actualEnvironment?.os_version ?? "unknown");
  if (
    actualOsFamily === "linux" &&
    cloned.environment.os_family === "linux" &&
    isLikelyLinuxKernelVersion(cloned.environment.os_version) &&
    actualOsVersion !== "unknown" &&
    cloned.environment.os_version !== actualOsVersion
  ) {
    cloned.environment = {
      ...cloned.environment,
      os_version: actualOsVersion
    };
  }

  return cloned;
};

const readPath = (target, path) => {
  const segments = path.split(".");
  let current = target;
  for (const segment of segments) {
    if (!isObjectRecord(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const isEnvironment = (value) =>
  isObjectRecord(value) &&
  typeof value.os_family === "string" &&
  typeof value.os_version === "string" &&
  typeof value.arch === "string";

const isScreen = (value) =>
  isObjectRecord(value) &&
  Number.isInteger(value.width) &&
  Number.isInteger(value.height) &&
  Number.isInteger(value.colorDepth) &&
  Number.isInteger(value.pixelDepth);

const isBattery = (value) =>
  isObjectRecord(value) &&
  typeof value.charging === "boolean" &&
  typeof value.level === "number" &&
  Number.isFinite(value.level) &&
  value.level >= 0 &&
  value.level <= 1;

const isLegacyMigration = (value) =>
  isObjectRecord(value) &&
  value.status === "backfilled_from_legacy" &&
  typeof value.migrated_at === "string" &&
  value.migrated_at.length > 0 &&
  Number.isInteger(value.source_schema_version) &&
  Array.isArray(value.reason_codes) &&
  value.reason_codes.every((code) => typeof code === "string");

const isFingerprintProfileBundle = (value) =>
  isObjectRecord(value) &&
  typeof value.ua === "string" &&
  Number.isInteger(value.hardwareConcurrency) &&
  Number.isInteger(value.deviceMemory) &&
  isScreen(value.screen) &&
  isBattery(value.battery) &&
  typeof value.timezone === "string" &&
  typeof value.audioNoiseSeed === "number" &&
  Number.isFinite(value.audioNoiseSeed) &&
  typeof value.canvasNoiseSeed === "number" &&
  Number.isFinite(value.canvasNoiseSeed) &&
  isEnvironment(value.environment) &&
  (value.legacy_migration === undefined || isLegacyMigration(value.legacy_migration));

const isPatchManifest = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  typeof value.manifest_version === "string" &&
  Array.isArray(value.required_patches) &&
  Array.isArray(value.optional_patches) &&
  isObjectRecord(value.field_dependencies) &&
  Array.isArray(value.unsupported_reason_codes);

const isConsistencyCheck = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  isEnvironment(value.expected_environment) &&
  isEnvironment(value.actual_environment) &&
  (value.decision === "match" || value.decision === "mismatch") &&
  Array.isArray(value.reason_codes);

const isRuntimeContext = (value) =>
  isObjectRecord(value) &&
  typeof value.profile === "string" &&
  (value.source === "profile_meta" || value.source === "profile_missing") &&
  (value.fingerprint_profile_bundle === null || isFingerprintProfileBundle(value.fingerprint_profile_bundle)) &&
  (value.fingerprint_patch_manifest === null || isPatchManifest(value.fingerprint_patch_manifest)) &&
  isConsistencyCheck(value.fingerprint_consistency_check) &&
  isObjectRecord(value.execution) &&
  typeof value.execution.live_allowed === "boolean" &&
  (value.execution.live_decision === "allowed" || value.execution.live_decision === "dry_run_only") &&
  Array.isArray(value.execution.allowed_execution_modes) &&
  value.execution.allowed_execution_modes.every((mode) => typeof mode === "string") &&
  Array.isArray(value.execution.reason_codes) &&
  value.execution.reason_codes.every((code) => typeof code === "string");

const buildIncompleteFingerprintRuntimeContext = (input) => {
  const reasonCode = input.reasonCode;
  const actualOsFamily = normalizePlatform(input.actualEnvironment?.os_family);
  return {
    profile: input.profile,
    source: input.metaPresent ? "profile_meta" : "profile_missing",
    fingerprint_profile_bundle: null,
    fingerprint_patch_manifest: null,
    fingerprint_consistency_check: {
      profile: input.profile,
      expected_environment: {
        os_family: "unknown",
        os_version: "unknown",
        arch: "unknown"
      },
      actual_environment: {
        os_family: actualOsFamily,
        os_version: normalizeOsVersion(actualOsFamily, input.actualEnvironment?.os_version ?? "unknown"),
        arch: normalizeArch(input.actualEnvironment?.arch)
      },
      decision: "mismatch",
      reason_codes: [reasonCode]
    },
    execution: {
      live_allowed: false,
      live_decision: "dry_run_only",
      allowed_execution_modes: ["dry_run", "recon"],
      reason_codes: [reasonCode]
    }
  };
};

const buildFingerprintProfileBundle = (input) => {
  const osFamily = normalizePlatform(input.environment?.os_family);
  const environment = {
    os_family: osFamily,
    os_version: normalizeOsVersion(osFamily, input.environment?.os_version ?? "unknown"),
    arch: normalizeArch(input.environment?.arch)
  };

  const profileName = typeof input.profileName === "string" ? input.profileName : "default";
  const fingerprintSeeds = isObjectRecord(input.fingerprintSeeds) ? input.fingerprintSeeds : {};
  const audioSeedSource =
    typeof fingerprintSeeds.audioNoiseSeed === "string"
      ? fingerprintSeeds.audioNoiseSeed
      : `${profileName}-audio-seed`;
  const canvasSeedSource =
    typeof fingerprintSeeds.canvasNoiseSeed === "string"
      ? fingerprintSeeds.canvasNoiseSeed
      : `${profileName}-canvas-seed`;

  if (isFingerprintProfileBundle(input.existingBundle)) {
    return harmonizeExistingBundleEnvironment(input.existingBundle, input.environment);
  }

  const screen = selectBySeed(`${profileName}:screen`, SCREEN_CANDIDATES);
  const deviceMemory = selectBySeed(`${profileName}:device-memory`, DEVICE_MEMORY_CANDIDATES);
  const hardwareConcurrency =
    deviceMemory >= 16
      ? selectBySeed(`${profileName}:hardware`, [8, 10, 12])
      : deviceMemory >= 8
        ? selectBySeed(`${profileName}:hardware`, [8, 10])
        : selectBySeed(`${profileName}:hardware`, [4, 8]);

  return {
    ua:
      typeof input.ua === "string" && input.ua.length > 0
        ? input.ua
        : buildDefaultUserAgent(environment, input),
    hardwareConcurrency,
    deviceMemory,
    screen: cloneJson(screen),
    battery: {
      level: roundNumber(0.52 + stableUnit(`${profileName}:battery-level`) * 0.39, 4),
      charging: stableUnit(`${profileName}:battery-charging`) >= 0.5
    },
    timezone:
      typeof input.timezone === "string" && input.timezone.length > 0 ? input.timezone : "UTC",
    audioNoiseSeed: roundNumber(stableUnit(audioSeedSource) / 1_000, 9),
    canvasNoiseSeed: roundNumber(stableUnit(canvasSeedSource) / 1_000, 9),
    environment
  };
};

const markFingerprintProfileBundleAsLegacyBackfilled = (input) => {
  const bundle = buildFingerprintProfileBundle(input);
  const sourceSchemaVersion =
    Number.isInteger(input.sourceSchemaVersion) && input.sourceSchemaVersion > 0
      ? input.sourceSchemaVersion
      : 1;
  const reasonCodes =
    Array.isArray(input.reasonCodes) && input.reasonCodes.every((code) => typeof code === "string")
      ? [...new Set(input.reasonCodes)]
      : ["LEGACY_PROFILE_BUNDLE_MIGRATED"];
  return {
    ...bundle,
    legacy_migration: {
      status: "backfilled_from_legacy",
      migrated_at:
        typeof input.migratedAt === "string" && input.migratedAt.length > 0
          ? input.migratedAt
          : new Date().toISOString(),
      source_schema_version: sourceSchemaVersion,
      reason_codes: reasonCodes
    }
  };
};

const buildFingerprintPatchManifest = (input) => {
  const bundle = input.bundle;
  const unsupportedReasonCodes = [];

  for (const patchName of REQUIRED_PATCHES) {
    const dependencies = FIELD_DEPENDENCIES[patchName] ?? [];
    const missing = dependencies.filter((path) => readPath(bundle, path) === undefined);
    if (missing.length > 0) {
      unsupportedReasonCodes.push("PROFILE_FIELD_MISSING");
      break;
    }
  }

  if (isLegacyMigration(bundle.legacy_migration)) {
    unsupportedReasonCodes.push(...bundle.legacy_migration.reason_codes);
  }

  return {
    profile: input.profile,
    manifest_version: "1",
    required_patches: [...REQUIRED_PATCHES],
    optional_patches: [...OPTIONAL_PATCHES],
    field_dependencies: cloneJson(FIELD_DEPENDENCIES),
    unsupported_reason_codes: unsupportedReasonCodes
  };
};

const buildFingerprintConsistencyCheck = (input) => {
  const expected =
    input.bundle && isEnvironment(input.bundle.environment)
      ? input.bundle.environment
      : {
          os_family: "unknown",
          os_version: "unknown",
          arch: "unknown"
        };
  const actualOsFamily = normalizePlatform(input.actualEnvironment?.os_family);
  const actual = {
    os_family: actualOsFamily,
    os_version: normalizeOsVersion(actualOsFamily, input.actualEnvironment?.os_version ?? "unknown"),
    arch: normalizeArch(input.actualEnvironment?.arch)
  };
  const reasonCodes = [];

  if (!input.bundle) {
    reasonCodes.push("PROFILE_META_MISSING");
  } else {
    if (expected.os_family !== actual.os_family) {
      reasonCodes.push("OS_FAMILY_MISMATCH");
    }
    if (expected.os_version !== actual.os_version) {
      reasonCodes.push("OS_VERSION_MISMATCH");
    }
    if (expected.arch !== actual.arch) {
      reasonCodes.push("ARCH_MISMATCH");
    }
  }

  return {
    profile: input.profile,
    expected_environment: expected,
    actual_environment: actual,
    decision: reasonCodes.length === 0 ? "match" : "mismatch",
    reason_codes: reasonCodes
  };
};

const buildFingerprintRuntimeContext = (input) => {
  const profile = typeof input.profile === "string" ? input.profile : "unknown";

  if (!input.metaPresent) {
    return buildIncompleteFingerprintRuntimeContext({
      profile,
      metaPresent: false,
      actualEnvironment: input.actualEnvironment,
      reasonCode: "PROFILE_META_MISSING"
    });
  }

  if (!isFingerprintProfileBundle(input.existingBundle)) {
    return buildIncompleteFingerprintRuntimeContext({
      profile,
      metaPresent: true,
      actualEnvironment: input.actualEnvironment,
      reasonCode: "PROFILE_FIELD_MISSING"
    });
  }

  const bundle = buildFingerprintProfileBundle({
    ...input,
    existingBundle: input.existingBundle,
    environment: input.actualEnvironment
  });
  const manifest = buildFingerprintPatchManifest({
    profile,
    bundle
  });
  const consistencyCheck = buildFingerprintConsistencyCheck({
    profile,
    bundle,
    actualEnvironment: input.actualEnvironment
  });
  const reasonCodes = [
    ...manifest.unsupported_reason_codes,
    ...consistencyCheck.reason_codes
  ];
  const liveAllowed = reasonCodes.length === 0;
  const requestedExecutionMode =
    typeof input.requestedExecutionMode === "string" ? input.requestedExecutionMode : null;
  const requestedLiveMode =
    requestedExecutionMode !== null && LIVE_EXECUTION_MODES.has(requestedExecutionMode);

  return {
    profile,
    source: "profile_meta",
    fingerprint_profile_bundle: bundle,
    fingerprint_patch_manifest: manifest,
    fingerprint_consistency_check: consistencyCheck,
    execution: {
      live_allowed: liveAllowed,
      live_decision:
        liveAllowed || !requestedLiveMode ? "allowed" : "dry_run_only",
      allowed_execution_modes: liveAllowed
        ? ["dry_run", "recon", "live_read_limited", "live_read_high_risk", "live_write"]
        : ["dry_run", "recon"],
      reason_codes: reasonCodes
    }
  };
};

const ensureFingerprintRuntimeContext = (value) => {
  if (!isRuntimeContext(value)) {
    return null;
  }
  return cloneJson(value);
};
return { DEFAULT_MIME_TYPE_DESCRIPTORS, DEFAULT_PLUGIN_DESCRIPTORS, ensureFingerprintRuntimeContext };
})();
const __webenvoy_module_issue209_admission = (() => {
const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const cloneIssue209AdmissionContext = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const approvalEvidence = asRecord(record.approval_admission_evidence);
  const auditEvidence = asRecord(record.audit_admission_evidence);

  return {
    ...(approvalEvidence ? { approval_admission_evidence: structuredClone(approvalEvidence) } : {}),
    ...(auditEvidence ? { audit_admission_evidence: structuredClone(auditEvidence) } : {})
  };
};

const normalizeIssue209AdmissionDraft = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const kind = asString(record.kind);
  if (kind === "missing") {
    return { kind };
  }

  if (kind !== "draft" && kind !== "explicit_context" && kind !== "derived_draft") {
    return null;
  }

  const admissionContext = cloneIssue209AdmissionContext(record.admission_context);
  if (!admissionContext) {
    return null;
  }

  return {
    kind: "draft",
    admission_context: admissionContext
  };
};

const createIssue209AdmissionDraft = (input) => {
  const explicitContext = cloneIssue209AdmissionContext(input?.admissionContext);
  if (explicitContext) {
    return {
      kind: "draft",
      admission_context: explicitContext
    };
  }

  return normalizeIssue209AdmissionDraft(input?.admissionDraft) ?? { kind: "missing" };
};

const bindAdmissionEvidenceToSession = (value, sessionId) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  return {
    ...structuredClone(record),
    session_id: sessionId
  };
};

const bindIssue209AdmissionToSession = (input) => {
  const draft = createIssue209AdmissionDraft(input);
  if (draft.kind === "missing") {
    return null;
  }

  const admissionContext = cloneIssue209AdmissionContext(draft.admission_context);
  if (!admissionContext) {
    return null;
  }

  const sessionId = asString(input?.sessionId);
  if (!sessionId) {
    return admissionContext;
  }

  const approvalEvidence = bindAdmissionEvidenceToSession(
    admissionContext.approval_admission_evidence,
    sessionId
  );
  const auditEvidence = bindAdmissionEvidenceToSession(
    admissionContext.audit_admission_evidence,
    sessionId
  );

  return {
    ...(approvalEvidence ? { approval_admission_evidence: approvalEvidence } : {}),
    ...(auditEvidence ? { audit_admission_evidence: auditEvidence } : {})
  };
};
return { cloneIssue209AdmissionContext, createIssue209AdmissionDraft, bindIssue209AdmissionToSession };
})();
const __webenvoy_module_issue209_identity = (() => {
const ISSUE209_LIVE_READ_EXECUTION_MODES = new Set([
  "live_read_limited",
  "live_read_high_risk"
]);

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const isIssue209LiveReadMode = (value) => ISSUE209_LIVE_READ_EXECUTION_MODES.has(asString(value));

const isIssue209LiveReadGateRequest = (input) =>
  asString(input?.issueScope) === "issue_209" && isIssue209LiveReadMode(input?.requestedExecutionMode);

const resolveIssue209LiveReadDecisionId = (input) => {
  const explicitDecisionId = asString(input?.decisionId);
  if (explicitDecisionId) {
    return explicitDecisionId;
  }

  const gateInvocationId = asString(input?.gateInvocationId);
  if (gateInvocationId) {
    return `gate_decision_${gateInvocationId}`;
  }

  throw new Error("issue_209 live-read requires gate_invocation_id");
};

const resolveIssue209LiveReadApprovalId = (input) => {
  return `gate_appr_${resolveIssue209LiveReadDecisionId(input)}`;
};

const prepareIssue209LiveReadIdentity = (input) => {
  if (!isIssue209LiveReadGateRequest(input)) {
    return null;
  }

  const decisionId = resolveIssue209LiveReadDecisionId(input);

  return {
    commandRequestId: asString(input?.commandRequestId) ?? asString(input?.requestId),
    gateInvocationId: asString(input?.gateInvocationId),
    runId: asString(input?.runId),
    sessionId: asString(input?.sessionId),
    issueScope: "issue_209",
    targetDomain: asString(input?.targetDomain),
    targetTabId: asInteger(input?.targetTabId),
    targetPage: asString(input?.targetPage),
    actionType: asString(input?.actionType),
    requestedExecutionMode: asString(input?.requestedExecutionMode),
    riskState: asString(input?.riskState),
    decisionId,
    approvalId: resolveIssue209LiveReadApprovalId({
      decisionId,
      gateInvocationId: asString(input?.gateInvocationId)
    })
  };
};
return { ISSUE209_LIVE_READ_EXECUTION_MODES, isIssue209LiveReadMode, isIssue209LiveReadGateRequest, prepareIssue209LiveReadIdentity, resolveIssue209LiveReadDecisionId, resolveIssue209LiveReadApprovalId };
})();
const __webenvoy_module_issue209_source = (() => {
const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;
const {
  resolveIssue209LiveReadApprovalId,
  resolveIssue209LiveReadDecisionId
} = __webenvoy_module_issue209_identity;
const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asBoolean = (value) => value === true;

const cloneIssue209AdmissionContext = (value) => {
  const record = asRecord(value);
  if (!record) {
    return null;
  }

  const approvalEvidence = asRecord(record.approval_admission_evidence);
  const auditEvidence = asRecord(record.audit_admission_evidence);

  return {
    ...(approvalEvidence ? { approval_admission_evidence: structuredClone(approvalEvidence) } : {}),
    ...(auditEvidence ? { audit_admission_evidence: structuredClone(auditEvidence) } : {})
  };
};

const normalizeChecks = (value) => {
  const record = asRecord(value);
  return Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(record?.[key])]));
};

const hasAllTrueChecks = (value) =>
  APPROVAL_CHECK_KEYS.every((key) => value?.[key] === true);

const normalizeApprovalAdmissionEvidence = (value) => {
  const record = asRecord(value);
  return {
    approval_admission_ref: asString(record?.approval_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: normalizeChecks(record?.checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeAuditAdmissionEvidence = (value) => {
  const record = asRecord(value);
  return {
    audit_admission_ref: asString(record?.audit_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    audited_checks: normalizeChecks(record?.audited_checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const resolveConsumedIssue209AdmissionEvidence = (value) => {
  const admissionContext = cloneIssue209AdmissionContext(value);
  const approvalEvidence = normalizeApprovalAdmissionEvidence(
    admissionContext?.approval_admission_evidence
  );
  const auditEvidence = normalizeAuditAdmissionEvidence(
    admissionContext?.audit_admission_evidence
  );

  const approvalAdmissionRef =
    approvalEvidence.approval_admission_ref &&
    approvalEvidence.recorded_at &&
    approvalEvidence.approved === true &&
    approvalEvidence.approver &&
    approvalEvidence.approved_at &&
    hasAllTrueChecks(approvalEvidence.checks)
      ? approvalEvidence.approval_admission_ref
      : null;
  const auditAdmissionRef =
    auditEvidence.audit_admission_ref &&
    auditEvidence.recorded_at &&
    hasAllTrueChecks(auditEvidence.audited_checks)
      ? auditEvidence.audit_admission_ref
      : null;

  return {
    approvalEvidence,
    auditEvidence,
    approvalAdmissionRef,
    auditAdmissionRef
  };
};

const normalizeProvidedApprovalSource = (value) => {
  const record = asRecord(value);
  return {
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: normalizeChecks(record?.checks)
  };
};

const normalizeProvidedAuditSource = (value) => {
  const record = asRecord(value);
  return {
    event_id: asString(record?.event_id),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    request_id: asString(record?.request_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    gate_decision: asString(record?.gate_decision),
    audited_checks: normalizeChecks(record?.audited_checks),
    recorded_at: asString(record?.recorded_at)
  };
};

const prepareIssue209LiveReadSource = (input) => {
  const decisionId = resolveIssue209LiveReadDecisionId({
    gateInvocationId: input?.gateInvocationId
  });
  const approvalId = resolveIssue209LiveReadApprovalId({
    decisionId
  });
  const explicitAdmissionContext = cloneIssue209AdmissionContext(input?.admissionContext);

  return {
    current: {
      commandRequestId: asString(input?.commandRequestId),
      gateInvocationId: asString(input?.gateInvocationId),
      runId: asString(input?.runId),
      issueScope: "issue_209",
      targetDomain: asString(input?.targetDomain),
      targetTabId: asInteger(input?.targetTabId),
      targetPage: asString(input?.targetPage),
      actionType: asString(input?.actionType),
      requestedExecutionMode: asString(input?.requestedExecutionMode),
      riskState: asString(input?.riskState),
      decisionId,
      approvalId
    },
    explicitAdmissionContext,
    explicitApprovalEvidence: normalizeApprovalAdmissionEvidence(
      explicitAdmissionContext?.approval_admission_evidence
    ),
    explicitAuditEvidence: normalizeAuditAdmissionEvidence(
      explicitAdmissionContext?.audit_admission_evidence
    ),
    approvalSource: normalizeProvidedApprovalSource(input?.approvalRecord),
    auditSource: normalizeProvidedAuditSource(input?.auditRecord)
  };
};
return { APPROVAL_CHECK_KEYS, cloneIssue209AdmissionContext, normalizeApprovalAdmissionEvidence, normalizeAuditAdmissionEvidence, resolveConsumedIssue209AdmissionEvidence, normalizeProvidedApprovalSource, normalizeProvidedAuditSource, prepareIssue209LiveReadSource };
})();
const __webenvoy_module_issue209_source_validation = (() => {
const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;
const {
  normalizeProvidedApprovalSource,
  normalizeProvidedAuditSource
} = __webenvoy_module_issue209_source;
const hasOwnNonNullValue = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const cloneChecks = (checks) =>
  Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, checks?.[key] === true]));

const hasAllTrueChecks = (checks) => APPROVAL_CHECK_KEYS.every((key) => checks?.[key] === true);

const validateIssue209ApprovalSourceAgainstCurrentLinkage = (input) => {
  const current = input?.current ?? {};
  const approvalSource = normalizeProvidedApprovalSource(
    input?.approvalSource ?? input?.approvalRecord
  );
  const approvalRequirementGaps = [];
  const carriesDecisionId = hasOwnNonNullValue(approvalSource, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(approvalSource, "approval_id");

  if (approvalSource.approved !== true) {
    approvalRequirementGaps.push("approval_record_approved_true");
  }
  if (!approvalSource.approver) {
    approvalRequirementGaps.push("approval_record_approver_present");
  }
  if (!approvalSource.approved_at) {
    approvalRequirementGaps.push("approval_record_approved_at_present");
  }
  if (!hasAllTrueChecks(approvalSource.checks)) {
    approvalRequirementGaps.push("approval_record_checks_all_true");
  }

  if (carriesDecisionId !== carriesApprovalId) {
    approvalRequirementGaps.push("approval_record_linkage_invalid");
  } else if (
    carriesDecisionId &&
    carriesApprovalId &&
    (approvalSource.decision_id !== current.decisionId ||
      approvalSource.approval_id !== current.approvalId)
  ) {
    approvalRequirementGaps.push("approval_record_linkage_invalid");
  }

  return {
    approvalSource,
    approvalRecord: {
      approval_id: current.approvalId ?? null,
      decision_id: current.decisionId ?? null,
      approved: approvalSource.approved,
      approver: approvalSource.approver,
      approved_at: approvalSource.approved_at,
      checks: cloneChecks(approvalSource.checks)
    },
    approvalRequirementGaps,
    isValid: approvalRequirementGaps.length === 0
  };
};

const validateIssue209AuditSourceAgainstCurrentLinkage = (input) => {
  const current = input?.current ?? {};
  const requestIdWasExplicit = input?.requestIdWasExplicit === true;
  const auditSource = normalizeProvidedAuditSource(input?.auditSource ?? input?.auditRecord);
  const auditRequirementGaps = [];
  const carriesDecisionId = hasOwnNonNullValue(auditSource, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(auditSource, "approval_id");

  if (!auditSource.event_id) {
    auditRequirementGaps.push("audit_record_event_id_present");
  }
  if (!auditSource.recorded_at) {
    auditRequirementGaps.push("audit_record_recorded_at_present");
  }
  if (auditSource.gate_decision !== "allowed") {
    auditRequirementGaps.push("audit_record_gate_decision_allowed");
  }
  if (!hasAllTrueChecks(auditSource.audited_checks)) {
    auditRequirementGaps.push("audit_record_checks_all_true");
  }
  if (carriesDecisionId !== true || carriesApprovalId !== true) {
    auditRequirementGaps.push("audit_record_linkage_invalid");
  } else if (
    auditSource.decision_id !== current.decisionId ||
    auditSource.approval_id !== current.approvalId
  ) {
    auditRequirementGaps.push("audit_record_linkage_invalid");
  }

  if (auditSource.issue_scope !== current.issueScope) {
    auditRequirementGaps.push("audit_record_issue_scope_match");
  }
  if (auditSource.target_domain !== current.targetDomain) {
    auditRequirementGaps.push("audit_record_target_domain_match");
  }
  if (auditSource.target_tab_id !== current.targetTabId) {
    auditRequirementGaps.push("audit_record_target_tab_id_match");
  }
  if (auditSource.target_page !== current.targetPage) {
    auditRequirementGaps.push("audit_record_target_page_match");
  }
  if (auditSource.action_type !== current.actionType) {
    auditRequirementGaps.push("audit_record_action_type_match");
  }
  if (auditSource.requested_execution_mode !== current.requestedExecutionMode) {
    auditRequirementGaps.push("audit_record_requested_execution_mode_match");
  }
  if (auditSource.risk_state !== current.riskState) {
    auditRequirementGaps.push("audit_record_risk_state_match");
  }
  if (
    requestIdWasExplicit &&
    current.commandRequestId &&
    auditSource.request_id &&
    auditSource.request_id !== current.commandRequestId
  ) {
    auditRequirementGaps.push("audit_record_request_id_match");
  }

  return {
    auditSource,
    auditRecord: {
      event_id: auditSource.event_id,
      decision_id: current.decisionId ?? null,
      approval_id: current.approvalId ?? null,
      request_id: auditSource.request_id ?? null,
      issue_scope: current.issueScope ?? null,
      target_domain: current.targetDomain ?? null,
      target_tab_id: current.targetTabId ?? null,
      target_page: current.targetPage ?? null,
      action_type: current.actionType ?? null,
      requested_execution_mode: current.requestedExecutionMode ?? null,
      risk_state: current.riskState ?? null,
      gate_decision: auditSource.gate_decision,
      audited_checks: cloneChecks(auditSource.audited_checks),
      recorded_at: auditSource.recorded_at
    },
    auditRequirementGaps,
    isValid: auditRequirementGaps.length === 0
  };
};
return { validateIssue209ApprovalSourceAgainstCurrentLinkage, validateIssue209AuditSourceAgainstCurrentLinkage };
})();
const __webenvoy_module_issue209_gate = (() => {
const { APPROVAL_CHECK_KEYS } = __webenvoy_module_risk_state;
const { cloneIssue209AdmissionContext } = __webenvoy_module_issue209_admission;
const { normalizeProvidedApprovalSource } = __webenvoy_module_issue209_source;
const {
  validateIssue209ApprovalSourceAgainstCurrentLinkage,
  validateIssue209AuditSourceAgainstCurrentLinkage
} = __webenvoy_module_issue209_source_validation;
const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asBoolean = (value) => value === true;

const hasOwnNonNullValue = (record, key) =>
  Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const asStringArray = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return normalized.length === value.length ? normalized : [];
};

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

const hasExplicitAdmissionEvidence = (admissionContext) => {
  const approvalEvidence = asRecord(admissionContext?.approval_admission_evidence);
  const auditEvidence = asRecord(admissionContext?.audit_admission_evidence);

  const hasMeaningfulEvidence = (record) => {
    if (!record) {
      return false;
    }
    return Object.values(record).some((value) => {
      if (value === true) {
        return true;
      }
      if (typeof value === "string") {
        return value.trim().length > 0;
      }
      if (typeof value === "number") {
        return true;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        return Object.values(value).some((nested) => nested === true);
      }
      return false;
    });
  };

  return hasMeaningfulEvidence(approvalEvidence) || hasMeaningfulEvidence(auditEvidence);
};

const resolveCanonicalGrantApprovedAt = (input) =>
  asString(input.state?.upstreamAuthorizationRequest?.authorization_grant?.granted_at) ??
  asString(input.state?.upstreamAuthorizationRequest?.action_request?.requested_at);

const projectRiskStateFromGrantSnapshot = (value) => {
  const normalized = asString(value);
  if (normalized === "active") {
    return "allowed";
  }
  if (normalized === "cool_down") {
    return "limited";
  }
  if (normalized === "paused") {
    return "paused";
  }
  return null;
};

const hasCanonicalGrantBackedAdmission = (input, liveRequirements) => {
  const upstream = asRecord(input.state?.upstreamAuthorizationRequest);
  const actionRequest = asRecord(upstream?.action_request);
  const resourceBinding = asRecord(upstream?.resource_binding);
  const authorizationGrant = asRecord(upstream?.authorization_grant);
  const runtimeTarget = asRecord(upstream?.runtime_target);
  const actionRequestRef = asString(actionRequest?.request_ref);
  const resourceBindingRef = asString(resourceBinding?.binding_ref);
  const authorizationGrantRef = asString(authorizationGrant?.grant_ref);
  const runtimeTargetRef = asString(runtimeTarget?.target_ref);
  const approvalRefs = asStringArray(authorizationGrant?.approval_refs);
  const auditRefs = asStringArray(authorizationGrant?.audit_refs);
  const grantActionName = asString(actionRequest?.action_name);
  const grantActionType = asString(actionRequest?.action_category);
  const grantResourceKind = asString(resourceBinding?.resource_kind);
  const grantProfileRef = asString(resourceBinding?.profile_ref);
  const grantBindingConstraints = asRecord(resourceBinding?.binding_constraints);
  const bindingScope = asRecord(authorizationGrant?.binding_scope);
  const targetScope = asRecord(authorizationGrant?.target_scope);
  const allowedActions = asStringArray(authorizationGrant?.allowed_actions);
  const grantDomain = asString(runtimeTarget?.domain);
  const grantPage = asString(runtimeTarget?.page);
  const grantTabId = asInteger(runtimeTarget?.tab_id);
  const projectedRiskState = projectRiskStateFromGrantSnapshot(
    authorizationGrant?.resource_state_snapshot
  );
  const supportsRequestedMode =
    input.state?.requestedExecutionMode === "live_read_high_risk"
      ? projectedRiskState === "allowed"
      : input.state?.requestedExecutionMode === "live_read_limited"
        ? projectedRiskState === "limited" || projectedRiskState === "allowed"
        : false;
  const grantHasExecutableBinding =
    grantResourceKind === "profile_session"
      ? grantProfileRef !== null
      : grantResourceKind === "anonymous_context"
        ? grantProfileRef === null &&
          grantBindingConstraints?.anonymous_required === true &&
          grantBindingConstraints?.reuse_logged_in_context_forbidden === true
        : false;

  return (
    liveRequirements.length > 0 &&
    input.state?.issueScope === "issue_209" &&
    input.state?.actionType === "read" &&
    (input.state?.requestedExecutionMode === "live_read_limited" ||
      input.state?.requestedExecutionMode === "live_read_high_risk") &&
    actionRequest !== null &&
    resourceBinding !== null &&
    authorizationGrant !== null &&
    runtimeTarget !== null &&
    actionRequestRef !== null &&
    resourceBindingRef !== null &&
    authorizationGrantRef !== null &&
    runtimeTargetRef !== null &&
    resolveCanonicalGrantApprovedAt(input) !== null &&
    approvalRefs.length > 0 &&
    auditRefs.length > 0 &&
    grantActionName !== null &&
    grantActionType === input.state?.actionType &&
    grantResourceKind !== null &&
    grantHasExecutableBinding &&
    grantDomain === input.targetDomain &&
    grantPage === input.targetPage &&
    grantTabId === input.targetTabId &&
    supportsRequestedMode &&
    allowedActions.includes(grantActionName) &&
    asStringArray(bindingScope?.allowed_resource_kinds).includes(grantResourceKind) &&
    (grantResourceKind !== "profile_session" ||
      asStringArray(bindingScope?.allowed_profile_refs).includes(grantProfileRef ?? "")) &&
    asStringArray(targetScope?.allowed_domains).includes(grantDomain ?? "") &&
    asStringArray(targetScope?.allowed_pages).includes(grantPage ?? "")
  );
};

const explicitAdmissionRefMatchesCurrentGrant = (grantRefs, explicitRef) => {
  const normalizedExplicitRef = asString(explicitRef);
  if (normalizedExplicitRef === null) {
    return false;
  }

  return asStringArray(grantRefs).includes(normalizedExplicitRef);
};

const normalizeApprovalAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.checks);
  return {
    approval_admission_ref: asString(record?.approval_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: Object.fromEntries(
      APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeAuditAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.audited_checks);
  return {
    audit_admission_ref: asString(record?.audit_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    audited_checks: Object.fromEntries(
      APPROVAL_CHECK_KEYS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const buildApprovalRecordFromAdmissionEvidence = (approvalAdmissionEvidence, expected) => ({
  approval_id: expected.approvalId ?? null,
  decision_id: expected.decisionId ?? null,
  approved: approvalAdmissionEvidence.approved === true,
  approver: approvalAdmissionEvidence.approver,
  approved_at: approvalAdmissionEvidence.approved_at,
  checks: Object.fromEntries(
    APPROVAL_CHECK_KEYS.map((key) => [key, approvalAdmissionEvidence.checks[key] === true])
  )
});

const buildSyntheticApprovalRecordFromCanonicalGrant = (expected) => ({
  approval_id: expected.approvalId ?? null,
  decision_id: expected.decisionId ?? null,
  approved: true,
  approver: "authorization_grant",
  approved_at: expected.approvedAt ?? null,
  checks: Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, true]))
});

const resolveIssue209ApprovalAdmissionRequirementGaps = (
  requirements,
  approvalAdmissionEvidence,
  expected
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(approvalAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(approvalAdmissionEvidence, "approval_id");

  for (const requirement of requirements) {
    if (requirement === "approval_admission_evidence_approved_true") {
      if (!approvalAdmissionEvidence.approved) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approver_present") {
      if (!approvalAdmissionEvidence.approver) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approved_at_present") {
      if (!approvalAdmissionEvidence.approved_at) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_checks_all_true") {
      const allChecksComplete = APPROVAL_CHECK_KEYS.every(
        (key) => approvalAdmissionEvidence.checks[key] === true
      );
      if (!allChecksComplete) {
        gaps.push(requirement);
      }
      continue;
    }
    if (
      requirement === "risk_state_checked" ||
      requirement === "target_domain_confirmed" ||
      requirement === "target_tab_confirmed" ||
      requirement === "target_page_confirmed" ||
      requirement === "action_type_confirmed"
    ) {
      if (approvalAdmissionEvidence.checks[requirement] !== true) {
        gaps.push(requirement);
      }
      continue;
    }
    gaps.push(requirement);
  }

  if (
    !approvalAdmissionEvidence.approval_admission_ref ||
    !approvalAdmissionEvidence.recorded_at ||
    approvalAdmissionEvidence.run_id !== expected.runId ||
    approvalAdmissionEvidence.session_id !== expected.sessionId ||
    approvalAdmissionEvidence.issue_scope !== expected.issueScope ||
    approvalAdmissionEvidence.target_domain !== expected.targetDomain ||
    approvalAdmissionEvidence.target_tab_id !== expected.targetTabId ||
    approvalAdmissionEvidence.target_page !== expected.targetPage ||
    approvalAdmissionEvidence.action_type !== expected.actionType ||
    approvalAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode
  ) {
    gaps.push("approval_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    approvalAdmissionEvidence.decision_id === expected.decisionId &&
    approvalAdmissionEvidence.approval_id === expected.approvalId;
  if (linkagePresent && !linkageValid) {
    gaps.push("approval_admission_evidence_present");
  }

  return gaps;
};

const resolveIssue209AuditAdmissionRequirementGaps = (
  auditAdmissionEvidence,
  expected,
  requirements
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(auditAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(auditAdmissionEvidence, "approval_id");

  if (
    requirements.includes("audit_admission_evidence_present") &&
    (!auditAdmissionEvidence.audit_admission_ref ||
      !auditAdmissionEvidence.recorded_at ||
      auditAdmissionEvidence.run_id !== expected.runId ||
      auditAdmissionEvidence.session_id !== expected.sessionId ||
      auditAdmissionEvidence.issue_scope !== expected.issueScope ||
      auditAdmissionEvidence.target_domain !== expected.targetDomain ||
      auditAdmissionEvidence.target_tab_id !== expected.targetTabId ||
      auditAdmissionEvidence.target_page !== expected.targetPage ||
      auditAdmissionEvidence.action_type !== expected.actionType ||
      auditAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode ||
      auditAdmissionEvidence.risk_state !== expected.riskState)
  ) {
    gaps.push("audit_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    auditAdmissionEvidence.decision_id === expected.decisionId &&
    auditAdmissionEvidence.approval_id === expected.approvalId;
  if (requirements.includes("audit_admission_evidence_present") && linkagePresent && !linkageValid) {
    gaps.push("audit_admission_evidence_present");
  }

  if (requirements.includes("audit_admission_checks_all_true")) {
    const allChecksComplete = APPROVAL_CHECK_KEYS.every(
      (key) => auditAdmissionEvidence.audited_checks[key] === true
    );
    if (!allChecksComplete) {
      gaps.push("audit_admission_checks_all_true");
    }
  }

  return gaps;
};

const collectIssue209LiveReadMatrixGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const admissionContext = cloneIssue209AdmissionContext(input.admissionContext);
  const approvalRecord = buildApprovalRecordFromAdmissionEvidence(
    normalizeApprovalAdmissionEvidence(admissionContext?.approval_admission_evidence),
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null
    }
  );

  if (gateReasons.length === 0 && input.state.isBlockedByStateMatrix) {
    pushReason(gateReasons, `RISK_STATE_${String(input.state.riskState).toUpperCase()}`);
    pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
  }

  if (gateReasons.length > 0 || input.state.liveModeCanEnter !== true) {
    return {
      gateReasons,
      approvalRecord,
      admissionContext: {
        approval_admission_evidence: normalizeApprovalAdmissionEvidence(
          admissionContext?.approval_admission_evidence
        ),
        audit_admission_evidence: normalizeAuditAdmissionEvidence(
          admissionContext?.audit_admission_evidence
        )
      },
      writeGateOnlyEligible: false,
      writeGateOnlyDecision: null,
      writeGateOnlyApprovalDecision: null
    };
  }

  const conditionalRequirement =
    input.state.requestedExecutionMode === null
      ? null
      : input.state.issueActionMatrix.conditional_actions.find(
          (entry) => entry.action === input.state.requestedExecutionMode
        ) ?? null;
  const liveRequirements = conditionalRequirement?.requires ?? [];
  const approvalAdmissionEvidence = normalizeApprovalAdmissionEvidence(
    admissionContext?.approval_admission_evidence
  );
  const auditAdmissionEvidence = normalizeAuditAdmissionEvidence(
    admissionContext?.audit_admission_evidence
  );
  const approvalAdmissionRequirementGaps = resolveIssue209ApprovalAdmissionRequirementGaps(
    liveRequirements.filter(
      (requirement) =>
        requirement === "approval_admission_evidence_approved_true" ||
        requirement === "approval_admission_evidence_approver_present" ||
        requirement === "approval_admission_evidence_approved_at_present" ||
        requirement === "approval_admission_evidence_checks_all_true" ||
        requirement === "risk_state_checked" ||
        requirement === "target_domain_confirmed" ||
        requirement === "target_tab_confirmed" ||
        requirement === "target_page_confirmed" ||
        requirement === "action_type_confirmed"
    ),
    approvalAdmissionEvidence,
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      issueScope: input.state.issueScope,
      targetDomain: input.targetDomain ?? null,
      targetTabId: input.targetTabId ?? null,
      targetPage: input.targetPage ?? null,
      actionType: input.state.actionType,
      requestedExecutionMode: input.state.requestedExecutionMode
    }
  );
  const auditAdmissionRequirementGaps = resolveIssue209AuditAdmissionRequirementGaps(
    auditAdmissionEvidence,
    {
      decisionId: input.decisionId ?? null,
      approvalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      issueScope: input.state.issueScope,
      targetDomain: input.targetDomain ?? null,
      targetTabId: input.targetTabId ?? null,
      targetPage: input.targetPage ?? null,
      actionType: input.state.actionType,
      requestedExecutionMode: input.state.requestedExecutionMode,
      riskState: input.state.riskState
    },
    liveRequirements
  );
  const rolloutRequirementGaps =
    liveRequirements.includes("limited_read_rollout_ready_true") &&
    input.state.limitedReadRolloutReadyTrue !== true
      ? ["limited_read_rollout_ready_true"]
      : [];
  const canonicalGrantBackedAdmission = hasCanonicalGrantBackedAdmission(input, liveRequirements);
  const explicitApprovalAlignedWithCurrentGrant =
    !canonicalGrantBackedAdmission ||
    explicitAdmissionRefMatchesCurrentGrant(
      input.state?.upstreamAuthorizationRequest?.authorization_grant?.approval_refs,
      approvalAdmissionEvidence.approval_admission_ref
    );
  const explicitAuditAlignedWithCurrentGrant =
    !canonicalGrantBackedAdmission ||
    explicitAdmissionRefMatchesCurrentGrant(
      input.state?.upstreamAuthorizationRequest?.authorization_grant?.audit_refs,
      auditAdmissionEvidence.audit_admission_ref
    );
  const explicitApprovalUsable =
    approvalAdmissionRequirementGaps.length === 0 && explicitApprovalAlignedWithCurrentGrant;
  const explicitAuditUsable =
    auditAdmissionRequirementGaps.length === 0 && explicitAuditAlignedWithCurrentGrant;
  const explicitAdmissionUsable =
    explicitApprovalUsable && explicitAuditUsable;
  const effectiveApprovalAdmissionEvidence =
    canonicalGrantBackedAdmission && !explicitApprovalUsable
      ? normalizeApprovalAdmissionEvidence(null)
      : approvalAdmissionEvidence;
  const effectiveAuditAdmissionEvidence =
    canonicalGrantBackedAdmission && !explicitAuditUsable
      ? normalizeAuditAdmissionEvidence(null)
      : auditAdmissionEvidence;
  const liveAdmissionSatisfied =
    explicitAdmissionUsable || canonicalGrantBackedAdmission;
  const canonicalApprovalRecord = explicitApprovalUsable
    ? buildApprovalRecordFromAdmissionEvidence(approvalAdmissionEvidence, {
        decisionId: input.decisionId ?? null,
        approvalId: input.expectedApprovalId ?? null
      })
    : canonicalGrantBackedAdmission
      ? buildSyntheticApprovalRecordFromCanonicalGrant({
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          approvedAt: resolveCanonicalGrantApprovedAt(input)
        })
      : approvalRecord;

  if (!liveAdmissionSatisfied && approvalAdmissionRequirementGaps.length > 0) {
    pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
  }
  if (
    !liveAdmissionSatisfied &&
    approvalAdmissionRequirementGaps.includes("approval_admission_evidence_checks_all_true")
  ) {
    pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
  }
  if (!liveAdmissionSatisfied && auditAdmissionRequirementGaps.length > 0) {
    pushReason(gateReasons, "AUDIT_RECORD_MISSING");
  }
  if (rolloutRequirementGaps.length > 0) {
    pushReason(gateReasons, "LIMITED_READ_ROLLOUT_NOT_READY");
  }

  return {
    gateReasons,
    approvalRecord: canonicalApprovalRecord,
    admissionContext: {
      approval_admission_evidence: effectiveApprovalAdmissionEvidence,
      audit_admission_evidence: effectiveAuditAdmissionEvidence
    },
    writeGateOnlyEligible: false,
    writeGateOnlyDecision: null,
    writeGateOnlyApprovalDecision: null
  };
};
return { validateIssue209ApprovalSourceAgainstCurrentLinkage, collectIssue209LiveReadMatrixGateReasons };
})();
const __webenvoy_module_issue209_postgate_audit = (() => {
const { APPROVAL_CHECK_KEYS, buildRiskTransitionAudit } = __webenvoy_module_risk_state;
const { resolveIssue209LiveReadApprovalId } = __webenvoy_module_issue209_identity;
const { resolveConsumedIssue209AdmissionEvidence } = __webenvoy_module_issue209_source;
const clone = (value) => structuredClone(value);
const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asString = (value) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asStringArray = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const normalizeChecks = (value) => {
  const record = asRecord(value);
  return Object.fromEntries(APPROVAL_CHECK_KEYS.map((key) => [key, record?.[key] === true]));
};

const ISSUE209_LIVE_READ_MODES = new Set(["live_read_limited", "live_read_high_risk"]);
const NO_ADDITIONAL_RISK_SIGNALS = "NO_ADDITIONAL_RISK_SIGNALS";

const hasExecutionAuditInputs = (requestAdmissionResult) => {
  const derivedFrom = asRecord(requestAdmissionResult?.derived_from);
  return (
    Boolean(asString(requestAdmissionResult?.request_ref)) &&
    Boolean(asString(derivedFrom?.action_request_ref)) &&
    Boolean(asString(derivedFrom?.resource_binding_ref)) &&
    Boolean(asString(derivedFrom?.authorization_grant_ref)) &&
    Boolean(asString(derivedFrom?.runtime_target_ref))
  );
};

const hasApprovalEvidenceValidationIssue = (reasonCodes) =>
  reasonCodes.some(
    (reason) =>
      reason === "MANUAL_CONFIRMATION_MISSING" ||
      reason === "APPROVAL_CHECKS_INCOMPLETE" ||
      reason === "APPROVAL_ADMISSION_REF_OUT_OF_SCOPE"
  );

const hasAuditEvidenceValidationIssue = (reasonCodes) =>
  reasonCodes.some(
    (reason) =>
      reason === "AUDIT_RECORD_MISSING" || reason === "AUDIT_ADMISSION_REF_OUT_OF_SCOPE"
  );

const buildIssue209ExecutionAudit = (input) => {
  const requestAdmissionResult = asRecord(input.gate?.request_admission_result);
  const requestedMode = asString(input.gate?.consumer_gate_result?.requested_execution_mode);
  if (
    !requestAdmissionResult ||
    !requestedMode ||
    !ISSUE209_LIVE_READ_MODES.has(requestedMode) ||
    !hasExecutionAuditInputs(requestAdmissionResult)
  ) {
    return null;
  }

  const derivedFrom = asRecord(requestAdmissionResult.derived_from);
  const reasonCodes = asStringArray(requestAdmissionResult.reason_codes);
  const consumedEvidence = resolveConsumedIssue209AdmissionEvidence(
    input.gate?.gate_input?.admission_context
  );
  const admissionAllowed = requestAdmissionResult.admission_decision === "allowed";
  const blockedWithMatchingGrant =
    requestAdmissionResult.admission_decision === "blocked" &&
    requestAdmissionResult.grant_match === true;
  const riskSignals =
    asStringArray(input.executionAuditRiskSignals).length > 0
      ? asStringArray(input.executionAuditRiskSignals)
      : [NO_ADDITIONAL_RISK_SIGNALS];

  return {
    audit_ref: `exec_audit_${input.decisionId}`,
    request_ref: asString(requestAdmissionResult.request_ref),
    consumed_inputs: {
      action_request_ref: asString(derivedFrom?.action_request_ref),
      resource_binding_ref: asString(derivedFrom?.resource_binding_ref),
      authorization_grant_ref: asString(derivedFrom?.authorization_grant_ref),
      runtime_target_ref: asString(derivedFrom?.runtime_target_ref)
    },
    compatibility_refs: {
      gate_run_id: asString(input.runId),
      approval_admission_ref:
        (!admissionAllowed && !blockedWithMatchingGrant) ||
        hasApprovalEvidenceValidationIssue(reasonCodes)
        ? null
        : consumedEvidence.approvalAdmissionRef,
      audit_admission_ref:
        (!admissionAllowed && !blockedWithMatchingGrant) ||
        hasAuditEvidenceValidationIssue(reasonCodes)
        ? null
        : consumedEvidence.auditAdmissionRef,
      approval_record_ref: asString(input.approvalRecord?.approval_id),
      audit_record_ref: asString(input.auditRecord?.event_id),
      session_rhythm_window_id:
        asString(input.gate?.gate_input?.session_rhythm_window_id) ?? null,
      session_rhythm_decision_id: asString(input.gate?.gate_input?.session_rhythm_decision_id) ??
        null
    },
    request_admission_decision: requestAdmissionResult.admission_decision,
    risk_signals: riskSignals,
    recorded_at: input.recordedAt
  };
};

const buildIssue209PostGateArtifacts = (input) => {
  const nowValue = typeof input?.now === "function" ? input.now() : Date.now();
  const recordedAt = new Date(nowValue).toISOString();
  const gate = input.gate;
  const requestedMode = gate.consumer_gate_result.requested_execution_mode;
  const effectiveMode = gate.consumer_gate_result.effective_execution_mode;
  const liveModeRequested =
    requestedMode === "live_read_limited" || requestedMode === "live_read_high_risk";
  const approvalIssued =
    gate.consumer_gate_result.gate_decision === "allowed" &&
    (effectiveMode === "live_read_limited" || effectiveMode === "live_read_high_risk");
  const riskSignal = gate.consumer_gate_result.gate_decision === "blocked" && liveModeRequested;
  const recoverySignal =
    gate.consumer_gate_result.gate_decision === "allowed" &&
    gate.gate_input.risk_state === "limited" &&
    liveModeRequested;

  const approvalRecord = clone(gate.approval_record);
  const decisionId = gate.gate_outcome.decision_id;
  const approvalId = approvalIssued
    ? asString(gate.gate_outcome.approval_id) ??
      asString(gate.approval_record.approval_id) ??
      resolveIssue209LiveReadApprovalId({ decisionId })
    : null;
  approvalRecord.decision_id = decisionId;
  approvalRecord.approval_id = approvalId;
  const auditAdmissionEvidence = asRecord(gate.gate_input.admission_context?.audit_admission_evidence);

  const auditRecord = {
    event_id: `gate_evt_${decisionId}`,
    decision_id: decisionId,
    approval_id: approvalId,
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    issue_scope: gate.gate_input.issue_scope,
    risk_state: gate.gate_input.risk_state,
    target_domain: gate.consumer_gate_result.target_domain,
    target_tab_id: gate.consumer_gate_result.target_tab_id,
    target_page: gate.consumer_gate_result.target_page,
    action_type: gate.consumer_gate_result.action_type,
    requested_execution_mode: requestedMode,
    effective_execution_mode: gate.consumer_gate_result.effective_execution_mode,
    gate_decision: gate.consumer_gate_result.gate_decision,
    gate_reasons: clone(gate.consumer_gate_result.gate_reasons),
    approver: approvalRecord.approver,
    approved_at: approvalRecord.approved_at,
    audited_checks: normalizeChecks(auditAdmissionEvidence?.audited_checks),
    write_interaction_tier: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
    write_action_matrix_decisions: gate.write_action_matrix_decisions
      ? clone(gate.write_action_matrix_decisions)
      : null,
    risk_signal: riskSignal,
    recovery_signal: recoverySignal,
    session_rhythm_state: riskSignal ? "cooldown" : recoverySignal ? "recovery" : "normal",
    cooldown_until: riskSignal ? new Date(nowValue + 30 * 60_000).toISOString() : null,
    recovery_started_at: recoverySignal ? recordedAt : null,
    recorded_at: recordedAt
  };

  const transitionAudit = buildRiskTransitionAudit({
    runId: input.runId,
    sessionId: input.sessionId,
    issueScope: gate.gate_input.issue_scope,
    prevState: gate.gate_input.risk_state,
    decision: gate.consumer_gate_result.gate_decision,
    gateReasons: clone(gate.consumer_gate_result.gate_reasons),
    requestedExecutionMode: gate.consumer_gate_result.requested_execution_mode,
    approvalRecord,
    auditRecords: [auditRecord],
    now: recordedAt
  });
  auditRecord.next_state = asString(transitionAudit.next_state);
  auditRecord.transition_trigger = asString(transitionAudit.trigger);
  const executionAudit = buildIssue209ExecutionAudit({
    runId: input.runId,
    gate,
    decisionId,
    approvalRecord,
    auditRecord,
    recordedAt,
    executionAuditRiskSignals: input.executionAuditRiskSignals
  });

  return {
    approval_record: approvalRecord,
    audit_record: auditRecord,
    execution_audit: executionAudit
  };
};
return { buildIssue209PostGateArtifacts };
})();
const __webenvoy_module_shared_xhs_gate = (() => {
const {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  WRITE_INTERACTION_TIER,
  getIssueActionMatrixEntry,
  getWriteActionMatrixDecisions,
  resolveIssueScope: resolveSharedIssueScope,
  resolveRiskState: resolveSharedRiskState
} = __webenvoy_module_risk_state;
const { resolveConsumedIssue209AdmissionEvidence } = __webenvoy_module_issue209_source;
const { collectIssue209LiveReadMatrixGateReasons } = __webenvoy_module_issue209_gate;
const { buildIssue209PostGateArtifacts } = __webenvoy_module_issue209_postgate_audit;
const {
  isIssue209LiveReadGateRequest,
  resolveIssue209LiveReadApprovalId
} = __webenvoy_module_issue209_identity;
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_UPSTREAM_RESOURCE_KINDS = new Set(["anonymous_context", "profile_session"]);
const XHS_RESOURCE_STATE_SNAPSHOTS = new Set(["active", "cool_down", "paused"]);
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODE_SET = new Set(EXECUTION_MODES);
const XHS_LIVE_READ_EXECUTION_MODE_SET = new Set(["live_read_limited", "live_read_high_risk"]);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_REQUIRED_AUDIT_ADMISSION_CHECKS = APPROVAL_CHECK_KEYS;
const XHS_WRITE_APPROVAL_REQUIREMENTS = [
  "approval_record_approved_true",
  "approval_record_approver_present",
  "approval_record_approved_at_present",
  "approval_record_checks_all_true"
];
const XHS_SCOPE_CONTEXT = {
  platform: "xhs",
  read_domain: XHS_READ_DOMAIN,
  write_domain: XHS_WRITE_DOMAIN,
  domain_mixing_forbidden: true
};
const XHS_READ_EXECUTION_POLICY = {
  default_mode: "dry_run",
  allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
  blocked_actions: ["expand_new_live_surface_without_gate"],
  live_entry_requirements: [
    "gate_input_risk_state_limited_or_allowed",
    "audit_admission_evidence_present",
    "audit_admission_checks_all_true",
    "risk_state_checked",
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "action_type_confirmed",
    "approval_admission_evidence_approved_true",
    "approval_admission_evidence_approver_present",
    "approval_admission_evidence_approved_at_present",
    "approval_admission_evidence_checks_all_true"
  ]
};
const EXECUTION_AUDIT_NON_RISK_REASON_CODES = new Set([
  "LIVE_MODE_APPROVED",
  "DEFAULT_MODE_DRY_RUN",
  "DEFAULT_MODE_RECON",
  "WRITE_INTERACTION_APPROVED",
  "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED"
]);
const NO_ADDITIONAL_RISK_SIGNALS = "NO_ADDITIONAL_RISK_SIGNALS";

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asBoolean = (value) => value === true;

const asString = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const asStringArray = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }
  const normalized = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return normalized.length === value.length ? normalized : null;
};

const normalizeGrantRefs = (value) => asStringArray(value) ?? [];

const normalizeUpstreamAuthorizationRequest = (value) => {
  const record = asRecord(value);
  const actionRequest = asRecord(record?.action_request);
  const resourceBinding = asRecord(record?.resource_binding);
  const authorizationGrant = asRecord(record?.authorization_grant);
  const runtimeTarget = asRecord(record?.runtime_target);
  const bindingScope = asRecord(authorizationGrant?.binding_scope);
  const targetScope = asRecord(authorizationGrant?.target_scope);
  const bindingConstraints = asRecord(resourceBinding?.binding_constraints);

  const resourceKind = asString(resourceBinding?.resource_kind);
  const resourceStateSnapshot = asString(authorizationGrant?.resource_state_snapshot);

  return {
    action_request: actionRequest
      ? {
          request_ref: asString(actionRequest.request_ref),
          action_name: asString(actionRequest.action_name),
          action_category: resolveXhsActionType(actionRequest.action_category),
          requested_at: asString(actionRequest.requested_at)
        }
      : null,
    resource_binding: resourceBinding
      ? {
          binding_ref: asString(resourceBinding.binding_ref),
          resource_kind:
            resourceKind && XHS_UPSTREAM_RESOURCE_KINDS.has(resourceKind) ? resourceKind : null,
          profile_ref: Object.prototype.hasOwnProperty.call(resourceBinding, "profile_ref")
            ? resourceBinding.profile_ref === null
              ? null
              : asString(resourceBinding.profile_ref)
            : undefined,
          binding_constraints: bindingConstraints
            ? {
                anonymous_required: bindingConstraints.anonymous_required === true,
                reuse_logged_in_context_forbidden:
                  bindingConstraints.reuse_logged_in_context_forbidden === true
              }
            : null
        }
      : null,
    authorization_grant: authorizationGrant
      ? {
          grant_ref: asString(authorizationGrant.grant_ref),
          allowed_actions: asStringArray(authorizationGrant.allowed_actions) ?? [],
          binding_scope: {
            allowed_resource_kinds: asStringArray(bindingScope?.allowed_resource_kinds) ?? [],
            allowed_profile_refs: asStringArray(bindingScope?.allowed_profile_refs) ?? []
          },
          target_scope: {
            allowed_domains: asStringArray(targetScope?.allowed_domains) ?? [],
            allowed_pages: asStringArray(targetScope?.allowed_pages) ?? []
          },
          approval_refs: normalizeGrantRefs(authorizationGrant.approval_refs),
          audit_refs: normalizeGrantRefs(authorizationGrant.audit_refs),
          granted_at: asString(authorizationGrant.granted_at),
          resource_state_snapshot:
            resourceStateSnapshot && XHS_RESOURCE_STATE_SNAPSHOTS.has(resourceStateSnapshot)
              ? resourceStateSnapshot
              : null
        }
      : null,
    runtime_target: runtimeTarget
      ? {
          target_ref: asString(runtimeTarget.target_ref),
          domain: asString(runtimeTarget.domain),
          page: asString(runtimeTarget.page),
          tab_id: asInteger(runtimeTarget.tab_id),
          url: asString(runtimeTarget.url)
        }
      : null
  };
};

const projectRiskStateFromSnapshot = (snapshot) => {
  if (snapshot === "active") {
    return "allowed";
  }
  if (snapshot === "cool_down") {
    return "limited";
  }
  if (snapshot === "paused") {
    return "paused";
  }
  return null;
};

const deriveCanonicalRiskState = (inputRiskState, upstream) => {
  const explicitRiskState = asString(inputRiskState);
  if (explicitRiskState) {
    return resolveXhsRiskState(explicitRiskState);
  }
  const projectedRiskState = projectRiskStateFromSnapshot(
    upstream?.authorization_grant?.resource_state_snapshot
  );
  return projectedRiskState
    ? resolveXhsRiskState(projectedRiskState)
    : resolveXhsRiskState(inputRiskState);
};

const buildSearchParamValueMap = (url) => {
  const values = new Map();
  for (const [key, value] of url.searchParams.entries()) {
    const current = values.get(key) ?? [];
    current.push(value);
    values.set(key, current);
  }
  return values;
};

const actualUrlSatisfiesExpectedQuery = (expectedUrl, actualUrl) => {
  const expectedParams = buildSearchParamValueMap(expectedUrl);
  if (expectedParams.size === 0) {
    return true;
  }

  const actualParams = buildSearchParamValueMap(actualUrl);
  for (const [key, expectedValues] of expectedParams.entries()) {
    const actualValues = [...(actualParams.get(key) ?? [])];
    if (actualValues.length < expectedValues.length) {
      return false;
    }

    for (const expectedValue of expectedValues) {
      const matchIndex = actualValues.indexOf(expectedValue);
      if (matchIndex === -1) {
        return false;
      }
      actualValues.splice(matchIndex, 1);
    }
  }

  return true;
};

const matchesRuntimeTargetUrl = (input, actualTargetUrl) => {
  const runtimeTarget = input?.runtime_target;
  if (!runtimeTarget?.url || !runtimeTarget.domain || !runtimeTarget.page) {
    return true;
  }

  try {
    const parsed = new URL(runtimeTarget.url);
    if (parsed.hostname !== runtimeTarget.domain) {
      return false;
    }
    if (runtimeTarget.page === "search_result_tab") {
      if (!parsed.pathname.startsWith("/search_result")) {
        return false;
      }
    }
    if (runtimeTarget.page === "explore_detail_tab") {
      if (!parsed.pathname.startsWith("/explore/")) {
        return false;
      }
    }
    if (runtimeTarget.page === "profile_tab") {
      if (!parsed.pathname.startsWith("/user/profile/")) {
        return false;
      }
    }
    if (runtimeTarget.page === "creator_publish_tab") {
      if (
        parsed.hostname !== XHS_WRITE_DOMAIN ||
        !parsed.pathname.startsWith("/publish")
      ) {
        return false;
      }
    }
    if (!actualTargetUrl) {
      return true;
    }
    const actual = new URL(actualTargetUrl);
    return (
      actual.protocol === parsed.protocol &&
      actual.hostname === parsed.hostname &&
      actual.pathname === parsed.pathname &&
      actualUrlSatisfiesExpectedQuery(parsed, actual)
    );
  } catch {
    return false;
  }
};

const deriveCanonicalRequestedExecutionMode = (input) => {
  const explicitRequestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const upstream = normalizeUpstreamAuthorizationRequest(
    input.upstreamAuthorizationRequest ?? input.upstream_authorization_request
  );
  const actionCategory = upstream.action_request?.action_category ?? null;
  const targetDomain = upstream.runtime_target?.domain ?? asString(input.targetDomain);

  if (!upstream.action_request || !upstream.resource_binding || !upstream.authorization_grant || !upstream.runtime_target) {
    return {
      requestedExecutionMode: explicitRequestedExecutionMode,
      upstream,
      legacyRequestedExecutionMode: resolveXhsExecutionMode(
        input.legacyRequestedExecutionMode ?? input.legacy_requested_execution_mode
      )
    };
  }

  let requestedExecutionMode = null;
  if (actionCategory === "write" || actionCategory === "irreversible_write") {
    requestedExecutionMode = "live_write";
  } else if (actionCategory === "read") {
    const hasGrantRefs =
      upstream.authorization_grant.approval_refs.length > 0 &&
      upstream.authorization_grant.audit_refs.length > 0;
    const projectedRiskState = projectRiskStateFromSnapshot(
      upstream.authorization_grant.resource_state_snapshot
    );
    if (!hasGrantRefs || targetDomain !== XHS_READ_DOMAIN) {
      requestedExecutionMode = "dry_run";
    } else if (projectedRiskState === "allowed") {
      requestedExecutionMode = "live_read_high_risk";
    } else if (projectedRiskState === "limited") {
      requestedExecutionMode = "live_read_limited";
    } else {
      requestedExecutionMode = "dry_run";
    }
  }
  let legacyRequestedExecutionMode = resolveXhsExecutionMode(
    input.legacyRequestedExecutionMode ?? input.legacy_requested_execution_mode
  );
  if (
    !legacyRequestedExecutionMode &&
    explicitRequestedExecutionMode &&
    requestedExecutionMode &&
    explicitRequestedExecutionMode !== requestedExecutionMode
  ) {
    legacyRequestedExecutionMode = explicitRequestedExecutionMode;
  }

  return {
    requestedExecutionMode: requestedExecutionMode ?? explicitRequestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  };
};

const applyCanonicalAdmissionReasons = (input) => {
  const upstream = input.upstream;
  const runtimeProfileRef = asString(input.runtimeProfileRef);
  if (!upstream?.action_request || !upstream?.resource_binding || !upstream?.authorization_grant || !upstream?.runtime_target) {
    return;
  }
  if (
    input.legacyRequestedExecutionMode &&
    input.requestedExecutionMode &&
    input.legacyRequestedExecutionMode !== input.requestedExecutionMode
  ) {
    pushReason(input.gateReasons, "STALE_LEGACY_REQUESTED_EXECUTION_MODE");
  }

  if (!upstream.authorization_grant.allowed_actions.includes(upstream.action_request.action_name)) {
    pushReason(input.gateReasons, "ACTION_NOT_ALLOWED_BY_GRANT");
  }
  if (
    !upstream.authorization_grant.binding_scope.allowed_resource_kinds.includes(
      upstream.resource_binding.resource_kind
    )
  ) {
    pushReason(input.gateReasons, "RESOURCE_KIND_OUT_OF_SCOPE");
  }
  if (
    upstream.resource_binding.resource_kind === "profile_session" &&
    upstream.resource_binding.profile_ref &&
    !upstream.authorization_grant.binding_scope.allowed_profile_refs.includes(
      upstream.resource_binding.profile_ref
    )
  ) {
    pushReason(input.gateReasons, "PROFILE_REF_OUT_OF_SCOPE");
  }
  if (
    upstream.resource_binding.resource_kind === "profile_session" &&
    upstream.resource_binding.profile_ref &&
    runtimeProfileRef &&
    runtimeProfileRef !== upstream.resource_binding.profile_ref
  ) {
    pushReason(input.gateReasons, "PROFILE_SESSION_RUNTIME_PROFILE_MISMATCH");
  }
  if (
    !upstream.authorization_grant.target_scope.allowed_domains.includes(upstream.runtime_target.domain)
  ) {
    pushReason(input.gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (
    !upstream.authorization_grant.target_scope.allowed_pages.includes(upstream.runtime_target.page)
  ) {
    pushReason(input.gateReasons, "TARGET_PAGE_OUT_OF_SCOPE");
  }
  if (!matchesRuntimeTargetUrl(upstream, asString(input.actualTargetUrl))) {
    pushReason(input.gateReasons, "TARGET_URL_CONTEXT_MISMATCH");
  }

  if (upstream.resource_binding.resource_kind === "anonymous_context") {
    const bindingConstraints = upstream.resource_binding.binding_constraints;
    if (
      bindingConstraints?.anonymous_required !== true ||
      bindingConstraints?.reuse_logged_in_context_forbidden !== true
    ) {
      pushReason(input.gateReasons, "ANONYMOUS_BINDING_CONSTRAINTS_INVALID");
    }
    if (input.targetSiteLoggedIn) {
      pushReason(input.gateReasons, "ANONYMOUS_CONTEXT_REQUIRES_LOGGED_OUT_SITE_CONTEXT");
      return;
    }
    if (!input.anonymousIsolationVerified) {
      pushReason(input.gateReasons, "ANONYMOUS_ISOLATION_UNVERIFIED");
    }
  }

  if (
    input.issueScope === "issue_209" &&
    input.requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(input.requestedExecutionMode)
  ) {
    const consumedEvidence = resolveConsumedIssue209AdmissionEvidence(input.admissionContext);
    if (
      consumedEvidence.approvalAdmissionRef &&
      !upstream.authorization_grant.approval_refs.includes(consumedEvidence.approvalAdmissionRef)
    ) {
      pushReason(input.gateReasons, "APPROVAL_ADMISSION_REF_OUT_OF_SCOPE");
    }
    if (
      consumedEvidence.auditAdmissionRef &&
      !upstream.authorization_grant.audit_refs.includes(consumedEvidence.auditAdmissionRef)
    ) {
      pushReason(input.gateReasons, "AUDIT_ADMISSION_REF_OUT_OF_SCOPE");
    }
  }
};

const deriveExecutionAuditRiskSignals = (reasonCodes) => {
  const normalizedReasonCodes = asStringArray(reasonCodes) ?? [];
  const riskSignals = normalizedReasonCodes.filter(
    (reason) =>
      !EXECUTION_AUDIT_NON_RISK_REASON_CODES.has(reason) &&
      !reason.startsWith("WRITE_INTERACTION_TIER_")
  );
  return riskSignals.length > 0 ? riskSignals : [NO_ADDITIONAL_RISK_SIGNALS];
};

const firstValidGrantRef = (value) => normalizeGrantRefs(value)[0] ?? null;

const resolveCanonicalCompatibilityRefs = (input) => {
  const upstreamApprovalRef = firstValidGrantRef(input.upstream?.authorization_grant?.approval_refs);
  const upstreamAuditRef = firstValidGrantRef(input.upstream?.authorization_grant?.audit_refs);
  const admissionApprovalRef =
    input.admissionContext?.approval_admission_evidence?.approval_admission_ref ?? null;
  const admissionAuditRef =
    input.admissionContext?.audit_admission_evidence?.audit_admission_ref ?? null;
  const allowUpstreamFallback = input.allowUpstreamFallback !== false;

  return {
    approvalAdmissionRef:
      typeof admissionApprovalRef === "string" && admissionApprovalRef.length > 0
        ? admissionApprovalRef
        : allowUpstreamFallback &&
            typeof upstreamApprovalRef === "string" &&
            upstreamApprovalRef.length > 0
          ? upstreamApprovalRef
          : null,
    auditAdmissionRef:
      typeof admissionAuditRef === "string" && admissionAuditRef.length > 0
        ? admissionAuditRef
        : allowUpstreamFallback &&
            typeof upstreamAuditRef === "string" &&
            upstreamAuditRef.length > 0
          ? upstreamAuditRef
          : null
  };
};

const evaluateRequestAdmissionResult = (input) => {
  const state = input.state ?? {};
  const upstream = input.upstream;
  const requestRef = upstream?.action_request?.request_ref ?? asString(input.commandRequestId) ?? asString(input.requestId);
  const normalizedActionType = upstream?.action_request?.action_category ?? state.actionType ?? null;
  const normalizedResourceKind = upstream?.resource_binding?.resource_kind ?? null;
  const runtimeTargetMatch =
    !input.gateReasons.includes("TARGET_DOMAIN_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_TAB_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_PAGE_CONTEXT_UNRESOLVED") &&
    !input.gateReasons.includes("TARGET_PAGE_CONTEXT_MISMATCH") &&
    !input.gateReasons.includes("TARGET_URL_CONTEXT_MISMATCH");

  let grantMatch = true;
  if (upstream?.authorization_grant && upstream?.action_request && upstream?.resource_binding && upstream?.runtime_target) {
    const allowedActions = upstream.authorization_grant.allowed_actions;
    const allowedResourceKinds = upstream.authorization_grant.binding_scope.allowed_resource_kinds;
    const allowedProfileRefs = upstream.authorization_grant.binding_scope.allowed_profile_refs;
    const allowedDomains = upstream.authorization_grant.target_scope.allowed_domains;
    const allowedPages = upstream.authorization_grant.target_scope.allowed_pages;

    if (!allowedActions.includes(upstream.action_request.action_name)) {
      grantMatch = false;
    }
    if (!allowedResourceKinds.includes(upstream.resource_binding.resource_kind)) {
      grantMatch = false;
    }
    if (
      upstream.resource_binding.resource_kind === "profile_session" &&
      upstream.resource_binding.profile_ref &&
      !allowedProfileRefs.includes(upstream.resource_binding.profile_ref)
    ) {
      grantMatch = false;
    }
    if (!allowedDomains.includes(upstream.runtime_target.domain)) {
      grantMatch = false;
    }
    if (!allowedPages.includes(upstream.runtime_target.page)) {
      grantMatch = false;
    }
    if (
      input.gateReasons.includes("APPROVAL_ADMISSION_REF_OUT_OF_SCOPE") ||
      input.gateReasons.includes("AUDIT_ADMISSION_REF_OUT_OF_SCOPE")
    ) {
      grantMatch = false;
    }
  }
  const requiresCanonicalGrantAdmission =
    state.issueScope === "issue_209" &&
    (state.requestedExecutionMode === "live_read_limited" ||
      state.requestedExecutionMode === "live_read_high_risk");
  const explicitCompatibilityRefs = resolveCanonicalCompatibilityRefs({
    upstream,
    admissionContext: input.admissionContext,
    allowUpstreamFallback: false
  });
  const hasExplicitCompatibilityEvidence =
    explicitCompatibilityRefs.approvalAdmissionRef !== null ||
    explicitCompatibilityRefs.auditAdmissionRef !== null;
  const hasCanonicalAdmissionGaps =
    input.gateReasons.includes("MANUAL_CONFIRMATION_MISSING") ||
    input.gateReasons.includes("APPROVAL_CHECKS_INCOMPLETE") ||
    input.gateReasons.includes("AUDIT_RECORD_MISSING");
  const canUseCanonicalGrantCompatibilityFallback =
    requiresCanonicalGrantAdmission && !hasCanonicalAdmissionGaps;

  if (requiresCanonicalGrantAdmission && hasCanonicalAdmissionGaps && !hasExplicitCompatibilityEvidence) {
    grantMatch = false;
  }

  const anonymousIsolationVerified = input.anonymousIsolationVerified === true;
  const targetSiteLoggedIn = input.targetSiteLoggedIn === true;
  const anonymousBindingConstraintsOk = !input.gateReasons.includes(
    "ANONYMOUS_BINDING_CONSTRAINTS_INVALID"
  );
  const anonymousIsolationOk =
    normalizedResourceKind !== "anonymous_context"
      ? true
      : !targetSiteLoggedIn && anonymousIsolationVerified && anonymousBindingConstraintsOk;
  const compatibilityRefs = resolveCanonicalCompatibilityRefs({
    upstream,
    admissionContext: input.admissionContext,
    allowUpstreamFallback: canUseCanonicalGrantCompatibilityFallback
  });

  const admissionDecision =
    !runtimeTargetMatch || !grantMatch || !anonymousIsolationOk || input.outcome.gateDecision === "blocked"
      ? "blocked"
      : input.outcome.gateDecision === "allowed"
        ? "allowed"
        : "deferred";

  return {
    request_ref: requestRef,
    admission_decision: admissionDecision,
    normalized_action_type: normalizedActionType,
    normalized_resource_kind: normalizedResourceKind,
    runtime_target_match: runtimeTargetMatch,
    grant_match: grantMatch,
    anonymous_isolation_ok: anonymousIsolationOk,
    effective_runtime_mode: input.outcome.effectiveExecutionMode,
    reason_codes: [...input.gateReasons],
    derived_from: {
      gate_input_ref: asString(input.runId) ?? input.decisionId,
      action_request_ref: upstream?.action_request?.request_ref ?? null,
      resource_binding_ref: upstream?.resource_binding?.binding_ref ?? null,
      authorization_grant_ref: upstream?.authorization_grant?.grant_ref ?? null,
      runtime_target_ref: upstream?.runtime_target?.target_ref ?? null,
      approval_admission_ref: compatibilityRefs.approvalAdmissionRef,
      audit_admission_ref: compatibilityRefs.auditAdmissionRef
    }
  };
};

const resolveXhsGateDecisionId = (input) => {
  const explicitDecisionId = asString(input?.decisionId);
  if (explicitDecisionId) {
    return explicitDecisionId;
  }

  const gateInvocationId = asString(input?.gateInvocationId);
  if (gateInvocationId) {
    return `gate_decision_${gateInvocationId}`;
  }

  const issueScope = asString(input?.issueScope);
  const requestedExecutionMode = asString(input?.requestedExecutionMode);
  if (
    issueScope === "issue_209" &&
    requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(requestedExecutionMode)
  ) {
    throw new Error("issue_209 live-read requires gate_invocation_id");
  }

  const runId = asString(input?.runId);
  const requestId = asString(input?.requestId);
  if (runId && requestId) {
    return `gate_decision_${runId}_${requestId}`;
  }
  if (requestId) {
    return `gate_decision_${requestId}`;
  }
  if (runId) {
    return `gate_decision_${runId}`;
  }

  const fallbackIssueScope = asString(input?.issueScope) ?? "unknown_scope";
  const fallbackTargetPage = asString(input?.targetPage) ?? "unknown_page";
  const fallbackTargetTabId = asInteger(input?.targetTabId);
  return `gate_decision_${fallbackIssueScope}_${fallbackTargetPage}_${fallbackTargetTabId ?? "unknown_tab"}`;
};

const deriveGateDecisionId = (input) => {
  return resolveXhsGateDecisionId(input);
};

const deriveApprovalId = (input, decisionId) => {
  if (isIssue209LiveReadGateRequest(input)) {
    return resolveIssue209LiveReadApprovalId({
      decisionId,
      gateInvocationId: input.gateInvocationId
    });
  }

  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const hasRealApproval =
    approvalRecord.approved &&
    approvalRecord.approver &&
    approvalRecord.approved_at &&
    XHS_REQUIRED_APPROVAL_CHECKS.every((key) => approvalRecord.checks[key] === true);
  if (!hasRealApproval) {
    return null;
  }

  const approvalRecordHasConflictingLinkage = hasApprovalRecordConflictingLinkage(
    approvalRecord,
    decisionId
  );
  if (approvalRecordHasConflictingLinkage) {
    return null;
  }

  const explicitApprovalId = asString(input.approvalId);
  if (explicitApprovalId && !approvalRecordHasConflictingLinkage) {
    return explicitApprovalId;
  }

  const record = asRecord(input.approvalRecord);
  const recordApprovalId = asString(record?.approval_id);
  if (recordApprovalId && approvalRecord.decision_id === decisionId) {
    return recordApprovalId;
  }

  return `gate_appr_${decisionId}`;
};

const resolveXhsGateApprovalId = (input) => {
  const decisionId = resolveXhsGateDecisionId(input);
  return deriveApprovalId(input, decisionId);
};

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

const hasOwnNonNullValue = (record, key) => Object.prototype.hasOwnProperty.call(record, key) && record[key] !== null;

const resolveXhsActionType = (value) =>
  typeof value === "string" && XHS_ACTION_TYPES.has(value) ? value : null;

const resolveXhsExecutionMode = (value) =>
  typeof value === "string" && XHS_EXECUTION_MODE_SET.has(value) ? value : null;

const resolveXhsRiskState = (value) => resolveSharedRiskState(value);

const resolveXhsIssueScope = (value) => resolveSharedIssueScope(value);

const normalizeXhsApprovalRecord = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.checks);
  return {
    approval_id: asString(record?.approval_id),
    decision_id: asString(record?.decision_id),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: Object.fromEntries(
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    )
  };
};

const normalizeXhsApprovalAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.checks);
  return {
    approval_admission_ref: asString(record?.approval_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    approved: asBoolean(record?.approved),
    approver: asString(record?.approver),
    approved_at: asString(record?.approved_at),
    checks: Object.fromEntries(
      XHS_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeXhsAuditAdmissionEvidence = (value) => {
  const record = asRecord(value);
  const checksRecord = asRecord(record?.audited_checks);
  return {
    audit_admission_ref: asString(record?.audit_admission_ref),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    run_id: asString(record?.run_id),
    session_id: asString(record?.session_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    risk_state: asString(record?.risk_state),
    audited_checks: Object.fromEntries(
      XHS_REQUIRED_AUDIT_ADMISSION_CHECKS.map((key) => [key, asBoolean(checksRecord?.[key])])
    ),
    recorded_at: asString(record?.recorded_at)
  };
};

const normalizeXhsAdmissionContext = (value) => {
  const record = asRecord(value);
  return {
    approval_admission_evidence: normalizeXhsApprovalAdmissionEvidence(
      record?.approval_admission_evidence
    ),
    audit_admission_evidence: normalizeXhsAuditAdmissionEvidence(record?.audit_admission_evidence)
  };
};

const resolveXhsIssueActionMatrixEntry = (issueScope, state) => {
  return getIssueActionMatrixEntry(issueScope, state);
};

const resolveXhsWriteActionMatrixDecisions = (issueScope, actionType, requestedExecutionMode) =>
  actionType === null ? null : getWriteActionMatrixDecisions(issueScope, actionType, requestedExecutionMode);

const resolveXhsWriteMatrixDecision = (output, state) =>
  output.decisions.find((entry) => entry.state === state) ?? {
    state,
    decision: "blocked",
    requires: []
  };

const resolveXhsWriteTierReason = (writeActionMatrixDecisions) =>
  writeActionMatrixDecisions === null
    ? null
    : `WRITE_INTERACTION_TIER_${writeActionMatrixDecisions.write_interaction_tier.toUpperCase()}`;

const resolveXhsApprovalRequirementGaps = (requirements, approvalRecord) => {
  const gaps = [];
  for (const requirement of requirements) {
    if (requirement === "approval_record_approved_true") {
      if (!approvalRecord.approved) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_record_approver_present") {
      if (!approvalRecord.approver) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_record_approved_at_present") {
      if (!approvalRecord.approved_at) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_record_checks_all_true") {
      const allChecksComplete = XHS_REQUIRED_APPROVAL_CHECKS.every((key) => approvalRecord.checks[key]);
      if (!allChecksComplete) {
        gaps.push(requirement);
      }
      continue;
    }
    gaps.push(requirement);
  }
  return gaps;
};

const resolveXhsApprovalAdmissionRequirementGaps = (
  requirements,
  approvalAdmissionEvidence,
  expected
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(approvalAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(approvalAdmissionEvidence, "approval_id");
  for (const requirement of requirements) {
    if (requirement === "approval_admission_evidence_approved_true") {
      if (!approvalAdmissionEvidence.approved) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approver_present") {
      if (!approvalAdmissionEvidence.approver) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_approved_at_present") {
      if (!approvalAdmissionEvidence.approved_at) {
        gaps.push(requirement);
      }
      continue;
    }
    if (requirement === "approval_admission_evidence_checks_all_true") {
      const allChecksComplete = XHS_REQUIRED_APPROVAL_CHECKS.every(
        (key) => approvalAdmissionEvidence.checks[key] === true
      );
      if (!allChecksComplete) {
        gaps.push(requirement);
      }
      continue;
    }
    if (
      requirement === "risk_state_checked" ||
      requirement === "target_domain_confirmed" ||
      requirement === "target_tab_confirmed" ||
      requirement === "target_page_confirmed" ||
      requirement === "action_type_confirmed"
    ) {
      if (approvalAdmissionEvidence.checks[requirement] !== true) {
        gaps.push(requirement);
      }
      continue;
    }
    gaps.push(requirement);
  }

  if (
    !approvalAdmissionEvidence.approval_admission_ref ||
    !approvalAdmissionEvidence.recorded_at ||
    approvalAdmissionEvidence.run_id !== expected.runId ||
    approvalAdmissionEvidence.session_id !== expected.sessionId ||
    approvalAdmissionEvidence.issue_scope !== expected.issueScope ||
    approvalAdmissionEvidence.target_domain !== expected.targetDomain ||
    approvalAdmissionEvidence.target_tab_id !== expected.targetTabId ||
    approvalAdmissionEvidence.target_page !== expected.targetPage ||
    approvalAdmissionEvidence.action_type !== expected.actionType ||
    approvalAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode
  ) {
    gaps.push("approval_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    approvalAdmissionEvidence.decision_id === expected.decisionId &&
    approvalAdmissionEvidence.approval_id === expected.approvalId;
  if (linkagePresent && !linkageValid) {
    gaps.push("approval_admission_evidence_present");
  }

  return gaps;
};

const normalizeXhsAuditRecord = (value) => {
  const record = asRecord(value);
  return {
    event_id: asString(record?.event_id),
    decision_id: asString(record?.decision_id),
    approval_id: asString(record?.approval_id),
    issue_scope: asString(record?.issue_scope),
    target_domain: asString(record?.target_domain),
    target_tab_id: asInteger(record?.target_tab_id),
    target_page: asString(record?.target_page),
    action_type: asString(record?.action_type),
    requested_execution_mode: asString(record?.requested_execution_mode),
    gate_decision: asString(record?.gate_decision),
    recorded_at: asString(record?.recorded_at)
  };
};

const resolveXhsAuditAdmissionRequirementGaps = (
  auditAdmissionEvidence,
  expected,
  requirements
) => {
  const gaps = [];
  const carriesDecisionId = hasOwnNonNullValue(auditAdmissionEvidence, "decision_id");
  const carriesApprovalId = hasOwnNonNullValue(auditAdmissionEvidence, "approval_id");
  if (
    requirements.includes("audit_admission_evidence_present") &&
    (!auditAdmissionEvidence.audit_admission_ref ||
      !auditAdmissionEvidence.recorded_at ||
      auditAdmissionEvidence.run_id !== expected.runId ||
      auditAdmissionEvidence.session_id !== expected.sessionId ||
      auditAdmissionEvidence.issue_scope !== expected.issueScope ||
      auditAdmissionEvidence.target_domain !== expected.targetDomain ||
      auditAdmissionEvidence.target_tab_id !== expected.targetTabId ||
      auditAdmissionEvidence.target_page !== expected.targetPage ||
      auditAdmissionEvidence.action_type !== expected.actionType ||
      auditAdmissionEvidence.requested_execution_mode !== expected.requestedExecutionMode ||
      auditAdmissionEvidence.risk_state !== expected.riskState)) {
    gaps.push("audit_admission_evidence_present");
  }

  const linkagePresent = carriesDecisionId || carriesApprovalId;
  const linkageValid =
    linkagePresent &&
    carriesDecisionId &&
    carriesApprovalId &&
    auditAdmissionEvidence.decision_id === expected.decisionId &&
    auditAdmissionEvidence.approval_id === expected.approvalId;
  if (requirements.includes("audit_admission_evidence_present") && linkagePresent && !linkageValid) {
    gaps.push("audit_admission_evidence_present");
  }

  if (requirements.includes("audit_admission_checks_all_true")) {
    const allChecksComplete = XHS_REQUIRED_AUDIT_ADMISSION_CHECKS.every(
      (key) => auditAdmissionEvidence.audited_checks[key] === true
    );
    if (!allChecksComplete) {
      gaps.push("audit_admission_checks_all_true");
    }
  }

  return gaps;
};
const hasApprovalRecordConflictingLinkage = (approvalRecord, decisionId) => {
  if (typeof decisionId !== "string" || decisionId.length === 0) {
    return true;
  }

  if (approvalRecord.decision_id && approvalRecord.decision_id !== decisionId) {
    return true;
  }

  return approvalRecord.approval_id !== null && approvalRecord.decision_id === null;
};

const resolveXhsFallbackMode = (requestedExecutionMode, riskState) => {
  if (requestedExecutionMode === "recon") {
    return "recon";
  }
  if (requestedExecutionMode === "live_write") {
    return "dry_run";
  }
  return riskState === "limited" ? "recon" : "dry_run";
};

const evaluateXhsGateCore = (input) => {
  const {
    requestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  } = deriveCanonicalRequestedExecutionMode(input);
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = deriveCanonicalRiskState(input.riskState, upstream);
  const actionType =
    upstream.action_request?.action_category ?? resolveXhsActionType(input.actionType);
  const targetDomain = upstream.runtime_target?.domain ?? asString(input.targetDomain);
  const targetTabId = upstream.runtime_target?.tab_id ?? asInteger(input.targetTabId);
  const targetPage = upstream.runtime_target?.page ?? asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const admissionContext = normalizeXhsAdmissionContext(input.admissionContext);
  const issueActionMatrix = resolveXhsIssueActionMatrixEntry(issueScope, riskState);
  const writeActionMatrixDecisions = resolveXhsWriteActionMatrixDecisions(
    issueScope,
    actionType,
    requestedExecutionMode
  );
  const writeMatrixDecision =
    writeActionMatrixDecisions === null
      ? null
      : resolveXhsWriteMatrixDecision(writeActionMatrixDecisions, riskState);
  const issue208WriteGateOnly =
    issueScope === "issue_208" &&
    actionType !== null &&
    writeActionMatrixDecisions !== null &&
    writeActionMatrixDecisions.write_interaction_tier !== "observe_only";
  const issue208EditorInputValidation = input.issue208EditorInputValidation === true;
  const fallbackMode = resolveXhsFallbackMode(requestedExecutionMode, riskState);
  const gateReasons = [];
  const writeTierReason = resolveXhsWriteTierReason(writeActionMatrixDecisions);
  const isLiveReadMode =
    requestedExecutionMode === "live_read_limited" ||
    requestedExecutionMode === "live_read_high_risk";
  const isBlockedByStateMatrix =
    !issue208WriteGateOnly &&
    requestedExecutionMode !== null &&
    issueActionMatrix.blocked_actions.includes(requestedExecutionMode);
  const conditionalRequirement =
    issue208WriteGateOnly || requestedExecutionMode === null
      ? null
      : issueActionMatrix.conditional_actions.find((entry) => entry.action === requestedExecutionMode) ??
        null;
  const liveModeCanEnter =
    requestedExecutionMode !== null &&
    conditionalRequirement !== null &&
    isLiveReadMode;
  let writeGateOnlyEligible = false;
  let writeGateOnlyDecision = null;

  if (!targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_NOT_EXPLICIT");
  } else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
    pushReason(gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (targetTabId === null || targetTabId <= 0) {
    pushReason(gateReasons, "TARGET_TAB_NOT_EXPLICIT");
  }
  if (!targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_NOT_EXPLICIT");
  }
  if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_CONTEXT_MISMATCH");
  }
  if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
    pushReason(gateReasons, "TARGET_TAB_CONTEXT_MISMATCH");
  }
  if (targetPage && actualTargetPage === null && input.requireActualTargetPage === true) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_UNRESOLVED");
  }
  if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_MISMATCH");
  }
  if (!actionType) {
    pushReason(gateReasons, "ACTION_TYPE_NOT_EXPLICIT");
  }
  if (!requestedExecutionMode) {
    pushReason(gateReasons, "REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
  }
  if (abilityAction && actionType && abilityAction !== actionType) {
    pushReason(gateReasons, "ABILITY_ACTION_CONTEXT_MISMATCH");
  }
  if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
    pushReason(gateReasons, "IRREVERSIBLE_WRITE_NOT_ALLOWED");
  }
  if (
    requestedExecutionMode === "live_write" &&
    (!issue208WriteGateOnly ||
      (input.treatMissingEditorValidationAsUnsupported === true && !issue208EditorInputValidation))
  ) {
    pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
  }
  if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  if (targetDomain === XHS_READ_DOMAIN && actionType !== null && actionType !== "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }

  if (gateReasons.length === 0) {
    if (isBlockedByStateMatrix) {
      if (isLiveReadMode) {
        pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else {
        pushReason(gateReasons, "ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
      }
    }

    if (issue208WriteGateOnly && actionType !== null && requestedExecutionMode !== null) {
      const approvalRequirementGaps = resolveXhsApprovalRequirementGaps(
        [...XHS_WRITE_APPROVAL_REQUIREMENTS],
        approvalRecord
      );
      const approvalSatisfied = approvalRequirementGaps.length === 0;
      if (issue208EditorInputValidation && riskState === "allowed" && approvalSatisfied) {
        writeGateOnlyEligible = true;
      } else {
        if (!issue208EditorInputValidation) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (riskState !== "allowed") {
          pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
          pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
        }
        if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (
          XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)
        ) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
      }
      writeGateOnlyDecision = {
        issue_scope: issueScope,
        state: riskState,
        write_interaction_tier: writeActionMatrixDecisions?.write_interaction_tier ?? null,
        matrix_decision: writeGateOnlyEligible ? "conditional" : "blocked",
        matrix_actions: writeActionMatrixDecisions?.matrix_actions ?? [],
        required_approval: writeGateOnlyEligible ? [...XHS_WRITE_APPROVAL_REQUIREMENTS] : [],
        approval_satisfied: approvalSatisfied,
        approval_missing_requirements: approvalRequirementGaps,
        execution_enabled: writeGateOnlyEligible
      };
    } else if (actionType && actionType !== "read") {
      if (isLiveReadMode) {
        pushReason(gateReasons, "ACTION_TYPE_MODE_MISMATCH");
      }
      pushReason(gateReasons, `RISK_STATE_${riskState.toUpperCase()}`);
      pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
    } else if (liveModeCanEnter) {
      if (!approvalRecord.approved || !approvalRecord.approver || !approvalRecord.approved_at) {
        pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
      }
      if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
    }
  }

  if (input.includeWriteInteractionTierReason === true && issue208WriteGateOnly) {
    pushReason(gateReasons, writeTierReason);
  }

  return {
    targetDomain,
    targetTabId,
    targetPage,
    actionType,
    requestedExecutionMode,
    legacyRequestedExecutionMode,
    upstreamAuthorizationRequest: upstream,
    issueScope,
    riskState,
    approvalRecord,
    admissionContext,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    issue208EditorInputValidation,
    writeTierReason,
    gateReasons,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
    fallbackMode,
    writeGateOnlyEligible,
    writeGateOnlyDecision
  };
};

const finalizeXhsGateOutcome = (input) => {
  const state = input.state ?? {};
  const gateReasons = [...(Array.isArray(input.gateReasons) ? input.gateReasons : [])];
  const {
    requestedExecutionMode = state.requestedExecutionMode ?? null,
    fallbackMode = state.fallbackMode ?? "dry_run",
    issue208WriteGateOnly = state.issue208WriteGateOnly === true,
    actionType = state.actionType ?? null,
    writeMatrixDecision = state.writeMatrixDecision ?? null,
    writeGateOnlyEligible,
    liveModeCanEnter = state.liveModeCanEnter === true
  } = input;
  const nonBlockingReasons = Array.isArray(input.nonBlockingReasons) ? input.nonBlockingReasons : [];
  const blockingReasons = gateReasons.filter((reason) => !nonBlockingReasons.includes(reason));
  let gateDecision = "allowed";
  let effectiveExecutionMode = requestedExecutionMode;

  if (blockingReasons.length > 0) {
    gateDecision = "blocked";
    if (
      requestedExecutionMode === "live_read_limited" ||
      requestedExecutionMode === "live_read_high_risk" ||
      requestedExecutionMode === "live_write"
    ) {
      effectiveExecutionMode = fallbackMode;
    }
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  if (issue208WriteGateOnly && actionType && actionType !== "read" && requestedExecutionMode !== null) {
    if (writeGateOnlyEligible) {
      if (
        input.writeGateOnlyEligibleBehavior === "block" ||
        input.allowIssue208EligibleExecution === false ||
        input.supportsIssue208ValidatedLiveWrite === false
      ) {
        gateDecision = "blocked";
        effectiveExecutionMode = fallbackMode;
        pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
      } else {
        gateDecision = "allowed";
        effectiveExecutionMode = requestedExecutionMode;
        pushReason(gateReasons, "WRITE_INTERACTION_APPROVED");
        pushReason(gateReasons, "ISSUE_208_EDITOR_INPUT_VALIDATION_APPROVED");
      }
    } else {
      gateDecision = "blocked";
      effectiveExecutionMode = fallbackMode;
    }
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  if (requestedExecutionMode === "dry_run" || requestedExecutionMode === "recon") {
    pushReason(
      gateReasons,
      requestedExecutionMode === "recon" ? "DEFAULT_MODE_RECON" : "DEFAULT_MODE_DRY_RUN"
    );
    return {
      allowed: gateDecision === "allowed",
      gateDecision,
      effectiveExecutionMode,
      gateReasons
    };
  }

  gateDecision = "blocked";
  effectiveExecutionMode = fallbackMode;
  if (liveModeCanEnter) {
    gateDecision = "allowed";
    effectiveExecutionMode = requestedExecutionMode;
    pushReason(gateReasons, "LIVE_MODE_APPROVED");
  }

  return {
    allowed: gateDecision === "allowed",
    gateDecision,
    effectiveExecutionMode,
    gateReasons
  };
};

const buildXhsGatePolicyState = (input) => {
  const {
    requestedExecutionMode,
    upstream,
    legacyRequestedExecutionMode
  } = deriveCanonicalRequestedExecutionMode(input);
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = deriveCanonicalRiskState(input.riskState, upstream);
  const actionType =
    upstream.action_request?.action_category ?? resolveXhsActionType(input.actionType);
  const issueActionMatrix = resolveXhsIssueActionMatrixEntry(issueScope, riskState);
  const writeActionMatrixDecisions = resolveXhsWriteActionMatrixDecisions(
    issueScope,
    actionType,
    requestedExecutionMode
  );
  const writeMatrixDecision =
    writeActionMatrixDecisions === null
      ? null
      : resolveXhsWriteMatrixDecision(writeActionMatrixDecisions, riskState);
  const issue208WriteGateOnly =
    issueScope === "issue_208" &&
    actionType !== null &&
    writeActionMatrixDecisions !== null &&
    writeActionMatrixDecisions.write_interaction_tier !== "observe_only";
  const writeTierReason = resolveXhsWriteTierReason(writeActionMatrixDecisions);
  const isLiveReadMode =
    requestedExecutionMode === "live_read_limited" ||
    requestedExecutionMode === "live_read_high_risk";
  const isBlockedByStateMatrix =
    !issue208WriteGateOnly &&
    requestedExecutionMode !== null &&
    issueActionMatrix.blocked_actions.includes(requestedExecutionMode);
  const liveModeCanEnter =
    requestedExecutionMode !== null &&
    issueActionMatrix.conditional_actions.some((entry) => entry.action === requestedExecutionMode) &&
    isLiveReadMode;
  const limitedReadRolloutReadyTrue = input.limitedReadRolloutReadyTrue === true;

  return {
    issueScope,
    riskState,
    actionType,
    requestedExecutionMode,
    legacyRequestedExecutionMode,
    upstreamAuthorizationRequest: upstream,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    writeTierReason,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
    limitedReadRolloutReadyTrue,
    fallbackMode: resolveXhsFallbackMode(requestedExecutionMode, riskState)
  };
};

const collectXhsCommandGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const targetDomain = asString(input.targetDomain);
  const targetTabId = asInteger(input.targetTabId);
  const targetPage = asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);

  if (!targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_NOT_EXPLICIT");
  } else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
    pushReason(gateReasons, "TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (targetTabId === null || targetTabId <= 0) {
    pushReason(gateReasons, "TARGET_TAB_NOT_EXPLICIT");
  }
  if (!targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_NOT_EXPLICIT");
  }
  if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
    pushReason(gateReasons, "TARGET_DOMAIN_CONTEXT_MISMATCH");
  }
  if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
    pushReason(gateReasons, "TARGET_TAB_CONTEXT_MISMATCH");
  }
  if (targetPage && actualTargetPage === null && input.requireActualTargetPage === true) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_UNRESOLVED");
  }
  if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
    pushReason(gateReasons, "TARGET_PAGE_CONTEXT_MISMATCH");
  }
  if (!actionType) {
    pushReason(gateReasons, "ACTION_TYPE_NOT_EXPLICIT");
  }
  if (!requestedExecutionMode) {
    pushReason(gateReasons, "REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
  }
  if (abilityAction && actionType && abilityAction !== actionType) {
    pushReason(gateReasons, "ABILITY_ACTION_CONTEXT_MISMATCH");
  }
  if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
    pushReason(gateReasons, "IRREVERSIBLE_WRITE_NOT_ALLOWED");
  }
  if (
    requestedExecutionMode === "live_write" &&
    (!input.issue208WriteGateOnly ||
      (input.treatMissingEditorValidationAsUnsupported === true &&
        input.issue208EditorInputValidation !== true))
  ) {
    pushReason(gateReasons, "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
  }
  if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  if (targetDomain === XHS_READ_DOMAIN && actionType !== null && actionType !== "read") {
    pushReason(gateReasons, "ACTION_DOMAIN_MISMATCH");
  }
  return gateReasons;
};

const collectXhsMatrixGateReasons = (input) => {
  const gateReasons = Array.isArray(input.gateReasons) ? input.gateReasons : [];
  const state = input.state;
  if (state.issueScope === "issue_209" && state.isLiveReadMode && state.actionType === "read") {
    return collectIssue209LiveReadMatrixGateReasons({
      gateReasons,
      state,
      decisionId: input.decisionId ?? null,
      expectedApprovalId: input.expectedApprovalId ?? null,
      runId: input.runId ?? null,
      sessionId: input.sessionId ?? null,
      approvalRecord: input.approvalRecord,
      auditRecord: input.auditRecord,
      admissionContext: input.admissionContext,
      targetDomain: input.targetDomain,
      targetTabId: input.targetTabId,
      targetPage: input.targetPage
    });
  }

  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
  const auditRecord = normalizeXhsAuditRecord(input.auditRecord);
  const admissionContext = normalizeXhsAdmissionContext(input.admissionContext);
  const approvalRecordHasConflictingLinkage = hasApprovalRecordConflictingLinkage(
    approvalRecord,
    input.decisionId
  );
  let writeGateOnlyEligible = false;
  let writeGateOnlyDecision = null;

  if (gateReasons.length === 0) {
    if (state.isBlockedByStateMatrix) {
      if (state.isLiveReadMode) {
        pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else {
        pushReason(gateReasons, "ISSUE_ACTION_BLOCKED_BY_STATE_MATRIX");
      }
    }

    if (state.issue208WriteGateOnly && state.actionType !== null && state.requestedExecutionMode !== null) {
      const approvalRequirementGaps = resolveXhsApprovalRequirementGaps(
        [...XHS_WRITE_APPROVAL_REQUIREMENTS],
        approvalRecord
      );
      const approvalSatisfied =
        !approvalRecordHasConflictingLinkage && approvalRequirementGaps.length === 0;
      if (
        state.writeMatrixDecision?.decision === "blocked" ||
        state.writeMatrixDecision?.decision === "not_applicable"
      ) {
        if (input.issue208EditorInputValidation !== true) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (
          approvalRecordHasConflictingLinkage ||
          !approvalRecord.approved ||
          !approvalRecord.approver ||
          !approvalRecord.approved_at
        ) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
        pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
        pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
      } else if (
        input.issue208EditorInputValidation === true &&
        state.riskState === "allowed" &&
        approvalSatisfied
      ) {
        writeGateOnlyEligible = true;
      } else {
        if (input.issue208EditorInputValidation !== true) {
          pushReason(gateReasons, "EDITOR_INPUT_VALIDATION_REQUIRED");
        }
        if (state.riskState !== "allowed") {
          pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
          pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
        }
        if (
          approvalRecordHasConflictingLinkage ||
          !approvalRecord.approved ||
          !approvalRecord.approver ||
          !approvalRecord.approved_at
        ) {
          pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
        }
        if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
          pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
        }
      }
      writeGateOnlyDecision = {
        issue_scope: state.issueScope,
        state: state.riskState,
        write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null,
        matrix_decision: writeGateOnlyEligible ? "conditional" : "blocked",
        matrix_actions: state.writeActionMatrixDecisions?.matrix_actions ?? [],
        required_approval: writeGateOnlyEligible ? [...XHS_WRITE_APPROVAL_REQUIREMENTS] : [],
        approval_satisfied: approvalSatisfied,
        approval_missing_requirements: approvalRequirementGaps,
        execution_enabled: writeGateOnlyEligible
      };
    } else if (state.actionType && state.actionType !== "read") {
      if (state.isLiveReadMode) {
        pushReason(gateReasons, "ACTION_TYPE_MODE_MISMATCH");
      }
      pushReason(gateReasons, `RISK_STATE_${state.riskState.toUpperCase()}`);
      pushReason(gateReasons, "ISSUE_ACTION_MATRIX_BLOCKED");
    } else if (state.liveModeCanEnter) {
      const conditionalRequirement =
        state.requestedExecutionMode === null
          ? null
          : state.issueActionMatrix.conditional_actions.find(
              (entry) => entry.action === state.requestedExecutionMode
            ) ?? null;
      const liveRequirements = conditionalRequirement?.requires ?? [];
      const approvalAdmissionRequirementGaps = resolveXhsApprovalAdmissionRequirementGaps(
        liveRequirements.filter(
          (requirement) =>
            requirement === "approval_admission_evidence_approved_true" ||
            requirement === "approval_admission_evidence_approver_present" ||
            requirement === "approval_admission_evidence_approved_at_present" ||
            requirement === "approval_admission_evidence_checks_all_true" ||
            requirement === "risk_state_checked" ||
            requirement === "target_domain_confirmed" ||
            requirement === "target_tab_confirmed" ||
            requirement === "target_page_confirmed" ||
            requirement === "action_type_confirmed"
        ),
        admissionContext.approval_admission_evidence,
        {
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          runId: input.runId ?? null,
          sessionId: input.sessionId ?? null,
          issueScope: state.issueScope,
          targetDomain: input.targetDomain,
          targetTabId: input.targetTabId,
          targetPage: input.targetPage,
          actionType: state.actionType,
          requestedExecutionMode: state.requestedExecutionMode
        }
      );
      const auditAdmissionRequirementGaps = resolveXhsAuditAdmissionRequirementGaps(
        admissionContext.audit_admission_evidence,
        {
          decisionId: input.decisionId ?? null,
          approvalId: input.expectedApprovalId ?? null,
          runId: input.runId ?? null,
          sessionId: input.sessionId ?? null,
          issueScope: state.issueScope,
          targetDomain: input.targetDomain,
          targetTabId: input.targetTabId,
          targetPage: input.targetPage,
          actionType: state.actionType,
          requestedExecutionMode: state.requestedExecutionMode,
          riskState: state.riskState
        },
        liveRequirements
      );
      const rolloutRequirementGaps =
        liveRequirements.includes("limited_read_rollout_ready_true") &&
        state.limitedReadRolloutReadyTrue !== true
          ? ["limited_read_rollout_ready_true"]
          : [];
      if (
        approvalRecordHasConflictingLinkage ||
        !approvalRecord.approved ||
        !approvalRecord.approver ||
        !approvalRecord.approved_at ||
        approvalAdmissionRequirementGaps.length > 0
      ) {
        pushReason(gateReasons, "MANUAL_CONFIRMATION_MISSING");
      }
      if (XHS_REQUIRED_APPROVAL_CHECKS.some((key) => approvalRecord.checks[key] !== true)) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
      if (
        approvalAdmissionRequirementGaps.includes("approval_admission_evidence_checks_all_true")
      ) {
        pushReason(gateReasons, "APPROVAL_CHECKS_INCOMPLETE");
      }
      if (
        auditAdmissionRequirementGaps.includes("audit_admission_evidence_present") ||
        auditAdmissionRequirementGaps.includes("audit_admission_checks_all_true")
      ) {
        pushReason(gateReasons, "AUDIT_RECORD_MISSING");
      }
      if (rolloutRequirementGaps.length > 0) {
        pushReason(gateReasons, "LIMITED_READ_ROLLOUT_NOT_READY");
      }
    }
  }

  return {
    gateReasons,
    approvalRecord,
    auditRecord,
    admissionContext,
    writeGateOnlyEligible,
    writeGateOnlyDecision,
    writeGateOnlyApprovalDecision: writeGateOnlyDecision
  };
};

const evaluateXhsGate = (input) => {
  const state = buildXhsGatePolicyState(input);
  const decisionId = deriveGateDecisionId(input);
  const gateReasons = Array.isArray(input.additionalGateReasons)
    ? input.additionalGateReasons.filter((reason) => typeof reason === "string")
    : [];
  const expectedApprovalId = deriveApprovalId(input, decisionId);
  collectXhsCommandGateReasons({
    gateReasons,
    actionType: state.actionType,
    requestedExecutionMode: state.requestedExecutionMode,
    abilityAction: input.abilityAction ?? input.abilityActionType,
    targetDomain:
      state.upstreamAuthorizationRequest?.runtime_target?.domain ?? input.targetDomain,
    targetTabId:
      state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? input.targetTabId,
    targetPage:
      state.upstreamAuthorizationRequest?.runtime_target?.page ?? input.targetPage,
    actualTargetDomain: input.actualTargetDomain,
    actualTargetTabId: input.actualTargetTabId,
    actualTargetPage: input.actualTargetPage,
    requireActualTargetPage: input.requireActualTargetPage,
    issue208WriteGateOnly: state.issue208WriteGateOnly,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    treatMissingEditorValidationAsUnsupported:
      input.treatMissingEditorValidationAsUnsupported === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true,
    writeTierReason: state.writeTierReason
  });
  const { approvalRecord, admissionContext, writeGateOnlyEligible } = collectXhsMatrixGateReasons({
    gateReasons,
    state,
    decisionId,
    expectedApprovalId,
    runId: asString(input.runId),
    sessionId: asString(input.sessionId),
    approvalRecord: input.approvalRecord,
    auditRecord: input.auditRecord,
    admissionContext: input.admissionContext,
    targetDomain:
      state.upstreamAuthorizationRequest?.runtime_target?.domain ?? input.targetDomain,
    targetTabId:
      state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? input.targetTabId,
    targetPage:
      state.upstreamAuthorizationRequest?.runtime_target?.page ?? input.targetPage,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true
  });
  applyCanonicalAdmissionReasons({
    gateReasons,
    upstream: state.upstreamAuthorizationRequest,
    issueScope: state.issueScope,
    requestedExecutionMode: state.requestedExecutionMode,
    legacyRequestedExecutionMode: state.legacyRequestedExecutionMode,
    runtimeProfileRef: input.runtimeProfileRef ?? input.__runtime_profile_ref,
    actualTargetUrl: input.actualTargetUrl ?? input.__actual_target_url,
    admissionContext,
    anonymousIsolationVerified:
      input.anonymousIsolationVerified === true || input.__anonymous_isolation_verified === true,
    targetSiteLoggedIn: input.targetSiteLoggedIn === true || input.target_site_logged_in === true
  });
  const approvalId = expectedApprovalId;
  approvalRecord.approval_id = approvalId;
  approvalRecord.decision_id = decisionId;
  const outcome = finalizeXhsGateOutcome({
    gateReasons,
    state,
    writeGateOnlyEligible,
    writeGateOnlyEligibleBehavior:
      input.writeGateOnlyEligibleBehavior === "block" ? "block" : "allow"
  });
  const approvalActive =
    outcome.gateDecision === "allowed" &&
    (outcome.effectiveExecutionMode === "live_read_limited" ||
      outcome.effectiveExecutionMode === "live_read_high_risk" ||
      outcome.effectiveExecutionMode === "live_write");
  if (
    input.includeWriteInteractionTierReason === true &&
    state.issue208WriteGateOnly &&
    state.writeTierReason
  ) {
    pushReason(outcome.gateReasons, state.writeTierReason);
  }
  approvalRecord.approval_id = approvalActive ? approvalId : null;
  const requestAdmissionResult = evaluateRequestAdmissionResult({
    state,
    upstream: state.upstreamAuthorizationRequest,
    requestId: input.requestId,
    commandRequestId: input.commandRequestId,
    legacyRequestedExecutionMode: state.legacyRequestedExecutionMode,
    anonymousIsolationVerified:
      input.anonymousIsolationVerified === true || input.__anonymous_isolation_verified === true,
    targetSiteLoggedIn: input.targetSiteLoggedIn === true || input.target_site_logged_in === true,
    gateReasons: outcome.gateReasons,
    outcome,
    runId: input.runId,
    decisionId,
    admissionContext
  });
  const executionAuditRiskSignals = deriveExecutionAuditRiskSignals(
    requestAdmissionResult.reason_codes
  );
  const result = {
    scope_context: { ...XHS_SCOPE_CONTEXT },
    read_execution_policy: {
      default_mode: XHS_READ_EXECUTION_POLICY.default_mode,
      allowed_modes: [...XHS_READ_EXECUTION_POLICY.allowed_modes],
      blocked_actions: [...XHS_READ_EXECUTION_POLICY.blocked_actions],
      live_entry_requirements: [...XHS_READ_EXECUTION_POLICY.live_entry_requirements]
    },
    issue_action_matrix: state.issueActionMatrix,
    write_interaction_tier: WRITE_INTERACTION_TIER,
    write_action_matrix_decisions: state.writeActionMatrixDecisions,
    gate_input: {
      issue_scope: state.issueScope,
      target_domain:
        state.upstreamAuthorizationRequest?.runtime_target?.domain ?? asString(input.targetDomain),
      target_tab_id:
        state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? asInteger(input.targetTabId),
      target_page:
        state.upstreamAuthorizationRequest?.runtime_target?.page ?? asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      risk_state: state.riskState,
      session_rhythm_window_id: asString(input.sessionRhythmWindowId ?? input.__session_rhythm_window_id),
      session_rhythm_decision_id: asString(input.sessionRhythmDecisionId ?? input.__session_rhythm_decision_id),
      admission_context: admissionContext
    },
    gate_outcome: {
      decision_id: decisionId,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      requires_manual_confirmation:
        state.requestedExecutionMode === "live_read_limited" ||
        state.requestedExecutionMode === "live_read_high_risk" ||
        state.requestedExecutionMode === "live_write"
    },
    consumer_gate_result: {
      issue_scope: state.issueScope,
      target_domain:
        state.upstreamAuthorizationRequest?.runtime_target?.domain ?? asString(input.targetDomain),
      target_tab_id:
        state.upstreamAuthorizationRequest?.runtime_target?.tab_id ?? asInteger(input.targetTabId),
      target_page:
        state.upstreamAuthorizationRequest?.runtime_target?.page ?? asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null
    },
    request_admission_result: requestAdmissionResult,
    approval_record: approvalRecord,
    execution_audit: null
  };
  if (
    state.issueScope === "issue_209" &&
    state.requestedExecutionMode &&
    XHS_LIVE_READ_EXECUTION_MODE_SET.has(state.requestedExecutionMode)
  ) {
    const postGateArtifacts = buildIssue209PostGateArtifacts({
      runId: asString(input.runId),
      sessionId: asString(input.sessionId),
      profile: asString(input.profile),
      gate: result,
      executionAuditRiskSignals,
      now: typeof input.now === "function" ? input.now : undefined
    });
    result.execution_audit = postGateArtifacts.execution_audit;
    const compatibilityRefs = asRecord(result.execution_audit?.compatibility_refs);
    const derivedFrom = asRecord(requestAdmissionResult?.derived_from);
    const explicitAdmissionContext = asRecord(result.gate_input?.admission_context);
    const explicitApprovalEvidence = asRecord(explicitAdmissionContext?.approval_admission_evidence);
    const explicitAuditEvidence = asRecord(explicitAdmissionContext?.audit_admission_evidence);
    const canBackfillApprovalAdmissionRef =
      asString(explicitApprovalEvidence?.approval_admission_ref) === null;
    const canBackfillAuditAdmissionRef =
      asString(explicitAuditEvidence?.audit_admission_ref) === null;
    const shouldBackfillCanonicalCompatibilityRefs =
      requestAdmissionResult?.admission_decision === "allowed" ||
      (requestAdmissionResult?.admission_decision === "blocked" &&
        requestAdmissionResult?.grant_match === true);
    if (compatibilityRefs && derivedFrom && shouldBackfillCanonicalCompatibilityRefs) {
      if (
        canBackfillApprovalAdmissionRef &&
        compatibilityRefs.approval_admission_ref === null &&
        typeof derivedFrom.approval_admission_ref === "string" &&
        derivedFrom.approval_admission_ref.length > 0
      ) {
        compatibilityRefs.approval_admission_ref = derivedFrom.approval_admission_ref;
      }
      if (
        canBackfillAuditAdmissionRef &&
        compatibilityRefs.audit_admission_ref === null &&
        typeof derivedFrom.audit_admission_ref === "string" &&
        derivedFrom.audit_admission_ref.length > 0
      ) {
        compatibilityRefs.audit_admission_ref = derivedFrom.audit_admission_ref;
      }
    }
  }
  return result;
};
return { XHS_ALLOWED_DOMAINS, XHS_READ_DOMAIN, XHS_WRITE_DOMAIN, buildIssue209PostGateArtifacts, evaluateXhsGate, resolveXhsGateDecisionId };
})();
const __webenvoy_module_xhs_search_types = (() => {
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";
const WEBENVOY_SYNTHETIC_REQUEST_HEADER = "x-webenvoy-synthetic-request";
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX = "__mw_ns__";
const hashMainWorldEventChannel = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const toTrimmedString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const normalizeSearchRequestShapeInput = (input) => {
    const keyword = toTrimmedString(input.keyword);
    const page = input.page === undefined ? 1 : asInteger(input.page);
    const pageSizeInput = input.page_size !== undefined ? input.page_size : input.limit !== undefined ? input.limit : 20;
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
const createSearchRequestShape = (input) => {
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
const serializeSearchRequestShape = (shape) => JSON.stringify(shape);
const createDetailRequestShape = (input) => {
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
const serializeDetailRequestShape = (shape) => JSON.stringify(shape);
const createUserHomeRequestShape = (input) => {
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
const serializeUserHomeRequestShape = (shape) => JSON.stringify(shape);
const resolveMainWorldPageContextNamespaceEventName = (secret) => `${MAIN_WORLD_PAGE_CONTEXT_NAMESPACE_EVENT_PREFIX}${hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|namespace|${secret.trim()}`)}`;
const createPageContextNamespace = (href) => {
    const normalized = href.trim();
    if (normalized.length === 0) {
        return "about:blank";
    }
    try {
        const parsed = new URL(normalized, "https://www.xiaohongshu.com/");
        const pathname = parsed.pathname.length > 0 ? parsed.pathname : "/";
        const queryIdentity = parsed.search.length > 0 ? `${pathname}${parsed.search}` : pathname;
        const documentTimeOrigin = typeof globalThis.performance?.timeOrigin === "number" &&
            Number.isFinite(globalThis.performance.timeOrigin)
            ? Math.trunc(globalThis.performance.timeOrigin)
            : null;
        return documentTimeOrigin === null
            ? `${parsed.origin}${queryIdentity}`
            : `${parsed.origin}${queryIdentity}#doc=${documentTimeOrigin}`;
    }
    catch {
        return normalized;
    }
};
const createVisitedPageContextNamespace = (href, visitSequence) => {
    const baseNamespace = createPageContextNamespace(href);
    return visitSequence > 0 ? `${baseNamespace}|visit=${visitSequence}` : baseNamespace;
};
const stripVisitedPageContextNamespace = (namespace) => {
    const visitSuffixIndex = namespace.indexOf("|visit=");
    return visitSuffixIndex >= 0 ? namespace.slice(0, visitSuffixIndex) : namespace;
};
const resolveActiveVisitedPageContextNamespace = (requestedNamespace, currentVisitedNamespace) => {
    const normalizedRequested = typeof requestedNamespace === "string" && requestedNamespace.length > 0
        ? requestedNamespace
        : null;
    const normalizedCurrentVisited = typeof currentVisitedNamespace === "string" && currentVisitedNamespace.length > 0
        ? currentVisitedNamespace
        : null;
    if (normalizedRequested &&
        normalizedCurrentVisited &&
        normalizedRequested === stripVisitedPageContextNamespace(normalizedCurrentVisited)) {
        return normalizedCurrentVisited;
    }
    return normalizedRequested ?? normalizedCurrentVisited;
};
return { DETAIL_ENDPOINT, SEARCH_ENDPOINT, USER_HOME_ENDPOINT, WEBENVOY_SYNTHETIC_REQUEST_HEADER, createPageContextNamespace, createDetailRequestShape, createSearchRequestShape, createUserHomeRequestShape, createVisitedPageContextNamespace, resolveActiveVisitedPageContextNamespace, resolveMainWorldPageContextNamespaceEventName, serializeSearchRequestShape };
})();
const __webenvoy_module_xhs_search_telemetry = (() => {
const { SEARCH_ENDPOINT } = __webenvoy_module_xhs_search_types;
const {
  buildUnifiedRiskStateOutput,
  resolveRiskState: resolveSharedRiskState
} = __webenvoy_module_risk_state;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asArray = (value) => (Array.isArray(value) ? value : null);
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const resolveRiskState = (value) => resolveSharedRiskState(value);
const SEARCH_FAILURE_SEMANTICS = {
    SIGNATURE_ENTRY_MISSING: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "window._webmsxyw",
        includeKeyRequest: false
    },
    REQUEST_CONTEXT_MISSING: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "captured_request_context",
        includeKeyRequest: false
    },
    REQUEST_CONTEXT_INCOMPATIBLE: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "captured_request_context",
        includeKeyRequest: false
    },
    XHS_LOGIN_REQUIRED: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "xhs.account_safety_surface",
        includeKeyRequest: false
    },
    XHS_ACCOUNT_RISK_PAGE: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "xhs.account_safety_surface",
        includeKeyRequest: false
    },
    SESSION_EXPIRED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    ACCOUNT_ABNORMAL: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    BROWSER_ENV_ABNORMAL: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    GATEWAY_INVOKER_FAILED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    },
    CAPTCHA_REQUIRED: {
        category: "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    }
};
const PAGE_SURFACE_ACCOUNT_SAFETY_REASONS = new Set([
    "XHS_LOGIN_REQUIRED",
    "ACCOUNT_ABNORMAL",
    "XHS_ACCOUNT_RISK_PAGE",
    "CAPTCHA_REQUIRED",
    "BROWSER_ENV_ABNORMAL"
]);
const extractUrlPath = (href) => {
    try {
        return new URL(href).pathname.toLowerCase();
    }
    catch {
        return href.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
    }
};
const classifyPageKind = (href) => {
    const path = extractUrlPath(href);
    if (path.includes("/login")) {
        return "login";
    }
    if (href.includes("creator.xiaohongshu.com/publish")) {
        return "compose";
    }
    if (path.includes("/search_result")) {
        return "search";
    }
    if (path.includes("/explore/")) {
        return "detail";
    }
    return "unknown";
};
const normalizeSurfaceText = (value) => (value ?? "").replace(/\s+/gu, "");
const hasSpecificOverlaySelector = (selector) => typeof selector === "string" &&
    selector.length > 0 &&
    selector !== '[role="dialog"]' &&
    selector !== '[aria-modal="true"]';
const hasXhsAccountSafetyOverlaySignal = (value) => {
    const overlayText = normalizeSurfaceText(value);
    return ((overlayText.includes("请完成验证") &&
        (overlayText.includes("滑块") ||
            overlayText.includes("验证码") ||
            overlayText.includes("人机验证"))) ||
        (overlayText.includes("当前访问存在安全风险") &&
            (overlayText.includes("验证后继续访问") || overlayText.includes("继续访问"))) ||
        (overlayText.includes("登录后推荐更懂你的笔记") &&
            overlayText.includes("扫码") &&
            overlayText.includes("输入手机号")) ||
        overlayText.includes("账号异常") ||
        overlayText.includes("浏览器环境异常") ||
        overlayText.toLowerCase().includes("browserenvironmentabnormal"));
};
const classifyXhsAccountSafetySurface = (input) => {
    const path = extractUrlPath(input.href);
    const overlayText = hasSpecificOverlaySelector(input.overlay?.selector)
        ? normalizeSurfaceText(input.overlay?.text)
        : "";
    if (path.includes("captcha")) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    if (overlayText.includes("请完成验证") &&
        (overlayText.includes("滑块") || overlayText.includes("验证码") || overlayText.includes("人机验证"))) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    if (path.includes("/security") ||
        path.includes("/risk")) {
        return {
            reason: "XHS_ACCOUNT_RISK_PAGE",
            message: "当前页面命中小红书账号风险或安全验证页面"
        };
    }
    if (overlayText.includes("当前访问存在安全风险") &&
        (overlayText.includes("验证后继续访问") || overlayText.includes("继续访问"))) {
        return {
            reason: "XHS_ACCOUNT_RISK_PAGE",
            message: "当前页面命中小红书账号风险或安全验证页面"
        };
    }
    if (path.includes("/login")) {
        return {
            reason: "XHS_LOGIN_REQUIRED",
            message: "当前页面要求登录小红书，无法继续执行"
        };
    }
    if (overlayText.includes("登录后推荐更懂你的笔记") &&
        overlayText.includes("扫码") &&
        overlayText.includes("输入手机号")) {
        return {
            reason: "XHS_LOGIN_REQUIRED",
            message: "当前页面要求登录小红书，无法继续执行"
        };
    }
    if (overlayText.includes("账号异常")) {
        return {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求"
        };
    }
    if (overlayText.includes("浏览器环境异常") ||
        overlayText.toLowerCase().includes("browserenvironmentabnormal")) {
        return {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求"
        };
    }
    return null;
};
const resolveDiagnosisSemantics = (reason, fallbackCategory) => {
    if (fallbackCategory === "page_changed" && PAGE_SURFACE_ACCOUNT_SAFETY_REASONS.has(reason)) {
        return {
            category: "page_changed",
            stage: "action",
            component: "page",
            target: "xhs.account_safety_surface",
            includeKeyRequest: false
        };
    }
    return SEARCH_FAILURE_SEMANTICS[reason] ?? {
        category: fallbackCategory ?? "request_failed",
        stage: "request",
        component: "network",
        target: SEARCH_ENDPOINT,
        includeKeyRequest: true
    };
};
const createObservability = (input) => ({
    page_state: {
        page_kind: classifyPageKind(input.href),
        url: input.href,
        title: input.title,
        ready_state: input.readyState
    },
    key_requests: input.includeKeyRequest === false
        ? []
        : [
            {
                request_id: input.requestId,
                stage: "request",
                method: "POST",
                url: SEARCH_ENDPOINT,
                outcome: input.outcome,
                ...(typeof input.statusCode === "number" ? { status_code: input.statusCode } : {}),
                ...(input.failureReason ? { failure_reason: input.failureReason, request_class: "xhs.search" } : {})
            }
        ],
    failure_site: input.outcome === "failed"
        ? (input.failureSite ?? {
            stage: "request",
            component: "network",
            target: SEARCH_ENDPOINT,
            summary: input.failureReason ?? "request failed"
        })
        : null
});
const createDiagnosis = (input) => {
    const semantics = resolveDiagnosisSemantics(input.reason, input.category);
    return {
        category: semantics.category,
        stage: semantics.stage,
        component: semantics.component,
        failure_site: {
            stage: semantics.stage,
            component: semantics.component,
            target: semantics.target,
            summary: input.summary
        },
        evidence: [input.reason, input.summary]
    };
};
const createFailure = (code, message, details, observability, diagnosis, gate, auditRecord) => ({
    ok: false,
    error: {
        code,
        message
    },
    payload: {
        details,
        observability,
        diagnosis,
        ...(gate
            ? {
                scope_context: gate.scope_context,
                gate_input: {
                    run_id: auditRecord?.run_id ?? "unknown",
                    session_id: auditRecord?.session_id ?? "unknown",
                    profile: auditRecord?.profile ?? "unknown",
                    ...gate.gate_input
                },
                gate_outcome: gate.gate_outcome,
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                write_interaction_tier: gate.write_interaction_tier,
                write_action_matrix_decisions: gate.write_action_matrix_decisions,
                consumer_gate_result: gate.consumer_gate_result,
                request_admission_result: gate.request_admission_result,
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                ...(auditRecord ? { audit_record: auditRecord } : {})
            }
            : {})
    }
});
const resolveRiskStateOutput = (gate, auditRecord) => buildUnifiedRiskStateOutput(resolveRiskState(auditRecord?.next_state ?? gate.gate_input.risk_state), {
    auditRecords: auditRecord ? [auditRecord] : [],
    now: auditRecord?.recorded_at ?? Date.now()
});
const buildEditorInputEvidence = (result) => ({
    validation_action: "editor_input",
    target_page: "creator.xiaohongshu.com/publish",
    validation_mode: result.mode,
    validation_attestation: result.attestation,
    editor_locator: result.editor_locator,
    input_text: result.input_text,
    before_text: result.before_text,
    visible_text: result.visible_text,
    post_blur_text: result.post_blur_text,
    focus_confirmed: result.focus_confirmed,
    focus_attestation_source: result.focus_attestation_source,
    focus_attestation_reason: result.focus_attestation_reason,
    preserved_after_blur: result.preserved_after_blur,
    success_signals: result.success_signals,
    failure_signals: result.failure_signals,
    minimum_replay: result.minimum_replay,
    out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
});
const isTrustedEditorInputValidation = (result) => result.ok &&
    result.mode === "controlled_editor_input_validation" &&
    result.attestation === "controlled_real_interaction";
const resolveSimulatedResult = (simulated, params, options, env) => {
    if (!simulated) {
        return null;
    }
    const requestId = `req-${env.randomId()}`;
    if (simulated === "success") {
        const observability = createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId,
            outcome: "completed"
        });
        return {
            ok: true,
            payload: {
                summary: {
                    capability_result: {
                        ability_id: "xhs.note.search.v1",
                        layer: "L3",
                        action: "read",
                        outcome: "success",
                        data_ref: {
                            query: params.query,
                            search_id: params.search_id ?? "simulated-search-id"
                        },
                        metrics: {
                            count: Number(options.timeout_ms ?? 2) > 0 ? 2 : 2
                        }
                    }
                },
                observability
            }
        };
    }
    const reasonMap = {
        login_required: {
            reason: "SESSION_EXPIRED",
            message: "登录态缺失，无法执行 xhs.search"
        },
        signature_entry_missing: {
            reason: "SIGNATURE_ENTRY_MISSING",
            message: "页面签名入口不可用"
        },
        account_abnormal: {
            reason: "ACCOUNT_ABNORMAL",
            message: "账号异常，平台拒绝当前请求"
        },
        browser_env_abnormal: {
            reason: "BROWSER_ENV_ABNORMAL",
            message: "浏览器环境异常，平台拒绝当前请求"
        },
        captcha_required: {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        },
        generic_api_warning: {
            reason: "TARGET_API_RESPONSE_INVALID",
            message: "搜索接口返回了未识别的失败响应"
        },
        gateway_invoker_failed: {
            reason: "GATEWAY_INVOKER_FAILED",
            message: "网关调用失败，当前上下文不足以完成搜索请求"
        }
    };
    const mapped = reasonMap[simulated] ?? reasonMap.gateway_invoker_failed;
    const semantics = resolveDiagnosisSemantics(mapped.reason);
    const observability = createObservability({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId,
        outcome: "failed",
        statusCode: simulated === "account_abnormal"
            ? 461
            : simulated === "browser_env_abnormal"
                ? 200
                : simulated === "captcha_required"
                    ? 429
                    : simulated === "generic_api_warning"
                        ? 400
                        : simulated === "gateway_invoker_failed"
                            ? 500
                            : undefined,
        failureReason: simulated,
        includeKeyRequest: semantics.includeKeyRequest,
        failureSite: {
            stage: semantics.stage,
            component: semantics.component,
            target: semantics.target,
            summary: mapped.message
        }
    });
    return createFailure("ERR_EXECUTION_FAILED", mapped.message, {
        stage: "execution",
        reason: mapped.reason
    }, observability, createDiagnosis({
        reason: mapped.reason,
        summary: mapped.message
    }));
};
const parseCount = (body) => {
    const record = asRecord(body);
    if (!record) {
        return 0;
    }
    const data = asRecord(record.data);
    const candidateArrays = [
        asArray(record.items),
        asArray(record.notes),
        data ? asArray(data.items) : null,
        data ? asArray(data.notes) : null
    ];
    for (const candidate of candidateArrays) {
        if (candidate) {
            return candidate.length;
        }
    }
    const total = data?.total;
    return typeof total === "number" && Number.isFinite(total) ? total : 0;
};
const inferFailure = (status, body) => {
    const record = asRecord(body);
    const businessCode = asInteger(record?.code);
    const message = typeof record?.msg === "string" ? record.msg : typeof record?.message === "string" ? record.message : "";
    const normalized = `${message}`.toLowerCase();
    const hasCaptchaEvidence = normalized.includes("captcha") ||
        message.includes("验证码") ||
        message.includes("人机验证") ||
        message.includes("滑块");
    if (status === 401 || normalized.includes("login")) {
        return {
            reason: "SESSION_EXPIRED",
            message: "登录已失效，无法执行 xhs.search"
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
            message: "网关调用失败，当前上下文不足以完成搜索请求"
        };
    }
    if (hasCaptchaEvidence) {
        return {
            reason: "CAPTCHA_REQUIRED",
            message: "平台要求额外人机验证，无法继续执行"
        };
    }
    return {
        reason: "TARGET_API_RESPONSE_INVALID",
        message: "搜索接口返回了未识别的失败响应"
    };
};
const inferRequestException = (error) => {
    const errorName = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
        : "";
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorName === "AbortError") {
        return {
            reason: "REQUEST_TIMEOUT",
            message: "请求超时，无法完成 xhs.search",
            detail: errorMessage
        };
    }
    return {
        reason: "REQUEST_DISPATCH_FAILED",
        message: "搜索请求发送失败，无法完成 xhs.search",
        detail: errorMessage
    };
};
const resolveXsCommon = (value) => {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return "{}";
};
const containsCookie = (cookie, key) => cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${key}=`));
return { buildEditorInputEvidence, classifyXhsAccountSafetySurface, containsCookie, createDiagnosis, createFailure, createObservability, hasXhsAccountSafetyOverlaySignal, inferFailure, inferRequestException, isTrustedEditorInputValidation, parseCount, resolveSimulatedResult, resolveRiskStateOutput, resolveXsCommon };
})();
const __webenvoy_module_xhs_search_gate = (() => {
const {
  buildRiskTransitionAudit,
  resolveIssueScope: resolveSharedIssueScope,
  resolveRiskState: resolveSharedRiskState
} = __webenvoy_module_risk_state;
const {
  evaluateXhsGate,
  resolveXhsGateDecisionId,
  XHS_READ_DOMAIN,
  XHS_WRITE_DOMAIN,
  buildIssue209PostGateArtifacts
} = __webenvoy_module_shared_xhs_gate;
const { resolveRiskStateOutput } = __webenvoy_module_xhs_search_telemetry;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asOptionalBoolean = (value) => typeof value === "boolean" ? value : null;
const resolveRiskState = (value) => resolveSharedRiskState(value);
const resolveIssueScope = (value) => resolveSharedIssueScope(value);
const isIssue208EditorInputValidation = (options) => options.issue_scope === "issue_208" &&
    options.action_type === "write" &&
    options.requested_execution_mode === "live_write" &&
    options.validation_action === "editor_input";
const shouldDeferAnonymousCanonicalGateDiagnostics = (input) => {
    const resourceBinding = asRecord(input.upstreamAuthorizationRequest?.resource_binding);
    return (resourceBinding?.resource_kind === "anonymous_context" &&
        (input.anonymousIsolationVerified === null || input.targetSiteLoggedIn === null));
};
const buildGateDecisionId = (context, options) => resolveXhsGateDecisionId({
    runId: context.runId,
    requestId: context.requestId,
    commandRequestId: context.commandRequestId,
    gateInvocationId: context.gateInvocationId,
    issueScope: options.issue_scope,
    requestedExecutionMode: options.requested_execution_mode
});
const buildGateEventId = (decisionId) => `gate_evt_${decisionId}`;
const resolveActualTargetGateReasons = (options) => {
    const gateReasons = [];
    const targetDomain = asNonEmptyString(options.target_domain);
    const targetTabId = asInteger(options.target_tab_id);
    const targetPage = asNonEmptyString(options.target_page);
    const actualTargetDomain = asNonEmptyString(options.actual_target_domain);
    const actualTargetTabId = asInteger(options.actual_target_tab_id);
    const actualTargetPage = asNonEmptyString(options.actual_target_page);
    if (actualTargetDomain && targetDomain && actualTargetDomain !== targetDomain) {
        gateReasons.push("TARGET_DOMAIN_CONTEXT_MISMATCH");
    }
    if (actualTargetTabId !== null && targetTabId !== null && actualTargetTabId !== targetTabId) {
        gateReasons.push("TARGET_TAB_CONTEXT_MISMATCH");
    }
    if (targetPage && !actualTargetPage) {
        gateReasons.push("TARGET_PAGE_CONTEXT_UNRESOLVED");
    }
    if (actualTargetPage && targetPage && actualTargetPage !== targetPage) {
        gateReasons.push("TARGET_PAGE_CONTEXT_MISMATCH");
    }
    return gateReasons;
};
const resolveGate = (options, context, actualTargetUrl) => {
    const providedApprovalRecord = (options.approval_record ?? options.approval);
    const approvalRecord = asRecord(providedApprovalRecord);
    const decisionId = buildGateDecisionId(context, options);
    const approvalId = asNonEmptyString(approvalRecord?.approval_id) ?? undefined;
    const anonymousIsolationVerified = asOptionalBoolean(options.__anonymous_isolation_verified);
    const targetSiteLoggedIn = asOptionalBoolean(options.target_site_logged_in);
    const gate = evaluateXhsGate({
        issueScope: options.issue_scope,
        riskState: options.risk_state,
        targetDomain: options.target_domain,
        targetTabId: options.target_tab_id,
        targetPage: options.target_page,
        actualTargetDomain: options.actual_target_domain,
        actualTargetTabId: options.actual_target_tab_id,
        actualTargetPage: options.actual_target_page,
        actualTargetUrl,
        requireActualTargetPage: true,
        actionType: options.action_type,
        abilityAction: options.ability_action,
        requestedExecutionMode: options.requested_execution_mode,
        legacyRequestedExecutionMode: options.__legacy_requested_execution_mode,
        runtimeProfileRef: options.__runtime_profile_ref ?? context.profile,
        sessionRhythmWindowId: options.__session_rhythm_window_id,
        sessionRhythmDecisionId: options.__session_rhythm_decision_id,
        upstreamAuthorizationRequest: options.upstream_authorization_request,
        ...(anonymousIsolationVerified !== null ? { anonymousIsolationVerified } : {}),
        ...(targetSiteLoggedIn !== null ? { targetSiteLoggedIn } : {}),
        runId: context.runId,
        sessionId: context.sessionId,
        requestId: context.requestId,
        commandRequestId: context.commandRequestId,
        gateInvocationId: context.gateInvocationId,
        approvalRecord: providedApprovalRecord,
        auditRecord: options.audit_record,
        admissionContext: options.admission_context,
        limitedReadRolloutReadyTrue: options.limited_read_rollout_ready_true === true,
        decisionId,
        approvalId,
        issue208EditorInputValidation: isIssue208EditorInputValidation(options),
        treatMissingEditorValidationAsUnsupported: true
    });
    if (shouldDeferAnonymousCanonicalGateDiagnostics({
        upstreamAuthorizationRequest: options.upstream_authorization_request,
        anonymousIsolationVerified,
        targetSiteLoggedIn
    })) {
        return {
            ...gate,
            request_admission_result: null,
            execution_audit: null
        };
    }
    return gate;
};
const createAuditRecord = (context, gate, env) => {
    if (gate.gate_input.issue_scope === "issue_209" &&
        (gate.consumer_gate_result.requested_execution_mode === "live_read_limited" ||
            gate.consumer_gate_result.requested_execution_mode === "live_read_high_risk")) {
        const artifacts = buildIssue209PostGateArtifacts({
            runId: context.runId,
            sessionId: context.sessionId,
            profile: context.profile,
            gate: gate,
            now: () => env.now()
        });
        gate.approval_record = artifacts.approval_record;
        return artifacts.audit_record;
    }
    const recordedAt = new Date(env.now()).toISOString();
    const requestedMode = gate.consumer_gate_result.requested_execution_mode;
    const liveModeRequested = requestedMode === "live_read_limited" ||
        requestedMode === "live_read_high_risk" ||
        requestedMode === "live_write";
    const riskSignal = gate.consumer_gate_result.gate_decision === "blocked" && liveModeRequested;
    const recoverySignal = gate.consumer_gate_result.gate_decision === "allowed" &&
        gate.gate_input.risk_state === "limited" &&
        liveModeRequested;
    const auditRecord = {
        event_id: buildGateEventId(gate.gate_outcome.decision_id),
        decision_id: gate.gate_outcome.decision_id,
        approval_id: gate.approval_record.approval_id,
        run_id: context.runId,
        session_id: context.sessionId,
        profile: context.profile,
        issue_scope: gate.gate_input.issue_scope,
        risk_state: gate.gate_input.risk_state,
        target_domain: gate.consumer_gate_result.target_domain,
        target_tab_id: gate.consumer_gate_result.target_tab_id,
        target_page: gate.consumer_gate_result.target_page,
        action_type: gate.consumer_gate_result.action_type,
        requested_execution_mode: requestedMode,
        effective_execution_mode: gate.consumer_gate_result.effective_execution_mode,
        gate_decision: gate.consumer_gate_result.gate_decision,
        gate_reasons: [...gate.consumer_gate_result.gate_reasons],
        approver: gate.approval_record.approver,
        approved_at: gate.approval_record.approved_at,
        write_interaction_tier: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
        write_action_matrix_decisions: gate.write_action_matrix_decisions,
        risk_signal: riskSignal,
        recovery_signal: recoverySignal,
        session_rhythm_state: riskSignal ? "cooldown" : recoverySignal ? "recovery" : "normal",
        cooldown_until: riskSignal ? new Date(env.now() + 30 * 60_000).toISOString() : null,
        recovery_started_at: recoverySignal ? recordedAt : null,
        recorded_at: recordedAt
    };
    const transitionAudit = buildRiskTransitionAudit({
        runId: context.runId,
        sessionId: context.sessionId,
        issueScope: gate.gate_input.issue_scope,
        prevState: gate.gate_input.risk_state,
        decision: gate.consumer_gate_result.gate_decision,
        gateReasons: [...gate.consumer_gate_result.gate_reasons],
        requestedExecutionMode: gate.consumer_gate_result.requested_execution_mode,
        approvalRecord: gate.approval_record,
        auditRecords: [auditRecord],
        now: recordedAt
    });
    auditRecord.next_state = transitionAudit.next_state;
    auditRecord.transition_trigger = transitionAudit.trigger;
    return auditRecord;
};
const createGateOnlySuccess = (input, gate, auditRecord, env) => ({
    ok: true,
    payload: {
        summary: {
            capability_result: {
                ability_id: input.abilityId,
                layer: input.abilityLayer,
                action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                outcome: "partial",
                data_ref: {
                    query: input.params.query
                },
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
                page_kind: env.getLocationHref().includes("/login")
                    ? "login"
                    : env.getLocationHref().includes("creator.xiaohongshu.com/publish")
                        ? "compose"
                        : env.getLocationHref().includes("/search_result")
                            ? "search"
                            : env.getLocationHref().includes("/explore/")
                                ? "detail"
                                : "unknown",
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: null
        }
    }
});
return { createAuditRecord, createGateOnlySuccess, resolveGate };
})();
const __webenvoy_module_layer2_humanized_events = (() => {
const DEFAULT_RHYTHM_PROFILE = {
    profile_name: "default_layer2",
    hover_confirm_min_ms: 80,
    hover_confirm_max_ms: 200,
    click_jitter_min_px: 2,
    click_jitter_max_px: 8,
    typing_delay_min_ms: 60,
    typing_delay_max_ms: 220,
    punctuation_pause_multiplier: 1.8,
    long_pause_probability: 0.08,
    scroll_segment_min_px: 120,
    scroll_segment_max_px: 480,
    lookback_probability: 0.12
};
const STRATEGY_PROFILES = {
    click: {
        action_kind: "click",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: true,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    focus: {
        action_kind: "focus",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    keyboard_input: {
        action_kind: "keyboard_input",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    composition_input: {
        action_kind: "composition_input",
        preferred_path: "mixed_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    hover: {
        action_kind: "hover",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: true,
        requires_settled_wait: false,
        blocked_when_tier: []
    },
    scroll: {
        action_kind: "scroll",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: []
    }
};
const EVENT_CHAINS = {
    click: {
        chain_name: "hover_click",
        action_kind: "click",
        required_events: ["mousemove", "mouseover", "mousedown", "mouseup", "click"],
        optional_events: ["pointermove", "pointerdown", "pointerup"],
        completion_signal: ["dom_settled"],
        requires_settled_wait: true
    },
    focus: {
        chain_name: "focus_acquire",
        action_kind: "focus",
        required_events: ["focus"],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["document_active_element_matched"],
        requires_settled_wait: true
    },
    keyboard_input: {
        chain_name: "keyboard_input",
        action_kind: "keyboard_input",
        required_events: ["focus", "keydown", "input", "keyup", "change", "blur"],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["dom_settled", "framework_value_updated"],
        requires_settled_wait: true
    },
    composition_input: {
        chain_name: "composition_input",
        action_kind: "composition_input",
        required_events: [
            "focus",
            "compositionstart",
            "compositionupdate",
            "compositionend",
            "input",
            "change",
            "blur"
        ],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["dom_settled", "framework_value_updated"],
        requires_settled_wait: true
    },
    hover: {
        chain_name: "hover_confirm",
        action_kind: "hover",
        required_events: ["mousemove", "mouseover"],
        optional_events: ["pointermove"],
        completion_signal: ["hover_confirmed"],
        requires_settled_wait: false
    },
    scroll: {
        chain_name: "scroll_segment",
        action_kind: "scroll",
        required_events: ["wheel", "scroll"],
        optional_events: ["mousemove"],
        completion_signal: ["viewport_position_changed", "dom_settled"],
        requires_settled_wait: true
    }
};
const CHANGE_BLUR_FINALIZE_CHAIN = {
    chain_name: "change_blur_finalize",
    action_kind: "keyboard_input",
    required_events: ["change", "blur"],
    optional_events: ["input"],
    completion_signal: ["framework_value_finalized", "dom_settled"],
    requires_settled_wait: true
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const getLayer2EventChainPolicies = () => [
    ...Object.values(EVENT_CHAINS).map((chain) => clone(chain)),
    clone(CHANGE_BLUR_FINALIZE_CHAIN)
];
const buildLayer2InteractionEvidence = (input) => {
    const strategy = clone(STRATEGY_PROFILES[input.actionKind]);
    const chain = clone(EVENT_CHAINS[input.actionKind]);
    const rhythm = clone(DEFAULT_RHYTHM_PROFILE);
    const gateOnlyBlockedBy = input.executionApplied === false ? "FR-0013.gate_only_probe_no_event_chain" : null;
    const tierBlockedBy = input.writeInteractionTierName &&
        strategy.blocked_when_tier.includes(input.writeInteractionTierName)
        ? "FR-0011.write_interaction_tier"
        : null;
    const blockedBy = gateOnlyBlockedBy ?? tierBlockedBy;
    const selectedPath = blockedBy ? "blocked" : strategy.preferred_path;
    const settledWaitApplied = selectedPath !== "blocked" && chain.requires_settled_wait;
    const settledWaitResult = selectedPath === "blocked"
        ? "skipped"
        : settledWaitApplied
            ? input.settledWaitResult ?? "timeout"
            : "skipped";
    return {
        event_strategy_profile: strategy,
        event_chain_policy: chain,
        rhythm_profile: rhythm,
        strategy_selection: {
            action_kind: input.actionKind,
            selected_path: selectedPath,
            strategy_profile: `${input.actionKind}_default`,
            event_chain: chain.chain_name,
            rhythm_profile: rhythm.profile_name,
            fallback_reason: null,
            blocked_by: blockedBy
        },
        execution_trace: {
            action_kind: input.actionKind,
            selected_path: selectedPath,
            event_chain: chain.chain_name,
            rhythm_profile_source: input.rhythmProfileSource ?? "default",
            settled_wait_applied: settledWaitApplied,
            settled_wait_result: settledWaitResult,
            failure_category: tierBlockedBy ? "blocked_by_fr0011" : null
        }
    };
};
const buildXhsSearchLayer2InteractionEvidence = (input) => {
    if (!input.recoveryProbe || input.requestedExecutionMode !== "recon") {
        return null;
    }
    return buildLayer2InteractionEvidence({
        actionKind: "scroll",
        writeInteractionTierName: input.writeInteractionTierName ?? null,
        executionApplied: input.executionApplied ?? false
    });
};
return { buildLayer2InteractionEvidence, buildXhsSearchLayer2InteractionEvidence, getLayer2EventChainPolicies };
})();
const __webenvoy_module_xhs_search_execution = (() => {
const {
  SEARCH_ENDPOINT,
  createPageContextNamespace,
  createSearchRequestShape,
  serializeSearchRequestShape
} = __webenvoy_module_xhs_search_types;
const {
  createAuditRecord,
  createGateOnlySuccess,
  resolveGate
} = __webenvoy_module_xhs_search_gate;
const {
  buildEditorInputEvidence,
  classifyXhsAccountSafetySurface,
  containsCookie,
  createDiagnosis,
  createFailure,
  createObservability,
  inferFailure,
  inferRequestException,
  isTrustedEditorInputValidation,
  parseCount,
  resolveSimulatedResult,
  resolveRiskStateOutput,
  resolveXsCommon
} = __webenvoy_module_xhs_search_telemetry;
const {
  buildXhsSearchLayer2InteractionEvidence
} = __webenvoy_module_layer2_humanized_events;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60 * 1000;
const REQUEST_CONTEXT_WAIT_MAX_MS = 15_000;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 250;
const REQUEST_CONTEXT_FORWARD_DEADLINE_SAFETY_MS = 1_000;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const toIsoString = (value) => new Date(value).toISOString();
const normalizeSearchQueryText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
};
const isCurrentSearchPageForQuery = (href, query) => {
    const expectedQuery = normalizeSearchQueryText(query);
    if (!expectedQuery) {
        return false;
    }
    try {
        const url = new URL(href);
        if (url.hostname !== "www.xiaohongshu.com" || !url.pathname.includes("/search_result")) {
            return false;
        }
        return normalizeSearchQueryText(url.searchParams.get("keyword")) === expectedQuery;
    }
    catch {
        return false;
    }
};
const pickFirstString = (record, keys) => {
    for (const key of keys) {
        const value = asString(record[key]);
        if (value) {
            return value;
        }
    }
    return null;
};
const normalizeXhsUrl = (value) => {
    if (!value) {
        return null;
    }
    try {
        return new URL(value, "https://www.xiaohongshu.com").toString();
    }
    catch {
        return value;
    }
};
const isXhsNoteCardUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return (url.hostname === "www.xiaohongshu.com" &&
            (url.pathname.startsWith("/explore/") || url.pathname.startsWith("/discovery/item/")));
    }
    catch {
        return false;
    }
};
const isXhsUserProfileUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/user/profile/");
    }
    catch {
        return false;
    }
};
const parseXsecFromUrl = (value) => {
    if (!value) {
        return {
            xsec_token: null,
            xsec_source: null
        };
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return {
            xsec_token: asString(url.searchParams.get("xsec_token")),
            xsec_source: asString(url.searchParams.get("xsec_source"))
        };
    }
    catch {
        return {
            xsec_token: null,
            xsec_source: null
        };
    }
};
const buildXhsContinuityUrl = (input) => {
    if (!input.id || !input.xsecToken) {
        return null;
    }
    const path = input.kind === "note"
        ? `/explore/${encodeURIComponent(input.id)}`
        : `/user/profile/${encodeURIComponent(input.id)}`;
    const url = new URL(path, "https://www.xiaohongshu.com");
    url.searchParams.set("xsec_token", input.xsecToken);
    if (input.xsecSource) {
        url.searchParams.set("xsec_source", input.xsecSource);
    }
    return url.toString();
};
const collectSearchDomCards = (value, seen = new Set()) => {
    const record = asRecord(value);
    if (record) {
        if (seen.has(record)) {
            return [];
        }
        seen.add(record);
        const userRecord = asRecord(record.user) ?? asRecord(record.author);
        const noteCardRecord = asRecord(record.note_card) ?? asRecord(record.noteCard);
        const hasKnownSearchCardShape = noteCardRecord !== null ||
            "display_title" in record ||
            "displayTitle" in record ||
            "interact_info" in record ||
            "cover" in record ||
            "image_list" in record ||
            "video_info" in record;
        const noteCardUserRecord = asRecord(noteCardRecord?.user) ?? asRecord(noteCardRecord?.author) ?? null;
        const noteId = pickFirstString(record, ["note_id", "noteId", "id"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["note_id", "noteId", "id"]) : null);
        const userId = pickFirstString(record, ["user_id", "userId"]) ??
            (userRecord ? pickFirstString(userRecord, ["user_id", "userId", "id"]) : null) ??
            (noteCardUserRecord ? pickFirstString(noteCardUserRecord, ["user_id", "userId", "id"]) : null);
        const rawDetailUrl = normalizeXhsUrl(pickFirstString(record, ["detail_url", "detailUrl", "note_url", "noteUrl", "href", "url", "link"]) ??
            (noteCardRecord
                ? pickFirstString(noteCardRecord, ["detail_url", "detailUrl", "note_url", "noteUrl", "href", "url", "link"])
                : null));
        const rawUserHomeUrl = normalizeXhsUrl(pickFirstString(record, ["user_home_url", "userHomeUrl", "author_url", "authorUrl", "user_url", "userUrl"]) ??
            (userRecord ? pickFirstString(userRecord, ["user_home_url", "userHomeUrl", "url", "link"]) : null) ??
            (noteCardUserRecord
                ? pickFirstString(noteCardUserRecord, ["user_home_url", "userHomeUrl", "url", "link"])
                : null));
        const parsedDetail = parseXsecFromUrl(rawDetailUrl);
        const parsedUser = parseXsecFromUrl(rawUserHomeUrl);
        const xsecToken = pickFirstString(record, ["xsec_token", "xsecToken"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["xsec_token", "xsecToken"]) : null) ??
            parsedDetail.xsec_token ??
            parsedUser.xsec_token;
        const xsecSource = pickFirstString(record, ["xsec_source", "xsecSource"]) ??
            (noteCardRecord ? pickFirstString(noteCardRecord, ["xsec_source", "xsecSource"]) : null) ??
            parsedDetail.xsec_source ??
            parsedUser.xsec_source;
        const detailUrl = isXhsNoteCardUrl(rawDetailUrl)
            ? rawDetailUrl
            : hasKnownSearchCardShape
                ? buildXhsContinuityUrl({
                    kind: "note",
                    id: noteId,
                    xsecToken,
                    xsecSource
                })
                : null;
        const userHomeUrl = isXhsUserProfileUrl(rawUserHomeUrl)
            ? rawUserHomeUrl
            : hasKnownSearchCardShape
                ? buildXhsContinuityUrl({
                    kind: "user",
                    id: userId,
                    xsecToken,
                    xsecSource
                })
                : null;
        const card = {
            title: pickFirstString(record, ["title", "display_title", "displayTitle", "desc"]) ??
                (noteCardRecord ? pickFirstString(noteCardRecord, ["title", "display_title", "displayTitle"]) : null),
            note_id: noteId,
            user_id: userId,
            detail_url: detailUrl,
            user_home_url: userHomeUrl,
            xsec_token: xsecToken,
            xsec_source: xsecSource
        };
        const hasCardSignal = card.detail_url !== null || card.user_home_url !== null;
        return [
            ...(hasCardSignal ? [card] : []),
            ...Object.values(record).flatMap((entry) => collectSearchDomCards(entry, seen))
        ];
    }
    if (Array.isArray(value)) {
        return value.flatMap((entry) => collectSearchDomCards(entry, seen));
    }
    return [];
};
const resolveSearchDomExtraction = async (env) => {
    const state = (typeof env.readPageStateRoot === "function" ? await env.readPageStateRoot().catch(() => null) : null) ??
        (typeof env.getPageStateRoot === "function" ? env.getPageStateRoot() : null);
    const stateCards = collectSearchDomCards(state);
    if (stateCards.length > 0) {
        return {
            extraction_layer: "hydration_state",
            extraction_locator: "window.__INITIAL_STATE__",
            cards: stateCards
        };
    }
    const domState = typeof env.readSearchDomState === "function" ? await env.readSearchDomState().catch(() => null) : null;
    const domStateRecord = asRecord(domState);
    const domCards = collectSearchDomCards(domStateRecord?.cards ?? domState);
    if (domCards.length > 0) {
        return {
            extraction_layer: domStateRecord?.extraction_layer === "script_json" ? "script_json" : "dom_selector",
            extraction_locator: asString(domStateRecord?.extraction_locator) ??
                (domStateRecord?.extraction_layer === "script_json"
                    ? "script[type='application/json']"
                    : ".search-result-container"),
            cards: domCards
        };
    }
    return null;
};
const buildSearchTargetContinuity = (cards) => cards.map((card) => ({
    target_url: card.detail_url ?? card.user_home_url,
    note_id: card.note_id,
    user_id: card.user_id,
    detail_url: card.detail_url,
    user_home_url: card.user_home_url,
    xsec_token: card.xsec_token,
    xsec_source: card.xsec_source,
    token_presence: card.xsec_token && card.xsec_token.trim().length > 0
        ? "present"
        : card.xsec_token === ""
            ? "empty"
            : "missing",
    source_route: "xhs.search"
}));
const performSearchPassiveAction = async (input, env) => {
    if (typeof env.performSearchPassiveAction !== "function") {
        return null;
    }
    try {
        return asRecord(await env.performSearchPassiveAction({
            query: input.params.query,
            pageUrl: env.getLocationHref(),
            runId: input.executionContext.runId,
            actionRef: input.executionContext.gateInvocationId ?? input.executionContext.runId
        }));
    }
    catch {
        return null;
    }
};
const withExecutionAuditInFailurePayload = (result, executionAudit) => {
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
const withLayer2InteractionInSuccessPayload = (result, layer2Interaction) => {
    if (!result.ok || !layer2Interaction) {
        return result;
    }
    const summary = asRecord(result.payload.summary);
    if (!summary) {
        return result;
    }
    return {
        ...result,
        payload: {
            ...result.payload,
            summary: {
                ...summary,
                layer2_interaction: layer2Interaction
            }
        }
    };
};
const withLayer2InteractionInPayload = (result, layer2Interaction) => {
    if (!layer2Interaction) {
        return result;
    }
    return {
        ...result,
        payload: {
            ...result.payload,
            layer2_interaction: layer2Interaction
        }
    };
};
const serializeCanonicalShape = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const shape = createSearchRequestShape({
        keyword: record.keyword,
        page: record.page,
        page_size: record.page_size,
        limit: record.limit,
        sort: record.sort,
        note_type: record.note_type
    });
    return shape ? serializeSearchRequestShape(shape) : null;
};
const layer2InteractionSummary = (layer2Interaction) => layer2Interaction ? { layer2_interaction: layer2Interaction } : {};
const XHS_SEARCH_REPLAY_ORIGIN_ALLOWLIST = new Set([
    "https://www.xiaohongshu.com",
    "https://edith.xiaohongshu.com"
]);
const resolveTrustedSearchTemplateUrl = (value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        return null;
    }
    try {
        const parsed = new URL(value);
        if (parsed.protocol !== "https:" ||
            !XHS_SEARCH_REPLAY_ORIGIN_ALLOWLIST.has(parsed.origin) ||
            parsed.pathname !== SEARCH_ENDPOINT) {
            return null;
        }
        return `${parsed.origin}${SEARCH_ENDPOINT}`;
    }
    catch {
        return null;
    }
};
const isTrustedCapturedTemplate = (template, expected) => {
    const templateRecord = asRecord(template);
    if (!templateRecord) {
        return false;
    }
    if (templateRecord.method !== "POST" ||
        templateRecord.path !== SEARCH_ENDPOINT ||
        templateRecord.page_context_namespace !== expected.pageContextNamespace ||
        templateRecord.shape_key !== expected.shapeKey) {
        return false;
    }
    const templateShape = asRecord(templateRecord.shape);
    if (templateShape?.command !== "xhs.search" ||
        templateShape?.method !== "POST" ||
        templateShape?.pathname !== SEARCH_ENDPOINT ||
        serializeCanonicalShape(templateShape) !== expected.shapeKey) {
        return false;
    }
    if (resolveTrustedSearchTemplateUrl(templateRecord.url) === null) {
        return false;
    }
    const request = asRecord(templateRecord.request);
    if (!request || !asRecord(request.headers)) {
        return false;
    }
    const response = asRecord(templateRecord.response);
    if (!response || !("body" in response)) {
        return false;
    }
    return serializeCanonicalShape(request.body) === expected.shapeKey;
};
const isTrustedRejectedObservation = (observation, expected) => {
    const observationRecord = asRecord(observation);
    if (!observationRecord) {
        return false;
    }
    if (observationRecord.method !== "POST" ||
        observationRecord.path !== SEARCH_ENDPOINT ||
        observationRecord.page_context_namespace !== expected.pageContextNamespace ||
        observationRecord.shape_key !== expected.shapeKey) {
        return false;
    }
    const reason = observationRecord.rejection_reason;
    if (reason !== "synthetic_request_rejected" &&
        reason !== "failed_request_rejected") {
        return false;
    }
    return serializeCanonicalShape(asRecord(observationRecord.shape) ?? asRecord(asRecord(observationRecord.request)?.body)) ===
        expected.shapeKey;
};
const isTransientFailedRequestObservation = (observation) => {
    const observationRecord = asRecord(observation);
    if (observationRecord?.rejection_reason !== "failed_request_rejected") {
        return false;
    }
    const requestStatus = asRecord(observationRecord.request_status);
    return requestStatus?.http_status === null;
};
const BACKEND_REJECTED_SOURCE_REASONS = new Set([
    "SESSION_EXPIRED",
    "ACCOUNT_ABNORMAL",
    "XHS_ACCOUNT_RISK_PAGE",
    "BROWSER_ENV_ABNORMAL",
    "GATEWAY_INVOKER_FAILED",
    "CAPTCHA_REQUIRED",
    "TARGET_API_RESPONSE_INVALID"
]);
const resolveRejectedSourceDetail = (observation) => {
    const observationRecord = asRecord(observation);
    const rejectionReason = observationRecord?.rejection_reason;
    if (!observationRecord || rejectionReason !== "failed_request_rejected") {
        return { reason: "synthetic_request_rejected" };
    }
    const requestStatus = asRecord(observationRecord.request_status);
    const statusCode = asInteger(requestStatus?.http_status) ?? asInteger(observationRecord.status);
    const responseBody = asRecord(asRecord(observationRecord.response)?.body);
    const platformCode = asInteger(responseBody?.code);
    const inferred = inferFailure(statusCode ?? 0, responseBody);
    if (BACKEND_REJECTED_SOURCE_REASONS.has(inferred.reason)) {
        return {
            reason: inferred.reason,
            message: inferred.message,
            ...(typeof statusCode === "number" ? { statusCode } : {}),
            ...(typeof platformCode === "number" ? { platformCode } : {})
        };
    }
    return {
        reason: "failed_request_rejected",
        ...(typeof statusCode === "number" ? { statusCode } : {}),
        ...(typeof platformCode === "number" ? { platformCode } : {})
    };
};
const isTrustedIncompatibleObservation = (observation, expected) => {
    const observationRecord = asRecord(observation);
    if (!observationRecord) {
        return false;
    }
    if (observationRecord.method !== "POST" ||
        observationRecord.path !== SEARCH_ENDPOINT ||
        observationRecord.page_context_namespace !== expected.pageContextNamespace ||
        observationRecord.shape_key === expected.shapeKey) {
        return false;
    }
    const inferredShapeKey = serializeCanonicalShape(asRecord(observationRecord.shape) ?? asRecord(asRecord(observationRecord.request)?.body));
    return inferredShapeKey !== null && inferredShapeKey === observationRecord.shape_key;
};
const waitForRequestContextRetry = async (env, ms) => {
    if (typeof env.sleep === "function") {
        await env.sleep(ms);
        return;
    }
    if (typeof setTimeout !== "function") {
        await Promise.resolve();
        return;
    }
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};
const resolveRequestContextWaitMaxAttempts = (options, elapsedBeforeWaitMs = 0) => {
    const timeoutMs = typeof options.timeout_ms === "number" &&
        Number.isFinite(options.timeout_ms) &&
        options.timeout_ms > 0
        ? Math.floor(options.timeout_ms)
        : null;
    const elapsedMs = Math.max(0, Math.floor(elapsedBeforeWaitMs));
    const waitBudgetMs = timeoutMs === null
        ? REQUEST_CONTEXT_WAIT_MAX_MS
        : Math.max(0, timeoutMs - REQUEST_CONTEXT_FORWARD_DEADLINE_SAFETY_MS - elapsedMs);
    const maxWaitMs = Math.min(REQUEST_CONTEXT_WAIT_MAX_MS, waitBudgetMs);
    return Math.max(1, Math.floor(maxWaitMs / REQUEST_CONTEXT_WAIT_RETRY_MS) + 1);
};
const resolveRequestContextState = async (requestInput, env) => {
    const shape = createSearchRequestShape({
        keyword: requestInput.params.query,
        page: requestInput.params.page ?? 1,
        page_size: requestInput.params.limit ?? 20,
        sort: requestInput.params.sort ?? "general",
        note_type: requestInput.params.note_type ?? 0
    });
    const fallbackNamespace = createPageContextNamespace(env.getLocationHref());
    const readCapturedRequestContext = env.readCapturedRequestContext;
    if (!shape || !readCapturedRequestContext) {
        return {
            status: "miss",
            failureReason: "template_missing",
            pageContextNamespace: fallbackNamespace,
            shapeKey: shape ? serializeSearchRequestShape(shape) : "",
            availableShapeKeys: []
        };
    }
    const shapeKey = serializeSearchRequestShape(shape);
    let pageContextNamespace = fallbackNamespace;
    const lookupOnce = async (input) => {
        let lookup = null;
        try {
            pageContextNamespace = createPageContextNamespace(env.getLocationHref());
            lookup = await readCapturedRequestContext({
                method: "POST",
                path: SEARCH_ENDPOINT,
                page_context_namespace: pageContextNamespace,
                shape_key: shapeKey,
                ...(requestInput.expectedProvenance
                    ? {
                        profile_ref: requestInput.expectedProvenance.profile_ref,
                        session_id: requestInput.expectedProvenance.session_id,
                        ...(typeof requestInput.expectedProvenance.target_tab_id === "number"
                            ? { target_tab_id: requestInput.expectedProvenance.target_tab_id }
                            : {}),
                        run_id: requestInput.expectedProvenance.run_id,
                        action_ref: requestInput.expectedProvenance.action_ref,
                        page_url: requestInput.expectedProvenance.page_url
                    }
                    : {}),
                ...(typeof requestInput.minObservedAt === "number"
                    ? { min_observed_at: requestInput.minObservedAt }
                    : {})
            });
        }
        catch {
            return {
                status: "miss",
                failureReason: "template_missing",
                pageContextNamespace,
                shapeKey,
                availableShapeKeys: []
            };
        }
        pageContextNamespace = lookup?.page_context_namespace ?? pageContextNamespace;
        const availableShapeKeys = lookup?.available_shape_keys ?? [];
        const siblingShapeKeys = availableShapeKeys.filter((candidate) => candidate !== shapeKey);
        const admittedTemplate = isTrustedCapturedTemplate(lookup?.admitted_template ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.admitted_template ?? null
            : null;
        const rejectedObservation = isTrustedRejectedObservation(lookup?.rejected_observation ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.rejected_observation ?? null
            : null;
        const incompatibleObservation = isTrustedIncompatibleObservation(lookup?.incompatible_observation ?? null, {
            pageContextNamespace,
            shapeKey
        })
            ? lookup?.incompatible_observation ?? null
            : null;
        if (admittedTemplate && admittedTemplate.template_ready !== false) {
            const templateUrl = resolveTrustedSearchTemplateUrl(admittedTemplate.url);
            if (!templateUrl) {
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys
                };
            }
            const admittedResponseRecord = asRecord(admittedTemplate.response.body);
            const admittedBusinessCode = asInteger(admittedResponseRecord?.code);
            if (admittedTemplate.status >= 400 || admittedBusinessCode !== 0) {
                const failure = inferFailure(admittedTemplate.status, admittedTemplate.response.body);
                return {
                    status: "miss",
                    failureReason: "rejected_source",
                    detailReason: BACKEND_REJECTED_SOURCE_REASONS.has(failure.reason)
                        ? failure.reason
                        : "TARGET_API_RESPONSE_INVALID",
                    detailMessage: failure.message,
                    statusCode: admittedTemplate.status,
                    ...(admittedBusinessCode !== null ? { platformCode: admittedBusinessCode } : {}),
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt: admittedTemplate.observed_at ?? admittedTemplate.captured_at
                };
            }
            const observedAt = admittedTemplate.observed_at ?? admittedTemplate.captured_at;
            if (env.now() - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS) {
                return {
                    status: "miss",
                    failureReason: "template_stale",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt
                };
            }
            return {
                status: "hit",
                template: {
                    request: {
                        url: templateUrl,
                        headers: admittedTemplate.request.headers,
                        body: admittedTemplate.request.body
                    },
                    response: {
                        body: admittedTemplate.response.body
                    },
                    referrer: typeof admittedTemplate.referrer === "string" ? admittedTemplate.referrer : null,
                    capturedAt: admittedTemplate.captured_at,
                    pageContextNamespace
                },
                pageContextNamespace,
                shapeKey
            };
        }
        if (rejectedObservation) {
            if (input?.deferTransientMisses === true &&
                isTransientFailedRequestObservation(rejectedObservation)) {
                const rejectedDetail = resolveRejectedSourceDetail(rejectedObservation);
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    detailReason: rejectedDetail.reason,
                    detailMessage: rejectedDetail.message,
                    statusCode: rejectedDetail.statusCode,
                    platformCode: rejectedDetail.platformCode,
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys,
                    observedAt: rejectedObservation.observed_at ?? rejectedObservation.captured_at
                };
            }
            const rejectedDetail = resolveRejectedSourceDetail(rejectedObservation);
            return {
                status: "miss",
                failureReason: "rejected_source",
                detailReason: rejectedDetail.reason,
                detailMessage: rejectedDetail.message,
                statusCode: rejectedDetail.statusCode,
                platformCode: rejectedDetail.platformCode,
                pageContextNamespace,
                shapeKey,
                availableShapeKeys,
                observedAt: rejectedObservation.observed_at ?? rejectedObservation.captured_at
            };
        }
        if (incompatibleObservation || siblingShapeKeys.length > 0) {
            if (input?.deferTransientMisses === true) {
                return {
                    status: "miss",
                    failureReason: "template_missing",
                    pageContextNamespace,
                    shapeKey,
                    availableShapeKeys: siblingShapeKeys,
                    observedAt: incompatibleObservation?.observed_at ?? incompatibleObservation?.captured_at ?? undefined
                };
            }
            return {
                status: "miss",
                failureReason: "shape_mismatch",
                pageContextNamespace,
                shapeKey,
                availableShapeKeys: siblingShapeKeys,
                observedAt: incompatibleObservation?.observed_at ?? incompatibleObservation?.captured_at ?? undefined
            };
        }
        return {
            status: "miss",
            failureReason: "template_missing",
            pageContextNamespace,
            shapeKey,
            availableShapeKeys
        };
    };
    const maxAttempts = resolveRequestContextWaitMaxAttempts(requestInput.options, requestInput.elapsedBeforeWaitMs);
    let lastState = await lookupOnce({
        deferTransientMisses: maxAttempts > 1
    });
    for (let attempt = 1; attempt < maxAttempts &&
        lastState.status === "miss" &&
        lastState.failureReason === "template_missing"; attempt += 1) {
        await waitForRequestContextRetry(env, REQUEST_CONTEXT_WAIT_RETRY_MS);
        lastState = await lookupOnce({
            deferTransientMisses: attempt + 1 < maxAttempts
        });
    }
    return lastState;
};
const executeXhsSearch = async (input, env) => {
    const executionStartedAt = env.now();
    const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const layer2Interaction = buildXhsSearchLayer2InteractionEvidence({
        writeInteractionTierName: gate.write_action_matrix_decisions?.write_interaction_tier ?? null,
        requestedExecutionMode: input.options.requested_execution_mode,
        recoveryProbe: input.options.xhs_recovery_probe === true
    });
    const startedAt = env.now();
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return withLayer2InteractionInPayload(withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, createObservability({
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
        }), createDiagnosis({
            reason: "EXECUTION_MODE_GATE_BLOCKED",
            summary: "执行模式门禁阻断"
        }), gate, auditRecord), gate.execution_audit), layer2Interaction);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return withLayer2InteractionInSuccessPayload(createGateOnlySuccess(input, gate, auditRecord, env), layer2Interaction);
    }
    if (input.options.validation_action === "editor_input" &&
        input.options.issue_scope === "issue_208" &&
        input.options.action_type === "write" &&
        input.options.requested_execution_mode === "live_write") {
        const validationText = typeof input.options.validation_text === "string" && input.options.validation_text.trim().length > 0
            ? input.options.validation_text.trim()
            : "WebEnvoy editor_input validation";
        const focusAttestation = input.options.editor_focus_attestation ?? null;
        let validationResult;
        if (env.performEditorInputValidation) {
            try {
                validationResult = await env.performEditorInputValidation({
                    text: validationText,
                    focusAttestation: focusAttestation
                });
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
                    ability_id: input.abilityId,
                    stage: "execution",
                    reason: "EDITOR_INPUT_VALIDATION_FAILED",
                    validation_exception: message
                }, createObservability({
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId: `req-${env.randomId()}`,
                    outcome: "failed",
                    failureReason: message,
                    failureSite: {
                        stage: "execution",
                        component: "page",
                        target: "editor_input",
                        summary: message || "editor_input validation failed"
                    }
                }), createDiagnosis({
                    reason: "EDITOR_INPUT_VALIDATION_FAILED",
                    summary: message || "editor_input validation failed",
                    category: "page_changed"
                }), gate, auditRecord), gate.execution_audit);
            }
        }
        else {
            validationResult = {
                ok: false,
                mode: "dom_editor_input_validation",
                attestation: "dom_self_certified",
                editor_locator: null,
                input_text: validationText,
                before_text: "",
                visible_text: "",
                post_blur_text: "",
                focus_confirmed: false,
                focus_attestation_source: null,
                focus_attestation_reason: null,
                preserved_after_blur: false,
                success_signals: [],
                failure_signals: ["missing_focus_attestation", "dom_variant"],
                minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
            };
        }
        if (!isTrustedEditorInputValidation(validationResult)) {
            return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
                ability_id: input.abilityId,
                stage: "execution",
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                ...buildEditorInputEvidence(validationResult)
            }, createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "failed",
                failureReason: "EDITOR_INPUT_VALIDATION_FAILED",
                failureSite: {
                    stage: "execution",
                    component: "page",
                    target: validationResult.editor_locator ?? "editor_input",
                    summary: validationResult.failure_signals[0] ?? "editor_input validation failed"
                }
            }), createDiagnosis({
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                summary: validationResult.failure_signals[0] ?? "editor_input validation failed",
                category: "page_changed"
            }), gate, auditRecord), gate.execution_audit);
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
                        data_ref: {
                            validation_action: "editor_input"
                        },
                        metrics: {
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
                    write_interaction_tier: gate.write_interaction_tier,
                    write_action_matrix_decisions: gate.write_action_matrix_decisions,
                    consumer_gate_result: gate.consumer_gate_result,
                    request_admission_result: gate.request_admission_result,
                    execution_audit: gate.execution_audit,
                    approval_record: gate.approval_record,
                    risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                    audit_record: auditRecord,
                    ...layer2InteractionSummary(layer2Interaction),
                    interaction_result: buildEditorInputEvidence(validationResult)
                },
                observability: createObservability({
                    href: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    readyState: env.getReadyState(),
                    requestId: `req-${env.randomId()}`,
                    outcome: "completed"
                })
            }
        };
    }
    const simulated = resolveSimulatedResult(input.options.simulate_result, input.params, input.options, env);
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
                        audit_record: auditRecord,
                        ...layer2InteractionSummary(layer2Interaction)
                    }
                }
            };
        }
        return {
            ...simulated,
            payload: {
                ...simulated.payload,
                details: {
                    ability_id: input.abilityId,
                    ...(asRecord(simulated.payload.details) ?? {})
                },
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
    const accountSafetySurface = classifyXhsAccountSafetySurface({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        bodyText: env.getBodyText?.(),
        overlay: env.getAccountSafetyOverlay?.()
    });
    if (accountSafetySurface) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", accountSafetySurface.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: accountSafetySurface.reason,
            page_url: env.getLocationHref()
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: accountSafetySurface.reason,
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "xhs.account_safety_surface",
                summary: accountSafetySurface.message
            }
        }), createDiagnosis({
            reason: accountSafetySurface.reason,
            summary: accountSafetySurface.message,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "登录态缺失，无法执行 xhs.search", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createDiagnosis({
            reason: "SESSION_EXPIRED",
            summary: "登录态缺失，无法执行 xhs.search"
        }), gate, auditRecord), gate.execution_audit);
    }
    const buildExpectedRequestContextProvenance = () => ({
        profile_ref: input.executionContext.profile,
        session_id: input.executionContext.sessionId,
        target_tab_id: typeof gate.consumer_gate_result.target_tab_id === "number"
            ? gate.consumer_gate_result.target_tab_id
            : null,
        run_id: input.executionContext.runId,
        action_ref: input.abilityAction,
        page_url: env.getLocationHref()
    });
    const createProvenanceUnconfirmedFailure = () => {
        const expectedProvenance = buildExpectedRequestContextProvenance();
        const summary = "当前页面现场的搜索请求来源未完成 provenance 绑定";
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "REQUEST_CONTEXT_MISSING",
            request_context_reason: "provenance_unconfirmed",
            page_context_namespace: createPageContextNamespace(env.getLocationHref()),
            profile_ref: expectedProvenance.profile_ref,
            session_id: expectedProvenance.session_id,
            target_tab_id: expectedProvenance.target_tab_id,
            run_id: expectedProvenance.run_id,
            action_ref: expectedProvenance.action_ref,
            page_url: expectedProvenance.page_url
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "REQUEST_CONTEXT_MISSING",
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "captured_request_context",
                summary
            }
        }), createDiagnosis({
            reason: "REQUEST_CONTEXT_MISSING",
            summary,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    };
    const confirmCurrentRequestContextProvenance = async () => {
        if (typeof env.configureCapturedRequestContextProvenance !== "function") {
            return true;
        }
        const expectedProvenance = buildExpectedRequestContextProvenance();
        const result = await env.configureCapturedRequestContextProvenance({
            page_context_namespace: createPageContextNamespace(env.getLocationHref()),
            ...expectedProvenance
        }).catch(() => null);
        const record = asRecord(result);
        return (record?.configured === true &&
            record.profile_ref === expectedProvenance.profile_ref &&
            record.session_id === expectedProvenance.session_id &&
            (expectedProvenance.target_tab_id === null ||
                record.target_tab_id === expectedProvenance.target_tab_id) &&
            record.run_id === expectedProvenance.run_id &&
            record.action_ref === expectedProvenance.action_ref &&
            record.page_url === expectedProvenance.page_url);
    };
    if (input.options.__request_context_provenance_confirmed === false) {
        return createProvenanceUnconfirmedFailure();
    }
    const payload = {
        keyword: input.params.query,
        page: input.params.page ?? 1,
        page_size: input.params.limit ?? 20,
        search_id: input.params.search_id ?? env.randomId(),
        sort: input.params.sort ?? "general",
        note_type: input.params.note_type ?? 0
    };
    const passiveActionStartedAt = env.now();
    const passiveActionEvidence = await performSearchPassiveAction(input, env);
    if (!(await confirmCurrentRequestContextProvenance())) {
        return createProvenanceUnconfirmedFailure();
    }
    const requestContextState = await resolveRequestContextState({
        params: input.params,
        options: input.options,
        minObservedAt: passiveActionEvidence ? passiveActionStartedAt : null,
        elapsedBeforeWaitMs: env.now() - executionStartedAt,
        expectedProvenance: buildExpectedRequestContextProvenance()
    }, env);
    if (requestContextState.status !== "hit") {
        const backendRejectedReason = requestContextState.detailReason &&
            BACKEND_REJECTED_SOURCE_REASONS.has(requestContextState.detailReason)
            ? requestContextState.detailReason
            : null;
        const reason = backendRejectedReason ??
            (requestContextState.failureReason === "shape_mismatch" ||
                requestContextState.failureReason === "rejected_source"
                ? "REQUEST_CONTEXT_INCOMPATIBLE"
                : "REQUEST_CONTEXT_MISSING");
        const summaryMap = {
            template_missing: "当前页面现场缺少可复用的搜索请求模板",
            template_stale: "当前页面现场的搜索请求模板已过期",
            shape_mismatch: "当前页面现场存在不同 shape 的搜索请求模板",
            rejected_source: "当前页面现场的搜索请求来源已被拒绝"
        };
        const summary = requestContextState.detailMessage ?? summaryMap[requestContextState.failureReason];
        const isBackendRejectedSource = backendRejectedReason !== null;
        if (requestContextState.failureReason === "rejected_source") {
            return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
                ability_id: input.abilityId,
                stage: "execution",
                reason,
                request_context_reason: requestContextState.failureReason,
                page_context_namespace: requestContextState.pageContextNamespace,
                shape_key: requestContextState.shapeKey,
                available_shape_keys: requestContextState.availableShapeKeys,
                ...(requestContextState.statusCode !== undefined
                    ? { status_code: requestContextState.statusCode }
                    : {}),
                ...(requestContextState.platformCode !== undefined
                    ? { platform_code: requestContextState.platformCode }
                    : {}),
                ...(backendRejectedReason ? { rejected_source_reason: backendRejectedReason } : {}),
                ...(requestContextState.observedAt !== undefined
                    ? { observed_at: requestContextState.observedAt }
                    : {})
            }, createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "failed",
                ...(requestContextState.statusCode !== undefined
                    ? { statusCode: requestContextState.statusCode }
                    : {}),
                failureReason: reason,
                includeKeyRequest: false,
                failureSite: {
                    stage: "action",
                    component: "page",
                    target: isBackendRejectedSource ? SEARCH_ENDPOINT : "captured_request_context",
                    summary
                }
            }), createDiagnosis({
                reason,
                summary,
                category: isBackendRejectedSource ? "request_failed" : "page_changed"
            }), gate, auditRecord), gate.execution_audit);
        }
        const domExtraction = isCurrentSearchPageForQuery(env.getLocationHref(), input.params.query)
            ? await resolveSearchDomExtraction(env)
            : null;
        if (domExtraction) {
            const count = domExtraction.cards.length;
            return {
                ok: true,
                payload: {
                    summary: {
                        capability_result: {
                            ability_id: input.abilityId,
                            layer: input.abilityLayer,
                            action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                            outcome: "success",
                            data_ref: {
                                query: input.params.query
                            },
                            metrics: {
                                count,
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
                        audit_record: auditRecord,
                        ...layer2InteractionSummary(layer2Interaction),
                        route_evidence: {
                            evidence_class: "dom_state_extraction",
                            profile_ref: input.executionContext.profile,
                            target_tab_id: gate.consumer_gate_result.target_tab_id,
                            page_url: env.getLocationHref(),
                            run_id: input.executionContext.runId,
                            action_ref: input.executionContext.gateInvocationId ?? input.executionContext.runId,
                            extraction_layer: domExtraction.extraction_layer,
                            extraction_locator: domExtraction.extraction_locator,
                            extracted_at: toIsoString(env.now()),
                            target_continuity: buildSearchTargetContinuity(domExtraction.cards),
                            risk_surface_classification: "none",
                            ...(passiveActionEvidence ? { humanized_action: passiveActionEvidence } : {}),
                            item_kind: "search_card",
                            cards: domExtraction.cards
                        },
                        request_context: {
                            status: "missing",
                            reason: requestContextState.failureReason,
                            page_context_namespace: requestContextState.pageContextNamespace,
                            shape_key: requestContextState.shapeKey,
                            available_shape_keys: requestContextState.availableShapeKeys
                        }
                    },
                    observability: createObservability({
                        href: env.getLocationHref(),
                        title: env.getDocumentTitle(),
                        readyState: env.getReadyState(),
                        requestId: `req-${env.randomId()}`,
                        outcome: "completed",
                        includeKeyRequest: false
                    })
                }
            };
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", summary, {
            ability_id: input.abilityId,
            stage: "execution",
            reason,
            request_context_reason: requestContextState.failureReason,
            page_context_namespace: requestContextState.pageContextNamespace,
            shape_key: requestContextState.shapeKey,
            available_shape_keys: requestContextState.availableShapeKeys,
            ...(requestContextState.detailReason
                ? { rejected_source_reason: requestContextState.detailReason }
                : {}),
            ...(typeof requestContextState.statusCode === "number"
                ? { status_code: requestContextState.statusCode }
                : {}),
            ...(typeof requestContextState.platformCode === "number"
                ? { platform_code: requestContextState.platformCode }
                : {}),
            ...(typeof requestContextState.observedAt === "number"
                ? { request_context_observed_at: requestContextState.observedAt }
                : {})
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: reason,
            includeKeyRequest: isBackendRejectedSource,
            statusCode: requestContextState.statusCode,
            failureSite: {
                stage: isBackendRejectedSource ? "request" : "action",
                component: isBackendRejectedSource ? "network" : "page",
                target: isBackendRejectedSource ? SEARCH_ENDPOINT : "captured_request_context",
                summary
            }
        }), createDiagnosis({
            reason,
            summary,
            category: isBackendRejectedSource ? "request_failed" : "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    const headers = {
        ...requestContextState.template.request.headers
    };
    const capturedRequestBody = asRecord(requestContextState.template.request.body);
    if (!capturedRequestBody) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "当前页面现场缺少可复用的搜索请求模板", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "REQUEST_CONTEXT_MISSING",
            request_context_reason: "template_missing",
            page_context_namespace: requestContextState.pageContextNamespace,
            shape_key: requestContextState.shapeKey,
            available_shape_keys: []
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "REQUEST_CONTEXT_MISSING",
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "captured_request_context",
                summary: "当前页面现场缺少可复用的搜索请求模板"
            }
        }), createDiagnosis({
            reason: "REQUEST_CONTEXT_MISSING",
            summary: "当前页面现场缺少可复用的搜索请求模板"
        }), gate, auditRecord), gate.execution_audit);
    }
    const passiveCards = collectSearchDomCards(requestContextState.template.response.body);
    const passiveTargetContinuity = passiveCards.length > 0
        ? buildSearchTargetContinuity(passiveCards)
        : [
            {
                target_url: env.getLocationHref(),
                xsec_token: null,
                xsec_source: null,
                token_presence: "missing",
                source_route: "xhs.search"
            }
        ];
    const count = parseCount(requestContextState.template.response.body);
    return {
        ok: true,
        payload: {
            summary: {
                capability_result: {
                    ability_id: input.abilityId,
                    layer: input.abilityLayer,
                    action: gate.consumer_gate_result.action_type ?? input.abilityAction,
                    outcome: "success",
                    data_ref: {
                        query: input.params.query,
                        search_id: typeof capturedRequestBody.search_id === "string"
                            ? capturedRequestBody.search_id
                            : payload.search_id
                    },
                    metrics: {
                        count,
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
                audit_record: auditRecord,
                ...layer2InteractionSummary(layer2Interaction),
                route_evidence: {
                    evidence_class: "passive_api_capture",
                    profile_ref: input.executionContext.profile,
                    target_tab_id: gate.consumer_gate_result.target_tab_id,
                    page_url: env.getLocationHref(),
                    run_id: input.executionContext.runId,
                    action_ref: input.executionContext.gateInvocationId ?? input.executionContext.runId,
                    captured_at: requestContextState.template.capturedAt,
                    page_context_namespace: requestContextState.pageContextNamespace,
                    shape_key: requestContextState.shapeKey,
                    ...(passiveActionEvidence ? { humanized_action: passiveActionEvidence } : {}),
                    target_continuity: passiveTargetContinuity,
                    ...(passiveCards.length > 0
                        ? {
                            item_kind: "search_card",
                            cards: passiveCards
                        }
                        : {})
                },
                request_context: {
                    status: "exact_hit",
                    page_context_namespace: requestContextState.pageContextNamespace,
                    shape_key: requestContextState.shapeKey,
                    captured_at: requestContextState.template.capturedAt
                }
            },
            observability: createObservability({
                href: env.getLocationHref(),
                title: env.getDocumentTitle(),
                readyState: env.getReadyState(),
                requestId: `req-${env.randomId()}`,
                outcome: "completed",
                statusCode: 200
            })
        }
    };
};
return { executeXhsSearch };
})();
const __webenvoy_module_xhs_search = (() => {
const { executeXhsSearch: executeXhsSearchImpl } = __webenvoy_module_xhs_search_execution;
function executeXhsSearch(...args) {
    return executeXhsSearchImpl(...args);
}
return { executeXhsSearch };
})();
const __webenvoy_module_xhs_read_execution = (() => {
const { createAuditRecord, resolveGate } = __webenvoy_module_xhs_search_gate;
const {
  classifyXhsAccountSafetySurface,
  containsCookie,
  createDiagnosis,
  createFailure,
  resolveRiskStateOutput,
  resolveXsCommon
} = __webenvoy_module_xhs_search_telemetry;
const DETAIL_ENDPOINT = "/api/sns/web/v1/feed";
const USER_HOME_ENDPOINT = "/api/sns/web/v1/user/otherinfo";
const REQUEST_CONTEXT_FRESHNESS_WINDOW_MS = 5 * 60_000;
const REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS = 10;
const REQUEST_CONTEXT_WAIT_RETRY_MS = 150;
const BACKEND_REJECTED_SOURCE_REASONS = new Set([
    "XHS_LOGIN_REQUIRED",
    "SESSION_EXPIRED",
    "ACCOUNT_ABNORMAL",
    "XHS_ACCOUNT_RISK_PAGE",
    "BROWSER_ENV_ABNORMAL",
    "GATEWAY_INVOKER_FAILED",
    "CAPTCHA_REQUIRED",
    "TARGET_API_RESPONSE_INVALID"
]);
const XHS_DETAIL_SPEC = {
    command: "xhs.detail",
    endpoint: DETAIL_ENDPOINT,
    method: "POST",
    pageKind: "detail",
    requestClass: "xhs.detail",
    buildPayload: (params) => ({
        source_note_id: params.note_id
    }),
    buildUrl: () => "/api/sns/web/v1/feed",
    buildSignatureUri: () => DETAIL_ENDPOINT,
    buildDataRef: (params) => ({
        note_id: params.note_id
    })
};
const XHS_USER_HOME_SPEC = {
    command: "xhs.user_home",
    endpoint: USER_HOME_ENDPOINT,
    method: "GET",
    pageKind: "user_home",
    requestClass: "xhs.user_home",
    buildPayload: () => ({}),
    buildUrl: (params) => `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent(params.user_id)}`,
    buildSignatureUri: (params) => `/api/sns/web/v1/user/otherinfo?user_id=${encodeURIComponent(params.user_id)}`,
    buildDataRef: (params) => ({
        user_id: params.user_id
    })
};
const READ_COMMAND_SPECS = {
    "xhs.detail": XHS_DETAIL_SPEC,
    "xhs.user_home": XHS_USER_HOME_SPEC
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asArray = (value) => (Array.isArray(value) ? value : null);
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const parseJsonRecord = (value) => {
    if (typeof value === "string") {
        try {
            return asRecord(JSON.parse(value));
        }
        catch {
            return null;
        }
    }
    return asRecord(value);
};
const normalizeCapturedHeaders = (value) => {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    return Object.fromEntries(Object.entries(record).filter((entry) => typeof entry[1] === "string"));
};
const getCapturedHeader = (headers, key) => {
    const matchedEntry = Object.entries(headers).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase());
    return matchedEntry && matchedEntry[1].trim().length > 0 ? matchedEntry[1].trim() : null;
};
const resolveCapturedArtifactHeaders = (value) => {
    const record = asRecord(value);
    if (!record) {
        return {};
    }
    const request = asRecord(record.request);
    return normalizeCapturedHeaders(record.template_headers ?? request?.headers);
};
const resolveCapturedArtifactReferrer = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return asString(record.referrer);
};
const resolveCapturedArtifactRequestUrl = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const rawUrl = asString(record.url);
    if (rawUrl) {
        try {
            const url = new URL(rawUrl, "https://www.xiaohongshu.com");
            return `${url.pathname}${url.search}`;
        }
        catch {
            return rawUrl;
        }
    }
    return asString(record.path);
};
const resolveCapturedArtifactRequestBody = (value) => {
    const record = asRecord(value);
    const request = asRecord(record?.request);
    return asRecord(request?.body);
};
const resolveCapturedArtifactStatus = (value) => {
    const record = asRecord(value);
    const requestStatus = asRecord(record?.request_status);
    const sourceKind = asString(record?.source_kind);
    const httpStatus = asInteger(requestStatus?.http_status) ?? asInteger(record?.status);
    const completion = asString(requestStatus?.completion);
    const templateReady = typeof record?.template_ready === "boolean" ? record.template_ready : null;
    const explicitReason = asString(record?.rejection_reason);
    const rejectionReason = explicitReason === "synthetic_request_rejected" ||
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
const resolveCapturedArtifactObservedAt = (value) => {
    const record = asRecord(value);
    return asInteger(record?.observed_at) ?? asInteger(record?.captured_at);
};
const resolveCapturedTemplateIdentity = (record, expectedShape) => {
    const explicitIdentity = asString(record?.template_identity);
    if (explicitIdentity) {
        return explicitIdentity;
    }
    const observedAt = asInteger(record?.observed_at) ?? asInteger(record?.captured_at) ?? 0;
    const namespace = asString(record?.page_context_namespace) ?? "unknown_namespace";
    const shapeKey = asString(record?.shape_key) ?? serializeReadShape(expectedShape);
    return `captured:${namespace}:${shapeKey}:${observedAt}`;
};
const resolveActiveApiFetchFallbackTemplateEvidence = (artifact, expectedShape, now) => {
    const record = asRecord(artifact);
    const observedAt = resolveCapturedArtifactObservedAt(record);
    const capturedAt = asInteger(record?.captured_at);
    const freshnessWindowMs = asInteger(record?.freshness_window_ms) ?? REQUEST_CONTEXT_FRESHNESS_WINDOW_MS;
    return {
        route_evidence_class: asString(record?.route_evidence_class),
        source_kind: asString(record?.source_kind),
        template_identity: resolveCapturedTemplateIdentity(record, expectedShape),
        profile_ref: asString(record?.profile_ref),
        session_id: asString(record?.session_id),
        target_tab_id: asInteger(record?.target_tab_id),
        run_id: asString(record?.run_id),
        action_ref: asString(record?.action_ref),
        page_url: asString(record?.page_url),
        observed_at: observedAt,
        captured_at: capturedAt,
        freshness_window_ms: freshnessWindowMs,
        template_age_ms: observedAt === null ? null : Math.max(0, now - observedAt),
        page_context_namespace: asString(record?.page_context_namespace),
        shape_key: asString(record?.shape_key)
    };
};
const isCapturedArtifactStale = (value, now) => {
    const observedAt = resolveCapturedArtifactObservedAt(value);
    return observedAt === null || now - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS;
};
const resolveRejectedSourceDiagnostics = (spec, artifact) => {
    const status = resolveCapturedArtifactStatus(artifact);
    const response = asRecord(artifact.response);
    const responseBody = response?.body;
    const responseRecord = asRecord(responseBody);
    const platformCode = asInteger(responseRecord?.code);
    if (status.rejectionReason === "synthetic_request_rejected" ||
        status.rejectionReason === "shape_mismatch") {
        return {
            reason: status.rejectionReason,
            statusCode: status.httpStatus,
            platformCode
        };
    }
    if (status.rejectionReason === "failed_request_rejected") {
        const inferred = inferReadFailure(spec, status.httpStatus ?? 0, responseBody);
        if (BACKEND_REJECTED_SOURCE_REASONS.has(inferred.reason)) {
            return {
                reason: inferred.reason,
                statusCode: status.httpStatus,
                platformCode
            };
        }
        return {
            reason: "failed_request_rejected",
            statusCode: status.httpStatus,
            platformCode
        };
    }
    return {
        reason: "failed_request_rejected",
        statusCode: status.httpStatus,
        platformCode
    };
};
const resolveRejectedSourceMessage = (spec, reason) => {
    switch (reason) {
        case "XSEC_TOKEN_MISSING":
            return `当前页面现场缺少 ${spec.command} signed URL 或 xsec_token，无法继续执行`;
        case "XSEC_TOKEN_EMPTY":
            return `当前页面现场的 ${spec.command} xsec_token 为空，无法继续执行`;
        case "XSEC_TOKEN_STALE":
            return `当前页面现场的 ${spec.command} xsec_token 已过期，无法继续执行`;
        case "XSEC_SOURCE_MISMATCH":
            return `当前页面现场的 ${spec.command} xsec_source 与来源不匹配，无法继续执行`;
        case "SECURITY_REDIRECT":
            return "当前页面被安全重定向拦截，无法继续执行";
        case "SESSION_EXPIRED":
            return `登录已失效，无法执行 ${spec.command}`;
        case "XHS_LOGIN_REQUIRED":
            return "当前页面要求登录小红书，无法继续执行";
        case "ACCOUNT_ABNORMAL":
            return "账号异常，平台拒绝当前请求";
        case "XHS_ACCOUNT_RISK_PAGE":
            return "当前页面命中小红书账号风险或安全验证页面";
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
const isBackendRejectedSourceLookup = (lookupResult) => lookupResult.state === "rejected_source" &&
    (BACKEND_REJECTED_SOURCE_REASONS.has(lookupResult.reason) ||
        lookupResult.reason === "failed_request_rejected");
const SECURITY_REDIRECT_URL_PATTERN = /\/(security|captcha|verify|risk|safe|login)(\/|$)/i;
const classifySignedContinuitySourceRoute = (xsecSource) => {
    switch (xsecSource) {
        case "pc_search":
            return "xhs.search";
        case "pc_note":
            return "xhs.detail";
        case "pc_profile":
        case "pc_user":
            return "xhs.user_home";
        default:
            return "unknown";
    }
};
const isSecurityRedirectUrl = (value) => {
    if (!value) {
        return false;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return SECURITY_REDIRECT_URL_PATTERN.test(url.pathname);
    }
    catch {
        return SECURITY_REDIRECT_URL_PATTERN.test(value);
    }
};
const resolveSignedContinuityUrl = (spec, expectedShape, value) => {
    if (!value || isSecurityRedirectUrl(value)) {
        return null;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        if (url.protocol !== "https:" || url.hostname !== "www.xiaohongshu.com") {
            return null;
        }
        if (spec.command === "xhs.detail") {
            const noteId = expectedShape.note_id;
            const expectedPaths = [`/explore/${noteId}`, `/discovery/item/${noteId}`];
            return expectedPaths.includes(url.pathname) ? url : null;
        }
        const userId = expectedShape.user_id;
        return url.pathname === `/user/profile/${userId}` ? url : null;
    }
    catch {
        return null;
    }
};
const resolveSignedContinuity = (spec, expectedShape, artifact) => {
    const record = asRecord(artifact);
    const referrer = resolveCapturedArtifactReferrer(record);
    const url = asString(record?.url);
    const signedUrl = resolveSignedContinuityUrl(spec, expectedShape, referrer) ??
        resolveSignedContinuityUrl(spec, expectedShape, url);
    const sourceUrl = referrer ?? url;
    const rawToken = signedUrl?.searchParams.get("xsec_token") ?? null;
    const xsecToken = rawToken === null ? null : rawToken.trim();
    const rawSource = signedUrl?.searchParams.get("xsec_source") ?? null;
    const xsecSource = rawSource === null ? null : rawSource.trim() || null;
    const tokenPresence = rawToken === null ? "missing" : rawToken.trim().length > 0 ? "present" : "empty";
    const targetUrl = signedUrl ? signedUrl.toString() : null;
    return {
        source_url: sourceUrl,
        target_url: targetUrl,
        ...(spec.command === "xhs.detail" ? { detail_url: targetUrl } : { user_home_url: targetUrl }),
        xsec_token: xsecToken,
        xsec_source: xsecSource,
        token_presence: tokenPresence,
        observed_at: resolveCapturedArtifactObservedAt(record),
        source_route: classifySignedContinuitySourceRoute(xsecSource)
    };
};
const resolveSignedContinuityFailure = (continuity, observedAt, now, pageUrl) => {
    if (isSecurityRedirectUrl(pageUrl) || isSecurityRedirectUrl(continuity.source_url)) {
        return "SECURITY_REDIRECT";
    }
    if (!continuity.target_url) {
        return "XSEC_TOKEN_MISSING";
    }
    if (continuity.token_presence === "missing") {
        return "XSEC_TOKEN_MISSING";
    }
    if (continuity.token_presence === "empty") {
        return "XSEC_TOKEN_EMPTY";
    }
    if (continuity.source_route !== "xhs.search" || continuity.xsec_source !== "pc_search") {
        return "XSEC_SOURCE_MISMATCH";
    }
    if (observedAt === null || now - observedAt > REQUEST_CONTEXT_FRESHNESS_WINDOW_MS) {
        return "XSEC_TOKEN_STALE";
    }
    return null;
};
const waitForRequestContextRetry = async (env, ms) => {
    if (typeof env.sleep === "function") {
        await env.sleep(ms);
        return;
    }
    await new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};
const resolveExactShapeLookupArtifacts = (lookupRecord) => {
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
    if (rejectedObservedAt !== null &&
        (admittedObservedAt === null || rejectedObservedAt > admittedObservedAt)) {
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
const parseUserIdFromUrl = (value) => {
    if (!value) {
        return null;
    }
    try {
        const url = new URL(value, "https://www.xiaohongshu.com");
        return asString(url.searchParams.get("user_id"));
    }
    catch {
        return null;
    }
};
const resolveDetailResponseNoteId = (value, preferredNoteId, options) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    let fallbackNoteId = null;
    for (const candidate of getDetailResponseCandidates(record)) {
        const candidateNoteId = asString(candidate.note_id) ?? asString(candidate.noteId);
        if (candidateNoteId) {
            if (preferredNoteId && candidateNoteId === preferredNoteId) {
                return candidateNoteId;
            }
            fallbackNoteId ??= candidateNoteId;
            continue;
        }
        if (options?.allowBareIdAlias &&
            asString(candidate.id)) {
            const bareId = asString(candidate.id);
            if (!preferredNoteId || bareId === preferredNoteId) {
                return bareId;
            }
            return bareId;
        }
    }
    return preferredNoteId ? null : fallbackNoteId;
};
const hasUserHomeResponseDataShape = (record) => [
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
const iterateUserHomeResponseCandidates = (value) => {
    const collectCandidates = (candidate, seen = new Set()) => {
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
const resolveUserHomeResponseUserId = (value, preferredUserId) => {
    let fallbackUserId = null;
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
const createDetailShape = (noteId) => ({
    command: "xhs.detail",
    method: "POST",
    pathname: DETAIL_ENDPOINT,
    note_id: noteId
});
const deriveReadShapeFromCommand = (spec, params) => spec.command === "xhs.detail"
    ? {
        command: "xhs.detail",
        method: "POST",
        pathname: DETAIL_ENDPOINT,
        note_id: params.note_id
    }
    : {
        command: "xhs.user_home",
        method: "GET",
        pathname: USER_HOME_ENDPOINT,
        user_id: params.user_id
    };
const deriveDetailShapeFromSource = (value) => {
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
const deriveDetailRejectedShapeFromRequestSource = (value) => {
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
const deriveUserHomeShapeFromSource = (value) => {
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
const deriveReadShapeFromArtifact = (spec, artifact, options) => {
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
                const responseNoteId = resolveDetailResponseNoteId(response?.body, preferredNoteId, {
                    allowBareIdAlias: options?.allowDetailResponseBareIdAlias
                }) ??
                    resolveDetailResponseNoteId(response?.body);
                return responseNoteId ? createDetailShape(responseNoteId) : null;
            })();
            if (explicitDetailShape &&
                responseDetailShape &&
                responseDetailShape.note_id !== explicitDetailShape.note_id) {
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
        const responseUserId = resolveUserHomeResponseUserId(response?.body, explicitUserHomeShape?.user_id ?? null);
        return explicitUserHomeShape &&
            responseUserId &&
            responseUserId === explicitUserHomeShape.user_id
            ? explicitUserHomeShape
            : null;
    }
    if (spec.command === "xhs.detail") {
        const noteIdFromResponse = resolveDetailResponseNoteId(response?.body, options?.preferredDetailNoteId) ??
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
        return (createUserHomeRequestShape({
            user_id: expectedUserId
        }) ?? null);
    }
    return null;
};
const serializeReadShape = (shape) => shape.command === "xhs.detail"
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
const resolveReadRequestContext = (spec, artifact, expectedShape, now, options) => {
    if (!artifact) {
        return {
            state: "miss",
            reason: "template_missing"
        };
    }
    const lookupRecord = asRecord(artifact);
    if (lookupRecord &&
        ("admitted_template" in lookupRecord ||
            "rejected_observation" in lookupRecord ||
            "incompatible_observation" in lookupRecord)) {
        const { admittedTemplate, rejectedObservation } = resolveExactShapeLookupArtifacts(lookupRecord);
        const incompatibleObservation = asRecord(lookupRecord.incompatible_observation);
        if (admittedTemplate) {
            return resolveReadRequestContext(spec, admittedTemplate, expectedShape, now, {
                allowDetailResponseBareIdAlias: false,
                allowDetailRequestFallback: false
            });
        }
        if (rejectedObservation) {
            const derivedShape = deriveReadShapeFromArtifact(spec, rejectedObservation, {
                preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
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
            const rejectedDiagnostics = resolveRejectedSourceDiagnostics(spec, rejectedObservation);
            return {
                state: "rejected_source",
                reason: rejectedDiagnostics.reason,
                shape: derivedShape ?? expectedShape,
                statusCode: rejectedDiagnostics.statusCode,
                platformCode: rejectedDiagnostics.platformCode
            };
        }
        if (incompatibleObservation) {
            return {
                state: "incompatible",
                reason: "shape_mismatch",
                shape: deriveReadShapeFromArtifact(spec, incompatibleObservation, {
                    preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
                    allowDetailResponseBareIdAlias: true,
                    allowDetailRequestFallback: true
                })
            };
        }
        const availableShapeKeys = Array.isArray(lookupRecord.available_shape_keys)
            ? lookupRecord.available_shape_keys.filter((item) => typeof item === "string")
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
    const derivedShape = deriveReadShapeFromArtifact(spec, artifact, {
        preferredDetailNoteId: spec.command === "xhs.detail" ? expectedShape.note_id : null,
        allowDetailResponseBareIdAlias: options?.allowDetailResponseBareIdAlias ?? false,
        allowDetailRequestFallback: spec.command === "xhs.detail" && !resolveCapturedArtifactStatus(artifact).rejectionReason
            ? false
            : (options?.allowDetailRequestFallback ?? true)
    });
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
        const rejectedDiagnostics = resolveRejectedSourceDiagnostics(spec, artifact);
        return {
            state: "rejected_source",
            reason: rejectedDiagnostics.reason,
            shape: derivedShape,
            statusCode: rejectedDiagnostics.statusCode,
            platformCode: rejectedDiagnostics.platformCode
        };
    }
    return {
        state: "hit",
        shape: derivedShape,
        headers: resolveCapturedArtifactHeaders(artifact),
        referrer: resolveCapturedArtifactReferrer(artifact),
        requestUrl: resolveCapturedArtifactRequestUrl(artifact),
        requestBody: resolveCapturedArtifactRequestBody(artifact),
        observedAt: resolveCapturedArtifactObservedAt(artifact),
        signedContinuity: resolveSignedContinuity(spec, expectedShape, artifact),
        templateEvidence: resolveActiveApiFetchFallbackTemplateEvidence(artifact, expectedShape, now)
    };
};
const failClosedForRequestContext = (input, env) => {
    const failureSurface = resolveRequestContextFailureSurface(input.spec, input.lookupResult);
    const backendRejectedSource = isBackendRejectedSourceLookup(input.lookupResult);
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failureSurface.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: failureSurface.reasonCode,
        request_context_result: failureSurface.resultKind,
        request_context_lookup_state: input.lookupResult.state,
        request_context_miss_reason: input.lookupResult.reason,
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        ...(input.lookupResult.state === "rejected_source" &&
            typeof input.lookupResult.statusCode === "number"
            ? { status_code: input.lookupResult.statusCode }
            : {}),
        ...(input.lookupResult.state === "rejected_source" &&
            typeof input.lookupResult.platformCode === "number"
            ? { platform_code: input.lookupResult.platformCode }
            : {}),
        ...("shape" in input.lookupResult && input.lookupResult.shape
            ? { captured_request_shape: input.lookupResult.shape }
            : {})
    }, createReadObservability({
        spec: input.spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        statusCode: input.lookupResult.state === "rejected_source" ? (input.lookupResult.statusCode ?? undefined) : undefined,
        failureReason: input.lookupResult.reason,
        includeKeyRequest: input.lookupResult.state === "rejected_source" &&
            BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason),
        failureSite: {
            stage: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? "request"
                : "execution",
            component: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? "network"
                : "page",
            target: input.lookupResult.state === "rejected_source" &&
                BACKEND_REJECTED_SOURCE_REASONS.has(input.lookupResult.reason)
                ? input.spec.endpoint
                : "captured_request_context",
            summary: input.lookupResult.reason
        }
    }), createReadDiagnosis(input.spec, {
        reason: input.lookupResult.reason,
        summary: failureSurface.message,
        category: backendRejectedSource ? "request_failed" : "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const failClosedForSignedContinuity = (input, env) => {
    const message = resolveRejectedSourceMessage(input.spec, input.reason) ??
        `当前页面现场缺少可复用的 ${input.spec.command} signed continuity`;
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: input.reason,
        request_context_result: "signed_continuity_invalid",
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        signed_continuity: input.continuity
    }, createReadObservability({
        spec: input.spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: input.reason,
        includeKeyRequest: false,
        failureSite: {
            stage: "execution",
            component: "page",
            target: "xhs.signed_continuity",
            summary: message
        }
    }), createReadDiagnosis(input.spec, {
        reason: input.reason,
        summary: message,
        category: "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const buildActiveFallbackTemplateBinding = (input) => ({
    profile_ref: input.executionContext.profile,
    session_id: input.executionContext.sessionId,
    target_tab_id: typeof input.options.actual_target_tab_id === "number" ? input.options.actual_target_tab_id : null,
    run_id: input.executionContext.runId,
    action_ref: input.abilityAction,
    page_url: input.pageUrl
});
const resolveActiveApiFetchFallbackGate = (input) => {
    const options = input.executionInput.options.active_api_fetch_fallback;
    const runtimeAttestation = asRecord(options?.runtime_attestation);
    const fingerprintAttestation = asRecord(options?.fingerprint_attestation);
    const binding = buildActiveFallbackTemplateBinding({
        executionContext: input.executionInput.executionContext,
        options: input.executionInput.options,
        abilityAction: input.executionInput.abilityAction,
        pageUrl: input.env.getLocationHref()
    });
    const reasonCodes = [];
    if (options?.enabled !== true) {
        reasonCodes.push("ACTIVE_API_FETCH_FALLBACK_NOT_APPROVED");
    }
    if (options?.account_safety_state !== "clear") {
        reasonCodes.push("ACCOUNT_SAFETY_NOT_CLEAR");
    }
    if (options?.rhythm_state !== "allowed") {
        reasonCodes.push("RHYTHM_NOT_ALLOWED");
    }
    if (options?.fingerprint_validation_state !== "ready" ||
        fingerprintAttestation?.source !== "content_script_fingerprint_runtime" ||
        fingerprintAttestation.validation_state !== "ready") {
        reasonCodes.push("FINGERPRINT_VALIDATION_NOT_READY");
    }
    if (runtimeAttestation?.source !== "official_chrome_runtime_readiness" ||
        runtimeAttestation.runtime_readiness !== "ready") {
        reasonCodes.push("RUNTIME_ATTESTATION_REQUIRED");
    }
    if (runtimeAttestation?.profile_ref !== binding.profile_ref ||
        runtimeAttestation?.session_id !== binding.session_id ||
        runtimeAttestation?.run_id !== binding.run_id) {
        reasonCodes.push("RUNTIME_ATTESTATION_BINDING_MISMATCH");
    }
    if (runtimeAttestation?.execution_surface !== "real_browser") {
        reasonCodes.push("EXECUTION_SURFACE_NOT_REAL_BROWSER");
    }
    if (runtimeAttestation?.headless !== false) {
        reasonCodes.push("HEADLESS_NOT_FALSE");
    }
    if (input.templateEvidence.route_evidence_class !== "passive_api_capture") {
        reasonCodes.push("PASSIVE_CAPTURE_TEMPLATE_REQUIRED");
    }
    if (input.templateEvidence.source_kind !== "page_request") {
        reasonCodes.push("PAGE_REQUEST_TEMPLATE_REQUIRED");
    }
    if (input.templateEvidence.observed_at === null ||
        input.templateEvidence.template_age_ms === null ||
        input.templateEvidence.template_age_ms > input.templateEvidence.freshness_window_ms) {
        reasonCodes.push("PASSIVE_CAPTURE_TEMPLATE_NOT_FRESH");
    }
    if (input.templateEvidence.profile_ref !== binding.profile_ref) {
        reasonCodes.push("PASSIVE_CAPTURE_PROFILE_MISMATCH");
    }
    if (input.templateEvidence.session_id !== binding.session_id) {
        reasonCodes.push("PASSIVE_CAPTURE_SESSION_MISMATCH");
    }
    if (binding.target_tab_id === null) {
        reasonCodes.push("TARGET_TAB_BINDING_REQUIRED");
    }
    if (input.templateEvidence.target_tab_id !== binding.target_tab_id) {
        reasonCodes.push("PASSIVE_CAPTURE_TAB_MISMATCH");
    }
    if (input.templateEvidence.run_id !== binding.run_id) {
        reasonCodes.push("PASSIVE_CAPTURE_RUN_MISMATCH");
    }
    if (input.templateEvidence.action_ref !== binding.action_ref) {
        reasonCodes.push("PASSIVE_CAPTURE_ACTION_MISMATCH");
    }
    if (input.templateEvidence.page_url !== binding.page_url) {
        reasonCodes.push("PASSIVE_CAPTURE_PAGE_MISMATCH");
    }
    if (input.signedContinuity.token_presence !== "present" || !input.signedContinuity.target_url) {
        reasonCodes.push("SIGNED_CONTINUITY_REQUIRED");
    }
    if (reasonCodes.length === 0) {
        return {
            gate_decision: "allowed",
            reason_codes: [],
            route_evidence_class: "active_api_fetch_fallback",
            template_binding: {
                ...binding,
                runtime_attestation: runtimeAttestation,
                fingerprint_attestation: fingerprintAttestation
            },
            consumed_template: input.templateEvidence
        };
    }
    return {
        gate_decision: "blocked",
        reason_codes: reasonCodes,
        route_evidence_class: "active_api_fetch_fallback",
        template_binding: {
            ...binding,
            runtime_attestation: runtimeAttestation,
            fingerprint_attestation: fingerprintAttestation
        },
        consumed_template: input.templateEvidence
    };
};
const failClosedForActiveApiFetchFallbackGate = (input, env) => {
    const message = `active_api_fetch_fallback 门禁阻断了当前 ${input.spec.command} 请求`;
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: "ACTIVE_API_FETCH_FALLBACK_GATE_BLOCKED",
        request_context_shape: input.expectedShape,
        request_context_shape_key: serializeReadShape(input.expectedShape),
        active_api_fetch_fallback_gate: input.gateResult
    }, createReadObservability({
        spec: input.spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId: `req-${env.randomId()}`,
        outcome: "failed",
        failureReason: "ACTIVE_API_FETCH_FALLBACK_GATE_BLOCKED",
        includeKeyRequest: false,
        failureSite: {
            stage: "execution",
            component: "gate",
            target: "xhs.active_api_fetch_fallback_gate",
            summary: message
        }
    }), createReadDiagnosis(input.spec, {
        reason: "ACTIVE_API_FETCH_FALLBACK_GATE_BLOCKED",
        summary: message,
        category: "page_changed"
    }), input.gate, input.auditRecord), input.gate.execution_audit);
};
const resolveRequestContextFailureSurface = (spec, lookupResult) => {
    const isIncompatible = lookupResult.state === "incompatible" || lookupResult.reason === "shape_mismatch";
    if (lookupResult.state === "error") {
        return {
            resultKind: "request_context_missing",
            message: `当前页面现场请求上下文读取失败，无法继续执行 ${spec.command}`,
            reasonCode: "REQUEST_CONTEXT_READ_FAILED"
        };
    }
    const rejectedSourceMessage = lookupResult.state === "rejected_source"
        ? resolveRejectedSourceMessage(spec, lookupResult.reason)
        : null;
    const resultKind = isIncompatible ? "request_context_incompatible" : "request_context_missing";
    const message = rejectedSourceMessage ??
        (isIncompatible
            ? `当前页面现场不存在与 ${spec.command} 完全一致的请求上下文`
            : `当前页面现场缺少可复用的 ${spec.command} 请求上下文`);
    const reasonCode = rejectedSourceMessage && BACKEND_REJECTED_SOURCE_REASONS.has(lookupResult.reason)
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
const readCapturedReadContextWithRetry = async (spec, expectedShape, env, binding) => {
    const readCapturedRequestContext = env.readCapturedRequestContext;
    if (!readCapturedRequestContext) {
        return resolveReadRequestContext(spec, null, expectedShape, env.now());
    }
    let pageContextNamespace = createPageContextNamespace(env.getLocationHref());
    const lookupOnce = async () => {
        try {
            const result = await readCapturedRequestContext({
                method: spec.method,
                path: spec.endpoint,
                page_context_namespace: pageContextNamespace,
                shape_key: serializeReadShape(expectedShape),
                ...(typeof binding?.profile_ref === "string" ? { profile_ref: binding.profile_ref } : {}),
                ...(typeof binding?.session_id === "string" ? { session_id: binding.session_id } : {}),
                ...(typeof binding?.target_tab_id === "number" ? { target_tab_id: binding.target_tab_id } : {}),
                ...(typeof binding?.run_id === "string" ? { run_id: binding.run_id } : {}),
                ...(typeof binding?.action_ref === "string" ? { action_ref: binding.action_ref } : {}),
                ...(typeof binding?.page_url === "string" ? { page_url: binding.page_url } : {})
            });
            const nextNamespace = asString(asRecord(result)?.page_context_namespace);
            if (nextNamespace) {
                pageContextNamespace = nextNamespace;
            }
            return resolveReadRequestContext(spec, result, expectedShape, env.now());
        }
        catch (error) {
            return {
                state: "error",
                reason: "request_context_read_failed",
                detail: error instanceof Error ? error.message : String(error)
            };
        }
    };
    let lastResult = await lookupOnce();
    for (let attempt = 1; attempt < REQUEST_CONTEXT_WAIT_MAX_ATTEMPTS && lastResult.state !== "hit"; attempt += 1) {
        await waitForRequestContextRetry(env, REQUEST_CONTEXT_WAIT_RETRY_MS);
        lastResult = await lookupOnce();
    }
    return lastResult;
};
const withExecutionAuditInFailurePayload = (result, executionAudit) => {
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
const classifyPageKind = (href, fallback) => {
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
const createReadObservability = (input) => ({
    page_state: {
        page_kind: classifyPageKind(input.href, input.spec.pageKind),
        url: input.href,
        title: input.title,
        ready_state: input.readyState
    },
    key_requests: input.includeKeyRequest === false
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
    failure_site: input.outcome === "failed"
        ? (input.failureSite ?? {
            stage: "request",
            component: "network",
            target: input.spec.endpoint,
            summary: input.failureReason ?? "request failed"
        })
        : null
});
const inferReadFailure = (spec, status, body) => {
    const record = asRecord(body);
    const businessCode = asInteger(record?.code);
    const message = typeof record?.msg === "string"
        ? record.msg
        : typeof record?.message === "string"
            ? record.message
            : "";
    const normalized = `${message}`.toLowerCase();
    const hasCaptchaEvidence = normalized.includes("captcha") ||
        message.includes("验证码") ||
        message.includes("人机验证") ||
        message.includes("滑块");
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
    if (hasCaptchaEvidence) {
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
const inferReadRequestException = (spec, error) => {
    const errorName = typeof error === "object" && error !== null && "name" in error
        ? String(error.name)
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
const containsTargetIdentifier = (value, target, candidateKeys) => {
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
const collectCandidateRecords = (value) => {
    const record = asRecord(value);
    if (record) {
        return [record];
    }
    const array = asArray(value);
    if (array) {
        return array.map((entry) => asRecord(entry)).filter((entry) => entry !== null);
    }
    return [];
};
const collectNestedRecordCandidates = (value, nestedKeys, seen = new Set()) => {
    const directCandidates = collectCandidateRecords(value);
    const nestedCandidates = [];
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
const hasDetailDataShape = (record) => [
    "title",
    "desc",
    "user",
    "interact_info",
    "image_list",
    "video_info",
    "note_card",
    "note_card_list"
].some((key) => key in record);
const hasUserDataShape = (record) => [
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
const getDetailResponseCandidates = (body) => {
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
const getUserHomeResponseCandidates = (body) => {
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
const responseContainsRequestedTarget = (spec, params, body) => {
    if (spec.command === "xhs.detail") {
        return getDetailResponseCandidates(body).some((candidate) => containsTargetIdentifier(candidate, params.note_id, [
            "note_id",
            "noteId"
        ]));
    }
    return getUserHomeResponseCandidates(body).some((candidate) => containsTargetIdentifier(candidate, params.user_id, [
        "user_id",
        "userId"
    ]));
};
const createReadDiagnosis = (spec, input) => {
    const diagnosis = createDiagnosis(input);
    const failureSite = asRecord(diagnosis.failure_site);
    const shouldUseEndpointTarget = (typeof failureSite?.component === "string" ? failureSite.component : null) === "network";
    return {
        ...diagnosis,
        failure_site: {
            ...(failureSite ?? {}),
            ...(shouldUseEndpointTarget ? { target: spec.endpoint } : {}),
            summary: input.summary
        }
    };
};
const hasDetailPageStateFallback = (params, root) => {
    const note = asRecord(root?.note);
    const noteDetailMap = asRecord(note?.noteDetailMap);
    return asRecord(noteDetailMap?.[params.note_id]) !== null;
};
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const hasUserHomePageStateFallback = (params, root) => {
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
    ].filter((value) => value !== null);
    if (!candidateUserIds.some((userId) => userId === params.user_id)) {
        return false;
    }
    return (asRecord(root?.board) !== null ||
        asRecord(root?.note) !== null ||
        hasUserHomeResponseDataShape(user) ||
        asRecord(user.basic_info) !== null ||
        asRecord(user.basicInfo) !== null ||
        asRecord(user.profile) !== null);
};
const canUsePageStateFallback = (spec, params, root) => spec.command === "xhs.detail"
    ? hasDetailPageStateFallback(params, root)
    : hasUserHomePageStateFallback(params, root);
const createPageStateFallbackFailure = (input, spec, gate, auditRecord, env, payload, startedAt, requestFailure) => {
    const requestId = `req-${env.randomId()}`;
    const requestAttempted = requestFailure.requestAttempted !== false;
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", requestFailure.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: requestFailure.reason,
        ...(typeof requestFailure.statusCode === "number" ? { status_code: requestFailure.statusCode } : {}),
        ...(typeof requestFailure.platformCode === "number" ? { platform_code: requestFailure.platformCode } : {}),
        ...(requestFailure.requestContextDetails ?? {})
    }, {
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
        failure_site: requestFailure.failureSite ??
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
    }, createReadDiagnosis(spec, {
        reason: requestFailure.reason,
        summary: requestFailure.message
    }), gate, auditRecord), gate.execution_audit);
};
const createGateOnlySuccess = (input, spec, gate, auditRecord, env, payload) => ({
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
const resolveSimulatedResult = (input, spec, payload, env, gate, auditRecord) => {
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
    const simulatedReasonMap = {
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
    const mapped = simulatedReasonMap[input.options.simulate_result] ??
        inferReadFailure(spec, input.options.simulate_result === "account_abnormal" ? 461 : 500, {
            code: input.options.simulate_result === "account_abnormal" ? 300011 : undefined,
            msg: input.options.simulate_result === "browser_env_abnormal"
                ? "Browser environment abnormal"
                : input.options.simulate_result === "gateway_invoker_failed"
                    ? "create invoker failed"
                    : input.options.simulate_result
        });
    return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", mapped.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: mapped.reason
    }, createReadObservability({
        spec,
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        readyState: env.getReadyState(),
        requestId,
        outcome: "failed",
        ...(typeof mapped.statusCode === "number" ? { statusCode: mapped.statusCode } : {}),
        failureReason: input.options.simulate_result
    }), createReadDiagnosis(spec, {
        reason: mapped.reason,
        summary: mapped.message
    }), gate, auditRecord), gate?.execution_audit ?? null);
};
const buildHeaders = (env, options, signature, capturedHeaders) => ({
    Accept: getCapturedHeader(capturedHeaders ?? {}, "Accept") ?? "application/json, text/plain, */*",
    ...(options.target_domain === "www.xiaohongshu.com" || options.target_domain === undefined
        ? {}
        : {}),
    ...(signature
        ? {
            "X-s": String(signature["X-s"]),
            "X-t": String(signature["X-t"]),
            "X-S-Common": getCapturedHeader(capturedHeaders ?? {}, "X-S-Common") ??
                options.x_s_common ??
                resolveXsCommon(undefined),
            "x-b3-traceid": env.randomId().replace(/-/g, ""),
            "x-xray-traceid": env.randomId().replace(/-/g, "")
        }
        : {}),
    "Content-Type": getCapturedHeader(capturedHeaders ?? {}, "Content-Type") ?? "application/json;charset=utf-8"
});
const executeXhsRead = async (input, spec, env) => {
    const gate = resolveGate(input.options, input.executionContext, env.getLocationHref());
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const startedAt = env.now();
    const builtPayload = spec.buildPayload(input.params, env);
    const resolvePageStateRoot = async () => {
        const mainWorldState = typeof env.readPageStateRoot === "function"
            ? await env.readPageStateRoot().catch(() => null)
            : null;
        const mainWorldRecord = asRecord(mainWorldState);
        if (mainWorldRecord) {
            return mainWorldRecord;
        }
        return asRecord(env.getPageStateRoot?.());
    };
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `执行模式门禁阻断了当前 ${spec.command} 请求`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, createReadObservability({
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
        }), createReadDiagnosis(spec, {
            reason: "EXECUTION_MODE_GATE_BLOCKED",
            summary: "执行模式门禁阻断"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
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
    const accountSafetySurface = classifyXhsAccountSafetySurface({
        href: env.getLocationHref(),
        title: env.getDocumentTitle(),
        bodyText: env.getBodyText?.(),
        overlay: env.getAccountSafetyOverlay?.()
    });
    if (accountSafetySurface) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", accountSafetySurface.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: accountSafetySurface.reason,
            page_url: env.getLocationHref()
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: accountSafetySurface.reason,
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "xhs.account_safety_surface",
                summary: accountSafetySurface.message
            }
        }), createReadDiagnosis(spec, {
            reason: accountSafetySurface.reason,
            summary: accountSafetySurface.message,
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `登录态缺失，无法执行 ${spec.command}`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createReadDiagnosis(spec, {
            reason: "SESSION_EXPIRED",
            summary: `登录态缺失，无法执行 ${spec.command}`
        }), gate, auditRecord), gate.execution_audit);
    }
    const expectedShape = deriveReadShapeFromCommand(spec, input.params);
    const activeFallbackBinding = buildActiveFallbackTemplateBinding({
        executionContext: input.executionContext,
        options: input.options,
        abilityAction: input.abilityAction,
        pageUrl: env.getLocationHref()
    });
    const requestContextResult = await readCapturedReadContextWithRetry(spec, expectedShape, env, activeFallbackBinding);
    if (requestContextResult.state !== "hit") {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            const failureSurface = resolveRequestContextFailureSurface(spec, requestContextResult);
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, builtPayload, startedAt, {
                reason: failureSurface.reasonCode,
                message: failureSurface.message,
                detail: requestContextResult.reason,
                statusCode: requestContextResult.state === "rejected_source" ? (requestContextResult.statusCode ?? undefined) : undefined,
                platformCode: requestContextResult.state === "rejected_source"
                    ? (requestContextResult.platformCode ?? undefined)
                    : undefined,
                requestAttempted: requestContextResult.state === "rejected_source" &&
                    BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason),
                failureSite: {
                    stage: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? "request"
                        : "execution",
                    component: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? "network"
                        : "page",
                    target: requestContextResult.state === "rejected_source" &&
                        BACKEND_REJECTED_SOURCE_REASONS.has(requestContextResult.reason)
                        ? spec.endpoint
                        : "captured_request_context",
                    summary: failureSurface.message
                },
                requestContextDetails: {
                    request_context_result: failureSurface.resultKind,
                    request_context_lookup_state: requestContextResult.state,
                    request_context_miss_reason: requestContextResult.reason,
                    request_context_shape: expectedShape,
                    request_context_shape_key: serializeReadShape(expectedShape),
                    ...(requestContextResult.state === "rejected_source" &&
                        typeof requestContextResult.statusCode === "number"
                        ? { status_code: requestContextResult.statusCode }
                        : {}),
                    ...(requestContextResult.state === "rejected_source" &&
                        typeof requestContextResult.platformCode === "number"
                        ? { platform_code: requestContextResult.platformCode }
                        : {}),
                    ...("shape" in requestContextResult && requestContextResult.shape
                        ? { captured_request_shape: requestContextResult.shape }
                        : {})
                }
            });
        }
        return failClosedForRequestContext({
            abilityId: input.abilityId,
            spec,
            expectedShape,
            lookupResult: requestContextResult,
            gate,
            auditRecord
        }, env);
    }
    const requestPayload = requestContextResult.requestBody ?? builtPayload;
    const requestUrl = requestContextResult.requestUrl ?? spec.buildUrl(input.params);
    const signatureUri = requestContextResult.requestUrl ?? spec.buildSignatureUri(input.params);
    const continuityFailure = resolveSignedContinuityFailure(requestContextResult.signedContinuity, requestContextResult.observedAt, env.now(), env.getLocationHref());
    if (continuityFailure) {
        return failClosedForSignedContinuity({
            abilityId: input.abilityId,
            spec,
            expectedShape,
            reason: continuityFailure,
            continuity: requestContextResult.signedContinuity,
            gate,
            auditRecord
        }, env);
    }
    const activeFallbackGate = resolveActiveApiFetchFallbackGate({
        executionInput: input,
        templateEvidence: requestContextResult.templateEvidence,
        signedContinuity: requestContextResult.signedContinuity,
        env
    });
    if (activeFallbackGate.gate_decision !== "allowed") {
        return failClosedForActiveApiFetchFallbackGate({
            abilityId: input.abilityId,
            spec,
            expectedShape,
            gateResult: activeFallbackGate,
            gate,
            auditRecord
        }, env);
    }
    let signature;
    try {
        signature = await env.callSignature(signatureUri, requestPayload);
    }
    catch (error) {
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
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SIGNATURE_ENTRY_MISSING"
        }, createReadObservability({
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
        }), createReadDiagnosis(spec, {
            reason: "SIGNATURE_ENTRY_MISSING",
            summary: "页面签名入口不可用",
            category: "page_changed"
        }), gate, auditRecord), gate.execution_audit);
    }
    let response;
    try {
        response = await env.fetchJson({
            url: requestUrl,
            method: spec.method,
            headers: buildHeaders(env, input.options, signature, requestContextResult.headers),
            ...(spec.method === "POST" ? { body: JSON.stringify(requestPayload) } : {}),
            pageContextRequest: true,
            referrer: requestContextResult.referrer ?? env.getLocationHref(),
            referrerPolicy: "strict-origin-when-cross-origin",
            timeoutMs: typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
                ? Math.max(1, Math.floor(input.options.timeout_ms))
                : 30_000
        });
    }
    catch (error) {
        const failure = inferReadRequestException(spec, error);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.detail
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            failureReason: failure.detail
        }), createReadDiagnosis(spec, {
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = asInteger(responseRecord?.code);
    if (response.status >= 400 || (businessCode !== null && businessCode !== 0)) {
        const failure = inferReadFailure(spec, response.status, response.body);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, requestPayload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.message,
                statusCode: response.status,
                platformCode: businessCode ?? undefined
            });
        }
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason,
            status_code: response.status,
            ...(businessCode !== null ? { platform_code: businessCode } : {})
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            statusCode: response.status,
            failureReason: failure.reason
        }), createReadDiagnosis(spec, {
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord), gate.execution_audit);
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
        return withExecutionAuditInFailurePayload(createFailure("ERR_EXECUTION_FAILED", `${spec.command} 接口返回成功但未包含目标数据`, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "TARGET_DATA_NOT_FOUND"
        }, createReadObservability({
            spec,
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
            outcome: "failed",
            statusCode: response.status,
            failureReason: "TARGET_DATA_NOT_FOUND"
        }), createReadDiagnosis(spec, {
            reason: "TARGET_DATA_NOT_FOUND",
            summary: `${spec.command} 接口返回成功但未包含目标数据`
        }), gate, auditRecord), gate.execution_audit);
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
                audit_record: auditRecord,
                signed_continuity: requestContextResult.signedContinuity,
                route_evidence: activeFallbackGate
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
const executeXhsDetail = async (input, env) => executeXhsRead({
    command: "xhs.detail",
    ...input
}, READ_COMMAND_SPECS["xhs.detail"], env);
const executeXhsUserHome = async (input, env) => executeXhsRead({
    command: "xhs.user_home",
    ...input
}, READ_COMMAND_SPECS["xhs.user_home"], env);
return { executeXhsDetail, executeXhsUserHome };
})();
const __webenvoy_module_xhs_detail = (() => {
const { executeXhsDetail: executeXhsDetailImpl } = __webenvoy_module_xhs_read_execution;
function executeXhsDetail(...args) {
    return executeXhsDetailImpl(...args);
}
return { executeXhsDetail };
})();
const __webenvoy_module_xhs_user_home = (() => {
const { executeXhsUserHome: executeXhsUserHomeImpl } = __webenvoy_module_xhs_read_execution;
function executeXhsUserHome(...args) {
    return executeXhsUserHomeImpl(...args);
}
return { executeXhsUserHome };
})();
const __webenvoy_module_xhs_editor_input = (() => {
const TARGET_PAGE = "creator.xiaohongshu.com/publish";
const BASE_MINIMUM_REPLAY = ["focus_editor", "type_short_text", "blur_or_reobserve"];
const ARTICLE_EDIT_MODE_REPLAY_STEP = "enter_editable_mode";
const EDITOR_MODE_ENTRY_LABELS = ["新的创作"];
const EDITOR_MODE_ENTRY_WAIT_MS = 200;
const EDITOR_MODE_ENTRY_MAX_ATTEMPTS = 10;
const EDITOR_SELECTORS = [
    'div.tiptap.ProseMirror[contenteditable="true"]',
    '[contenteditable="true"].tiptap.ProseMirror',
    '[contenteditable="true"].ProseMirror',
    '[contenteditable="true"][data-lexical-editor="true"]'
];
const asHTMLElement = (value) => value instanceof HTMLElement ? value : null;
const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none");
};
const buildLocator = (element) => {
    if (element.id) {
        return `#${element.id}`;
    }
    const className = typeof element.className === "string"
        ? element.className
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
            .slice(0, 2)
            .join(".")
        : "";
    if (className) {
        return `${element.tagName.toLowerCase()}.${className}`;
    }
    return element.tagName.toLowerCase();
};
const buildTargetKey = (element) => {
    const segments = [];
    let current = element;
    while (current) {
        const parent = current.parentElement;
        const tagName = current.tagName.toLowerCase();
        if (!parent) {
            segments.unshift(current.id ? `${tagName}#${current.id}` : tagName);
            break;
        }
        const siblings = [...parent.children].filter((candidate) => candidate instanceof HTMLElement && candidate.tagName === current?.tagName);
        const position = siblings.indexOf(current) + 1;
        const idSegment = current.id ? `#${current.id}` : "";
        segments.unshift(`${tagName}${idSegment}:nth-of-type(${position})`);
        current = parent;
    }
    return segments.join(" > ");
};
const collectSearchRoots = (root) => {
    const roots = [root];
    const descendants = [...root.querySelectorAll("*")];
    for (const element of descendants) {
        if (element.shadowRoot) {
            roots.push(...collectSearchRoots(element.shadowRoot));
        }
    }
    const iframes = [...root.querySelectorAll("iframe")];
    for (const iframe of iframes) {
        try {
            const frameDocument = iframe.contentDocument;
            if (frameDocument) {
                roots.push(...collectSearchRoots(frameDocument));
            }
        }
        catch {
            continue;
        }
    }
    return roots;
};
const findEditorElements = () => {
    const seen = new Set();
    const results = [];
    const roots = collectSearchRoots(document);
    for (const selector of EDITOR_SELECTORS) {
        for (const searchRoot of roots) {
            const candidates = [...searchRoot.querySelectorAll(selector)]
                .map((entry) => asHTMLElement(entry))
                .filter((entry) => entry !== null && isVisible(entry));
            for (const candidate of candidates) {
                if (seen.has(candidate)) {
                    continue;
                }
                seen.add(candidate);
                results.push(candidate);
            }
        }
    }
    return results;
};
const readElementText = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        return element.value;
    }
    return element.textContent?.trim() ?? "";
};
const createBubbledEvent = (type) => new Event(type, { bubbles: true });
const createBubbledInputEvent = (type, text) => {
    if (typeof InputEvent === "function") {
        try {
            return new InputEvent(type, { bubbles: true, data: text, inputType: "insertText" });
        }
        catch {
            // Fall back to a generic Event in test environments without a full InputEvent implementation.
        }
    }
    return createBubbledEvent(type);
};
const createBubbledCompositionEvent = (type, text) => {
    if (typeof CompositionEvent === "function") {
        try {
            return new CompositionEvent(type, { bubbles: true, data: text });
        }
        catch {
            // Fall back to a generic Event in test environments without a full CompositionEvent implementation.
        }
    }
    return createBubbledEvent(type);
};
const dispatchSyntheticTextInputSequence = (element, text) => {
    element.dispatchEvent(createBubbledCompositionEvent("compositionstart", text));
    element.dispatchEvent(createBubbledCompositionEvent("compositionupdate", text));
    element.dispatchEvent(createBubbledInputEvent("beforeinput", text));
    element.dispatchEvent(createBubbledCompositionEvent("compositionend", text));
    element.dispatchEvent(createBubbledInputEvent("input", text));
    element.dispatchEvent(createBubbledEvent("change"));
};
const appendTextToEditable = (element, text) => {
    const current = readElementText(element);
    const next = current.length > 0 ? `${current} ${text}` : text;
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        dispatchSyntheticTextInputSequence(element, text);
        element.value = next;
        return readElementText(element).includes(text);
    }
    const selection = window.getSelection();
    if (selection) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        selection.removeAllRanges();
        selection.addRange(range);
    }
    let inserted = false;
    if (typeof document.execCommand === "function") {
        try {
            inserted = document.execCommand("insertText", false, current.length > 0 ? ` ${text}` : text);
        }
        catch {
            inserted = false;
        }
    }
    dispatchSyntheticTextInputSequence(element, text);
    if (!inserted) {
        return false;
    }
    return readElementText(element).includes(text);
};
const findVisibleButtonByLabels = (scope, labels) => {
    const buttons = [...scope.querySelectorAll("button, [role='button']")]
        .map((entry) => asHTMLElement(entry))
        .filter((entry) => entry !== null && isVisible(entry));
    for (const button of buttons) {
        const text = button.innerText?.trim() ?? button.textContent?.trim() ?? "";
        if (labels.some((label) => text.includes(label))) {
            return button;
        }
    }
    return null;
};
const sleep = async (timeoutMs) => {
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));
};
const buildMinimumReplay = (activation) => activation === "activated"
    ? [ARTICLE_EDIT_MODE_REPLAY_STEP, ...BASE_MINIMUM_REPLAY]
    : [...BASE_MINIMUM_REPLAY];
const resolveActivationFromAttestation = (attestation) => {
    if (!attestation) {
        return "already_ready";
    }
    return attestation.editable_state === "entered" ? "activated" : "already_ready";
};
const normalizeFocusAttestationFailure = (attestation) => {
    if (!attestation) {
        return ["missing_focus_attestation"];
    }
    if (attestation.failure_reason === "EDITOR_ENTRY_NOT_VISIBLE") {
        return ["editable_state_entry_missing"];
    }
    if (attestation.failure_reason === "EDITOR_FOCUS_NOT_ATTESTED") {
        return ["editor_focus_not_attested"];
    }
    if (attestation.failure_reason === "DEBUGGER_ATTACH_FAILED") {
        return ["debugger_attach_failed", "editor_focus_not_attested"];
    }
    if (attestation.failure_reason === "DEBUGGER_INTERACTION_FAILED") {
        return ["debugger_interaction_failed", "editor_focus_not_attested"];
    }
    return ["editor_focus_not_attested"];
};
const resolveAttestedTargetBinding = (attestation, targetKey) => {
    if (!attestation || attestation.focus_confirmed !== true) {
        return { focusConfirmed: false, bindingFailureSignal: null };
    }
    if (typeof attestation.editor_target_key !== "string" || attestation.editor_target_key.length === 0) {
        return { focusConfirmed: false, bindingFailureSignal: "ambiguous_editor_target" };
    }
    return {
        focusConfirmed: attestation.editor_target_key === targetKey,
        bindingFailureSignal: attestation.editor_target_key === targetKey ? null : "ambiguous_editor_target"
    };
};
const isTargetPage = () => window.location.href.includes(TARGET_PAGE);
const isArticleTargetPage = () => {
    if (!isTargetPage()) {
        return false;
    }
    try {
        const url = new URL(window.location.href);
        return url.searchParams.get("target") === "article";
    }
    catch {
        return false;
    }
};
const enterEditableStateIfNeeded = async () => {
    if (!isArticleTargetPage()) {
        return "already_ready";
    }
    if (findEditorElements().length > 0) {
        return "already_ready";
    }
    const createButton = findVisibleButtonByLabels(document, EDITOR_MODE_ENTRY_LABELS);
    if (!createButton) {
        return "entry_missing";
    }
    createButton.click();
    for (let attempt = 0; attempt < EDITOR_MODE_ENTRY_MAX_ATTEMPTS; attempt += 1) {
        await Promise.resolve();
        await sleep(EDITOR_MODE_ENTRY_WAIT_MS);
        await Promise.resolve();
        if (findEditorElements().length > 0) {
            return "activated";
        }
    }
    return "activation_failed";
};
const performEditorInputValidation = async (input) => {
    const focusAttestation = input.focusAttestation ?? null;
    const activation = focusAttestation
        ? resolveActivationFromAttestation(focusAttestation)
        : await enterEditableStateIfNeeded();
    const editors = findEditorElements();
    const minimumReplay = buildMinimumReplay(activation);
    if (isTargetPage() && !isArticleTargetPage()) {
        return {
            ok: false,
            mode: "dom_editor_input_validation",
            attestation: "dom_self_certified",
            editor_locator: null,
            input_text: input.text,
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: ["target_page_article_required", "dom_variant"],
            minimum_replay: minimumReplay
        };
    }
    if (editors.length === 0) {
        const failureSignals = activation === "entry_missing"
            ? ["editable_state_entry_missing", "dom_variant"]
            : activation === "activation_failed"
                ? ["editable_state_not_entered", "dom_variant"]
                : [...normalizeFocusAttestationFailure(focusAttestation), "dom_variant"];
        return {
            ok: false,
            mode: "dom_editor_input_validation",
            attestation: "dom_self_certified",
            editor_locator: null,
            input_text: input.text,
            before_text: "",
            visible_text: "",
            post_blur_text: "",
            focus_confirmed: false,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: false,
            success_signals: [],
            failure_signals: failureSignals,
            minimum_replay: minimumReplay
        };
    }
    const normalizedPageText = document.body?.innerText ?? "";
    let bestAttempt = null;
    for (const editor of editors) {
        const beforeText = readElementText(editor);
        const locator = buildLocator(editor);
        const targetKey = buildTargetKey(editor);
        const { focusConfirmed, bindingFailureSignal } = resolveAttestedTargetBinding(focusAttestation, targetKey);
        const textInserted = focusConfirmed ? appendTextToEditable(editor, input.text) : false;
        await Promise.resolve();
        const visibleText = readElementText(editor);
        if (typeof editor.blur === "function") {
            editor.blur();
        }
        await Promise.resolve();
        const postBlurText = readElementText(editor);
        const preservedAfterBlur = postBlurText.includes(input.text);
        const successSignals = activation === "activated" ? ["editable_state_entered"] : [];
        const failureSignals = [];
        if (focusConfirmed) {
            successSignals.push("editor_focus_attested");
        }
        else {
            failureSignals.push(...normalizeFocusAttestationFailure(focusAttestation));
            if (bindingFailureSignal) {
                failureSignals.push(bindingFailureSignal);
            }
        }
        if (textInserted && visibleText.includes(input.text)) {
            successSignals.push("text_visible");
        }
        else {
            failureSignals.push("dom_variant");
        }
        if (preservedAfterBlur) {
            successSignals.push("text_persisted_after_blur");
        }
        else {
            failureSignals.push("text_reverted");
        }
        if (/风险|risk|提示|异常/u.test(normalizedPageText)) {
            failureSignals.push("risk_prompt");
        }
        const hasBlockingFailure = failureSignals.includes("text_reverted") ||
            failureSignals.includes("risk_prompt") ||
            failureSignals.includes("dom_variant");
        const controlledSuccess = focusAttestation?.source === "chrome_debugger" &&
            focusConfirmed &&
            textInserted &&
            visibleText.includes(input.text) &&
            preservedAfterBlur &&
            !hasBlockingFailure;
        const attempt = {
            ok: controlledSuccess,
            mode: controlledSuccess
                ? "controlled_editor_input_validation"
                : "dom_editor_input_validation",
            attestation: controlledSuccess ? "controlled_real_interaction" : "dom_self_certified",
            editor_locator: locator,
            input_text: input.text,
            before_text: beforeText,
            visible_text: visibleText,
            post_blur_text: postBlurText,
            focus_confirmed: focusConfirmed,
            focus_attestation_source: focusAttestation?.source ?? null,
            focus_attestation_reason: focusAttestation?.failure_reason ?? null,
            preserved_after_blur: preservedAfterBlur,
            success_signals: successSignals,
            failure_signals: failureSignals,
            minimum_replay: minimumReplay
        };
        if (attempt.ok) {
            return attempt;
        }
        if (!bestAttempt || attempt.success_signals.length > bestAttempt.success_signals.length) {
            bestAttempt = attempt;
        }
    }
    return (bestAttempt ?? {
        ok: false,
        mode: "dom_editor_input_validation",
        attestation: "dom_self_certified",
        editor_locator: null,
        input_text: input.text,
        before_text: "",
        visible_text: "",
        post_blur_text: "",
        focus_confirmed: false,
        focus_attestation_source: focusAttestation?.source ?? null,
        focus_attestation_reason: focusAttestation?.failure_reason ?? null,
        preserved_after_blur: false,
        success_signals: [],
        failure_signals: [...normalizeFocusAttestationFailure(focusAttestation), "dom_variant"],
        minimum_replay: minimumReplay
    });
};
return { performEditorInputValidation };
})();
const __webenvoy_module_xhs_command_contract = (() => {
class ExtensionContractError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "ExtensionContractError";
        this.code = code;
        this.details = details;
    }
}
const invalidAbilityInput = (reason, abilityId = "unknown") => new ExtensionContractError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    ability_id: abilityId,
    stage: "input_validation",
    reason
});
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const parseSearchInput = (payload, abilityId, options, abilityAction) => {
    const issue208EditorInputValidation = abilityAction === "write" &&
        options.issue_scope === "issue_208" &&
        options.action_type === "write" &&
        options.requested_execution_mode === "live_write" &&
        options.validation_action === "editor_input";
    if (issue208EditorInputValidation) {
        return {};
    }
    const query = asNonEmptyString(payload.query);
    if (!query) {
        throw invalidAbilityInput("QUERY_MISSING", abilityId);
    }
    const normalized = {
        query
    };
    if (typeof payload.limit === "number" && Number.isFinite(payload.limit)) {
        normalized.limit = Math.max(1, Math.floor(payload.limit));
    }
    if (typeof payload.page === "number" && Number.isFinite(payload.page)) {
        normalized.page = Math.max(1, Math.floor(payload.page));
    }
    if (asNonEmptyString(payload.search_id)) {
        normalized.search_id = asNonEmptyString(payload.search_id);
    }
    if (asNonEmptyString(payload.sort)) {
        normalized.sort = asNonEmptyString(payload.sort);
    }
    if ((typeof payload.note_type === "string" && payload.note_type.trim().length > 0) ||
        typeof payload.note_type === "number") {
        normalized.note_type = payload.note_type;
    }
    return normalized;
};
const validateXhsCommandInputForExtension = (input) => {
    if (input.command === "xhs.search") {
        return parseSearchInput(input.payload, input.abilityId, input.options, input.abilityAction);
    }
    if (input.command === "xhs.detail") {
        const noteId = asNonEmptyString(input.payload.note_id);
        if (!noteId) {
            throw invalidAbilityInput("NOTE_ID_MISSING", input.abilityId);
        }
        return { note_id: noteId };
    }
    if (input.command === "xhs.user_home") {
        const userId = asNonEmptyString(input.payload.user_id);
        if (!userId) {
            throw invalidAbilityInput("USER_ID_MISSING", input.abilityId);
        }
        return { user_id: userId };
    }
    throw invalidAbilityInput("ABILITY_COMMAND_UNSUPPORTED", input.abilityId);
};
return { ExtensionContractError, validateXhsCommandInputForExtension };
})();
const __webenvoy_module_content_script_main_world = (() => {
const {
  WEBENVOY_SYNTHETIC_REQUEST_HEADER,
  resolveActiveVisitedPageContextNamespace,
  resolveMainWorldPageContextNamespaceEventName
} = __webenvoy_module_xhs_search_types;
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const DEFAULT_MAIN_WORLD_CALL_TIMEOUT_MS = 5_000;
let mainWorldEventChannel = null;
let mainWorldResultListener = null;
let mainWorldResultListenerEventName = null;
let latestMainWorldPageContextNamespace = null;
let mainWorldPageContextNamespaceListener = null;
let mainWorldPageContextNamespaceListenerEventName = null;
const pendingMainWorldRequests = new Map();
const encodeUtf8Base64 = (value) => {
    if (typeof btoa === "function") {
        return btoa(unescape(encodeURIComponent(value)));
    }
    const bufferCtor = globalThis.Buffer;
    if (bufferCtor) {
        return bufferCtor.from(value, "utf8").toString("base64");
    }
    throw new Error("base64 encoder is unavailable");
};
const encodeMainWorldPayload = (value) => encodeUtf8Base64(JSON.stringify(value));
const hashMainWorldEventChannel = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};
const normalizeMainWorldSecret = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const createMainWorldBootstrapDetail = (secret) => {
    const names = resolveMainWorldEventNamesForSecret(secret);
    return {
        request_event: names.requestEvent,
        result_event: names.resultEvent,
        namespace_event: names.namespaceEvent
    };
};
const emitMainWorldBootstrap = (secret) => {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
        return;
    }
    window.dispatchEvent(createWindowEvent(MAIN_WORLD_EVENT_BOOTSTRAP, createMainWorldBootstrapDetail(secret)));
};
const resolveMainWorldEventNamesForSecret = (secret) => {
    const hashed = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
    return {
        requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${hashed}`,
        resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${hashed}`,
        namespaceEvent: resolveMainWorldPageContextNamespaceEventName(secret)
    };
};
const createWindowEvent = (type, detail) => {
    const CustomEventCtor = globalThis.CustomEvent;
    if (typeof CustomEventCtor === "function") {
        return new CustomEventCtor(type, { detail });
    }
    return { type, detail };
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const installMainWorldPageContextNamespaceListener = (eventName) => {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
        return;
    }
    if (mainWorldPageContextNamespaceListener &&
        mainWorldPageContextNamespaceListenerEventName === eventName) {
        return;
    }
    if (mainWorldPageContextNamespaceListener && mainWorldPageContextNamespaceListenerEventName) {
        try {
            window.removeEventListener(mainWorldPageContextNamespaceListenerEventName, mainWorldPageContextNamespaceListener);
        }
        catch {
            // noop in contract environments
        }
    }
    mainWorldPageContextNamespaceListener = ((event) => {
        const detail = asRecord(event.detail);
        const namespace = detail?.page_context_namespace;
        if (typeof namespace === "string" && namespace.length > 0) {
            latestMainWorldPageContextNamespace = namespace;
        }
    });
    mainWorldPageContextNamespaceListenerEventName = eventName;
    window.addEventListener(eventName, mainWorldPageContextNamespaceListener);
};
const onMainWorldResultEvent = (event) => {
    const detail = (event.detail ?? null);
    if (!detail || typeof detail.id !== "string") {
        return;
    }
    const pending = pendingMainWorldRequests.get(detail.id);
    if (!pending) {
        return;
    }
    clearTimeout(pending.timeout);
    pendingMainWorldRequests.delete(detail.id);
    if (detail.ok === true) {
        pending.resolve(detail.result);
        return;
    }
    const message = typeof detail.message === "string" ? detail.message : "main world call failed";
    const error = new Error(message);
    if (typeof detail.error_name === "string" && detail.error_name.length > 0) {
        error.name = detail.error_name;
    }
    if (typeof detail.error_code === "string" && detail.error_code.length > 0) {
        error.code = detail.error_code;
    }
    pending.reject(error);
};
const detachMainWorldResultListener = () => {
    if (!mainWorldResultListener || !mainWorldResultListenerEventName) {
        return;
    }
    try {
        window.removeEventListener(mainWorldResultListenerEventName, mainWorldResultListener);
    }
    catch {
        // noop in contract environments
    }
    mainWorldResultListener = null;
    mainWorldResultListenerEventName = null;
};
const installMainWorldEventChannelSecret = (secret) => {
    const normalizedSecret = normalizeMainWorldSecret(secret);
    if (typeof window === "undefined" ||
        typeof window.addEventListener !== "function" ||
        typeof window.dispatchEvent !== "function") {
        detachMainWorldResultListener();
        mainWorldEventChannel = null;
        return false;
    }
    if (!normalizedSecret) {
        detachMainWorldResultListener();
        mainWorldEventChannel = null;
        return false;
    }
    const names = resolveMainWorldEventNamesForSecret(normalizedSecret);
    installMainWorldPageContextNamespaceListener(names.namespaceEvent);
    if (mainWorldEventChannel?.secret === normalizedSecret &&
        mainWorldResultListenerEventName === names.resultEvent) {
        return true;
    }
    detachMainWorldResultListener();
    window.addEventListener(names.resultEvent, onMainWorldResultEvent);
    mainWorldEventChannel = {
        secret: normalizedSecret,
        requestEvent: names.requestEvent,
        resultEvent: names.resultEvent,
        namespaceEvent: names.namespaceEvent
    };
    mainWorldResultListener = onMainWorldResultEvent;
    mainWorldResultListenerEventName = names.resultEvent;
    emitMainWorldBootstrap(normalizedSecret);
    return true;
};
const resetMainWorldEventChannelForContract = () => {
    for (const pending of pendingMainWorldRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("main world request reset"));
    }
    pendingMainWorldRequests.clear();
    latestMainWorldPageContextNamespace = null;
    if (mainWorldPageContextNamespaceListener &&
        mainWorldPageContextNamespaceListenerEventName &&
        typeof window !== "undefined" &&
        typeof window.removeEventListener === "function") {
        try {
            window.removeEventListener(mainWorldPageContextNamespaceListenerEventName, mainWorldPageContextNamespaceListener);
        }
        catch {
            // noop in contract environments
        }
    }
    mainWorldPageContextNamespaceListener = null;
    mainWorldPageContextNamespaceListenerEventName = null;
    detachMainWorldResultListener();
    mainWorldEventChannel = null;
};
const mainWorldCall = async (request) => {
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `mw-${Date.now()}`;
    return await new Promise((resolve, reject) => {
        if (!mainWorldEventChannel ||
            typeof window === "undefined" ||
            typeof window.dispatchEvent !== "function") {
            reject(new Error("main world event channel unavailable"));
            return;
        }
        emitMainWorldBootstrap(mainWorldEventChannel.secret);
        const responseTimeoutMs = DEFAULT_MAIN_WORLD_CALL_TIMEOUT_MS;
        const timeout = setTimeout(() => {
            pendingMainWorldRequests.delete(requestId);
            reject(new Error("main world event channel response timeout"));
        }, responseTimeoutMs);
        pendingMainWorldRequests.set(requestId, {
            resolve: (value) => resolve(value),
            reject,
            timeout
        });
        const requestDetail = {
            id: requestId,
            ...request
        };
        try {
            window.dispatchEvent(createWindowEvent(mainWorldEventChannel.requestEvent, requestDetail));
        }
        catch (error) {
            clearTimeout(timeout);
            pendingMainWorldRequests.delete(requestId);
            reject(error);
        }
    });
};
const installFingerprintRuntimeViaMainWorld = async (fingerprintRuntime) => await mainWorldCall({
    type: "fingerprint-install",
    payload: {
        fingerprint_runtime: fingerprintRuntime
    }
});
const verifyFingerprintRuntimeViaMainWorld = async () => await mainWorldCall({
    type: "fingerprint-verify",
    payload: {}
});
const readPageStateViaMainWorld = async () => {
    const result = await mainWorldCall({
        type: "page-state-read",
        payload: {}
    });
    return typeof result === "object" && result !== null && !Array.isArray(result)
        ? result
        : null;
};
const configureCapturedRequestContextProvenanceViaMainWorld = async (input) => {
    const result = await mainWorldCall({
        type: "captured-request-context-provenance-set",
        payload: {
            page_context_namespace: input.page_context_namespace,
            ...(typeof input.profile_ref === "string" ? { profile_ref: input.profile_ref } : {}),
            ...(typeof input.session_id === "string" ? { session_id: input.session_id } : {}),
            ...(typeof input.target_tab_id === "number" ? { target_tab_id: input.target_tab_id } : {}),
            ...(typeof input.run_id === "string" ? { run_id: input.run_id } : {}),
            ...(typeof input.action_ref === "string" ? { action_ref: input.action_ref } : {}),
            ...(typeof input.page_url === "string" ? { page_url: input.page_url } : {})
        }
    });
    return asRecord(result);
};
const asCapturedRequestContextLookupResult = (value) => {
    const record = asRecord(value);
    if (!record ||
        typeof record.page_context_namespace !== "string" ||
        typeof record.shape_key !== "string" ||
        !Array.isArray(record.available_shape_keys)) {
        return null;
    }
    return {
        page_context_namespace: record.page_context_namespace,
        shape_key: record.shape_key,
        admitted_template: asRecord(record.admitted_template),
        rejected_observation: asRecord(record.rejected_observation),
        incompatible_observation: asRecord(record.incompatible_observation),
        available_shape_keys: record.available_shape_keys.filter((item) => typeof item === "string")
    };
};
const readCapturedRequestContextViaMainWorld = async (input) => {
    if (mainWorldEventChannel?.namespaceEvent) {
        installMainWorldPageContextNamespaceListener(mainWorldEventChannel.namespaceEvent);
    }
    const pageContextNamespace = resolveActiveVisitedPageContextNamespace(input.page_context_namespace, latestMainWorldPageContextNamespace);
    const result = await mainWorldCall({
        type: "captured-request-context-read",
        payload: {
            method: input.method,
            path: input.path,
            ...(pageContextNamespace ? { page_context_namespace: pageContextNamespace } : {}),
            shape_key: input.shape_key,
            ...(typeof input.profile_ref === "string" ? { profile_ref: input.profile_ref } : {}),
            ...(typeof input.session_id === "string" ? { session_id: input.session_id } : {}),
            ...(typeof input.target_tab_id === "number" ? { target_tab_id: input.target_tab_id } : {}),
            ...(typeof input.run_id === "string" ? { run_id: input.run_id } : {}),
            ...(typeof input.action_ref === "string" ? { action_ref: input.action_ref } : {}),
            ...(typeof input.page_url === "string" ? { page_url: input.page_url } : {}),
            ...(typeof input.min_observed_at === "number" && Number.isFinite(input.min_observed_at)
                ? { min_observed_at: input.min_observed_at }
                : {})
        }
    });
    const normalized = asCapturedRequestContextLookupResult(result);
    if (!normalized ||
        resolveActiveVisitedPageContextNamespace(input.page_context_namespace, normalized.page_context_namespace) !== normalized.page_context_namespace ||
        normalized.shape_key !== input.shape_key) {
        return null;
    }
    if (typeof normalized.page_context_namespace === "string" &&
        normalized.page_context_namespace.length > 0) {
        latestMainWorldPageContextNamespace = normalized.page_context_namespace;
    }
    return normalized;
};
const resolveMainWorldRequestUrl = (value) => {
    const baseHref = typeof globalThis.location?.href === "string" && globalThis.location.href.length > 0
        ? globalThis.location.href
        : "https://www.xiaohongshu.com/";
    return new URL(value, baseHref).toString();
};
const requestXhsSearchJsonViaMainWorld = async (input) => {
    const runtime = globalThis.chrome?.runtime;
    const sendMessage = runtime?.sendMessage;
    if (!sendMessage) {
        throw new Error("extension runtime.sendMessage is unavailable");
    }
    const request = {
        kind: "xhs-main-world-request",
        url: resolveMainWorldRequestUrl(input.url),
        method: input.method,
        headers: input.headers,
        ...(typeof input.body === "string" ? { body: input.body } : {}),
        timeout_ms: input.timeoutMs,
        ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
        ...(typeof input.referrerPolicy === "string"
            ? { referrerPolicy: input.referrerPolicy }
            : {})
    };
    const response = await new Promise((resolve, reject) => {
        try {
            const maybePromise = sendMessage(request, (message) => {
                resolve(message ?? { ok: false, error: { message: "xhs main-world response missing" } });
            });
            if (maybePromise && typeof maybePromise.then === "function") {
                void maybePromise
                    .then((message) => {
                    if (message) {
                        resolve(message);
                    }
                })
                    .catch((error) => {
                    reject(error);
                });
            }
        }
        catch (error) {
            reject(error);
        }
    });
    if (!response.ok || !response.result) {
        const error = new Error(typeof response.error?.message === "string"
            ? response.error.message
            : "xhs main-world request failed");
        if (typeof response.error?.name === "string" && response.error.name.length > 0) {
            error.name = response.error.name;
        }
        throw error;
    }
    return response.result;
};
return { encodeMainWorldPayload, configureCapturedRequestContextProvenanceViaMainWorld, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, MAIN_WORLD_EVENT_BOOTSTRAP, readCapturedRequestContextViaMainWorld, readPageStateViaMainWorld, requestXhsSearchJsonViaMainWorld, resetMainWorldEventChannelForContract, resolveMainWorldEventNamesForSecret, verifyFingerprintRuntimeViaMainWorld };
})();
const __webenvoy_module_content_script_fingerprint = (() => {
const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;
const {
  installFingerprintRuntimeViaMainWorld,
  verifyFingerprintRuntimeViaMainWorld
} = __webenvoy_module_content_script_main_world;
const AUDIO_PATCH_EPSILON = 1e-12;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const cloneFingerprintRuntimeContextWithInjection = (runtime, injection) => injection
    ? {
        ...runtime,
        injection: JSON.parse(JSON.stringify(injection))
    }
    : { ...runtime };
const resolveAttestedFingerprintRuntimeContext = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    const injection = asRecord(record.injection);
    const direct = ensureFingerprintRuntimeContext(record);
    if (direct) {
        return cloneFingerprintRuntimeContextWithInjection(direct, injection);
    }
    const sanitized = { ...record };
    delete sanitized.injection;
    const normalized = ensureFingerprintRuntimeContext(sanitized);
    return normalized ? cloneFingerprintRuntimeContextWithInjection(normalized, injection) : null;
};
const resolveFingerprintContextFromCommandParams = (commandParams) => asRecord(commandParams.fingerprint_context) ?? asRecord(commandParams.fingerprint_runtime) ?? null;
const resolveFingerprintContextFromMessage = (message) => {
    const direct = resolveAttestedFingerprintRuntimeContext(message.fingerprintContext ?? null);
    if (direct) {
        return direct;
    }
    const fallback = resolveAttestedFingerprintRuntimeContext(resolveFingerprintContextFromCommandParams(message.commandParams));
    return fallback ?? null;
};
const resolveRequiredFingerprintPatches = (fingerprintRuntime) => asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);
const buildFailedFingerprintInjectionContext = (fingerprintRuntime, errorMessage) => {
    const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
    return {
        ...fingerprintRuntime,
        injection: {
            installed: false,
            required_patches: requiredPatches,
            missing_required_patches: requiredPatches,
            error: errorMessage
        }
    };
};
const hasInstalledFingerprintInjection = (fingerprintRuntime) => {
    const existingInjection = asRecord(fingerprintRuntime.injection);
    return (existingInjection?.installed === true &&
        asStringArray(existingInjection.missing_required_patches).length === 0);
};
const resolveMissingRequiredFingerprintPatches = (fingerprintRuntime) => {
    const injection = asRecord(fingerprintRuntime.injection);
    const requiredPatches = asStringArray(injection?.required_patches);
    const missingRequiredPatches = asStringArray(injection?.missing_required_patches);
    if (missingRequiredPatches.length > 0) {
        return missingRequiredPatches;
    }
    if (injection?.installed === true) {
        return [];
    }
    return requiredPatches;
};
const summarizeFingerprintRuntimeContext = (fingerprintRuntime) => {
    if (!fingerprintRuntime) {
        return null;
    }
    const record = fingerprintRuntime;
    const execution = asRecord(record.execution);
    const injection = asRecord(record.injection);
    return {
        profile: asString(record.profile),
        source: asString(record.source),
        execution: execution
            ? {
                live_allowed: execution.live_allowed === true,
                live_decision: asString(execution.live_decision),
                allowed_execution_modes: asStringArray(execution.allowed_execution_modes),
                reason_codes: asStringArray(execution.reason_codes)
            }
            : null,
        injection: injection
            ? {
                installed: injection.installed === true,
                source: asString(injection.source),
                required_patches: asStringArray(injection.required_patches),
                missing_required_patches: asStringArray(injection.missing_required_patches),
                error: asString(injection.error)
            }
            : null
    };
};
const resolveFingerprintContextForContract = (message) => resolveFingerprintContextFromMessage({
    commandParams: message.commandParams,
    fingerprintContext: message.fingerprintContext
});
const probeAudioFirstSample = async () => {
    const offlineAudioCtor = typeof window.OfflineAudioContext === "function"
        ? window.OfflineAudioContext
        : typeof window
            .webkitOfflineAudioContext === "function"
            ? window
                .webkitOfflineAudioContext ?? null
            : null;
    if (!offlineAudioCtor) {
        return null;
    }
    try {
        const offlineAudioContext = new offlineAudioCtor(1, 256, 44_100);
        const renderedBuffer = await offlineAudioContext.startRendering();
        if (!renderedBuffer || typeof renderedBuffer.getChannelData !== "function") {
            return null;
        }
        const channelData = renderedBuffer.getChannelData(0);
        if (!channelData || typeof channelData.length !== "number" || channelData.length < 1) {
            return null;
        }
        const firstSample = Number(channelData[0]);
        return Number.isFinite(firstSample) ? firstSample : null;
    }
    catch {
        return null;
    }
};
const probeBatteryApi = async () => {
    const getBattery = window.navigator
        .getBattery;
    if (typeof getBattery !== "function") {
        return false;
    }
    try {
        const battery = asRecord(await getBattery());
        return typeof battery?.level === "number" && typeof battery?.charging === "boolean";
    }
    catch {
        return false;
    }
};
const probeNavigatorPlugins = () => {
    const plugins = window.navigator.plugins;
    return (typeof plugins === "object" &&
        plugins !== null &&
        typeof plugins.length === "number" &&
        Number(plugins.length) > 0);
};
const probeNavigatorMimeTypes = () => {
    const mimeTypes = window.navigator.mimeTypes;
    return (typeof mimeTypes === "object" &&
        mimeTypes !== null &&
        typeof mimeTypes.length === "number" &&
        Number(mimeTypes.length) > 0);
};
const verifyFingerprintInstallResult = async (input) => {
    const requiredPatches = resolveRequiredFingerprintPatches(input.fingerprintRuntime);
    const reportedAppliedPatches = asStringArray(input.installResult?.applied_patches);
    const mainWorldVerification = requiredPatches.includes("battery")
        ? asRecord(await verifyFingerprintRuntimeViaMainWorld().catch(() => null))
        : null;
    const appliedPatches = [];
    const missingRequiredPatches = [];
    const probeDetails = {};
    if (requiredPatches.includes("audio_context")) {
        const postInstallAudioSample = await probeAudioFirstSample();
        const audioPatched = postInstallAudioSample !== null &&
            (input.preInstallAudioSample === null ||
                Math.abs(postInstallAudioSample - input.preInstallAudioSample) > AUDIO_PATCH_EPSILON ||
                reportedAppliedPatches.includes("audio_context"));
        probeDetails.audio_context = {
            pre_install_first_sample: input.preInstallAudioSample,
            post_install_first_sample: postInstallAudioSample,
            verified: audioPatched
        };
        if (audioPatched) {
            appliedPatches.push("audio_context");
        }
        else {
            missingRequiredPatches.push("audio_context");
        }
    }
    if (requiredPatches.includes("battery")) {
        const isolatedWorldBatteryPatched = await probeBatteryApi();
        const mainWorldBatteryPatched = mainWorldVerification?.has_get_battery === true;
        const batteryPatched = isolatedWorldBatteryPatched || mainWorldBatteryPatched;
        probeDetails.battery = {
            verified: batteryPatched,
            isolated_world_verified: isolatedWorldBatteryPatched,
            main_world_verified: mainWorldBatteryPatched,
            reported_applied: reportedAppliedPatches.includes("battery")
        };
        if (batteryPatched) {
            appliedPatches.push("battery");
        }
        else {
            missingRequiredPatches.push("battery");
        }
    }
    if (requiredPatches.includes("navigator_plugins")) {
        const pluginsPatched = probeNavigatorPlugins();
        probeDetails.navigator_plugins = { verified: pluginsPatched };
        if (pluginsPatched) {
            appliedPatches.push("navigator_plugins");
        }
        else {
            missingRequiredPatches.push("navigator_plugins");
        }
    }
    if (requiredPatches.includes("navigator_mime_types")) {
        const mimeTypesPatched = probeNavigatorMimeTypes();
        probeDetails.navigator_mime_types = { verified: mimeTypesPatched };
        if (mimeTypesPatched) {
            appliedPatches.push("navigator_mime_types");
        }
        else {
            missingRequiredPatches.push("navigator_mime_types");
        }
    }
    for (const patchName of requiredPatches) {
        if (!appliedPatches.includes(patchName) && !missingRequiredPatches.includes(patchName)) {
            missingRequiredPatches.push(patchName);
        }
    }
    return {
        ...(input.installResult ?? {}),
        installed: missingRequiredPatches.length === 0,
        required_patches: requiredPatches,
        applied_patches: appliedPatches,
        missing_required_patches: missingRequiredPatches,
        verification: {
            channel: "isolated_world_probes",
            probes: probeDetails
        }
    };
};
const installFingerprintRuntimeWithVerification = async (fingerprintRuntime) => {
    const requiredPatches = resolveRequiredFingerprintPatches(fingerprintRuntime);
    const preInstallAudioSample = requiredPatches.includes("audio_context")
        ? await probeAudioFirstSample()
        : null;
    const installResult = await installFingerprintRuntimeViaMainWorld(fingerprintRuntime);
    return await verifyFingerprintInstallResult({
        fingerprintRuntime,
        installResult: asRecord(installResult),
        preInstallAudioSample
    });
};
return { buildFailedFingerprintInjectionContext, hasInstalledFingerprintInjection, installFingerprintRuntimeWithVerification, resolveFingerprintContextForContract, resolveFingerprintContextFromMessage, resolveMissingRequiredFingerprintPatches, summarizeFingerprintRuntimeContext };
})();
const __webenvoy_module_content_script_handler = (() => {
const { executeXhsSearch } = __webenvoy_module_xhs_search;
const { executeXhsDetail } = __webenvoy_module_xhs_detail;
const { executeXhsUserHome } = __webenvoy_module_xhs_user_home;
const { performEditorInputValidation } = __webenvoy_module_xhs_editor_input;
const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;
const {
  buildFailedFingerprintInjectionContext,
  hasInstalledFingerprintInjection,
  installFingerprintRuntimeWithVerification,
  resolveFingerprintContextForContract,
  resolveFingerprintContextFromMessage,
  resolveMissingRequiredFingerprintPatches,
  summarizeFingerprintRuntimeContext
} = __webenvoy_module_content_script_fingerprint;
const {
  ExtensionContractError,
  validateXhsCommandInputForExtension
} = __webenvoy_module_xhs_command_contract;
const { containsCookie, hasXhsAccountSafetyOverlaySignal } = __webenvoy_module_xhs_search_telemetry;
const {
  encodeMainWorldPayload,
  configureCapturedRequestContextProvenanceViaMainWorld,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  readCapturedRequestContextViaMainWorld,
  readPageStateViaMainWorld,
  requestXhsSearchJsonViaMainWorld,
  resetMainWorldEventChannelForContract,
  resolveMainWorldEventNamesForSecret
} = __webenvoy_module_content_script_main_world;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const createCurrentPageContextNamespace = (href) => {
    const normalized = href.trim();
    if (normalized.length === 0) {
        return "about:blank";
    }
    try {
        const parsed = new URL(normalized, "https://www.xiaohongshu.com/");
        const pathname = parsed.pathname.length > 0 ? parsed.pathname : "/";
        const queryIdentity = parsed.search.length > 0 ? `${pathname}${parsed.search}` : pathname;
        const documentTimeOrigin = typeof globalThis.performance?.timeOrigin === "number" &&
            Number.isFinite(globalThis.performance.timeOrigin)
            ? Math.trunc(globalThis.performance.timeOrigin)
            : null;
        return documentTimeOrigin === null
            ? `${parsed.origin}${queryIdentity}`
            : `${parsed.origin}${queryIdentity}#doc=${documentTimeOrigin}`;
    }
    catch {
        return normalized;
    }
};
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const hasReadyFingerprintRuntime = (fingerprintRuntime) => {
    const injection = asRecord(fingerprintRuntime?.injection);
    const execution = asRecord(fingerprintRuntime?.execution);
    return (injection?.installed === true &&
        asStringArray(injection.missing_required_patches).length === 0 &&
        execution?.live_allowed === true &&
        execution.live_decision === "allowed");
};
const capturedRequestContextProvenanceConfirmed = (value, expected) => {
    const record = asRecord(value);
    return (record?.configured === true &&
        record.profile_ref === expected.profile_ref &&
        record.session_id === expected.session_id &&
        (expected.target_tab_id === null || record.target_tab_id === expected.target_tab_id) &&
        record.run_id === expected.run_id &&
        record.action_ref === expected.action_ref &&
        record.page_url === expected.page_url);
};
const resolveTrustedActiveFallbackRuntimeAttestation = (input) => {
    const attestation = asRecord(input.raw.runtime_attestation);
    if (!attestation) {
        return null;
    }
    if (attestation.source !== "official_chrome_runtime_readiness" ||
        attestation.runtime_readiness !== "ready" ||
        attestation.profile_ref !== input.profile ||
        attestation.run_id !== input.runId ||
        attestation.session_id !== input.sessionId) {
        return null;
    }
    return attestation;
};
const resolveActiveApiFetchFallbackGateOptions = (input) => {
    const raw = asRecord(input.rawOptions.active_api_fetch_fallback);
    if (!raw) {
        return null;
    }
    const { fingerprint_validation_state: _fingerprintValidationState, execution_surface: _executionSurface, headless: _headless, runtime_attestation: _runtimeAttestation, fingerprint_attestation: _fingerprintAttestation, ...callerGate } = raw;
    const runtimeAttestation = resolveTrustedActiveFallbackRuntimeAttestation({
        raw,
        profile: input.profile,
        runId: input.runId,
        sessionId: input.sessionId
    });
    const fingerprintReady = hasReadyFingerprintRuntime(input.fingerprintRuntime);
    const missingRequiredPatches = asStringArray(asRecord(input.fingerprintRuntime?.injection)?.missing_required_patches);
    return {
        ...callerGate,
        ...(fingerprintReady ? { fingerprint_validation_state: "ready" } : {}),
        ...(runtimeAttestation
            ? {
                execution_surface: asString(runtimeAttestation.execution_surface) ?? "unknown",
                ...(typeof runtimeAttestation.headless === "boolean"
                    ? { headless: runtimeAttestation.headless }
                    : {}),
                runtime_attestation: runtimeAttestation
            }
            : {}),
        fingerprint_attestation: {
            source: "content_script_fingerprint_runtime",
            validation_state: fingerprintReady ? "ready" : "not_ready",
            profile_ref: asString(input.fingerprintRuntime?.profile),
            missing_required_patches: missingRequiredPatches
        }
    };
};
const toCliInvalidArgsResult = (input) => ({
    kind: "result",
    id: input.id,
    ok: false,
    error: {
        code: input.error.code,
        message: input.error.message
    },
    payload: {
        ...(input.error.details ? { details: input.error.details } : {}),
        ...(input.fingerprintRuntime ? { fingerprint_runtime: input.fingerprintRuntime } : {})
    }
});
const resolveRequestedExecutionMode = (message) => {
    const topLevelMode = asString(asRecord(message.commandParams)?.requested_execution_mode);
    if (topLevelMode) {
        return topLevelMode;
    }
    const options = asRecord(message.commandParams.options);
    return asString(options?.requested_execution_mode);
};
const extractFetchBody = async (response) => {
    const text = await response.text();
    if (text.length === 0) {
        return null;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return {
            message: text
        };
    }
};
const requestXhsSignatureViaExtension = async (uri, body) => {
    const runtime = globalThis.chrome?.runtime;
    const sendMessage = runtime?.sendMessage;
    if (!sendMessage) {
        throw new Error("extension runtime.sendMessage is unavailable");
    }
    const request = {
        kind: "xhs-sign-request",
        uri,
        body
    };
    const response = await new Promise((resolve, reject) => {
        try {
            const maybePromise = sendMessage(request, (message) => {
                resolve(message ?? { ok: false, error: { message: "xhs-sign response missing" } });
            });
            if (maybePromise && typeof maybePromise.then === "function") {
                void maybePromise
                    .then((message) => {
                    if (message) {
                        resolve(message);
                    }
                })
                    .catch((error) => {
                    reject(error);
                });
            }
        }
        catch (error) {
            reject(error);
        }
    });
    if (!response.ok || !response.result) {
        throw new Error(typeof response.error?.message === "string" ? response.error.message : "xhs-sign failed");
    }
    return response.result;
};
const buildRuntimeBootstrapAckPayload = (input) => ({
    method: "runtime.bootstrap.ack",
    result: {
        version: input.version,
        run_id: input.runId,
        runtime_context_id: input.runtimeContextId,
        profile: input.profile,
        status: input.attested ? "ready" : "pending"
    },
    runtime_bootstrap_attested: input.attested,
    ...(input.runtimeWithInjection ? { fingerprint_runtime: input.runtimeWithInjection } : {})
});
const ACCOUNT_SAFETY_OVERLAY_SELECTORS = [
    ".login-modal",
    ".login-container",
    ".login-wrapper",
    ".reds-login-container",
    ".captcha-container",
    ".verify-container",
    ".security-verify",
    ".risk-page",
    ".risk-modal",
    '[class*="login"]',
    '[class*="captcha"]',
    '[class*="verify"]',
    '[class*="security"]',
    '[class*="risk"]',
    '[id*="login"]',
    '[id*="captcha"]',
    '[id*="verify"]',
    '[id*="security"]',
    '[id*="risk"]',
    '[role="dialog"]',
    '[aria-modal="true"]'
];
const GENERIC_OVERLAY_SELECTORS = new Set(['[role="dialog"]', '[aria-modal="true"]']);
const isVisibleElement = (element) => {
    const candidate = element;
    if (typeof candidate.getBoundingClientRect !== "function") {
        return false;
    }
    if (typeof window.getComputedStyle !== "function") {
        return false;
    }
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
        return false;
    }
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};
const readAccountSafetyOverlay = () => {
    if (typeof document.querySelectorAll !== "function") {
        return null;
    }
    for (const element of Array.from(document.querySelectorAll(ACCOUNT_SAFETY_OVERLAY_SELECTORS.join(",")))) {
        if (!isVisibleElement(element)) {
            continue;
        }
        const text = (element.innerText || element.textContent || "").trim();
        if (!text || !hasXhsAccountSafetyOverlaySignal(text)) {
            continue;
        }
        const selector = ACCOUNT_SAFETY_OVERLAY_SELECTORS.find((candidate) => element.matches(candidate)) ?? null;
        if (!selector || GENERIC_OVERLAY_SELECTORS.has(selector)) {
            continue;
        }
        return {
            source: "dom_overlay",
            selector,
            text: text.slice(0, 2000)
        };
    }
    return null;
};
const toAbsoluteXhsHref = (href) => {
    if (!href || href.trim().length === 0) {
        return null;
    }
    try {
        return new URL(href, window.location.origin).toString();
    }
    catch {
        return href;
    }
};
const hasSearchCardLikeJson = (value, seen = new Set()) => {
    const record = asRecord(value);
    if (record) {
        if (seen.has(record)) {
            return false;
        }
        seen.add(record);
        const href = asString(record.detail_url) ??
            asString(record.detailUrl) ??
            asString(record.note_url) ??
            asString(record.noteUrl) ??
            asString(record.href) ??
            asString(record.url) ??
            asString(record.link);
        if (href) {
            const absoluteHref = toAbsoluteXhsHref(href);
            try {
                const url = absoluteHref ? new URL(absoluteHref) : null;
                if (url?.hostname === XHS_READ_DOMAIN &&
                    (url.pathname.startsWith("/explore/") || url.pathname.startsWith("/discovery/item/"))) {
                    return true;
                }
            }
            catch {
                // continue recursive scan
            }
        }
        if (asRecord(record.note_card) &&
            (asString(record.xsec_token) || asString(asRecord(record.note_card)?.xsec_token))) {
            return true;
        }
        return Object.values(record).some((entry) => hasSearchCardLikeJson(entry, seen));
    }
    return Array.isArray(value) ? value.some((entry) => hasSearchCardLikeJson(entry, seen)) : false;
};
const readJsonScriptSearchState = () => {
    if (typeof document.querySelectorAll !== "function") {
        return null;
    }
    const selectors = ['script[type="application/json"]', "script#__NEXT_DATA__", "script:not([src])"];
    for (const selector of selectors) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
            const text = (element.textContent ?? "").trim();
            if (!text || (!text.includes("xsec") && !text.includes("/explore/"))) {
                continue;
            }
            try {
                const parsed = JSON.parse(text);
                if (!hasSearchCardLikeJson(parsed)) {
                    continue;
                }
                return {
                    extraction_layer: "script_json",
                    extraction_locator: selector,
                    cards: parsed
                };
            }
            catch {
                continue;
            }
        }
    }
    return null;
};
const readSearchDomCards = () => {
    if (typeof document.querySelectorAll !== "function") {
        return [];
    }
    const anchors = Array.from(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]'));
    return anchors
        .map((anchor) => {
        const root = anchor.closest('[class*="note"], [class*="card"], article, section, li') ??
            anchor.parentElement ??
            anchor;
        const userAnchor = root.querySelector('a[href*="/user/profile/"]');
        const titleElement = root.querySelector('[class*="title"], [class*="desc"]') ?? anchor.querySelector("[title]");
        const title = titleElement?.innerText?.trim() ||
            (titleElement?.textContent ?? "").trim() ||
            (anchor.getAttribute("title") ?? "").trim() ||
            (anchor.textContent ?? "").trim() ||
            null;
        return {
            title,
            detail_url: toAbsoluteXhsHref(anchor.getAttribute("href")),
            user_home_url: toAbsoluteXhsHref(userAnchor?.getAttribute("href") ?? null)
        };
    })
        .filter((card) => typeof card.detail_url === "string" && card.detail_url.length > 0)
        .slice(0, 30);
};
const readXhsSearchDomState = () => {
    const scriptState = readJsonScriptSearchState();
    if (scriptState) {
        return scriptState;
    }
    const cards = readSearchDomCards();
    return cards.length > 0
        ? {
            extraction_layer: "dom_selector",
            extraction_locator: 'a[href*="/explore/"], a[href*="/discovery/item/"]',
            cards
        }
        : null;
};
const normalizeSearchQueryText = (value) => {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
};
const isCurrentSearchPageForQuery = (href, query) => {
    const expectedQuery = normalizeSearchQueryText(query);
    if (!expectedQuery) {
        return false;
    }
    try {
        const url = new URL(href);
        return (url.hostname === XHS_READ_DOMAIN &&
            url.pathname.includes("/search_result") &&
            normalizeSearchQueryText(url.searchParams.get("keyword")) === expectedQuery);
    }
    catch {
        return false;
    }
};
const performXhsSearchPassiveAction = async (input) => {
    const queryMatched = isCurrentSearchPageForQuery(window.location.href, input.query);
    const searchInput = document.querySelector('input[type="search"], input[class*="search"], input[placeholder*="搜索"], input[placeholder*="search" i]');
    if (searchInput) {
        const searchForm = searchInput.closest("form");
        const searchButton = (searchForm?.querySelector('button[type="submit"], button[class*="search"], [role="button"][class*="search"]') ?? document.querySelector('button[type="submit"], button[class*="search"], [role="button"][class*="search"]'));
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        searchInput.focus();
        valueSetter?.call(searchInput, input.query);
        searchInput.dispatchEvent(new InputEvent("input", { bubbles: true, data: input.query }));
        searchInput.dispatchEvent(new Event("change", { bubbles: true }));
        searchInput.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
        searchInput.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, cancelable: true, key: "Enter", code: "Enter" }));
        if (searchForm && typeof searchForm.requestSubmit === "function") {
            searchForm.requestSubmit();
        }
        else if (searchButton && typeof searchButton.click === "function") {
            searchButton.click();
        }
        else if (searchForm) {
            searchForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        }
        return {
            evidence_class: "humanized_action",
            action_kind: "keyboard_input",
            action_ref: input.actionRef,
            run_id: input.runId,
            page_url: input.pageUrl,
            query: input.query,
            query_matched: queryMatched,
            search_input_found: true,
            search_form_found: Boolean(searchForm),
            search_button_found: Boolean(searchButton),
            submit_triggered: searchForm && typeof searchForm.requestSubmit === "function"
                ? "form_request_submit"
                : searchButton
                    ? "button_click"
                    : searchForm
                        ? "submit_event"
                        : "enter_key",
            trigger_surface: "xhs.search_result"
        };
    }
    if (queryMatched) {
        const target = document.scrollingElement ?? document.documentElement;
        const beforeScrollY = window.scrollY;
        const deltaY = 240;
        target.dispatchEvent(new WheelEvent("wheel", {
            bubbles: true,
            cancelable: true,
            deltaY
        }));
        window.scrollBy({
            top: deltaY,
            left: 0,
            behavior: "auto"
        });
        target.dispatchEvent(new Event("scroll", { bubbles: true }));
        return {
            evidence_class: "humanized_action",
            action_kind: "scroll",
            action_ref: input.actionRef,
            run_id: input.runId,
            page_url: input.pageUrl,
            query: input.query,
            query_matched: true,
            before_scroll_y: beforeScrollY,
            after_scroll_y: window.scrollY,
            trigger_surface: "xhs.search_result"
        };
    }
    return {
        evidence_class: "humanized_action",
        action_kind: "keyboard_input",
        action_ref: input.actionRef,
        run_id: input.runId,
        page_url: input.pageUrl,
        query: input.query,
        query_matched: false,
        search_input_found: false,
        skipped_reason: "search_input_missing"
    };
};
const createBrowserEnvironment = () => ({
    now: () => Date.now(),
    randomId: () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}`,
    getLocationHref: () => window.location.href,
    getDocumentTitle: () => document.title,
    getReadyState: () => document.readyState,
    getCookie: () => document.cookie,
    getBodyText: () => (document.body?.innerText ?? "").slice(0, 5000),
    getAccountSafetyOverlay: () => readAccountSafetyOverlay(),
    getPageStateRoot: () => window.__INITIAL_STATE__,
    readPageStateRoot: async () => await readPageStateViaMainWorld(),
    readSearchDomState: async () => readXhsSearchDomState(),
    performSearchPassiveAction: async (input) => await performXhsSearchPassiveAction(input),
    readCapturedRequestContext: async (input) => await readCapturedRequestContextViaMainWorld(input),
    configureCapturedRequestContextProvenance: async (input) => await configureCapturedRequestContextProvenanceViaMainWorld(input),
    sleep: async (ms) => {
        await new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    },
    callSignature: async (uri, payload) => await requestXhsSignatureViaExtension(uri, payload),
    fetchJson: async (input) => {
        if (input.pageContextRequest === true) {
            return await requestXhsSearchJsonViaMainWorld({
                url: input.url,
                method: input.method,
                headers: input.headers,
                ...(typeof input.body === "string" ? { body: input.body } : {}),
                timeoutMs: input.timeoutMs,
                ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
                ...(typeof input.referrerPolicy === "string"
                    ? { referrerPolicy: input.referrerPolicy }
                    : {})
            });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort();
        }, input.timeoutMs);
        try {
            const response = await fetch(input.url, {
                method: input.method,
                headers: input.headers,
                body: input.body,
                credentials: "include",
                ...(typeof input.referrer === "string" ? { referrer: input.referrer } : {}),
                ...(typeof input.referrerPolicy === "string"
                    ? { referrerPolicy: input.referrerPolicy }
                    : {}),
                signal: controller.signal
            });
            return {
                status: response.status,
                body: await extractFetchBody(response)
            };
        }
        finally {
            clearTimeout(timer);
        }
    },
    performEditorInputValidation: async (input) => await performEditorInputValidation(input)
});
const resolveTargetDomainFromHref = (href) => {
    try {
        return new URL(href).hostname || null;
    }
    catch {
        return null;
    }
};
const resolveTargetPageFromHref = (href, command) => {
    try {
        const url = new URL(href);
        if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
            return "search_result_tab";
        }
        if (command === "xhs.detail" && url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/explore/")) {
            return "explore_detail_tab";
        }
        if (command === "xhs.user_home" &&
            url.hostname === "www.xiaohongshu.com" &&
            url.pathname.startsWith("/user/profile/")) {
            return "profile_tab";
        }
        if (url.hostname === "creator.xiaohongshu.com" && url.pathname.startsWith("/publish")) {
            return "creator_publish_tab";
        }
        return null;
    }
    catch {
        return null;
    }
};
class ContentScriptHandler {
    #listeners = new Set();
    #reachable = true;
    #xhsEnv;
    constructor(options) {
        this.#xhsEnv = options?.xhsEnv ?? createBrowserEnvironment();
    }
    onResult(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    setReachable(reachable) {
        this.#reachable = reachable;
    }
    onBackgroundMessage(message) {
        if (!this.#reachable) {
            return false;
        }
        if (message.commandParams.simulate_no_response === true) {
            return true;
        }
        if (message.command === "runtime.ping") {
            void this.#handleRuntimePing(message);
            return true;
        }
        if (message.command === "runtime.bootstrap") {
            void this.#handleRuntimeBootstrap(message);
            return true;
        }
        if (XHS_READ_COMMANDS.has(message.command)) {
            void this.#handleXhsReadCommand(message).catch((error) => {
                this.#emitUnexpectedXhsReadFailure(message, error);
            });
            return true;
        }
        const result = this.#handleForward(message);
        for (const listener of this.#listeners) {
            listener(result);
        }
        return true;
    }
    #emitUnexpectedXhsReadFailure(message, error) {
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
            this.#emit(toCliInvalidArgsResult({
                id: message.id,
                error,
                fingerprintRuntime: fingerprintRuntime
            }));
            return;
        }
        this.#emit({
            kind: "result",
            id: message.id,
            ok: false,
            error: {
                code: "ERR_EXECUTION_FAILED",
                message: error instanceof Error ? error.message : String(error)
            },
            payload: fingerprintRuntime
                ? {
                    fingerprint_runtime: fingerprintRuntime
                }
                : {}
        });
    }
    async #installFingerprintIfPresent(message) {
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (!fingerprintRuntime) {
            return null;
        }
        if (hasInstalledFingerprintInjection(fingerprintRuntime)) {
            return fingerprintRuntime;
        }
        try {
            const verifiedInjection = await installFingerprintRuntimeWithVerification(fingerprintRuntime);
            return {
                ...fingerprintRuntime,
                injection: verifiedInjection
            };
        }
        catch (error) {
            const requiredPatches = asStringArray(asRecord(fingerprintRuntime.fingerprint_patch_manifest)?.required_patches);
            return {
                ...fingerprintRuntime,
                injection: {
                    installed: false,
                    required_patches: requiredPatches,
                    missing_required_patches: requiredPatches,
                    error: error instanceof Error ? error.message : String(error)
                }
            };
        }
    }
    async #handleRuntimePing(message) {
        const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
        this.#emit({
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong",
                run_id: message.runId,
                profile: message.profile,
                cwd: message.cwd,
                ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
            }
        });
    }
    async #handleRuntimeBootstrap(message) {
        const commandParams = asRecord(message.commandParams) ?? {};
        const version = asString(commandParams.version);
        const runId = asString(commandParams.run_id);
        const runtimeContextId = asString(commandParams.runtime_context_id);
        const profile = asString(commandParams.profile);
        const mainWorldSecret = asString(commandParams.main_world_secret);
        const fingerprintRuntime = resolveFingerprintContextFromMessage(message);
        if (version !== "v1" ||
            !runId ||
            !runtimeContextId ||
            !profile ||
            !mainWorldSecret ||
            !fingerprintRuntime) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                    message: "invalid runtime bootstrap envelope"
                }
            });
            return;
        }
        if (fingerprintRuntime.profile !== profile) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
                    message: "runtime bootstrap profile 与 fingerprint runtime 不一致"
                }
            });
            return;
        }
        const channelInstalled = installMainWorldEventChannelSecret(mainWorldSecret);
        const runtimeWithInjection = channelInstalled
            ? await this.#installFingerprintIfPresent({
                ...message,
                fingerprintContext: fingerprintRuntime
            })
            : buildFailedFingerprintInjectionContext(fingerprintRuntime, "main world event channel unavailable");
        const injection = asRecord(runtimeWithInjection?.injection);
        const attested = injection?.installed === true;
        const ackPayload = buildRuntimeBootstrapAckPayload({
            version,
            runId,
            runtimeContextId,
            profile,
            attested,
            runtimeWithInjection
        });
        if (!attested) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
                    message: typeof injection?.error === "string"
                        ? injection.error
                        : "runtime bootstrap 尚未获得执行面确认"
                },
                payload: ackPayload
            });
            return;
        }
        this.#emit({
            kind: "result",
            id: message.id,
            ok: true,
            payload: ackPayload
        });
    }
    #handleForward(message) {
        if (message.command !== "runtime.ping") {
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unsupported command: ${message.command}`
                }
            };
        }
        return {
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong",
                run_id: message.runId,
                profile: message.profile,
                cwd: message.cwd
            }
        };
    }
    #safeXhsEnvValue(resolver, fallback) {
        try {
            return resolver();
        }
        catch {
            return fallback;
        }
    }
    async #handleXhsReadCommand(message) {
        const commandParams = asRecord(message.commandParams) ?? {};
        const mainWorldSecret = asString(commandParams.main_world_secret);
        if (mainWorldSecret) {
            installMainWorldEventChannelSecret(mainWorldSecret);
        }
        const messageFingerprintContext = resolveFingerprintContextFromMessage(message);
        const fingerprintRuntime = await this.#installFingerprintIfPresent(message);
        const requestedExecutionMode = resolveRequestedExecutionMode(message);
        const missingRequiredPatches = fingerprintRuntime !== null ? resolveMissingRequiredFingerprintPatches(fingerprintRuntime) : [];
        if (requestedExecutionMode !== null &&
            LIVE_EXECUTION_MODES.has(requestedExecutionMode) &&
            missingRequiredPatches.length > 0) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: "fingerprint required patches missing for live execution"
                },
                payload: {
                    details: {
                        stage: "execution",
                        reason: "FINGERPRINT_REQUIRED_PATCH_MISSING",
                        requested_execution_mode: requestedExecutionMode,
                        missing_required_patches: missingRequiredPatches
                    },
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}),
                    fingerprint_forward_diagnostics: {
                        direct_message_context: summarizeFingerprintRuntimeContext(ensureFingerprintRuntimeContext(message.fingerprintContext ?? null)),
                        resolved_message_context: summarizeFingerprintRuntimeContext(messageFingerprintContext),
                        installed_runtime_context: summarizeFingerprintRuntimeContext(fingerprintRuntime)
                    }
                }
            });
            return;
        }
        const ability = asRecord(commandParams.ability);
        const input = asRecord(commandParams.input);
        const options = asRecord(commandParams.options) ?? {};
        const locationHref = this.#xhsEnv.getLocationHref();
        const actualTargetDomain = resolveTargetDomainFromHref(locationHref);
        const actualTargetPage = resolveTargetPageFromHref(locationHref, message.command) ??
            (actualTargetDomain === XHS_READ_DOMAIN &&
                message.command === "xhs.search" &&
                locationHref.includes("/search_result")
                ? "search_result_tab"
                : null);
        const observedTargetSiteLoggedIn = actualTargetDomain === XHS_READ_DOMAIN && containsCookie(this.#xhsEnv.getCookie(), "a1");
        const observedAnonymousIsolationVerified = actualTargetDomain === XHS_READ_DOMAIN && observedTargetSiteLoggedIn === false;
        const sessionId = String(message.params.session_id ?? "nm-session-001");
        const activeApiFetchFallback = resolveActiveApiFetchFallbackGateOptions({
            rawOptions: options,
            fingerprintRuntime,
            profile: message.profile,
            runId: message.runId,
            sessionId
        });
        if (!ability || !input) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: `${message.command} payload missing ability or input`
                },
                payload: {
                    details: {
                        stage: "execution",
                        reason: "ABILITY_PAYLOAD_MISSING"
                    },
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
                }
            });
            return;
        }
        try {
            const normalizedInput = validateXhsCommandInputForExtension({
                command: message.command,
                abilityId: String(ability.id ?? "unknown"),
                abilityAction: typeof ability.action === "string" ? ability.action : "read",
                payload: input,
                options
            });
            const commonInput = {
                abilityId: String(ability.id ?? "unknown"),
                abilityLayer: String(ability.layer ?? "L3"),
                abilityAction: String(ability.action ?? "read"),
                options: {
                    ...(typeof options.timeout_ms === "number"
                        ? { timeout_ms: options.timeout_ms }
                        : { timeout_ms: message.timeoutMs }),
                    ...(typeof options.simulate_result === "string"
                        ? { simulate_result: options.simulate_result }
                        : {}),
                    ...(typeof options.x_s_common === "string" ? { x_s_common: options.x_s_common } : {}),
                    ...(typeof options.target_domain === "string"
                        ? { target_domain: options.target_domain }
                        : {}),
                    ...(typeof options.target_tab_id === "number"
                        ? { target_tab_id: options.target_tab_id }
                        : {}),
                    ...(typeof options.target_page === "string"
                        ? { target_page: options.target_page }
                        : {}),
                    ...(typeof message.tabId === "number" ? { actual_target_tab_id: message.tabId } : {}),
                    ...(actualTargetDomain ? { actual_target_domain: actualTargetDomain } : {}),
                    ...(actualTargetPage ? { actual_target_page: actualTargetPage } : {}),
                    ...(typeof ability.action === "string" ? { ability_action: ability.action } : {}),
                    ...(typeof options.action_type === "string"
                        ? { action_type: options.action_type }
                        : {}),
                    ...(typeof options.issue_scope === "string"
                        ? { issue_scope: options.issue_scope }
                        : {}),
                    ...(requestedExecutionMode !== null
                        ? { requested_execution_mode: requestedExecutionMode }
                        : {}),
                    ...(typeof options.risk_state === "string" ? { risk_state: options.risk_state } : {}),
                    ...(asRecord(options.upstream_authorization_request)
                        ? {
                            upstream_authorization_request: asRecord(options.upstream_authorization_request) ?? {}
                        }
                        : {}),
                    ...(typeof options.__legacy_requested_execution_mode === "string"
                        ? { __legacy_requested_execution_mode: options.__legacy_requested_execution_mode }
                        : {}),
                    ...(options.limited_read_rollout_ready_true === true
                        ? { limited_read_rollout_ready_true: true }
                        : {}),
                    ...(options.xhs_recovery_probe === true ? { xhs_recovery_probe: true } : {}),
                    ...(typeof options.validation_action === "string"
                        ? { validation_action: options.validation_action }
                        : {}),
                    ...(typeof options.validation_text === "string"
                        ? { validation_text: options.validation_text }
                        : {}),
                    ...(activeApiFetchFallback
                        ? { active_api_fetch_fallback: activeApiFetchFallback }
                        : {}),
                    ...(asRecord(options.editor_focus_attestation)
                        ? {
                            editor_focus_attestation: asRecord(options.editor_focus_attestation) ?? {}
                        }
                        : {}),
                    ...(asRecord(options.approval_record)
                        ? { approval_record: asRecord(options.approval_record) ?? {} }
                        : {}),
                    ...(asRecord(options.audit_record)
                        ? { audit_record: asRecord(options.audit_record) ?? {} }
                        : {}),
                    ...(asRecord(options.admission_context)
                        ? { admission_context: asRecord(options.admission_context) ?? {} }
                        : {}),
                    ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {}),
                    ...(actualTargetDomain === XHS_READ_DOMAIN
                        ? {
                            target_site_logged_in: observedTargetSiteLoggedIn,
                            __anonymous_isolation_verified: observedAnonymousIsolationVerified
                        }
                        : {})
                },
                executionContext: {
                    runId: message.runId,
                    sessionId,
                    profile: message.profile ?? "unknown",
                    requestId: message.id,
                    commandRequestId: asString(commandParams.request_id) ?? undefined,
                    gateInvocationId: asString(commandParams.gate_invocation_id) ?? undefined
                }
            };
            let result;
            const configureReadRequestContextProvenance = async () => {
                if (typeof this.#xhsEnv.configureCapturedRequestContextProvenance !== "function") {
                    return true;
                }
                const expected = {
                    page_context_namespace: createCurrentPageContextNamespace(locationHref),
                    profile_ref: commonInput.executionContext.profile,
                    session_id: commonInput.executionContext.sessionId,
                    target_tab_id: typeof message.tabId === "number" ? message.tabId : null,
                    run_id: commonInput.executionContext.runId,
                    action_ref: commonInput.abilityAction,
                    page_url: locationHref
                };
                const result = await this.#xhsEnv.configureCapturedRequestContextProvenance(expected).catch(() => null);
                return capturedRequestContextProvenanceConfirmed(result, expected);
            };
            if (message.command === "xhs.search") {
                const requestContextProvenanceConfirmed = await configureReadRequestContextProvenance();
                const searchInput = normalizedInput;
                result = await executeXhsSearch({
                    ...commonInput,
                    params: {
                        query: searchInput.query,
                        ...(typeof searchInput.limit === "number" ? { limit: searchInput.limit } : {}),
                        ...(typeof searchInput.page === "number" ? { page: searchInput.page } : {}),
                        ...(typeof searchInput.search_id === "string"
                            ? { search_id: searchInput.search_id }
                            : {}),
                        ...(typeof searchInput.sort === "string" ? { sort: searchInput.sort } : {}),
                        ...(typeof searchInput.note_type === "string" ||
                            typeof searchInput.note_type === "number"
                            ? { note_type: searchInput.note_type }
                            : {})
                    },
                    options: {
                        ...commonInput.options,
                        __request_context_provenance_confirmed: requestContextProvenanceConfirmed
                    }
                }, this.#xhsEnv);
            }
            else if (message.command === "xhs.detail") {
                void (await configureReadRequestContextProvenance());
                result = await executeXhsDetail({
                    ...commonInput,
                    params: {
                        note_id: normalizedInput.note_id
                    }
                }, this.#xhsEnv);
            }
            else {
                void (await configureReadRequestContextProvenance());
                result = await executeXhsUserHome({
                    ...commonInput,
                    params: {
                        user_id: normalizedInput.user_id
                    }
                }, this.#xhsEnv);
            }
            this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
        }
        catch (error) {
            if (error instanceof ExtensionContractError && error.code === "ERR_CLI_INVALID_ARGS") {
                this.#emit(toCliInvalidArgsResult({
                    id: message.id,
                    error,
                    fingerprintRuntime
                }));
                return;
            }
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: error instanceof Error ? error.message : String(error)
                },
                payload: fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {}
            });
        }
    }
    #toContentMessage(id, result, fingerprintRuntime) {
        if (!result.ok) {
            return {
                kind: "result",
                id,
                ok: false,
                error: result.error,
                payload: {
                    ...(result.payload ?? {}),
                    ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
                }
            };
        }
        return {
            kind: "result",
            id,
            ok: true,
            payload: {
                ...(result.payload ?? {}),
                ...(fingerprintRuntime ? { fingerprint_runtime: fingerprintRuntime } : {})
            }
        };
    }
    #emit(message) {
        for (const listener of this.#listeners) {
            listener(message);
        }
    }
}
return { ContentScriptHandler, ExtensionContractError, encodeMainWorldPayload, configureCapturedRequestContextProvenanceViaMainWorld, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, readCapturedRequestContextViaMainWorld, readPageStateViaMainWorld, resolveFingerprintContextForContract, validateXhsCommandInputForExtension, resolveMainWorldEventNamesForSecret };
})();
const __webenvoy_module_content_script = (() => {
const {
  ContentScriptHandler,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret
} = __webenvoy_module_content_script_handler;
const { ensureFingerprintRuntimeContext } = __webenvoy_module_fingerprint_profile;
const FINGERPRINT_CONTEXT_CACHE_KEY = "__webenvoy_fingerprint_context__";
const FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY = "__webenvoy_fingerprint_bootstrap_payload__";
const EXTENSION_BOOTSTRAP_FILENAME = "__webenvoy_fingerprint_bootstrap.json";
const STARTUP_TRUST_SOURCE = "extension_bootstrap_context";
const MAIN_WORLD_SECRET_NAMESPACE = "webenvoy.main_world.secret.v1";
const CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY = "__webenvoy_content_script_bootstrap_state__";
const STAGED_STARTUP_TRUST_RUN_ID = undefined;
const STAGED_STARTUP_TRUST_SESSION_ID = undefined;
const STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME = undefined;
const normalizeForwardMessage = (request) => ({
    kind: "forward",
    id: request.id,
    runId: typeof request.runId === "string" ? request.runId : request.id,
    tabId: typeof request.tabId === "number" && Number.isInteger(request.tabId) ? request.tabId : null,
    profile: typeof request.profile === "string" ? request.profile : null,
    cwd: typeof request.cwd === "string" ? request.cwd : "",
    timeoutMs: typeof request.timeoutMs === "number" && Number.isFinite(request.timeoutMs) && request.timeoutMs > 0
        ? Math.floor(request.timeoutMs)
        : 30_000,
    command: typeof request.command === "string" ? request.command : "",
    params: typeof request.params === "object" && request.params !== null
        ? request.params
        : {},
    commandParams: typeof request.commandParams === "object" && request.commandParams !== null
        ? request.commandParams
        : {},
    fingerprintContext: ensureFingerprintRuntimeContext(request.fingerprintContext ??
        (typeof request.commandParams === "object" &&
            request.commandParams !== null &&
            "fingerprint_context" in request.commandParams
            ? request.commandParams.fingerprint_context
            : null))
});
const readBootstrapFingerprintContext = () => globalThis[FINGERPRINT_BOOTSTRAP_PAYLOAD_KEY] ?? null;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
const hashMainWorldSecret = (value) => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `mwsec_${(hash >>> 0).toString(36)}`;
};
const stableSerializeForSecret = (value, seen = new WeakSet()) => {
    if (value === null) {
        return "null";
    }
    if (typeof value === "string") {
        return JSON.stringify(value);
    }
    if (typeof value === "number") {
        return Number.isFinite(value) ? String(value) : '"NaN"';
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableSerializeForSecret(item, seen)).join(",")}]`;
    }
    if (typeof value !== "object") {
        return JSON.stringify(String(value));
    }
    if (seen.has(value)) {
        return '"[Circular]"';
    }
    seen.add(value);
    const record = value;
    const keys = Object.keys(record).sort();
    const body = keys
        .map((key) => `${JSON.stringify(key)}:${stableSerializeForSecret(record[key], seen)}`)
        .join(",");
    seen.delete(value);
    return `{${body}}`;
};
const resolveExplicitMainWorldSecret = (value) => {
    const record = asRecord(value);
    if (!record) {
        return null;
    }
    return asNonEmptyString(record.main_world_secret ??
        record.mainWorldSecret ??
        record.main_world_bridge_secret ??
        record.mainWorldBridgeSecret);
};
const deriveMainWorldSecretFromBootstrapPayload = (value) => {
    const explicit = resolveExplicitMainWorldSecret(value);
    if (explicit) {
        return explicit;
    }
    if (value === null || value === undefined) {
        return null;
    }
    const serialized = stableSerializeForSecret(value);
    if (serialized.length === 0) {
        return null;
    }
    return hashMainWorldSecret(`${MAIN_WORLD_SECRET_NAMESPACE}|${serialized}`);
};
const resolveBootstrapFingerprintContext = (value) => {
    const mainWorldSecret = deriveMainWorldSecretFromBootstrapPayload(value);
    const record = asRecord(value);
    const stagedRunId = asNonEmptyString(STAGED_STARTUP_TRUST_RUN_ID);
    const stagedSessionId = asNonEmptyString(STAGED_STARTUP_TRUST_SESSION_ID);
    const stagedFingerprintRuntime = ensureFingerprintRuntimeContext(STAGED_STARTUP_TRUST_FINGERPRINT_RUNTIME);
    const runId = asNonEmptyString(record?.run_id ?? record?.runId) ?? stagedRunId;
    const runtimeContextId = asNonEmptyString(record?.runtime_context_id ?? record?.runtimeContextId);
    const sessionId = asNonEmptyString(record?.session_id ?? record?.sessionId) ?? stagedSessionId;
    const direct = ensureFingerprintRuntimeContext(value);
    if (direct) {
        return {
            fingerprintRuntime: direct,
            runId,
            runtimeContextId,
            sessionId,
            mainWorldSecret
        };
    }
    if (!record) {
        return {
            fingerprintRuntime: stagedFingerprintRuntime,
            runId,
            runtimeContextId,
            sessionId,
            mainWorldSecret: null
        };
    }
    return {
        fingerprintRuntime: ensureFingerprintRuntimeContext(record.fingerprint_runtime ?? null) ?? stagedFingerprintRuntime,
        runId,
        runtimeContextId,
        sessionId,
        mainWorldSecret
    };
};
const sanitizeScopePart = (value) => value.replace(/[^a-zA-Z0-9._-]/g, "_");
const resolveRunToken = (normalized, runId) => {
    if (typeof runId === "string" && runId.trim().length > 0) {
        return sanitizeScopePart(runId.trim());
    }
    const record = asRecord(normalized);
    const directRunId = record?.runId ?? record?.run_id;
    if (typeof directRunId === "string" && directRunId.trim().length > 0) {
        return sanitizeScopePart(directRunId.trim());
    }
    return "run_unknown";
};
const buildExecutionScopeToken = (normalized) => {
    const execution = asRecord(asRecord(normalized)?.execution ?? null);
    if (!execution) {
        return "execution_unknown";
    }
    const liveDecision = typeof execution.live_decision === "string" ? execution.live_decision : "unknown";
    const allowedModes = Array.isArray(execution.allowed_execution_modes)
        ? execution.allowed_execution_modes
            .filter((mode) => typeof mode === "string")
            .sort()
            .join(",")
        : "";
    const reasonCodes = Array.isArray(execution.reason_codes)
        ? execution.reason_codes
            .filter((code) => typeof code === "string")
            .sort()
            .join(",")
        : "";
    const token = `${liveDecision}|${allowedModes}|${reasonCodes}`;
    return sanitizeScopePart(token.length > 0 ? token : "execution_unknown");
};
const buildScopedCacheKey = (normalized, runId) => {
    const profile = sanitizeScopePart(normalized.profile);
    const runToken = resolveRunToken(normalized, runId);
    const executionToken = buildExecutionScopeToken(normalized);
    return `${FINGERPRINT_CONTEXT_CACHE_KEY}:${profile}:${runToken}:${executionToken}`;
};
const getExtensionStorageArea = () => {
    const chromeApi = globalThis.chrome;
    const storage = chromeApi?.storage;
    if (!storage) {
        return null;
    }
    const area = storage.session ?? storage.local ?? null;
    if (!area || typeof area.get !== "function" || typeof area.set !== "function") {
        return null;
    }
    return area;
};
const persistExtensionFingerprintContext = (normalized, runId) => {
    // Keep fingerprint runtime context in extension-private storage only.
    // Never mirror it to page-readable sessionStorage/localStorage.
    const storageArea = getExtensionStorageArea();
    if (!storageArea || typeof storageArea.set !== "function") {
        return;
    }
    const scopedKey = buildScopedCacheKey(normalized, runId);
    try {
        const maybePromise = storageArea.set({
            [scopedKey]: normalized
        });
        if (maybePromise && typeof maybePromise.catch === "function") {
            void maybePromise.catch(() => undefined);
        }
    }
    catch {
        // ignore cache failures
    }
};
const loadBootstrapFingerprintContextFromExtension = async (runtime) => {
    const bootstrapUrl = typeof runtime.getURL === "function" ? runtime.getURL(EXTENSION_BOOTSTRAP_FILENAME) : null;
    if (!bootstrapUrl || typeof fetch !== "function") {
        return {
            fingerprintRuntime: null,
            runId: null,
            runtimeContextId: null,
            sessionId: null,
            mainWorldSecret: null
        };
    }
    try {
        const response = await fetch(bootstrapUrl);
        if (!response.ok) {
            return {
                fingerprintRuntime: null,
                runId: null,
                runtimeContextId: null,
                sessionId: null,
                mainWorldSecret: null
            };
        }
        const envelope = asRecord(await response.json());
        const resolved = resolveBootstrapFingerprintContext(envelope?.extension_bootstrap ?? envelope ?? null);
        return {
            fingerprintRuntime: resolved.fingerprintRuntime,
            runId: resolved.runId ?? asNonEmptyString(envelope?.run_id ?? envelope?.runId),
            runtimeContextId: resolved.runtimeContextId ??
                asNonEmptyString(envelope?.runtime_context_id ?? envelope?.runtimeContextId),
            sessionId: resolved.sessionId ?? asNonEmptyString(envelope?.session_id ?? envelope?.sessionId),
            mainWorldSecret: resolved.mainWorldSecret
        };
    }
    catch {
        return {
            fingerprintRuntime: null,
            runId: null,
            runtimeContextId: null,
            sessionId: null,
            mainWorldSecret: null
        };
    }
};
const installStartupFingerprintPatch = (fingerprintRuntime) => {
    void installFingerprintRuntimeViaMainWorld(fingerprintRuntime).catch(() => {
        // ignore install failures; startup trust must not rely on main-world response
    });
};
const emitStartupFingerprintTrust = (runtime, input) => {
    if (!input.runId || !input.runtimeContextId || !input.sessionId) {
        return;
    }
    runtime.sendMessage?.({
        kind: "result",
        id: `startup-fingerprint-trust:${input.runId}`,
        ok: true,
        payload: {
            startup_fingerprint_trust: {
                run_id: input.runId,
                runtime_context_id: input.runtimeContextId,
                profile: input.fingerprintRuntime.profile,
                session_id: input.sessionId,
                fingerprint_runtime: input.fingerprintRuntime,
                trust_source: STARTUP_TRUST_SOURCE,
                bootstrap_attested: true,
                main_world_result_used_for_trust: false
            }
        }
    });
};
const relayContentResultToBackground = (runtime, message, options) => {
    const sendMessage = runtime.sendMessage;
    if (!sendMessage) {
        return;
    }
    const relayFailure = (reason, error) => {
        if (options?.allowFallback === false) {
            return;
        }
        const relayErrorMessage = error instanceof Error ? error.message : String(error);
        relayContentResultToBackground(runtime, {
            kind: "result",
            id: message.id,
            ok: false,
            error: {
                code: "ERR_TRANSPORT_FORWARD_FAILED",
                message: "content script result relay failed"
            },
            payload: {
                details: {
                    stage: "relay",
                    reason,
                    relay_error: relayErrorMessage
                }
            }
        }, {
            allowFallback: false
        });
    };
    let normalizedMessage;
    try {
        normalizedMessage = JSON.parse(JSON.stringify(message));
    }
    catch (error) {
        relayFailure("CONTENT_RESULT_SERIALIZATION_FAILED", error);
        return;
    }
    try {
        const maybePromise = sendMessage(normalizedMessage);
        if (maybePromise && typeof maybePromise.catch === "function") {
            void maybePromise.catch((error) => {
                relayFailure("CONTENT_RESULT_RELAY_FAILED", error);
            });
        }
    }
    catch (error) {
        relayFailure("CONTENT_RESULT_RELAY_FAILED", error);
    }
};
const resolveBootstrapState = (runtime) => {
    const existingState = runtime[CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY];
    if (existingState) {
        return existingState;
    }
    const state = {
        generation: 0,
        handler: null,
        detachResultRelay: null,
        messageListener: null
    };
    runtime[CONTENT_SCRIPT_BOOTSTRAP_STATE_KEY] = state;
    return state;
};
const bootstrapContentScript = (runtime) => {
    if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
        return false;
    }
    const state = resolveBootstrapState(runtime);
    state.generation += 1;
    const generation = state.generation;
    state.detachResultRelay?.();
    if (state.handler) {
        state.handler.setReachable(false);
    }
    if (state.messageListener && runtime.onMessage.removeListener) {
        runtime.onMessage.removeListener(state.messageListener);
    }
    const handler = new ContentScriptHandler();
    state.handler = handler;
    state.detachResultRelay = null;
    state.messageListener = null;
    const bootstrapPayload = readBootstrapFingerprintContext();
    const bootstrapInput = resolveBootstrapFingerprintContext(bootstrapPayload);
    installMainWorldEventChannelSecret(bootstrapInput.mainWorldSecret);
    const bootstrapContext = bootstrapInput.fingerprintRuntime;
    if (bootstrapContext) {
        persistExtensionFingerprintContext(bootstrapContext, bootstrapInput.runId);
        installStartupFingerprintPatch(bootstrapContext);
        emitStartupFingerprintTrust(runtime, {
            runId: bootstrapInput.runId,
            runtimeContextId: bootstrapInput.runtimeContextId,
            sessionId: bootstrapInput.sessionId,
            fingerprintRuntime: bootstrapContext
        });
        if (!bootstrapInput.runId || !bootstrapInput.runtimeContextId || !bootstrapInput.sessionId) {
            void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
                if (state.generation !== generation || state.handler !== handler) {
                    return;
                }
                if (!resolvedBootstrap.runId ||
                    !resolvedBootstrap.runtimeContextId ||
                    !resolvedBootstrap.sessionId) {
                    return;
                }
                emitStartupFingerprintTrust(runtime, {
                    runId: resolvedBootstrap.runId,
                    runtimeContextId: resolvedBootstrap.runtimeContextId,
                    sessionId: resolvedBootstrap.sessionId,
                    fingerprintRuntime: bootstrapContext
                });
            });
        }
    }
    else {
        void loadBootstrapFingerprintContextFromExtension(runtime).then((resolvedBootstrap) => {
            if (state.generation !== generation || state.handler !== handler) {
                return;
            }
            installMainWorldEventChannelSecret(resolvedBootstrap.mainWorldSecret);
            if (!resolvedBootstrap.fingerprintRuntime) {
                runtime.sendMessage?.({
                    kind: "result",
                    id: "startup-background-wake",
                    ok: true,
                    payload: {
                        startup_background_wake: {
                            source: "content_script_bootstrap"
                        }
                    }
                });
                return;
            }
            persistExtensionFingerprintContext(resolvedBootstrap.fingerprintRuntime, resolvedBootstrap.runId);
            installStartupFingerprintPatch(resolvedBootstrap.fingerprintRuntime);
            emitStartupFingerprintTrust(runtime, {
                runId: resolvedBootstrap.runId,
                runtimeContextId: resolvedBootstrap.runtimeContextId,
                sessionId: resolvedBootstrap.sessionId,
                fingerprintRuntime: resolvedBootstrap.fingerprintRuntime
            });
        });
    }
    state.detachResultRelay = handler.onResult((message) => {
        if (state.generation !== generation || state.handler !== handler) {
            return;
        }
        relayContentResultToBackground(runtime, message);
    });
    const messageListener = (message) => {
        if (state.generation !== generation || state.handler !== handler) {
            return;
        }
        const request = message;
        if (!request || request.kind !== "forward" || typeof request.id !== "string") {
            return;
        }
        const normalized = normalizeForwardMessage(request);
        if (normalized.fingerprintContext) {
            persistExtensionFingerprintContext(normalized.fingerprintContext, normalized.runId);
        }
        const accepted = handler.onBackgroundMessage(normalized);
        if (!accepted) {
            runtime.sendMessage?.({
                kind: "result",
                id: request.id,
                ok: false,
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: "content script unreachable"
                }
            });
        }
    };
    runtime.onMessage.addListener(messageListener);
    state.messageListener = messageListener;
    return true;
};
const globalChrome = globalThis.chrome;
const runtime = globalChrome?.runtime;
const isLikelyContentScriptEnv = typeof window !== "undefined" && typeof document !== "undefined";
if (isLikelyContentScriptEnv && runtime) {
    bootstrapContentScript(runtime);
}
return { bootstrapContentScript };
})();
