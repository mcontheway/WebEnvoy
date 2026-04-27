const DEFAULT_RHYTHM_PROFILE = {
    profile_name: "default_layer2",
    hover_confirm_min_ms: 80,
    hover_confirm_max_ms: 200,
    click_jitter_min_px: 2,
    click_jitter_max_px: 8,
    typing_delay_min_ms: 60,
    typing_delay_max_ms: 220,
    punctuation_pause_multiplier: 1.8,
    long_pause_probability: 0.08,
    scroll_segment_min_px: 120,
    scroll_segment_max_px: 480,
    lookback_probability: 0.12
};
const STRATEGY_PROFILES = {
    api_read: {
        action_kind: "api_read",
        preferred_path: "real_input",
        fallback_path: null,
        requires_focus: false,
        requires_hover_confirm: false,
        requires_settled_wait: false,
        blocked_when_tier: []
    },
    click: {
        action_kind: "click",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: true,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    focus: {
        action_kind: "focus",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    keyboard_input: {
        action_kind: "keyboard_input",
        preferred_path: "mixed_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    composition_input: {
        action_kind: "composition_input",
        preferred_path: "mixed_input",
        fallback_path: "synthetic_chain",
        requires_focus: true,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: ["irreversible_write"]
    },
    hover: {
        action_kind: "hover",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: true,
        requires_settled_wait: false,
        blocked_when_tier: []
    },
    scroll: {
        action_kind: "scroll",
        preferred_path: "real_input",
        fallback_path: "synthetic_chain",
        requires_focus: false,
        requires_hover_confirm: false,
        requires_settled_wait: true,
        blocked_when_tier: []
    }
};
const EVENT_CHAINS = {
    api_read: {
        chain_name: "api_replay_no_ui_event_chain",
        action_kind: "api_read",
        required_events: [],
        optional_events: [],
        completion_signal: ["api_replay_requested"],
        requires_settled_wait: false
    },
    click: {
        chain_name: "hover_click",
        action_kind: "click",
        required_events: ["mousemove", "mouseover", "mousedown", "mouseup", "click"],
        optional_events: ["pointermove", "pointerdown", "pointerup"],
        completion_signal: ["dom_settled"],
        requires_settled_wait: true
    },
    focus: {
        chain_name: "focus_acquire",
        action_kind: "focus",
        required_events: ["focus"],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["document_active_element_matched"],
        requires_settled_wait: true
    },
    keyboard_input: {
        chain_name: "keyboard_input",
        action_kind: "keyboard_input",
        required_events: ["focus", "keydown", "input", "keyup", "change", "blur"],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["dom_settled", "framework_value_updated"],
        requires_settled_wait: true
    },
    composition_input: {
        chain_name: "composition_input",
        action_kind: "composition_input",
        required_events: [
            "focus",
            "compositionstart",
            "compositionupdate",
            "compositionend",
            "input",
            "change",
            "blur"
        ],
        optional_events: ["mousedown", "mouseup", "click"],
        completion_signal: ["dom_settled", "framework_value_updated"],
        requires_settled_wait: true
    },
    hover: {
        chain_name: "hover_confirm",
        action_kind: "hover",
        required_events: ["mousemove", "mouseover"],
        optional_events: ["pointermove"],
        completion_signal: ["hover_confirmed"],
        requires_settled_wait: false
    },
    scroll: {
        chain_name: "scroll_segment",
        action_kind: "scroll",
        required_events: ["wheel", "scroll"],
        optional_events: ["mousemove"],
        completion_signal: ["viewport_position_changed", "dom_settled"],
        requires_settled_wait: true
    }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
export const buildLayer2InteractionEvidence = (input) => {
    const strategy = clone(STRATEGY_PROFILES[input.actionKind]);
    const chain = clone(EVENT_CHAINS[input.actionKind]);
    const rhythm = clone(DEFAULT_RHYTHM_PROFILE);
    const blockedBy = input.writeInteractionTierName &&
        strategy.blocked_when_tier.includes(input.writeInteractionTierName)
        ? "FR-0011.write_interaction_tier"
        : null;
    const selectedPath = blockedBy ? "blocked" : input.actionKind === "api_read" ? "not_executed" : strategy.preferred_path;
    const settledWaitApplied = selectedPath !== "blocked" && chain.requires_settled_wait;
    const settledWaitResult = selectedPath === "blocked"
        ? "failed"
        : settledWaitApplied
            ? input.settledWaitResult ?? "not_observed"
            : "not_required";
    return {
        event_strategy_profile: strategy,
        event_chain_policy: chain,
        rhythm_profile: rhythm,
        strategy_selection: {
            action_kind: input.actionKind,
            selected_path: selectedPath,
            strategy_profile: `${input.actionKind}_default`,
            event_chain: chain.chain_name,
            rhythm_profile: rhythm.profile_name,
            fallback_reason: null,
            blocked_by: blockedBy
        },
        execution_trace: {
            action_kind: input.actionKind,
            selected_path: selectedPath,
            event_chain: chain.chain_name,
            rhythm_profile_source: input.rhythmProfileSource ?? "default",
            settled_wait_applied: settledWaitApplied,
            settled_wait_result: settledWaitResult,
            failure_category: blockedBy ? "blocked_by_fr0011" : null
        }
    };
};
export const buildXhsSearchLayer2InteractionEvidence = (input) => buildLayer2InteractionEvidence({
    actionKind: input.recoveryProbe || input.requestedExecutionMode === "recon"
        ? "scroll"
        : "api_read",
    writeInteractionTierName: input.writeInteractionTierName ?? null
});
