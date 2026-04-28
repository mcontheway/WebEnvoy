import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildXhsCloseoutValidationScope,
  persistXhsCloseoutValidationSignals,
  readXhsCloseoutValidationGateView
} from "../anti-detection-validation.js";
import {
  resolveRuntimeStorePath,
  SQLiteRuntimeStore,
  type AntiDetectionExecutionMode,
  type AntiDetectionValidationScope
} from "../store/sqlite-runtime-store.js";

const createStore = async (): Promise<{ cwd: string; store: SQLiteRuntimeStore }> => {
  const cwd = await mkdtemp(join(tmpdir(), "webenvoy-fr0020-validation-"));
  return {
    cwd,
    store: new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd))
  };
};

const signals = {
  layer1_consistency: {
    browser_returned_evidence: {
      source: "main_world",
      target_domain: "www.xiaohongshu.com",
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    fingerprint_runtime: {
      fingerprint_profile_bundle_ref: "fingerprint-bundle/xhs-closeout",
      fingerprint_patch_manifest: {
        required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"]
      },
      injection: {
        installed: true,
        required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"],
        missing_required_patches: [],
        source: "main_world"
      }
    }
  },
  layer2_interaction: {
    browser_returned_evidence: {
      source: "main_world",
      target_domain: "www.xiaohongshu.com",
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    event_strategy_profile: {
      action_kind: "scroll",
      preferred_path: "real_input"
    },
    event_chain_policy: {
      chain_name: "scroll_segment",
      required_events: ["wheel", "scroll"]
    },
    rhythm_profile: {
      profile_name: "default_layer2",
      scroll_segment_min_px: 120,
      scroll_segment_max_px: 480
    },
    strategy_selection: {
      action_kind: "scroll",
      selected_path: "real_input"
    },
    execution_trace: {
      action_kind: "scroll",
      selected_path: "real_input",
      settled_wait_result: "settled"
    }
  },
  layer3_session_rhythm: {
    browser_returned_evidence: {
      source: "execution_audit",
      target_domain: "www.xiaohongshu.com",
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
    },
    session_rhythm_window_id: "rhythm_win_xhs_closeout",
    session_rhythm_decision_id: "rhythm_decision_xhs_closeout",
    escalation: "recon_probe_to_live_admission"
  }
};

const seedBrokenView = async (input: {
  store: SQLiteRuntimeStore;
  profile: string;
  effectiveExecutionMode: AntiDetectionExecutionMode;
  targetFrRef: string;
  validationScope: AntiDetectionValidationScope;
}): Promise<void> => {
  const scope = buildXhsCloseoutValidationScope(input);
  const observedAt = "2026-04-28T00:00:00.000Z";
  const requestRef = `validation-request/broken/${input.targetFrRef}`;
  const sampleRef = `validation-sample/broken/${input.targetFrRef}`;
  const baselineRef = `baseline/broken/${input.targetFrRef}`;
  const recordRef = `validation-record/broken/${input.targetFrRef}`;

  await input.store.upsertAntiDetectionValidationRequest({
    ...scope,
    requestRef,
    sampleGoal: "capture broken baseline",
    requestedExecutionMode: input.effectiveExecutionMode,
    requestState: "accepted",
    requestedAt: observedAt
  });
  await input.store.upsertAntiDetectionValidationRequest({
    ...scope,
    requestRef,
    sampleGoal: "capture broken baseline",
    requestedExecutionMode: input.effectiveExecutionMode,
    requestState: "sampling",
    requestedAt: observedAt
  });
  await input.store.upsertAntiDetectionValidationRequest({
    ...scope,
    requestRef,
    sampleGoal: "capture broken baseline",
    requestedExecutionMode: input.effectiveExecutionMode,
    requestState: "completed",
    requestedAt: observedAt
  });
  await input.store.insertAntiDetectionStructuredSample({
    ...scope,
    sampleRef,
    requestRef,
    runId: "run-broken",
    capturedAt: observedAt,
    structuredPayload: { broken: true },
    artifactRefs: []
  });
  await input.store.insertAntiDetectionBaselineSnapshot({
    ...scope,
    baselineRef,
    signalVector: { broken: true },
    capturedAt: observedAt,
    sourceSampleRefs: [sampleRef],
    sourceRunIds: ["run-broken"]
  });
  await input.store.insertAntiDetectionValidationRecord({
    ...scope,
    recordRef,
    requestRef,
    sampleRef,
    baselineRef,
    resultState: "broken",
    driftState: "drift_detected",
    failureClass: "runtime_error",
    runId: "run-broken",
    validatedAt: observedAt
  });
  await input.store.upsertAntiDetectionBaselineRegistryEntry({
    ...scope,
    activeBaselineRef: baselineRef,
    supersededBaselineRefs: [],
    replacementReason: "initial_seed",
    updatedAt: observedAt
  });
};

describe("FR-0020 XHS closeout validation baseline", () => {
  it("persists the three required XHS closeout validation views as ready", async () => {
    const { cwd, store } = await createStore();
    try {
      const gate = await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-ready",
        observedAt: "2026-04-28T00:10:00.000Z",
        signals
      });

      expect(gate).toMatchObject({
        profile_ref: "profile/xhs_validation_profile",
        browser_channel: "Google Chrome stable",
        execution_surface: "real_browser",
        effective_execution_mode: "live_read_high_risk",
        probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1",
        all_required_ready: true,
        missing_target_fr_refs: [],
        blocking_target_fr_refs: []
      });
      expect(gate.views).toHaveLength(3);
      expect(gate.views).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target_fr_ref: "FR-0012",
            validation_scope: "layer1_consistency",
            baseline_status: "ready",
            current_result_state: "verified",
            current_drift_state: "no_drift"
          }),
          expect.objectContaining({
            target_fr_ref: "FR-0013",
            validation_scope: "layer2_interaction",
            baseline_status: "ready",
            current_result_state: "verified",
            current_drift_state: "no_drift"
          }),
          expect.objectContaining({
            target_fr_ref: "FR-0014",
            validation_scope: "layer3_session_rhythm",
            baseline_status: "ready",
            current_result_state: "verified",
            current_drift_state: "no_drift"
          })
        ])
      );
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps XHS closeout validation scopes isolated by execution mode", async () => {
    const { cwd, store } = await createStore();
    try {
      await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "recon",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-recon",
        observedAt: "2026-04-28T00:20:00.000Z",
        signals
      });

      await expect(
        readXhsCloseoutValidationGateView({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk"
        })
      ).resolves.toMatchObject({
        all_required_ready: false,
        missing_target_fr_refs: ["FR-0012", "FR-0013", "FR-0014"],
        blocking_target_fr_refs: ["FR-0012", "FR-0013", "FR-0014"]
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects layer1 samples that do not carry browser-returned fingerprint_runtime", async () => {
    const { cwd, store } = await createStore();
    try {
      await expect(
        persistXhsCloseoutValidationSignals({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
          runId: "run-validation-local-fingerprint",
          observedAt: "2026-04-28T00:25:00.000Z",
          signals: {
            ...signals,
            layer1_consistency: {
              fingerprint_profile_bundle_ref: "fingerprint-bundle/local-only"
            }
          }
        })
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_STORE_INVALID_INPUT"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects layer2 and layer3 samples that do not carry browser-returned evidence", async () => {
    const { cwd, store } = await createStore();
    try {
      await expect(
        persistXhsCloseoutValidationSignals({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
          runId: "run-validation-local-layer2",
          observedAt: "2026-04-28T00:26:00.000Z",
          signals: {
            ...signals,
            layer2_interaction: {
              event_strategy_profile: {
                action_kind: "scroll"
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_STORE_INVALID_INPUT"
      });

      await expect(
        persistXhsCloseoutValidationSignals({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
          runId: "run-validation-local-layer3",
          observedAt: "2026-04-28T00:27:00.000Z",
          signals: {
            ...signals,
            layer3_session_rhythm: {
              session_rhythm_window_id: "local-window",
              session_rhythm_decision_id: "local-decision"
            }
          }
        })
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_STORE_INVALID_INPUT"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects browser-returned samples from non-XHS or wrong probe bundle scopes", async () => {
    const { cwd, store } = await createStore();
    try {
      await expect(
        persistXhsCloseoutValidationSignals({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk",
          targetDomain: "www.xiaohongshu.com",
          runId: "run-validation-wrong-domain",
          observedAt: "2026-04-28T00:28:00.000Z",
          signals: {
            ...signals,
            layer2_interaction: {
              ...signals.layer2_interaction,
              browser_returned_evidence: {
                source: "main_world",
                target_domain: "example.com",
                probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_STORE_INVALID_INPUT"
      });

      await expect(
        persistXhsCloseoutValidationSignals({
          store,
          profile: "xhs_validation_profile",
          effectiveExecutionMode: "live_read_high_risk",
          targetDomain: "www.xiaohongshu.com",
          runId: "run-validation-wrong-bundle",
          observedAt: "2026-04-28T00:29:00.000Z",
          signals: {
            ...signals,
            layer3_session_rhythm: {
              ...signals.layer3_session_rhythm,
              browser_returned_evidence: {
                source: "execution_audit",
                target_domain: "www.xiaohongshu.com",
                probe_bundle_ref: "probe-bundle/low-risk-v1"
              }
            }
          }
        })
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_STORE_INVALID_INPUT"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("appends a new validation record against the active baseline on later matching runs", async () => {
    const { cwd, store } = await createStore();
    try {
      await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-ready-001",
        observedAt: "2026-04-28T00:10:00.000Z",
        signals
      });

      const gate = await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-ready-002",
        observedAt: "2026-04-28T00:20:00.000Z",
        signals
      });

      expect(gate).toMatchObject({
        all_required_ready: true,
        blocking_target_fr_refs: []
      });
      expect(gate.views).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            target_fr_ref: "FR-0012",
            latest_record_ref: expect.stringContaining("run-validation-ready-002"),
            baseline_status: "ready",
            current_result_state: "verified",
            current_drift_state: "no_drift"
          })
        ])
      );
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("recovers initial baseline seeding when a candidate baseline exists without registry", async () => {
    const { cwd, store } = await createStore();
    try {
      const scope = buildXhsCloseoutValidationScope({
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetFrRef: "FR-0012",
        validationScope: "layer1_consistency"
      });
      const observedAt = "2026-04-28T00:15:00.000Z";
      const requestRef = "validation-request/partial-seed/fr0012";
      const sampleRef = "validation-sample/partial-seed/fr0012";
      const baselineRef =
        "baseline/xhs-closeout-min-v1/xhs_validation_profile/live_read_high_risk/FR-0012/layer1_consistency";
      const signalVector = {
        target_fr_ref: "FR-0012",
        validation_scope: "layer1_consistency",
        probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1",
        signal: signals.layer1_consistency
      };

      await store.upsertAntiDetectionValidationRequest({
        ...scope,
        requestRef,
        sampleGoal: "partial seed layer1",
        requestedExecutionMode: "live_read_high_risk",
        requestState: "accepted",
        requestedAt: observedAt
      });
      await store.upsertAntiDetectionValidationRequest({
        ...scope,
        requestRef,
        sampleGoal: "partial seed layer1",
        requestedExecutionMode: "live_read_high_risk",
        requestState: "sampling",
        requestedAt: observedAt
      });
      await store.upsertAntiDetectionValidationRequest({
        ...scope,
        requestRef,
        sampleGoal: "partial seed layer1",
        requestedExecutionMode: "live_read_high_risk",
        requestState: "completed",
        requestedAt: observedAt
      });
      await store.insertAntiDetectionStructuredSample({
        ...scope,
        sampleRef,
        requestRef,
        runId: "run-partial-seed-fr0012",
        capturedAt: observedAt,
        structuredPayload: { signal: signals.layer1_consistency },
        artifactRefs: []
      });
      await store.insertAntiDetectionBaselineSnapshot({
        ...scope,
        baselineRef,
        signalVector,
        capturedAt: observedAt,
        sourceSampleRefs: [sampleRef],
        sourceRunIds: ["run-partial-seed-fr0012"]
      });

      const gate = await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-after-partial-seed",
        observedAt: "2026-04-28T00:16:00.000Z",
        signals
      });

      expect(gate).toMatchObject({
        all_required_ready: true,
        blocking_target_fr_refs: []
      });
      expect(gate.views[0]).toMatchObject({
        target_fr_ref: "FR-0012",
        latest_record_ref: expect.stringContaining("run-validation-after-partial-seed"),
        baseline_status: "ready",
        current_result_state: "verified",
        current_drift_state: "no_drift"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("records drift against the active baseline without reseeding it", async () => {
    const { cwd, store } = await createStore();
    try {
      await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-ready-001",
        observedAt: "2026-04-28T00:10:00.000Z",
        signals
      });

      const gate = await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-drift-001",
        observedAt: "2026-04-28T00:20:00.000Z",
        signals: {
          ...signals,
          layer2_interaction: {
            ...signals.layer2_interaction,
            execution_trace: {
              action_kind: "scroll",
              selected_path: "blocked",
              settled_wait_result: "timeout"
            }
          }
        }
      });

      expect(gate).toMatchObject({
        all_required_ready: false,
        blocking_target_fr_refs: ["FR-0013"]
      });
      expect(gate.views[1]).toMatchObject({
        target_fr_ref: "FR-0013",
        latest_record_ref: expect.stringContaining("run-validation-drift-001"),
        baseline_status: "ready",
        current_result_state: "broken",
        current_drift_state: "drift_detected"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not overwrite an existing broken validation view into ready", async () => {
    const { cwd, store } = await createStore();
    try {
      await seedBrokenView({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetFrRef: "FR-0012",
        validationScope: "layer1_consistency"
      });

      const gate = await persistXhsCloseoutValidationSignals({
        store,
        profile: "xhs_validation_profile",
        effectiveExecutionMode: "live_read_high_risk",
        targetDomain: "www.xiaohongshu.com",
        runId: "run-validation-after-broken",
        observedAt: "2026-04-28T00:30:00.000Z",
        signals
      });

      expect(gate).toMatchObject({
        all_required_ready: false,
        blocking_target_fr_refs: ["FR-0012"]
      });
      expect(gate.views[0]).toMatchObject({
        target_fr_ref: "FR-0012",
        validation_scope: "layer1_consistency",
        current_result_state: "broken",
        current_drift_state: "drift_detected"
      });
      expect(gate.views[1]).toMatchObject({
        target_fr_ref: "FR-0013",
        baseline_status: "ready",
        current_result_state: "verified",
        current_drift_state: "no_drift"
      });
      expect(gate.views[2]).toMatchObject({
        target_fr_ref: "FR-0014",
        baseline_status: "ready",
        current_result_state: "verified",
        current_drift_state: "no_drift"
      });
    } finally {
      store.close();
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
