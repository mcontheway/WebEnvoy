export const XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL = "Google Chrome stable";
export const XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE = "real_browser";
export const XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF = "probe-bundle/xhs-closeout-min-v1";
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
