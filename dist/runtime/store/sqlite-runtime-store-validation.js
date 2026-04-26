const GATE_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const GATE_RISK_STATES = new Set(["paused", "limited", "allowed"]);
const GATE_DECISIONS = new Set(["allowed", "blocked"]);
const GATE_ISSUE_SCOPES = new Set(["issue_208", "issue_209"]);
const REQUIRED_APPROVAL_CHECKS = new Set([
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "risk_state_checked",
    "action_type_confirmed"
]);
const LIVE_APPROVAL_REQUIRED_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const ANTI_DETECTION_VALIDATION_SCOPES = new Set([
    "layer1_consistency",
    "layer2_interaction",
    "layer3_session_rhythm",
    "cross_layer_baseline"
]);
const ANTI_DETECTION_REQUEST_STATES = new Set([
    "accepted",
    "sampling",
    "completed",
    "aborted"
]);
const ANTI_DETECTION_RESULT_STATES = new Set(["captured", "verified", "broken", "stale"]);
const ANTI_DETECTION_DRIFT_STATES = new Set([
    "no_drift",
    "drift_detected",
    "insufficient_baseline"
]);
const ANTI_DETECTION_FAILURE_CLASSES = new Set([
    "source_unavailable",
    "auth_or_session_required",
    "write_blocked",
    "runtime_error"
]);
const ANTI_DETECTION_REPLACEMENT_REASONS = new Set([
    "initial_seed",
    "reseed_after_drift",
    "probe_bundle_change",
    "manual_reseed"
]);
const ANTI_DETECTION_BROWSER_CHANNELS = new Set(["Google Chrome stable"]);
const ANTI_DETECTION_EXECUTION_SURFACES = new Set([
    "real_browser",
    "stub",
    "fake_host",
    "other"
]);
const TARGET_FR_BY_VALIDATION_SCOPE = new Map([
    ["layer1_consistency", "FR-0012"],
    ["layer2_interaction", "FR-0013"],
    ["layer3_session_rhythm", "FR-0014"]
]);
const CROSS_LAYER_TARGET_PATTERN = /^FR-\d{4,}$/;
const hasTrimmedText = (value) => value.trim().length > 0;
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyStringArray = (value) => Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0);
const isStringArray = (value) => Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0);
const requiresApprovalEvidence = (input) => input.gateDecision === "allowed" &&
    (LIVE_APPROVAL_REQUIRED_EXECUTION_MODES.has(input.requestedExecutionMode) ||
        LIVE_APPROVAL_REQUIRED_EXECUTION_MODES.has(input.effectiveExecutionMode));
