import {
  WRITE_INTERACTION_TIER,
  ISSUE_SCOPES,
  buildRiskTransitionAudit,
  buildUnifiedRiskStateOutput,
  getIssueActionMatrixEntry,
  resolveIssueScope as resolveSharedIssueScope,
  resolveRiskState as resolveSharedRiskState,
  type ActionType,
  type ExecutionMode,
  type IssueActionMatrixEntry,
  type IssueScope,
  type RiskState,
  type WriteActionMatrixDecisionsOutput
} from "../../../shared/risk-state.js";
import { evaluateXhsGate } from "../../../shared/xhs-gate.js";

type LoopbackActionType = ActionType;
type LoopbackExecutionMode = ExecutionMode;
type LoopbackEffectiveExecutionMode = LoopbackExecutionMode | null;
type LoopbackRiskState = RiskState;
type LoopbackIssueScope = IssueScope;
type LoopbackIssueActionMatrixEntry = IssueActionMatrixEntry;

const LOOPBACK_PLUGIN_GATE_OWNERSHIP = {
  background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
  content_script_gate: ["page_context_check", "action_tier_check"],
  main_world_gate: ["signed_call_scope_check"],
  cli_role: "request_and_result_shell_only"
} as const;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const resolveLoopbackRiskState = (value: unknown): LoopbackRiskState => resolveSharedRiskState(value);

const resolveLoopbackIssueScope = (value: unknown): LoopbackIssueScope =>
  ISSUE_SCOPES.includes(value as LoopbackIssueScope)
    ? (value as LoopbackIssueScope)
    : resolveSharedIssueScope(value);

const resolveLoopbackIssueActionMatrixEntry = (
  issueScope: LoopbackIssueScope,
  riskState: LoopbackRiskState
): LoopbackIssueActionMatrixEntry => {
  return getIssueActionMatrixEntry(issueScope, riskState);
};

const buildLoopbackGate = (
  options: Record<string, unknown>,
  abilityAction: string | null
): {
  scopeContext: Record<string, unknown>;
  readExecutionPolicy: Record<string, unknown>;
  issueScope: LoopbackIssueScope;
  issueActionMatrix: LoopbackIssueActionMatrixEntry;
  writeInteractionTier: typeof WRITE_INTERACTION_TIER;
  writeActionMatrixDecisions: WriteActionMatrixDecisionsOutput | null;
  gateInput: Record<string, unknown>;
  gateOutcome: Record<string, unknown>;
  consumerGateResult: Record<string, unknown>;
  approvalRecord: Record<string, unknown>;
} => {
  const issue208EditorInputValidation =
    options.issue_scope === "issue_208" &&
    options.requested_execution_mode === "live_write" &&
    asString(options.validation_action) === "editor_input";
  const evaluatedGate = evaluateXhsGate({
    issueScope: options.issue_scope,
    riskState: options.risk_state,
    targetDomain: options.target_domain,
    targetTabId: options.target_tab_id,
    targetPage: options.target_page,
    actionType: options.action_type,
    abilityAction,
    requestedExecutionMode: options.requested_execution_mode,
    approvalRecord: options.approval_record ?? options.approval,
    issue208EditorInputValidation,
    treatMissingEditorValidationAsUnsupported: true,
    includeWriteInteractionTierReason: true,
    writeGateOnlyEligibleBehavior: "block"
  });
  const issueScope = resolveLoopbackIssueScope(evaluatedGate.gate_input.issue_scope);

  return {
    scopeContext: { ...evaluatedGate.scope_context },
    readExecutionPolicy: { ...evaluatedGate.read_execution_policy },
    issueScope,
    issueActionMatrix: evaluatedGate.issue_action_matrix,
    gateInput: { ...evaluatedGate.gate_input },
    gateOutcome: { ...evaluatedGate.gate_outcome },
    consumerGateResult: { ...evaluatedGate.consumer_gate_result },
    approvalRecord: { ...evaluatedGate.approval_record },
    writeInteractionTier: WRITE_INTERACTION_TIER,
    writeActionMatrixDecisions: evaluatedGate.write_action_matrix_decisions
  };
};

const buildLoopbackAuditRecord = (input: {
  runId: string;
  sessionId: string;
  profile: string;
  gate: ReturnType<typeof buildLoopbackGate>;
}): Record<string, unknown> => ({
  event_id: `gate_evt_${input.runId}`,
  run_id: input.runId,
  session_id: input.sessionId,
  profile: input.profile,
  risk_state: String(input.gate.gateInput.risk_state ?? "paused"),
  target_domain: input.gate.consumerGateResult.target_domain,
  target_tab_id: input.gate.consumerGateResult.target_tab_id,
  target_page: input.gate.consumerGateResult.target_page,
  action_type: input.gate.consumerGateResult.action_type,
  requested_execution_mode: input.gate.consumerGateResult.requested_execution_mode,
  effective_execution_mode: input.gate.consumerGateResult.effective_execution_mode,
  gate_decision: input.gate.consumerGateResult.gate_decision,
  gate_reasons: input.gate.consumerGateResult.gate_reasons,
  approver: input.gate.approvalRecord.approver,
  approved_at: input.gate.approvalRecord.approved_at,
  write_interaction_tier: input.gate.writeActionMatrixDecisions?.write_interaction_tier ?? null,
  write_action_matrix_decisions: input.gate.writeActionMatrixDecisions,
  recorded_at: "2026-03-23T10:00:00.000Z"
});

