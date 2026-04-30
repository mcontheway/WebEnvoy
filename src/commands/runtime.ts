import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { CommandDefinition, RuntimeContext } from "../core/types.js";
import {
  WRITE_INTERACTION_TIER,
  getWriteActionMatrixDecisions,
  isIssueScope
} from "../../shared/risk-state.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import { buildRuntimeBootstrapContextId } from "../runtime/runtime-bootstrap.js";
import { buildFingerprintContextForMeta, appendFingerprintContext } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { toSessionRhythmStatusView } from "../runtime/xhs-closeout-rhythm.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import {
  buildUnifiedRiskStateOutput,
  resolveRiskState,
  type RiskState
} from "../runtime/risk-state.js";
import {
  RuntimeStoreError,
  SQLiteRuntimeStore,
  resolveRuntimeStorePath,
  type AntiDetectionExecutionMode,
  type AntiDetectionStructuredSampleRecord,
  type GateAuditRecord,
  type SessionRhythmStatusViewRecord
} from "../runtime/store/sqlite-runtime-store.js";
import {
  persistXhsCloseoutValidationSourceSamples,
  readXhsCloseoutValidationGateView,
  toXhsCloseoutValidationGateJson,
  type XhsCloseoutValidationSignalMap
} from "../runtime/anti-detection-validation.js";

const asBoolean = (value: unknown): boolean => value === true;
const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const buildPersistedSessionRhythmStatusView = (
  persisted: SessionRhythmStatusViewRecord
): Record<string, unknown> => {
  const windowState = persisted.window_state;
  const event = persisted.event;
  const currentPhase = asString(windowState.current_phase) ?? "unknown";
  return {
    profile: windowState.profile,
    platform: windowState.platform,
    issue_scope: windowState.issue_scope,
    current_phase: currentPhase,
    current_risk_state: windowState.risk_state,
    window_state: currentPhase === "steady" ? "stability" : currentPhase,
    cooldown_until: windowState.cooldown_until ?? null,
    stability_window_until: windowState.stability_window_until ?? null,
    latest_event_id: event.event_id ?? null,
    latest_reason: event.reason ?? null,
    derived_at: windowState.updated_at ?? null,
    session_rhythm_window_state: windowState,
    session_rhythm_event: event,
    session_rhythm_decision: persisted.decision
  };
};
const asObject = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);
const asStringArrayStrict = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim().length > 0)
    ? value.map((item) => item.trim())
    : null;

const resolveRuntimeBridge = (): NativeMessagingBridge => {
  if (process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback") {
    return new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });
  }

  return new NativeMessagingBridge({
    transport: new NativeHostBridgeTransport()
  });
};
const profileRuntime = new ProfileRuntimeService();

const deriveWriteActionDecisions = (
  auditRecord: Record<string, unknown>
): ReturnType<typeof getWriteActionMatrixDecisions> | null => {
  const issueScope = asString(auditRecord.issue_scope);
  const actionType = asString(auditRecord.action_type);
  const requestedExecutionMode = asString(auditRecord.requested_execution_mode);
  if (!issueScope || !isIssueScope(issueScope) || !actionType || !requestedExecutionMode) {
    return null;
  }
  return getWriteActionMatrixDecisions(issueScope, actionType, requestedExecutionMode);
};

const enrichAuditRecordWithWriteTier = (auditRecord: Record<string, unknown>) => {
  const writeActionMatrixDecisions = deriveWriteActionDecisions(auditRecord);
  const existingGateReasons = asStringArray(auditRecord.gate_reasons);
  const derivedGateReasons = [...existingGateReasons];
  const tierReason = writeActionMatrixDecisions
    ? `WRITE_INTERACTION_TIER_${String(writeActionMatrixDecisions.write_interaction_tier).toUpperCase()}`
    : null;
  if (
    writeActionMatrixDecisions &&
    writeActionMatrixDecisions.action_type !== "read" &&
    tierReason &&
    !derivedGateReasons.some((reason) => reason === tierReason)
  ) {
    derivedGateReasons.push(tierReason);
  }
  return {
    ...auditRecord,
    gate_reasons: derivedGateReasons,
    write_interaction_tier: writeActionMatrixDecisions?.write_interaction_tier ?? null,
    write_action_matrix_decisions: writeActionMatrixDecisions
  };
};

const buildSessionRhythmStatusViewForProfile = async (
  cwd: string,
  profile: string | null,
  input?: {
    store?: SQLiteRuntimeStore;
    sessionId?: string | null;
    sourceRunId?: string | null;
    sourceAuditEventId?: string | null;
    effectiveExecutionMode?: string | null;
  }
): Promise<Record<string, unknown> | null> => {
  if (!profile) {
    return null;
  }
  const profileStore = new ProfileStore(resolveRuntimeProfileRoot(cwd));
  try {
    const meta = await profileStore.readMeta(profile, { mode: "readonly" });
    const fallbackView = toSessionRhythmStatusView({
      profile,
      rhythm: meta?.xhsCloseoutRhythm,
      accountSafety: meta?.accountSafety,
      sessionId: input?.sessionId ?? null,
      sourceRunId: input?.sourceRunId ?? null,
      sourceAuditEventId: input?.sourceAuditEventId ?? null,
      effectiveExecutionMode: input?.effectiveExecutionMode ?? null
    });
    const store = input?.store;
    if (!store) {
      return fallbackView;
    }
    const persisted = await store.getSessionRhythmStatusView({
      profile,
      platform: "xhs",
      issueScope: "issue_209",
      sessionId: input?.sessionId ?? null,
      runId: input?.sourceRunId ?? null
    });
    return persisted ? buildPersistedSessionRhythmStatusView(persisted) : fallbackView;
  } catch {
    return null;
  }
};

