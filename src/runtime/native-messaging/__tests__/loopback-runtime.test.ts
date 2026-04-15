import { describe, expect, it } from "vitest";

import { NativeMessagingBridge } from "../bridge.js";
import { createInMemoryLoopbackTransport } from "../loopback-runtime.js";

const createApprovedReadAdmissionContext = (input: {
  runId: string;
  requestId: string;
  targetTabId: number;
  targetPage?: string;
  requestedExecutionMode: "live_read_limited" | "live_read_high_risk";
  riskState: "limited" | "allowed";
  decisionId?: string;
  approvalId?: string;
}) => ({
  approval_admission_evidence: {
    approval_admission_ref:
      input.approvalId ?? `approval_admission_${input.runId}_${input.requestId}`,
    ...(input.decisionId ? { decision_id: input.decisionId } : {}),
    ...(input.approvalId ? { approval_id: input.approvalId } : {}),
    request_id: input.requestId,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
    target_page: input.targetPage ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode,
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00Z",
    checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref:
      input.decisionId
        ? `gate_evt_${input.decisionId}`
        : `audit_admission_${input.runId}_${input.requestId}`,
    ...(input.decisionId ? { decision_id: input.decisionId } : {}),
    ...(input.approvalId ? { approval_id: input.approvalId } : {}),
    request_id: input.requestId,
    run_id: input.runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: input.targetTabId,
    target_page: input.targetPage ?? "search_result_tab",
    action_type: "read",
    requested_execution_mode: input.requestedExecutionMode,
    risk_state: input.riskState,
    audited_checks: {
      target_domain_confirmed: true,
      target_tab_confirmed: true,
      target_page_confirmed: true,
      risk_state_checked: true,
      action_type_confirmed: true
    },
    recorded_at: "2026-03-23T10:00:30Z"
  }
});

const createIssue209InvocationLinkage = (runId: string, suffix: string) => {
  const gateInvocationId = `issue209-gate-${runId}-${suffix}`;
  const decisionId = `gate_decision_${gateInvocationId}`;
  const approvalId = `gate_appr_${decisionId}`;
  return { gateInvocationId, decisionId, approvalId };
};

const buildCanonicalReadAuthorizationRequest = (input: {
  requestRef: string;
  targetTabId: number;
  targetPage?: "search_result_tab";
  profileRef: string;
  approvalRefs?: string[];
  auditRefs?: string[];
  resourceStateSnapshot?: "active" | "cool_down" | "paused";
}) => ({
  action_request: {
    request_ref: input.requestRef,
    action_name: "xhs.read_search_results",
    action_category: "read",
    requested_at: "2026-04-15T09:00:00.000Z"
  },
  resource_binding: {
    binding_ref: `binding_${input.requestRef}`,
    resource_kind: "profile_session",
    profile_ref: input.profileRef
  },
  authorization_grant: {
    grant_ref: `grant_${input.requestRef}`,
    allowed_actions: ["xhs.read_search_results"],
    binding_scope: {
      allowed_resource_kinds: ["profile_session"],
      allowed_profile_refs: [input.profileRef]
    },
    target_scope: {
      allowed_domains: ["www.xiaohongshu.com"],
      allowed_pages: [input.targetPage ?? "search_result_tab"]
    },
    approval_refs: input.approvalRefs ?? [],
    audit_refs: input.auditRefs ?? [],
    resource_state_snapshot: input.resourceStateSnapshot ?? "active"
  },
  runtime_target: {
    target_ref: `target_${input.requestRef}`,
    domain: "www.xiaohongshu.com",
    page: input.targetPage ?? "search_result_tab",
    tab_id: input.targetTabId
  }
});

