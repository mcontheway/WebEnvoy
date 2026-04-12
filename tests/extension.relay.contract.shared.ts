import { describe, expect, it } from "vitest";

import { BackgroundRelay } from "../extension/background.js";
import { ContentScriptHandler } from "../extension/content-script-handler.js";

type BridgeResponse = {
  id: string;
  status: "success" | "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null | { code: string; message: string };
};

const waitForResponse = (relay: BackgroundRelay, timeoutMs = 500): Promise<BridgeResponse> =>
  new Promise((resolve, reject) => {
    const off = relay.onNativeMessage((message) => {
      off();
      clearTimeout(timer);
      resolve(message);
    });
    const timer = setTimeout(() => {
      off();
      reject(new Error("did not receive relay response in time"));
    }, timeoutMs);
  });

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const resolveWriteInteractionTier = (payload: Record<string, unknown>): string | null => {
  const direct = payload.write_interaction_tier;
  if (typeof direct === "string") {
    return direct;
  }
  const consumerGateResult = asRecord(payload.consumer_gate_result);
  if (typeof consumerGateResult?.write_interaction_tier === "string") {
    return consumerGateResult.write_interaction_tier;
  }
  const writeActionMatrix = asRecord(payload.write_action_matrix);
  if (typeof writeActionMatrix?.write_interaction_tier === "string") {
    return writeActionMatrix.write_interaction_tier;
  }
  const writeActionMatrixDecisions = asRecord(payload.write_action_matrix_decisions);
  if (typeof writeActionMatrixDecisions?.write_interaction_tier === "string") {
    return writeActionMatrixDecisions.write_interaction_tier;
  }
  return null;
};

const completeIssue208ApprovalRecord = {
  approved: true,
  approver: "qa-reviewer",
  approved_at: "2026-03-23T10:00:00Z",
  checks: {
    target_domain_confirmed: true,
    target_tab_confirmed: true,
    target_page_confirmed: true,
    risk_state_checked: true,
    action_type_confirmed: true
  }
} as const;

const createAttestedEditorInputValidationResult = (text: string) => ({
  ok: true,
  mode: "controlled_editor_input_validation" as const,
  attestation: "controlled_real_interaction" as const,
  editor_locator: "div.tiptap.ProseMirror",
  input_text: text,
  before_text: "",
  visible_text: text,
  post_blur_text: text,
  focus_confirmed: true,
  focus_attestation_source: "chrome_debugger",
  focus_attestation_reason: null,
  preserved_after_blur: true,
  success_signals: ["editable_state_entered", "editor_focus_attested", "text_visible", "text_persisted_after_blur"],
  failure_signals: [] as string[],
  minimum_replay: ["enter_editable_mode", "focus_editor", "type_short_text", "blur_or_reobserve"]
});

const approvedLiveOptions = {
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  approval: {
    approved: true,
    approver: "reviewer-a",
    approved_at: "2026-03-23T08:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    }
  },
  audit_record: {
    event_id: "gate_evt_relay_contract_live_high_risk_allowed_001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "search_result_tab",
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    gate_decision: "allowed",
    recorded_at: "2026-03-23T08:00:30Z"
  }
};

const approvedLimitedLiveOptions = {
  ...approvedLiveOptions,
  requested_execution_mode: "live_read_limited",
  risk_state: "limited"
};

const approvedHighRiskLimitedOptions = {
  ...approvedLiveOptions,
  risk_state: "limited"
};


Object.assign(globalThis as Record<string, unknown>, {
  __webenvoyExtensionRelayContract: {
    describe,
    expect,
    it,
    BackgroundRelay,
    ContentScriptHandler,
    waitForResponse,
    asRecord,
    resolveWriteInteractionTier,
    approvedLiveOptions,
    approvedLimitedLiveOptions,
    approvedHighRiskLimitedOptions,
    completeIssue208ApprovalRecord,
    createAttestedEditorInputValidationResult
  }
});

export {};
