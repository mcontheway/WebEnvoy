import { describe, expect, it } from "vitest";
import {
  buildIssue209PostGateArtifacts,
  evaluateXhsGate,
  evaluateXhsGateCore,
  resolveXhsGateDecisionId
} from "../shared/xhs-gate.js";
import { resolveActualTargetGateReasons, resolveGate } from "../extension/xhs-search-gate.js";
import {
  validateIssue209AuditSourceAgainstCurrentLinkage
} from "../shared/issue209-live-read/source-validation.js";
import { buildLoopbackGate } from "../src/runtime/native-messaging/loopback-gate.js";
import { buildLoopbackGatePayload } from "../src/runtime/native-messaging/loopback-gate-payload.js";
import { ensureIssue209AdmissionContextForContract } from "../src/commands/xhs-input.js";

const createAdmissionContext = (input?: {
  run_id?: string;
  request_id?: string;
  decision_id?: string;
  approval_id?: string;
  session_id?: string;
  target_tab_id?: number;
  target_page?: string;
  requested_execution_mode?: "live_read_high_risk" | "live_read_limited";
  risk_state?: "allowed" | "limited";
}) => {
  const runId = input?.run_id ?? "run-extension-001";
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
    session_id: input?.session_id ?? "session-extension-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 12,
    target_page: input?.target_page ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input?.requested_execution_mode ?? "live_read_high_risk",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00.000Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00.000Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${refSuffix}`,
    ...(decisionId ? { decision_id: decisionId } : {}),
    ...(approvalId ? { approval_id: approvalId } : {}),
    ...(requestId ? { request_id: requestId } : {}),
    run_id: runId,
    session_id: input?.session_id ?? "session-extension-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input?.target_tab_id ?? 12,
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
    recorded_at: "2026-03-23T10:00:30.000Z"
  }
});
};

const createApprovalRecord = (decisionId: string, approvalId: string) => ({
  approval_id: approvalId,
  decision_id: decisionId,
  approved: true,
  approver: "qa-reviewer",
  approved_at: "2026-03-23T10:00:00.000Z",
  checks: {
    target_domain_confirmed: true,
    target_tab_confirmed: true,
    target_page_confirmed: true,
    risk_state_checked: true,
    action_type_confirmed: true
  }
});

type AuditRecordOptions = {
  decisionId: string;
  approvalId: string;
  targetTabId: number;
  targetPage: string;
  requestedExecutionMode: "live_read_high_risk" | "live_read_limited";
  auditedChecks?: Record<string, boolean>;
  overrides?: Record<string, unknown>;
};

const defaultAuditChecks = {
  target_domain_confirmed: true,
  target_tab_confirmed: true,
  target_page_confirmed: true,
  risk_state_checked: true,
  action_type_confirmed: true
};

const createAuditRecord = (input: AuditRecordOptions) => ({
  event_id: `audit-${input.decisionId}`,
  decision_id: input.decisionId,
  approval_id: input.approvalId,
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: input.targetTabId,
  target_page: input.targetPage,
  action_type: "read",
  requested_execution_mode: input.requestedExecutionMode,
  gate_decision: "allowed",
  audited_checks: input.auditedChecks ?? defaultAuditChecks,
  recorded_at: "2026-03-23T10:00:30.000Z",
  ...input.overrides
});

const createIssue209InvocationLinkage = (runId: string, suffix: string) => {
  const gateInvocationId = `issue209-gate-${runId}-${suffix}`;
  const decisionId = `gate_decision_${gateInvocationId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return { gateInvocationId, decisionId, approvalId };
};

const buildAuditValidationContext = () => {
  const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
    "run-extension-audit-validation-001",
    "audit-validation-001"
  );
  return {
    commandRequestId: "issue209-live-req-1",
    gateInvocationId,
    decisionId,
    approvalId,
    issueScope: "issue_209",
    targetDomain: "www.xiaohongshu.com",
    targetTabId: 12,
    targetPage: "search_result_tab",
    actionType: "read",
    requestedExecutionMode: "live_read_high_risk",
    riskState: "allowed"
  };
};

const createUpstreamAuthorizationRequest = (input?: {
  resourceKind?: "anonymous_context" | "profile_session";
  profileRef?: string | null;
  allowedResourceKinds?: string[];
  allowedProfileRefs?: string[];
  allowedActions?: string[];
  allowedDomains?: string[];
  allowedPages?: string[];
  approvalRefs?: unknown[];
  auditRefs?: unknown[];
  actionName?: string;
  actionCategory?: "read" | "write" | "irreversible_write";
  resourceStateSnapshot?: "active" | "cool_down" | "paused";
  requestedAt?: string | null;
  grantedAt?: string | null;
  domain?: string;
  page?: string;
  tabId?: number;
  url?: string;
  anonymousRequired?: boolean;
  reuseLoggedInContextForbidden?: boolean;
}) => {
  const resourceKind = input?.resourceKind ?? "anonymous_context";
  const profileRef =
    resourceKind === "profile_session" ? (input?.profileRef ?? "profile-session-001") : null;
  const requestedAt =
    input?.requestedAt === undefined ? "2026-04-15T09:00:00.000Z" : input.requestedAt;
  const grantedAt = input?.grantedAt === undefined ? requestedAt : input.grantedAt;

  return {
    action_request: {
      request_ref: "upstream_req_gate_001",
      action_name: input?.actionName ?? "xhs.read_search_results",
      action_category: input?.actionCategory ?? "read",
      ...(requestedAt ? { requested_at: requestedAt } : {})
    },
    resource_binding: {
      binding_ref: "binding_gate_001",
      resource_kind: resourceKind,
      ...(resourceKind === "profile_session"
        ? { profile_ref: profileRef }
        : {
            profile_ref: null,
            binding_constraints: {
              anonymous_required: input?.anonymousRequired ?? true,
              reuse_logged_in_context_forbidden: input?.reuseLoggedInContextForbidden ?? true
            }
          })
    },
    authorization_grant: {
      grant_ref: "grant_gate_001",
      allowed_actions: input?.allowedActions ?? ["xhs.read_search_results"],
      binding_scope: {
        allowed_resource_kinds: input?.allowedResourceKinds ?? [resourceKind],
        allowed_profile_refs:
          input?.allowedProfileRefs ?? (profileRef ? [profileRef] : [])
      },
      target_scope: {
        allowed_domains: input?.allowedDomains ?? ["www.xiaohongshu.com"],
        allowed_pages: input?.allowedPages ?? ["search_result_tab"]
      },
      approval_refs: input?.approvalRefs ?? [],
      audit_refs: input?.auditRefs ?? [],
      resource_state_snapshot: input?.resourceStateSnapshot ?? "paused",
      ...(grantedAt ? { granted_at: grantedAt } : {})
    },
    runtime_target: {
      target_ref: "target_gate_001",
      domain: input?.domain ?? "www.xiaohongshu.com",
      page: input?.page ?? "search_result_tab",
      tab_id: input?.tabId ?? 12,
      url: input?.url ?? "https://www.xiaohongshu.com/search_result?keyword=camping"
    }
  };
};

