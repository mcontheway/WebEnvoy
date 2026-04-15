import { describe, expect, it } from "vitest";
import { repoRoot, binPath, mockBrowserPath, nativeHostMockPath, repoOwnedNativeHostEntryPath, browserStateFilename, tempDirs, resolveDatabaseSync, DatabaseSync, itWithSqlite, createRuntimeCwd, createNativeHostManifest, seedInstalledPersistentExtension, defaultRuntimeEnv, runCli, expectBundledNativeHostStarts, createNativeHostCommand, createShellWrappedNativeHostCommand, PROFILE_MODE_ROOT_PREFERRED, quoteLauncherExportValue, resolveCanonicalExpectedProfileDir, expectProfileRootOnlyLauncherContract, expectDualEnvRootPreferredLauncherContract, runGit, createGitWorktreePair, runCliAsync, parseSingleJsonLine, encodeNativeBridgeEnvelope, readSingleNativeBridgeEnvelope, asRecord, resolveCliGateEnvelope, resolveWriteInteractionTier, scopedXhsGateOptions, assertLockMissing, detectSystemChromePath, wait, runHeadlessDomProbe, realBrowserContractsEnabled, BROWSER_STATE_FILENAME, BROWSER_CONTROL_FILENAME, isPidAlive, scopedReadGateOptions, path, readFile, writeFile, mkdir, mkdtemp, realpath, rm, stat, chmod, symlink, spawn, spawnSync, createServer, createRequire, tmpdir, resolveRuntimeStorePath, type DatabaseSyncCtor } from "./cli.contract.shared.js";

