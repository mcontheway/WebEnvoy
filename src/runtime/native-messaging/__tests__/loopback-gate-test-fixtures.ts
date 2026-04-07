import type { LoopbackGate } from "../loopback-gate.js";
import type { LoopbackAuditSource } from "../loopback-gate-audit.js";
import type { LoopbackObservabilitySource } from "../loopback-gate-observability.js";

export const createLoopbackGateFixture = (overrides: Record<string, unknown> = {}): LoopbackGate => {
  const base = {
    scopeContext: {
      platform: "xhs",
      read_domain: "www.xiaohongshu.com",
      write_domain: "creator.xiaohongshu.com",
      domain_mixing_forbidden: true
    },
    readExecutionPolicy: {
      default_mode: "dry_run",
      allowed_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      blocked_actions: ["expand_new_live_surface_without_gate"],
      live_entry_requirements: ["target_domain_confirmed"]
    },
    issueScope: "issue_209",
    issueActionMatrix: {
      issue_scope: "issue_209",
      risk_state: "paused",
      allowed_actions: ["read"],
      conditional_actions: [],
      blocked_actions: []
    },
    gateInput: {
      issue_scope: "issue_209",
      risk_state: "paused",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 1,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "dry_run"
    },
    gateOutcome: {
      gate_decision: "allowed"
    },
    consumerGateResult: {
      gate_decision: "allowed",
      gate_reasons: [],
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 1,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "dry_run",
      effective_execution_mode: "dry_run"
    },
    approvalRecord: {
      approved: true,
      approver: "loopback-agent",
      approved_at: "2026-03-23T10:00:00.000Z",
      checks: {
        approval_record_approved_true: true,
        approval_record_approver_present: true,
        approval_record_approved_at_present: true,
        approval_record_checks_all_true: true
      }
    },
    writeInteractionTier: {
      tiers: [],
      synthetic_event_default: "observe_only",
      upload_injection_default: "observe_only"
    },
    writeActionMatrixDecisions: {
      issue_scope: "issue_209",
      action_type: "read",
      requested_execution_mode: "dry_run",
      write_interaction_tier: "observe_only",
      decisions: []
    },
  } as Record<string, unknown>;

  return {
    ...base,
    ...overrides,
    scopeContext: {
      ...(base.scopeContext as Record<string, unknown>),
      ...(overrides.scopeContext as Record<string, unknown> | undefined)
    },
    readExecutionPolicy: {
      ...(base.readExecutionPolicy as Record<string, unknown>),
      ...(overrides.readExecutionPolicy as Record<string, unknown> | undefined)
    },
    issueActionMatrix: {
      ...(base.issueActionMatrix as Record<string, unknown>),
      ...(overrides.issueActionMatrix as Record<string, unknown> | undefined)
    },
    gateInput: {
      ...(base.gateInput as Record<string, unknown>),
      ...(overrides.gateInput as Record<string, unknown> | undefined)
    },
    gateOutcome: {
      ...(base.gateOutcome as Record<string, unknown>),
      ...(overrides.gateOutcome as Record<string, unknown> | undefined)
    },
    consumerGateResult: {
      ...(base.consumerGateResult as Record<string, unknown>),
      ...(overrides.consumerGateResult as Record<string, unknown> | undefined)
    },
    approvalRecord: {
      ...(base.approvalRecord as Record<string, unknown>),
      ...(overrides.approvalRecord as Record<string, unknown> | undefined)
    },
    writeInteractionTier: {
      ...(base.writeInteractionTier as Record<string, unknown>),
      ...(overrides.writeInteractionTier as Record<string, unknown> | undefined)
    },
    writeActionMatrixDecisions: {
      ...(base.writeActionMatrixDecisions as Record<string, unknown>),
      ...(overrides.writeActionMatrixDecisions as Record<string, unknown> | undefined)
    }
  } as LoopbackGate;
};

export const createLoopbackAuditFixture = (
  overrides: Partial<LoopbackAuditSource> = {}
): LoopbackAuditSource => {
  const gate = createLoopbackGateFixture(overrides as Record<string, unknown>);
  return {
    gateInput: gate.gateInput,
    consumerGateResult: gate.consumerGateResult,
    approvalRecord: gate.approvalRecord,
    writeActionMatrixDecisions: gate.writeActionMatrixDecisions
  };
};

export const createLoopbackObservabilityFixture = (
  overrides: Partial<LoopbackObservabilitySource> = {}
): LoopbackObservabilitySource => {
  const gate = createLoopbackGateFixture(overrides as Record<string, unknown>);
  return {
    gateInput: gate.gateInput,
    consumerGateResult: gate.consumerGateResult
  };
};