const resolveAntiDetectionEffectiveExecutionMode = (value: unknown) => {
  const mode = asString(value) ?? "live_read_high_risk";
  if (isAntiDetectionExecutionMode(mode)) {
    return mode;
  }
  return "live_read_high_risk";
};

const isAntiDetectionExecutionMode = (mode: string): mode is AntiDetectionExecutionMode =>
    mode === "dry_run" ||
    mode === "recon" ||
    mode === "live_read_limited" ||
    mode === "live_read_high_risk" ||
    mode === "live_write";

const buildAntiDetectionValidationViewForProfile = async (input: {
  store: SQLiteRuntimeStore;
  profile: string | null;
  effectiveExecutionMode: unknown;
}): Promise<Record<string, unknown> | null> => {
  if (!input.profile) {
    return null;
  }
  const gate = await readXhsCloseoutValidationGateView({
    store: input.store,
    profile: input.profile,
    effectiveExecutionMode: resolveAntiDetectionEffectiveExecutionMode(input.effectiveExecutionMode)
  });
  return toXhsCloseoutValidationGateJson(gate);
};

const parseXhsCloseoutValidationSignals = (
  signals: unknown
): XhsCloseoutValidationSignalMap | null => {
  const payload = asObject(signals);
  if (!payload) {
    return null;
  }
  const layer1 = asObject(payload.layer1_consistency);
  const layer2 = asObject(payload.layer2_interaction);
  const layer3 = asObject(payload.layer3_session_rhythm);
  if (!layer1 || !layer2 || !layer3) {
    return null;
  }
  return {
    layer1_consistency: layer1,
    layer2_interaction: layer2,
    layer3_session_rhythm: layer3
  };
};

const parseSourceSampleRefs = (value: unknown): string[] | null => {
  const refs = asStringArrayStrict(value);
  if (!refs || refs.length !== 3 || new Set(refs).size !== refs.length) {
    return null;
  }
  return refs;
};

const requiredXhsCloseoutSampleScopes = [
  ["FR-0012", "layer1_consistency"],
  ["FR-0013", "layer2_interaction"],
  ["FR-0014", "layer3_session_rhythm"]
] as const;

const sampleSignal = (sample: AntiDetectionStructuredSampleRecord): Record<string, unknown> | null => {
  const payload = asObject(sample.structured_payload);
  return asObject(payload?.signal);
};

const sampleSourceGateAudit = (
  sample: AntiDetectionStructuredSampleRecord
): Record<string, unknown> | null => {
  const payload = asObject(sample.structured_payload);
  return asObject(payload?.source_gate_audit);
};

