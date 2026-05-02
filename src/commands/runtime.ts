import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { CommandDefinition, JsonObject, RuntimeContext } from "../core/types.js";
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
  persistXhsCloseoutValidationSourceEvidence,
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

const unwrapMainWorldProbeResult = (value: unknown): Record<string, unknown> | null => {
  const envelope = asObject(value);
  if (!envelope) {
    return null;
  }
  return asObject(envelope.result) ?? envelope;
};

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

const XHS_CLOSEOUT_VALIDATION_SOURCE_APPROVED_REASON =
  "XHS_CLOSEOUT_VALIDATION_SOURCE_APPROVED";

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
    asString(sourceGateAudit.action_ref) !== null &&
    asString(sourceGateAudit.action_ref) === asString(sourceAudit.action_ref) &&
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

const sourcePageUrlMatchesSourceAudit = (pageUrl: string | null, sourceAudit: GateAuditRecord): boolean => {
  if (!pageUrl) {
    return false;
  }
  try {
    const parsed = new URL(pageUrl);
    return (
      parsed.hostname === sourceAudit.target_domain &&
      sourceAudit.target_page === "search_result_tab" &&
      parsed.pathname.replace(/\/+$/u, "").endsWith("/search_result")
    );
  } catch {
    return false;
  }
};

const signalMatchesSourceBinding = (input: {
  signal: Record<string, unknown>;
  sourceAudit: GateAuditRecord;
  sourceActionRef: string;
  sourceRunId: string;
  validationScope: string;
  rhythmView?: SessionRhythmStatusViewRecord | null;
}): boolean => {
  const browserEvidence = asObject(input.signal.browser_returned_evidence);
  const browserBindingMatches =
    browserEvidence?.target_domain === input.sourceAudit.target_domain &&
    asInteger(browserEvidence?.target_tab_id) === input.sourceAudit.target_tab_id &&
    asString(browserEvidence?.probe_bundle_ref) === "probe-bundle/xhs-closeout-min-v1" &&
    sourcePageUrlMatchesSourceAudit(asString(browserEvidence?.page_url), input.sourceAudit);
  if (!browserBindingMatches) {
    return false;
  }
  if (input.validationScope !== "layer2_interaction") {
    if (input.validationScope !== "layer3_session_rhythm") {
      return true;
    }
    const rhythmView = input.rhythmView ?? null;
    return (
      rhythmView !== null &&
      asString(input.signal.session_rhythm_window_id) === asString(rhythmView.window_state.window_id) &&
      asString(input.signal.session_rhythm_decision_id) === asString(rhythmView.decision.decision_id) &&
      asString(rhythmView.decision.run_id) === input.sourceRunId &&
      asString(rhythmView.decision.session_id) === input.sourceAudit.session_id &&
      isEligibleXhsCloseoutValidationSourceRhythmDecision(rhythmView) &&
      input.signal.active_fetch_performed === false &&
      input.signal.closeout_bundle_entered === false
    );
  }
  const rhythmProfile = asObject(input.signal.rhythm_profile);
  const strategySelection = asObject(input.signal.strategy_selection);
  const executionTrace = asObject(input.signal.execution_trace);
  return (
    asString(rhythmProfile?.source_run_id) === input.sourceRunId &&
    asString(strategySelection?.action_kind) === "validation_source_probe" &&
    asString(strategySelection?.selected_path) === "managed_official_chrome_main_world" &&
    asString(executionTrace?.action_kind) === "validation_source_probe" &&
    asString(executionTrace?.action_ref) === input.sourceActionRef &&
    asString(executionTrace?.session_id) === input.sourceAudit.session_id &&
    asInteger(executionTrace?.target_tab_id) === input.sourceAudit.target_tab_id
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
    asString(input.sourceAudit.action_ref) !== null &&
    input.sourceAudit.requested_execution_mode === input.requestedExecutionMode &&
    input.sourceAudit.effective_execution_mode === input.requestedExecutionMode &&
    input.sourceAudit.gate_decision === "allowed" &&
    (input.sourceAudit.gate_reasons.includes("LIVE_MODE_APPROVED") ||
      input.sourceAudit.gate_reasons.includes(XHS_CLOSEOUT_VALIDATION_SOURCE_APPROVED_REASON))
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
    const sourceGateAuditPayload = sample ? sampleSourceGateAudit(sample) : null;
    const sourceActionRef = asString(sourceGateAuditPayload?.action_ref);
    const sourceRhythmView =
      validationScope === "layer3_session_rhythm"
        ? await input.store.getSessionRhythmStatusView({
            profile: input.profile ?? "",
            platform: "xhs",
            issueScope: "issue_209",
            sessionId: input.sourceAudit.session_id,
            runId: input.sourceRunId
          })
        : null;
    const sourceBindingMatched = signal
      ? signalMatchesSourceBinding({
          signal,
          sourceAudit: input.sourceAudit,
          sourceActionRef: sourceActionRef ?? "",
          sourceRunId: input.sourceRunId,
          validationScope,
          rhythmView: sourceRhythmView
        })
      : false;
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
      !sampleMatchesSourceGateAudit(sample, input.sourceAudit) ||
      !sourceBindingMatched
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
              : false,
            sample_source_binding_matched: sourceBindingMatched
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
        gateAudit.target_tab_id === sampleGateAudit.target_tab_id &&
        gateAudit.action_ref === sampleGateAudit.action_ref
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

const assertXhsCloseoutValidationSourceUrl = (input: {
  href: string | null;
  expectedDomain: string;
}): void => {
  if (!input.href) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source page URL is missing",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_PAGE_URL_MISSING"
        }
      }
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(input.href);
  } catch {
    throw new CliError("ERR_EXECUTION_FAILED", "XHS closeout validation source page URL invalid", {
      retryable: false,
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "execution",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_PAGE_URL_INVALID",
        page_url: input.href
      }
    });
  }
  if (
    parsed.hostname !== input.expectedDomain ||
    !parsed.pathname.replace(/\/+$/u, "").endsWith("/search_result")
  ) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source must be collected from search_result",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_PAGE_MISMATCH",
          page_url: input.href,
          expected_domain: input.expectedDomain,
          expected_page: "search_result_tab"
        }
      }
    );
  }
};

