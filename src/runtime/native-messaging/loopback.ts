import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope, type BridgeRequestEnvelope, type BridgeResponseEnvelope } from "./protocol.js";
import type { NativeBridgeTransport } from "./transport.js";

type HostMessage =
  | { kind: "request"; envelope: BridgeRequestEnvelope }
  | { kind: "response"; envelope: BridgeResponseEnvelope };

type ContentMessage =
  | {
      kind: "forward";
      id: string;
      command: string;
      commandParams: Record<string, unknown>;
      runId: string;
      sessionId: string;
    }
  | {
      kind: "result";
      id: string;
      ok: boolean;
      payload?: Record<string, unknown>;
      error?: { code: string; message: string };
    };

const RELAY_PATH = "host>background>content-script>background>host";
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const XHS_ALLOWED_DOMAINS = new Set([XHS_READ_DOMAIN, XHS_WRITE_DOMAIN]);
type LoopbackActionType = "read" | "write" | "irreversible_write";
type LoopbackExecutionMode =
  | "dry_run"
  | "recon"
  | "live_read_limited"
  | "live_read_high_risk"
  | "live_write";
type LoopbackEffectiveExecutionMode = LoopbackExecutionMode | null;
type LoopbackRiskState = "paused" | "limited" | "allowed";
type LoopbackIssueScope = "issue_208" | "issue_209";

interface LoopbackIssueActionMatrixEntry {
  issue_scope: LoopbackIssueScope;
  state: LoopbackRiskState;
  allowed_actions: string[];
  blocked_actions: string[];
}

