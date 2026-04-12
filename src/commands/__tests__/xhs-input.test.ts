import { describe, expect, it } from "vitest";
import {
  ensureIssue209AdmissionContextForContract,
  normalizeGateOptionsForContract,
  parseAbilityEnvelopeForContract,
  parseXhsCommandInputForContract,
  parseDetailInputForContract,
  parseSearchInputForContract,
  parseUserHomeInputForContract,
  resolveIssue209CommandRequestIdForContract
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

  it("builds issue_209 live admission_context from the current approval record", () => {
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
      requestId: "issue209-live-limited-001"
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        decision_id: "gate_decision_run-cli-issue209-live-001_issue209-live-limited-001",
        approval_id: "gate_appr_gate_decision_run-cli-issue209-live-001_issue209-live-limited-001"
      },
      audit_admission_evidence: {
        decision_id: "gate_decision_run-cli-issue209-live-001_issue209-live-limited-001",
        approval_id: "gate_appr_gate_decision_run-cli-issue209-live-001_issue209-live-limited-001",
        risk_state: "limited"
      }
    });
  });

  it("uses the actual bridge session id when synthesizing admission_context", () => {
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
      runId: "run-cli-issue209-live-session-001",
      requestId: "issue209-live-session-001",
      sessionId: "nm-session-real-209"
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
      runId: "run-cli-issue209-live-003",
      requestId
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        decision_id: `gate_decision_run-cli-issue209-live-003_${requestId}`,
        approval_id: `gate_appr_gate_decision_run-cli-issue209-live-003_${requestId}`,
        target_page: "profile_tab"
      },
      audit_admission_evidence: {
        decision_id: `gate_decision_run-cli-issue209-live-003_${requestId}`,
        approval_id: `gate_appr_gate_decision_run-cli-issue209-live-003_${requestId}`,
        target_page: "profile_tab",
        risk_state: "limited"
      }
    });
  });

  it("treats omitted issue_scope as issue_209 for live read admission synthesis", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        requested_execution_mode: "live_read_limited"
      },
      requestId: null
    });

    expect(requestId).toEqual(expect.stringMatching(/^issue209-live-/));
    const options = ensureIssue209AdmissionContextForContract({
      options: {
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
      runId: "run-cli-issue209-live-004",
      requestId
    });

    expect(options.admission_context).toMatchObject({
      approval_admission_evidence: {
        issue_scope: "issue_209",
        decision_id: `gate_decision_run-cli-issue209-live-004_${requestId}`,
        approval_id: `gate_appr_gate_decision_run-cli-issue209-live-004_${requestId}`
      },
      audit_admission_evidence: {
        issue_scope: "issue_209",
        decision_id: `gate_decision_run-cli-issue209-live-004_${requestId}`,
        approval_id: `gate_appr_gate_decision_run-cli-issue209-live-004_${requestId}`,
        risk_state: "limited"
      }
    });
  });

  it("reuses caller admission decision linkage when request_id is omitted", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        issue_scope: "issue_209",
        requested_execution_mode: "live_read_limited",
        admission_context: {
          approval_admission_evidence: {
            decision_id: "gate_decision_run-cli-issue209-live-005_issue209-live-existing-001"
          },
          audit_admission_evidence: {
            decision_id: "gate_decision_run-cli-issue209-live-005_issue209-live-existing-001"
          }
        }
      },
      requestId: null,
      runId: "run-cli-issue209-live-005"
    });

    expect(requestId).toBe("issue209-live-existing-001");
  });

  it("does not synthesize a conflicting request_id when caller admission_context is not derivable", () => {
    const requestId = resolveIssue209CommandRequestIdForContract({
      options: {
        issue_scope: "issue_209",
        requested_execution_mode: "live_read_limited",
        admission_context: {
          approval_admission_evidence: {
            decision_id: "gate_decision_external"
          }
        }
      },
      requestId: null,
      runId: "run-cli-issue209-live-006"
    });

    expect(requestId).toBeNull();
  });

  it("keeps caller-provided admission_context unchanged", () => {
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
            decision_id: "gate_decision_external",
            approval_id: "gate_appr_external"
          }
        }
      },
      runId: "run-cli-issue209-live-002",
      requestId: "issue209-live-limited-002"
    });

    expect(options.admission_context).toEqual({
      approval_admission_evidence: {
        decision_id: "gate_decision_external",
        approval_id: "gate_appr_external"
      }
    });
  });
});
