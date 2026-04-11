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
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
const XHS_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODE_SET = new Set(EXECUTION_MODES);
const XHS_REQUIRED_APPROVAL_CHECKS = APPROVAL_CHECK_KEYS;
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
    "risk_state_checked",
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "action_type_confirmed",
    "approval_record_approved_true",
    "approval_record_approver_present",
    "approval_record_approved_at_present",
    "approval_record_checks_all_true"
  ]
};

const asRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;

const asBoolean = (value) => value === true;

const asString = (value) => (typeof value === "string" && value.trim().length > 0 ? value.trim() : null);

const asInteger = (value) => (typeof value === "number" && Number.isInteger(value) ? value : null);

const deriveGateDecisionId = (input) => {
  const explicitDecisionId = asString(input.decisionId);
  if (explicitDecisionId) {
    return explicitDecisionId;
  }

  const runId = asString(input.runId);
  if (runId) {
    return `gate_decision_${runId}`;
  }

  const issueScope = asString(input.issueScope) ?? "unknown_scope";
  const targetPage = asString(input.targetPage) ?? "unknown_page";
  const targetTabId = asInteger(input.targetTabId);
  return `gate_decision_${issueScope}_${targetPage}_${targetTabId ?? "unknown_tab"}`;
};

const deriveApprovalId = (input, decisionId) => {
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

  const approvalRecordMatchesDecision = approvalRecord.decision_id === decisionId;

  const explicitApprovalId = asString(input.approvalId);
  if (explicitApprovalId && approvalRecordMatchesDecision) {
    return explicitApprovalId;
  }

  const record = asRecord(input.approvalRecord);
  const recordApprovalId = asString(record?.approval_id);
  if (recordApprovalId && approvalRecordMatchesDecision) {
    return recordApprovalId;
  }

  return `gate_appr_${decisionId}`;
};

