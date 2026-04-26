import type { JsonObject } from "../core/types.js";
import {
  type AntiDetectionExecutionMode,
  type AntiDetectionValidationScope,
  type AntiDetectionValidationScopeKeyInput,
  type AntiDetectionValidationViewRecord,
  SQLiteRuntimeStore
} from "./store/sqlite-runtime-store.js";

export const XHS_CLOSEOUT_BASELINE_BROWSER_CHANNEL = "Google Chrome stable" as const;
export const XHS_CLOSEOUT_BASELINE_EXECUTION_SURFACE = "real_browser" as const;
export const XHS_CLOSEOUT_BASELINE_PROBE_BUNDLE_REF = "probe-bundle/xhs-closeout-min-v1" as const;

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
