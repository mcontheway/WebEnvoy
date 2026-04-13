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
  it("parses ability envelope and normalizes xhs.search input", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
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
        risk_state: "limited"
      }
    });
  });

  it("does not fall back to a complete formal source when caller admission_context conflicts", () => {
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
      runId: "run-cli-issue209-formal-source-conflict-001",
      requestId: "issue209-live-formal-source-conflict-001",
      gateInvocationId: "issue209-gate-run-cli-issue209-formal-source-conflict-001-001",
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

  it("always generates a new gate_invocation_id for issue_209 live reads", () => {
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
