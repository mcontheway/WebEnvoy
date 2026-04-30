import type { JsonObject } from "../core/types.js";
import {
  type AntiDetectionExecutionMode,
  type AntiDetectionStructuredSampleRecord,
  type AntiDetectionValidationScope,
  type AntiDetectionValidationScopeKeyInput,
  type AntiDetectionValidationViewRecord,
  type GateAuditRecord,
  RuntimeStoreError,
  SQLiteRuntimeStore
} from "./store/sqlite-runtime-store.js";

export const XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL = "Google Chrome stable" as const;
export const XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE = "real_browser" as const;
export const XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF = "probe-bundle/xhs-closeout-min-v1" as const;
export const XHS_CLOSEOUT_TARGET_DOMAIN = "www.xiaohongshu.com" as const;

export const XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES = [
  {
    targetFrRef: "FR-0012",
    validationScope: "layer1_consistency"
  },
  {
    targetFrRef: "FR-0013",
    validationScope: "layer2_interaction"
  },
  {
    targetFrRef: "FR-0014",
    validationScope: "layer3_session_rhythm"
  }
] as const satisfies ReadonlyArray<{
  targetFrRef: string;
  validationScope: AntiDetectionValidationScope;
}>;

export type XhsCloseoutValidationSignalMap = {
  layer1_consistency: JsonObject;
  layer2_interaction: JsonObject;
  layer3_session_rhythm: JsonObject;
};

export interface XhsCloseoutValidationGateView {
  profile_ref: string;
  browser_channel: typeof XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL;
  execution_surface: typeof XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE;
  effective_execution_mode: AntiDetectionExecutionMode;
  probe_bundle_ref: typeof XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF;
  required_target_fr_refs: string[];
  views: Array<AntiDetectionValidationViewRecord | null>;
  all_required_ready: boolean;
  missing_target_fr_refs: string[];
  blocking_target_fr_refs: string[];
}

const toViewJson = (view: AntiDetectionValidationViewRecord | null): JsonObject | null =>
  view ? ({ ...view } as unknown as JsonObject) : null;

export const toXhsCloseoutValidationGateJson = (
  gate: XhsCloseoutValidationGateView
): JsonObject => ({
  profile_ref: gate.profile_ref,
  browser_channel: gate.browser_channel,
  execution_surface: gate.execution_surface,
  effective_execution_mode: gate.effective_execution_mode,
  probe_bundle_ref: gate.probe_bundle_ref,
  required_target_fr_refs: gate.required_target_fr_refs,
  views: gate.views.map(toViewJson),
  all_required_ready: gate.all_required_ready,
  missing_target_fr_refs: gate.missing_target_fr_refs,
  blocking_target_fr_refs: gate.blocking_target_fr_refs
});

export const buildXhsCloseoutValidationScope = (input: {
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
  targetFrRef: string;
  validationScope: AntiDetectionValidationScope;
}): AntiDetectionValidationScopeKeyInput => ({
  targetFrRef: input.targetFrRef,
  validationScope: input.validationScope,
  profileRef: `profile/${input.profile}`,
  browserChannel: XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL,
  executionSurface: XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE,
  effectiveExecutionMode: input.effectiveExecutionMode,
  probeBundleRef: XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF
});

export const readXhsCloseoutValidationGateView = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
}): Promise<XhsCloseoutValidationGateView> => {
  const views = await Promise.all(
    XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES.map((scope) =>
      input.store.getAntiDetectionValidationView(
        buildXhsCloseoutValidationScope({
          profile: input.profile,
          effectiveExecutionMode: input.effectiveExecutionMode,
          targetFrRef: scope.targetFrRef,
          validationScope: scope.validationScope
        })
      )
    )
  );
  const requiredTargetFrRefs = XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES.map(
    (scope) => scope.targetFrRef
  );
  const missingTargetFrRefs = requiredTargetFrRefs.filter((_, index) => views[index] === null);
  const blockingTargetFrRefs = requiredTargetFrRefs.filter((_, index) => {
    const view = views[index];
    if (!view) {
      return true;
    }
    return !(
      view.baseline_status === "ready" &&
      view.current_result_state === "verified" &&
      view.current_drift_state === "no_drift"
    );
  });

  return {
    profile_ref: `profile/${input.profile}`,
    browser_channel: XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL,
    execution_surface: XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE,
    effective_execution_mode: input.effectiveExecutionMode,
    probe_bundle_ref: XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF,
    required_target_fr_refs: requiredTargetFrRefs,
    views,
    all_required_ready: blockingTargetFrRefs.length === 0,
    missing_target_fr_refs: missingTargetFrRefs,
    blocking_target_fr_refs: blockingTargetFrRefs
  };
};