const buildLoopbackGateObservability = (
  gate: ReturnType<typeof buildLoopbackGate>
): Record<string, unknown> => {
  const targetPage = asString(gate.gateInput.target_page);
  const targetDomain = asString(gate.gateInput.target_domain);

  return {
    page_state:
      targetPage && targetDomain
        ? {
            page_kind: targetPage === "creator_publish_tab" ? "compose" : targetPage,
            url:
              targetPage === "creator_publish_tab"
                ? `https://${targetDomain}/publish/publish`
                : targetPage === "search_result_tab"
                  ? `https://${targetDomain}/search_result`
                  : `https://${targetDomain}/`,
            title: targetPage === "creator_publish_tab" ? "Creator Publish" : "Search Result",
            ready_state: "complete"
          }
        : null,
    key_requests: [],
    failure_site:
      gate.consumerGateResult.gate_decision === "blocked"
        ? {
            stage: "execution",
            component: "gate",
            target: targetPage ?? targetDomain ?? "issue_208_gate_only",
            summary:
              Array.isArray(gate.consumerGateResult.gate_reasons) &&
              typeof gate.consumerGateResult.gate_reasons[0] === "string"
                ? gate.consumerGateResult.gate_reasons[0]
                : "gate blocked"
          }
        : null
  };
};

export interface LoopbackXhsSearchGateBundle {
  consumerGateResult: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export const buildLoopbackXhsSearchGateBundle = (input: {
  options: Record<string, unknown>;
  abilityAction: string | null;
  runId: string;
  sessionId: string;
  profile: string;
}): LoopbackXhsSearchGateBundle => {
  const gate = buildLoopbackGate(input.options, input.abilityAction);
  const auditRecord = buildLoopbackAuditRecord({
    runId: input.runId,
    sessionId: input.sessionId,
    profile: input.profile,
    gate
  });
  const riskTransitionAudit = buildRiskTransitionAudit({
    runId: input.runId,
    sessionId: input.sessionId,
    issueScope: resolveLoopbackIssueScope(gate.gateInput.issue_scope),
    prevState: resolveLoopbackRiskState(gate.gateInput.risk_state),
    decision: gate.consumerGateResult.gate_decision === "allowed" ? "allowed" : "blocked",
    gateReasons: Array.isArray(gate.consumerGateResult.gate_reasons)
      ? gate.consumerGateResult.gate_reasons.map((item) => String(item))
      : [],
    requestedExecutionMode: asString(gate.gateInput.requested_execution_mode),
    approvalRecord: gate.approvalRecord,
    auditRecords: [auditRecord],
    now: String(auditRecord.recorded_at ?? "")
  });
  const resolvedRiskState = resolveLoopbackRiskState(riskTransitionAudit.next_state);
  const resolvedIssueActionMatrix = resolveLoopbackIssueActionMatrixEntry(
    resolveLoopbackIssueScope(gate.gateInput.issue_scope),
    resolvedRiskState
  );
  const persistedAuditRecord: Record<string, unknown> = {
    ...auditRecord,
    next_state: riskTransitionAudit.next_state,
    transition_trigger: riskTransitionAudit.trigger
  };

  return {
    consumerGateResult: gate.consumerGateResult,
    payload: {
      plugin_gate_ownership: LOOPBACK_PLUGIN_GATE_OWNERSHIP,
      scope_context: gate.scopeContext,
      gate_input: {
        run_id: input.runId,
        session_id: input.sessionId,
        profile: input.profile,
        ...gate.gateInput
      },
      gate_outcome: gate.gateOutcome,
      consumer_gate_result: gate.consumerGateResult,
      approval_record: gate.approvalRecord,
      issue_action_matrix: resolvedIssueActionMatrix,
      write_interaction_tier: gate.writeInteractionTier,
      write_action_matrix_decisions: gate.writeActionMatrixDecisions,
      observability: buildLoopbackGateObservability(gate),
      read_execution_policy: gate.readExecutionPolicy,
      risk_state_output: buildUnifiedRiskStateOutput(resolvedRiskState, {
        auditRecords: [persistedAuditRecord],
        now: String(persistedAuditRecord.recorded_at ?? "")
      }),
      audit_record: persistedAuditRecord,
      risk_transition_audit: riskTransitionAudit
    }
  };
};