const assertXhsCloseoutValidationSourceOfficialRuntime = (input: {
  profile: string;
  profileMeta: Awaited<ReturnType<ProfileStore["readMeta"]>>;
}): void => {
  const binding = input.profileMeta?.persistentExtensionBinding ?? null;
  const browserChannel = asString(binding?.browserChannel);
  if (
    input.profileMeta?.profileState !== "ready" ||
    !binding ||
    browserChannel !== "chrome"
  ) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source requires managed official Chrome runtime",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RUNTIME_SURFACE_BLOCKED",
          profile: input.profile,
          profile_state: input.profileMeta?.profileState ?? null,
          browser_channel: browserChannel,
          persistent_extension_bound: !!binding
        }
      }
    );
  }
};

const assertXhsCloseoutValidationSourceOfficialBridge = (input: {
  proof: ReturnType<NativeMessagingBridge["currentTransportProof"]>;
}): void => {
  if (input.proof.surface === "profile_socket" || input.proof.surface === "root_socket") {
    return;
  }
  throw new CliError(
    "ERR_EXECUTION_FAILED",
    "XHS closeout validation source requires official Chrome bridge transport",
    {
      retryable: false,
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "execution",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_STUB_BRIDGE_BLOCKED",
        bridge_transport_surface: input.proof.surface,
        bridge_socket_path: input.proof.socket_path ?? null,
        bridge_spawned_host_configured: input.proof.spawned_host_configured ?? null
      }
    }
  );
};

const assertXhsCloseoutValidationSourceBrowserAttestation = (input: {
  bootstrapPayload: Record<string, unknown> | null;
  probePayload: Record<string, unknown>;
  runId: string;
  sessionId: string;
  profile: string;
  targetDomain: string;
  targetPage: string;
  targetTabId: number;
  actionRef: string;
}): void => {
  const browserAttestation = asObject(input.probePayload.browser_attestation);
  const requestEvent = asString(input.probePayload.request_event);
  const resultEvent = asString(input.probePayload.result_event);
  const attested =
    input.bootstrapPayload?.runtime_bootstrap_attested === true &&
    browserAttestation?.source === "chrome_scripting_main_world" &&
    browserAttestation.execution_surface === "real_browser" &&
    browserAttestation.extension_surface === "background_service_worker" &&
    browserAttestation.run_id === input.runId &&
    browserAttestation.session_id === input.sessionId &&
    browserAttestation.profile === input.profile &&
    browserAttestation.target_domain === input.targetDomain &&
    browserAttestation.target_page === input.targetPage &&
    browserAttestation.target_tab_id === input.targetTabId &&
    browserAttestation.action_ref === input.actionRef &&
    browserAttestation.request_event === requestEvent &&
    browserAttestation.result_event === resultEvent &&
    requestEvent !== null &&
    resultEvent !== null;
  if (attested) {
    return;
  }
  throw new CliError(
    "ERR_EXECUTION_FAILED",
    "XHS closeout validation source requires browser attestation",
    {
      retryable: false,
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "execution",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_BROWSER_ATTESTATION_MISSING",
        bootstrap_attested: input.bootstrapPayload?.runtime_bootstrap_attested ?? null,
        attestation_source: asString(browserAttestation?.source),
        attestation_execution_surface: asString(browserAttestation?.execution_surface),
        attestation_extension_surface: asString(browserAttestation?.extension_surface),
        attestation_run_id: asString(browserAttestation?.run_id),
        attestation_session_id: asString(browserAttestation?.session_id),
        attestation_profile: asString(browserAttestation?.profile),
        attestation_target_domain: asString(browserAttestation?.target_domain),
        attestation_target_page: asString(browserAttestation?.target_page),
        attestation_target_tab_id: asInteger(browserAttestation?.target_tab_id),
        attestation_action_ref: asString(browserAttestation?.action_ref)
      }
    }
  );
};