const safeRefPart = (value: string): string => value.replace(/[^A-Za-z0-9._-]+/gu, "_");

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const validationScopeSignal = (
  signals: XhsCloseoutValidationSignalMap,
  validationScope: AntiDetectionValidationScope
): JsonObject | null => {
  if (validationScope === "layer1_consistency") {
    return signals.layer1_consistency;
  }
  if (validationScope === "layer2_interaction") {
    return signals.layer2_interaction;
  }
  if (validationScope === "layer3_session_rhythm") {
    return signals.layer3_session_rhythm;
  }
  return null;
};

const assertRequiredSourceValidationSignals = (signals: XhsCloseoutValidationSignalMap): void => {
  for (const requiredScope of XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES) {
    if (validationScopeSignal(signals, requiredScope.validationScope)) {
      continue;
    }
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      `XHS closeout validation source is missing required ${requiredScope.targetFrRef}/${requiredScope.validationScope} evidence`
    );
  }
};

const isJsonObject = (value: unknown): value is JsonObject =>
  !!value && typeof value === "object" && !Array.isArray(value);

const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;

const assertXhsCloseoutBrowserEvidenceScope = (evidence: JsonObject, layer: string): void => {
  if (
    evidence.target_domain !== XHS_CLOSEOUT_TARGET_DOMAIN ||
    evidence.probe_bundle_ref !== XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF
  ) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      `XHS closeout ${layer} evidence is not bound to the XHS closeout recovery scope`
    );
  }
};

const assertBrowserReturnedFingerprintRuntime = (signals: XhsCloseoutValidationSignalMap): void => {
  const browserEvidence = signals.layer1_consistency.browser_returned_evidence;
  if (!isJsonObject(browserEvidence) || browserEvidence.source !== "main_world") {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout layer1 validation requires scoped browser-returned evidence"
    );
  }
  assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer1");

  const fingerprintRuntime = signals.layer1_consistency.fingerprint_runtime;
  if (!isJsonObject(fingerprintRuntime)) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout layer1 validation requires browser-returned fingerprint_runtime"
    );
  }

  const injection = fingerprintRuntime.injection;
  if (!isJsonObject(injection)) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout fingerprint_runtime is missing browser injection evidence"
    );
  }

  const missingRequiredPatches = asStringArray(injection.missing_required_patches);
  if (injection.source !== "main_world" || missingRequiredPatches === null) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout fingerprint_runtime must come from main-world browser evidence"
    );
  }
  if (missingRequiredPatches.length > 0) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout fingerprint_runtime has missing required patches"
    );
  }
};

const assertBrowserReturnedLayer2Interaction = (signals: XhsCloseoutValidationSignalMap): void => {
  const browserEvidence = signals.layer2_interaction.browser_returned_evidence;
  if (!isJsonObject(browserEvidence) || browserEvidence.source !== "main_world") {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout layer2 validation requires browser-returned interaction evidence"
    );
  }
  assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer2");
  for (const key of [
    "event_strategy_profile",
    "event_chain_policy",
    "rhythm_profile",
    "strategy_selection",
    "execution_trace"
  ] as const) {
    if (!isJsonObject(signals.layer2_interaction[key])) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        `XHS closeout layer2 validation is missing ${key}`
      );
    }
  }
};

