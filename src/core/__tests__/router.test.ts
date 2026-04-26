import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { createCommandRegistry } from "../../commands/index.js";
import { executeCommand } from "../router.js";
import { ProfileStore } from "../../runtime/profile-store.js";
import {
  SQLiteRuntimeStore,
  resolveRuntimeStorePath
} from "../../runtime/store/sqlite-runtime-store.js";
import type { CommandExecutionResult, RuntimeContext } from "../types.js";

const baseContext: RuntimeContext = {
  run_id: "run-test-001",
  command: "runtime.ping",
  profile: null,
  params: {},
  cwd: "/tmp"
};

describe("executeCommand", () => {
  const createHighRiskAuditRecord = (requestId: string) => {
    return {
      event_id: `gate_evt_router_${requestId}`,
      issue_scope: "issue_209",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      gate_decision: "allowed",
      recorded_at: "2026-03-23T10:00:30Z"
    } as const;
  };

  const createApprovedReadAdmissionContext = (requestId: string) => ({
    approval_admission_evidence: {
      approval_admission_ref: `approval_admission_${baseContext.run_id}_${requestId}`,
      run_id: baseContext.run_id,
      session_id: "nm-session-001",
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
      audit_admission_ref: `audit_admission_${baseContext.run_id}_${requestId}`,
      run_id: baseContext.run_id,
      session_id: "nm-session-001",
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
      recorded_at: "2026-03-23T10:00:30Z"
    }
  });

  const scopedXhsGateOptions = {
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "search_result_tab",
    requested_execution_mode: "dry_run"
  } as const;

  const seedXhsCloseoutReady = async (input: {
    cwd: string;
    profile: string;
    effectiveExecutionMode?: "live_read_high_risk";
  }): Promise<void> => {
    const effectiveExecutionMode = input.effectiveExecutionMode ?? "live_read_high_risk";
    const profileStore = new ProfileStore(join(input.cwd, ".webenvoy", "profiles"));
    const nowIso = new Date().toISOString();
    const meta = await profileStore.initializeMeta(input.profile, nowIso, {
      allowUnsupportedExtensionBrowser: true
    });
    await profileStore.writeMeta(input.profile, {
      ...meta,
      profileState: "ready",
      accountSafety: {
        state: "clear",
        platform: null,
        reason: null,
        observedAt: null,
        cooldownUntil: null,
        sourceRunId: null,
        sourceCommand: null,
        targetDomain: null,
        targetTabId: null,
        pageUrl: null,
        statusCode: null,
        platformCode: null
      },
      xhsCloseoutRhythm: {
        state: "single_probe_passed",
        cooldownUntil: "2000-01-01T00:30:00.000Z",
        operatorConfirmedAt: nowIso,
        singleProbeRequired: false,
        singleProbePassedAt: nowIso,
        probeRunId: `run-${input.profile}-router-recovery-probe`,
        fullBundleBlocked: true,
        reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
      }
    });

    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(input.cwd));
    const safeProfile = input.profile.replace(/[^a-z0-9_-]+/gi, "-");
    const scopes = [
      ["FR-0012", "layer1_consistency"],
      ["FR-0013", "layer2_interaction"],
      ["FR-0014", "layer3_session_rhythm"]
    ] as const;
    try {
      for (const [targetFrRef, validationScope] of scopes) {
        const uniqueRef = `${safeProfile}/${effectiveExecutionMode}/${process.hrtime.bigint()}`;
        const requestRef = `validation-request/${targetFrRef}/${uniqueRef}`;
        const sampleRef = `validation-sample/${targetFrRef}/${uniqueRef}`;
        const baselineRef = `baseline/${targetFrRef}/${uniqueRef}`;
        const recordRef = `validation-record/${targetFrRef}/${uniqueRef}`;
        const runId = `run-${targetFrRef}-${safeProfile}-${effectiveExecutionMode}`;
        const scope = {
          targetFrRef,
          validationScope,
          profileRef: `profile/${input.profile}`,
          browserChannel: "Google Chrome stable" as const,
          executionSurface: "real_browser" as const,
          effectiveExecutionMode,
          probeBundleRef: "probe-bundle/xhs-closeout-min-v1"
        };
        await store.upsertAntiDetectionValidationRequest({
          requestRef,
          validationScope,
          targetFrRef,
          profileRef: `profile/${input.profile}`,
          browserChannel: "Google Chrome stable",
          executionSurface: "real_browser",
          sampleGoal: `capture ${targetFrRef} closeout baseline`,
          requestedExecutionMode: effectiveExecutionMode,
          probeBundleRef: "probe-bundle/xhs-closeout-min-v1",
          requestState: "accepted",
          requestedAt: nowIso
        });
        await store.upsertAntiDetectionValidationRequest({
          requestRef,
          validationScope,
          targetFrRef,
          profileRef: `profile/${input.profile}`,
          browserChannel: "Google Chrome stable",
          executionSurface: "real_browser",
          sampleGoal: `capture ${targetFrRef} closeout baseline`,
          requestedExecutionMode: effectiveExecutionMode,
          probeBundleRef: "probe-bundle/xhs-closeout-min-v1",
          requestState: "completed",
          requestedAt: nowIso
        });
        await store.insertAntiDetectionStructuredSample({
          ...scope,
          sampleRef,
          requestRef,
          runId,
          capturedAt: nowIso,
          structuredPayload: { target_fr_ref: targetFrRef, stable: true },
          artifactRefs: []
        });
        await store.insertAntiDetectionBaselineSnapshot({
          ...scope,
          baselineRef,
          signalVector: { stable: true },
          capturedAt: nowIso,
          sourceSampleRefs: [sampleRef],
          sourceRunIds: [runId]
        });
        await store.insertAntiDetectionValidationRecord({
          ...scope,
          recordRef,
          requestRef,
          sampleRef,
          baselineRef,
          resultState: "verified",
          driftState: "no_drift",
          failureClass: null,
          runId,
          validatedAt: nowIso
        });
        await store.upsertAntiDetectionBaselineRegistryEntry({
          ...scope,
          activeBaselineRef: baselineRef,
          supersededBaselineRefs: [],
          replacementReason: "initial_seed",
          updatedAt: nowIso
        });
      }
    } finally {
      store.close();
    }
  };

  it("returns summary when command is implemented", async () => {
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    let execution: CommandExecutionResult;
    try {
      execution = await executeCommand(baseContext, createCommandRegistry());
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
    }

    expect(execution.summary).toMatchObject({
      message: "pong",
      transport: {
        protocol: "webenvoy.native-bridge.v1",
        state: "ready"
      }
    });
  });

  it("returns unknown command error for unregistered command", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "unknown.test"
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_CLI_UNKNOWN_COMMAND" });
  });

  it("returns invalid args error when xhs.search lacks ability envelope", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001"
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        ability_id: "unknown",
        stage: "input_validation",
        reason: "ABILITY_MISSING"
      }
    });
  });

  it("returns capability summary for xhs.search fixture success", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFixtureFlag = process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS;
    process.env.NODE_ENV = "test";
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = "1";
    try {
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
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
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.search.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = previousFixtureFlag;
    }
  });

  it("returns capability summary for xhs.detail fixture success", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFixtureFlag = process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS;
    process.env.NODE_ENV = "test";
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = "1";
    try {
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.detail",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.note.detail.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              note_id: "note-001"
            },
            options: {
              ...scopedXhsGateOptions,
              target_page: "explore_detail_tab",
              fixture_success: true
            }
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.detail.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = previousFixtureFlag;
    }
  });

  it("returns capability summary for xhs.user_home fixture success", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousFixtureFlag = process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS;
    process.env.NODE_ENV = "test";
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = "1";
    try {
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.user_home",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.user.home.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              user_id: "user-001"
            },
            options: {
              ...scopedXhsGateOptions,
              target_page: "profile_tab",
              fixture_success: true
            }
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.user.home.v1",
          layer: "L3",
          action: "read",
          outcome: "partial"
        }
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS = previousFixtureFlag;
    }
  });

  it("returns capability summary and observability for xhs.search runtime success", async () => {
    const requestId = "router-live-high-risk-001";
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd: baseContext.cwd, profile: "xhs_account_001" });
      const execution = await executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
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
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              simulate_result: "success",
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
              audit_record: createHighRiskAuditRecord(requestId),
              admission_context: createApprovedReadAdmissionContext(requestId)
            }
          }
        },
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.search.v1",
          outcome: "success"
        }
      });
      expect(execution.observability).toMatchObject({
        page_state: {
          page_kind: "search"
        }
      });
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      if (previousBrowserPath === undefined) {
        delete process.env.WEBENVOY_BROWSER_PATH;
      } else {
        process.env.WEBENVOY_BROWSER_PATH = previousBrowserPath;
      }
      if (previousBrowserMockVersion === undefined) {
        delete process.env.WEBENVOY_BROWSER_MOCK_VERSION;
      } else {
        process.env.WEBENVOY_BROWSER_MOCK_VERSION = previousBrowserMockVersion;
      }
    }
  });

  it("returns output mapping failure when xhs.search runtime success omits capability_result", async () => {
    const requestId = "router-missing-capability-001";
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd: baseContext.cwd, profile: "xhs_account_001" });
      await expect(
        executeCommand(
          {
            ...baseContext,
            command: "xhs.search",
            profile: "xhs_account_001",
            params: {
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
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                simulate_result: "missing_capability_result",
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
                audit_record: createHighRiskAuditRecord(requestId),
                admission_context: createApprovedReadAdmissionContext(requestId)
              }
            }
          },
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_MISSING"
        }
      });
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      if (previousBrowserPath === undefined) {
        delete process.env.WEBENVOY_BROWSER_PATH;
      } else {
        process.env.WEBENVOY_BROWSER_PATH = previousBrowserPath;
      }
      if (previousBrowserMockVersion === undefined) {
        delete process.env.WEBENVOY_BROWSER_MOCK_VERSION;
      } else {
        process.env.WEBENVOY_BROWSER_MOCK_VERSION = previousBrowserMockVersion;
      }
    }
  });

  it("returns output mapping failure when xhs.search runtime success carries invalid capability_result", async () => {
    const requestId = "router-invalid-capability-001";
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd: baseContext.cwd, profile: "xhs_account_001" });
      await expect(
        executeCommand(
          {
            ...baseContext,
            command: "xhs.search",
            profile: "xhs_account_001",
            params: {
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
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                simulate_result: "capability_result_invalid_outcome",
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
                audit_record: createHighRiskAuditRecord(requestId),
                admission_context: createApprovedReadAdmissionContext(requestId)
              }
            }
          },
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          ability_id: "xhs.note.search.v1",
          stage: "output_mapping",
          reason: "CAPABILITY_RESULT_OUTCOME_INVALID"
        }
      });
    } finally {
      process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      if (previousBrowserPath === undefined) {
        delete process.env.WEBENVOY_BROWSER_PATH;
      } else {
        process.env.WEBENVOY_BROWSER_PATH = previousBrowserPath;
      }
      if (previousBrowserMockVersion === undefined) {
        delete process.env.WEBENVOY_BROWSER_MOCK_VERSION;
      } else {
        process.env.WEBENVOY_BROWSER_MOCK_VERSION = previousBrowserMockVersion;
      }
    }
  });

  it("returns invalid args when xhs.search misses target gate fields", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
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
          }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        reason: "TARGET_DOMAIN_INVALID"
      }
    });
  });

  it("returns invalid args when xhs.search requested_execution_mode is missing", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.search",
          profile: "xhs_account_001",
          params: {
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
          }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        reason: "REQUESTED_EXECUTION_MODE_INVALID"
      }
    });
  });

  it("returns invalid args when xhs.detail note_id is missing", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.detail",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.note.detail.v1",
              layer: "L3",
              action: "read"
            },
            input: {},
            options: {
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "explore_detail_tab",
              requested_execution_mode: "dry_run"
            }
          }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        reason: "NOTE_ID_MISSING"
      }
    });
  });

  it("returns invalid args when xhs.user_home user_id is missing", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          command: "xhs.user_home",
          profile: "xhs_account_001",
          params: {
            ability: {
              id: "xhs.user.home.v1",
              layer: "L3",
              action: "read"
            },
            input: {},
            options: {
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "profile_tab",
              requested_execution_mode: "dry_run"
            }
          }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({
      code: "ERR_CLI_INVALID_ARGS",
      details: {
        reason: "USER_ID_MISSING"
      }
    });
  });

  it("returns runtime unavailable error without collapsing into execution failed", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          params: { simulate_runtime_unavailable: true }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_RUNTIME_UNAVAILABLE", retryable: true });
  });

  it("maps command handler exceptions to ERR_EXECUTION_FAILED", async () => {
    await expect(
      executeCommand(
        {
          ...baseContext,
          params: { force_fail: true }
        },
        createCommandRegistry()
      )
    ).rejects.toMatchObject({ code: "ERR_EXECUTION_FAILED" });
  });
});