const buildXhsCloseoutValidationSourceSignals = (input: {
  fingerprintRuntime: Record<string, unknown>;
  injection: Record<string, unknown>;
  targetDomain: string;
  targetTabId: number;
  pageUrl: string | null;
  sessionRhythmWindowId: string;
  sessionRhythmDecisionId: string;
  runId: string;
  sessionId: string;
  actionRef: string;
}): XhsCloseoutValidationSignalMap => ({
  layer1_consistency: {
    browser_returned_evidence: {
      source: "main_world",
      target_domain: input.targetDomain,
      target_tab_id: input.targetTabId,
      page_url: input.pageUrl,
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    fingerprint_runtime: {
      ...input.fingerprintRuntime,
      injection: {
        ...input.injection,
        source: "main_world"
      }
    }
  },
  layer2_interaction: {
    browser_returned_evidence: {
      source: "main_world",
      target_domain: input.targetDomain,
      target_tab_id: input.targetTabId,
      page_url: input.pageUrl,
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    event_strategy_profile: {
      action_kind: "validation_source_probe",
      preferred_path: "managed_official_chrome_main_world"
    },
    event_chain_policy: {
      chain_name: "xhs_closeout_validation_source",
      required_events: ["main_world_probe", "fingerprint_install"]
    },
    rhythm_profile: {
      profile_name: "xhs_closeout_min_v1",
      min_action_interval_ms: 3000,
      source_run_id: input.runId
    },
    strategy_selection: {
      action_kind: "validation_source_probe",
      selected_path: "managed_official_chrome_main_world",
      active_fetch_performed: false,
      closeout_bundle_entered: false
    },
    execution_trace: {
      action_kind: "validation_source_probe",
      selected_path: "managed_official_chrome_main_world",
      settled_wait_result: "main_world_probe_returned",
      session_id: input.sessionId,
      target_tab_id: input.targetTabId,
      action_ref: input.actionRef
    }
  },
  layer3_session_rhythm: {
    browser_returned_evidence: {
      source: "execution_audit",
      target_domain: input.targetDomain,
      target_tab_id: input.targetTabId,
      page_url: input.pageUrl,
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    session_rhythm_window_id: input.sessionRhythmWindowId,
    session_rhythm_decision_id: input.sessionRhythmDecisionId,
    escalation: "validation_source_to_closeout_baseline",
    active_fetch_performed: false,
    closeout_bundle_entered: false
  }
});

type XhsCloseoutValidationSourceRhythmAdmissionClass =
  | "allowed"
  | "baseline_required_recovery";

const XHS_CLOSEOUT_VALIDATION_SOURCE_RECOVERY_REASONS = [
  "XHS_RECOVERY_SINGLE_PROBE_PASSED",
  "ANTI_DETECTION_BASELINE_REQUIRED"
] as const;

const XHS_CLOSEOUT_VALIDATION_SOURCE_BASELINE_REQUIRES = new Set([
  "session_rhythm_window_not_ready",
  "anti_detection_baseline_required",
  "anti_detection_validation_baseline_required",
  "validation_baseline_required"
]);

const isXhsCloseoutValidationSourceRecoverableRiskState = (state: string | null): boolean =>
  state === "limited" || state === "allowed";

const isLiveAdmissionAllowedXhsCloseoutValidationSourceRhythm = (input: {
  decision: string | null;
  currentRiskState: string | null;
  nextRiskState: string | null;
  windowRiskState: string | null;
  effectiveExecutionMode: string | null;
  reasonCodes: string[];
  requires: string[];
}): boolean =>
  input.decision === "allowed" &&
  (input.effectiveExecutionMode === "live_read_high_risk" ||
    input.effectiveExecutionMode === "recon") &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.currentRiskState) &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.nextRiskState) &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.windowRiskState) &&
  input.reasonCodes.includes("XHS_CLOSEOUT_LIVE_ADMISSION_ALLOWED") &&
  input.requires.length === 0;

