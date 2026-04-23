import { describe, expect, it } from "vitest";
import {
  ensureIssue209AdmissionContextForContract,
  normalizeGateOptionsForContract,
  parseAbilityEnvelopeForContract,
  parseXhsCommandInputForContract,
  parseDetailInputForContract,
  parseSearchInputForContract,
  parseUserHomeInputForContract,
  prepareIssue209LiveReadContract,
  resolveIssue209CommandRequestIdForContract,
  resolveIssue209GateInvocationIdForContract
} from "../xhs-input.js";

describe("xhs-input", () => {
  it("accepts FR-0023 four objects without a legacy requested_execution_mode", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {},
      action_request: {
        request_ref: "upstream_req_001",
        action_name: "xhs.read_search_results",
        action_category: "read"
      },
      resource_binding: {
        binding_ref: "binding_001",
        resource_kind: "anonymous_context",
        profile_ref: null,
        binding_constraints: {
          anonymous_required: true,
          reuse_logged_in_context_forbidden: true
        }
      },
      authorization_grant: {
        grant_ref: "grant_001",
        allowed_actions: ["xhs.read_search_results"],
        binding_scope: {
          allowed_resource_kinds: ["anonymous_context"],
          allowed_profile_refs: []
        },
        target_scope: {
          allowed_domains: ["www.xiaohongshu.com"],
          allowed_pages: ["search_result_tab"]
        },
        resource_state_snapshot: "paused"
      },
      runtime_target: {
        target_ref: "target_001",
        domain: "www.xiaohongshu.com",
        page: "search_result_tab",
        tab_id: 32
      }
    });

    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        runtimeProfile: "local-profile",
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toMatchObject({
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 32,
      targetPage: "search_result_tab",
      requestedExecutionMode: "dry_run"
    });
  });

  it("does not hard-bind profile_session profile_ref to the local runtime profile", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {},
      action_request: {
        request_ref: "upstream_req_profile_session_001",
        action_name: "xhs.read_search_results",
        action_category: "read"
      },
      resource_binding: {
        binding_ref: "binding_profile_session_001",
        resource_kind: "profile_session",
        profile_ref: "shared-anon-profile"
      },
      authorization_grant: {
        grant_ref: "grant_profile_session_001",
        allowed_actions: ["xhs.read_search_results"],
        binding_scope: {
          allowed_resource_kinds: ["profile_session"],
          allowed_profile_refs: ["shared-anon-profile"]
        },
        target_scope: {
          allowed_domains: ["www.xiaohongshu.com"],
          allowed_pages: ["search_result_tab"]
        },
        resource_state_snapshot: "paused"
      },
      runtime_target: {
        target_ref: "target_profile_session_001",
        domain: "www.xiaohongshu.com",
        page: "search_result_tab",
        tab_id: 18
      }
    });

    const gate = normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
      command: "xhs.search",
      abilityAction: envelope.ability.action,
      runtimeProfile: "local-profile-that-does-not-match-profile-ref",
      upstreamAuthorization: envelope.upstreamAuthorization
    });

    expect(gate.requestedExecutionMode).toBe("dry_run");
    expect(gate.options.upstream_authorization_request).toMatchObject({
      resource_binding: {
        resource_kind: "profile_session",
        profile_ref: "shared-anon-profile"
      }
    });
  });

  it("does not fabricate live admission evidence from authorization_grant approval_refs or audit_refs", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {},
      action_request: {
        request_ref: "upstream_req_live_refs_001",
        action_name: "xhs.read_search_results",
        action_category: "read"
      },
      resource_binding: {
        binding_ref: "binding_live_refs_001",
        resource_kind: "profile_session",
        profile_ref: "profile-allowed-001"
      },
      authorization_grant: {
        grant_ref: "grant_live_refs_001",
        allowed_actions: ["xhs.read_search_results"],
        binding_scope: {
          allowed_resource_kinds: ["profile_session"],
          allowed_profile_refs: ["profile-allowed-001"]
        },
        target_scope: {
          allowed_domains: ["www.xiaohongshu.com"],
          allowed_pages: ["search_result_tab"]
        },
        resource_state_snapshot: "active",
        approval_refs: ["approval_admission_external_001"],
        audit_refs: ["audit_admission_external_001"]
      },
      runtime_target: {
        target_ref: "target_live_refs_001",
        domain: "www.xiaohongshu.com",
        page: "search_result_tab",
        tab_id: 55
      }
    });
    const gate = normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
      command: "xhs.search",
      abilityAction: envelope.ability.action,
      runtimeProfile: "profile-allowed-001",
      upstreamAuthorization: envelope.upstreamAuthorization
    });

    expect(gate.requestedExecutionMode).toBe("live_read_high_risk");
    expect(
      ensureIssue209AdmissionContextForContract({
        options: gate.options,
        runId: "run-cli-live-refs-001",
        requestId: "issue209-live-refs-001",
        gateInvocationId: "issue209-gate-run-cli-live-refs-001-001",
        sessionId: "nm-session-live-refs-001"
      })
    ).not.toHaveProperty("admission_context");
  });

  it("parses ability envelope and normalizes xhs.search input", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      gate_invocation_id: "issue209-gate-envelope-parse-001",
      input: {
        query: "  露营  ",
        limit: 8,
        page: 2,
        search_id: "  search-1  ",
        sort: "  general  ",
        note_type: 3
      },
      options: {
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 7,
        target_page: "search_result",
        requested_execution_mode: "dry_run"
      }
    });

    expect(envelope.ability).toEqual({
      id: "xhs.note.search.v1",
      layer: "L3",
      action: "read"
    });
    expect(envelope.gateInvocationId).toBe("issue209-gate-envelope-parse-001");
    expect(parseSearchInputForContract(envelope.input, envelope.ability.id, envelope.options, envelope.ability.action)).toEqual({
      query: "露营",
      limit: 8,
      page: 2,
      search_id: "search-1",
      sort: "general",
      note_type: 3
    });
    expect(normalizeGateOptionsForContract(envelope.options, envelope.ability.id)).toMatchObject({
      targetDomain: "creator.xiaohongshu.com",
      targetTabId: 7,
      targetPage: "search_result",
      requestedExecutionMode: "dry_run"
    });
  });

  it("rejects invalid top-level gate_invocation_id", () => {
    try {
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        gate_invocation_id: "   ",
        input: {
          query: "露营"
        },
        options: {}
      });
      throw new Error("expected invalid gate_invocation_id to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "GATE_INVOCATION_ID_INVALID"
        }
      });
    }
  });

  it("permits issue_208 editor_input validation without query", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.editor.input.v1", layer: "L3", action: "write" },
      input: {},
      options: {
        issue_scope: "issue_208",
        action_type: "write",
        requested_execution_mode: "live_write",
        validation_action: "editor_input",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 11,
        target_page: "creator_publish_tab"
      }
    });

    expect(parseSearchInputForContract(envelope.input, envelope.ability.id, envelope.options, envelope.ability.action)).toEqual({});
  });

  it("parses xhs.detail input and trims note_id", () => {
    expect(
      parseDetailInputForContract(
        {
          note_id: "  note-001  "
        },
        "xhs.note.detail.v1"
      )
    ).toEqual({
      note_id: "note-001"
    });
  });

  it("parses xhs.user_home input and trims user_id", () => {
    expect(
      parseUserHomeInputForContract(
        {
          user_id: "  user-001  "
        },
        "xhs.user.home.v1"
      )
    ).toEqual({
      user_id: "user-001"
    });
  });

  it("dispatches xhs.detail command input through the shared contract parser", () => {
    expect(
      parseXhsCommandInputForContract({
        command: "xhs.detail",
        abilityId: "xhs.note.detail.v1",
        abilityAction: "read",
        payload: {
          note_id: "  note-001  "
        },
        options: {}
      })
    ).toEqual({
      note_id: "note-001"
    });
  });

  it("does not synthesize issue_209 live admission_context from an incomplete approval-only source", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
      },
      runId: "run-cli-issue209-live-001",
      requestId: "issue209-live-limited-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-live-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("rebinds caller-provided admission_context to the active session", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_existing",
            request_id: "issue209-live-session-001",
            run_id: "run-cli-issue209-live-session-001",
            session_id: "nm-session-stale-209",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
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
            audit_admission_ref: "audit_admission_existing",
            request_id: "issue209-live-session-001",
            run_id: "run-cli-issue209-live-session-001",
            session_id: "nm-session-stale-209",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:05:00Z"
          }
        },
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
      },
      runId: "run-cli-issue209-live-session-001",
      requestId: "issue209-live-session-001",
      sessionId: "nm-session-real-209",
      gateInvocationId: "issue209-gate-run-cli-issue209-live-session-001-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        session_id: "nm-session-real-209"
      },
      audit_admission_evidence: {
        session_id: "nm-session-real-209"
      }
    });
  });

  it("synthesizes issue_209 live admission_context from a complete formal source", () => {
    const decisionId = "gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001";
    const approvalId = "gate_appr_gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001";
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
        audit_record: {
          event_id: "gate_evt_formal_source_001",
          decision_id: decisionId,
          approval_id: approvalId,
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-001",
      requestId: "issue209-live-formal-source-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-formal-source-001-001",
        decision_id: "gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001",
        approval_id:
          "gate_appr_gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001",
        request_id: "issue209-live-formal-source-001",
        run_id: "run-cli-issue209-formal-source-001",
        session_id: "nm-session-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-formal-source-001-001",
        decision_id: "gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001",
        approval_id:
          "gate_appr_gate_decision_issue209-gate-run-cli-issue209-formal-source-001-001",
        request_id: "issue209-live-formal-source-001",
        run_id: "run-cli-issue209-formal-source-001",
        session_id: "nm-session-001",
        risk_state: "limited",
        audited_checks: {
          target_domain_confirmed: true,
          target_tab_confirmed: true,
          target_page_confirmed: true,
          risk_state_checked: true,
          action_type_confirmed: true
        }
      }
    });
  });

  it("does not rebuild legacy admission refs from formal sources when canonical grant refs are already present", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_mixed_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_mixed_001",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_mixed_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_mixed_001"],
            audit_refs: ["audit_admission_external_mixed_001"],
            resource_state_snapshot: "cool_down",
            granted_at: "2026-04-15T09:05:00.000Z"
          },
          runtime_target: {
            target_ref: "target_issue209_mixed_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_mixed_001",
          decision_id: "gate_decision_issue209-gate-run-cli-issue209-mixed-001-001",
          approval_id: "gate_appr_gate_decision_issue209-gate-run-cli-issue209-mixed-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-mixed-001",
      requestId: "issue209-live-mixed-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-mixed-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("does not rebuild legacy admission_context when canonical grant uses action_request.requested_at as approval time", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_mixed_missing_granted_at_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_mixed_missing_granted_at_001",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_mixed_missing_granted_at_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_mixed_missing_granted_at_001"],
            audit_refs: ["audit_admission_external_mixed_missing_granted_at_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_mixed_missing_granted_at_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_mixed_missing_granted_at_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-mixed-missing-granted-at-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-mixed-missing-granted-at-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-mixed-missing-granted-at-001",
      requestId: "issue209-live-mixed-missing-granted-at-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-mixed-missing-granted-at-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("keeps formal admission fallback when canonical grant refs are present but unusable", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_mixed_unusable_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_mixed_unusable_001",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_mixed_unusable_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["creator.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_mixed_unusable_001"],
            audit_refs: ["audit_admission_external_mixed_unusable_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_mixed_unusable_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_mixed_unusable_001",
          decision_id: "gate_decision_issue209-gate-run-cli-issue209-mixed-unusable-001-001",
          approval_id: "gate_appr_gate_decision_issue209-gate-run-cli-issue209-mixed-unusable-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-mixed-unusable-001",
      requestId: "issue209-live-mixed-unusable-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-mixed-unusable-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-mixed-unusable-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-mixed-unusable-001-001"
      }
    });
  });

  it("keeps formal admission fallback when only legacy target fields make the canonical grant look in-scope", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_target_fallback_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_target_fallback_001",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_target_fallback_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_target_fallback_001"],
            audit_refs: ["audit_admission_external_target_fallback_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_target_fallback_001",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_target_fallback_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-target-fallback-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-target-fallback-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-target-fallback-001",
      requestId: "issue209-live-target-fallback-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-target-fallback-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-target-fallback-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-target-fallback-001-001"
      }
    });
  });

  it("keeps formal admission fallback when upstream runtime_target drifts away from the current verified target", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "creator.xiaohongshu.com",
        target_tab_id: 41,
        target_page: "creator_publish_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_target_drift_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_target_drift_001",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_target_drift_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_target_drift_001"],
            audit_refs: ["audit_admission_external_target_drift_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_target_drift_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_target_drift_001",
          decision_id: "gate_decision_issue209-gate-run-cli-issue209-target-drift-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-target-drift-001-001",
          issue_scope: "issue_209",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 41,
          target_page: "creator_publish_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-target-drift-001",
      requestId: "issue209-live-target-drift-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-target-drift-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-target-drift-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-target-drift-001-001"
      }
    });
  });

  it("keeps formal admission fallback when canonical anonymous binding constraints are not executable", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_invalid_anon_binding_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_invalid_anon_binding_001",
            resource_kind: "anonymous_context"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_invalid_anon_binding_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["anonymous_context"],
              allowed_profile_refs: []
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_invalid_anon_binding_001"],
            audit_refs: ["audit_admission_external_invalid_anon_binding_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_invalid_anon_binding_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_invalid_anon_binding_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-invalid-anon-binding-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-invalid-anon-binding-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-invalid-anon-binding-001",
      requestId: "issue209-live-invalid-anon-binding-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-invalid-anon-binding-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-invalid-anon-binding-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-invalid-anon-binding-001-001"
      }
    });
  });

  it("keeps formal admission fallback when canonical resource_binding.resource_kind is unsupported", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            request_ref: "upstream_req_issue209_invalid_resource_kind_001",
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            binding_ref: "binding_issue209_invalid_resource_kind_001",
            resource_kind: "unsupported_kind"
          },
          authorization_grant: {
            grant_ref: "grant_issue209_invalid_resource_kind_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["unsupported_kind"],
              allowed_profile_refs: []
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_invalid_resource_kind_001"],
            audit_refs: ["audit_admission_external_invalid_resource_kind_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            target_ref: "target_issue209_invalid_resource_kind_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_invalid_resource_kind_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-invalid-resource-kind-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-invalid-resource-kind-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-invalid-resource-kind-001",
      requestId: "issue209-live-invalid-resource-kind-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-invalid-resource-kind-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-invalid-resource-kind-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-invalid-resource-kind-001-001"
      }
    });
  });

  it("keeps formal admission fallback when canonical four-object refs are missing", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        upstream_authorization_request: {
          action_request: {
            action_name: "xhs.read_search_results",
            action_category: "read",
            requested_at: "2026-04-15T09:00:00.000Z"
          },
          resource_binding: {
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_missing_refs_001"],
            audit_refs: ["audit_admission_external_missing_refs_001"],
            resource_state_snapshot: "cool_down"
          },
          runtime_target: {
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_missing_refs_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-missing-refs-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-missing-refs-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-missing-refs-001",
      requestId: "issue209-live-missing-refs-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-missing-refs-001-001",
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref:
          "approval_admission_issue209-gate-run-cli-issue209-missing-refs-001-001"
      },
      audit_admission_evidence: {
        audit_admission_ref:
          "audit_admission_issue209-gate-run-cli-issue209-missing-refs-001-001"
      }
    });
  });

  it("does not synthesize issue_209 live admission_context when the audit source decision linkage is stale", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
        audit_record: {
          event_id: "gate_evt_formal_source_stale_decision_001",
          decision_id: "gate_decision_stale_issue209_formal_source_001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-formal-source-stale-decision-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-stale-decision-001",
      requestId: "issue209-live-formal-source-stale-decision-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-stale-decision-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("does not synthesize issue_209 live admission_context when the audit source approval linkage is stale", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
        audit_record: {
          event_id: "gate_evt_formal_source_stale_approval_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-formal-source-stale-approval-001-001",
          approval_id: "gate_appr_gate_decision_stale_issue209_formal_source_001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-stale-approval-001",
      requestId: "issue209-live-formal-source-stale-approval-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-stale-approval-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("does not synthesize issue_209 live admission_context when the audit source linkage is half-present", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
        audit_record: {
          event_id: "gate_evt_formal_source_half_linkage_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-formal-source-half-linkage-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-half-linkage-001",
      requestId: "issue209-live-formal-source-half-linkage-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-half-linkage-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("does not synthesize issue_209 live admission_context when the audit source lacks audited_checks", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
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
        audit_record: {
          event_id: "gate_evt_formal_source_missing_checks_001",
          decision_id:
            "gate_decision_issue209-gate-run-cli-issue209-formal-source-missing-checks-001-001",
          approval_id:
            "gate_appr_gate_decision_issue209-gate-run-cli-issue209-formal-source-missing-checks-001-001",
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-missing-checks-001",
      requestId: "issue209-live-formal-source-missing-checks-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-missing-checks-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("replaces stale caller admission_context with current linkage when formal legacy execution artifacts are complete", () => {
    const decisionId =
      "gate_decision_issue209-gate-run-cli-issue209-formal-source-conflict-001-001";
    const approvalId = `gate_appr_${decisionId}`;
    const gateInvocationId = "issue209-gate-run-cli-issue209-formal-source-conflict-001-001";
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_conflict",
            request_id: "issue209-live-formal-source-conflict-001",
            run_id: "run-cli-issue209-formal-source-conflict-stale",
            session_id: "nm-session-stale",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
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
            audit_admission_ref: "audit_admission_conflict",
            request_id: "issue209-live-formal-source-conflict-001",
            run_id: "run-cli-issue209-formal-source-conflict-stale",
            session_id: "nm-session-stale",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:05:00Z"
          }
        },
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
        audit_record: {
          event_id: "gate_evt_formal_source_conflict_001",
          decision_id: decisionId,
          approval_id: approvalId,
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          gate_decision: "allowed",
          audited_checks: {
            target_domain_confirmed: true,
            target_tab_confirmed: true,
            target_page_confirmed: true,
            risk_state_checked: true,
            action_type_confirmed: true
          },
          recorded_at: "2026-03-23T10:05:00Z"
        }
      },
      runId: "run-cli-issue209-formal-source-conflict-001",
      requestId: "issue209-live-formal-source-conflict-001",
      gateInvocationId,
      sessionId: "nm-session-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref: `approval_admission_${gateInvocationId}`,
        decision_id: decisionId,
        approval_id: approvalId,
        request_id: "issue209-live-formal-source-conflict-001",
        run_id: "run-cli-issue209-formal-source-conflict-001",
        session_id: "nm-session-001",
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        approved: true,
        approver: "qa-reviewer",
        approved_at: "2026-03-23T10:00:00Z",
        recorded_at: "2026-03-23T10:00:00Z"
      },
      audit_admission_evidence: {
        audit_admission_ref: `audit_admission_${gateInvocationId}`,
        decision_id: decisionId,
        approval_id: approvalId,
        request_id: "issue209-live-formal-source-conflict-001",
        run_id: "run-cli-issue209-formal-source-conflict-001",
        session_id: "nm-session-001",
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        recorded_at: "2026-03-23T10:05:00Z"
      }
    });
  });

  it("drops stale caller admission_context when canonical live-read only carries four-object grant input", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_high_risk",
        risk_state: "allowed",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_stale_only",
            request_id: "issue209-live-stale-only-001",
            run_id: "run-cli-issue209-stale-only-stale",
            session_id: "nm-session-stale",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
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
            audit_admission_ref: "audit_admission_stale_only",
            request_id: "issue209-live-stale-only-001",
            run_id: "run-cli-issue209-stale-only-stale",
            session_id: "nm-session-stale",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
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
            recorded_at: "2026-03-23T10:05:00Z"
          }
        }
      },
      runId: "run-cli-issue209-stale-only-001",
      requestId: "issue209-live-stale-only-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-stale-only-001-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("synthesizes a canonical request_id for issue_209 live reads when caller omits it", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        issue_scope: "issue_209",
        requested_execution_mode: "live_read_limited"
      },
      requestId: null
    });

    expect(requestId).toEqual(expect.stringMatching(/^issue209-live-/));
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "profile_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited"
      },
      runId: "run-cli-issue209-live-003",
      requestId,
      gateInvocationId: "issue209-gate-run-cli-issue209-live-003-001",
      sessionId: "nm-session-001"
    });

    expect(options).not.toHaveProperty("admission_context");
  });

  it("does not treat omitted issue_scope as issue_209 for live read id synthesis", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        requested_execution_mode: "live_read_limited"
      },
      requestId: null
    });
    const gateInvocationId = resolveIssue209GateInvocationIdForContract({
      options: {
        requested_execution_mode: "live_read_limited"
      },
      runId: "run-cli-issue209-live-004"
    });

    expect(requestId).toBeNull();
    expect(gateInvocationId).toBeNull();
  });

  it("canonicalizes issue_scope for xhs live reads from the read-path request shape", () => {
    expect(
      normalizeGateOptionsForContract(
        {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        },
        "xhs.note.search.v1"
      )
    ).toMatchObject({
      options: {
        issue_scope: "issue_209"
      }
    });
  });

  it("generates a new gate_invocation_id for issue_209 live reads only when caller omits it", () => {
    const gateInvocationId = resolveIssue209GateInvocationIdForContract({
      options: {
        issue_scope: "issue_209",
        requested_execution_mode: "live_read_limited",
        admission_context: {
          approval_admission_evidence: {
            decision_id: "gate_decision_external"
          }
        }
      },
      runId: "run-cli-issue209-live-007"
    });

    expect(gateInvocationId).toEqual(
      expect.stringMatching(/^issue209-gate-run-cli-issue209-live-007-/)
    );
  });

  it("preserves caller-provided gate_invocation_id for issue_209 live reads", () => {
    expect(
      resolveIssue209GateInvocationIdForContract({
        options: {
          issue_scope: "issue_209",
          requested_execution_mode: "live_read_high_risk"
        },
        runId: "run-cli-issue209-live-007b",
        gateInvocationId: "issue209-gate-explicit-007b"
      })
    ).toBe("issue209-gate-explicit-007b");
  });

  it("does not recover request_id from caller admission_context", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        issue_scope: "issue_209",
        requested_execution_mode: "live_read_limited",
        admission_context: {
          approval_admission_evidence: {
            request_id: "issue209-live-existing-001",
            decision_id: "gate_decision_external"
          },
          audit_admission_evidence: {
            request_id: "issue209-live-existing-001",
            decision_id: "gate_decision_external"
          }
        }
      },
      requestId: null,
      runId: "run-cli-issue209-live-005"
    });

    expect(requestId).toEqual(expect.stringMatching(/^issue209-live-/));
    expect(requestId).not.toBe("issue209-live-existing-001");
  });

  it("prepares a single issue_209 live-read contract bundle", () => {
    const prepared = prepareIssue209LiveReadContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_existing",
            run_id: "run-cli-issue209-live-prepare-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
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
            audit_admission_ref: "audit_admission_existing",
            run_id: "run-cli-issue209-live-prepare-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:05:00Z"
          }
        }
      },
      runId: "run-cli-issue209-live-prepare-001",
      requestId: null,
      gateInvocationId: null,
      sessionId: "nm-session-001"
    });

    expect(prepared.commandRequestId).toEqual(expect.stringMatching(/^issue209-live-/));
    expect(prepared.gateInvocationId).toEqual(
      expect.stringMatching(/^issue209-gate-run-cli-issue209-live-prepare-001-/)
    );
    expect(prepared.options.admission_context).toMatchObject({
      approval_admission_evidence: {
        approval_admission_ref: "approval_admission_existing",
        session_id: "nm-session-001"
      },
      audit_admission_evidence: {
        audit_admission_ref: "audit_admission_existing",
        session_id: "nm-session-001"
      }
    });
  });

  it("canonicalizes caller-provided admission_context onto the current gate linkage", () => {
    const options = ensureIssue209AdmissionContextForContract({
      options: {
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        admission_context: {
          approval_admission_evidence: {
            approval_admission_ref: "approval_admission_existing",
            run_id: "run-cli-issue209-live-002",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
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
            audit_admission_ref: "audit_admission_existing",
            run_id: "run-cli-issue209-live-002",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            risk_state: "limited",
            audited_checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            },
            recorded_at: "2026-03-23T10:05:00Z"
          }
        }
      },
      runId: "run-cli-issue209-live-002",
      requestId: "issue209-live-limited-002",
      sessionId: "nm-session-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-live-002-001"
    });

    expect(options.admission_context).toEqual({
      approval_admission_evidence: {
        approval_admission_ref: "approval_admission_existing",
        decision_id: "gate_decision_issue209-gate-run-cli-issue209-live-002-001",
        approval_id: "gate_appr_gate_decision_issue209-gate-run-cli-issue209-live-002-001",
        request_id: "issue209-live-limited-002",
        run_id: "run-cli-issue209-live-002",
        session_id: "nm-session-001",
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
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
        audit_admission_ref: "audit_admission_existing",
        decision_id: "gate_decision_issue209-gate-run-cli-issue209-live-002-001",
        approval_id: "gate_appr_gate_decision_issue209-gate-run-cli-issue209-live-002-001",
        request_id: "issue209-live-limited-002",
        run_id: "run-cli-issue209-live-002",
        session_id: "nm-session-001",
        issue_scope: "issue_209",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 32,
        target_page: "search_result_tab",
        action_type: "read",
        requested_execution_mode: "live_read_limited",
        risk_state: "limited",
        audited_checks: {
          target_domain_confirmed: true,
          target_tab_confirmed: true,
          target_page_confirmed: true,
          risk_state_checked: true,
          action_type_confirmed: true
        },
        recorded_at: "2026-03-23T10:05:00Z"
      }
    });
  });
});