const LOOPBACK_EXECUTION_MODES = new Set<LoopbackExecutionMode>([
  "dry_run",
  "recon",
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);
const LOOPBACK_RISK_STATES = new Set<LoopbackRiskState>(["paused", "limited", "allowed"]);
const LOOPBACK_ISSUE_SCOPES = new Set<LoopbackIssueScope>(["issue_208", "issue_209"]);
const LOOPBACK_ACTION_TYPES = new Set<LoopbackActionType>(["read", "write", "irreversible_write"]);
const LOOPBACK_REQUIRED_APPROVAL_CHECKS = [
  "target_domain_confirmed",
  "target_tab_confirmed",
  "target_page_confirmed",
  "risk_state_checked",
  "action_type_confirmed"
] as const;

const LOOPBACK_SCOPE_CONTEXT = {
  platform: "xhs",
  read_domain: XHS_READ_DOMAIN,
  write_domain: XHS_WRITE_DOMAIN,
  domain_mixing_forbidden: true
} as const;
const LOOPBACK_PLUGIN_GATE_OWNERSHIP = {
  background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
  content_script_gate: ["page_context_check", "action_tier_check"],
  main_world_gate: ["signed_call_scope_check"],
  cli_role: "request_and_result_shell_only"
} as const;
const LOOPBACK_RISK_STATE_MACHINE = {
  states: ["paused", "limited", "allowed"],
  transitions: [
    { from: "allowed", to: "limited", trigger: "risk_signal_detected" },
    { from: "limited", to: "paused", trigger: "account_alert_or_repeat_risk" },
    {
      from: "paused",
      to: "limited",
      trigger: "cooldown_backoff_window_passed_and_manual_approve"
    },
    {
      from: "limited",
      to: "allowed",
      trigger: "stability_window_passed_and_manual_approve"
    }
  ],
  hard_block_when_paused: ["live_write", "live_read_high_risk"]
} as const;
const LOOPBACK_ISSUE_ACTION_MATRIX: LoopbackIssueActionMatrixEntry[] = [
  {
    issue_scope: "issue_208",
    state: "paused",
    allowed_actions: ["dry_run", "recon"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "reversible_interaction_with_approval",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_208",
    state: "limited",
    allowed_actions: ["dry_run", "recon", "reversible_interaction_with_approval"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "irreversible_write",
      "live_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_208",
    state: "allowed",
    allowed_actions: ["dry_run", "recon", "reversible_interaction_with_approval"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "irreversible_write",
      "live_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "paused",
    allowed_actions: ["dry_run", "recon"],
    blocked_actions: [
      "live_read_limited",
      "live_read_high_risk",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "limited",
    allowed_actions: ["dry_run", "recon", "live_read_limited"],
    blocked_actions: [
      "live_read_high_risk",
      "live_write",
      "irreversible_write",
      "expand_new_live_surface_without_gate"
    ]
  },
  {
    issue_scope: "issue_209",
    state: "allowed",
    allowed_actions: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    blocked_actions: ["live_write", "irreversible_write", "expand_new_live_surface_without_gate"]
  }
];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const asInteger = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const asBoolean = (value: unknown): boolean => value === true;

const resolveLoopbackActionType = (options: Record<string, unknown>): LoopbackActionType | null => {
  const explicit = asString(options.action_type);
  if (explicit && LOOPBACK_ACTION_TYPES.has(explicit as LoopbackActionType)) {
    return explicit as LoopbackActionType;
  }
  return null;
};

const resolveLoopbackExecutionMode = (value: unknown): LoopbackExecutionMode | null =>
  typeof value === "string" && LOOPBACK_EXECUTION_MODES.has(value as LoopbackExecutionMode)
    ? (value as LoopbackExecutionMode)
    : null;

const resolveLoopbackRiskState = (value: unknown): LoopbackRiskState =>
  typeof value === "string" && LOOPBACK_RISK_STATES.has(value as LoopbackRiskState)
    ? (value as LoopbackRiskState)
    : "paused";

const resolveLoopbackIssueScope = (value: unknown): LoopbackIssueScope =>
  typeof value === "string" && LOOPBACK_ISSUE_SCOPES.has(value as LoopbackIssueScope)
    ? (value as LoopbackIssueScope)
    : "issue_209";

const resolveLoopbackIssueActionMatrixEntry = (
  issueScope: LoopbackIssueScope,
  riskState: LoopbackRiskState
): LoopbackIssueActionMatrixEntry => {
  const matched = LOOPBACK_ISSUE_ACTION_MATRIX.find(
    (entry) => entry.issue_scope === issueScope && entry.state === riskState
  );
  if (!matched) {
    return {
      issue_scope: issueScope,
      state: riskState,
      allowed_actions: ["dry_run", "recon"],
      blocked_actions: ["expand_new_live_surface_without_gate"]
    };
  }
  return {
    issue_scope: matched.issue_scope,
    state: matched.state,
    allowed_actions: [...matched.allowed_actions],
    blocked_actions: [...matched.blocked_actions]
  };
};

const resolveLoopbackFallbackMode = (
  requestedExecutionMode: LoopbackExecutionMode,
  riskState: LoopbackRiskState
): LoopbackExecutionMode => {
  if (requestedExecutionMode === "live_write") {
    return "dry_run";
  }
  return riskState === "limited" ? "recon" : "dry_run";
};

const resolveLoopbackRecoveryRequirements = (state: LoopbackRiskState): string[] => {
  switch (state) {
    case "paused":
      return [
        "cooldown_backoff_window_passed_and_manual_approve",
        "risk_state_checked",
        "audit_record_present"
      ];
    case "limited":
      return [
        "stability_window_passed_and_manual_approve",
        "risk_state_checked",
        "audit_record_present"
      ];
    case "allowed":
      return ["manual_confirmation_recorded", "target_scope_confirmed", "audit_record_present"];
    default:
      return ["audit_record_present"];
  }
};

const buildLoopbackGate = (
  options: Record<string, unknown>,
  abilityAction: string | null
): {
  scopeContext: Record<string, unknown>;
  issueScope: LoopbackIssueScope;
  issueActionMatrix: LoopbackIssueActionMatrixEntry;
  gateInput: Record<string, unknown>;
  gateOutcome: Record<string, unknown>;
  consumerGateResult: Record<string, unknown>;
  approvalRecord: Record<string, unknown>;
} => {
  const requestedExecutionMode = resolveLoopbackExecutionMode(options.requested_execution_mode);
  const riskState = resolveLoopbackRiskState(options.risk_state);
  const issueScope = resolveLoopbackIssueScope(options.issue_scope);
  const issueActionMatrix = resolveLoopbackIssueActionMatrixEntry(issueScope, riskState);
  const actionType = resolveLoopbackActionType(options);
  const targetDomain = asString(options.target_domain);
  const targetTabId = asInteger(options.target_tab_id);
  const targetPage = asString(options.target_page);
  const approvalRecord = asRecord(options.approval_record) ?? asRecord(options.approval) ?? {};
  const approvalChecks = asRecord(approvalRecord.checks) ?? {};
  const gateReasons: string[] = [];
  let effectiveExecutionMode: LoopbackEffectiveExecutionMode = requestedExecutionMode;
  let gateDecision: "allowed" | "blocked" = "allowed";

  if (!targetDomain) {
    gateReasons.push("TARGET_DOMAIN_NOT_EXPLICIT");
  } else if (!XHS_ALLOWED_DOMAINS.has(targetDomain)) {
    gateReasons.push("TARGET_DOMAIN_OUT_OF_SCOPE");
  }
  if (targetTabId === null || targetTabId <= 0) {
    gateReasons.push("TARGET_TAB_NOT_EXPLICIT");
  }
  if (!targetPage) {
    gateReasons.push("TARGET_PAGE_NOT_EXPLICIT");
  }
  if (!actionType) {
    gateReasons.push("ACTION_TYPE_NOT_EXPLICIT");
  }
  if (!requestedExecutionMode) {
    gateReasons.push("REQUESTED_EXECUTION_MODE_NOT_EXPLICIT");
  }
  if (abilityAction && actionType && abilityAction !== actionType) {
    gateReasons.push("ABILITY_ACTION_CONTEXT_MISMATCH");
  } else if (actionType && actionType !== "read") {
    gateReasons.push("ACTION_TYPE_UNSUPPORTED_FOR_COMMAND");
  }
  if (requestedExecutionMode === "live_write" && actionType === "irreversible_write") {
    gateReasons.push("IRREVERSIBLE_WRITE_NOT_ALLOWED");
  }
  if (requestedExecutionMode === "live_write") {
    gateReasons.push("EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND");
  }
  if (targetDomain === XHS_WRITE_DOMAIN && actionType === "read") {
    gateReasons.push("ACTION_DOMAIN_MISMATCH");
  }
  if (targetDomain === XHS_READ_DOMAIN && actionType !== "read") {
    gateReasons.push("ACTION_DOMAIN_MISMATCH");
  }

  if (gateReasons.length > 0) {
    gateDecision = "blocked";
    if (
      requestedExecutionMode === "live_read_limited" ||
      requestedExecutionMode === "live_read_high_risk" ||
      requestedExecutionMode === "live_write"
    ) {
      effectiveExecutionMode = resolveLoopbackFallbackMode(requestedExecutionMode, riskState);
    }
  } else if (requestedExecutionMode === "dry_run" || requestedExecutionMode === "recon") {
    gateReasons.push(
      requestedExecutionMode === "recon" ? "DEFAULT_MODE_RECON" : "DEFAULT_MODE_DRY_RUN"
    );
  } else {
    gateDecision = "blocked";
    effectiveExecutionMode = resolveLoopbackFallbackMode(requestedExecutionMode ?? "dry_run", riskState);

    if (requestedExecutionMode === "live_read_high_risk" && actionType !== "read") {
      gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
    }
    if (requestedExecutionMode === "live_read_limited" && actionType !== "read") {
      gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
    }
    if (requestedExecutionMode === "live_write" && actionType === "read") {
      gateReasons.push("ACTION_TYPE_MODE_MISMATCH");
    }
    if (
      requestedExecutionMode &&
      issueActionMatrix.blocked_actions.includes(requestedExecutionMode) &&
      (requestedExecutionMode === "live_read_limited" ||
        requestedExecutionMode === "live_read_high_risk")
    ) {
      gateReasons.push(`RISK_STATE_${riskState.toUpperCase()}`);
      gateReasons.push("ISSUE_ACTION_MATRIX_BLOCKED");
    }

    const liveModeCanEnter =
      requestedExecutionMode !== null &&
      issueActionMatrix.allowed_actions.includes(requestedExecutionMode) &&
      (requestedExecutionMode === "live_read_limited" ||
        requestedExecutionMode === "live_read_high_risk");

    if (liveModeCanEnter) {
      if (
        approvalRecord.approved !== true ||
        !asString(approvalRecord.approver) ||
        !asString(approvalRecord.approved_at)
      ) {
        gateReasons.push("MANUAL_CONFIRMATION_MISSING");
      }

      const missingChecks = LOOPBACK_REQUIRED_APPROVAL_CHECKS.filter(
        (key) => !asBoolean(approvalChecks[key])
      );
      if (missingChecks.length > 0) {
        gateReasons.push("APPROVAL_CHECKS_INCOMPLETE");
      }

      if (gateReasons.length === 0) {
        gateDecision = "allowed";
        effectiveExecutionMode = requestedExecutionMode;
        gateReasons.push("LIVE_MODE_APPROVED");
      }
    }
  }

  return {
    scopeContext: { ...LOOPBACK_SCOPE_CONTEXT },
    issueScope,
    issueActionMatrix,
    gateInput: {
      issue_scope: issueScope,
      target_domain: targetDomain,
      target_tab_id: targetTabId,
      target_page: targetPage,
      action_type: actionType,
      requested_execution_mode: requestedExecutionMode,
      risk_state: riskState
    },
    gateOutcome: {
      effective_execution_mode: effectiveExecutionMode,
      gate_decision: gateDecision,
      gate_reasons: gateReasons,
      requires_manual_confirmation:
        requestedExecutionMode === "live_read_limited" ||
        requestedExecutionMode === "live_read_high_risk" ||
        requestedExecutionMode === "live_write"
    },
    consumerGateResult: {
      risk_state: riskState,
      issue_scope: issueScope,
      target_domain: targetDomain,
      target_tab_id: targetTabId,
      target_page: targetPage,
      action_type: actionType,
      requested_execution_mode: requestedExecutionMode,
      effective_execution_mode: effectiveExecutionMode,
      gate_decision: gateDecision,
      gate_reasons: gateReasons
    },
    approvalRecord: {
      approved: approvalRecord.approved === true,
      approver: asString(approvalRecord.approver),
      approved_at: asString(approvalRecord.approved_at),
      checks: Object.fromEntries(
        LOOPBACK_REQUIRED_APPROVAL_CHECKS.map((key) => [key, asBoolean(approvalChecks[key])])
      )
    }
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
  recorded_at: "2026-03-23T10:00:00.000Z"
});

const buildLoopbackGatePayload = (input: {
  runId: string;
  sessionId: string;
  profile: string;
  gate: ReturnType<typeof buildLoopbackGate>;
  auditRecord: Record<string, unknown>;
}): Record<string, unknown> => ({
  plugin_gate_ownership: LOOPBACK_PLUGIN_GATE_OWNERSHIP,
  scope_context: input.gate.scopeContext,
  gate_input: {
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    ...input.gate.gateInput
  },
  gate_outcome: input.gate.gateOutcome,
  consumer_gate_result: input.gate.consumerGateResult,
  approval_record: input.gate.approvalRecord,
  issue_action_matrix: input.gate.issueActionMatrix,
  risk_state_output: {
    current_state: resolveLoopbackRiskState(input.gate.gateInput.risk_state),
    risk_state_machine: {
      states: [...LOOPBACK_RISK_STATE_MACHINE.states],
      transitions: LOOPBACK_RISK_STATE_MACHINE.transitions.map((transition) => ({ ...transition })),
      hard_block_when_paused: [...LOOPBACK_RISK_STATE_MACHINE.hard_block_when_paused]
    },
    issue_action_matrix: [
      resolveLoopbackIssueActionMatrixEntry("issue_208", resolveLoopbackRiskState(input.gate.gateInput.risk_state)),
      resolveLoopbackIssueActionMatrixEntry("issue_209", resolveLoopbackRiskState(input.gate.gateInput.risk_state))
    ],
    recovery_requirements: resolveLoopbackRecoveryRequirements(
      resolveLoopbackRiskState(input.gate.gateInput.risk_state)
    )
  },
  audit_record: input.auditRecord,
  risk_transition_audit: {
    run_id: input.runId,
    session_id: input.sessionId,
    issue_scope: String(input.gate.gateInput.issue_scope ?? "issue_209"),
    prev_state: String(input.gate.gateInput.risk_state ?? "paused"),
    next_state: String(input.gate.gateInput.risk_state ?? "paused"),
    trigger: "gate_evaluation",
    decision: String(input.gate.consumerGateResult.gate_decision ?? "blocked"),
    reason:
      Array.isArray(input.gate.consumerGateResult.gate_reasons) &&
      input.gate.consumerGateResult.gate_reasons.length > 0
        ? String(input.gate.consumerGateResult.gate_reasons[0])
        : "GATE_DECISION_RECORDED",
    approver: input.gate.approvalRecord.approver ?? null
  }
});

class InMemoryPort<TMessage> {
  #listeners = new Set<(message: TMessage) => void>();
  #peer: InMemoryPort<TMessage> | null = null;

  connect(peer: InMemoryPort<TMessage>): void {
    this.#peer = peer;
  }

  onMessage(listener: (message: TMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  postMessage(message: TMessage): void {
    const peer = this.#peer;
    if (!peer) {
      return;
    }

    queueMicrotask(() => {
      for (const listener of peer.#listeners) {
        listener(message);
      }
    });
  }
}

const createPortPair = <TMessage>(): [InMemoryPort<TMessage>, InMemoryPort<TMessage>] => {
  const left = new InMemoryPort<TMessage>();
  const right = new InMemoryPort<TMessage>();
  left.connect(right);
  right.connect(left);
  return [left, right];
};

class InMemoryContentScriptRuntime {
  constructor(private readonly port: InMemoryPort<ContentMessage>) {
    this.port.onMessage((message) => {
      if (message.kind !== "forward") {
        return;
      }

      this.port.postMessage(this.handleForward(message));
    });
  }

  private handleForward(message: Extract<ContentMessage, { kind: "forward" }>): ContentMessage {
    if (message.command === "runtime.ping") {
      return {
        kind: "result",
        id: message.id,
        ok: true,
        payload: {
          message: "pong"
        }
      };
    }

    if (message.command === "xhs.search") {
      const simulated =
        typeof message.commandParams.options === "object" &&
        message.commandParams.options !== null &&
        typeof (message.commandParams.options as Record<string, unknown>).simulate_result === "string"
          ? String((message.commandParams.options as Record<string, unknown>).simulate_result)
          : "success";
      const ability =
        typeof message.commandParams.ability === "object" && message.commandParams.ability !== null
          ? (message.commandParams.ability as Record<string, unknown>)
          : {};
      const input =
        typeof message.commandParams.input === "object" && message.commandParams.input !== null
          ? (message.commandParams.input as Record<string, unknown>)
          : {};
      const options =
        typeof message.commandParams.options === "object" && message.commandParams.options !== null
          ? (message.commandParams.options as Record<string, unknown>)
          : {};
      const gate = buildLoopbackGate(options, asString(ability.action));
      const consumerGateResult = gate.consumerGateResult;
      const auditRecord = buildLoopbackAuditRecord({
        runId: message.runId,
        sessionId: message.sessionId,
        profile: "loopback_profile",
        gate
      });
      const gateBundle = buildLoopbackGatePayload({
        runId: message.runId,
        sessionId: message.sessionId,
        profile: "loopback_profile",
        gate,
        auditRecord
      });
      if (consumerGateResult.gate_decision === "blocked") {
        return {
          kind: "result",
          id: message.id,
          ok: false,
          error: {
            code: "ERR_EXECUTION_FAILED",
            message: "执行模式门禁阻断了当前 xhs.search 请求"
          },
          payload: {
            details: {
              ability_id: String(ability.id ?? "xhs.note.search.v1"),
              stage: "execution",
              reason: "EXECUTION_MODE_GATE_BLOCKED"
            },
            ...gateBundle
          }
        };
      }
      if (
        consumerGateResult.effective_execution_mode === "dry_run" ||
        consumerGateResult.effective_execution_mode === "recon"
      ) {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "partial",
                data_ref: {
                  query: String(input.query ?? "")
                },
                metrics: {
                  count: 0
                }
              },
              ...gateBundle
            },
            observability: {
              page_state: {
                page_kind: "search",
                url: "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete"
              },
              key_requests: [],
              failure_site: null
            }
          }
        };
      }

      if (simulated === "success") {
        return {
          kind: "result",
          id: message.id,
          ok: true,
          payload: {
            summary: {
              capability_result: {
                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "success",
                data_ref: {
                  query: String(input.query ?? ""),
                  search_id: "loopback-search-id"
                },
                metrics: {
                  count: 2,
                  duration_ms: 12
                }
              },
              ...gateBundle
            },
            observability: {
              page_state: {
                page_kind: "search",
                url: "https://www.xiaohongshu.com/search_result",
                title: "Search Result",
                ready_state: "complete"
              },
              key_requests: [
                {
                  request_id: "req-loopback-001",
                  stage: "request",
                  method: "POST",
                  url: "/api/sns/web/v1/search/notes",
                  outcome: "completed",
                  status_code: 200
                }
              ],
              failure_site: null
            }
          }
        };
      }

      return {
        kind: "result",
        id: message.id,
        ok: false,
        error: {
          code: "ERR_EXECUTION_FAILED",
          message:
            simulated === "login_required"
              ? "登录态缺失，无法执行 xhs.search"
              : simulated === "account_abnormal"
                ? "账号异常，平台拒绝当前请求"
                : simulated === "browser_env_abnormal"
                  ? "浏览器环境异常，平台拒绝当前请求"
                  : simulated === "signature_entry_missing"
                    ? "页面签名入口不可用"
                    : "网关调用失败，当前上下文不足以完成搜索请求"
        },
        payload: {
          details: {
            ability_id: String(ability.id ?? "xhs.note.search.v1"),
            stage: "execution",
            reason:
              simulated === "login_required"
                ? "SESSION_EXPIRED"
                : simulated === "account_abnormal"
                  ? "ACCOUNT_ABNORMAL"
                  : simulated === "browser_env_abnormal"
                    ? "BROWSER_ENV_ABNORMAL"
                    : simulated === "signature_entry_missing"
                      ? "SIGNATURE_ENTRY_MISSING"
                      : "GATEWAY_INVOKER_FAILED"
          },
          ...gateBundle,
          observability: {
            page_state: {
              page_kind: simulated === "login_required" ? "login" : "search",
              url:
                simulated === "login_required"
                  ? "https://www.xiaohongshu.com/login"
                  : "https://www.xiaohongshu.com/search_result",
              title: "Search Result",
              ready_state: "complete"
            },
            key_requests: [
              {
                request_id: "req-loopback-001",
                stage: "request",
                method: "POST",
                url: "/api/sns/web/v1/search/notes",
                outcome: "failed",
                status_code:
                  simulated === "account_abnormal"
                    ? 461
                    : simulated === "browser_env_abnormal"
                      ? 200
                      : simulated === "gateway_invoker_failed"
                        ? 500
                        : undefined,
                failure_reason: simulated
              }
            ],
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "execution" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            }
          },
          diagnosis: {
            category: simulated === "signature_entry_missing" ? "page_changed" : "request_failed",
            stage: simulated === "signature_entry_missing" ? "execution" : "request",
            component: simulated === "signature_entry_missing" ? "page" : "network",
            failure_site: {
              stage: simulated === "signature_entry_missing" ? "execution" : "request",
              component: simulated === "signature_entry_missing" ? "page" : "network",
              target:
                simulated === "signature_entry_missing"
                  ? "window._webmsxyw"
                  : "/api/sns/web/v1/search/notes",
              summary: simulated
            },
            evidence: [simulated]
          }
        }
      };
    }

    return {
      kind: "result",
      id: message.id,
      ok: true,
      payload: {
        message: "pong"
      }
    };
  }
}

class InMemoryBackgroundRelay {
  #pendingForward = new Map<
    string,
    {
      request: BridgeRequestEnvelope;
      gatePayload?: Record<string, unknown>;
    }
  >();
  #sessionId = "nm-session-001";

  constructor(
    private readonly hostPort: InMemoryPort<HostMessage>,
    private readonly contentPort: InMemoryPort<ContentMessage>
  ) {
    this.hostPort.onMessage((message) => {
      if (message.kind !== "request") {
        return;
      }

      this.handleHostRequest(message.envelope);
    });

    this.contentPort.onMessage((message) => {
      if (message.kind !== "result") {
        return;
      }

      this.handleContentResult(message);
    });
  }

  private handleHostRequest(request: BridgeRequestEnvelope): void {
    ensureBridgeRequestEnvelope(request);

    if (request.method === "bridge.open") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            protocol: BRIDGE_PROTOCOL,
            session_id: this.#sessionId,
            state: "ready",
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "__ping__") {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "success",
          summary: {
            session_id: this.#sessionId,
            relay_path: RELAY_PATH
          },
          error: null
        }
      });
      return;
    }

    if (request.method === "bridge.forward") {
      const command = String(request.params.command ?? "");
      const commandParams =
        typeof request.params.command_params === "object" && request.params.command_params !== null
          ? (request.params.command_params as Record<string, unknown>)
          : {};
      const runId = String(request.params.run_id ?? request.id);
      const sessionId = String(request.params.session_id ?? this.#sessionId);
      let gatePayload: Record<string, unknown> | undefined;

      if (command === "xhs.search") {
        const ability =
          typeof commandParams.ability === "object" && commandParams.ability !== null
            ? (commandParams.ability as Record<string, unknown>)
            : {};
        const options =
          typeof commandParams.options === "object" && commandParams.options !== null
            ? (commandParams.options as Record<string, unknown>)
            : {};
        const gate = buildLoopbackGate(options, asString(ability.action));
        const auditRecord = buildLoopbackAuditRecord({
          runId,
          sessionId,
          profile: "loopback_profile",
          gate
        });
        gatePayload = buildLoopbackGatePayload({
          runId,
          sessionId,
          profile: "loopback_profile",
          gate,
          auditRecord
        });
        const consumerGateResult = asRecord(gatePayload.consumer_gate_result);
        if (consumerGateResult?.gate_decision === "blocked") {
          this.hostPort.postMessage({
            kind: "response",
            envelope: {
              id: request.id,
              status: "error",
              summary: {
                relay_path: RELAY_PATH
              },
              payload: {
                details: {
                  ability_id: String(ability.id ?? "xhs.note.search.v1"),
                  stage: "execution",
                  reason: "EXECUTION_MODE_GATE_BLOCKED"
                },
                ...gatePayload
              },
              error: {
                code: "ERR_EXECUTION_FAILED",
                message: "执行模式门禁阻断了当前 xhs.search 请求"
              }
            }
          });
          return;
        }
      }

      this.#pendingForward.set(request.id, { request, gatePayload });
      this.contentPort.postMessage({
        kind: "forward",
        id: request.id,
        command,
        commandParams,
        runId,
        sessionId
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_TRANSPORT_FORWARD_FAILED",
          message: `unknown method: ${request.method}`
        }
      }
    });
  }

  private handleContentResult(result: Extract<ContentMessage, { kind: "result" }>): void {
    const pending = this.#pendingForward.get(result.id);
    if (!pending) {
      return;
    }
    this.#pendingForward.delete(result.id);

    const request = pending.request;
    const payload =
      typeof result.payload === "object" && result.payload !== null
        ? { ...(result.payload as Record<string, unknown>) }
        : {};
    const summary =
      typeof payload.summary === "object" && payload.summary !== null
        ? (payload.summary as Record<string, unknown>)
        : null;
    if (pending.gatePayload) {
      for (const [key, value] of Object.entries(pending.gatePayload)) {
        const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
        const hasInSummary =
          summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
        if (!hasInPayload && !hasInSummary) {
          if (summary !== null) {
            summary[key] = value;
          } else {
            payload[key] = value;
          }
        }
      }
    }

    if (!result.ok) {
      this.hostPort.postMessage({
        kind: "response",
        envelope: {
          id: request.id,
          status: "error",
          summary: {
            relay_path: RELAY_PATH
          },
          payload,
          error: result.error ?? {
            code: "ERR_TRANSPORT_FORWARD_FAILED",
            message: "content script failed"
          }
        }
      });
      return;
    }

    this.hostPort.postMessage({
      kind: "response",
      envelope: {
        id: request.id,
        status: "success",
        summary: {
          session_id: String(request.params.session_id ?? this.#sessionId),
          run_id: String(request.params.run_id ?? request.id),
          command: String(request.params.command ?? "runtime.ping"),
          relay_path: RELAY_PATH
        },
        payload,
        error: null
      }
    });
  }
}