const isoTimeMs = (value: string | null | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sampleMatchesSourceGateAudit = (
  sample: AntiDetectionStructuredSampleRecord,
  sourceAudit: GateAuditRecord
): boolean => {
  const sourceGateAudit = sampleSourceGateAudit(sample);
  const capturedAt = isoTimeMs(sample.captured_at);
  const approvedAt = isoTimeMs(sourceAudit.approved_at);
  if (!sourceGateAudit) {
    return false;
  }
  return (
    sourceGateAudit.event_id === sourceAudit.event_id &&
    sourceGateAudit.decision_id === sourceAudit.decision_id &&
    sourceGateAudit.session_id === sourceAudit.session_id &&
    sourceGateAudit.target_domain === sourceAudit.target_domain &&
    sourceGateAudit.target_tab_id === sourceAudit.target_tab_id &&
    sourceGateAudit.target_page === sourceAudit.target_page &&
    sourceGateAudit.action_type === sourceAudit.action_type &&
    sourceGateAudit.requested_execution_mode === sourceAudit.requested_execution_mode &&
    sourceGateAudit.effective_execution_mode === sourceAudit.effective_execution_mode &&
    capturedAt !== null &&
    approvedAt !== null &&
    capturedAt >= approvedAt
  );
};

const sourceAuditMatchesXhsCloseoutScope = (input: {
  sourceAudit: GateAuditRecord;
  profile: string | null;
  targetDomain: string;
  requestedExecutionMode: "live_read_high_risk";
}): boolean => {
  return (
    input.sourceAudit.profile === input.profile &&
    input.sourceAudit.issue_scope === "issue_209" &&
    input.sourceAudit.target_domain === input.targetDomain &&
    input.sourceAudit.target_page === "search_result_tab" &&
    input.sourceAudit.action_type === "read" &&
    input.sourceAudit.requested_execution_mode === input.requestedExecutionMode &&
    input.sourceAudit.effective_execution_mode === input.requestedExecutionMode &&
    input.sourceAudit.gate_decision === "allowed" &&
    input.sourceAudit.gate_reasons.includes("LIVE_MODE_APPROVED")
  );
};

const readXhsCloseoutValidationSignalsFromSourceSamples = async (input: {
  store: SQLiteRuntimeStore;
  sourceRunId: string;
  sourceAudit: GateAuditRecord;
  profile: string | null;
  requestedExecutionMode: "live_read_high_risk";
  sourceSampleRefs: string[];
}): Promise<{
  signals: XhsCloseoutValidationSignalMap;
  artifactRefs: string[];
  sourceSamples: AntiDetectionStructuredSampleRecord[];
}> => {
  const samples = await Promise.all(
    input.sourceSampleRefs.map((sampleRef) => input.store.getAntiDetectionStructuredSample(sampleRef))
  );
  const artifactRefs = new Set<string>();
  const signals: Partial<XhsCloseoutValidationSignalMap> = {};
  for (const [targetFrRef, validationScope] of requiredXhsCloseoutSampleScopes) {
    const sample =
      samples.find(
        (candidate): candidate is AntiDetectionStructuredSampleRecord =>
          candidate !== null &&
          candidate.target_fr_ref === targetFrRef &&
          candidate.validation_scope === validationScope
      ) ?? null;
    const sampleRequest = sample
      ? await input.store.getAntiDetectionValidationRequest(sample.request_ref)
      : null;
    const signal = sample ? sampleSignal(sample) : null;
    if (
      !sample ||
      !sampleRequest ||
      !signal ||
      sample.run_id !== input.sourceRunId ||
      sample.profile_ref !== `profile/${input.profile ?? ""}` ||
      sample.browser_channel !== "Google Chrome stable" ||
      sample.execution_surface !== "real_browser" ||
      sample.effective_execution_mode !== input.requestedExecutionMode ||
      sample.probe_bundle_ref !== "probe-bundle/xhs-closeout-min-v1" ||
      sampleRequest.requested_execution_mode !== input.requestedExecutionMode ||
      sampleRequest.request_state !== "completed" ||
      sampleRequest.target_fr_ref !== targetFrRef ||
      sampleRequest.validation_scope !== validationScope ||
      sampleRequest.profile_ref !== `profile/${input.profile ?? ""}` ||
      sampleRequest.browser_channel !== "Google Chrome stable" ||
      sampleRequest.execution_surface !== "real_browser" ||
      sampleRequest.probe_bundle_ref !== "probe-bundle/xhs-closeout-min-v1" ||
      !sampleMatchesSourceGateAudit(sample, input.sourceAudit)
    ) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source samples are not eligible",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_SAMPLE_INVALID",
            source_run_id: input.sourceRunId,
            target_fr_ref: targetFrRef,
            validation_scope: validationScope,
            sample_ref: sample?.sample_ref ?? null,
            sample_run_id: sample?.run_id ?? null,
            sample_profile_ref: sample?.profile_ref ?? null,
            sample_effective_execution_mode: sample?.effective_execution_mode ?? null,
            sample_request_ref: sampleRequest?.request_ref ?? null,
            sample_request_execution_mode: sampleRequest?.requested_execution_mode ?? null,
            sample_request_state: sampleRequest?.request_state ?? null,
            sample_gate_audit_matched: sample
              ? sampleMatchesSourceGateAudit(sample, input.sourceAudit)
              : false
          }
        }
      );
    }
    if (validationScope === "layer1_consistency") {
      signals.layer1_consistency = signal;
    } else if (validationScope === "layer2_interaction") {
      signals.layer2_interaction = signal;
    } else if (validationScope === "layer3_session_rhythm") {
      signals.layer3_session_rhythm = signal;
    }
    for (const artifactRef of sample.artifact_refs) {
      artifactRefs.add(artifactRef);
    }
  }
  const parsedSignals = parseXhsCloseoutValidationSignals(signals);
  if (!parsedSignals) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source samples did not cover all required scopes",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_SAMPLES_INCOMPLETE",
          source_run_id: input.sourceRunId
        }
      }
    );
  }
  return {
    signals: parsedSignals,
    artifactRefs: [...artifactRefs],
    sourceSamples: samples.filter(
      (sample): sample is AntiDetectionStructuredSampleRecord => sample !== null
    )
  };
};

