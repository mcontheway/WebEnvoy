import { describe, expect, it } from "vitest";

import { BackgroundRelay } from "../extension/background.js";
import { ContentScriptHandler } from "../extension/content-script-handler.js";

export type BridgeResponse = {
  id: string;
  status: "success" | "error";
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  error: null | { code: string; message: string };
};

export const waitForResponse = (relay: BackgroundRelay, timeoutMs = 500): Promise<BridgeResponse> =>
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

export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const resolveWriteInteractionTier = (payload: Record<string, unknown>): string | null => {
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

export const completeIssue208ApprovalRecord = {
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

export const createApprovedReadAdmissionContext = (input?: {
  run_id?: string;
  request_id?: string;
  session_id?: string;
  decision_id?: string;
  approval_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_limited" | "live_read_high_risk";
  risk_state?: "limited" | "allowed";
}) => {
  const runId = input?.run_id ?? "run-relay-001";
  const requestId = input?.request_id;
  const decisionId = input?.decision_id;
  const approvalId = input?.approval_id;
  const refSuffix = requestId ? `${runId}_${requestId}` : runId;
  return ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: runId,
    session_id: input?.session_id ?? "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 32,
    target_page: input?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input?.requested_execution_mode ?? "live_read_high_risk",
    approved: true,
    approver: "reviewer-a",
    approved_at: "2026-03-23T08:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T08:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: runId,
    session_id: input?.session_id ?? "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 32,
    target_page: input?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input?.requested_execution_mode ?? "live_read_high_risk",
    risk_state: input?.risk_state ?? "allowed",
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T08:00:30Z"
  }
} as const);
};

export const createIssue209GateInvocationId = (runId: string, suffix = "default") =>
  `issue209-gate-${runId}-${suffix}`;

export const approvedLiveOptions = {
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
  }
} as const;

export const approvedLimitedLiveOptions = {
  ...approvedLiveOptions,
  requested_execution_mode: "live_read_limited",
  risk_state: "limited"
} as const;

export const approvedHighRiskLimitedOptions = {
  ...approvedLiveOptions,
  risk_state: "limited"
} as const;

export const createAttestedEditorInputValidationResult = (text: string) => ({
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

export const createCapturedSearchRequestContextReader = (input?: {
  capturedAt?: number;
  observedAt?: number;
  searchId?: string;
  referrer?: string;
}) => {
  return async (lookup: {
    page_context_namespace: string;
    shape_key: string;
  }) => {
    let shape: Record<string, unknown> | null = null;
    try {
      shape = JSON.parse(lookup.shape_key) as Record<string, unknown>;
    } catch {
      shape = null;
    }
    const keyword = typeof shape?.keyword === "string" ? shape.keyword : "露营装备";
    const page = typeof shape?.page === "number" ? shape.page : 1;
    const pageSize = typeof shape?.page_size === "number" ? shape.page_size : 20;
    const sort = typeof shape?.sort === "string" ? shape.sort : "general";
    const noteType = typeof shape?.note_type === "number" ? shape.note_type : 0;
    const pageContextNamespace =
      lookup.page_context_namespace || "https://www.xiaohongshu.com/search_result";
    return {
      page_context_namespace: pageContextNamespace,
      shape_key: lookup.shape_key,
      admitted_template: {
        source_kind: "page_request",
        transport: "fetch",
        method: "POST",
        path: "/api/sns/web/v1/search/notes",
        url: "https://www.xiaohongshu.com/api/sns/web/v1/search/notes",
        status: 200,
        captured_at: input?.capturedAt ?? 900,
        observed_at: input?.observedAt ?? 900,
        page_context_namespace: pageContextNamespace,
        shape_key: lookup.shape_key,
        shape: {
          command: "xhs.search",
          method: "POST",
          pathname: "/api/sns/web/v1/search/notes",
          keyword,
          page,
          page_size: pageSize,
          sort,
          note_type: noteType
        },
        referrer:
          input?.referrer ?? "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5%E8%A3%85%E5%A4%87",
        template_ready: true,
        request_status: {
          completion: "completed",
          http_status: 200
        },
        request: {
          headers: {
            accept: "application/json, text/plain, */*",
            "content-type": "application/json;charset=utf-8",
            "X-S-Common": "{}",
            "x-s": "signed-template",
            "x-t": "1700000000"
          },
          body: {
            keyword,
            page,
            page_size: pageSize,
            search_id: input?.searchId ?? "captured-search-id",
            sort,
            note_type: noteType
          }
        }
      },
      rejected_observation: null,
      incompatible_observation: null,
      available_shape_keys: [lookup.shape_key]
    };
  };
};

export { BackgroundRelay, ContentScriptHandler };