const assertBrowserReturnedLayer3SessionRhythm = (
  signals: XhsCloseoutValidationSignalMap
): void => {
  const browserEvidence = signals.layer3_session_rhythm.browser_returned_evidence;
  if (!isJsonObject(browserEvidence) || browserEvidence.source !== "execution_audit") {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout layer3 validation requires browser-returned execution_audit evidence"
    );
  }
  assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer3");
  if (
    typeof signals.layer3_session_rhythm.session_rhythm_window_id !== "string" ||
    signals.layer3_session_rhythm.session_rhythm_window_id.trim().length === 0 ||
    typeof signals.layer3_session_rhythm.session_rhythm_decision_id !== "string" ||
    signals.layer3_session_rhythm.session_rhythm_decision_id.trim().length === 0
  ) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout layer3 validation requires session rhythm compatibility refs"
    );
  }
};

const assertBrowserReturnedCloseoutSignals = (signals: XhsCloseoutValidationSignalMap): void => {
  assertBrowserReturnedFingerprintRuntime(signals);
  assertBrowserReturnedLayer2Interaction(signals);
  assertBrowserReturnedLayer3SessionRhythm(signals);
};

export const persistXhsCloseoutValidationSignals = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
  targetDomain: typeof XHS_CLOSEOUT_TARGET_DOMAIN;
  runId: string;
  observedAt: string;
  signals: XhsCloseoutValidationSignalMap;
  artifactRefs?: string[];
}): Promise<XhsCloseoutValidationGateView> => {
  const profileKey = safeRefPart(input.profile);
  const modeKey = safeRefPart(input.effectiveExecutionMode);
  const runKey = safeRefPart(input.runId);
  const artifactRefs = input.artifactRefs ?? [];

  if (input.targetDomain !== XHS_CLOSEOUT_TARGET_DOMAIN) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout validation target_domain must be www.xiaohongshu.com"
    );
  }

  assertBrowserReturnedCloseoutSignals(input.signals);

  for (const requiredScope of XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES) {
    const scope = buildXhsCloseoutValidationScope({
      profile: input.profile,
      effectiveExecutionMode: input.effectiveExecutionMode,
      targetFrRef: requiredScope.targetFrRef,
      validationScope: requiredScope.validationScope
    });
    const signal = validationScopeSignal(input.signals, requiredScope.validationScope);
    if (!signal) {
      continue;
    }

    const scopeKey = `${safeRefPart(requiredScope.targetFrRef)}/${safeRefPart(requiredScope.validationScope)}`;
    const refSuffix = `${profileKey}/${modeKey}/${runKey}/${scopeKey}`;
    const baselineSuffix = `${profileKey}/${modeKey}/${scopeKey}`;
    const requestRef = `validation-request/xhs-closeout-min-v1/${refSuffix}`;
    const sampleRef = `validation-sample/xhs-closeout-min-v1/${refSuffix}`;
    const candidateBaselineRef = `baseline/xhs-closeout-min-v1/${baselineSuffix}`;
    const registryEntry = await input.store.getAntiDetectionBaselineRegistryEntry(scope);
    const activeBaselineRef = registryEntry?.active_baseline_ref ?? candidateBaselineRef;
    const activeBaseline = await input.store.getAntiDetectionBaselineSnapshot(activeBaselineRef);
    if (registryEntry && !activeBaseline) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "XHS closeout validation active baseline snapshot is missing"
      );
    }
    const baselineRef = activeBaselineRef;
    const recordRef = `validation-record/xhs-closeout-min-v1/${refSuffix}`;
    const sampleGoal = `capture ${requiredScope.targetFrRef} XHS closeout baseline`;
    const structuredPayload = {
      target_fr_ref: requiredScope.targetFrRef,
      validation_scope: requiredScope.validationScope,
      profile_ref: scope.profileRef,
      probe_bundle_ref: scope.probeBundleRef,
      signal
    };
    const signalVector = {
      target_fr_ref: requiredScope.targetFrRef,
      validation_scope: requiredScope.validationScope,
      probe_bundle_ref: scope.probeBundleRef,
      signal
    };
    const currentSignalJson = stableJson(signalVector);
    const baselineSignalJson = activeBaseline ? stableJson(activeBaseline.signal_vector) : null;
    const signalMatchesBaseline = !activeBaseline || baselineSignalJson === currentSignalJson;
    const resultState = signalMatchesBaseline ? "verified" : "broken";
    const driftState = signalMatchesBaseline ? "no_drift" : "drift_detected";

    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "accepted",
      requestedAt: input.observedAt
    });
    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "sampling",
      requestedAt: input.observedAt
    });
    await input.store.insertAntiDetectionStructuredSample({
      ...scope,
      sampleRef,
      requestRef,
      runId: input.runId,
      capturedAt: input.observedAt,
      structuredPayload,
      artifactRefs
    });
    if (!activeBaseline) {
      await input.store.insertAntiDetectionBaselineSnapshot({
        ...scope,
        baselineRef,
        signalVector,
        capturedAt: input.observedAt,
        sourceSampleRefs: [sampleRef],
        sourceRunIds: [input.runId]
      });
    }
    await input.store.insertAntiDetectionValidationRecord({
      ...scope,
      recordRef,
      requestRef,
      sampleRef,
      baselineRef,
      resultState,
      driftState,
      failureClass: resultState === "broken" ? "runtime_error" : null,
      runId: input.runId,
      validatedAt: input.observedAt
    });
    if (!registryEntry && resultState === "verified") {
      await input.store.upsertAntiDetectionBaselineRegistryEntry({
        ...scope,
        activeBaselineRef: baselineRef,
        supersededBaselineRefs: [],
        replacementReason: "initial_seed",
        updatedAt: input.observedAt
      });
    }
    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "completed",
      requestedAt: input.observedAt
    });
  }

  return readXhsCloseoutValidationGateView({
    store: input.store,
    profile: input.profile,
    effectiveExecutionMode: input.effectiveExecutionMode
  });
};