const assertXhsCloseoutValidationSourceAudit = async (input: {
  store: SQLiteRuntimeStore;
  sourceRunId: string;
  profile: string | null;
  targetDomain: string;
  requestedExecutionMode: "live_read_high_risk";
  sourceSampleRefs: string[];
}): Promise<GateAuditRecord> => {
  const samples = await Promise.all(
    input.sourceSampleRefs.map((sampleRef) => input.store.getAntiDetectionStructuredSample(sampleRef))
  );
  const sampleGateAudits = samples.map((sample) =>
    sample ? sampleSourceGateAudit(sample) : null
  );
  const sampleGateAudit = sampleGateAudits[0] ?? null;
  const allSamplesReferenceSameGateAudit =
    !!sampleGateAudit &&
    sampleGateAudits.every(
      (gateAudit) =>
        gateAudit &&
        gateAudit.event_id === sampleGateAudit.event_id &&
        gateAudit.decision_id === sampleGateAudit.decision_id &&
        gateAudit.session_id === sampleGateAudit.session_id &&
        gateAudit.target_tab_id === sampleGateAudit.target_tab_id
    );
  let sourceAudit: GateAuditRecord | null = null;
  if (
    allSamplesReferenceSameGateAudit &&
    typeof sampleGateAudit.event_id === "string" &&
    typeof sampleGateAudit.decision_id === "string" &&
    typeof sampleGateAudit.session_id === "string"
  ) {
    sourceAudit = await input.store.getGateAuditRecordByIdentity({
      runId: input.sourceRunId,
      eventId: sampleGateAudit.event_id,
      decisionId: sampleGateAudit.decision_id,
      sessionId: sampleGateAudit.session_id
    });
  }
  const approvalRecord =
    typeof sourceAudit?.decision_id === "string" && sourceAudit.decision_id.length > 0
      ? await input.store.getGateApprovalByDecisionId(sourceAudit.decision_id)
      : null;
  const approvalChecks = approvalRecord?.checks ?? {};
  const approvalChecksComplete =
    approvalRecord?.approved === true &&
    typeof approvalRecord.approver === "string" &&
    approvalRecord.approver.trim().length > 0 &&
    typeof approvalRecord.approved_at === "string" &&
    approvalRecord.approved_at.trim().length > 0 &&
    [
      "target_domain_confirmed",
      "target_tab_confirmed",
      "target_page_confirmed",
      "risk_state_checked",
      "action_type_confirmed"
    ].every((key) => approvalChecks[key] === true);
  const approvalMatches =
    approvalChecksComplete &&
    typeof sourceAudit?.approval_id === "string" &&
    sourceAudit.approval_id.length > 0 &&
    approvalRecord?.approval_id === sourceAudit.approval_id &&
    approvalRecord.decision_id === sourceAudit.decision_id;
  if (
    sourceAudit &&
    sourceAuditMatchesXhsCloseoutScope({
      sourceAudit,
      profile: input.profile,
      targetDomain: input.targetDomain,
      requestedExecutionMode: input.requestedExecutionMode
    }) &&
    approvalMatches
  ) {
    return sourceAudit;
  }

  throw new CliError(
    "ERR_EXECUTION_FAILED",
    "XHS closeout validation source audit is not eligible",
    {
      retryable: false,
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "execution",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_AUDIT_INVALID",
        source_run_id: input.sourceRunId,
        source_profile: sourceAudit?.profile ?? null,
        expected_profile: input.profile,
        source_target_domain: sourceAudit?.target_domain ?? null,
        source_requested_execution_mode: sourceAudit?.requested_execution_mode ?? null,
        source_effective_execution_mode: sourceAudit?.effective_execution_mode ?? null,
        source_gate_decision: sourceAudit?.gate_decision ?? null,
        approval_matched: approvalMatches,
        approval_checks_complete: approvalChecksComplete,
        source_samples_bound_to_gate_audit: allSamplesReferenceSameGateAudit
      }
    }
  );
};

const runtimeXhsCloseoutValidation = async (context: RuntimeContext) => {
  const targetDomain = asString(context.params.target_domain);
  const requestedExecutionMode = asString(context.params.requested_execution_mode);
  const sourceRunId = asString(context.params.source_run_id);
  const sourceSampleRefs = parseSourceSampleRefs(context.params.source_sample_refs);
  const observedAt = new Date().toISOString();

  if (targetDomain !== "www.xiaohongshu.com") {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation target_domain invalid", {
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_TARGET_DOMAIN_INVALID"
      }
    });
  }
  if (requestedExecutionMode !== "live_read_high_risk") {
    throw new CliError(
      "ERR_CLI_INVALID_ARGS",
      "XHS closeout validation requires live_read_high_risk mode",
      {
        details: {
          ability_id: "runtime.xhs_closeout_validation",
          stage: "input_validation",
          reason: "XHS_CLOSEOUT_VALIDATION_MODE_INVALID"
        }
      }
    );
  }
  if (!sourceRunId) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation source_run_id required", {
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RUN_ID_REQUIRED"
      }
    });
  }
  if (hasOwn(context.params, "signals")) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation inline signals forbidden", {
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_INLINE_SIGNALS_FORBIDDEN"
      }
    });
  }
  if (hasOwn(context.params, "artifact_refs")) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation inline artifact_refs forbidden", {
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_INLINE_ARTIFACT_REFS_FORBIDDEN"
      }
    });
  }
  if (!sourceSampleRefs) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation source_sample_refs invalid", {
      details: {
        ability_id: "runtime.xhs_closeout_validation",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_SAMPLE_REFS_INVALID"
      }
    });
  }

  let store: SQLiteRuntimeStore | null = null;
  try {
    store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
    const sourceAudit = await assertXhsCloseoutValidationSourceAudit({
      store,
      sourceRunId,
      profile: context.profile,
      targetDomain,
      requestedExecutionMode,
      sourceSampleRefs
    });
    const sourcePayload = await readXhsCloseoutValidationSignalsFromSourceSamples({
      store,
      sourceRunId,
      sourceAudit,
      profile: context.profile,
      requestedExecutionMode,
      sourceSampleRefs
    });
    const gate = await persistXhsCloseoutValidationSourceSamples({
      store,
      profile: context.profile ?? "",
      effectiveExecutionMode: requestedExecutionMode,
      targetDomain,
      validationRunId: context.run_id,
      observedAt,
      sourceRunId,
      sourceSamples: sourcePayload.sourceSamples
    });
    return {
      validation_baseline_generation: {
        source: "runtime.xhs_closeout_validation",
        profile: context.profile,
        target_domain: targetDomain,
        requested_execution_mode: requestedExecutionMode,
        run_id: context.run_id,
        source_run_id: sourceRunId,
        source_audit_event_id: sourceAudit.event_id,
        source_session_id: sourceAudit.session_id,
        observed_at: observedAt,
        artifact_refs: sourcePayload.artifactRefs,
        active_fetch_performed: false,
        closeout_bundle_entered: false
      },
      anti_detection_validation_view: toXhsCloseoutValidationGateJson(gate)
    };
  } catch (error) {
    if (error instanceof RuntimeStoreError) {
      if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
        throw new CliError("ERR_EXECUTION_FAILED", "XHS closeout validation source evidence invalid", {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_PERSISTED_SOURCE_INVALID",
            validation_error: error.message
          }
        });
      }
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
        retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
        cause: error
      });
    }
    throw error;
  } finally {
    try {
      store?.close();
    } catch {
      // Best-effort close after validation baseline generation.
    }
  }
};