const pushReason = (target, reason) => {
  if (!target.includes(reason)) {
    target.push(reason);
  }
};

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
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = resolveXhsRiskState(input.riskState);
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
  const targetDomain = asString(input.targetDomain);
  const targetTabId = asInteger(input.targetTabId);
  const targetPage = asString(input.targetPage);
  const actualTargetDomain = asString(input.actualTargetDomain);
  const actualTargetTabId = asInteger(input.actualTargetTabId);
  const actualTargetPage = asString(input.actualTargetPage);
  const abilityAction = asString(input.abilityAction ?? input.abilityActionType);
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
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
    issueScope,
    riskState,
    approvalRecord,
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
  const issueScope = resolveXhsIssueScope(input.issueScope);
  const riskState = resolveXhsRiskState(input.riskState);
  const actionType = resolveXhsActionType(input.actionType);
  const requestedExecutionMode = resolveXhsExecutionMode(input.requestedExecutionMode);
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

  return {
    issueScope,
    riskState,
    actionType,
    requestedExecutionMode,
    issueActionMatrix,
    writeActionMatrixDecisions,
    writeMatrixDecision,
    issue208WriteGateOnly,
    writeTierReason,
    isLiveReadMode,
    isBlockedByStateMatrix,
    liveModeCanEnter,
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
  const approvalRecord = normalizeXhsApprovalRecord(input.approvalRecord);
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
  }

  return {
    gateReasons,
    approvalRecord,
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
  collectXhsCommandGateReasons({
    gateReasons,
    actionType: input.actionType,
    requestedExecutionMode: input.requestedExecutionMode,
    abilityAction: input.abilityAction ?? input.abilityActionType,
    targetDomain: input.targetDomain,
    targetTabId: input.targetTabId,
    targetPage: input.targetPage,
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
  const { approvalRecord, writeGateOnlyEligible } = collectXhsMatrixGateReasons({
    gateReasons,
    state,
    decisionId,
    approvalRecord: input.approvalRecord,
    issue208EditorInputValidation: input.issue208EditorInputValidation === true,
    includeWriteInteractionTierReason: input.includeWriteInteractionTierReason === true
  });
  const approvalId = deriveApprovalId(input, decisionId);
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
  return {
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
      target_domain: asString(input.targetDomain),
      target_tab_id: asInteger(input.targetTabId),
      target_page: asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      risk_state: state.riskState
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
      target_domain: asString(input.targetDomain),
      target_tab_id: asInteger(input.targetTabId),
      target_page: asString(input.targetPage),
      action_type: state.actionType,
      requested_execution_mode: state.requestedExecutionMode,
      effective_execution_mode: outcome.effectiveExecutionMode,
      gate_decision: outcome.gateDecision,
      gate_reasons: outcome.gateReasons,
      write_interaction_tier: state.writeActionMatrixDecisions?.write_interaction_tier ?? null
    },
    approval_record: approvalRecord
  };
};
return { XHS_ALLOWED_DOMAINS, evaluateXhsGate };
})();
const __webenvoy_module_xhs_search_types = (() => {
const SEARCH_ENDPOINT = "/api/sns/web/v1/search/notes";
return { SEARCH_ENDPOINT };
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
const resolveRiskState = (value) => resolveSharedRiskState(value);
const SEARCH_FAILURE_SEMANTICS = {
    SIGNATURE_ENTRY_MISSING: {
        category: "page_changed",
        stage: "action",
        component: "page",
        target: "window._webmsxyw",
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
const classifyPageKind = (href) => {
    if (href.includes("/login")) {
        return "login";
    }
    if (href.includes("creator.xiaohongshu.com/publish")) {
        return "compose";
    }
    if (href.includes("/search_result")) {
        return "search";
    }
    if (href.includes("/explore/")) {
        return "detail";
    }
    return "unknown";
};
const resolveDiagnosisSemantics = (reason, fallbackCategory) => SEARCH_FAILURE_SEMANTICS[reason] ?? {
    category: fallbackCategory ?? "request_failed",
    stage: "request",
    component: "network",
    target: SEARCH_ENDPOINT,
    includeKeyRequest: true
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
    const businessCode = record?.code;
    const message = typeof record?.msg === "string" ? record.msg : typeof record?.message === "string" ? record.message : "";
    const normalized = `${message}`.toLowerCase();
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
    if (status === 429 || normalized.includes("captcha")) {
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
return { buildEditorInputEvidence, containsCookie, createDiagnosis, createFailure, createObservability, inferFailure, inferRequestException, isTrustedEditorInputValidation, parseCount, resolveSimulatedResult, resolveRiskStateOutput, resolveXsCommon };
})();
const __webenvoy_module_xhs_search_gate = (() => {
const {
  buildRiskTransitionAudit,
  resolveIssueScope: resolveSharedIssueScope,
  resolveRiskState: resolveSharedRiskState
} = __webenvoy_module_risk_state;
const { evaluateXhsGate } = __webenvoy_module_shared_xhs_gate;
const { resolveRiskStateOutput } = __webenvoy_module_xhs_search_telemetry;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const resolveRiskState = (value) => resolveSharedRiskState(value);
const resolveIssueScope = (value) => resolveSharedIssueScope(value);
const isIssue208EditorInputValidation = (options) => options.issue_scope === "issue_208" &&
    options.action_type === "write" &&
    options.requested_execution_mode === "live_write" &&
    options.validation_action === "editor_input";
const buildGateDecisionId = (context) => context.requestId
    ? `gate_decision_${context.runId}_${context.requestId}`
    : `gate_decision_${context.runId}`;
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
const resolveGate = (options, context) => {
    const providedApprovalRecord = (options.approval_record ?? options.approval);
    const approvalRecord = asRecord(providedApprovalRecord);
    const decisionId = buildGateDecisionId(context);
    const approvalId = asNonEmptyString(approvalRecord?.approval_id) ?? undefined;
    return evaluateXhsGate({
        issueScope: options.issue_scope,
        riskState: options.risk_state,
        targetDomain: options.target_domain,
        targetTabId: options.target_tab_id,
        targetPage: options.target_page,
        actualTargetDomain: options.actual_target_domain,
        actualTargetTabId: options.actual_target_tab_id,
        actualTargetPage: options.actual_target_page,
        requireActualTargetPage: true,
        actionType: options.action_type,
        abilityAction: options.ability_action,
        requestedExecutionMode: options.requested_execution_mode,
        approvalRecord: providedApprovalRecord,
        decisionId,
        approvalId,
        issue208EditorInputValidation: isIssue208EditorInputValidation(options),
        treatMissingEditorValidationAsUnsupported: true
    });
};
const createAuditRecord = (context, gate, env) => {
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
const __webenvoy_module_xhs_search_execution = (() => {
const { SEARCH_ENDPOINT } = __webenvoy_module_xhs_search_types;
const {
  createAuditRecord,
  createGateOnlySuccess,
  resolveGate
} = __webenvoy_module_xhs_search_gate;
const {
  buildEditorInputEvidence,
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
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const executeXhsSearch = async (input, env) => {
    const gate = resolveGate(input.options, input.executionContext);
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const startedAt = env.now();
    if (gate.consumer_gate_result.gate_decision === "blocked") {
        return createFailure("ERR_EXECUTION_FAILED", "执行模式门禁阻断了当前 xhs.search 请求", {
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
        }), gate, auditRecord);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, gate, auditRecord, env);
    }
    if (input.options.validation_action === "editor_input" &&
        input.options.issue_scope === "issue_208" &&
        input.options.action_type === "write" &&
        input.options.requested_execution_mode === "live_write") {
        const validationText = typeof input.options.validation_text === "string" && input.options.validation_text.trim().length > 0
            ? input.options.validation_text.trim()
            : "WebEnvoy editor_input validation";
        const focusAttestation = input.options.editor_focus_attestation ?? null;
        const validationResult = env.performEditorInputValidation
            ? await env.performEditorInputValidation({
                text: validationText,
                focusAttestation: focusAttestation
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
                focus_attestation_source: null,
                focus_attestation_reason: null,
                preserved_after_blur: false,
                success_signals: [],
                failure_signals: ["missing_focus_attestation", "dom_variant"],
                minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
            };
        if (!isTrustedEditorInputValidation(validationResult)) {
            return createFailure("ERR_EXECUTION_FAILED", "editor_input 真实验证失败", {
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
            }), gate, auditRecord);
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
                audit_record: auditRecord
            }
        };
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return createFailure("ERR_EXECUTION_FAILED", "登录态缺失，无法执行 xhs.search", {
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
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
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
            timeoutMs: typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
                ? Math.max(1, Math.floor(input.options.timeout_ms))
                : 30_000
        });
    }
    catch (error) {
        const failure = inferRequestException(error);
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
            ability_id: input.abilityId,
            stage: "execution",
            reason: failure.reason
        }, createObservability({
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
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
            href: env.getLocationHref(),
            title: env.getDocumentTitle(),
            readyState: env.getReadyState(),
            requestId: `req-${env.randomId()}`,
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
  containsCookie,
  createDiagnosis,
  createFailure,
  resolveRiskStateOutput,
  resolveXsCommon
} = __webenvoy_module_xhs_search_telemetry;
const XHS_DETAIL_SPEC = {
    command: "xhs.detail",
    endpoint: "/api/sns/web/v1/feed",
    method: "POST",
    pageKind: "detail",
    requestClass: "xhs.detail",
    buildPayload: (params) => ({
        source_note_id: params.note_id
    }),
    buildUrl: () => "/api/sns/web/v1/feed",
    buildSignatureUri: () => "/api/sns/web/v1/feed",
    buildDataRef: (params) => ({
        note_id: params.note_id
    })
};
const XHS_USER_HOME_SPEC = {
    command: "xhs.user_home",
    endpoint: "/api/sns/web/v1/user/otherinfo",
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
    const businessCode = record?.code;
    const message = typeof record?.msg === "string"
        ? record.msg
        : typeof record?.message === "string"
            ? record.message
            : "";
    const normalized = `${message}`.toLowerCase();
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
    if (status === 429 || normalized.includes("captcha")) {
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
            "noteId",
            "id"
        ]));
    }
    return getUserHomeResponseCandidates(body).some((candidate) => containsTargetIdentifier(candidate, params.user_id, [
        "user_id",
        "userId",
        "id"
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
        asNonEmptyString(asRecord(user.basicInfo)?.userId),
        asNonEmptyString(asRecord(user.basicInfo)?.user_id),
        asNonEmptyString(asRecord(user.profile)?.userId),
        asNonEmptyString(asRecord(user.profile)?.user_id)
    ].filter((value) => value !== null);
    if (!candidateUserIds.some((userId) => userId === params.user_id)) {
        return false;
    }
    return asRecord(root?.board) !== null || asRecord(root?.note) !== null || user !== null;
};
const canUsePageStateFallback = (spec, params, root) => spec.command === "xhs.detail"
    ? hasDetailPageStateFallback(params, root)
    : hasUserHomePageStateFallback(params, root);
const createPageStateFallbackFailure = (input, spec, gate, auditRecord, env, payload, startedAt, requestFailure) => {
    const requestId = `req-${env.randomId()}`;
    return createFailure("ERR_EXECUTION_FAILED", requestFailure.message, {
        ability_id: input.abilityId,
        stage: "execution",
        reason: requestFailure.reason
    }, {
        page_state: {
            page_kind: classifyPageKind(env.getLocationHref(), spec.pageKind),
            url: env.getLocationHref(),
            title: env.getDocumentTitle(),
            ready_state: env.getReadyState(),
            fallback_used: true
        },
        key_requests: [
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
            },
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
        failure_site: {
            stage: "request",
            component: "network",
            target: spec.endpoint,
            summary: requestFailure.message
        }
    }, createReadDiagnosis(spec, {
        reason: requestFailure.reason,
        summary: requestFailure.message
    }), gate, auditRecord);
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
const resolveSimulatedResult = (input, spec, payload, env) => {
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
    return createFailure("ERR_EXECUTION_FAILED", mapped.message, {
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
    }));
};
const buildHeaders = (env, options, signature) => ({
    Accept: "application/json, text/plain, */*",
    ...(options.target_domain === "www.xiaohongshu.com" || options.target_domain === undefined
        ? {}
        : {}),
    ...(signature
        ? {
            "X-s": String(signature["X-s"]),
            "X-t": String(signature["X-t"]),
            "X-S-Common": resolveXsCommon(options.x_s_common),
            "x-b3-traceid": env.randomId().replace(/-/g, ""),
            "x-xray-traceid": env.randomId().replace(/-/g, "")
        }
        : {}),
    "Content-Type": "application/json;charset=utf-8"
});
const executeXhsRead = async (input, spec, env) => {
    const gate = resolveGate(input.options, input.executionContext);
    const auditRecord = createAuditRecord(input.executionContext, gate, env);
    const startedAt = env.now();
    const payload = spec.buildPayload(input.params, env);
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
        return createFailure("ERR_EXECUTION_FAILED", `执行模式门禁阻断了当前 ${spec.command} 请求`, {
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
        }), gate, auditRecord);
    }
    if (gate.consumer_gate_result.effective_execution_mode === "dry_run" ||
        gate.consumer_gate_result.effective_execution_mode === "recon") {
        return createGateOnlySuccess(input, spec, gate, auditRecord, env, payload);
    }
    const simulated = resolveSimulatedResult(input, spec, payload, env);
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
                read_execution_policy: gate.read_execution_policy,
                issue_action_matrix: gate.issue_action_matrix,
                consumer_gate_result: gate.consumer_gate_result,
                approval_record: gate.approval_record,
                audit_record: auditRecord
            }
        };
    }
    if (!containsCookie(env.getCookie(), "a1")) {
        return createFailure("ERR_EXECUTION_FAILED", `登录态缺失，无法执行 ${spec.command}`, {
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
        }), gate, auditRecord);
    }
    let signature;
    try {
        signature = await env.callSignature(spec.buildSignatureUri(input.params), payload);
    }
    catch (error) {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
                reason: "SIGNATURE_ENTRY_MISSING",
                message: "页面签名入口不可用",
                detail: error instanceof Error ? error.message : String(error)
            });
        }
        return createFailure("ERR_EXECUTION_FAILED", "页面签名入口不可用", {
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
        }), gate, auditRecord);
    }
    let response;
    try {
        response = await env.fetchJson({
            url: spec.buildUrl(input.params),
            method: spec.method,
            headers: buildHeaders(env, input.options, signature),
            ...(spec.method === "POST" ? { body: JSON.stringify(payload) } : {}),
            timeoutMs: typeof input.options.timeout_ms === "number" && Number.isFinite(input.options.timeout_ms)
                ? Math.max(1, Math.floor(input.options.timeout_ms))
                : 30_000
        });
    }
    catch (error) {
        const failure = inferReadRequestException(spec, error);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.detail
            });
        }
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
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
        }), gate, auditRecord);
    }
    const responseRecord = asRecord(response.body);
    const businessCode = responseRecord?.code;
    if (response.status >= 400 || (typeof businessCode === "number" && businessCode !== 0)) {
        const failure = inferReadFailure(spec, response.status, response.body);
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
                reason: failure.reason,
                message: failure.message,
                detail: failure.message,
                statusCode: response.status
            });
        }
        return createFailure("ERR_EXECUTION_FAILED", failure.message, {
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
            statusCode: response.status,
            failureReason: failure.reason
        }), createReadDiagnosis(spec, {
            reason: failure.reason,
            summary: failure.message
        }), gate, auditRecord);
    }
    if (!responseContainsRequestedTarget(spec, input.params, response.body)) {
        const pageStateRoot = await resolvePageStateRoot();
        if (canUsePageStateFallback(spec, input.params, pageStateRoot)) {
            return createPageStateFallbackFailure(input, spec, gate, auditRecord, env, payload, startedAt, {
                reason: "TARGET_DATA_NOT_FOUND",
                message: `${spec.command} 接口返回成功但未包含目标数据`,
                detail: `${spec.command} response target missing`,
                statusCode: response.status
            });
        }
        return createFailure("ERR_EXECUTION_FAILED", `${spec.command} 接口返回成功但未包含目标数据`, {
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
        }), gate, auditRecord);
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
                    data_ref: spec.buildDataRef(input.params, payload),
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
                approval_record: gate.approval_record,
                risk_state_output: resolveRiskStateOutput(gate, auditRecord),
                audit_record: auditRecord
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
const readPageStateViaMainWorld = async () => {
    const result = await mainWorldCall({
        type: "page-state-read",
        payload: {}
    });
    return typeof result === "object" && result !== null && !Array.isArray(result)
        ? result
        : null;
};
return { encodeMainWorldPayload, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, MAIN_WORLD_EVENT_BOOTSTRAP, readPageStateViaMainWorld, resetMainWorldEventChannelForContract, resolveMainWorldEventNamesForSecret, verifyFingerprintRuntimeViaMainWorld };
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
const {
  encodeMainWorldPayload,
  installFingerprintRuntimeViaMainWorld,
  installMainWorldEventChannelSecret,
  MAIN_WORLD_EVENT_BOOTSTRAP,
  readPageStateViaMainWorld,
  resetMainWorldEventChannelForContract,
  resolveMainWorldEventNamesForSecret
} = __webenvoy_module_content_script_main_world;
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
const asString = (value) => typeof value === "string" && value.length > 0 ? value : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
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
const createBrowserEnvironment = () => ({
    now: () => Date.now(),
    randomId: () => typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `id-${Date.now()}`,
    getLocationHref: () => window.location.href,
    getDocumentTitle: () => document.title,
    getReadyState: () => document.readyState,
    getCookie: () => document.cookie,
    getPageStateRoot: () => window.__INITIAL_STATE__,
    readPageStateRoot: async () => await readPageStateViaMainWorld(),
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
            void this.#handleXhsReadCommand(message);
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
    async #handleXhsReadCommand(message) {
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
        const actualTargetPage = resolveTargetPageFromHref(locationHref, message.command);
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
                    profile: message.profile ?? "unknown",
                    requestId: message.id
                }
            };
            let result;
            if (message.command === "xhs.search") {
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
                    }
                }, this.#xhsEnv);
            }
            else if (message.command === "xhs.detail") {
                result = await executeXhsDetail({
                    ...commonInput,
                    params: {
                        note_id: normalizedInput.note_id
                    }
                }, this.#xhsEnv);
            }
            else {
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
return { ContentScriptHandler, ExtensionContractError, encodeMainWorldPayload, installFingerprintRuntimeViaMainWorld, installMainWorldEventChannelSecret, readPageStateViaMainWorld, resolveFingerprintContextForContract, validateXhsCommandInputForExtension, resolveMainWorldEventNamesForSecret };
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
