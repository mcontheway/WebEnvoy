import { describe, expect, it } from "vitest";

import {
  buildLayer2InteractionEvidence,
  buildXhsSearchLayer2InteractionEvidence,
  getLayer2EventChainPolicies
} from "../extension/layer2-humanized-events.js";

describe("FR-0013 layer2 humanized events", () => {
  it("builds default keyboard interaction evidence with stable contract objects", () => {
    const evidence = buildLayer2InteractionEvidence({ actionKind: "keyboard_input" });

    expect(evidence.event_strategy_profile).toMatchObject({
      action_kind: "keyboard_input",
      preferred_path: "real_input",
      fallback_path: "synthetic_chain",
      requires_focus: true,
      requires_settled_wait: true
    });
    expect(evidence.event_chain_policy).toMatchObject({
      chain_name: "keyboard_input",
      action_kind: "keyboard_input",
      required_events: expect.arrayContaining(["focus", "keydown", "input", "keyup"])
    });
    expect(evidence.rhythm_profile).toMatchObject({
      profile_name: "default_layer2",
      typing_delay_min_ms: 60,
      typing_delay_max_ms: 220
    });
    expect(evidence.strategy_selection).toMatchObject({
      selected_path: "real_input",
      event_chain: "keyboard_input",
      rhythm_profile: "default_layer2",
      blocked_by: null
    });
    expect(evidence.execution_trace).toMatchObject({
      action_kind: "keyboard_input",
      selected_path: "real_input",
      settled_wait_applied: true,
      settled_wait_result: "timeout",
      failure_category: null
    });
  });

  it("records settled only when the caller supplies an observed wait result", () => {
    const evidence = buildLayer2InteractionEvidence({
      actionKind: "keyboard_input",
      settledWaitResult: "settled"
    });

    expect(evidence.execution_trace).toMatchObject({
      action_kind: "keyboard_input",
      settled_wait_applied: true,
      settled_wait_result: "settled"
    });
  });

  it("blocks irreversible writes through FR-0011 tier input", () => {
    const evidence = buildLayer2InteractionEvidence({
      actionKind: "composition_input",
      writeInteractionTierName: "irreversible_write"
    });

    expect(evidence.strategy_selection).toMatchObject({
      selected_path: "blocked",
      blocked_by: "FR-0011.write_interaction_tier"
    });
    expect(evidence.execution_trace).toMatchObject({
      selected_path: "blocked",
      settled_wait_applied: false,
      settled_wait_result: "skipped",
      failure_category: "blocked_by_fr0011"
    });
  });

  it("marks gate-only xhs recovery recon probes as not executed", () => {
    const evidence = buildXhsSearchLayer2InteractionEvidence({
      requestedExecutionMode: "recon",
      recoveryProbe: true
    });

    expect(evidence.strategy_selection).toMatchObject({
      action_kind: "scroll",
      selected_path: "blocked",
      event_chain: "scroll_segment",
      blocked_by: "FR-0013.gate_only_probe_no_event_chain"
    });
    expect(evidence.execution_trace).toMatchObject({
      selected_path: "blocked",
      settled_wait_applied: false,
      settled_wait_result: "skipped",
      failure_category: null
    });
  });

  it("includes the frozen change/blur finalize chain policy", () => {
    expect(getLayer2EventChainPolicies()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          chain_name: "change_blur_finalize",
          action_kind: "keyboard_input",
          required_events: ["change", "blur"],
          completion_signal: expect.arrayContaining(["framework_value_finalized"])
        })
      ])
    );
  });

  it("does not emit layer2 evidence for generic xhs recon without recovery probe marker", () => {
    const evidence = buildXhsSearchLayer2InteractionEvidence({
      requestedExecutionMode: "recon",
      recoveryProbe: false
    });

    expect(evidence).toBeNull();
  });

  it("does not emit layer2 evidence for xhs live API replay", () => {
    const evidence = buildXhsSearchLayer2InteractionEvidence({
      requestedExecutionMode: "live_read_high_risk",
      recoveryProbe: false
    });

    expect(evidence).toBeNull();
  });

  it("does not emit recovery evidence for non-recon modes even when marked as recovery probe", () => {
    const evidence = buildXhsSearchLayer2InteractionEvidence({
      requestedExecutionMode: "live_read_high_risk",
      recoveryProbe: true
    });

    expect(evidence).toBeNull();
  });
});