const isEligibleXhsCloseoutValidationSourceRhythmDecision = (
  rhythmView: SessionRhythmStatusViewRecord
): boolean => {
  const decision = asString(rhythmView.decision.decision);
  const currentRiskState = asString(rhythmView.decision.current_risk_state);
  const nextRiskState = asString(rhythmView.decision.next_risk_state);
  const windowRiskState = asString(rhythmView.window_state.risk_state);
  const reasonCodes = asStringArray(rhythmView.decision.reason_codes);
  const requires = asStringArray(rhythmView.decision.requires);
  if (
    decision === "allowed" &&
    currentRiskState === "allowed" &&
    nextRiskState === "allowed" &&
    windowRiskState === "allowed"
  ) {
    return true;
  }
  if (
    isLiveAdmissionAllowedXhsCloseoutValidationSourceRhythm({
      decision,
      currentRiskState,
      nextRiskState,
      windowRiskState,
      effectiveExecutionMode: asString(rhythmView.decision.effective_execution_mode),
      reasonCodes,
      requires
    })
  ) {
    return true;
  }
  return isBaselineRequiredXhsCloseoutValidationSourceRhythm({
    decision,
    currentRiskState,
    nextRiskState,
    windowRiskState,
    reasonCodes,
    requires
  });
};

const isBaselineRequiredXhsCloseoutValidationSourceRhythm = (input: {
  decision: string | null;
  currentRiskState: string | null;
  nextRiskState: string | null;
  windowRiskState: string | null;
  reasonCodes: string[];
  requires: string[];
}): boolean =>
  input.decision === "deferred" &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.currentRiskState) &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.nextRiskState) &&
  isXhsCloseoutValidationSourceRecoverableRiskState(input.windowRiskState) &&
  XHS_CLOSEOUT_VALIDATION_SOURCE_RECOVERY_REASONS.every((reason) =>
    input.reasonCodes.includes(reason)
  ) &&
  input.requires.length > 0 &&
  input.requires.every((requirement) =>
    XHS_CLOSEOUT_VALIDATION_SOURCE_BASELINE_REQUIRES.has(requirement)
  );

const assertEligibleXhsCloseoutValidationSourceRhythm = (input: {
  rhythmView: SessionRhythmStatusViewRecord;
  profile: string;
  sessionId?: string | null;
  runId: string;
}): {
  sessionId: string;
  sessionRhythmWindowId: string;
  sessionRhythmDecisionId: string;
  rhythmAdmissionClass: XhsCloseoutValidationSourceRhythmAdmissionClass;
  rhythmAuditRiskState: string;
  rhythmAuditNextState: string;
} => {
  const sessionRhythmWindowId = asString(input.rhythmView.window_state.window_id);
  const sessionRhythmDecisionId = asString(input.rhythmView.decision.decision_id);
  const decisionRunId = asString(input.rhythmView.decision.run_id);
  const decisionSessionId = asString(input.rhythmView.decision.session_id);
  const decision = asString(input.rhythmView.decision.decision);
  const currentRiskState = asString(input.rhythmView.decision.current_risk_state);
  const nextRiskState = asString(input.rhythmView.decision.next_risk_state);
  const windowRiskState = asString(input.rhythmView.window_state.risk_state);
  const reasonCodes = asStringArray(input.rhythmView.decision.reason_codes);
  const requires = asStringArray(input.rhythmView.decision.requires);
  const liveAdmissionAllowedRhythm = isLiveAdmissionAllowedXhsCloseoutValidationSourceRhythm({
    decision,
    currentRiskState,
    nextRiskState,
    windowRiskState,
    effectiveExecutionMode: asString(input.rhythmView.decision.effective_execution_mode),
    reasonCodes,
    requires
  });
  if (!sessionRhythmWindowId || !sessionRhythmDecisionId || !decisionSessionId) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source rhythm evidence is missing",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RHYTHM_EVIDENCE_MISSING"
        }
      }
    );
  }
  const runAndSessionBound =
    decisionRunId === input.runId &&
    (input.sessionId === null ||
      input.sessionId === undefined ||
      decisionSessionId === input.sessionId);
  const allowedRhythm =
    decision === "allowed" &&
    currentRiskState === "allowed" &&
    nextRiskState === "allowed" &&
    windowRiskState === "allowed";
  if (
    !runAndSessionBound ||
    !isEligibleXhsCloseoutValidationSourceRhythmDecision(input.rhythmView)
  ) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source rhythm evidence is not allowed",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RHYTHM_BLOCKED",
          profile: input.profile,
          expected_run_id: input.runId,
          rhythm_decision_run_id: decisionRunId,
          expected_session_id: input.sessionId ?? null,
          rhythm_decision_session_id: decisionSessionId,
          rhythm_decision: decision,
          rhythm_current_risk_state: currentRiskState,
          rhythm_next_risk_state: nextRiskState,
          rhythm_window_risk_state: windowRiskState,
          rhythm_reason_codes: reasonCodes,
          rhythm_requires: requires
        }
      }
    );
  }
  return {
    sessionId: decisionSessionId,
    sessionRhythmWindowId,
    sessionRhythmDecisionId,
    rhythmAdmissionClass: allowedRhythm || liveAdmissionAllowedRhythm ? "allowed" : "baseline_required_recovery",
    rhythmAuditRiskState: currentRiskState ?? "limited",
    rhythmAuditNextState: nextRiskState ?? currentRiskState ?? "limited"
  };
};

