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

const buildUpstreamAuthorizationRequest = (overrides?: Record<string, unknown>) => {
  const base = {
    action_request: {
      request_ref: "upstream_req_001",
      action_name: "xhs.read_search_results",
      action_category: "read",
      intent: "fetch_search_results",
      constraint_refs: ["grant_rule_search_read"],
      requested_at: "2026-04-14T10:00:00Z"
    },
    resource_binding: {
      binding_ref: "binding_001",
      resource_kind: "profile_session",
      profile_ref: "xhs_account_001",
      subject_ref: "subject_xhs_reader_01",
      account_ref: "account_xhs_reader_01"
    },
    authorization_grant: {
      grant_ref: "grant_001",
      allowed_actions: ["xhs.read_search_results"],
      binding_scope: {
        allowed_resource_kinds: ["profile_session"],
        allowed_profile_refs: ["xhs_account_001"]
      },
      target_scope: {
        allowed_domains: ["www.xiaohongshu.com"],
        allowed_pages: ["search_result_tab"]
      },
      resource_state_snapshot: "active",
      grant_constraints: {
        manual_approval_required: true
      },
      approval_refs: ["approval_admission_001"],
      audit_refs: ["audit_admission_001"],
      granted_at: "2026-04-14T10:00:00Z"
    },
    runtime_target: {
      target_ref: "target_001",
      domain: "www.xiaohongshu.com",
      page: "search_result_tab",
      tab_id: 924,
      url: "https://www.xiaohongshu.com/search_result?keyword=camping"
    }
  };

  return structuredClone({
    ...base,
    ...(overrides ?? {})
  }) as Record<string, unknown>;
};

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

  it("normalizes FR-0023 upstream authorization objects into canonical and legacy gate fields", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest()
    });

    expect(envelope.upstreamAuthorization).toMatchObject({
      action_request: {
        action_name: "xhs.read_search_results"
      },
      resource_binding: {
        binding_ref: "binding_001",
        resource_kind: "profile_session",
        profile_ref: "xhs_account_001"
      },
      authorization_grant: {
        resource_state_snapshot: "active"
      },
      runtime_target: {
        domain: "www.xiaohongshu.com",
        page: "search_result_tab",
        tab_id: 924
      }
    });

    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toMatchObject({
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 924,
      targetPage: "search_result_tab",
      requestedExecutionMode: "dry_run",
      options: {
        action_type: "read",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 924,
        target_page: "search_result_tab",
        upstream_authorization_request: {
          resource_binding: {
            binding_ref: "binding_001"
          }
        }
      }
    });
  });

  it("accepts matching legacy gate fields alongside FR-0023 upstream authorization objects", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        action_type: "read",
        target_domain: "www.xiaohongshu.com",
        target_tab_id: 924,
        target_page: "search_result_tab",
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest()
    });

    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      }).options
    ).toMatchObject({
      action_type: "read",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 924,
      target_page: "search_result_tab"
    });
  });

  it("rejects incomplete FR-0023 upstream authorization object sets", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        action_request: buildUpstreamAuthorizationRequest().action_request
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "UPSTREAM_AUTHORIZATION_OBJECT_SET_INCOMPLETE"
        })
      })
    );
  });

  it("rejects resource_binding without binding_ref", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        ...buildUpstreamAuthorizationRequest({
          resource_binding: {
            resource_kind: "profile_session",
            profile_ref: "xhs_account_001"
          }
        })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "BINDING_REF_INVALID"
        })
      })
    );
  });

  it("rejects profile_session resource_binding without profile_ref", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        ...buildUpstreamAuthorizationRequest({
          resource_binding: {
            binding_ref: "binding_001",
            resource_kind: "profile_session"
          }
        })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "PROFILE_REF_REQUIRED"
        })
      })
    );
  });

  it("rejects anonymous_context without strict anonymous binding constraints", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        ...buildUpstreamAuthorizationRequest({
          resource_binding: {
            binding_ref: "binding_001",
            resource_kind: "anonymous_context",
            binding_constraints: {
              anonymous_required: true,
              reuse_logged_in_context_forbidden: false
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
            }
          }
        })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "ANONYMOUS_BINDING_CONSTRAINTS_INVALID"
        })
      })
    );
  });

  it("accepts anonymous_context with explicit profile_ref null", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
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
          }
        }
      })
    });

    expect(envelope.upstreamAuthorization).toMatchObject({
      resource_binding: {
        binding_ref: "binding_001",
        resource_kind: "anonymous_context"
      }
    });
    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      }).options.upstream_authorization_request
    ).toMatchObject({
      resource_binding: {
        profile_ref: null
      }
    });
  });

  it("rejects anonymous_context requests that try to reuse a named runtime profile", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
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
          }
        }
      })
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        runtimeProfile: "xhs_account_001",
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "ANONYMOUS_CONTEXT_PROFILE_CONFLICT"
        })
      })
    );
  });

  it("rejects invalid resource_state_snapshot enum values", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        ...buildUpstreamAuthorizationRequest({
          authorization_grant: {
            grant_ref: "grant_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["xhs_account_001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            resource_state_snapshot: "unknown_state"
          }
        })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "RESOURCE_STATE_SNAPSHOT_INVALID"
        })
      })
    );
  });

  it("rejects upstream action_name that does not match the current command and ability", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
        action_request: {
          request_ref: "upstream_req_001",
          action_name: "xhs.read_note_detail",
          action_category: "read"
        },
        authorization_grant: {
          grant_ref: "grant_001",
          allowed_actions: ["xhs.read_note_detail"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_001"]
          },
          target_scope: {
            allowed_domains: ["www.xiaohongshu.com"],
            allowed_pages: ["search_result_tab"]
          }
        }
      })
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "ACTION_NAME_COMMAND_MISMATCH"
        })
      })
    );
  });

  it("rejects grants that do not allow the normalized action_name", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
        authorization_grant: {
          grant_ref: "grant_001",
          allowed_actions: ["xhs.read_note_detail"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_001"]
          },
          target_scope: {
            allowed_domains: ["www.xiaohongshu.com"],
            allowed_pages: ["search_result_tab"]
          }
        }
      })
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "ACTION_NOT_ALLOWED_BY_GRANT"
        })
      })
    );
  });

  it("rejects grants whose profile scope does not cover the bound profile_ref", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
        authorization_grant: {
          grant_ref: "grant_001",
          allowed_actions: ["xhs.read_search_results"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_999"]
          },
          target_scope: {
            allowed_domains: ["www.xiaohongshu.com"],
            allowed_pages: ["search_result_tab"]
          }
        }
      })
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "PROFILE_REF_OUT_OF_SCOPE"
        })
      })
    );
  });

  it("rejects grants whose target page scope does not cover the runtime_target", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest({
        authorization_grant: {
          grant_ref: "grant_001",
          allowed_actions: ["xhs.read_search_results"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_001"]
          },
          target_scope: {
            allowed_domains: ["www.xiaohongshu.com"],
            allowed_pages: ["explore_detail_tab"]
          }
        }
      })
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "TARGET_PAGE_OUT_OF_SCOPE"
        })
      })
    );
  });

  it("rejects profile_session requests when runtime profile does not match profile_ref", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest()
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        runtimeProfile: "xhs_account_999",
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "PROFILE_REF_CONTEXT_MISMATCH"
        })
      })
    );
  });

  it("supports FR-0023 normalization for the existing write-side editor_input ability", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.editor.input.v1", layer: "L3", action: "write" },
      input: {},
      options: {
        requested_execution_mode: "live_write",
        validation_action: "editor_input"
      },
      ...buildUpstreamAuthorizationRequest({
        action_request: {
          request_ref: "upstream_req_002",
          action_name: "xhs.write_editor_input",
          action_category: "write"
        },
        resource_binding: {
          binding_ref: "binding_002",
          resource_kind: "profile_session",
          profile_ref: "xhs_account_001"
        },
        authorization_grant: {
          grant_ref: "grant_002",
          allowed_actions: ["xhs.write_editor_input"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_001"]
          },
          target_scope: {
            allowed_domains: ["creator.xiaohongshu.com"],
            allowed_pages: ["creator_publish_tab"]
          }
        },
        runtime_target: {
          target_ref: "target_002",
          domain: "creator.xiaohongshu.com",
          page: "creator_publish_tab",
          tab_id: 11
        }
      })
    });

    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        runtimeProfile: "xhs_account_001",
        upstreamAuthorization: envelope.upstreamAuthorization
      }).options
    ).toMatchObject({
      action_type: "write",
      target_domain: "creator.xiaohongshu.com",
      target_tab_id: 11,
      target_page: "creator_publish_tab"
    });
  });

  it("projects irreversible_write into legacy write gate fields while keeping the canonical action category", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.editor.input.v1", layer: "L3", action: "write" },
      input: {},
      options: {
        action_type: "write",
        requested_execution_mode: "live_write",
        validation_action: "editor_input"
      },
      ...buildUpstreamAuthorizationRequest({
        action_request: {
          request_ref: "upstream_req_003",
          action_name: "xhs.write_editor_input",
          action_category: "irreversible_write"
        },
        resource_binding: {
          binding_ref: "binding_003",
          resource_kind: "profile_session",
          profile_ref: "xhs_account_001"
        },
        authorization_grant: {
          grant_ref: "grant_003",
          allowed_actions: ["xhs.write_editor_input"],
          binding_scope: {
            allowed_resource_kinds: ["profile_session"],
            allowed_profile_refs: ["xhs_account_001"]
          },
          target_scope: {
            allowed_domains: ["creator.xiaohongshu.com"],
            allowed_pages: ["creator_publish_tab"]
          }
        },
        runtime_target: {
          target_ref: "target_003",
          domain: "creator.xiaohongshu.com",
          page: "creator_publish_tab",
          tab_id: 11
        }
      })
    });

    expect(
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        runtimeProfile: "xhs_account_001",
        upstreamAuthorization: envelope.upstreamAuthorization
      }).options
    ).toMatchObject({
      action_type: "write",
      target_domain: "creator.xiaohongshu.com",
      target_tab_id: 11,
      target_page: "creator_publish_tab",
      upstream_authorization_request: {
        action_request: {
          action_category: "irreversible_write"
        }
      }
    });
  });

  it("rejects authorization_grant target_scope tab_id fields", () => {
    expect(() =>
      parseAbilityEnvelopeForContract({
        ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
        input: {
          query: "露营"
        },
        options: {
          requested_execution_mode: "dry_run"
        },
        ...buildUpstreamAuthorizationRequest({
          authorization_grant: {
            grant_ref: "grant_001",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["xhs_account_001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"],
              tab_id: 924
            }
          }
        })
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "GRANT_TARGET_SCOPE_INVALID"
        })
      })
    );
  });

  it("rejects legacy action_type values that conflict with FR-0023 normalization", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        action_type: "write",
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest()
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "ACTION_TYPE_CONFLICT"
        })
      })
    );
  });

  it("rejects legacy target_page values that conflict with FR-0023 normalization", () => {
    const envelope = parseAbilityEnvelopeForContract({
      ability: { id: "xhs.note.search.v1", layer: "L3", action: "read" },
      input: {
        query: "露营"
      },
      options: {
        target_page: "explore_detail_tab",
        requested_execution_mode: "dry_run"
      },
      ...buildUpstreamAuthorizationRequest()
    });

    expect(() =>
      normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: "xhs.search",
        abilityAction: envelope.ability.action,
        upstreamAuthorization: envelope.upstreamAuthorization
      })
    ).toThrowError(
      expect.objectContaining({
        code: "ERR_CLI_INVALID_ARGS",
        details: expect.objectContaining({
          reason: "TARGET_PAGE_CONFLICT"
        })
      })
    );
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

  it("does not fall back to a complete formal source when caller admission_context conflicts", () => {
    const decisionId =
      "gate_decision_issue209-gate-run-cli-issue209-formal-source-conflict-001-001";
    const approvalId = `gate_appr_${decisionId}`;
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