const signalFromSourceSample = (
  sample: AntiDetectionStructuredSampleRecord,
  expectedScope: AntiDetectionValidationScope
): JsonObject => {
  const payload = isJsonObject(sample.structured_payload) ? sample.structured_payload : null;
  const signal = isJsonObject(payload?.signal) ? payload.signal : null;
  if (!signal || sample.validation_scope !== expectedScope) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout validation source sample signal is invalid"
    );
  }
  return signal;
};

const sourceSampleForRequiredScope = (
  samples: AntiDetectionStructuredSampleRecord[],
  targetFrRef: string,
  validationScope: AntiDetectionValidationScope
): AntiDetectionStructuredSampleRecord => {
  const sample =
    samples.find(
      (candidate) =>
        candidate.target_fr_ref === targetFrRef &&
        candidate.validation_scope === validationScope
    ) ?? null;
  if (!sample) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout validation source samples are incomplete"
    );
  }
  return sample;
};

const closeoutSignalsFromSourceSamples = (
  samples: AntiDetectionStructuredSampleRecord[]
): XhsCloseoutValidationSignalMap => ({
  layer1_consistency: signalFromSourceSample(
    sourceSampleForRequiredScope(samples, "FR-0012", "layer1_consistency"),
    "layer1_consistency"
  ),
  layer2_interaction: signalFromSourceSample(
    sourceSampleForRequiredScope(samples, "FR-0013", "layer2_interaction"),
    "layer2_interaction"
  ),
  layer3_session_rhythm: signalFromSourceSample(
    sourceSampleForRequiredScope(samples, "FR-0014", "layer3_session_rhythm"),
    "layer3_session_rhythm"
  )
});