class InMemoryHostTransport implements NativeBridgeTransport {
  #pending = new Map<
    string,
    {
      resolve: (response: BridgeResponseEnvelope) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(private readonly hostPort: InMemoryPort<HostMessage>) {
    this.hostPort.onMessage((message) => {
      if (message.kind !== "response") {
        return;
      }

      const pending = this.#pending.get(message.envelope.id);
      if (!pending) {
        return;
      }

      this.#pending.delete(message.envelope.id);
      pending.resolve(message.envelope);
    });
  }

  open(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  forward(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  heartbeat(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    return this.request(request);
  }

  private request(request: BridgeRequestEnvelope): Promise<BridgeResponseEnvelope> {
    ensureBridgeRequestEnvelope(request);
    return new Promise<BridgeResponseEnvelope>((resolve, reject) => {
      this.#pending.set(request.id, { resolve, reject });
      this.hostPort.postMessage({
        kind: "request",
        envelope: request
      });
    });
  }
}

export const createLoopbackNativeBridgeTransport = (): NativeBridgeTransport => {
  const [hostPort, backgroundHostPort] = createPortPair<HostMessage>();
  const [backgroundContentPort, contentPort] = createPortPair<ContentMessage>();

  new InMemoryContentScriptRuntime(contentPort);
  new InMemoryBackgroundRelay(backgroundHostPort, backgroundContentPort);

  return new InMemoryHostTransport(hostPort);
};

export const loopbackRelayPath = (): string => RELAY_PATH;