const resolveCurrentRiskState = (
  approvalRecord: Record<string, unknown> | null,
  auditRecords: Record<string, unknown>[]
): RiskState => {
  const latestAudit = auditRecords[0] ?? null;
  const auditNextState = latestAudit?.next_state;
  const auditRiskState = latestAudit?.risk_state;
  if (typeof auditNextState === "string") {
    return resolveRiskState(auditNextState);
  }
  const latestRequestedMode =
    typeof latestAudit?.requested_execution_mode === "string"
      ? latestAudit.requested_execution_mode
      : null;
  const latestGateDecision =
    latestAudit?.gate_decision === "allowed" || latestAudit?.gate_decision === "blocked"
      ? latestAudit.gate_decision
      : null;
  const isLatestLiveMode =
    latestRequestedMode === "live_read_limited" ||
    latestRequestedMode === "live_read_high_risk" ||
    latestRequestedMode === "live_write";

  if (latestGateDecision === "blocked" && isLatestLiveMode) {
    const resolvedAuditRiskState = resolveRiskState(auditRiskState);
    if (resolvedAuditRiskState === "allowed") {
      return "limited";
    }
    if (resolvedAuditRiskState === "limited") {
      return "paused";
    }
    return resolvedAuditRiskState;
  }

  if (typeof auditRiskState === "string") {
    return resolveRiskState(auditRiskState);
  }

  const approvalChecks = asObject(approvalRecord?.checks);
  if (approvalRecord?.approved === true && approvalChecks?.risk_state_checked === true) {
    return "allowed";
  }

  const gateReasons = Array.isArray(latestAudit?.gate_reasons)
    ? latestAudit.gate_reasons.filter((item): item is string => typeof item === "string")
    : [];
  if (gateReasons.some((reason) => reason === "RISK_STATE_LIMITED")) {
    return "limited";
  }
  return "paused";
};

const runtimePing = async (context: RuntimeContext) => {
  if (asBoolean(context.params.simulate_runtime_unavailable)) {
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "运行时不可用", { retryable: true });
  }

  if (asBoolean(context.params.force_fail)) {
    throw new Error("forced execution failure");
  }

  let bridge: NativeMessagingBridge | null = null;
  try {
    const requestedExecutionMode =
      typeof context.params.requested_execution_mode === "string"
        ? context.params.requested_execution_mode
        : null;
    const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
    const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
    const bridgeParams = context.profile
      ? appendFingerprintContext(
          context.params,
          buildFingerprintContextForMeta(context.profile, profileMeta, {
            requestedExecutionMode
          })
        )
      : context.params;
    bridge = resolveRuntimeBridge();
    return await bridge.runtimePing({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      params: bridgeParams
    });
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
        retryable: error.retryable,
        cause: error
      });
    }
    throw error;
  } finally {
    await bridge?.close().catch(() => undefined);
  }
};

const runtimeTabs = async (context: RuntimeContext) => {
  let bridge: NativeMessagingBridge | null = null;
  try {
    bridge = resolveRuntimeBridge();
    const result = await bridge.runCommand({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      command: "runtime.tabs",
      params: context.params
    });
    if (!result.ok) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", result.error.message, {
        retryable: result.error.code === "ERR_TRANSPORT_TIMEOUT",
        details: {
          ability_id: "runtime.tabs",
          stage: "execution",
          reason: result.error.code
        }
      });
    }
    return {
      ...(asObject(result.payload) ?? {}),
      relay_path: result.relay_path
    };
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
        retryable: error.retryable,
        cause: error,
        details: {
          ability_id: "runtime.tabs",
          stage: "execution",
          reason: error.code
        }
      });
    }
    throw error;
  } finally {
    await bridge?.close().catch(() => undefined);
  }
};

const isRuntimeRestoreXhsTargetMutation = (params: Record<string, unknown>): boolean =>
  asString(params.target_domain) === "www.xiaohongshu.com" &&
  asString(params.target_page) === "search_result_tab" &&
  typeof params.target_tab_id === "number" &&
  Number.isInteger(params.target_tab_id) &&
  asString(params.query) !== null;

const isRuntimeRestoreXhsSearchTarget = (params: Record<string, unknown>): boolean =>
  asString(params.target_domain) === "www.xiaohongshu.com" &&
  asString(params.target_page) === "search_result_tab" &&
  asString(params.query) !== null;

const buildXhsRestoreSearchResultUrl = (query: string): string => {
  const url = new URL("/search_result", "https://www.xiaohongshu.com");
  url.searchParams.set("keyword", query);
  url.searchParams.set("type", "51");
  return url.toString();
};

