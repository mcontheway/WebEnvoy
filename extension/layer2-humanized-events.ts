export type Layer2ActionKind =
  | "click"
  | "focus"
  | "keyboard_input"
  | "composition_input"
  | "hover"
  | "scroll";

export type Layer2SelectedPath = "real_input" | "mixed_input" | "synthetic_chain" | "blocked";
export type Layer2RhythmProfileSource = "default" | "platform_override";
export type Layer2FailureCategory =
  | "focus_not_acquired"
  | "framework_state_not_updated"
  | "target_drifted"
  | "blocked_by_fr0011";

export interface EventStrategyProfile {
  action_kind: Layer2ActionKind;
  preferred_path: "real_input" | "mixed_input";
  fallback_path: "synthetic_chain" | null;
  requires_focus: boolean;
  requires_hover_confirm: boolean;
  requires_settled_wait: boolean;
  blocked_when_tier: string[];
}

export interface EventChainPolicy {
  chain_name: string;
  action_kind: Layer2ActionKind;
  required_events: string[];
  optional_events: string[];
  completion_signal: string[];
  requires_settled_wait: boolean;
}

export interface RhythmProfile {
  profile_name: "default_layer2";
  hover_confirm_min_ms: number;
  hover_confirm_max_ms: number;
  click_jitter_min_px: number;
  click_jitter_max_px: number;
  typing_delay_min_ms: number;
  typing_delay_max_ms: number;
  punctuation_pause_multiplier: number;
  long_pause_probability: number;
  scroll_segment_min_px: number;
  scroll_segment_max_px: number;
  lookback_probability: number;
}

export interface StrategySelection {
  action_kind: Layer2ActionKind;
  selected_path: Layer2SelectedPath;
  strategy_profile: string;
  event_chain: string;
  rhythm_profile: string;
  fallback_reason: string | null;
  blocked_by: string | null;
}

export interface ExecutionTrace {
  action_kind: Layer2ActionKind;
  selected_path: Layer2SelectedPath;
  event_chain: string;
  rhythm_profile_source: Layer2RhythmProfileSource;
  settled_wait_applied: boolean;
  settled_wait_result: "settled" | "timeout" | "skipped";
  failure_category: Layer2FailureCategory | null;
}

export interface Layer2InteractionEvidence {
  event_strategy_profile: EventStrategyProfile;
  event_chain_policy: EventChainPolicy;
  rhythm_profile: RhythmProfile;
  strategy_selection: StrategySelection;
  execution_trace: ExecutionTrace;
}

const DEFAULT_RHYTHM_PROFILE: RhythmProfile = {
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

const STRATEGY_PROFILES: Record<Layer2ActionKind, EventStrategyProfile> = {
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
    preferred_path: "real_input",
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

const EVENT_CHAINS: Record<Layer2ActionKind, EventChainPolicy> = {
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

const CHANGE_BLUR_FINALIZE_CHAIN: EventChainPolicy = {
  chain_name: "change_blur_finalize",
  action_kind: "keyboard_input",
  required_events: ["change", "blur"],
  optional_events: ["input"],
  completion_signal: ["framework_value_finalized", "dom_settled"],
  requires_settled_wait: true
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const getLayer2EventChainPolicies = (): EventChainPolicy[] => [
  ...Object.values(EVENT_CHAINS).map((chain) => clone(chain)),
  clone(CHANGE_BLUR_FINALIZE_CHAIN)
];

export const buildLayer2InteractionEvidence = (input: {
  actionKind: Layer2ActionKind;
  writeInteractionTierName?: string | null;
  rhythmProfileSource?: Layer2RhythmProfileSource;
  settledWaitResult?: "settled" | "timeout" | "skipped";
  executionApplied?: boolean;
}): Layer2InteractionEvidence => {
  const strategy = clone(STRATEGY_PROFILES[input.actionKind]);
  const chain = clone(EVENT_CHAINS[input.actionKind]);
  const rhythm = clone(DEFAULT_RHYTHM_PROFILE);
  const gateOnlyBlockedBy =
    input.executionApplied === false ? "FR-0013.gate_only_probe_no_event_chain" : null;
  const tierBlockedBy =
    input.writeInteractionTierName &&
    strategy.blocked_when_tier.includes(input.writeInteractionTierName)
      ? "FR-0011.write_interaction_tier"
      : null;
  const blockedBy = gateOnlyBlockedBy ?? tierBlockedBy;
  const selectedPath: Layer2SelectedPath = blockedBy ? "blocked" : strategy.preferred_path;
  const settledWaitApplied = selectedPath !== "blocked" && chain.requires_settled_wait;
  const settledWaitResult =
    selectedPath === "blocked"
      ? "skipped"
      : settledWaitApplied
        ? input.settledWaitResult ?? "timeout"
        : "skipped";

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
      failure_category: tierBlockedBy ? "blocked_by_fr0011" : null
    }
  };
};

export const buildXhsSearchLayer2InteractionEvidence = (input: {
  writeInteractionTierName?: string | null;
  requestedExecutionMode?: string | null;
  recoveryProbe?: boolean;
  executionApplied?: boolean;
}): Layer2InteractionEvidence | null => {
  if (!input.recoveryProbe || input.requestedExecutionMode !== "recon") {
    return null;
  }
  return buildLayer2InteractionEvidence({
    actionKind: "scroll",
    writeInteractionTierName: input.writeInteractionTierName ?? null,
    executionApplied: input.executionApplied ?? false
  });
};