export const persistXhsCloseoutValidationSourceSamples = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
  targetDomain: typeof XHS_CLOSEOUT_TARGET_DOMAIN;
  validationRunId: string;
  observedAt: string;
  sourceRunId: string;
  sourceSamples: AntiDetectionStructuredSampleRecord[];
}): Promise<XhsCloseoutValidationGateView> => {
  const profileKey = safeRefPart(input.profile);
  const modeKey = safeRefPart(input.effectiveExecutionMode);
  const validationRunKey = safeRefPart(input.validationRunId);

  if (input.targetDomain !== XHS_CLOSEOUT_TARGET_DOMAIN) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout validation target_domain must be www.xiaohongshu.com"
    );
  }

  const signals = closeoutSignalsFromSourceSamples(input.sourceSamples);
  assertBrowserReturnedCloseoutSignals(signals);

  await input.store.runInTransaction(async () => {
    for (const requiredScope of XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES) {
    const scope = buildXhsCloseoutValidationScope({
      profile: input.profile,
      effectiveExecutionMode: input.effectiveExecutionMode,
      targetFrRef: requiredScope.targetFrRef,
      validationScope: requiredScope.validationScope
    });
    const sourceSample = sourceSampleForRequiredScope(
      input.sourceSamples,
      requiredScope.targetFrRef,
      requiredScope.validationScope
    );
    if (
      sourceSample.run_id !== input.sourceRunId ||
      sourceSample.profile_ref !== scope.profileRef ||
      sourceSample.browser_channel !== scope.browserChannel ||
      sourceSample.execution_surface !== scope.executionSurface ||
      sourceSample.effective_execution_mode !== scope.effectiveExecutionMode ||
      sourceSample.probe_bundle_ref !== scope.probeBundleRef
    ) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "XHS closeout validation source sample scope does not match requested baseline"
      );
    }
    const sourceRequest = await input.store.getAntiDetectionValidationRequest(
      sourceSample.request_ref
    );
    if (
      !sourceRequest ||
      sourceRequest.requested_execution_mode !== input.effectiveExecutionMode ||
      sourceRequest.request_state !== "completed" ||
      sourceRequest.target_fr_ref !== scope.targetFrRef ||
      sourceRequest.validation_scope !== scope.validationScope ||
      sourceRequest.profile_ref !== scope.profileRef ||
      sourceRequest.browser_channel !== scope.browserChannel ||
      sourceRequest.execution_surface !== scope.executionSurface ||
      sourceRequest.probe_bundle_ref !== scope.probeBundleRef
    ) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "XHS closeout validation source sample request does not match requested baseline"
      );
    }

    const signal = validationScopeSignal(signals, requiredScope.validationScope);
    if (!signal) {
      continue;
    }

    const scopeKey = `${safeRefPart(requiredScope.targetFrRef)}/${safeRefPart(requiredScope.validationScope)}`;
    const baselineSuffix = `${profileKey}/${modeKey}/${scopeKey}`;
    const requestRef = `validation-request/xhs-closeout-min-v1/${profileKey}/${modeKey}/${validationRunKey}/${scopeKey}`;
    const sampleRef = `validation-sample/xhs-closeout-min-v1/${profileKey}/${modeKey}/${validationRunKey}/${scopeKey}`;
    const candidateBaselineRef = `baseline/xhs-closeout-min-v1/${baselineSuffix}`;
    const registryEntry = await input.store.getAntiDetectionBaselineRegistryEntry(scope);
    const activeBaselineRef = registryEntry?.active_baseline_ref ?? candidateBaselineRef;
    const activeBaseline = await input.store.getAntiDetectionBaselineSnapshot(activeBaselineRef);
    if (registryEntry && !activeBaseline) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "XHS closeout validation active baseline snapshot is missing"
      );
    }
    const baselineRef = activeBaselineRef;
    const recordRef = `validation-record/xhs-closeout-min-v1/${profileKey}/${modeKey}/${validationRunKey}/${scopeKey}`;
    const signalVector = {
      target_fr_ref: requiredScope.targetFrRef,
      validation_scope: requiredScope.validationScope,
      probe_bundle_ref: scope.probeBundleRef,
      signal
    };
    const currentSignalJson = stableJson(signalVector);
    const baselineSignalJson = activeBaseline ? stableJson(activeBaseline.signal_vector) : null;
    const signalMatchesBaseline = !activeBaseline || baselineSignalJson === currentSignalJson;
    const resultState = signalMatchesBaseline ? "verified" : "broken";
    const driftState = signalMatchesBaseline ? "no_drift" : "drift_detected";
    const sampleGoal = `validate ${requiredScope.targetFrRef} XHS closeout baseline from approved source sample`;

    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "accepted",
      requestedAt: input.observedAt
    });
    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "sampling",
      requestedAt: input.observedAt
    });
    await input.store.insertAntiDetectionStructuredSample({
      ...scope,
      sampleRef,
      requestRef,
      runId: input.validationRunId,
      capturedAt: input.observedAt,
      structuredPayload: {
        target_fr_ref: requiredScope.targetFrRef,
        validation_scope: requiredScope.validationScope,
        profile_ref: scope.profileRef,
        probe_bundle_ref: scope.probeBundleRef,
        source_sample_ref: sourceSample.sample_ref,
        source_request_ref: sourceSample.request_ref,
        source_run_id: sourceSample.run_id,
        source_captured_at: sourceSample.captured_at,
        source_artifact_refs: sourceSample.artifact_refs,
        signal
      },
      artifactRefs: sourceSample.artifact_refs
    });

    if (!activeBaseline) {
      await input.store.insertAntiDetectionBaselineSnapshot({
        ...scope,
        baselineRef,
        signalVector,
        capturedAt: input.observedAt,
        sourceSampleRefs: [sourceSample.sample_ref],
        sourceRunIds: [sourceSample.run_id]
      });
    }
    await input.store.insertAntiDetectionValidationRecord({
      ...scope,
      recordRef,
      requestRef,
      sampleRef,
      baselineRef,
      resultState,
      driftState,
      failureClass: resultState === "broken" ? "runtime_error" : null,
      runId: input.validationRunId,
      validatedAt: input.observedAt
    });
    if (!registryEntry && resultState === "verified") {
      await input.store.upsertAntiDetectionBaselineRegistryEntry({
        ...scope,
        activeBaselineRef: baselineRef,
        supersededBaselineRefs: [],
        replacementReason: "initial_seed",
        updatedAt: input.observedAt
      });
    }
    await input.store.upsertAntiDetectionValidationRequest({
      requestRef,
      validationScope: requiredScope.validationScope,
      targetFrRef: requiredScope.targetFrRef,
      profileRef: scope.profileRef,
      browserChannel: scope.browserChannel,
      executionSurface: scope.executionSurface,
      sampleGoal,
      requestedExecutionMode: input.effectiveExecutionMode,
      probeBundleRef: scope.probeBundleRef,
      requestState: "completed",
      requestedAt: input.observedAt
    });
    }
  });

  return readXhsCloseoutValidationGateView({
    store: input.store,
    profile: input.profile,
    effectiveExecutionMode: input.effectiveExecutionMode
  });
};