const semanticRestoreDenialReasons = new Set([
  "TARGET_RESTORE_PROFILE_REQUIRED",
  "TARGET_RESTORE_INPUT_INVALID",
  "TARGET_RESTORE_TARGET_TAB_REQUIRED",
  "TARGET_RESTORE_SAFETY_GATE_BLOCKED",
  "TARGET_RESTORE_TARGET_TAB_NOT_FOUND",
  "TARGET_RESTORE_MANAGED_TAB_NOT_BOUND",
  "TARGET_RESTORE_NAVIGATION_NOT_READY",
  "TARGET_TAB_ID_UNAVAILABLE"
]);

const retryableRestoreRuntimeFailureReasons = new Set([
  "TARGET_RESTORE_TAB_QUERY_FAILED",
  "TARGET_RESTORE_UNAVAILABLE",
  "TARGET_RESTORE_NAVIGATION_FAILED"
]);

const shouldAttachRuntimeForXhsRestore = (status: Record<string, unknown>): boolean => {
  const takeover = asObject(status.runtimeTakeoverEvidence);
  return (
    status.lockHeld !== true &&
    takeover?.identityBound === true &&
    takeover.ownerConflictFree === true &&
    takeover.controllerBrowserContinuity === true &&
    takeover.transportBootstrapViable === true &&
    (takeover?.attachableReadyRuntime === true ||
      (status.runtimeReadiness === "recoverable" && takeover?.orphanRecoverable === true))
  );
};

const assertRuntimeRestoreXhsTargetSafetyGate = async (
  context: RuntimeContext
): Promise<Record<string, unknown> | null> => {
  if (!context.profile) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "runtime.restore_xhs_target requires profile", {
      details: {
        ability_id: "runtime.restore_xhs_target",
        stage: "input_validation",
        reason: "TARGET_RESTORE_PROFILE_REQUIRED"
      }
    });
  }

  if (
    isRuntimeRestoreXhsSearchTarget(context.params) &&
    !(
      typeof context.params.target_tab_id === "number" &&
      Number.isInteger(context.params.target_tab_id)
    )
  ) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "runtime.restore_xhs_target requires target_tab_id", {
      details: {
        ability_id: "runtime.restore_xhs_target",
        stage: "input_validation",
        reason: "TARGET_RESTORE_TARGET_TAB_REQUIRED"
      }
    });
  }

  if (!isRuntimeRestoreXhsTargetMutation(context.params)) {
    return null;
  }

  let status = await profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile,
    runId: context.run_id,
    params: context.params
  });
  let attachedRuntimeForRestore = false;
  const preAttachTakeover = asObject(status.runtimeTakeoverEvidence);
  const preAttachRuntimeReady =
    (preAttachTakeover?.attachableReadyRuntime === true ||
      preAttachTakeover?.orphanRecoverable === true) &&
    preAttachTakeover?.identityBound === true &&
    preAttachTakeover?.ownerConflictFree === true &&
    preAttachTakeover?.controllerBrowserContinuity === true &&
    preAttachTakeover?.transportBootstrapViable === true;
  if (shouldAttachRuntimeForXhsRestore(status)) {
    await profileRuntime.attach({
      cwd: context.cwd,
      profile: context.profile,
      runId: context.run_id,
      params: context.params
    });
    attachedRuntimeForRestore = true;
    status = await profileRuntime.status({
      cwd: context.cwd,
      profile: context.profile,
      runId: context.run_id,
      params: context.params
    });
  }
  const accountSafety = asObject(status.account_safety);
  const xhsCloseoutRhythm = asObject(status.xhs_closeout_rhythm);
  const rhythmState = asString(xhsCloseoutRhythm?.state);
  const actionRef =
    asString(context.params.action_ref) ??
    asString(context.params.gate_invocation_id) ??
    context.run_id;
  const query = asString(context.params.query);
  const targetUrl = query ? buildXhsRestoreSearchResultUrl(query) : null;
  const runtimeContextId = buildRuntimeBootstrapContextId(context.profile, context.run_id);

  let antiDetectionValidationView: Record<string, unknown> | null = null;
  let store: SQLiteRuntimeStore | null = null;
  try {
    store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
    antiDetectionValidationView = await buildAntiDetectionValidationViewForProfile({
      store,
      profile: context.profile,
      effectiveExecutionMode: "live_read_high_risk"
    });
  } finally {
    store?.close();
  }

  const accountSafetyClear = accountSafety?.state === "clear";
  const recoveryProbeWindow = rhythmState === "single_probe_required";
  const rhythmAllowsRestore =
    rhythmState === "not_required" || rhythmState === "single_probe_passed" || recoveryProbeWindow;
  const officialRuntimeReady =
    status.identityBindingState === "bound" &&
    status.transportState === "ready" &&
    status.bootstrapState === "ready" &&
    status.runtimeReadiness === "ready" &&
    status.executionSurface === "real_browser" &&
    status.headless === false;
  const attachedRuntimeReady =
    attachedRuntimeForRestore &&
    preAttachRuntimeReady &&
    status.lockHeld === true &&
    status.identityBindingState === "bound" &&
    status.transportState === "ready" &&
    status.executionSurface === "real_browser" &&
    status.headless === false;
  const validationReady = antiDetectionValidationView?.all_required_ready === true;
  if (
    accountSafetyClear &&
    rhythmAllowsRestore &&
    (officialRuntimeReady || attachedRuntimeReady) &&
    (recoveryProbeWindow || validationReady)
  ) {
    return {
      source: "cli_persisted_runtime_gate",
      profile_ref: context.profile,
      run_id: context.run_id,
      checked_at: new Date().toISOString(),
      target_domain: context.params.target_domain,
      target_page: context.params.target_page,
      target_tab_id: context.params.target_tab_id,
      target_url: targetUrl,
      runtime_context_id: runtimeContextId,
      action_ref: actionRef,
      restore_runtime_attach_state: attachedRuntimeReady ? "attached_existing_runtime" : "not_required",
      account_safety_state: accountSafety?.state ?? null,
      xhs_closeout_rhythm_state: rhythmState,
      recovery_probe_window: recoveryProbeWindow,
      official_runtime_ready: officialRuntimeReady || attachedRuntimeReady,
      identity_binding_state: status.identityBindingState,
      transport_state: status.transportState,
      bootstrap_state: status.bootstrapState,
      runtime_readiness: status.runtimeReadiness,
      execution_surface: status.executionSurface,
      headless: status.headless,
      anti_detection_validation_ready: validationReady
    };
  }

  throw new CliError("ERR_EXECUTION_FAILED", "XHS target restoration gate blocked current request", {
    retryable: false,
    details: {
      ability_id: "runtime.restore_xhs_target",
      stage: "execution",
      reason: !accountSafetyClear
        ? "ACCOUNT_RISK_BLOCKED"
        : !rhythmAllowsRestore
          ? "XHS_CLOSEOUT_RHYTHM_BLOCKED"
          : !(officialRuntimeReady || attachedRuntimeReady)
            ? "OFFICIAL_RUNTIME_NOT_READY"
            : "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED",
      account_safety: accountSafety,
      xhs_closeout_rhythm: xhsCloseoutRhythm,
      runtime_status: {
        identity_binding_state: status.identityBindingState,
        transport_state: status.transportState,
        bootstrap_state: status.bootstrapState,
        runtime_readiness: status.runtimeReadiness,
        execution_surface: status.executionSurface,
        headless: status.headless
      },
      anti_detection_validation_view: antiDetectionValidationView
    }
  });
};

