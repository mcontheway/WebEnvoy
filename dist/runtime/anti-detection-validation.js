import { RuntimeStoreError } from "./store/sqlite-runtime-store.js";
export const XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL = "Google Chrome stable";
export const XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE = "real_browser";
export const XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF = "probe-bundle/xhs-closeout-min-v1";
export const XHS_CLOSEOUT_TARGET_DOMAIN = "www.xiaohongshu.com";
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
];
const toViewJson = (view) => view ? { ...view } : null;
export const toXhsCloseoutValidationGateJson = (gate) => ({
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
export const buildXhsCloseoutValidationScope = (input) => ({
    targetFrRef: input.targetFrRef,
    validationScope: input.validationScope,
    profileRef: `profile/${input.profile}`,
    browserChannel: XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL,
    executionSurface: XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE,
    effectiveExecutionMode: input.effectiveExecutionMode,
    probeBundleRef: XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF
});
export const readXhsCloseoutValidationGateView = async (input) => {
    const views = await Promise.all(XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES.map((scope) => input.store.getAntiDetectionValidationView(buildXhsCloseoutValidationScope({
        profile: input.profile,
        effectiveExecutionMode: input.effectiveExecutionMode,
        targetFrRef: scope.targetFrRef,
        validationScope: scope.validationScope
    }))));
    const requiredTargetFrRefs = XHS_CLOSEOUT_REQUIRED_VALIDATION_SCOPES.map((scope) => scope.targetFrRef);
    const missingTargetFrRefs = requiredTargetFrRefs.filter((_, index) => views[index] === null);
    const blockingTargetFrRefs = requiredTargetFrRefs.filter((_, index) => {
        const view = views[index];
        if (!view) {
            return true;
        }
        return !(view.baseline_status === "ready" &&
            view.current_result_state === "verified" &&
            view.current_drift_state === "no_drift");
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
const safeRefPart = (value) => value.replace(/[^A-Za-z0-9._-]+/gu, "_");
const stableJson = (value) => {
    if (Array.isArray(value)) {
        return `[${value.map(stableJson).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const record = value;
        return `{${Object.keys(record)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
};
const validationScopeSignal = (signals, validationScope) => {
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
const isJsonObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const asStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === "string")
    ? [...value]
    : null;
const assertXhsCloseoutBrowserEvidenceScope = (evidence, layer) => {
    if (evidence.target_domain !== XHS_CLOSEOUT_TARGET_DOMAIN ||
        evidence.probe_bundle_ref !== XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", `XHS closeout ${layer} evidence is not bound to the XHS closeout recovery scope`);
    }
};
const assertBrowserReturnedFingerprintRuntime = (signals) => {
    const browserEvidence = signals.layer1_consistency.browser_returned_evidence;
    if (!isJsonObject(browserEvidence) || browserEvidence.source !== "main_world") {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout layer1 validation requires scoped browser-returned evidence");
    }
    assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer1");
    const fingerprintRuntime = signals.layer1_consistency.fingerprint_runtime;
    if (!isJsonObject(fingerprintRuntime)) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout layer1 validation requires browser-returned fingerprint_runtime");
    }
    const injection = fingerprintRuntime.injection;
    if (!isJsonObject(injection)) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout fingerprint_runtime is missing browser injection evidence");
    }
    const missingRequiredPatches = asStringArray(injection.missing_required_patches);
    if (injection.source !== "main_world" || missingRequiredPatches === null) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout fingerprint_runtime must come from main-world browser evidence");
    }
    if (missingRequiredPatches.length > 0) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout fingerprint_runtime has missing required patches");
    }
};
const assertBrowserReturnedLayer2Interaction = (signals) => {
    const browserEvidence = signals.layer2_interaction.browser_returned_evidence;
    if (!isJsonObject(browserEvidence) || browserEvidence.source !== "main_world") {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout layer2 validation requires browser-returned interaction evidence");
    }
    assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer2");
    for (const key of [
        "event_strategy_profile",
        "event_chain_policy",
        "rhythm_profile",
        "strategy_selection",
        "execution_trace"
    ]) {
        if (!isJsonObject(signals.layer2_interaction[key])) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", `XHS closeout layer2 validation is missing ${key}`);
        }
    }
};
const assertBrowserReturnedLayer3SessionRhythm = (signals) => {
    const browserEvidence = signals.layer3_session_rhythm.browser_returned_evidence;
    if (!isJsonObject(browserEvidence) || browserEvidence.source !== "execution_audit") {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout layer3 validation requires browser-returned execution_audit evidence");
    }
    assertXhsCloseoutBrowserEvidenceScope(browserEvidence, "layer3");
    if (typeof signals.layer3_session_rhythm.session_rhythm_window_id !== "string" ||
        signals.layer3_session_rhythm.session_rhythm_window_id.trim().length === 0 ||
        typeof signals.layer3_session_rhythm.session_rhythm_decision_id !== "string" ||
        signals.layer3_session_rhythm.session_rhythm_decision_id.trim().length === 0) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout layer3 validation requires session rhythm compatibility refs");
    }
};
const assertBrowserReturnedCloseoutSignals = (signals) => {
    assertBrowserReturnedFingerprintRuntime(signals);
    assertBrowserReturnedLayer2Interaction(signals);
    assertBrowserReturnedLayer3SessionRhythm(signals);
};
export const persistXhsCloseoutValidationSignals = async (input) => {
    const profileKey = safeRefPart(input.profile);
    const modeKey = safeRefPart(input.effectiveExecutionMode);
    const runKey = safeRefPart(input.runId);
    const artifactRefs = input.artifactRefs ?? [];
    if (input.targetDomain !== XHS_CLOSEOUT_TARGET_DOMAIN) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "XHS closeout validation target_domain must be www.xiaohongshu.com");
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
            continue;
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
    }
    return readXhsCloseoutValidationGateView({
        store: input.store,
        profile: input.profile,
        effectiveExecutionMode: input.effectiveExecutionMode
    });
};
