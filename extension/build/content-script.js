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
const __webenvoy_module_xhs_search = (() => {
const {
  APPROVAL_CHECK_KEYS,
  EXECUTION_MODES,
  WRITE_INTERACTION_TIER,
  buildRiskTransitionAudit,
  buildUnifiedRiskStateOutput,
  getWriteActionMatrixDecisions,
  getIssueActionMatrixEntry,
  resolveIssueScope: resolveSharedIssueScope,
  resolveRiskState: resolveSharedRiskState
} = __webenvoy_module_risk_state;
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const containsCookie = (cookie, key) => cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item.startsWith(`${key}=`));
const resolveXsCommon = (value) => {
    if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
    }
    return "{}";
};
const executeXhsSearch = async (input, env) => {
    const gate = resolveGate(input.options);
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        }, {
            page_state: {
                page_kind: classifyPageKind(env.getLocationHref()),
                url: env.getLocationHref(),
                title: env.getDocumentTitle(),
                ready_state: env.getReadyState()
            },
            key_requests: [],
            failure_site: {
                stage: "execution",
                component: "gate",
                target: "requested_execution_mode",
                summary: "执行模式门禁阻断"
            }
        }, {
            category: "request_failed",
            stage: "execution",
            component: "gate",
            failure_site: {
                stage: "execution",
                component: "gate",
                target: "requested_execution_mode",
                summary: "执行模式门禁阻断"
            },
            evidence: gate.consumer_gate_result.gate_reasons
        }, gate, auditRecord);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, gate, auditRecord, env);
    }
    if (isIssue208EditorInputValidation(input.options)) {
        const startedAt = env.now();
        const validationText = resolveEditorValidationText(input.options);
        const focusAttestation = resolveEditorFocusAttestation(input.options);
        const validationResult = env.performEditorInputValidation
            ? await env.performEditorInputValidation({
                text: validationText,
                focusAttestation
            })
            : {
                ok: false,
                mode: "dom_editor_input_validation",
                attestation: "dom_self_certified",
                editor_locator: null,
                input_text: validationText,
                before_text: "",
                visible_text: "",
                post_blur_text: "",
                focus_confirmed: false,
                focus_attestation_source: focusAttestation?.source ?? null,
                focus_attestation_reason: focusAttestation?.failure_reason ?? null,
                preserved_after_blur: false,
                success_signals: [],
                failure_signals: ["missing_focus_attestation", "dom_variant"],
                minimum_replay: [
                    "enter_editable_mode",
                    "focus_editor",
                    "type_short_text",
                    "blur_or_reobserve"
                ]
            };
        if (!isTrustedEditorInputValidation(validationResult)) {
            return createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
                ability_id: input.abilityId,
                stage: "execution",
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                ...buildEditorInputEvidence(validationResult)
            }, {
                page_state: {
                    page_kind: classifyPageKind(env.getLocationHref()),
                    url: env.getLocationHref(),
                    title: env.getDocumentTitle(),
                    ready_state: env.getReadyState()
                },
                key_requests: [],
                failure_site: {
                    stage: "execution",
                    component: "page",
                    target: validationResult.editor_locator ?? "editor_input",
                    summary: validationResult.failure_signals[0] ?? "editor_input validation failed"
                }
            }, {
                category: "page_changed",
                reason: "EDITOR_INPUT_VALIDATION_FAILED",
                summary: validationResult.failure_signals[0] ?? "editor_input validation failed"
            }, gate, auditRecord);
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
                    approval_record: gate.approval_record,
                    risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                    audit_record: auditRecord,
                    interaction_result: buildEditorInputEvidence(validationResult)
                },
                observability: {
                    page_state: {
                        page_kind: classifyPageKind(env.getLocationHref()),
                        url: env.getLocationHref(),
                        title: env.getDocumentTitle(),
                        ready_state: env.getReadyState()
                    },
                    key_requests: [],
                    failure_site: null
                }
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
                details: {
                    ability_id: input.abilityId,
                    ...(asRecord(simulated.payload.details) ?? {})
                },
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                audit_record: auditRecord
            }
        };
    }
    const startedAt = env.now();
    const href = env.getLocationHref();
    const title = env.getDocumentTitle();
    const readyState = env.getReadyState();
    const requestId = `req-${env.randomId()}`;
    const timeoutMs = typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
        ? Math.max(1, Math.floor(input.options.timeout_ms))
        : 30_000;
    if (!containsCookie(env.getCookie(), "a1")) {
        return createFailure("ERR_EXECUTION_FAILED", "登录态缺失，无法执行 xhs.search", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SESSION_EXPIRED"
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: "SESSION_EXPIRED"
        }), createDiagnosis({
            reason: "SESSION_EXPIRED",
            summary: "登录态缺失，无法执行 xhs.search"
        }), gate, auditRecord);
    }
    const payload = {
        keyword: input.params.query,
        page: input.params.page ?? 1,
        page_size: input.params.limit ?? 20,
        search_id: input.params.search_id ?? env.randomId(),
        sort: input.params.sort ?? "general",
        note_type: input.params.note_type ?? 0
    };
    let signature;
    try {
        signature = await env.callSignature(SEARCH_ENDPOINT, payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
            ability_id: input.abilityId,
            stage: "execution",
            reason: "SIGNATURE_ENTRY_MISSING"
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: message,
            includeKeyRequest: false,
            failureSite: {
                stage: "action",
                component: "page",
                target: "window._webmsxyw",
                summary: "页面签名入口不可用"
            }
        }), createDiagnosis({
            reason: "SIGNATURE_ENTRY_MISSING",
            summary: "页面签名入口不可用"
        }), gate, auditRecord);
    }
    const headers = {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json;charset=utf-8",
        "X-s": String(signature["X-s"]),
        "X-t": String(signature["X-t"]),
        "X-S-Common": resolveXsCommon(input.options.x_s_common),
        "x-b3-traceid": env.randomId().replace(/-/g, ""),
        "x-xray-traceid": env.randomId().replace(/-/g, "")
    };
    let response;
    try {
        response = await env.fetchJson({
            url: SEARCH_ENDPOINT,
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            timeoutMs
        });
    }
    catch (error) {
        const failure = inferRequestException(error);
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            failureReason: failure.detail
        }), createDiagnosis({
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = responseRecord?.code;
    if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
        const failure = inferFailure(response.status, response.body);
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href,
            title,
            readyState,
            requestId,
            outcome: "failed",
            statusCode: response.status,
            failureReason: failure.reason
        }), createDiagnosis({
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord);
    }
    const count = parseCount(response.body);
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
                        search_id: payload.search_id
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
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                audit_record: auditRecord
            },
            observability: createObservability({
                href,
                title,
                readyState,
                requestId,
                outcome: "completed",
                statusCode: response.status
            })
        }
    };
};
return { executeXhsSearch };
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
const __webenvoy_module_content_script_main_world = (() => {
const MAIN_WORLD_EVENT_NAMESPACE = "webenvoy.main_world.bridge.v1";
const MAIN_WORLD_EVENT_REQUEST_PREFIX = "__mw_req__";
const MAIN_WORLD_EVENT_RESULT_PREFIX = "__mw_res__";
const MAIN_WORLD_EVENT_BOOTSTRAP = "__mw_bootstrap__";
const MAIN_WORLD_CALL_TIMEOUT_MS = 5_000;
let mainWorldEventChannel = null;
let mainWorldResultListener = null;
let mainWorldResultListenerEventName = null;
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
        result_event: names.resultEvent
    };
};
const resolveMainWorldEventNamesForSecret = (secret) => {
    const hashed = hashMainWorldEventChannel(`${MAIN_WORLD_EVENT_NAMESPACE}|${secret}`);
    return {
        requestEvent: `${MAIN_WORLD_EVENT_REQUEST_PREFIX}${hashed}`,
        resultEvent: `${MAIN_WORLD_EVENT_RESULT_PREFIX}${hashed}`
    };
};
const createWindowEvent = (type, detail) => {
    const CustomEventCtor = globalThis.CustomEvent;
    if (typeof CustomEventCtor === "function") {
        return new CustomEventCtor(type, { detail });
    }
    return { type, detail };
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
    pending.reject(new Error(message));
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
    if (mainWorldEventChannel?.secret === normalizedSecret &&
        mainWorldResultListenerEventName === names.resultEvent) {
        return true;
    }
    detachMainWorldResultListener();
    window.addEventListener(names.resultEvent, onMainWorldResultEvent);
    mainWorldEventChannel = {
        secret: normalizedSecret,
        requestEvent: names.requestEvent,
        resultEvent: names.resultEvent
    };
    mainWorldResultListener = onMainWorldResultEvent;
    mainWorldResultListenerEventName = names.resultEvent;
    window.dispatchEvent(createWindowEvent(MAIN_WORLD_EVENT_BOOTSTRAP, createMainWorldBootstrapDetail(normalizedSecret)));
    return true;
};
const resetMainWorldEventChannelForContract = () => {
    for (const pending of pendingMainWorldRequests.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("main world request reset"));
    }
    pendingMainWorldRequests.clear();
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
        const timeout = setTimeout(() => {
            pendingMainWorldRequests.delete(requestId);
            reject(new Error("main world event channel response timeout"));
        }, MAIN_WORLD_CALL_TIMEOUT_MS);
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
return { encodeMainWorldPayload, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, MAIN_WORLD_EVENT_BOOTSTRAP, resetMainWorldEventChannelForContract, resolveMainWorldEventNamesForSecret, verifyFingerprintRuntimeViaMainWorld };
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
  encodeMainWorldPayload,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  resetMainWorldEventChannelForContract,
  resolveMainWorldEventNamesForSecret
} = __webenvoy_module_content_script_main_world;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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
const createBrowserEnvironment = () => ({
    now: () => Date.now(),
    randomId: () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}`,
    getLocationHref: () => window.location.href,
    getDocumentTitle: () => document.title,
    getReadyState: () => document.readyState,
    getCookie: () => document.cookie,
    callSignature: async (uri, payload) => await requestXhsSignatureViaExtension(uri, payload),
    fetchJson: async (input) => {
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
const resolveTargetPageFromHref = (href) => {
    try {
        const url = new URL(href);
        if (url.hostname === "www.xiaohongshu.com" && url.pathname.startsWith("/search_result")) {
            return "search_result_tab";
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
        if (message.command === "xhs.search") {
            void this.#handleXhsSearch(message);
            return true;
        }
        const result = this.#handleForward(message);
        for (const listener of this.#listeners) {
            listener(result);
        }
        return true;
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
    async #handleXhsSearch(message) {
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
        const ability = asRecord(message.commandParams.ability);
        const input = asRecord(message.commandParams.input);
        const options = asRecord(message.commandParams.options) ?? {};
        const locationHref = this.#xhsEnv.getLocationHref();
        const actualTargetDomain = resolveTargetDomainFromHref(locationHref);
        const actualTargetPage = resolveTargetPageFromHref(locationHref);
        if (!ability || !input) {
            this.#emit({
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: "xhs.search payload missing ability or input"
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
            const result = await executeXhsSearch({
                abilityId: String(ability.id ?? "unknown"),
                abilityLayer: String(ability.layer ?? "L3"),
                abilityAction: String(ability.action ?? "read"),
                params: {
                    query: String(input.query ?? ""),
                    ...(typeof input.limit === "number" ? { limit: input.limit } : {}),
                    ...(typeof input.page === "number" ? { page: input.page } : {}),
                    ...(typeof input.search_id === "string" ? { search_id: input.search_id } : {}),
                    ...(typeof input.sort === "string" ? { sort: input.sort } : {}),
                    ...(typeof input.note_type === "string" || typeof input.note_type === "number"
                        ? { note_type: input.note_type }
                        : {})
                },
                options: {
                    ...(typeof options.timeout_ms === "number" ? { timeout_ms: options.timeout_ms } : {}),
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
                    ...(typeof options.validation_action === "string"
                        ? { validation_action: options.validation_action }
                        : {}),
                    ...(typeof options.validation_text === "string"
                        ? { validation_text: options.validation_text }
                        : {}),
                    ...(asRecord(options.editor_focus_attestation)
                        ? {
                            editor_focus_attestation: asRecord(options.editor_focus_attestation) ?? {}
                        }
                        : {}),
                    ...(asRecord(options.approval_record)
                        ? { approval_record: asRecord(options.approval_record) ?? {} }
                        : {}),
                    ...(asRecord(options.approval) ? { approval: asRecord(options.approval) ?? {} } : {})
                },
                executionContext: {
                    runId: message.runId,
                    sessionId: String(message.params.session_id ?? "nm-session-001"),
                    profile: message.profile ?? "unknown"
                }
            }, this.#xhsEnv);
            this.#emit(this.#toContentMessage(message.id, result, fingerprintRuntime));
        }
        catch (error) {
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
return { ContentScriptHandler, encodeMainWorldPayload, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, resolveFingerprintContextForContract, resolveMainWorldEventNamesForSecret };
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
const bootstrapContentScript = (runtime) => {
    if (!runtime.onMessage?.addListener || !runtime.sendMessage) {
        return false;
    }
    const handler = new ContentScriptHandler();
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
    handler.onResult((message) => {
        runtime.sendMessage?.(message);
    });
    runtime.onMessage.addListener((message) => {
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
    });
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