const runtimeRestoreXhsTarget = async (context: RuntimeContext) => {
  let bridge: NativeMessagingBridge | null = null;
  try {
    const restoreSafetyGate = await assertRuntimeRestoreXhsTargetSafetyGate(context);
    bridge = resolveRuntimeBridge();
    const result = await bridge.runCommand({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      command: "runtime.restore_xhs_target",
      params: restoreSafetyGate
        ? {
            ...context.params,
            restore_safety_gate: restoreSafetyGate
          }
        : context.params
    });
    if (!result.ok) {
      const payload = asObject(result.payload) ?? {};
      const details = asObject(payload.details);
      const structuredReason =
        typeof details?.reason === "string" && details.reason.trim().length > 0
          ? details.reason.trim()
          : result.error.code;
      const semanticRestoreDenial = semanticRestoreDenialReasons.has(structuredReason);
      throw new CliError(
        semanticRestoreDenial ? "ERR_EXECUTION_FAILED" : "ERR_RUNTIME_UNAVAILABLE",
        result.error.message,
        {
          retryable:
            !semanticRestoreDenial &&
            (result.error.code === "ERR_TRANSPORT_TIMEOUT" ||
              retryableRestoreRuntimeFailureReasons.has(structuredReason)),
          details: {
            ability_id: "runtime.restore_xhs_target",
            stage: "execution",
            reason: structuredReason,
            ...(details ? { target_restore_details: details } : {})
          }
        }
      );
    }
    return {
      ...(asObject(result.payload) ?? {}),
      relay_path: result.relay_path
    };
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
        retryable: error.retryable,
        cause: error,
        details: {
          ability_id: "runtime.restore_xhs_target",
          stage: "execution",
          reason: error.code
        }
      });
    }
    throw error;
  } finally {
    await bridge?.close().catch(() => undefined);
  }
};