const assertAntiDetectionScopeKey = (input, helpers) => {
    if (!hasTrimmedText(input.targetFrRef) ||
        !hasTrimmedText(input.validationScope) ||
        !hasTrimmedText(input.profileRef) ||
        !hasTrimmedText(input.browserChannel) ||
        !hasTrimmedText(input.executionSurface) ||
        !hasTrimmedText(input.effectiveExecutionMode) ||
        !hasTrimmedText(input.probeBundleRef)) {
        helpers.invalidInput("missing required anti-detection scope fields");
    }
    if (!ANTI_DETECTION_VALIDATION_SCOPES.has(input.validationScope)) {
        helpers.invalidInput("invalid validation_scope");
    }
    if (!ANTI_DETECTION_BROWSER_CHANNELS.has(input.browserChannel)) {
        helpers.invalidInput("invalid browser_channel");
    }
    if (!ANTI_DETECTION_EXECUTION_SURFACES.has(input.executionSurface)) {
        helpers.invalidInput("invalid execution_surface");
    }
    if (!EXECUTION_MODES.has(input.effectiveExecutionMode)) {
        helpers.invalidInput("invalid effective_execution_mode");
    }
    const expectedTarget = TARGET_FR_BY_VALIDATION_SCOPE.get(input.validationScope);
    if (expectedTarget && input.targetFrRef !== expectedTarget) {
        helpers.invalidInput("invalid validation_scope and target_fr_ref combination");
    }
    if (input.validationScope === "cross_layer_baseline") {
        if (!CROSS_LAYER_TARGET_PATTERN.test(input.targetFrRef) ||
            input.targetFrRef === "FR-0012" ||
            input.targetFrRef === "FR-0013" ||
            input.targetFrRef === "FR-0014") {
            helpers.invalidInput("invalid cross_layer_baseline target_fr_ref");
        }
    }
};
export const assertUpsertRunInput = (input, helpers) => {
    if (!hasTrimmedText(input.runId) || !hasTrimmedText(input.profileName) || !hasTrimmedText(input.command)) {
        helpers.invalidInput("missing required run fields");
    }
    if (input.status !== "running" && input.status !== "succeeded" && input.status !== "failed") {
        helpers.invalidInput("invalid run status");
    }
    if (!helpers.isIsoLike(input.startedAt) || (input.endedAt !== null && !helpers.isIsoLike(input.endedAt))) {
        helpers.invalidInput("invalid timestamp format");
    }
    if (input.status === "running" && input.endedAt !== null) {
        helpers.invalidInput("running status must not include ended_at");
    }
    if (input.status !== "running" && input.endedAt === null) {
        helpers.invalidInput("final status must include ended_at");
    }
};
export const assertAppendRunEventInput = (input, helpers) => {
    if (!hasTrimmedText(input.runId) ||
        !hasTrimmedText(input.stage) ||
        !hasTrimmedText(input.component) ||
        !hasTrimmedText(input.eventType)) {
        helpers.invalidInput("missing required event fields");
    }
    if (!helpers.isIsoLike(input.eventTime)) {
        helpers.invalidInput("invalid event_time");
    }
    if (typeof input.summaryTruncated !== "boolean") {
        helpers.invalidInput("summary_truncated must be boolean");
    }
};
export const assertGateApprovalInput = (input, helpers) => {
    if (input.approvalId !== undefined && input.approvalId !== null && !hasTrimmedText(input.approvalId)) {
        helpers.invalidInput("invalid approval_id");
    }
    if (!hasTrimmedText(input.runId) || !hasTrimmedText(input.decisionId)) {
        helpers.invalidInput("run_id and decision_id are required");
    }
    if (!input.checks || typeof input.checks !== "object") {
        helpers.invalidInput("checks is required");
    }
    for (const check of REQUIRED_APPROVAL_CHECKS) {
        if (typeof input.checks[check] !== "boolean") {
            helpers.invalidInput(`checks.${check} is required`);
        }
    }
    if (input.approved) {
        if (!input.approver?.trim() || !input.approvedAt || !helpers.isIsoLike(input.approvedAt)) {
            helpers.invalidInput("approved record requires approver and approved_at");
        }
        return;
    }
    if (input.approvedAt !== null && !helpers.isIsoLike(input.approvedAt)) {
        helpers.invalidInput("invalid approved_at");
    }
};
export const assertGateAuditRecordInput = (input, helpers) => {
    if (!hasTrimmedText(input.eventId) ||
        !hasTrimmedText(input.decisionId) ||
        !hasTrimmedText(input.runId) ||
        !hasTrimmedText(input.sessionId) ||
        !hasTrimmedText(input.profile) ||
        !hasTrimmedText(input.issueScope) ||
        !hasTrimmedText(input.riskState) ||
        !hasTrimmedText(input.nextState) ||
        !hasTrimmedText(input.transitionTrigger) ||
        !hasTrimmedText(input.targetDomain) ||
        !hasTrimmedText(input.targetPage) ||
        !hasTrimmedText(input.requestedExecutionMode) ||
        !hasTrimmedText(input.effectiveExecutionMode) ||
        !hasTrimmedText(input.gateDecision)) {
        helpers.invalidInput("missing required gate audit fields");
    }
    if (input.approvalId !== null && !hasTrimmedText(input.approvalId)) {
        helpers.invalidInput("invalid approval_id");
    }
    if (!Number.isInteger(input.targetTabId) || input.targetTabId <= 0) {
        helpers.invalidInput("invalid target_tab_id");
    }
    if (!GATE_RISK_STATES.has(input.riskState)) {
        helpers.invalidInput("invalid risk_state");
    }
    if (!GATE_ISSUE_SCOPES.has(input.issueScope)) {
        helpers.invalidInput("invalid issue_scope");
    }
    if (!GATE_RISK_STATES.has(input.nextState)) {
        helpers.invalidInput("invalid next_state");
    }
    if (input.actionType !== null && !GATE_ACTION_TYPES.has(input.actionType)) {
        helpers.invalidInput("invalid action_type");
    }
    if (!EXECUTION_MODES.has(input.requestedExecutionMode)) {
        helpers.invalidInput("invalid requested_execution_mode");
    }
    if (!EXECUTION_MODES.has(input.effectiveExecutionMode)) {
        helpers.invalidInput("invalid effective_execution_mode");
    }
    const allowedLiveExecution = input.gateDecision === "allowed" &&
        (input.effectiveExecutionMode === "live_read_limited" ||
            input.effectiveExecutionMode === "live_read_high_risk" ||
            input.effectiveExecutionMode === "live_write");
    if (allowedLiveExecution && input.approvalId === null) {
        helpers.invalidInput("approval_id is required for allowed live audit records");
    }
    if (!GATE_DECISIONS.has(input.gateDecision)) {
        helpers.invalidInput("invalid gate_decision");
    }
    if (!Array.isArray(input.gateReasons) || input.gateReasons.length === 0) {
        helpers.invalidInput("gate_reasons is required");
    }
    for (const reason of input.gateReasons) {
        if (typeof reason !== "string" || reason.trim().length === 0) {
            helpers.invalidInput("invalid gate_reasons");
        }
    }
    if (!helpers.isIsoLike(input.recordedAt)) {
        helpers.invalidInput("invalid recorded_at");
    }
    if (requiresApprovalEvidence(input) &&
        (!input.approver?.trim() || !input.approvedAt || !helpers.isIsoLike(input.approvedAt))) {
        helpers.invalidInput("allowed record requires approver and approved_at");
    }
    if (input.approvedAt !== null && !helpers.isIsoLike(input.approvedAt)) {
        helpers.invalidInput("invalid approved_at");
    }
};
export const assertUpsertAntiDetectionValidationRequestInput = (input, helpers) => {
    if (!hasTrimmedText(input.requestRef) ||
        !hasTrimmedText(input.sampleGoal) ||
        !hasTrimmedText(input.requestedExecutionMode) ||
        !hasTrimmedText(input.requestState) ||
        !helpers.isIsoLike(input.requestedAt)) {
        helpers.invalidInput("missing required anti-detection request fields");
    }
    if (!EXECUTION_MODES.has(input.requestedExecutionMode)) {
        helpers.invalidInput("invalid requested_execution_mode");
    }
    if (!ANTI_DETECTION_REQUEST_STATES.has(input.requestState)) {
        helpers.invalidInput("invalid request_state");
    }
    assertAntiDetectionScopeKey({
        targetFrRef: input.targetFrRef,
        validationScope: input.validationScope,
        profileRef: input.profileRef,
        browserChannel: input.browserChannel,
        executionSurface: input.executionSurface,
        effectiveExecutionMode: input.requestedExecutionMode,
        probeBundleRef: input.probeBundleRef
    }, helpers);
};
export const assertInsertAntiDetectionStructuredSampleInput = (input, helpers) => {
    if (!hasTrimmedText(input.sampleRef) ||
        !hasTrimmedText(input.requestRef) ||
        !hasTrimmedText(input.runId) ||
        !helpers.isIsoLike(input.capturedAt)) {
        helpers.invalidInput("missing required anti-detection structured sample fields");
    }
    if (!isRecord(input.structuredPayload)) {
        helpers.invalidInput("structured_payload must be an object");
    }
    if (!isStringArray(input.artifactRefs)) {
        helpers.invalidInput("artifact_refs must be a string array");
    }
    assertAntiDetectionScopeKey(input, helpers);
};
export const assertInsertAntiDetectionBaselineSnapshotInput = (input, helpers) => {
    if (!hasTrimmedText(input.baselineRef) || !helpers.isIsoLike(input.capturedAt)) {
        helpers.invalidInput("missing required anti-detection baseline snapshot fields");
    }
    if (!isRecord(input.signalVector)) {
        helpers.invalidInput("signal_vector must be an object");
    }
    if (!isNonEmptyStringArray(input.sourceSampleRefs)) {
        helpers.invalidInput("source_sample_refs must be a non-empty string array");
    }
    if (!isNonEmptyStringArray(input.sourceRunIds)) {
        helpers.invalidInput("source_run_ids must be a non-empty string array");
    }
    assertAntiDetectionScopeKey(input, helpers);
};
export const assertUpsertAntiDetectionBaselineRegistryEntryInput = (input, helpers) => {
    if (!hasTrimmedText(input.activeBaselineRef) ||
        !hasTrimmedText(input.replacementReason) ||
        !helpers.isIsoLike(input.updatedAt)) {
        helpers.invalidInput("missing required anti-detection baseline registry fields");
    }
    if (!ANTI_DETECTION_REPLACEMENT_REASONS.has(input.replacementReason)) {
        helpers.invalidInput("invalid replacement_reason");
    }
    if (!isStringArray(input.supersededBaselineRefs)) {
        helpers.invalidInput("superseded_baseline_refs must be a string array");
    }
    assertAntiDetectionScopeKey(input, helpers);
};
export const assertInsertAntiDetectionValidationRecordInput = (input, helpers) => {
    if (!hasTrimmedText(input.recordRef) ||
        !hasTrimmedText(input.requestRef) ||
        !hasTrimmedText(input.sampleRef) ||
        !hasTrimmedText(input.resultState) ||
        !hasTrimmedText(input.driftState) ||
        !hasTrimmedText(input.runId) ||
        !helpers.isIsoLike(input.validatedAt)) {
        helpers.invalidInput("missing required anti-detection validation record fields");
    }
    if (!ANTI_DETECTION_RESULT_STATES.has(input.resultState)) {
        helpers.invalidInput("invalid result_state");
    }
    if (!ANTI_DETECTION_DRIFT_STATES.has(input.driftState)) {
        helpers.invalidInput("invalid drift_state");
    }
    if (input.failureClass !== null && !ANTI_DETECTION_FAILURE_CLASSES.has(input.failureClass)) {
        helpers.invalidInput("invalid failure_class");
    }
    if (input.resultState === "captured" && input.driftState !== "insufficient_baseline") {
        helpers.invalidInput("captured record must use insufficient_baseline drift_state");
    }
    if (input.resultState === "verified" && input.driftState !== "no_drift") {
        helpers.invalidInput("verified record must use no_drift drift_state");
    }
    if (input.resultState === "broken" &&
        input.driftState !== "drift_detected" &&
        input.driftState !== "insufficient_baseline") {
        helpers.invalidInput("broken record must use drift_detected or insufficient_baseline");
    }
    if (input.resultState === "stale" && input.driftState !== "insufficient_baseline") {
        helpers.invalidInput("stale record must use insufficient_baseline drift_state");
    }
    if (input.resultState === "broken" && input.failureClass === null) {
        helpers.invalidInput("broken record requires failure_class");
    }
    if (input.resultState !== "broken" && input.failureClass !== null) {
        helpers.invalidInput("failure_class only allowed for broken records");
    }
    if (input.baselineRef === null &&
        input.driftState !== "insufficient_baseline") {
        helpers.invalidInput("baseline_ref may be null only for insufficient_baseline records");
    }
    assertAntiDetectionScopeKey(input, helpers);
};
export const assertAntiDetectionValidationScopeKeyInput = (input, helpers) => {
    assertAntiDetectionScopeKey(input, helpers);
};
export const assertListGateAuditInput = (input, helpers) => {
    if (input.runId !== undefined && input.runId.trim().length === 0) {
        helpers.invalidInput("run_id is empty");
    }
    if (input.sessionId !== undefined && input.sessionId.trim().length === 0) {
        helpers.invalidInput("session_id is empty");
    }
    if (input.profile !== undefined && input.profile.trim().length === 0) {
        helpers.invalidInput("profile is empty");
    }
    if (input.limit !== undefined &&
        (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 100)) {
        helpers.invalidInput("invalid limit");
    }
};