export const persistXhsCloseoutValidationSourceEvidence = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
  targetDomain: typeof XHS_CLOSEOUT_TARGET_DOMAIN;
  sourceRunId: string;
  observedAt: string;
  sourceAudit: GateAuditRecord;
  actionRef: string;
  signals: XhsCloseoutValidationSignalMap;
  artifactRefs?: string[];
  useExistingTransaction?: boolean;
}): Promise<AntiDetectionStructuredSampleRecord[]> => {
  const profileKey = safeRefPart(input.profile);
  const modeKey = safeRefPart(input.effectiveExecutionMode);
  const sourceRunKey = safeRefPart(input.sourceRunId);
  const artifactRefs = input.artifactRefs ?? [];

  if (input.targetDomain !== XHS_CLOSEOUT_TARGET_DOMAIN) {
    throw new RuntimeStoreError(
      "ERR_RUNTIME_STORE_INVALID_INPUT",
      "XHS closeout validation source target_domain must be www.xiaohongshu.com"
    );
  }

  assertRequiredSourceValidationSignals(input.signals);
  assertBrowserReturnedCloseoutSignals(input.signals);

  const persistSamples = async () => {
    for (const requiredScope of XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES) {
      const scope = buildXhsCloseoutValidationScope({
        profile: input.profile,
        effectiveExecutionMode: input.effectiveExecutionMode,
        targetFrRef: requiredScope.targetFrRef,
        validationScope: requiredScope.validationScope
      });
      const signal = validationScopeSignal(input.signals, requiredScope.validationScope);
      if (!signal) {
        throw new RuntimeStoreError(
          "ERR_RUNTIME_STORE_INVALID_INPUT",
          `XHS closeout validation source is missing required ${requiredScope.targetFrRef}/${requiredScope.validationScope} evidence`
        );
      }

      const scopeKey = `${safeRefPart(requiredScope.targetFrRef)}/${safeRefPart(requiredScope.validationScope)}`;
      const refSuffix = `${profileKey}/${modeKey}/${sourceRunKey}/${scopeKey}`;
      const requestRef = `validation-request/source/xhs-closeout-min-v1/${refSuffix}`;
      const sampleRef = `validation-sample/source/xhs-closeout-min-v1/${refSuffix}`;
      const sampleGoal = `capture ${requiredScope.targetFrRef} XHS closeout validation source`;

      await input.store.upsertAntiDetectionValidationRequest({
        requestRef,
        validationScope: requiredScope.validationScope,
        targetFrRef: requiredScope.targetFrRef,
        profileRef: scope.profileRef,
        browserChannel: scope.browserChannel,
        executionSurface: scope.executionSurface,
        sampleGoal,
        requestedExecutionMode: input.effectiveExecutionMode,
        probeBundleRef: scope.probeBundleRef,
        requestState: "accepted",
        requestedAt: input.observedAt
      });
      await input.store.upsertAntiDetectionValidationRequest({
        requestRef,
        validationScope: requiredScope.validationScope,
        targetFrRef: requiredScope.targetFrRef,
        profileRef: scope.profileRef,
        browserChannel: scope.browserChannel,
        executionSurface: scope.executionSurface,
        sampleGoal,
        requestedExecutionMode: input.effectiveExecutionMode,
        probeBundleRef: scope.probeBundleRef,
        requestState: "sampling",
        requestedAt: input.observedAt
      });
      await input.store.insertAntiDetectionStructuredSample({
        ...scope,
        sampleRef,
        requestRef,
        runId: input.sourceRunId,
        capturedAt: input.observedAt,
        structuredPayload: {
          target_fr_ref: requiredScope.targetFrRef,
          validation_scope: requiredScope.validationScope,
          profile_ref: scope.profileRef,
          probe_bundle_ref: scope.probeBundleRef,
          source_gate_audit: {
            event_id: input.sourceAudit.event_id,
            decision_id: input.sourceAudit.decision_id,
            session_id: input.sourceAudit.session_id,
            action_ref: input.sourceAudit.action_ref ?? input.actionRef,
            target_domain: input.sourceAudit.target_domain,
            target_tab_id: input.sourceAudit.target_tab_id,
            target_page: input.sourceAudit.target_page,
            action_type: input.sourceAudit.action_type,
            requested_execution_mode: input.sourceAudit.requested_execution_mode,
            effective_execution_mode: input.sourceAudit.effective_execution_mode,
            approved_at: input.sourceAudit.approved_at,
            recorded_at: input.sourceAudit.recorded_at,
            gate_reasons: input.sourceAudit.gate_reasons
          },
          signal
        },
        artifactRefs
      });
      await input.store.upsertAntiDetectionValidationRequest({
        requestRef,
        validationScope: requiredScope.validationScope,
        targetFrRef: requiredScope.targetFrRef,
        profileRef: scope.profileRef,
        browserChannel: scope.browserChannel,
        executionSurface: scope.executionSurface,
        sampleGoal,
        requestedExecutionMode: input.effectiveExecutionMode,
        probeBundleRef: scope.probeBundleRef,
        requestState: "completed",
        requestedAt: input.observedAt
      });
    }
  };

  if (input.useExistingTransaction === true) {
    await persistSamples();
  } else {
    await input.store.runInTransaction(persistSamples);
  }

  const samples = await Promise.all(
    XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES.map((requiredScope) =>
      input.store.getAntiDetectionStructuredSample(
        `validation-sample/source/xhs-closeout-min-v1/${profileKey}/${modeKey}/${sourceRunKey}/${safeRefPart(requiredScope.targetFrRef)}/${safeRefPart(requiredScope.validationScope)}`
      )
    )
  );
  return samples.filter(
    (sample): sample is AntiDetectionStructuredSampleRecord => sample !== null
  );
};