const runtimeStart = async (context: RuntimeContext) =>
  profileRuntime.start({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeLogin = async (context: RuntimeContext) =>
  profileRuntime.login({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStatus = async (context: RuntimeContext) =>
  profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeStop = async (context: RuntimeContext) =>
  profileRuntime.stop({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
  });

const runtimeAuditQuery = async (context: RuntimeContext) => {
  const runId = asString(context.params.run_id);
  const sessionId = asString(context.params.session_id);
  const profile = asString(context.params.profile);
  const requestedExecutionMode = asString(context.params.requested_execution_mode);
  const limitRaw = asInteger(context.params.limit);
  const limit = limitRaw === null ? 20 : Math.max(1, Math.min(100, limitRaw));

  if (
    hasOwn(context.params, "requested_execution_mode") &&
    (!requestedExecutionMode || !isAntiDetectionExecutionMode(requestedExecutionMode))
  ) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
      details: {
        ability_id: "runtime.audit",
        stage: "input_validation",
        reason: "AUDIT_QUERY_REQUESTED_EXECUTION_MODE_INVALID"
      }
    });
  }

  if (!runId && !sessionId && !profile) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
      details: {
        ability_id: "runtime.audit",
        stage: "input_validation",
        reason: "AUDIT_QUERY_FILTER_MISSING"
      }
    });
  }

  let store: SQLiteRuntimeStore | null = null;
  try {
    store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
    if (runId) {
      const trail = await store.getGateAuditTrail(runId);
      const enrichedAuditRecords = trail.auditRecords.map((record) =>
        enrichAuditRecordWithWriteTier(record as unknown as Record<string, unknown>)
      );
      const currentRiskState = resolveCurrentRiskState(
        asObject(trail.approvalRecord),
        enrichedAuditRecords
      );
      const auditProfile = asString((enrichedAuditRecords[0] as Record<string, unknown> | undefined)?.profile);
      const latestAuditRecord = enrichedAuditRecords[0] as Record<string, unknown> | undefined;
      const sessionRhythmStatusView = await buildSessionRhythmStatusViewForProfile(
        context.cwd,
        auditProfile,
        {
          store,
          sessionId: asString(latestAuditRecord?.session_id),
          sourceRunId: runId,
          sourceAuditEventId: asString(latestAuditRecord?.event_id),
          effectiveExecutionMode: asString(latestAuditRecord?.effective_execution_mode)
        }
      );
      const antiDetectionValidationView = await buildAntiDetectionValidationViewForProfile({
        store,
        profile: auditProfile,
        effectiveExecutionMode:
          requestedExecutionMode ??
          (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
            ?.requested_execution_mode ??
          (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
            ?.effective_execution_mode
      });
      return {
        query: {
          run_id: runId,
          ...(requestedExecutionMode ? { requested_execution_mode: requestedExecutionMode } : {})
        },
        approval_record: trail.approvalRecord,
        audit_records: enrichedAuditRecords,
        write_interaction_tier: WRITE_INTERACTION_TIER,
        write_action_matrix_decisions:
          (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
            ?.write_action_matrix_decisions ?? null,
        risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
          auditRecords: enrichedAuditRecords
        }),
        session_rhythm_status_view: sessionRhythmStatusView,
        anti_detection_validation_view: antiDetectionValidationView
      };
    }

    const records = await store.listGateAuditRecords({
      sessionId: sessionId ?? undefined,
      profile: profile ?? undefined,
      limit
    });
    const enrichedAuditRecords = records.map((record) =>
      enrichAuditRecordWithWriteTier(record as unknown as Record<string, unknown>)
    );
    const currentRiskState = resolveCurrentRiskState(
      null,
      enrichedAuditRecords
    );
    const auditProfile = asString((enrichedAuditRecords[0] as Record<string, unknown> | undefined)?.profile);
    const latestAuditRecord = enrichedAuditRecords[0] as Record<string, unknown> | undefined;
    const sessionRhythmStatusView = await buildSessionRhythmStatusViewForProfile(
      context.cwd,
      profile ?? auditProfile,
      {
        store,
        sessionId: sessionId ?? asString(latestAuditRecord?.session_id),
        sourceRunId: asString(latestAuditRecord?.run_id),
        sourceAuditEventId: asString(latestAuditRecord?.event_id),
        effectiveExecutionMode: asString(latestAuditRecord?.effective_execution_mode)
      }
    );
    const antiDetectionValidationView = await buildAntiDetectionValidationViewForProfile({
      store,
      profile: profile ?? auditProfile,
      effectiveExecutionMode:
        requestedExecutionMode ??
        (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
          ?.requested_execution_mode ??
        (enrichedAuditRecords[0] as Record<string, unknown> | undefined)
          ?.effective_execution_mode
    });
    return {
      query: {
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(profile ? { profile } : {}),
        ...(requestedExecutionMode ? { requested_execution_mode: requestedExecutionMode } : {}),
        limit
      },
      audit_records: enrichedAuditRecords,
      write_interaction_tier: WRITE_INTERACTION_TIER,
      write_action_matrix_decisions: null,
      risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
        auditRecords: enrichedAuditRecords
      }),
      session_rhythm_status_view: sessionRhythmStatusView,
      anti_detection_validation_view: antiDetectionValidationView
    };
  } catch (error) {
    if (error instanceof RuntimeStoreError) {
      if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
        throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
          details: {
            ability_id: "runtime.audit",
            stage: "input_validation",
            reason: "AUDIT_QUERY_INVALID_INPUT"
          }
        });
      }
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
        retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
        cause: error
      });
    }
    throw error;
  } finally {
    try {
      store?.close();
    } catch {
      // Best-effort close for read-only query path.
    }
  }
};

const runtimeHelp = async () => ({
  usage: "webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]",
  commands: [
    "runtime.help",
    "runtime.install",
    "runtime.uninstall",
    "runtime.ping",
    "runtime.start",
    "runtime.login",
    "runtime.status",
    "runtime.tabs",
    "runtime.restore_xhs_target",
    "runtime.xhs_closeout_validation",
    "runtime.stop",
    "runtime.audit",
    "xhs.search",
    "xhs.detail",
    "xhs.user_home"
  ],
  notes: ["--params 必须是 JSON 对象字符串", "stdout 只输出单个 JSON 对象"]
});

export const runtimeCommands = (): CommandDefinition[] => [
  {
    name: "runtime.help",
    status: "implemented",
    handler: runtimeHelp
  },
  {
    name: "runtime.ping",
    status: "implemented",
    handler: runtimePing
  },
  {
    name: "runtime.start",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStart
  },
  {
    name: "runtime.login",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeLogin
  },
  {
    name: "runtime.status",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStatus
  },
  {
    name: "runtime.tabs",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeTabs
  },
  {
    name: "runtime.restore_xhs_target",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeRestoreXhsTarget
  },
  {
    name: "runtime.xhs_closeout_validation",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeXhsCloseoutValidation
  },
  {
    name: "runtime.stop",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeStop
  },
  {
    name: "runtime.audit",
    status: "implemented",
    handler: runtimeAuditQuery
  }
];