describe("native messaging legacy loopback runtime", () => {
  it("keeps xhs.search observability page_state aligned with the shared contract", async () => {
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-legacy-observability-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused",
          approval_record: {
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
          }
        }
      }
    });

    expect(result.payload).toMatchObject({
      execution_audit: null,
      observability: {
        page_state: {
          observation_status: "complete"
        }
      }
    });
    expect(result.payload.observability).not.toHaveProperty("execution_audit");
  });

  it("blocks stale approval linkage in live loopback bundles", async () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-loopback-custom-approval-001",
      "custom-approval-001"
    );
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-custom-approval-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
            requestRef: "upstream_loopback_custom_approval_001",
            targetTabId: 32,
            profileRef: "loopback_profile",
            approvalRefs: ["approval_admission_external_001"],
            auditRefs: ["audit_admission_external_001"]
          }),
          approval_record: {
            approval_id: "gate_appr_custom_run-loopback-custom-approval-001",
            decision_id: "gate_decision_custom_run-loopback-custom-approval-001",
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
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        execution_audit: expect.objectContaining({
          audit_ref: `exec_audit_${decisionId}`,
          request_ref: "upstream_loopback_custom_approval_001",
          request_admission_decision: "blocked",
          compatibility_refs: expect.objectContaining({
            approval_admission_ref: null,
            audit_admission_ref: null,
            approval_record_ref: null,
            audit_record_ref: `gate_evt_${decisionId}`
          }),
          risk_signals: expect.arrayContaining([
            "MANUAL_CONFIRMATION_MISSING",
            "AUDIT_RECORD_MISSING"
          ])
        }),
        gate_outcome: expect.objectContaining({
          decision_id: decisionId,
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining([
            "MANUAL_CONFIRMATION_MISSING",
            "AUDIT_RECORD_MISSING"
          ])
        }),
        approval_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        }),
        audit_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        })
      })
    );
    expect(result.payload.observability).toMatchObject({
      failure_site: {
        summary: "MANUAL_CONFIRMATION_MISSING"
      }
    });
    expect(result.payload.observability).not.toHaveProperty("execution_audit");
  });

  it("keeps approval_id null in blocked loopback gate bundles without approval", async () => {
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      "run-loopback-no-approval-001",
      "no-approval-001"
    );
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId: "run-loopback-no-approval-001",
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 33,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "paused"
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toMatchObject({
      approval_record: {
        approval_id: null
      },
      audit_record: {
        approval_id: null
      }
    });
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: decisionId
        }),
        approval_record: expect.objectContaining({
          decision_id: decisionId
        }),
        audit_record: expect.objectContaining({
          decision_id: decisionId
        })
      })
    );
  });

  it("keeps live_read_limited approved when caller provides matching audit linkage", async () => {
    const runId = "run-loopback-live-limited-001";
    const requestId = "issue209-live-limited-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "live-limited-001"
    );
    const admissionContext = createApprovedReadAdmissionContext({
      runId,
      requestId,
      targetTabId: 33,
      requestedExecutionMode: "live_read_limited",
      riskState: "limited"
    });
    const approvalAdmissionRef = String(
      admissionContext.approval_admission_evidence.approval_admission_ref
    );
    const auditAdmissionRef = String(admissionContext.audit_admission_evidence.audit_admission_ref);
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 33,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
            requestRef: `upstream_req_${requestId}`,
            targetTabId: 33,
            profileRef: "loopback_profile",
            approvalRefs: [approvalAdmissionRef],
            auditRefs: [auditAdmissionRef],
            resourceStateSnapshot: "cool_down"
          }),
          approval_record: {
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
          },
          admission_context: admissionContext,
          audit_record: {
            event_id: "audit-live-read-limited-loopback-001",
            decision_id: decisionId,
            approval_id: approvalId,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 33,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          execution_audit: expect.objectContaining({
            audit_ref: `exec_audit_${decisionId}`,
            request_ref: `upstream_req_${requestId}`,
            request_admission_decision: "allowed",
            consumed_inputs: {
              action_request_ref: `upstream_req_${requestId}`,
              resource_binding_ref: `binding_upstream_req_${requestId}`,
              authorization_grant_ref: `grant_upstream_req_${requestId}`,
              runtime_target_ref: `target_upstream_req_${requestId}`
            },
            compatibility_refs: expect.objectContaining({
              approval_admission_ref: approvalAdmissionRef,
              audit_admission_ref: auditAdmissionRef
            }),
            risk_signals: expect.not.arrayContaining(["LIVE_MODE_APPROVED"])
          }),
          approval_record: expect.objectContaining({
            approval_id: approvalId,
            decision_id: decisionId
          }),
          audit_record: expect.objectContaining({
            decision_id: decisionId,
            gate_decision: "allowed",
            requested_execution_mode: "live_read_limited",
            effective_execution_mode: "live_read_limited"
          }),
          gate_outcome: expect.objectContaining({
            decision_id: decisionId,
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          })
        })
      })
    );
    expect(result.payload.observability).toMatchObject({
      page_state: {
        observation_status: "complete"
      }
    });
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          consumer_gate_result: expect.objectContaining({
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          })
        })
      })
    );
  });

  it("keeps canonical execution_audit on execution failures without leaking into observability", async () => {
    const runId = "run-loopback-live-read-failure-001";
    const requestId = "issue209-live-read-failure-001";
    const targetTabId = 37;
    const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
      runId,
      "live-read-failure-001"
    );
    const admissionContext = createApprovedReadAdmissionContext({
      runId,
      requestId,
      targetTabId,
      requestedExecutionMode: "live_read_limited",
      riskState: "limited"
    });
    const approvalAdmissionRef = String(
      admissionContext.approval_admission_evidence.approval_admission_ref
    );
    const auditAdmissionRef = String(admissionContext.audit_admission_evidence.audit_admission_ref);
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "login_required",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: targetTabId,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          upstream_authorization_request: buildCanonicalReadAuthorizationRequest({
            requestRef: `upstream_req_${requestId}`,
            targetTabId,
            profileRef: "loopback_profile",
            approvalRefs: [approvalAdmissionRef],
            auditRefs: [auditAdmissionRef],
            resourceStateSnapshot: "cool_down"
          }),
          approval_record: {
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
          },
          admission_context: admissionContext,
          audit_record: {
            event_id: `audit-${requestId}`,
            decision_id: decisionId,
            approval_id: `gate_appr_${decisionId}`,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: targetTabId,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        execution_audit: expect.objectContaining({
          audit_ref: `exec_audit_${decisionId}`,
          request_ref: `upstream_req_${requestId}`,
          request_admission_decision: "allowed",
          compatibility_refs: expect.objectContaining({
            approval_admission_ref: approvalAdmissionRef,
            audit_admission_ref: auditAdmissionRef
          }),
          risk_signals: expect.not.arrayContaining(["LIVE_MODE_APPROVED"])
        }),
        details: expect.objectContaining({
          reason: "SESSION_EXPIRED"
        })
      })
    );
    expect(result.payload.observability).toMatchObject({
      failure_site: {
        summary: "login_required"
      }
    });
    expect(result.payload.observability).not.toHaveProperty("execution_audit");
  });

  it("blocks loopback live read when audit_record linkage mismatches", async () => {
    const runId = "run-loopback-audit-linkage-mismatch-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "audit-linkage-mismatch-001"
    );
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: "issue209-live-audit-linkage-mismatch-001",
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 33,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          approval_record: {
            approval_id: approvalId,
            decision_id: decisionId,
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
          },
          audit_record: {
            event_id: `audit-${decisionId}`,
            decision_id: "gate_decision_mismatch",
            approval_id: "gate_appr_mismatch",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 33,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-audit-linkage-mismatch-001",
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: decisionId,
          gate_decision: "blocked",
          gate_reasons: expect.arrayContaining(["AUDIT_RECORD_MISSING"])
        }),
        approval_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        }),
        audit_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        })
      })
    );
  });

  it("preserves provided invocation linkage when caller retries without request_id", async () => {
    const runId = "run-loopback-live-limited-retry-001";
    const requestId = "issue209-live-limited-retry-001";
    const decisionId = "gate_decision_issue209-gate-run-loopback-live-limited-retry-001-001";
    const approvalId = `gate_appr_${decisionId}`;
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        gate_invocation_id: "issue209-gate-run-loopback-live-limited-retry-001-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 34,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: {
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
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            targetTabId: 34,
            requestedExecutionMode: "live_read_limited",
            riskState: "limited",
            decisionId,
            approvalId
          }),
          audit_record: {
            event_id: "audit-live-read-limited-loopback-retry-001",
            decision_id: decisionId,
            approval_id: approvalId,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 34,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          gate_outcome: expect.objectContaining({
            decision_id: decisionId,
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed"
          }),
          approval_record: expect.objectContaining({
            decision_id: decisionId,
            approval_id: approvalId
          }),
          audit_record: expect.objectContaining({
            decision_id: decisionId,
            approval_id: approvalId
          }),
          gate_input: expect.objectContaining({
            admission_context: expect.objectContaining({
              approval_admission_evidence: expect.objectContaining({
                decision_id: decisionId
              }),
              audit_admission_evidence: expect.objectContaining({
                decision_id: decisionId
              })
            })
          })
        })
      })
    );
  });

  it.each([
    {
      command: "xhs.detail",
      abilityId: "xhs.note.detail.v1",
      input: { note_id: "note-loopback-001" },
      targetPage: "explore_detail_tab"
    },
    {
      command: "xhs.user_home",
      abilityId: "xhs.user.home.v1",
      input: { user_id: "user-loopback-001" },
      targetPage: "profile_tab"
    }
  ])(
    "applies the same live_read_limited gate bundle to $command",
    async ({ command, abilityId, input, targetPage }) => {
      const runId = `run-${command.replace(".", "-")}-live-limited-001`;
      const requestId = `${command.replace(".", "-")}-live-limited-001`;
      const targetTabId = 36;
      const { gateInvocationId, decisionId } = createIssue209InvocationLinkage(
        runId,
        `${command.replace(".", "-")}-live-limited-001`
      );
      const bridge = new NativeMessagingBridge({
        transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
      });

      const result = await bridge.runCommand({
        runId,
        profile: "profile-a",
        cwd: "/tmp",
        command,
        params: {
          request_id: requestId,
          gate_invocation_id: gateInvocationId,
          ability: {
            id: abilityId,
            layer: "L3",
            action: "read"
          },
          input,
          options: {
            simulate_result: "success",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: targetTabId,
            target_page: targetPage,
            issue_scope: "issue_209",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            limited_read_rollout_ready_true: true,
            approval_record: {
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
            },
            admission_context: createApprovedReadAdmissionContext({
              runId,
              requestId,
              targetTabId,
              targetPage,
              requestedExecutionMode: "live_read_limited",
              riskState: "limited"
            }),
            audit_record: {
              event_id: `audit-${requestId}`,
              decision_id: decisionId,
              approval_id: `gate_appr_${decisionId}`,
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: targetTabId,
              target_page: targetPage,
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              gate_decision: "allowed",
              recorded_at: "2026-03-23T10:00:30Z"
            }
          }
        }
      });

      expect(result.ok).toBe(true);
      expect(result.payload).toEqual(
        expect.objectContaining({
          summary: expect.objectContaining({
            gate_input: expect.objectContaining({
              target_page: targetPage,
              requested_execution_mode: "live_read_limited"
            }),
            gate_outcome: expect.objectContaining({
              decision_id: decisionId,
              effective_execution_mode: "live_read_limited",
              gate_decision: "allowed",
              gate_reasons: ["LIVE_MODE_APPROVED"]
            }),
            audit_record: expect.objectContaining({
              decision_id: decisionId,
              requested_execution_mode: "live_read_limited",
              effective_execution_mode: "live_read_limited"
            })
          })
        })
      );
    }
  );

  it("ignores stale caller audit linkage in loopback bundles when admission evidence matches", async () => {
    const runId = "run-loopback-live-limited-stale-001";
    const requestId = "issue209-live-limited-current-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "live-limited-stale-001"
    );
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 34,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: {
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
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            targetTabId: 34,
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          }),
          audit_record: {
            event_id: "gate_evt_gate_decision_issue209-live-limited-previous-001",
            decision_id: "gate_decision_issue209-live-limited-previous-001",
            approval_id: "gate_appr_gate_decision_issue209-live-limited-previous-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 34,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.payload).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          gate_outcome: expect.objectContaining({
            decision_id: decisionId,
            effective_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            gate_reasons: ["LIVE_MODE_APPROVED"]
          }),
          audit_record: expect.objectContaining({
            decision_id: decisionId,
            gate_decision: "allowed",
            issue_scope: "issue_209"
          }),
          approval_record: expect.objectContaining({
            approval_id: approvalId
          })
        })
      })
    );
  });

  it("blocks stale admission evidence in loopback bundles even when caller records match current decision", async () => {
    const runId = "run-loopback-live-admission-stale-001";
    const requestId = "issue209-live-admission-current-001";
    const { gateInvocationId, decisionId, approvalId } = createIssue209InvocationLinkage(
      runId,
      "live-admission-stale-001"
    );
    const bridge = new NativeMessagingBridge({
      transport: createInMemoryLoopbackTransport("host>background>content-script>background>host")
    });

    const result = await bridge.runCommand({
      runId,
      profile: "profile-a",
      cwd: "/tmp",
      command: "xhs.search",
      params: {
        request_id: requestId,
        gate_invocation_id: gateInvocationId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 35,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          approval_record: {
            approval_id: approvalId,
            decision_id: decisionId,
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
          },
          admission_context: createApprovedReadAdmissionContext({
            runId: "run-loopback-live-admission-stale-legacy-001",
            requestId,
            targetTabId: 35,
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          }),
          audit_record: {
            event_id: "audit-live-read-limited-loopback-stale-admission-001",
            decision_id: decisionId,
            approval_id: approvalId,
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 35,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.payload).toEqual(
      expect.objectContaining({
        gate_outcome: expect.objectContaining({
          decision_id: decisionId,
          gate_decision: "blocked",
          effective_execution_mode: "recon",
          gate_reasons: expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING", "AUDIT_RECORD_MISSING"])
        }),
        approval_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        }),
        audit_record: expect.objectContaining({
          approval_id: null,
          decision_id: decisionId
        })
      })
    );
  });
});