const resolveXhsCloseoutValidationSourceRhythm = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  sessionId?: string | null;
  runId: string;
}): Promise<{
  sessionId: string;
  sessionRhythmWindowId: string;
  sessionRhythmDecisionId: string;
  rhythmAdmissionClass: XhsCloseoutValidationSourceRhythmAdmissionClass;
  rhythmAuditRiskState: string;
  rhythmAuditNextState: string;
}> => {
  const persisted = await input.store.getSessionRhythmStatusView({
    profile: input.profile,
    platform: "xhs",
    issueScope: "issue_209",
    sessionId: input.sessionId,
    runId: input.runId
  });
  if (persisted && asString(persisted.decision.run_id) === input.runId) {
    return assertEligibleXhsCloseoutValidationSourceRhythm({
      rhythmView: persisted,
      profile: input.profile,
      sessionId: input.sessionId,
      runId: input.runId
    });
  }
  throw new CliError(
    "ERR_EXECUTION_FAILED",
    "XHS closeout validation source rhythm evidence is missing for the current run",
    {
      retryable: false,
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "execution",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RHYTHM_EVIDENCE_MISSING",
        profile: input.profile,
        expected_run_id: input.runId,
        expected_session_id: input.sessionId ?? null
      }
    }
  );
};

const runtimeXhsCloseoutValidationSource = async (context: RuntimeContext) => {
  const targetDomain = asString(context.params.target_domain);
  const requestedExecutionMode = asString(context.params.requested_execution_mode);
  const targetTabId = asInteger(context.params.target_tab_id);
  const targetPage = asString(context.params.target_page);
  const actionRef =
    asString(context.params.action_ref) ??
    asString(context.params.gate_invocation_id) ??
    context.run_id;
  const observedAt = new Date().toISOString();

  if (targetDomain !== "www.xiaohongshu.com") {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation source target_domain invalid", {
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_TARGET_DOMAIN_INVALID"
      }
    });
  }
  if (requestedExecutionMode !== "live_read_high_risk") {
    throw new CliError(
      "ERR_CLI_INVALID_ARGS",
      "XHS closeout validation source requires live_read_high_risk mode",
      {
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "input_validation",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_MODE_INVALID"
        }
      }
    );
  }
  if (!targetTabId || targetPage !== "search_result_tab") {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation source target invalid", {
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_TARGET_INVALID",
        target_tab_id: targetTabId,
        target_page: targetPage
      }
    });
  }
  if (!context.profile) {
    throw new CliError("ERR_CLI_INVALID_ARGS", "XHS closeout validation source profile required", {
      details: {
        ability_id: "runtime.xhs_closeout_validation_source",
        stage: "input_validation",
        reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_PROFILE_REQUIRED"
      }
    });
  }
  if (hasOwn(context.params, "signals") || hasOwn(context.params, "artifact_refs")) {
    throw new CliError(
      "ERR_CLI_INVALID_ARGS",
      "XHS closeout validation source inline evidence forbidden",
      {
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "input_validation",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_INLINE_EVIDENCE_FORBIDDEN"
        }
      }
    );
  }

  const profile = context.profile;
  const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
  const profileMeta = await profileStore.readMeta(profile, { mode: "readonly" });
  assertXhsCloseoutValidationSourceOfficialRuntime({ profile, profileMeta });
  const accountSafetyState = asString(profileMeta?.accountSafety?.state);
  if (accountSafetyState !== "clear") {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source blocked by account-safety state",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_ACCOUNT_SAFETY_BLOCKED",
          account_safety_state: accountSafetyState
        }
      }
    );
  }

  const fingerprintContext = buildFingerprintContextForMeta(profile, profileMeta, {
    requestedExecutionMode
  });
  if (!fingerprintContext.execution.live_allowed) {
    throw new CliError(
      "ERR_EXECUTION_FAILED",
      "XHS closeout validation source fingerprint gate blocked live_read_high_risk",
      {
        retryable: false,
        details: {
          ability_id: "runtime.xhs_closeout_validation_source",
          stage: "execution",
          reason:
            fingerprintContext.execution.reason_codes[0] ??
            "XHS_CLOSEOUT_VALIDATION_SOURCE_FINGERPRINT_BLOCKED"
        }
      }
    );
  }

  let bridge: NativeMessagingBridge | null = null;
  let store: SQLiteRuntimeStore | null = null;
  try {
    const runtimeStore = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
    store = runtimeStore;
    const {
      sessionId: rhythmSessionId,
      sessionRhythmWindowId,
      sessionRhythmDecisionId,
      rhythmAdmissionClass,
      rhythmAuditRiskState,
      rhythmAuditNextState
    } = await resolveXhsCloseoutValidationSourceRhythm({
      store: runtimeStore,
      profile,
      sessionId: null,
      runId: context.run_id
    });

    bridge = resolveRuntimeBridge();
    const sessionId = await bridge.ensureSession({ profile });
    assertXhsCloseoutValidationSourceOfficialBridge({
      proof: bridge.currentTransportProof()
    });
    if (sessionId !== rhythmSessionId) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source rhythm evidence is not bound to the active session",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_RHYTHM_SESSION_MISMATCH",
            expected_session_id: rhythmSessionId,
            actual_session_id: sessionId,
            expected_run_id: context.run_id
          }
        }
      );
    }
    const bootstrapResult = await bridge.runCommand({
      runId: context.run_id,
      profile,
      cwd: context.cwd,
      command: "runtime.bootstrap",
      params: {
        version: "v1",
        run_id: context.run_id,
        runtime_context_id: buildRuntimeBootstrapContextId(profile, context.run_id),
        profile,
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        target_page: targetPage,
        fingerprint_runtime: fingerprintContext as unknown as JsonObject,
        fingerprint_patch_manifest: asObject(fingerprintContext.fingerprint_patch_manifest) ?? {},
        main_world_secret: `xhs-closeout-validation-source-bootstrap-${randomUUID()}`
      }
    });
    if (!bootstrapResult.ok) {
      const bootstrapDetails = asObject(bootstrapResult.payload?.details);
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source runtime bootstrap failed",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason:
              asString(bootstrapDetails?.reason) ??
              bootstrapResult.error.code,
            bootstrap_error_code: bootstrapResult.error.code,
            bootstrap_error_message: bootstrapResult.error.message
          }
        }
      );
    }
    const bootstrapPayload = asObject(bootstrapResult.payload);
    const bootstrapAck = asObject(bootstrapPayload?.result);
    const bootstrapStatus = asString(bootstrapAck?.status);
    if (
      bootstrapStatus !== "ready" ||
      asString(bootstrapAck?.run_id) !== context.run_id ||
      asString(bootstrapAck?.runtime_context_id) !==
        buildRuntimeBootstrapContextId(profile, context.run_id) ||
      asString(bootstrapAck?.profile) !== profile
    ) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source runtime bootstrap ack invalid",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason:
              bootstrapStatus === "stale"
                ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
                : "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
            bootstrap_ack_status: bootstrapStatus,
            bootstrap_ack_run_id: asString(bootstrapAck?.run_id),
            bootstrap_ack_profile: asString(bootstrapAck?.profile)
          }
        }
      );
    }
    const probeResult = await bridge.runCommand({
      runId: context.run_id,
      profile,
      cwd: context.cwd,
      command: "runtime.main_world_probe",
      params: {
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        target_page: targetPage,
        action_ref: actionRef,
        managed_tab_binding_gate: {
          source: "cli_persisted_runtime_gate",
          purpose: "xhs_closeout_validation_source",
          profile_ref: profile,
          run_id: context.run_id,
          session_id: sessionId,
          target_domain: targetDomain,
          target_page: targetPage,
          target_tab_id: targetTabId,
          action_ref: actionRef,
          checked_at: observedAt,
          active_fetch_performed: false,
          closeout_bundle_entered: false,
          rhythm_admission_class: rhythmAdmissionClass
        },
        main_world_secret: `xhs-closeout-validation-source-${randomUUID()}`,
        fingerprint_runtime: fingerprintContext as unknown as JsonObject
      }
    });
    if (!probeResult.ok) {
      const probeDetails = asObject(probeResult.payload?.details);
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source main-world probe failed",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason:
              asString(probeDetails?.reason) ??
              "XHS_CLOSEOUT_VALIDATION_SOURCE_MAIN_WORLD_PROBE_FAILED",
            probe_error_code: probeResult.error.code,
            probe_error_message: probeResult.error.message
          }
        }
      );
    }

    assertXhsCloseoutValidationSourceBrowserAttestation({
      bootstrapPayload,
      probePayload: probeResult.payload,
      runId: context.run_id,
      sessionId,
      profile,
      targetDomain,
      targetPage,
      targetTabId,
      actionRef
    });

    const probeTargetTabId = asInteger(probeResult.payload.target_tab_id);
    if (probeTargetTabId !== targetTabId) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source probe target tab mismatch",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_TARGET_TAB_MISMATCH",
            expected_target_tab_id: targetTabId,
            probe_target_tab_id: probeTargetTabId
          }
        }
      );
    }

    const probe = asObject(probeResult.payload.probe);
    const pageUrl = asString(probe?.href);
    assertXhsCloseoutValidationSourceUrl({ href: pageUrl, expectedDomain: targetDomain });
    if (probe?.probe_response_received !== true) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source main-world probe did not return evidence",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_MAIN_WORLD_EVIDENCE_MISSING",
            probe_error: asString(probe?.error)
          }
        }
      );
    }
    const probeResultEnvelope = asObject(probe?.probe_result);
    const injection = unwrapMainWorldProbeResult(probe?.probe_result);
    if (
      !injection ||
      injection.installed !== true ||
      asString(injection.source) !== "main_world" ||
      asStringArray(injection.missing_required_patches).length > 0
    ) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source fingerprint evidence is not ready",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_FINGERPRINT_NOT_READY",
            probe_result_ok: asBoolean(probeResultEnvelope?.ok),
            probe_source: asString(injection?.source),
            missing_required_patches: asStringArray(injection?.missing_required_patches)
          }
        }
      );
    }

    const decisionId = `gate_decision_${context.run_id}_xhs_closeout_validation_source`;
    const approvalId = `gate_appr_${context.run_id}_xhs_closeout_validation_source`;
    const signals = buildXhsCloseoutValidationSourceSignals({
      fingerprintRuntime: fingerprintContext as unknown as Record<string, unknown>,
      injection,
      targetDomain,
      targetTabId,
      pageUrl,
      sessionRhythmWindowId,
      sessionRhythmDecisionId,
      runId: context.run_id,
      sessionId,
      actionRef
    });
    const sourceAuditRef: { current?: GateAuditRecord } = {};
    let sourceSampleRefs: string[] = [];
    await runtimeStore.runInTransaction(async () => {
      await runtimeStore.upsertGateApproval({
        approvalId,
        runId: context.run_id,
        decisionId,
        approved: true,
        approver: "runtime.xhs_closeout_validation_source",
        approvedAt: observedAt,
        checks: {
          target_domain_confirmed: true,
          target_tab_confirmed: true,
          target_page_confirmed: true,
          risk_state_checked: true,
          action_type_confirmed: true
        }
      });
      sourceAuditRef.current = await runtimeStore.appendGateAuditRecord({
        eventId: `gate_evt_${context.run_id}_xhs_closeout_validation_source`,
        decisionId,
        approvalId,
        runId: context.run_id,
        sessionId,
        profile,
        issueScope: "issue_209",
        riskState: rhythmAuditRiskState,
        nextState: rhythmAuditNextState,
        transitionTrigger: "gate_evaluation",
        targetDomain,
        targetTabId,
        targetPage,
        actionType: "read",
        actionRef,
        requestedExecutionMode,
        effectiveExecutionMode: requestedExecutionMode,
        gateDecision: "allowed",
        gateReasons:
          rhythmAdmissionClass === "baseline_required_recovery"
            ? [
                XHS_CLOSEOUT_VALIDATION_SOURCE_APPROVED_REASON,
                "XHS_CLOSEOUT_VALIDATION_SOURCE_BASELINE_REQUIRED_RECOVERY"
              ]
            : [XHS_CLOSEOUT_VALIDATION_SOURCE_APPROVED_REASON],
        approver: "runtime.xhs_closeout_validation_source",
        approvedAt: observedAt,
        recordedAt: observedAt
      });
      const samples = await persistXhsCloseoutValidationSourceEvidence({
        store: runtimeStore,
        profile,
        effectiveExecutionMode: requestedExecutionMode,
        targetDomain,
        sourceRunId: context.run_id,
        observedAt,
        sourceAudit: sourceAuditRef.current,
        actionRef,
        signals,
        artifactRefs: [`artifact/xhs-closeout-validation-source/${context.run_id}`],
        useExistingTransaction: true
      });
      sourceSampleRefs = samples.map((sample) => sample.sample_ref);
    });
    const sourceAudit = sourceAuditRef.current;
    if (!sourceAudit) {
      throw new CliError(
        "ERR_EXECUTION_FAILED",
        "XHS closeout validation source audit was not persisted",
        {
          retryable: false,
          details: {
            ability_id: "runtime.xhs_closeout_validation_source",
            stage: "execution",
            reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_AUDIT_MISSING"
          }
        }
      );
    }

    return {
      validation_source_generation: {
        source: "runtime.xhs_closeout_validation_source",
        profile,
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        page_url: pageUrl,
        target_page: targetPage,
        requested_execution_mode: requestedExecutionMode,
        run_id: context.run_id,
        action_ref: actionRef,
        source_audit_event_id: sourceAudit.event_id,
        source_session_id: sessionId,
        source_sample_refs: sourceSampleRefs,
        active_fetch_performed: false,
        closeout_bundle_entered: false
      }
    };
  } catch (error) {
    if (error instanceof RuntimeStoreError) {
      if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
        throw new CliError(
          "ERR_EXECUTION_FAILED",
          "XHS closeout validation source evidence invalid",
          {
            retryable: false,
            details: {
              ability_id: "runtime.xhs_closeout_validation_source",
              stage: "execution",
              reason: "XHS_CLOSEOUT_VALIDATION_SOURCE_PERSISTED_EVIDENCE_INVALID",
              validation_error: error.message
            }
          }
        );
      }
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
        retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
        cause: error
      });
    }
    if (error instanceof NativeMessagingTransportError) {
      throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
        retryable: error.retryable,
        cause: error
      });
    }
    throw error;
  } finally {
    try {
      store?.close();
    } catch {
      // Best-effort close after validation source generation.
    }
    await bridge?.close().catch(() => undefined);
  }
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
  const runtimeTakeover = asObject(status.runtimeTakeoverEvidence);
  const managedRuntimeTargetTabId = asInteger(
    runtimeTakeover?.managedTargetTabId ?? runtimeTakeover?.managed_target_tab_id
  );
  const managedRuntimeTargetDomain = asString(
    runtimeTakeover?.managedTargetDomain ?? runtimeTakeover?.managed_target_domain
  );
  const runtimeTargetTabContinuity = asString(
    runtimeTakeover?.targetTabContinuity ?? runtimeTakeover?.target_tab_continuity
  );
  const currentRuntimeContinuity =
    runtimeTakeover?.observedRunId === context.run_id &&
    runtimeTakeover.controllerBrowserContinuity === true &&
    runtimeTakeover.ownerConflictFree === true &&
    runtimeTakeover.identityBound === true &&
    runtimeTakeover.runtimeContextId === runtimeContextId;
  const staleBootstrapTargetContinuity =
    managedRuntimeTargetTabId === context.params.target_tab_id &&
    managedRuntimeTargetDomain === context.params.target_domain &&
    runtimeTargetTabContinuity === "runtime_trust_state";
  const staleBootstrapSameRuntimeReady =
    status.lockHeld === true &&
    currentRuntimeContinuity &&
    staleBootstrapTargetContinuity &&
    status.identityBindingState === "bound" &&
    status.transportState === "ready" &&
    status.bootstrapState === "stale" &&
    (status.runtimeReadiness === "blocked" || status.runtimeReadiness === "recoverable") &&
    status.executionSurface === "real_browser" &&
    status.headless === false;
  const validationReady = antiDetectionValidationView?.all_required_ready === true;
  const runtimeReadyForRestore =
    officialRuntimeReady || attachedRuntimeReady || staleBootstrapSameRuntimeReady;
  const validationAllowsRestore = staleBootstrapSameRuntimeReady
    ? validationReady
    : recoveryProbeWindow || validationReady;
  if (
    accountSafetyClear &&
    rhythmAllowsRestore &&
    runtimeReadyForRestore &&
    validationAllowsRestore
  ) {
    const restoreRuntimeAttachState = attachedRuntimeReady
      ? "attached_existing_runtime"
      : staleBootstrapSameRuntimeReady
        ? "stale_bootstrap_same_runtime"
        : "not_required";
    return {
      source: "cli_persisted_runtime_gate",
      profile_ref: context.profile,
      run_id: context.run_id,
      checked_at: new Date().toISOString(),
      target_domain: context.params.target_domain,
      target_page: context.params.target_page,
      target_tab_id: context.params.target_tab_id,
      target_url: targetUrl,
      managed_target_tab_id:
        restoreRuntimeAttachState === "stale_bootstrap_same_runtime"
          ? managedRuntimeTargetTabId
          : context.params.target_tab_id,
      target_tab_continuity:
        restoreRuntimeAttachState === "stale_bootstrap_same_runtime"
          ? "stale_bootstrap_current_managed_tab"
          : "runtime_trust_state",
      runtime_context_id: runtimeContextId,
      action_ref: actionRef,
      restore_runtime_attach_state: restoreRuntimeAttachState,
      account_safety_state: accountSafety?.state ?? null,
      xhs_closeout_rhythm_state: rhythmState,
      recovery_probe_window: recoveryProbeWindow,
      stale_bootstrap_recovery: restoreRuntimeAttachState === "stale_bootstrap_same_runtime",
      official_runtime_ready: runtimeReadyForRestore,
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
          : !runtimeReadyForRestore
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
    "runtime.xhs_closeout_validation_source",
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
    name: "runtime.xhs_closeout_validation_source",
    status: "implemented",
    requiresProfile: true,
    handler: runtimeXhsCloseoutValidationSource
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