describe("xhs-search gate helpers", () => {
  it("flags mismatched actual target context", () => {
    expect(
      resolveActualTargetGateReasons({
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 8,
        actual_target_page: "creator_publish_tab"
      })
    ).toEqual(
      expect.arrayContaining([
        "TARGET_DOMAIN_CONTEXT_MISMATCH",
        "TARGET_TAB_CONTEXT_MISMATCH",
        "TARGET_PAGE_CONTEXT_MISMATCH"
      ])
    );
  });

  it("blocks anonymous_context when the target site is known to be logged in", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest(),
      anonymousIsolationVerified: true,
      targetSiteLoggedIn: true
    });

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      normalized_resource_kind: "anonymous_context",
      anonymous_isolation_ok: false
    });
    expect(gate.request_admission_result.reason_codes).toContain(
      "ANONYMOUS_CONTEXT_REQUIRES_LOGGED_OUT_SITE_CONTEXT"
    );
  });

  it("forwards target_site_logged_in through the extension gate path", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "dry_run",
        upstream_authorization_request: createUpstreamAuthorizationRequest(),
        __anonymous_isolation_verified: true,
        target_site_logged_in: true
      },
      {
        runId: "run-extension-target-site-login-001",
        requestId: "req-extension-target-site-login-001",
        sessionId: "session-extension-target-site-login-001",
        profile: "profile-a"
      }
    );

    expect(gate.request_admission_result.admission_decision).toBe("blocked");
    expect(gate.request_admission_result.reason_codes).toContain(
      "ANONYMOUS_CONTEXT_REQUIRES_LOGGED_OUT_SITE_CONTEXT"
    );
  });

  it("defers anonymous canonical diagnostics on the extension gate path until page-state signals exist", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        limited_read_rollout_ready_true: true,
        upstream_authorization_request: createUpstreamAuthorizationRequest({
          approvalRefs: [
            "approval_admission_run-extension-anon-defer-001_req-extension-anon-defer-001"
          ],
          auditRefs: ["audit_admission_run-extension-anon-defer-001_req-extension-anon-defer-001"],
          resourceStateSnapshot: "active"
        }),
        approval_record: createApprovalRecord(
          "gate_decision_issue209-gate-run-extension-anon-defer-001-req-extension-anon-defer-001",
          "gate_appr_gate_decision_issue209-gate-run-extension-anon-defer-001-req-extension-anon-defer-001"
        ),
        admission_context: createAdmissionContext({
          run_id: "run-extension-anon-defer-001",
          request_id: "req-extension-anon-defer-001",
          target_tab_id: 12,
          target_page: "search_result_tab",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        })
      },
      {
        runId: "run-extension-anon-defer-001",
        requestId: "req-extension-anon-defer-001",
        sessionId: "session-extension-anon-defer-001",
        profile: "profile-anon-001",
        commandRequestId: "req-extension-anon-defer-001",
        gateInvocationId: "issue209-gate-run-extension-anon-defer-001-req-extension-anon-defer-001"
      }
    );

    expect(gate.request_admission_result).toBeNull();
    expect(gate.execution_audit).toBeNull();
  });

  it("blocks anonymous_context when anonymous isolation cannot be proven", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest(),
      anonymousIsolationVerified: false,
      targetSiteLoggedIn: false
    });

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      anonymous_isolation_ok: false
    });
    expect(gate.request_admission_result.reason_codes).toContain(
      "ANONYMOUS_ISOLATION_UNVERIFIED"
    );
  });

  it("blocks anonymous_context when binding constraints do not require anonymous isolation", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        anonymousRequired: false
      }),
      anonymousIsolationVerified: true
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      anonymous_isolation_ok: false
    });
    expect(gate.request_admission_result.reason_codes).toContain(
      "ANONYMOUS_BINDING_CONSTRAINTS_INVALID"
    );
  });

  it("does not block a named anonymous runtime profile when site isolation is verified", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest(),
      anonymousIsolationVerified: true,
      targetSiteLoggedIn: false
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "dry_run"
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      runtime_target_match: true,
      grant_match: true,
      anonymous_isolation_ok: true,
      effective_runtime_mode: "dry_run"
    });
  });

  it("returns blocked request admission when runtime_target mismatches the current scene", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "creator.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session"
      })
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      runtime_target_match: false,
      grant_match: true
    });
  });

  it("returns blocked request admission when runtime_target.url does not match the declared target", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        url: "https://www.xiaohongshu.com/explore/note-id"
      } as never)
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      runtime_target_match: false
    });
    expect(gate.request_admission_result.reason_codes).toContain("TARGET_URL_CONTEXT_MISMATCH");
  });

  it("returns blocked request admission when grant scope does not match the canonical binding", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        allowedResourceKinds: ["profile_session"]
      }),
      anonymousIsolationVerified: true
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      runtime_target_match: true,
      grant_match: false
    });
    expect(gate.request_admission_result.reason_codes).toContain("RESOURCE_KIND_OUT_OF_SCOPE");
  });

  it("blocks profile_session when the actual runtime profile differs from the authorized profile_ref", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      runtimeProfileRef: "runtime-profile-b",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "runtime-profile-a",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["runtime-profile-a"]
      })
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      grant_match: true
    });
    expect(gate.request_admission_result.reason_codes).toContain(
      "PROFILE_SESSION_RUNTIME_PROFILE_MISMATCH"
    );
  });

  it("blocks when runtime_target.url drifts from the actual live tab url", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actualTargetUrl: "https://www.xiaohongshu.com/search_result?keyword=hiking",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        url: "https://www.xiaohongshu.com/search_result?keyword=camping"
      } as never)
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      runtime_target_match: false
    });
    expect(gate.request_admission_result.reason_codes).toContain("TARGET_URL_CONTEXT_MISMATCH");
  });

  it("allows runtime_target.url matches when actual live tab query parameters are reordered", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actualTargetUrl:
        "https://www.xiaohongshu.com/search_result?channel=web&keyword=camping",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        url: "https://www.xiaohongshu.com/search_result?keyword=camping&channel=web"
      } as never)
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      runtime_target_match: true
    });
    expect(gate.request_admission_result.reason_codes).not.toContain("TARGET_URL_CONTEXT_MISMATCH");
  });

  it("allows runtime_target.url matches when the actual live tab adds non-authoritative query params", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actualTargetUrl:
        "https://www.xiaohongshu.com/search_result?keyword=camping&channel=web&session_id=temp-001",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        url: "https://www.xiaohongshu.com/search_result?keyword=camping&channel=web"
      } as never)
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      runtime_target_match: true
    });
    expect(gate.request_admission_result.reason_codes).not.toContain("TARGET_URL_CONTEXT_MISMATCH");
  });

  it("blocks stale legacy requested_execution_mode instead of letting it own canonical mode", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "dry_run",
      legacyRequestedExecutionMode: "live_write",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest(),
      anonymousIsolationVerified: true
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run"
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      effective_runtime_mode: "dry_run"
    });
    expect(gate.request_admission_result.reason_codes).toContain(
      "STALE_LEGACY_REQUESTED_EXECUTION_MODE"
    );
  });

  it("still derives canonical mode when direct consumers pass upstream objects with a stale requested_execution_mode", () => {
    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_write",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest(),
      anonymousIsolationVerified: true
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run"
    });
    expect(gate.consumer_gate_result.requested_execution_mode).toBe("dry_run");
    expect(gate.request_admission_result.reason_codes).toContain(
      "STALE_LEGACY_REQUESTED_EXECUTION_MODE"
    );
  });

  it("derives gate risk_state from grant snapshot when FR-0023 objects are present without legacy risk_state", () => {
    const gate = evaluateXhsGateCore({
      issueScope: "issue_209",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_limited",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        approvalRefs: ["approval_admission_external_001"],
        auditRefs: ["audit_admission_external_001"],
        resourceStateSnapshot: "cool_down"
      })
    });

    expect(gate.riskState).toBe("limited");
  });

  it("maps matching legacy admission evidence into request-time grant input and emits execution_audit", () => {
    const runId = "run-extension-execution-audit-001";
    const requestId = "req-execution-audit-001";
    const sessionId = "session-extension-execution-audit-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-001"
    );
    const approvalAdmissionRef = `approval_admission_${runId}_${requestId}`;
    const auditAdmissionRef = `audit_admission_${runId}_${requestId}`;

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: createAdmissionContext({
        run_id: runId,
        request_id: requestId,
        session_id: sessionId,
        decision_id: decisionId,
        approval_id: approvalId
      }),
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: [approvalAdmissionRef],
        auditRefs: [auditAdmissionRef],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      grant_match: true
    });
    expect(gate.execution_audit).toMatchObject({
      audit_ref: `exec_audit_${decisionId}`,
      request_ref: "upstream_req_gate_001",
      consumed_inputs: {
        action_request_ref: "upstream_req_gate_001",
        resource_binding_ref: "binding_gate_001",
        authorization_grant_ref: "grant_gate_001",
        runtime_target_ref: "target_gate_001"
      },
      compatibility_refs: {
        gate_run_id: runId,
        approval_admission_ref: approvalAdmissionRef,
        audit_admission_ref: auditAdmissionRef,
        approval_record_ref: approvalId,
        audit_record_ref: `gate_evt_${decisionId}`,
        session_rhythm_window_id: null,
        session_rhythm_decision_id: null
      },
      request_admission_decision: "allowed",
      risk_signals: ["NO_ADDITIONAL_RISK_SIGNALS"]
    });
    expect(gate.execution_audit?.risk_signals).not.toContain("LIVE_MODE_APPROVED");
  });

  it("drops stale explicit admission refs when the current canonical grant is still usable", () => {
    const runId = "run-extension-execution-audit-002";
    const requestId = "req-execution-audit-002";
    const sessionId = "session-extension-execution-audit-002";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-002"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: createAdmissionContext({
        run_id: runId,
        request_id: requestId,
        session_id: sessionId,
        decision_id: decisionId,
        approval_id: approvalId
      }),
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_other_request"],
        auditRefs: ["audit_admission_other_request"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(gate.gate_input.admission_context).toEqual({
      approval_admission_evidence: expect.objectContaining({
        approval_admission_ref: null
      }),
      audit_admission_evidence: expect.objectContaining({
        audit_admission_ref: null
      })
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      grant_match: true,
      derived_from: {
        approval_admission_ref: "approval_admission_other_request",
        audit_admission_ref: "audit_admission_other_request"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      request_admission_decision: "allowed",
      compatibility_refs: {
        approval_admission_ref: "approval_admission_other_request",
        audit_admission_ref: "audit_admission_other_request",
        approval_record_ref: `gate_appr_${decisionId}`,
        audit_record_ref: `gate_evt_${decisionId}`
      },
      risk_signals: ["NO_ADDITIONAL_RISK_SIGNALS"]
    });
  });

  it("allows canonical live-read from grant refs alone without synthesizing legacy admission_context", () => {
    const runId = "run-extension-execution-audit-003";
    const requestId = "req-execution-audit-003";
    const sessionId = "session-extension-execution-audit-003";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_001"],
        auditRefs: ["audit_admission_external_001"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.gate_input.admission_context).toEqual({
      approval_admission_evidence: expect.objectContaining({
        approval_admission_ref: null
      }),
      audit_admission_evidence: expect.objectContaining({
        audit_admission_ref: null
      })
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      effective_runtime_mode: "live_read_high_risk",
      derived_from: {
        approval_admission_ref: "approval_admission_external_001",
        audit_admission_ref: "audit_admission_external_001"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      audit_ref: `exec_audit_${decisionId}`,
      request_admission_decision: "allowed",
      compatibility_refs: {
        approval_admission_ref: "approval_admission_external_001",
        audit_admission_ref: "audit_admission_external_001",
        approval_record_ref: `gate_appr_${decisionId}`,
        audit_record_ref: `gate_evt_${decisionId}`
      }
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: `gate_appr_${decisionId}`,
      decision_id: decisionId,
      approved: true,
      approver: "authorization_grant",
      approved_at: "2026-04-15T09:00:00.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
  });

  it("rejects canonical live-read from direct shared-gate requests when four-object refs are missing", () => {
    const runId = "run-extension-execution-audit-003-missing-refs";
    const requestId = "req-execution-audit-003-missing-refs";
    const sessionId = "session-extension-execution-audit-003-missing-refs";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003-missing-refs"
    );
    const upstreamAuthorizationRequest = createUpstreamAuthorizationRequest({
      resourceKind: "profile_session",
      profileRef: "profile-session-001",
      allowedResourceKinds: ["profile_session"],
      allowedProfileRefs: ["profile-session-001"],
      approvalRefs: ["approval_admission_external_missing_ref_001"],
      auditRefs: ["audit_admission_external_missing_ref_001"],
      resourceStateSnapshot: "active"
    });

    delete upstreamAuthorizationRequest.action_request.request_ref;
    delete upstreamAuthorizationRequest.resource_binding.binding_ref;
    delete upstreamAuthorizationRequest.authorization_grant.grant_ref;
    delete upstreamAuthorizationRequest.runtime_target.target_ref;

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest
    });

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: expect.arrayContaining([
        "MANUAL_CONFIRMATION_MISSING",
        "APPROVAL_CHECKS_INCOMPLETE",
        "AUDIT_RECORD_MISSING"
      ])
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked"
    });
    expect(gate.execution_audit).toBeNull();
  });

  it("does not publish execution_audit compatibility refs when a canonical grant is blocked", () => {
    const runId = "run-extension-execution-audit-003-blocked-scope";
    const requestId = "req-execution-audit-003-blocked-scope";
    const sessionId = "session-extension-execution-audit-003-blocked-scope";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003-blocked-scope"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        allowedDomains: ["creator.xiaohongshu.com"],
        approvalRefs: ["approval_admission_external_blocked_001"],
        auditRefs: ["audit_admission_external_blocked_001"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: expect.arrayContaining(["TARGET_DOMAIN_OUT_OF_SCOPE"])
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      grant_match: false,
      derived_from: {
        approval_admission_ref: "approval_admission_external_blocked_001",
        audit_admission_ref: "audit_admission_external_blocked_001"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      request_admission_decision: "blocked",
      compatibility_refs: {
        approval_admission_ref: null,
        audit_admission_ref: null,
        approval_record_ref: null,
        audit_record_ref: `gate_evt_${decisionId}`
      }
    });
  });

  it("preserves canonical compatibility refs when a live-read is blocked after grant matching succeeds", () => {
    const runId = "run-extension-execution-audit-003aa";
    const requestId = "req-execution-audit-003aa";
    const sessionId = "session-extension-execution-audit-003aa";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003aa"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "creator.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_blocked_trace_001"],
        auditRefs: ["audit_admission_external_blocked_trace_001"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: expect.arrayContaining(["TARGET_DOMAIN_CONTEXT_MISMATCH"])
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      grant_match: true,
      runtime_target_match: false,
      derived_from: {
        approval_admission_ref: "approval_admission_external_blocked_trace_001",
        audit_admission_ref: "audit_admission_external_blocked_trace_001"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      request_admission_decision: "blocked",
      compatibility_refs: {
        approval_admission_ref: "approval_admission_external_blocked_trace_001",
        audit_admission_ref: "audit_admission_external_blocked_trace_001",
        approval_record_ref: null,
        audit_record_ref: `gate_evt_${decisionId}`
      }
    });
  });

  it("drops stale mixed-client admission_context before canonical grant-backed live-read gating", () => {
    const runId = "run-extension-execution-audit-003b";
    const requestId = "req-execution-audit-003b";
    const sessionId = "session-extension-execution-audit-003b";
    const { gateInvocationId } = createIssue209InvocationLinkage(runId, "execution-audit-003b");

    const preparedOptions = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_high_risk",
        risk_state: "allowed",
        admission_context: createAdmissionContext({
          run_id: "run-extension-stale-mixed-client",
          request_id: requestId
        })
      },
      runId,
      requestId,
      sessionId,
      gateInvocationId
    });

    expect(preparedOptions).not.toHaveProperty("admission_context");

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: preparedOptions.admission_context,
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003b"],
        auditRefs: ["audit_admission_external_003b"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      derived_from: {
        approval_admission_ref: "approval_admission_external_003b",
        audit_admission_ref: "audit_admission_external_003b"
      }
    });
  });

  it("ignores stale legacy admission_context for direct shared-gate callers when canonical grant-backed admission is valid", () => {
    const runId = "run-extension-execution-audit-003bd";
    const requestId = "req-execution-audit-003bd";
    const sessionId = "session-extension-execution-audit-003bd";
    const { gateInvocationId } = createIssue209InvocationLinkage(runId, "execution-audit-003bd");

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: createAdmissionContext({
        run_id: "run-extension-stale-direct-client",
        request_id: requestId
      }),
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003bd"],
        auditRefs: ["audit_admission_external_003bd"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.gate_input.admission_context).toEqual({
      approval_admission_evidence: expect.objectContaining({
        approval_admission_ref: null
      }),
      audit_admission_evidence: expect.objectContaining({
        audit_admission_ref: null
      })
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      derived_from: expect.objectContaining({
        approval_admission_ref: "approval_admission_external_003bd",
        audit_admission_ref: "audit_admission_external_003bd"
      })
    });
  });

  it("ignores empty admission shells when deciding canonical grant-backed fallback", () => {
    const runId = "run-extension-execution-audit-003bb";
    const requestId = "req-execution-audit-003bb";
    const sessionId = "session-extension-execution-audit-003bb";
    const { gateInvocationId } = createIssue209InvocationLinkage(runId, "execution-audit-003bb");

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: {
        approval_admission_evidence: {},
        audit_admission_evidence: {}
      },
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003bb"],
        auditRefs: ["audit_admission_external_003bb"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      derived_from: expect.objectContaining({
        approval_admission_ref: "approval_admission_external_003bb",
        audit_admission_ref: "audit_admission_external_003bb"
      })
    });
  });

  it("fails closed when canonical grant ref arrays contain malformed entries", () => {
    const runId = "run-extension-execution-audit-003a";
    const requestId = "req-execution-audit-003a";
    const sessionId = "session-extension-execution-audit-003a";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003a"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["", "approval_admission_external_003a"],
        auditRefs: [null, "audit_admission_external_003a"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: ["STALE_LEGACY_REQUESTED_EXECUTION_MODE"]
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "blocked",
      derived_from: {
        approval_admission_ref: null,
        audit_admission_ref: null
      }
    });
    expect(gate.execution_audit).toBeNull();
  });

  it("uses authorization_grant.granted_at as the canonical approval timestamp when requested_at is absent", () => {
    const runId = "run-extension-execution-audit-003c";
    const requestId = "req-execution-audit-003c";
    const sessionId = "session-extension-execution-audit-003c";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003c"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003c"],
        auditRefs: ["audit_admission_external_003c"],
        resourceStateSnapshot: "active",
        requestedAt: null,
        grantedAt: "2026-04-16T10:00:00.000Z"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: `gate_appr_${decisionId}`,
      decision_id: decisionId,
      approved_at: "2026-04-16T10:00:00.000Z"
    });
  });

  it("prefers authorization_grant.granted_at over action_request.requested_at for canonical approval timestamps", () => {
    const runId = "run-extension-execution-audit-003ca";
    const requestId = "req-execution-audit-003ca";
    const sessionId = "session-extension-execution-audit-003ca";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003ca"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003ca"],
        auditRefs: ["audit_admission_external_003ca"],
        resourceStateSnapshot: "active",
        requestedAt: "2026-04-16T09:00:00.000Z",
        grantedAt: "2026-04-16T10:00:00.000Z"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk"
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: `gate_appr_${decisionId}`,
      decision_id: decisionId,
      approved_at: "2026-04-16T10:00:00.000Z"
    });
  });

  it("fails closed when canonical grant omits granted_at even if requested_at is present", () => {
    const runId = "run-extension-execution-audit-003cb";
    const requestId = "req-execution-audit-003cb";
    const sessionId = "session-extension-execution-audit-003cb";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003cb"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003cb"],
        auditRefs: ["audit_admission_external_003cb"],
        resourceStateSnapshot: "active",
        requestedAt: "2026-04-16T09:00:00.000Z",
        grantedAt: null
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: expect.arrayContaining([
        "MANUAL_CONFIRMATION_MISSING",
        "APPROVAL_CHECKS_INCOMPLETE",
        "AUDIT_RECORD_MISSING"
      ])
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: null,
      decision_id: decisionId
    });
  });

  it("fails closed when canonical grant input lacks a real approval timestamp source", () => {
    const runId = "run-extension-execution-audit-003d";
    const requestId = "req-execution-audit-003d";
    const sessionId = "session-extension-execution-audit-003d";
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003d"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_003d"],
        auditRefs: ["audit_admission_external_003d"],
        resourceStateSnapshot: "active",
        requestedAt: null,
        grantedAt: null
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "blocked",
      effective_execution_mode: "dry_run",
      gate_reasons: expect.arrayContaining([
        "MANUAL_CONFIRMATION_MISSING",
        "APPROVAL_CHECKS_INCOMPLETE",
        "AUDIT_RECORD_MISSING"
      ])
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: null,
      decision_id: decisionId
    });
  });

  it("preserves explicit approval evidence while backfilling missing audit evidence from the canonical grant", () => {
    const runId = "run-extension-execution-audit-003b";
    const requestId = "req-execution-audit-003b";
    const sessionId = "session-extension-execution-audit-003b";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003b"
    );
    const completeAdmissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId,
      session_id: sessionId,
      decision_id: decisionId,
      approval_id: approvalId
    });
    const approvalAdmissionRef = String(
      completeAdmissionContext.approval_admission_evidence.approval_admission_ref
    );
    const partialAdmissionContext = {
      ...completeAdmissionContext,
      audit_admission_evidence: {
        ...completeAdmissionContext.audit_admission_evidence,
        audit_admission_ref: null
      }
    };

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext: partialAdmissionContext,
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: [approvalAdmissionRef],
        auditRefs: ["audit_admission_external_003b"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(gate.gate_input.admission_context).toEqual({
      approval_admission_evidence: expect.objectContaining({
        approval_admission_ref: approvalAdmissionRef,
        approver: "qa-reviewer"
      }),
      audit_admission_evidence: expect.objectContaining({
        audit_admission_ref: null
      })
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      derived_from: {
        approval_admission_ref: approvalAdmissionRef,
        audit_admission_ref: "audit_admission_external_003b"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      request_admission_decision: "allowed",
      compatibility_refs: {
        approval_admission_ref: approvalAdmissionRef,
        audit_admission_ref: "audit_admission_external_003b"
      }
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: approvalId,
      decision_id: decisionId,
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00.000Z"
    });
  });

  it("drops stale explicit approval refs before canonical fallback and allows the renewed grant", () => {
    const runId = "run-extension-execution-audit-003ba";
    const requestId = "req-execution-audit-003ba";
    const sessionId = "session-extension-execution-audit-003ba";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-003ba"
    );
    const admissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId,
      session_id: sessionId,
      decision_id: decisionId,
      approval_id: approvalId
    });

    admissionContext.approval_admission_evidence.approval_admission_ref =
      "approval_admission_external_stale_003ba";
    admissionContext.audit_admission_evidence.audit_admission_ref = null;
    admissionContext.audit_admission_evidence.recorded_at = null;

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-session-001",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      runtimeProfileRef: "profile-session-001",
      admissionContext,
      upstreamAuthorizationRequest: createUpstreamAuthorizationRequest({
        resourceKind: "profile_session",
        profileRef: "profile-session-001",
        allowedResourceKinds: ["profile_session"],
        allowedProfileRefs: ["profile-session-001"],
        approvalRefs: ["approval_admission_external_current_003ba"],
        auditRefs: ["audit_admission_external_current_003ba"],
        resourceStateSnapshot: "active"
      })
    });

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(gate.gate_input.admission_context).toEqual({
      approval_admission_evidence: expect.objectContaining({
        approval_admission_ref: null
      }),
      audit_admission_evidence: expect.objectContaining({
        audit_admission_ref: null
      })
    });
    expect(gate.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      derived_from: {
        approval_admission_ref: "approval_admission_external_current_003ba",
        audit_admission_ref: "audit_admission_external_current_003ba"
      }
    });
    expect(gate.execution_audit).toMatchObject({
      request_admission_decision: "allowed",
      compatibility_refs: {
        approval_admission_ref: "approval_admission_external_current_003ba",
        audit_admission_ref: "audit_admission_external_current_003ba"
      }
    });
    expect(gate.approval_record).toMatchObject({
      approval_id: approvalId,
      decision_id: decisionId,
      approved: true,
      approver: "authorization_grant"
    });
  });

  it("keeps execution_audit empty on legacy live-read paths without canonical FR-0023 objects", () => {
    const runId = "run-extension-execution-audit-004";
    const requestId = "req-execution-audit-004";
    const sessionId = "session-extension-execution-audit-004";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "execution-audit-004"
    );

    const gate = evaluateXhsGate({
      issueScope: "issue_209",
      runId,
      requestId,
      sessionId,
      gateInvocationId,
      profile: "profile-a",
      riskState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 12,
      targetPage: "search_result_tab",
      actualTargetDomain: "www.xiaohongshu.com",
      actualTargetTabId: 12,
      actualTargetPage: "search_result_tab",
      actionType: "read",
      abilityAction: "read",
      requestedExecutionMode: "live_read_high_risk",
      admissionContext: createAdmissionContext({
        run_id: runId,
        request_id: requestId,
        session_id: sessionId,
        decision_id: decisionId,
        approval_id: approvalId
      })
    });

    expect(gate.gate_outcome.gate_decision).toBe("allowed");
    expect(gate.execution_audit).toBeNull();
  });

  it("preserves request_admission_result on the loopback gate payload", () => {
    const gate = buildLoopbackGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "dry_run",
        upstream_authorization_request: createUpstreamAuthorizationRequest(),
        __anonymous_isolation_verified: true,
        target_site_logged_in: false
      },
      "read",
      {
        runId: "run-loopback-request-admission-001",
        sessionId: "session-loopback-request-admission-001",
        profile: "loopback-profile-001"
      }
    );
    const payload = buildLoopbackGatePayload({
      runId: "run-loopback-request-admission-001",
      sessionId: "session-loopback-request-admission-001",
      profile: "loopback-profile-001",
      gate,
      auditRecord: {
        event_id: "gate_evt_loopback_request_admission_001",
        decision_id: String(gate.gateOutcome.decision_id),
        approval_id: null,
        run_id: "run-loopback-request-admission-001",
        session_id: "session-loopback-request-admission-001",
        profile: "loopback-profile-001",
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "dry_run",
        effective_execution_mode: "dry_run",
        gate_decision: "allowed",
        gate_reasons: ["DEFAULT_MODE_DRY_RUN"],
        approver: null,
        approved_at: null,
        recorded_at: "2026-04-15T10:00:00.000Z"
      }
    });

    expect(payload.request_admission_result).toMatchObject({
      admission_decision: "allowed",
      effective_runtime_mode: "dry_run"
    });
  });

  it("preserves unknown anonymous state on the loopback gate payload", () => {
    const gate = buildLoopbackGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        limited_read_rollout_ready_true: true,
        upstream_authorization_request: createUpstreamAuthorizationRequest({
          approvalRefs: [
            "approval_admission_run-loopback-anon-defer-001_req-loopback-anon-defer-001"
          ],
          auditRefs: ["audit_admission_run-loopback-anon-defer-001_req-loopback-anon-defer-001"],
          resourceStateSnapshot: "active"
        }),
        approval_record: createApprovalRecord(
          "gate_decision_issue209-gate-run-loopback-anon-defer-001-req-loopback-anon-defer-001",
          "gate_appr_gate_decision_issue209-gate-run-loopback-anon-defer-001-req-loopback-anon-defer-001"
        ),
        admission_context: createAdmissionContext({
          run_id: "run-loopback-anon-defer-001",
          request_id: "req-loopback-anon-defer-001",
          target_tab_id: 12,
          target_page: "search_result_tab",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        })
      },
      "read",
      {
        runId: "run-loopback-anon-defer-001",
        sessionId: "session-loopback-anon-defer-001",
        profile: "loopback-profile-001",
        gateInvocationId: "issue209-gate-run-loopback-anon-defer-001-req-loopback-anon-defer-001"
      }
    );
    const payload = buildLoopbackGatePayload({
      runId: "run-loopback-anon-defer-001",
      sessionId: "session-loopback-anon-defer-001",
      profile: "loopback-profile-001",
      gate,
      auditRecord: {
        event_id: "gate_evt_loopback_anon_defer_001",
        decision_id: String(gate.gateOutcome.decision_id),
        approval_id: null,
        run_id: "run-loopback-anon-defer-001",
        session_id: "session-loopback-anon-defer-001",
        profile: "loopback-profile-001",
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_high_risk",
        effective_execution_mode: "dry_run",
        gate_decision: "blocked",
        gate_reasons: ["ANONYMOUS_ISOLATION_UNVERIFIED"],
        approver: null,
        approved_at: null,
        recorded_at: "2026-04-15T10:00:00.000Z"
      }
    });

    expect(gate.requestAdmissionResult).toBeNull();
    expect(gate.executionAudit).toBeNull();
    expect(payload.request_admission_result ?? null).toBeNull();
    expect(payload.execution_audit ?? null).toBeNull();
  });

  it("requires gate_invocation_id for issue_209 live-read gate linkage", () => {
    expect(() =>
      resolveGate(
        {
          issue_scope: "issue_209",
          risk_state: "allowed",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          actual_target_domain: "www.xiaohongshu.com",
          actual_target_tab_id: 12,
          actual_target_page: "search_result_tab",
          action_type: "read",
          ability_action: "read",
          requested_execution_mode: "live_read_high_risk",
          admission_context: createAdmissionContext()
        },
        {
          runId: "run-extension-001",
          requestId: "req-1",
          sessionId: "session-extension-001",
          profile: "profile-a"
        }
      )
    ).toThrow("issue_209 live-read requires gate_invocation_id");
  });

  it("does not derive issue_209 live gate linkage from caller request ids", () => {
    expect(() =>
      resolveGate(
        {
          issue_scope: "issue_209",
          risk_state: "allowed",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          actual_target_domain: "www.xiaohongshu.com",
          actual_target_tab_id: 12,
          actual_target_page: "search_result_tab",
          action_type: "read",
          ability_action: "read",
          requested_execution_mode: "live_read_high_risk",
          admission_context: createAdmissionContext({
            run_id: "run-extension-command-request-001",
            request_id: "issue209-live-req-1",
            session_id: "session-extension-command-request-001"
          })
        },
        {
          runId: "run-extension-command-request-001",
          requestId: "transport-req-1",
          commandRequestId: "issue209-live-req-1",
          sessionId: "session-extension-command-request-001",
          profile: "profile-a"
        }
      )
    ).toThrow("issue_209 live-read requires gate_invocation_id");
  });

  it("keeps non-issue209 gate linkage tied to dispatch identity instead of caller request_id", () => {
    const firstDecisionId = resolveXhsGateDecisionId({
      runId: "run-extension-generic-identity-001",
      requestId: "dispatch-req-1",
      commandRequestId: "caller-req-reused",
      issueScope: "issue_208",
      requestedExecutionMode: "dry_run",
      targetPage: "search_result_tab",
      targetTabId: 12
    });
    const secondDecisionId = resolveXhsGateDecisionId({
      runId: "run-extension-generic-identity-001",
      requestId: "dispatch-req-2",
      commandRequestId: "caller-req-reused",
      issueScope: "issue_208",
      requestedExecutionMode: "dry_run",
      targetPage: "search_result_tab",
      targetTabId: 12
    });

    expect(firstDecisionId).toBe("gate_decision_run-extension-generic-identity-001_dispatch-req-1");
    expect(secondDecisionId).toBe("gate_decision_run-extension-generic-identity-001_dispatch-req-2");
    expect(firstDecisionId).not.toBe(secondDecisionId);
  });

  it("prefers gate_invocation_id over caller request ids for live gate linkage", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-command-request-001",
      "gate-invocation-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-command-request-001",
          request_id: "issue209-live-req-1",
          session_id: "session-extension-gate-invocation-001"
        }),
        audit_record: createAuditRecord({
          decisionId: "gate_decision_previous_issue209_request_linkage",
          approvalId: "gate_appr_gate_decision_previous_issue209_request_linkage",
          targetTabId: 12,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-command-request-001",
        gateInvocationId,
        sessionId: "session-extension-gate-invocation-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.approval_record.approval_id).toBe(approvalId);
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("does not require admission evidence to pre-match internal gate ids", () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-plain-admission-001",
      "plain-admission-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_plain-admission-001",
            run_id: "run-extension-plain-admission-001",
            session_id: "session-extension-plain-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 12,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00.000Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:00:00.000Z"
          },
          audit_admission_evidence: {
            audit_admission_ref: "audit_admission_plain-admission-001",
            run_id: "run-extension-plain-admission-001",
            session_id: "session-extension-plain-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 12,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:00:30.000Z"
          }
        },
        approval_record: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        },
        audit_record: {
          event_id: "audit-extension-plain-admission-001",
          decision_id: "gate_decision_run-extension-plain-admission-001_req-plain-1",
          approval_id: "gate_appr_gate_decision_run-extension-plain-admission-001_req-plain-1",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 12,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        }
      },
      {
        runId: "run-extension-plain-admission-001",
        requestId: "req-plain-1",
        gateInvocationId,
        sessionId: "session-extension-plain-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "allowed",
      effective_execution_mode: "live_read_high_risk",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
  });

  it("blocks admission evidence from an older native-messaging session", () => {
    const { gateInvocationId } = createIssue209InvocationLinkage(
      "run-extension-session-rebind-001",
      "session-rebind-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-session-rebind-001",
          session_id: "stale-session-001"
        }),
        approval_record: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-session-rebind-001",
        requestId: "req-session-rebind-1",
        gateInvocationId,
        sessionId: "session-extension-current-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run"
    });
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"])
    );
  });


  it("keeps gate decision IDs unique per run even when caller reuses request_id", () => {
    const firstGate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext(),
        approval_record: {
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-001_issue209-live-req-reused",
          decision_id:
            "gate_decision_run-extension-command-request-001_issue209-live-req-reused",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-command-request-001",
        requestId: "transport-req-1",
        commandRequestId: "issue209-live-req-reused",
        gateInvocationId: "issue209-gate-run-extension-command-request-001-a",
        sessionId: "session-extension-command-request-001",
        profile: "profile-a"
      }
    );
    const secondGate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        approval_record: {
          approval_id:
            "gate_appr_gate_decision_run-extension-command-request-002_issue209-live-req-reused",
          decision_id:
            "gate_decision_run-extension-command-request-002_issue209-live-req-reused",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-command-request-001",
        requestId: "transport-req-2",
        commandRequestId: "issue209-live-req-reused",
        gateInvocationId: "issue209-gate-run-extension-command-request-001-b",
        sessionId: "session-extension-command-request-001",
        profile: "profile-a"
      }
    );

    expect(firstGate.gate_outcome.decision_id).toBe(
      "gate_decision_issue209-gate-run-extension-command-request-001-a"
    );
    expect(secondGate.gate_outcome.decision_id).toBe(
      "gate_decision_issue209-gate-run-extension-command-request-001-b"
    );
    expect(firstGate.gate_outcome.decision_id).not.toBe(secondGate.gate_outcome.decision_id);
  });

  it("clears stale approval_id for non-live gate results", () => {
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "paused",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 18,
        target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "dry_run",
        approval_record: {
          approval_id: "gate_appr_stale_extension_req-2",
          decision_id: "gate_decision_stale_extension_req-2",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-002",
        requestId: "req-2",
        sessionId: "session-extension-002",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe("gate_decision_run-extension-002_req-2");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe("gate_decision_run-extension-002_req-2");
  });

  it("blocks live approval when a reused approval_record belongs to an older decision", () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-003",
      "reused-approval-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 24,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 24,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-003",
          request_id: "req-3",
          session_id: "session-extension-003"
        }),
        audit_record: {
          event_id: "gate_evt_run-extension-003_req-3",
          decision_id: "gate_decision_run-extension-003_req-3",
          approval_id: "gate_appr_gate_decision_run-extension-003_req-3",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 24,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        },
        approval_record: {
          approval_id: "gate_appr_previous_req",
          decision_id: "gate_decision_previous_req",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-003",
        requestId: "req-3",
        gateInvocationId,
        sessionId: "session-extension-003",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("blocks live approval when a legacy approval_record omits decision_id", () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-extension-004",
      "legacy-approval-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 30,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 30,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        approval_record: {
          approval_id: "gate_appr_legacy_without_decision",
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      },
      {
        runId: "run-extension-004",
        requestId: "req-4",
        gateInvocationId,
        sessionId: "session-extension-004",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.gate_reasons).toContain("MANUAL_CONFIRMATION_MISSING");
    expect(gate.approval_record.approval_id).toBeNull();
    expect(gate.approval_record.decision_id).toBe(decisionId);
  });

  it("ignores stale caller audit_record when admission evidence already matches the current request", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-005",
      "current-live-limited-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "limited",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 36,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 36,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_limited",
        limited_read_rollout_ready_true: true,
        admission_context: createAdmissionContext({
          run_id: "run-extension-005",
          request_id: "req-5",
          session_id: "session-extension-005",
          target_tab_id: 36,
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        }),
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: {
          event_id: "gate_evt_issue209_stale_req-5",
          decision_id: "gate_decision_issue209_stale_req-5",
          approval_id: "gate_appr_issue209_stale_req-5",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 36,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z"
        }
      },
      {
        runId: "run-extension-005",
        requestId: "req-5",
        gateInvocationId,
        sessionId: "session-extension-005",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("allowed");
    expect(gate.gate_outcome.effective_execution_mode).toBe("live_read_limited");
    expect(gate.gate_outcome.gate_reasons).toEqual(["LIVE_MODE_APPROVED"]);
    expect(gate.gate_outcome.decision_id).toBe(decisionId);
    expect(gate.approval_record.approval_id).toBe(approvalId);
  });

  it("allows explicit admission_context without mirrored approval_record", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-explicit-admission-only-001",
      "explicit-admission-only-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "limited",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 36,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 36,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_limited",
        limited_read_rollout_ready_true: true,
        admission_context: createAdmissionContext({
          run_id: "run-extension-explicit-admission-only-001",
          request_id: "req-explicit-only-1",
          session_id: "session-extension-explicit-only-001",
          target_tab_id: 36,
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        })
      },
      {
        runId: "run-extension-explicit-admission-only-001",
        requestId: "req-explicit-only-1",
        gateInvocationId,
        sessionId: "session-extension-explicit-only-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome).toMatchObject({
      decision_id: decisionId,
      gate_decision: "allowed",
      effective_execution_mode: "live_read_limited",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(gate.approval_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00.000Z",
      checks: defaultAuditChecks
    });
  });

  it("blocks admission evidence when it carries a stale internal decision linkage", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-linkage-mismatch-001",
      "linkage-mismatch-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 40,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 40,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-linkage-mismatch-001",
          request_id: "req-linkage-001",
          decision_id: "gate_decision_previous_req",
          approval_id: "gate_appr_gate_decision_previous_req",
          target_tab_id: 40
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-linkage-mismatch-001",
        requestId: "req-linkage-001",
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"])
    );
  });

  it("blocks admission evidence when only one internal linkage field is present", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-linkage-mismatch-002",
      "linkage-mismatch-002"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 44,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 44,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-linkage-mismatch-002",
          request_id: "req-linkage-002",
          approval_id: approvalId,
          target_tab_id: 44
        }),
        approval_record: createApprovalRecord(decisionId, approvalId)
      },
      {
        runId: "run-extension-linkage-mismatch-002",
        requestId: "req-linkage-002",
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"])
    );
  });

  it.each([
    {
      label: "run_id",
      runId: "run-extension-admission-mismatch-001",
      requestId: "req-admission-run",
      targetTabId: 12,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({ run_id: "run-extension-admission-stale-001" }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "target_tab_id",
      runId: "run-extension-admission-mismatch-002",
      requestId: "req-admission-tab",
      targetTabId: 24,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({ run_id: "run-extension-admission-mismatch-002", target_tab_id: 25 }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "target_page",
      runId: "run-extension-admission-mismatch-003",
      requestId: "req-admission-page",
      targetTabId: 36,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-003",
        target_tab_id: 36,
        target_page: "explore_detail_tab"
      }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "requested_execution_mode",
      runId: "run-extension-admission-mismatch-004",
      requestId: "req-admission-mode",
      targetTabId: 48,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_high_risk" as const,
      riskState: "allowed" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-004",
        target_tab_id: 48,
        requested_execution_mode: "live_read_limited"
      }),
      expectedFallback: "dry_run",
      expectedReasons: ["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"]
    },
    {
      label: "risk_state",
      runId: "run-extension-admission-mismatch-005",
      requestId: "req-admission-risk",
      targetTabId: 60,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_read_limited" as const,
      riskState: "limited" as const,
      admissionContext: createAdmissionContext({
        run_id: "run-extension-admission-mismatch-005",
        target_tab_id: 60,
        requested_execution_mode: "live_read_limited",
        risk_state: "allowed"
      }),
      expectedFallback: "recon",
      expectedReasons: ["AUDIT_RECORD_MISSING"]
    }
  ])("blocks live gate when admission evidence %s mismatches current request", (scenario) => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      scenario.runId,
      `${scenario.label}-current`
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: scenario.riskState,
        target_domain: "www.xiaohongshu.com",
        target_tab_id: scenario.targetTabId,
        target_page: scenario.targetPage,
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: scenario.targetTabId,
        actual_target_page: scenario.targetPage,
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: scenario.requestedExecutionMode,
        admission_context: scenario.admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: scenario.targetTabId,
          targetPage: scenario.targetPage,
          requestedExecutionMode: scenario.requestedExecutionMode
        }),
        limited_read_rollout_ready_true: scenario.requestedExecutionMode === "live_read_limited"
      },
      {
        runId: scenario.runId,
        requestId: scenario.requestId,
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe(scenario.expectedFallback);
    expect(gate.gate_outcome.gate_reasons).toEqual(expect.arrayContaining(scenario.expectedReasons));
  });

  it("blocks live gate when approval admission evidence omits stable approval_admission_ref", () => {
    const runId = "run-extension-admission-ref-missing-001";
    const requestId = "req-admission-ref-missing-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "approval-ref-missing-001"
    );
    const completeAdmissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId
    });
    const { approval_admission_ref: _approvalAdmissionRef, ...approvalEvidence } =
      completeAdmissionContext.approval_admission_evidence;
    const admissionContext = {
      ...completeAdmissionContext,
      approval_admission_evidence: approvalEvidence
    };

    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 72,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 72,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: 72,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        })
      },
      {
        runId,
        requestId,
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"])
    );
  });

  it("blocks live gate when audit admission evidence omits stable audit_admission_ref", () => {
    const runId = "run-extension-audit-ref-missing-001";
    const requestId = "req-audit-ref-missing-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "audit-ref-missing-001"
    );
    const completeAdmissionContext = createAdmissionContext({
      run_id: runId,
      request_id: requestId
    });
    const { audit_admission_ref: _auditAdmissionRef, ...auditEvidence } =
      completeAdmissionContext.audit_admission_evidence;
    const admissionContext = {
      ...completeAdmissionContext,
      audit_admission_evidence: auditEvidence
    };

    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 84,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 84,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: admissionContext,
        approval_record: createApprovalRecord(decisionId, approvalId),
        audit_record: createAuditRecord({
          decisionId,
          approvalId,
          targetTabId: 84,
          targetPage: "search_result_tab",
          requestedExecutionMode: "live_read_high_risk"
        })
      },
      {
        runId,
        requestId,
        gateInvocationId,
        sessionId: "session-extension-001",
        profile: "profile-a"
      }
    );

    expect(gate.gate_outcome.gate_decision).toBe("blocked");
    expect(gate.gate_outcome.effective_execution_mode).toBe("dry_run");
    expect(gate.gate_outcome.gate_reasons).toEqual(
      expect.arrayContaining(["AUDIT_RECORD_MISSING"])
    );
  });

  it("returns gate core state without throwing when admission_context is provided", () => {
    expect(() =>
      evaluateXhsGateCore({
        issueScope: "issue_209",
        riskState: "allowed",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 12,
        targetPage: "search_result_tab",
        actualTargetDomain: "www.xiaohongshu.com",
        actualTargetTabId: 12,
        actualTargetPage: "search_result_tab",
        actionType: "read",
        abilityAction: "read",
        requestedExecutionMode: "live_read_high_risk",
        admissionContext: createAdmissionContext({
          run_id: "run-core-001",
          session_id: "session-core-001"
        }),
        approvalRecord: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00.000Z",
          checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          }
        }
      })
    ).not.toThrow();
  });

  it("emits audited_checks in issued issue_209 audit artifacts", () => {
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      "run-extension-issued-audit-001",
      "issued-audit-001"
    );
    const gate = resolveGate(
      {
        issue_scope: "issue_209",
        risk_state: "allowed",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 12,
        target_page: "search_result_tab",
        actual_target_domain: "www.xiaohongshu.com",
        actual_target_tab_id: 12,
        actual_target_page: "search_result_tab",
        action_type: "read",
        ability_action: "read",
        requested_execution_mode: "live_read_high_risk",
        admission_context: createAdmissionContext({
          run_id: "run-extension-issued-audit-001",
          request_id: "req-issued-audit-1",
          session_id: "session-extension-issued-audit-001",
          decision_id: decisionId,
          approval_id: approvalId
        })
      },
      {
        runId: "run-extension-issued-audit-001",
        requestId: "req-issued-audit-1",
        gateInvocationId,
        sessionId: "session-extension-issued-audit-001",
        profile: "profile-a"
      }
    );

    const artifacts = buildIssue209PostGateArtifacts({
      runId: "run-extension-issued-audit-001",
      sessionId: "session-extension-issued-audit-001",
      profile: "profile-a",
      gate,
      now: () => new Date("2026-03-23T10:10:00.000Z").getTime()
    });

    expect(artifacts.audit_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      gate_decision: "allowed",
      audited_checks: defaultAuditChecks
    });
    expect(artifacts.execution_audit).toBeNull();

    const validation = validateIssue209AuditSourceAgainstCurrentLinkage({
      current: {
        commandRequestId: "req-issued-audit-1",
        gateInvocationId,
        decisionId,
        approvalId,
        issueScope: "issue_209",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 12,
        targetPage: "search_result_tab",
        actionType: "read",
        requestedExecutionMode: "live_read_high_risk",
        riskState: "allowed"
      },
      auditRecord: artifacts.audit_record
    });

    expect(validation.isValid).toBe(true);
    expect(validation.auditRequirementGaps).toEqual([]);
  });

  describe("issue_209 audit source validation", () => {
    it("rejects audit sources with mismatched linkage", () => {
      const current = buildAuditValidationContext();
      const { auditRequirementGaps, isValid } = validateIssue209AuditSourceAgainstCurrentLinkage({
        current,
        auditSource: {
          event_id: "audit-linkage-validation",
          decision_id: "gate_decision_stale",
          approval_id: "gate_appr_stale",
          issue_scope: current.issueScope,
          target_domain: current.targetDomain,
          target_tab_id: current.targetTabId,
          target_page: current.targetPage,
          action_type: current.actionType,
          requested_execution_mode: current.requestedExecutionMode,
          risk_state: current.riskState,
          gate_decision: "allowed",
          audited_checks: defaultAuditChecks,
          recorded_at: "2026-03-23T10:00:30.000Z",
          request_id: current.commandRequestId
        },
        requestIdWasExplicit: true
      });

      expect(isValid).toBe(false);
      expect(auditRequirementGaps).toEqual(
        expect.arrayContaining(["audit_record_linkage_invalid"])
      );
    });

    it("rejects audit sources missing audited checks", () => {
      const current = buildAuditValidationContext();
      const { auditRequirementGaps, isValid } = validateIssue209AuditSourceAgainstCurrentLinkage({
        current,
        auditSource: {
          event_id: "audit-missing-checks-validation",
          decision_id: current.decisionId,
          approval_id: current.approvalId,
          issue_scope: current.issueScope,
          target_domain: current.targetDomain,
          target_tab_id: current.targetTabId,
          target_page: current.targetPage,
          action_type: current.actionType,
          requested_execution_mode: current.requestedExecutionMode,
          risk_state: current.riskState,
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:00:30.000Z",
          request_id: current.commandRequestId
        },
        requestIdWasExplicit: true
      });

      expect(isValid).toBe(false);
      expect(auditRequirementGaps).toEqual(expect.arrayContaining(["audit_record_checks_all_true"]));
    });
  });

});