describe("webenvoy cli contract / xhs gate and audit", () => {
  const createAllowedHighRiskAuditRecord = (
    overrides: Record<string, unknown> & { runId?: string; requestId?: string } = {}
  ): Record<string, unknown> => {
    return {
      event_id: "audit-live-read-high-risk-001",
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      gate_decision: "allowed",
      recorded_at: "2026-03-23T10:00:30Z",
      ...overrides
    };
  };

  const createLoopbackFingerprintContext = (
    executionOverrides: Record<string, unknown> = {}
  ): Record<string, unknown> => ({
    profile: "loopback_profile",
    source: "profile_meta",
    fingerprint_profile_bundle: {
      ua: "Mozilla/5.0",
      hardwareConcurrency: 8,
      deviceMemory: 8,
      screen: {
        width: 1440,
        height: 900,
        colorDepth: 24,
        pixelDepth: 24
      },
      battery: {
        level: 0.73,
        charging: false
      },
      timezone: "Asia/Shanghai",
      audioNoiseSeed: 0.000047231,
      canvasNoiseSeed: 0.000083154,
      environment: {
        os_family: "macos",
        os_version: "14.6",
        arch: "arm64"
      }
    },
    fingerprint_patch_manifest: {
      profile: "loopback_profile",
      manifest_version: "1",
      required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"],
      optional_patches: [],
      field_dependencies: {
        audio_context: ["audioNoiseSeed"],
        battery: ["battery.level", "battery.charging"]
      },
      unsupported_reason_codes: []
    },
    fingerprint_consistency_check: {
      profile: "loopback_profile",
      expected_environment: {
        os_family: "macos",
        os_version: "14.6",
        arch: "arm64"
      },
      actual_environment: {
        os_family: "macos",
        os_version: "14.6",
        arch: "arm64"
      },
      decision: "match",
      reason_codes: []
    },
    execution: {
      live_allowed: true,
      live_decision: "allowed",
      allowed_execution_modes: ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
      reason_codes: [],
      ...executionOverrides
    }
  });

  const createApprovedReadAdmissionContext = (input: {
    runId: string;
    requestId?: string;
    requestedExecutionMode: "live_read_limited" | "live_read_high_risk";
    riskState: "limited" | "allowed";
    decisionId?: string;
    approvalId?: string;
    sessionId?: string;
  }): Record<string, unknown> => {
    const decisionId = input.decisionId;
    const approvalId = input.approvalId;
    const sessionId = input.sessionId ?? "nm-session-001";
    return ({
    approval_admission_evidence: {
      approval_admission_ref:
        approvalId ?? `approval_admission_${input.runId}_${input.requestId ?? "formal"}`,
      ...(decisionId ? { decision_id: decisionId } : {}),
      ...(approvalId ? { approval_id: approvalId } : {}),
      ...(input.requestId ? { request_id: input.requestId } : {}),
      run_id: input.runId,
      session_id: sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
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
        decisionId
          ? `gate_evt_${decisionId}`
          : `audit_admission_${input.runId}_${input.requestId ?? "formal"}`,
      ...(decisionId ? { decision_id: decisionId } : {}),
      ...(approvalId ? { approval_id: approvalId } : {}),
      ...(input.requestId ? { request_id: input.requestId } : {}),
      run_id: input.runId,
      session_id: sessionId,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
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
  };

  const createCanonicalSearchAuthorizationRequest = (input: {
    runId: string;
    requestId: string;
    resourceKind: "anonymous_context" | "profile_session";
    profileRef?: string | null;
    targetTabId?: number;
  }): Record<string, unknown> => {
    const profileRef =
      input.resourceKind === "profile_session" ? (input.profileRef ?? "profile-session-001") : null;
    return {
      action_request: {
        request_ref: `upstream_req_${input.requestId}`,
        action_name: "xhs.read_search_results",
        action_category: "read",
        requested_at: "2026-04-15T09:00:00.000Z"
      },
      resource_binding: {
        binding_ref: `binding_${input.requestId}`,
        resource_kind: input.resourceKind,
        ...(input.resourceKind === "profile_session"
          ? { profile_ref: profileRef }
          : {
              profile_ref: null,
              binding_constraints: {
                anonymous_required: true,
                reuse_logged_in_context_forbidden: true
              }
            })
      },
      authorization_grant: {
        grant_ref: `grant_${input.requestId}`,
        allowed_actions: ["xhs.read_search_results"],
        binding_scope: {
          allowed_resource_kinds: [input.resourceKind],
          allowed_profile_refs: profileRef ? [profileRef] : []
        },
        target_scope: {
          allowed_domains: ["www.xiaohongshu.com"],
          allowed_pages: ["search_result_tab"]
        },
        approval_refs: [`approval_admission_${input.runId}_${input.requestId}`],
        audit_refs: [`audit_admission_${input.runId}_${input.requestId}`],
        resource_state_snapshot: "active"
      },
      runtime_target: {
        target_ref: `target_${input.requestId}`,
        domain: "www.xiaohongshu.com",
        page: "search_result_tab",
        tab_id: input.targetTabId ?? 32
      }
    };
  };

  it("returns structured input validation error for xhs.search without ability envelope", () => {
    const result = runCli(["xhs.search", "--profile", "xhs_account_001"]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          ability_id: "unknown",
          stage: "input_validation",
          reason: "ABILITY_MISSING"
        }
      }
    });
  });

  it("returns capability_result for xhs.search fixture success path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        request_id: "issue209-live-limited-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          fixture_success: true
        }
      })
    ], repoRoot, {
      WEBENVOY_ALLOW_FIXTURE_SUCCESS: "1"
    });
    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      }
    });
  });

  it("returns invalid args when xhs.search gate options are missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-audit-query-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          requested_execution_mode: "dry_run"
        }
      })
    ]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_DOMAIN_INVALID"
        }
      }
    });
  });

  it("returns dry_run summary by default for xhs.search runtime path", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-audit-query-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          action_type: "read",
          simulate_result: "success"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        },
        consumer_gate_result: {
          requested_execution_mode: "dry_run",
          effective_execution_mode: "dry_run",
          gate_decision: "allowed"
        }
      }
    });
    expect(
      (
        ((body.summary as Record<string, unknown>).consumer_gate_result as Record<string, unknown>)
          .gate_reasons as string[]
      )
    ).toEqual(["DEFAULT_MODE_DRY_RUN"]);
  });

  it("blocks xhs.search before execution when official Chrome runtime readiness is not ready", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_official_not_ready_profile",
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-audit-query-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedXhsGateOptions,
          action_type: "read",
          simulate_result: "success"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    });

    expect(result.status).toBe(5);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_RUNTIME_IDENTITY_NOT_BOUND",
        details: {
          ability_id: "xhs.note.search.v1",
          runtime_readiness: "blocked",
          identity_binding_state: "missing"
        }
      }
    });
  });

  it("blocks live_read_high_risk when approval is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-audit-query-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked",
          scope_context: {
            platform: "xhs",
            read_domain: "www.xiaohongshu.com",
            write_domain: "creator.xiaohongshu.com",
            domain_mixing_forbidden: true
          },
          gate_input: {
            run_id: expect.any(String),
            session_id: expect.any(String),
            profile: "loopback_profile",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed"
          },
          gate_outcome: {
            effective_execution_mode: "dry_run",
            gate_decision: "blocked",
            requires_manual_confirmation: true
          },
          consumer_gate_result: {
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            gate_decision: "blocked"
          },
          approval_record: {
            approved: false,
            approver: null,
            approved_at: null,
            checks: {
              target_domain_confirmed: false,
              target_tab_confirmed: false,
              target_page_confirmed: false,
              risk_state_checked: false,
              action_type_confirmed: false
            }
          },
          audit_record: {
            run_id: expect.any(String),
            session_id: expect.any(String),
            profile: "loopback_profile",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            gate_decision: "blocked",
            approver: null,
            approved_at: null,
            recorded_at: expect.any(String)
          }
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
  });

  it("returns invalid args when dry_run target scope is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          simulate_result: "success"
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_DOMAIN_INVALID"
        }
      }
    });
  });

  it("blocks live_write when risk state is paused", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
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
          },
          audit_record: {
            event_id: "audit-live-read-limited-001",
            decision_id: "gate_decision_issue209-live-limited-001",
            approval_id: "gate_appr_gate_decision_issue209-live-limited-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "ABILITY_ACTION_CONTEXT_MISMATCH",
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND",
      ])
    );
  });

  it("blocks live_write when action_type is omitted even if ability.action is write", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
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
            event_id: "audit-live-read-limited-001",
            decision_id: "gate_decision_issue209-live-limited-001",
            approval_id: "gate_appr_gate_decision_issue209-live-limited-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
  });

  itWithSqlite("persists null write matrix decisions when xhs.search action_type is omitted", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-missing-action-type-xhs-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
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
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(6);

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-missing-action-type-xhs-query-001",
      "--params",
      JSON.stringify({
        run_id: runId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body.summary).toMatchObject({
      audit_records: expect.arrayContaining([
        expect.objectContaining({
          run_id: runId,
          action_type: null,
          write_interaction_tier: null,
          write_action_matrix_decisions: null
        })
      ]),
      write_action_matrix_decisions: null
    });
  });

  it("blocks live_write because xhs.search is a read-only command", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
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
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
  });

  it("blocks when ability.action diverges from the approved gate action", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
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
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(expect.arrayContaining(["ABILITY_ACTION_CONTEXT_MISMATCH"]));
  });

  it("blocks live_write when action_type is irreversible_write even with approval", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          action_type: "irreversible_write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
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
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_write",
          effective_execution_mode: "dry_run",
          gate_decision: "blocked"
        }
      }
    });
    expect(
      (((body.error as Record<string, unknown>).details as Record<string, unknown>).gate_reasons as string[])
    ).toEqual(
      expect.arrayContaining([
        "ABILITY_ACTION_CONTEXT_MISMATCH",
        "IRREVERSIBLE_WRITE_NOT_ALLOWED",
        "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"
      ])
    );
  });

  it("blocks issue_208 write paths in paused state and exposes write interaction tier", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
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
          },
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("reversible_interaction");
  });

  it("keeps issue_208 dry_run write requests blocked regardless of approval completeness", () => {
    const states: Array<"limited" | "allowed"> = ["limited", "allowed"];
    for (const state of states) {
      const blocked = runCli([
        "xhs.search",
        "--profile",
        "xhs_account_001",
        "--params",
        JSON.stringify({
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "write"
          },
          input: {
            query: "露营装备"
          },
          options: {
            target_domain: "creator.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "creator_publish_tab",
            issue_scope: "issue_208",
            action_type: "write",
            requested_execution_mode: "dry_run",
            risk_state: state,
            approval_record: {
              approved: false,
              approver: null,
              approved_at: null,
              checks: {
                target_domain_confirmed: false,
                target_tab_confirmed: false,
                target_page_confirmed: false,
                risk_state_checked: false,
                action_type_confirmed: false
              }
            }
          }
        })
      ], repoRoot, {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      });
      expect(blocked.status).toBe(6);
      const blockedBody = parseSingleJsonLine(blocked.stdout);
      const blockedEnvelope = resolveCliGateEnvelope(blockedBody);
      const blockedConsumerGateResult = asRecord(blockedEnvelope.consumer_gate_result);
      expect(blockedConsumerGateResult?.gate_decision).toBe("blocked");
      expect(resolveWriteInteractionTier(blockedEnvelope)).toBe("reversible_interaction");

      expect(
        ((blockedConsumerGateResult?.gate_reasons as string[] | undefined) ?? []).includes(
          "EDITOR_INPUT_VALIDATION_REQUIRED"
        )
      ).toBe(true);
    }
  });

  it("keeps issue_208 irreversible_write blocked and exposes irreversible write tier", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "irreversible_write",
          requested_execution_mode: "dry_run",
          risk_state: "allowed",
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("irreversible_write");
  });

  it("keeps issue_208 live_write as gate-only in loopback while exposing non-live effective mode", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
          validation_action: "editor_input",
          validation_text: "最小正式验证",
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateInput = asRecord(gateEnvelope.gate_input);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateInput?.requested_execution_mode).toBe("live_write");
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_write");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_write");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
    expect(resolveWriteInteractionTier(gateEnvelope)).toBe("reversible_interaction");
  });

  it("keeps issue_208 editor_input blocked on loopback because it lacks controlled execution attestation", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_208",
          action_type: "write",
          validation_action: "editor_input",
          requested_execution_mode: "live_write",
          risk_state: "allowed",
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED"
      }
    });
    const payload = asRecord(body.payload) ?? {};
    const observability = asRecord(payload.observability) ?? {};
    const failureSite = asRecord(observability.failure_site) ?? {};
    expect(typeof failureSite).toBe("object");
    expect(String(body.error?.message ?? "")).toContain("执行模式门禁阻断");
  });

  it("blocks issue_209 write dry_run even with complete approval to keep gate-only scoped to issue_208", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "allowed",
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining(["RISK_STATE_ALLOWED", "ISSUE_ACTION_MATRIX_BLOCKED"])
    );
  });

  it("blocks issue_209 write live_read_limited with fallback mode instead of exposing live execution", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
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
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateOutcome?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_read_limited");
    expect(consumerGateResult?.effective_execution_mode).toBe("recon");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_LIMITED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_read_limited");
    expect(auditRecord?.effective_execution_mode).toBe("recon");
  });

  it("blocks issue_209 write live_read_high_risk with fallback mode instead of exposing live execution", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "creator_publish_tab",
          issue_scope: "issue_209",
          action_type: "write",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    const consumerGateResult = asRecord(gateEnvelope.consumer_gate_result);
    const gateOutcome = asRecord(gateEnvelope.gate_outcome);
    const auditRecord = asRecord(gateEnvelope.audit_record);
    expect(gateOutcome?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.requested_execution_mode).toBe("live_read_high_risk");
    expect(consumerGateResult?.effective_execution_mode).toBe("dry_run");
    expect(consumerGateResult?.gate_decision).toBe("blocked");
    expect(consumerGateResult?.gate_reasons).toEqual(
      expect.arrayContaining([
        "ACTION_TYPE_MODE_MISMATCH",
        "RISK_STATE_ALLOWED",
        "ISSUE_ACTION_MATRIX_BLOCKED"
      ])
    );
    expect(auditRecord?.requested_execution_mode).toBe("live_read_high_risk");
    expect(auditRecord?.effective_execution_mode).toBe("dry_run");
  });

  it("allows live_read_high_risk with explicit approval and emits consumer_gate_result", () => {
    const runId = "run-cli-live-high-risk-approved-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createLoopbackFingerprintContext(),
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId: "issue209-live-high-risk-001"
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-high-risk-001",
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        scope_context: {
          platform: "xhs",
          read_domain: "www.xiaohongshu.com",
          write_domain: "creator.xiaohongshu.com",
          domain_mixing_forbidden: true
        },
        gate_input: {
          run_id: expect.any(String),
          session_id: expect.any(String),
          profile: "loopback_profile",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        approval_record: {
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z"
        },
        audit_record: {
          run_id: expect.any(String),
          session_id: expect.any(String),
          profile: "loopback_profile",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          action_type: "read",
          requested_execution_mode: "live_read_high_risk",
          effective_execution_mode: "live_read_high_risk",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z",
          recorded_at: expect.any(String)
        }
      }
    });
  });

  it("emits execution_audit in CLI success summary when canonical FR-0023 inputs are present", () => {
    const runId = "run-cli-fr0023-execution-audit-success-001";
    const requestId = "cli-fr0023-execution-audit-success-001";
    const profile = "profile-session-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      profile,
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          upstream_authorization_request: createCanonicalSearchAuthorizationRequest({
            runId,
            requestId,
            resourceKind: "profile_session",
            profileRef: profile
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      status: "success",
      summary: {
        request_admission_result: {
          request_ref: `upstream_req_${requestId}`,
          admission_decision: "allowed"
        },
        execution_audit: {
          request_ref: `upstream_req_${requestId}`,
          request_admission_decision: "allowed",
          consumed_inputs: {
            action_request_ref: `upstream_req_${requestId}`,
            resource_binding_ref: `binding_${requestId}`,
            authorization_grant_ref: `grant_${requestId}`,
            runtime_target_ref: `target_${requestId}`
          },
          compatibility_refs: {
            approval_admission_ref: `approval_admission_${runId}_${requestId}`,
            audit_admission_ref: `audit_admission_${runId}_${requestId}`
          }
        }
      }
    });
    expect(body.observability).not.toHaveProperty("execution_audit");
  });

  it("preserves explicit null execution_audit in CLI success summary when upstream summary sets it to null", async () => {
    const hostDir = await mkdtemp(path.join(tmpdir(), "webenvoy-native-host-null-summary-"));
    const nativeHostPath = path.join(hostDir, "native-host-null-summary.mjs");
    await writeFile(
      nativeHostPath,
      `#!/usr/bin/env node
let buffer = Buffer.alloc(0);
let opened = false;
const writeMessage = (message) => {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
};
const onRequest = (request) => {
  if (request.method === "bridge.open") {
    opened = true;
    writeMessage({
      id: request.id,
      status: "success",
      summary: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready",
        session_id: "nm-session-001"
      },
      error: null
    });
    return;
  }
  if (request.method === "__ping__") {
    writeMessage({
      id: request.id,
      status: "success",
      summary: {
        session_id: "nm-session-001"
      },
      error: null
    });
    return;
  }
  if (request.method === "bridge.forward" && opened) {
    writeMessage({
      id: request.id,
      status: "success",
      summary: {
        session_id: String(request.params?.session_id ?? "nm-session-001"),
        run_id: String(request.params?.run_id ?? request.id),
        command: String(request.params?.command ?? "xhs.search"),
        relay_path: "host>background>content-script>background>host"
      },
      payload: {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            layer: "L3",
            action: "read",
            outcome: "success"
          },
          request_admission_result: null,
          execution_audit: null
        }
      },
      error: null
    });
    process.exit(0);
  }
};
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const frameLength = buffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (buffer.length < frameEnd) {
      return;
    }
    const frame = buffer.subarray(4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    onRequest(JSON.parse(frame.toString("utf8")));
  }
});
`,
      "utf8"
    );
    await chmod(nativeHostPath, 0o755);

    try {
      const result = runCli(
        [
          "xhs.search",
          "--profile",
          "profile-session-001",
          "--run-id",
          "run-cli-fr0023-execution-audit-success-null-001",
          "--params",
          JSON.stringify({
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营装备"
            },
            options: {
              ...scopedReadGateOptions,
              requested_execution_mode: "dry_run",
              risk_state: "paused"
            }
          })
        ],
        repoRoot,
        {
          WEBENVOY_NATIVE_TRANSPORT: "native",
          WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostPath)
        }
      );

      expect(result.status).toBe(0);
      const body = parseSingleJsonLine(result.stdout);
      expect(body).toMatchObject({
        status: "success",
        summary: {
          request_admission_result: null,
          execution_audit: null
        }
      });
      expect(body.summary).toHaveProperty("request_admission_result", null);
      expect(body.summary).toHaveProperty("execution_audit", null);
      expect(body.observability).not.toHaveProperty("execution_audit");
    } finally {
      await rm(hostDir, { recursive: true, force: true });
    }
  });

  it("emits execution_audit in CLI error details when canonical FR-0023 inputs are blocked", () => {
    const runId = "run-cli-fr0023-execution-audit-blocked-001";
    const requestId = "cli-fr0023-execution-audit-blocked-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "anon-cli-profile-001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          upstream_authorization_request: createCanonicalSearchAuthorizationRequest({
            runId,
            requestId,
            resourceKind: "anonymous_context"
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
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          }),
          __anonymous_isolation_verified: true,
          target_site_logged_in: true
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const gateEnvelope = resolveCliGateEnvelope(body);
    expect(gateEnvelope).toMatchObject({
      request_admission_result: {
        request_ref: `upstream_req_${requestId}`,
        admission_decision: "blocked",
        anonymous_isolation_ok: false
      },
      execution_audit: {
        request_ref: `upstream_req_${requestId}`,
        request_admission_decision: "blocked",
        consumed_inputs: {
          action_request_ref: `upstream_req_${requestId}`,
          resource_binding_ref: `binding_${requestId}`,
          authorization_grant_ref: `grant_${requestId}`,
          runtime_target_ref: `target_${requestId}`
        }
      }
    });
    expect(body.observability).not.toHaveProperty("execution_audit");
  });

  it("recovers official Chrome xhs.search with hidden runtime.bootstrap after runtime.start leaves bootstrap pending", async () => {
    const runtimeCwd = await createRuntimeCwd();
    const manifestPath = await createNativeHostManifest({
      allowedOrigins: ["chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"]
    });
    const profile = "xhs_official_bootstrap_recovery_profile";
    const runId = "run-contract-xhs-bootstrap-recovery-001";
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile
    });

    const start = runCli(
      [
        "runtime.start",
        "--profile",
        profile,
        "--run-id",
        runId,
        "--params",
        JSON.stringify({
          persistent_extension_identity: {
            extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            manifest_path: manifestPath
          }
        })
      ],
      runtimeCwd,
      {
        WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154",
        WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostMockPath),
        WEBENVOY_NATIVE_HOST_MODE: "bootstrap-ack-timeout-error"
      }
    );
    expect(start.status).toBe(0);
    const startBody = parseSingleJsonLine(start.stdout);
    expect(startBody).toMatchObject({
      command: "runtime.start",
      status: "success",
      summary: {
        profile,
        identityBindingState: "bound",
        transportState: "ready",
        bootstrapState: "pending",
        runtimeReadiness: "recoverable"
      }
    });
    await seedInstalledPersistentExtension({
      cwd: runtimeCwd,
      profile
    });

    const nativeHostPath = path.join(runtimeCwd, "native-host-live-prewarm.cjs");
    const tracePath = path.join(runtimeCwd, "native-host-live-prewarm-trace.json");
    await writeFile(
      nativeHostPath,
      `#!/usr/bin/env node
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
let buffer = Buffer.alloc(0);
let opened = false;
let bootstrapPending = false;
let bootstrapAttested = false;
let attestationTimer = null;
const forwards = [];
const attestationEvents = [];
const tracePath = process.env.WEBENVOY_TEST_TRACE_PATH || "";
let idleTimer = null;

const emit = (message) => {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
};

const writeTrace = () => {
  if (!tracePath) {
    return;
  }
  const existing = existsSync(tracePath)
    ? JSON.parse(readFileSync(tracePath, "utf8"))
    : { forwards: [], attestationEvents: [] };
  const mergedForwards = Array.isArray(existing.forwards)
    ? [...existing.forwards, ...forwards]
    : [...forwards];
  const mergedAttestations = Array.isArray(existing.attestationEvents)
    ? [...existing.attestationEvents, ...attestationEvents]
    : [...attestationEvents];
  writeFileSync(
    tracePath,
    JSON.stringify({ forwards: mergedForwards, attestationEvents: mergedAttestations }),
    "utf8"
  );
};

const scheduleIdleExit = () => {
  if (idleTimer) {
    clearTimeout(idleTimer);
  }
  idleTimer = setTimeout(() => {
    writeTrace();
    process.exit(0);
  }, 1000);
};

const success = (request, payload = { message: "pong" }) => ({
  id: request.id,
  status: "success",
  summary: {
    session_id: String(request.params?.session_id ?? "nm-session-001"),
    run_id: String(request.params?.run_id ?? request.id),
    command: String(request.params?.command ?? "runtime.ping"),
    relay_path: "host>background>content-script>background>host"
  },
  payload,
  error: null
});

const onRequest = (request) => {
  if (request.method === "bridge.open") {
    opened = true;
    emit({
      id: request.id,
      status: "success",
      summary: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready",
        session_id: "nm-session-001"
      },
      error: null
    });
    scheduleIdleExit();
    return;
  }

  if (request.method === "__ping__") {
    emit({
      id: request.id,
      status: "success",
      summary: { session_id: "nm-session-001" },
      error: null
    });
    scheduleIdleExit();
    return;
  }

  if (request.method !== "bridge.forward" || !opened) {
    emit({
      id: request.id,
      status: "error",
      summary: {},
      error: { code: "ERR_TRANSPORT_FORWARD_FAILED", message: "unexpected request" }
    });
    writeTrace();
    process.exit(0);
    return;
  }

  const command = String(request.params?.command ?? "");
  const runId = String(request.params?.run_id ?? request.id);
  const profile = String(request.profile ?? "");
  forwards.push({
    command,
    run_id: runId,
    profile
  });

  if (command === "runtime.bootstrap") {
    const runtimeContextId = String(request.params?.command_params?.runtime_context_id ?? "");
    bootstrapPending = true;
    bootstrapAttested = false;
    if (attestationTimer) {
      clearTimeout(attestationTimer);
    }
    attestationTimer = setTimeout(() => {
      bootstrapPending = false;
      bootstrapAttested = true;
      attestationEvents.push({
        source: "native-host-async-attestation",
        run_id: runId,
        profile,
        runtime_context_id: runtimeContextId
      });
    }, 50);
    emit({
      id: request.id,
      status: "error",
      summary: {
        session_id: String(request.params?.session_id ?? "nm-session-001"),
        run_id: runId,
        command,
        relay_path: "host>background>content-script>background>host"
      },
      payload: {},
      error: {
        code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
        message: "runtime bootstrap 尚未获得执行面确认"
      }
    });
    scheduleIdleExit();
    return;
  }

  if (command === "runtime.readiness") {
    emit(
      success(request, {
        transport_state: "ready",
        bootstrap_state: bootstrapAttested ? "ready" : bootstrapPending ? "pending" : "not_started"
      })
    );
    scheduleIdleExit();
    return;
  }

  if (command === "xhs.search") {
    const fingerprintContext = request.params?.command_params?.fingerprint_context ?? null;
    if (!fingerprintContext) {
      emit({
        id: request.id,
        status: "error",
        summary: {},
        error: {
          code: "ERR_EXECUTION_FAILED",
          message: "fingerprint_context missing on xhs.search"
        },
        payload: {
          details: {
            stage: "execution",
            reason: "FINGERPRINT_CONTEXT_MISSING"
          }
        }
      });
      writeTrace();
      process.exit(0);
      return;
    }
    emit(
      success(request, {
        summary: {
          capability_result: {
            ability_id: "xhs.note.search.v1",
            layer: "L3",
            action: "read",
            outcome: "success"
          }
        }
      })
    );
    writeTrace();
    process.exit(0);
    return;
  }

  emit({
    id: request.id,
    status: "error",
    summary: {},
    error: { code: "ERR_TRANSPORT_FORWARD_FAILED", message: "unsupported command" }
  });
  writeTrace();
  process.exit(0);
};

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const frameLength = buffer.readUInt32LE(0);
    const frameEnd = 4 + frameLength;
    if (buffer.length < frameEnd) {
      return;
    }
    const frame = buffer.subarray(4, frameEnd);
    buffer = buffer.subarray(frameEnd);
    const request = JSON.parse(frame.toString("utf8"));
    onRequest(request);
  }
});
`,
      "utf8"
    );

    const result = runCli([
      "xhs.search",
      "--profile",
      profile,
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        persistent_extension_identity: {
          extension_id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          manifest_path: manifestPath
        },
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          }),
          approval_record: {
            approved: true,
            approver: "qa-reviewer",
            approved_at: "2026-03-25T12:00:00Z",
            checks: {
              target_domain_confirmed: true,
              target_tab_confirmed: true,
              target_page_confirmed: true,
              risk_state_checked: true,
              action_type_confirmed: true
            }
          },
          audit_record: createAllowedHighRiskAuditRecord()
        }
      })
    ], runtimeCwd, {
      WEBENVOY_NATIVE_TRANSPORT: "native",
      WEBENVOY_NATIVE_HOST_CMD: createNativeHostCommand(nativeHostPath),
      WEBENVOY_TEST_TRACE_PATH: tracePath,
      WEBENVOY_BROWSER_MOCK_VERSION: "Google Chrome 146.0.7680.154"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success"
    });
  });

  it("accepts live_read_limited as approved live mode in limited risk state", () => {
    const runId = "run-issue209-live-limited-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: "issue209-live-limited-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          issue_scope: "issue_209",
          simulate_result: "success",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          fingerprint_context: createLoopbackFingerprintContext(),
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
            event_id: "audit-live-read-limited-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          },
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-limited-001",
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          })
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "success",
      summary: {
        gate_input: {
          requested_execution_mode: "live_read_limited",
          risk_state: "limited"
        },
        gate_outcome: {
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"],
          requires_manual_confirmation: true
        },
        consumer_gate_result: {
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        issue_action_matrix: {
          issue_scope: "issue_209",
          state: "limited",
          allowed_actions: ["dry_run", "recon"],
          conditional_actions: [
            {
              action: "live_read_limited",
              requires: [
                "gate_input_risk_state_limited_or_allowed",
                "audit_admission_evidence_present",
                "audit_admission_checks_all_true",
                "risk_state_checked",
                "target_domain_confirmed",
                "target_tab_confirmed",
                "target_page_confirmed",
                "action_type_confirmed",
                "approval_admission_evidence_approved_true",
                "approval_admission_evidence_approver_present",
                "approval_admission_evidence_approved_at_present",
                "approval_admission_evidence_checks_all_true",
                "limited_read_rollout_ready_true"
              ]
            }
          ]
        },
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "recovery",
            triggered_by: "LIVE_MODE_APPROVED",
            cooldown_until: null,
            recovery_started_at: expect.any(String),
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          },
          recovery_requirements: [
            "stability_window_passed_and_manual_approve",
            "risk_state_checked",
            "audit_record_present"
          ]
        }
      }
    });
  });

  it("blocks live_read_limited when caller omits admission_context even if request_id is synthesized", () => {
    const runId = "run-issue209-live-limited-generated-request-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          issue_scope: "issue_209",
          simulate_result: "success",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          fingerprint_context: createLoopbackFingerprintContext(),
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
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const errorDetails = body.error.details as Record<string, unknown>;
    const gateOutcome = errorDetails.gate_outcome as Record<string, unknown>;
    const gateInput = errorDetails.gate_input as Record<string, unknown>;
    const approvalRecord = errorDetails.approval_record as Record<string, unknown>;
    const auditRecord = errorDetails.audit_record as Record<string, unknown>;
    const decisionId = String(gateOutcome.decision_id);
    expect(decisionId).toMatch(new RegExp(`^gate_decision_issue209-gate-${runId}-`));
    expect(gateInput).toMatchObject({
      admission_context: {
        approval_admission_evidence: {
          approval_admission_ref: null,
          decision_id: null,
          approval_id: null,
          run_id: null,
          session_id: null
        },
        audit_admission_evidence: {
          audit_admission_ref: null,
          decision_id: null,
          approval_id: null,
          run_id: null,
          session_id: null
        }
      }
    });
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          requested_execution_mode: "live_read_limited",
          effective_execution_mode: "recon",
          gate_decision: "blocked"
        }
      }
    });
    expect(gateOutcome).toMatchObject({
      decision_id: decisionId,
      effective_execution_mode: "recon",
      gate_decision: "blocked",
      gate_reasons: expect.arrayContaining([
        "MANUAL_CONFIRMATION_MISSING",
        "AUDIT_RECORD_MISSING"
      ])
    });
    expect(approvalRecord).toMatchObject({
      decision_id: decisionId,
      approval_id: null
    });
    expect(auditRecord).toMatchObject({
      decision_id: decisionId,
      approval_id: null,
      requested_execution_mode: "live_read_limited",
      effective_execution_mode: "recon"
    });
  });

  it("ignores stale caller audit_record when admission_context already matches the current request", () => {
    const runId = "run-issue209-live-limited-stale-audit-001";
    const requestId = "issue209-live-stale-audit-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          issue_scope: "issue_209",
          simulate_result: "success",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          fingerprint_context: createLoopbackFingerprintContext(),
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
            requestedExecutionMode: "live_read_limited",
            riskState: "limited"
          }),
          audit_record: {
            event_id: "gate_evt_issue209-live-limited-previous-001",
            decision_id: "gate_decision_issue209-live-limited-previous-001",
            approval_id: "gate_appr_gate_decision_issue209-live-limited-previous-001",
            issue_scope: "issue_209",
            target_domain: "www.xiaohongshu.com",
            target_tab_id: 32,
            target_page: "search_result_tab",
            action_type: "read",
            requested_execution_mode: "live_read_limited",
            gate_decision: "allowed",
            recorded_at: "2026-03-23T10:00:30Z"
          }
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    const decisionId = String(body.summary.gate_outcome.decision_id);
    const approvalId = String(body.summary.approval_record.approval_id);
    expect(decisionId).toMatch(new RegExp(`^gate_decision_issue209-gate-${runId}-`));
    expect(approvalId).toBe(`gate_appr_${decisionId}`);
    expect(body.summary.gate_outcome).toMatchObject({
      effective_execution_mode: "live_read_limited",
      gate_decision: "allowed",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(body.summary.approval_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId
    });
    expect(body.summary.audit_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      gate_decision: "allowed"
    });
  });

  it("blocks live_read_high_risk when caller audit_record lacks audited_checks", () => {
    const runId = "run-issue209-live-high-risk-audit-checks-missing-001";
    const requestId = "issue209-live-high-risk-audit-checks-missing-001";
    const gateInvocationId = `issue209-gate-${runId}-001`;
    const auditRecord = createAllowedHighRiskAuditRecord({
      decision_id: "gate_decision_mismatch",
      approval_id: "gate_appr_mismatch",
      request_id: requestId
    });

    const result = runCli(
      [
        "xhs.search",
        "--profile",
        "xhs_account_001",
        "--run-id",
        runId,
        "--params",
        JSON.stringify({
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
            ...scopedReadGateOptions,
            issue_scope: "issue_209",
            action_type: "read",
            requested_execution_mode: "live_read_high_risk",
            risk_state: "allowed",
            simulate_result: "success",
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
            audit_record: auditRecord
          }
        })
      ],
      repoRoot,
      {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      }
    );

    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    const errorDetails = body.error.details as Record<string, unknown>;
    const gateOutcome = errorDetails.gate_outcome as Record<string, unknown>;
    expect(gateOutcome).toMatchObject({
      gate_decision: "blocked",
      effective_execution_mode: "dry_run"
    });
    expect(gateOutcome.gate_reasons as string[]).toEqual(
      expect.arrayContaining(["AUDIT_RECORD_MISSING"])
    );
  });

  it("allows formal admission_context without internal linkage and derives current linkage from gate_invocation_id", () => {
    const runId = "run-issue209-live-limited-existing-admission-001";
    const requestId = "issue209-live-existing-admission-001";
    const admissionContext = createApprovedReadAdmissionContext({
      runId,
      requestId,
      requestedExecutionMode: "live_read_limited",
      riskState: "limited"
    });
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          issue_scope: "issue_209",
          simulate_result: "success",
          requested_execution_mode: "live_read_limited",
          risk_state: "limited",
          limited_read_rollout_ready_true: true,
          fingerprint_context: createLoopbackFingerprintContext(),
          admission_context: admissionContext
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });

    expect(result.status).toBe(0);
    const body = parseSingleJsonLine(result.stdout);
    const decisionId = String(body.summary.gate_outcome.decision_id);
    const approvalId = String(body.summary.approval_record.approval_id);
    expect(decisionId).toMatch(new RegExp(`^gate_decision_issue209-gate-${runId}-`));
    expect(approvalId).toBe(`gate_appr_${decisionId}`);
    expect(body.summary.approval_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:00Z"
    });
    expect(body.summary.audit_record).toMatchObject({
      decision_id: decisionId,
      approval_id: approvalId,
      audited_checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
    expect(body.summary.gate_outcome).toMatchObject({
      effective_execution_mode: "live_read_limited",
      gate_decision: "allowed",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
    expect(body.summary.gate_input.admission_context).toMatchObject({
      approval_admission_evidence: {
        decision_id: decisionId,
        approval_id: approvalId
      },
      audit_admission_evidence: {
        decision_id: decisionId,
        approval_id: approvalId
      }
    });
  });

  itWithSqlite("queries persisted gate audit trail by run_id after live approval", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-allowed-001";
    const requestId = "issue209-live-high-risk-audit-query-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        request_id: requestId,
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "success",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createLoopbackFingerprintContext(),
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId,
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(0);

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-read-001",
      "--params",
      JSON.stringify({
        run_id: runId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: runId
        },
        approval_record: {
          run_id: runId,
          approved: true,
          approver: "qa-reviewer",
          approved_at: "2026-03-23T10:00:00Z"
        },
        audit_records: [
          {
            run_id: runId,
            issue_scope: "issue_209",
            risk_state: "allowed",
            gate_decision: "allowed",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "live_read_high_risk",
            approver: "qa-reviewer",
            approved_at: "2026-03-23T10:00:00Z"
          }
        ],
        write_action_matrix_decisions: {
          issue_scope: "issue_209"
        },
        risk_state_output: {
          current_state: "allowed",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "normal",
            triggered_by: "LIVE_MODE_APPROVED",
            cooldown_until: null,
            recovery_started_at: null,
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          }
        }
      }
    });
    expect(
      ((((body.summary as Record<string, unknown>).audit_records as Record<string, unknown>[])[0]
        .gate_reasons as string[]) ?? [])
    ).toEqual(["LIVE_MODE_APPROVED"]);
  });

  itWithSqlite("queries persisted blocked gate audit records by session_id filter", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-blocked-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(6);
    const executeBody = parseSingleJsonLine(executeResult.stdout);
    const sessionId = String(
      (((executeBody.error as Record<string, unknown>).details as Record<string, unknown>)
        .audit_record as Record<string, unknown>).session_id
    );

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-read-002",
      "--params",
      JSON.stringify({
        session_id: sessionId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          session_id: sessionId
        },
        audit_records: [
          {
            run_id: runId,
            session_id: sessionId,
            issue_scope: "issue_209",
            risk_state: "allowed",
            gate_decision: "blocked",
            requested_execution_mode: "live_read_high_risk",
            effective_execution_mode: "dry_run",
            approver: null,
            approved_at: null
          }
        ],
        write_action_matrix_decisions: null,
        risk_state_output: {
          current_state: "limited",
          session_rhythm_policy: {
            min_action_interval_ms: 3000,
            min_experiment_interval_ms: 30000,
            cooldown_strategy: "exponential_backoff",
            cooldown_base_minutes: 30,
            cooldown_cap_minutes: 720,
            resume_probe_mode: "recon_only"
          },
          session_rhythm: {
            state: "recovery",
            triggered_by: "MANUAL_CONFIRMATION_MISSING",
            cooldown_until: expect.any(String),
            recovery_started_at: expect.any(String),
            last_event_at: expect.any(String),
            source_event_id: expect.any(String)
          }
        }
      }
    });
    expect(
      ((((body.summary as Record<string, unknown>).audit_records as Record<string, unknown>[])[0]
        .gate_reasons as string[]) ?? [])
    ).toEqual(expect.arrayContaining(["MANUAL_CONFIRMATION_MISSING"]));
  });

  itWithSqlite("persists issue_scope for issue_208 audit records and returns matching write matrix query", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-issue-scope-208-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "write"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 91,
          target_page: "publish_page",
          issue_scope: "issue_208",
          action_type: "write",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(6);

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-query-issue-scope-208-002",
      "--params",
      JSON.stringify({
        run_id: runId
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: runId
        },
        audit_records: [
          {
            run_id: runId,
            issue_scope: "issue_208"
          }
        ],
        write_action_matrix_decisions: {
          issue_scope: "issue_208"
        }
      }
    });
  });

  itWithSqlite("keeps unresolved issue_scope rows visible in runtime.audit query results", async () => {
    const cwd = await createRuntimeCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '5');
      CREATE TABLE runtime_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT,
        profile_name TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_execution_mode TEXT NOT NULL,
        effective_execution_mode TEXT NOT NULL,
        gate_decision TEXT NOT NULL,
        gate_reasons_json TEXT NOT NULL,
        approver TEXT,
        approved_at TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-audit-missing-issue-scope-001",
      "session-audit-missing-issue-scope-001",
      "xhs_account_001",
      "xhs.search",
      "failed",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id,
        target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver,
        approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-audit-missing-issue-scope-001",
      "run-audit-missing-issue-scope-001",
      "session-audit-missing-issue-scope-001",
      "xhs_account_001",
      null,
      "allowed",
      "allowed",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:20:11.000Z",
      "2026-03-23T10:20:11.000Z"
    );
    db.close();

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-missing-issue-scope-query-001",
      "--params",
      JSON.stringify({
        run_id: "run-audit-missing-issue-scope-001"
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body).toMatchObject({
      command: "runtime.audit",
      status: "success",
      summary: {
        query: {
          run_id: "run-audit-missing-issue-scope-001"
        },
        audit_records: [
          {
            run_id: "run-audit-missing-issue-scope-001",
            issue_scope: null,
            write_action_matrix_decisions: null
          }
        ],
        write_action_matrix_decisions: null
      }
    });
  });

  itWithSqlite("keeps resolved audit records queryable when session window also contains unresolved legacy rows", async () => {
    const cwd = await createRuntimeCwd();
    const runId = "run-audit-query-session-mixed-001";

    const executeResult = runCli([
      "xhs.search",
      "--run-id",
      runId,
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 91,
          target_page: "search_result_tab",
          issue_scope: "issue_209",
          action_type: "read",
          requested_execution_mode: "dry_run",
          risk_state: "paused"
        }
      })
    ], cwd, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback"
    });
    expect(executeResult.status).toBe(0);
    const executeBody = parseSingleJsonLine(executeResult.stdout);
    const sessionId = String(
      (((executeBody.summary as Record<string, unknown>).audit_record as Record<string, unknown>)
        .session_id)
    );

    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    const db = new DatabaseSyncCtor(dbPath);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-audit-missing-issue-scope-002",
      sessionId,
      "xhs_account_001",
      "xhs.search",
      "failed",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:20:00.000Z",
      "2026-03-23T10:20:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id,
        target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver,
        approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-audit-missing-issue-scope-002",
      "run-audit-missing-issue-scope-002",
      sessionId,
      "xhs_account_001",
      null,
      "paused",
      "paused",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:20:11.000Z",
      "2026-03-23T10:20:11.000Z"
    );
    db.close();

    const queryResult = runCli([
      "runtime.audit",
      "--run-id",
      "run-audit-mixed-session-query-001",
      "--params",
      JSON.stringify({
        session_id: sessionId,
        limit: 10
      })
    ], cwd);
    expect(queryResult.status).toBe(0);
    const body = parseSingleJsonLine(queryResult.stdout);
    expect(body.summary).toMatchObject({
      audit_records: expect.arrayContaining([
        expect.objectContaining({
          run_id: runId,
          issue_scope: "issue_209"
        }),
        expect.objectContaining({
          run_id: "run-audit-missing-issue-scope-002",
          issue_scope: null,
          write_action_matrix_decisions: null
        })
      ])
    });
    expect((body.summary.audit_records as Record<string, unknown>[])).toHaveLength(2);
  });

  it("returns invalid args when xhs.search requested_execution_mode is missing", () => {
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--params",
      JSON.stringify({
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab"
        }
      })
    ]);
    expect(result.status).toBe(2);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "input_validation",
          reason: "REQUESTED_EXECUTION_MODE_INVALID"
        }
      }
    });
  });

  it.each([
    {
      simulateResult: "login_required",
      reason: "SESSION_EXPIRED",
      category: "request_failed",
      pageKind: "login",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "account_abnormal",
      reason: "ACCOUNT_ABNORMAL",
      category: "request_failed",
      pageKind: "search",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "browser_env_abnormal",
      reason: "BROWSER_ENV_ABNORMAL",
      category: "request_failed",
      pageKind: "search",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "gateway_invoker_failed",
      reason: "GATEWAY_INVOKER_FAILED",
      category: "request_failed",
      pageKind: "search",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "captcha_required",
      reason: "CAPTCHA_REQUIRED",
      category: "request_failed",
      pageKind: "search",
      failureTarget: "/api/sns/web/v1/search/notes",
      failureStage: "request",
      keyRequestCount: 1
    },
    {
      simulateResult: "signature_entry_missing",
      reason: "SIGNATURE_ENTRY_MISSING",
      category: "page_changed",
      pageKind: "search",
      failureTarget: "window._webmsxyw",
      failureStage: "action",
      keyRequestCount: 0
    }
  ])(
    "returns structured execution details for xhs.search $simulateResult path",
    ({
      simulateResult,
      reason,
      category,
      pageKind,
      failureTarget,
      failureStage,
      keyRequestCount
    }) => {
      const runId = `run-sim-${simulateResult}`;
      const result = runCli([
        "xhs.search",
        "--profile",
        "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: `issue209-live-high-risk-${simulateResult}-001`,
          ability: {
            id: "xhs.note.search.v1",
            layer: "L3",
            action: "read"
          },
          input: {
            query: "露营装备"
          },
        options: {
          ...scopedReadGateOptions,
          simulate_result: simulateResult,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
            fingerprint_context: createLoopbackFingerprintContext(),
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId: `issue209-live-high-risk-${simulateResult}-001`
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: `issue209-live-high-risk-${simulateResult}-001`,
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
      ], repoRoot, {
        WEBENVOY_NATIVE_TRANSPORT: "loopback"
      });
      expect(result.status).toBe(6);
      const body = parseSingleJsonLine(result.stdout);
      const observability = asRecord(body.observability);
      const failureSite = asRecord(observability?.failure_site);
      const keyRequests = Array.isArray(observability?.key_requests)
        ? (observability?.key_requests as Array<Record<string, unknown>>)
        : [];
      expect(body).toMatchObject({
        command: "xhs.search",
        status: "error",
        error: {
          code: "ERR_EXECUTION_FAILED",
          details: {
            ability_id: "xhs.note.search.v1",
            stage: "execution",
            reason
          },
          diagnosis: {
            category
          }
        },
        observability: {
          page_state: {
            page_kind: pageKind
          }
        }
      });
      expect((asRecord(asRecord(body.error)?.diagnosis)?.failure_site)?.target).toBe(failureTarget);
      expect(failureSite?.target).toBe(failureTarget);
      expect(failureSite?.stage).toBe(failureStage);
      expect(keyRequests).toHaveLength(keyRequestCount);
    }
  );

  it("returns structured output mapping details for xhs.search bad output path", () => {
    const runId = "run-output-bad-output-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-bad-output-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备",
          force_bad_output: true
        },
        options: {
          ...scopedReadGateOptions,
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId: "issue209-live-high-risk-bad-output-001"
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-high-risk-bad-output-001",
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ]);
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_MISSING"
        }
      }
    });
  });

  it("returns output mapping failure when runtime success payload omits capability_result", () => {
    const runId = "run-output-missing-capability-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "missing_capability_result",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createLoopbackFingerprintContext(),
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId: "issue209-live-high-risk-001"
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-high-risk-001",
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_BROWSER_PATH: path.join(repoRoot, "tests", "fixtures", "mock-browser.sh"),
      WEBENVOY_BROWSER_MOCK_VERSION: "Chromium 146.0.0.0"
    });
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_MISSING"
        }
      }
    });
  });

  it("returns output mapping failure when runtime success payload carries invalid capability_result", () => {
    const runId = "run-output-invalid-capability-001";
    const result = runCli([
      "xhs.search",
      "--profile",
      "xhs_account_001",
      "--run-id",
      runId,
      "--params",
      JSON.stringify({
        request_id: "issue209-live-high-risk-invalid-capability-001",
        ability: {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        },
        input: {
          query: "露营装备"
        },
        options: {
          ...scopedReadGateOptions,
          simulate_result: "capability_result_invalid_outcome",
          requested_execution_mode: "live_read_high_risk",
          risk_state: "allowed",
          fingerprint_context: createLoopbackFingerprintContext(),
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
          audit_record: createAllowedHighRiskAuditRecord({
            runId,
            requestId: "issue209-live-high-risk-invalid-capability-001"
          }),
          admission_context: createApprovedReadAdmissionContext({
            runId,
            requestId: "issue209-live-high-risk-invalid-capability-001",
            requestedExecutionMode: "live_read_high_risk",
            riskState: "allowed"
          })
        }
      })
    ], repoRoot, {
      WEBENVOY_NATIVE_TRANSPORT: "loopback",
      WEBENVOY_BROWSER_PATH: path.join(repoRoot, "tests", "fixtures", "mock-browser.sh"),
      WEBENVOY_BROWSER_MOCK_VERSION: "Chromium 146.0.0.0"
    });
    expect(result.status).toBe(6);
    const body = parseSingleJsonLine(result.stdout);
    expect(body).toMatchObject({
      command: "xhs.search",
      status: "error",
      error: {
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_OUTCOME_INVALID"
        }
      }
    });
  });

});
