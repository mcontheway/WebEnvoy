import { describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildOfficialChromeRuntimeStatusParams,
  ensureOfficialChromeRuntimeReady,
  normalizeGateOptionsForContract,
  resolveForwardTimeoutMsForContract
} from "../xhs.js";
import { executeCommand } from "../../core/router.js";
import { createCommandRegistry } from "../index.js";
import { ProfileStore } from "../../runtime/profile-store.js";
import {
  SQLiteRuntimeStore,
  resolveRuntimeStorePath
} from "../../runtime/store/sqlite-runtime-store.js";
import { persistXhsCloseoutValidationSignals } from "../../runtime/anti-detection-validation.js";
import type { RuntimeContext } from "../../core/types.js";

type DatabaseSyncCtor = new (path: string) => {
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
};

const ISSUE209_APPROVAL_CHECKS = {
  target_domain_confirmed: true,
  target_tab_confirmed: true,
  target_page_confirmed: true,
  risk_state_checked: true,
  action_type_confirmed: true
};

let xhsCloseoutValidationSeedSequence = 0;

const createApprovedAnonymousReadAdmissionContext = (runId: string, requestId: string) => ({
  approval_admission_evidence: {
    approval_admission_ref: `approval_admission_${runId}_${requestId}`,
    run_id: runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "explore_detail_tab",
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    approved: true,
    approver: "qa-reviewer",
    approved_at: "2026-03-23T10:00:00Z",
    checks: ISSUE209_APPROVAL_CHECKS,
    recorded_at: "2026-03-23T10:00:00Z"
  },
  audit_admission_evidence: {
    audit_admission_ref: `audit_admission_${runId}_${requestId}`,
    run_id: runId,
    session_id: "nm-session-001",
    issue_scope: "issue_209",
    target_domain: "www.xiaohongshu.com",
    target_tab_id: 32,
    target_page: "explore_detail_tab",
    action_type: "read",
    requested_execution_mode: "live_read_high_risk",
    risk_state: "allowed",
    audited_checks: ISSUE209_APPROVAL_CHECKS,
    recorded_at: "2026-03-23T10:00:30Z"
  }
});

const createIssue209FormalApprovalRecord = (decisionId: string, approvalId: string) => ({
  decision_id: decisionId,
  approval_id: approvalId,
  approved: true,
  approver: "mcontheway",
  approved_at: "2026-04-23T14:17:30Z",
  checks: ISSUE209_APPROVAL_CHECKS
});

const createIssue209FormalAuditRecord = (
  requestId: string,
  decisionId: string,
  approvalId: string
) => ({
  event_id: `gate_evt_${decisionId}`,
  decision_id: decisionId,
  approval_id: approvalId,
  request_id: requestId,
  issue_scope: "issue_209",
  target_domain: "www.xiaohongshu.com",
  target_tab_id: 32,
  target_page: "search_result_tab",
  action_type: "read",
  requested_execution_mode: "live_read_high_risk",
  risk_state: "allowed",
  gate_decision: "allowed",
  audited_checks: ISSUE209_APPROVAL_CHECKS,
  recorded_at: "2026-04-23T14:17:31Z"
});

const seedXhsCloseoutReady = async (input: {
  cwd: string;
  profile: string;
  effectiveExecutionMode?: "live_read_high_risk" | "live_read_limited" | "live_write";
}) => {
  const effectiveExecutionMode = input.effectiveExecutionMode ?? "live_read_high_risk";
  const profileStore = new ProfileStore(join(input.cwd, ".webenvoy", "profiles"));
  const meta =
    (await profileStore.readMeta(input.profile, { mode: "readonly" }).catch(() => null)) ??
    (await profileStore.initializeMeta(input.profile, "2026-04-25T10:00:00.000Z", {
      allowUnsupportedExtensionBrowser: true
    }));
  await profileStore.writeMeta(input.profile, {
    ...meta,
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
      operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
      singleProbeRequired: false,
      singleProbePassedAt: "2026-04-25T10:40:00.000Z",
      probeRunId: `run-${input.profile}-recovery-probe`,
      fullBundleBlocked: true,
      reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
    }
  });

  const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(input.cwd));
  try {
    xhsCloseoutValidationSeedSequence += 1;
    await persistXhsCloseoutValidationSignals({
      store,
      profile: input.profile,
      effectiveExecutionMode,
      targetDomain: "www.xiaohongshu.com",
      runId: `run-${input.profile}-xhs-closeout-validation-${process.pid}-${xhsCloseoutValidationSeedSequence}`,
      observedAt: "2026-04-25T10:45:00.000Z",
      signals: {
        layer1_consistency: {
          browser_returned_evidence: {
            source: "main_world",
            target_domain: "www.xiaohongshu.com",
            probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
          },
          fingerprint_runtime: {
            fingerprint_profile_bundle_ref: "fingerprint-bundle/xhs-closeout",
            fingerprint_patch_manifest: {
              required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"]
            },
            injection: {
              installed: true,
              required_patches: ["audio_context", "battery", "navigator_plugins", "navigator_mime_types"],
              missing_required_patches: [],
              source: "main_world"
            }
          }
        },
        layer2_interaction: {
          browser_returned_evidence: {
            source: "main_world",
            target_domain: "www.xiaohongshu.com",
            probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
          },
          event_strategy_profile: {
            action_kind: "scroll",
            preferred_path: "real_input"
          },
          event_chain_policy: {
            chain_name: "scroll_segment",
            required_events: ["wheel", "scroll"]
          },
          rhythm_profile: {
            profile_name: "default_layer2",
            scroll_segment_min_px: 120,
            scroll_segment_max_px: 480
          },
          strategy_selection: {
            action_kind: "scroll",
            selected_path: "real_input"
          },
          execution_trace: {
            action_kind: "scroll",
            selected_path: "real_input",
            settled_wait_result: "settled"
          }
        },
        layer3_session_rhythm: {
          browser_returned_evidence: {
            source: "execution_audit",
            target_domain: "www.xiaohongshu.com",
            probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1"
          },
          session_rhythm_window_id: `rhythm_win_${input.profile}_issue_209`,
          session_rhythm_decision_id: `rhythm_decision_${input.profile}_single_probe`,
          escalation: "recon_probe_to_live_admission"
        }
      }
    });
  } finally {
    store.close();
  }
};

const createSchemaMismatchRuntimeStore = async (cwd: string): Promise<void> => {
  const require = createRequire(import.meta.url);
  const sqliteModule = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
  if (typeof sqliteModule.DatabaseSync !== "function") {
    throw new Error("node:sqlite DatabaseSync unavailable");
  }
  await mkdir(join(cwd, ".webenvoy", "runtime"), { recursive: true });
  const db = new sqliteModule.DatabaseSync(resolveRuntimeStorePath(cwd));
  try {
    db.prepare("CREATE TABLE runtime_store_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
    db.prepare("INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', ?)").run("999");
  } finally {
    db.close();
  }
};

describe("ensureOfficialChromeRuntimeReady", () => {
  it("does not forward persistent extension identity into runtime.status params", () => {
    expect(
      buildOfficialChromeRuntimeStatusParams(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_profile",
          run_id: "run-xhs-ready-identity-001",
          command: "xhs.search",
          params: {
            persistentExtensionIdentity: {
              extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              manifestPath: "/tmp/native-host-manifest.json"
            }
          }
        },
        "live_read_high_risk"
      )
    ).toEqual({
      requested_execution_mode: "live_read_high_risk"
    });
  });

  it("delivers runtime.bootstrap before allowing official Chrome execution to proceed", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-xhs-ready-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_ready_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_profile",
          run_id: "run-xhs-ready-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).resolves.toBeUndefined();

    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "runtime.bootstrap",
        params: expect.objectContaining({
          version: "v1",
          run_id: "run-xhs-ready-001",
          profile: "official_ready_profile",
          target_tab_id: 32
        })
      })
    );
    const bootstrapCommand = bridge.runCommand.mock.calls[0]?.[0];
    expect(bootstrapCommand.params.runtime_context_id).toEqual(expect.any(String));
    expect(bootstrapCommand.params.main_world_secret).toEqual(expect.any(String));
  });

  it("skips re-bootstrap when official Chrome runtime already reports ready", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-xhs-live-ready-rebootstrap-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_live_ready_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_live_ready_profile",
          run_id: "run-xhs-live-ready-rebootstrap-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).resolves.toBeUndefined();

    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("keeps caller fingerprint runtime when runtime is already ready", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-xhs-live-ready-attested-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_live_ready_attested_profile",
            status: "ready"
          },
          fingerprint_runtime: {
            fingerprint_profile_bundle: {
              id: "bundle-attested"
            },
            fingerprint_patch_manifest: {
              runtime_id: "runtime-attested"
            },
            injection: {
              installed: true,
              channel: "main_world"
            }
          }
        },
        error: null
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_live_ready_attested_profile",
          run_id: "run-xhs-live-ready-attested-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_write",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "creator.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "creator_publish_tab",
          options: {
            requested_execution_mode: "live_write"
          }
        } as never,
        readStatus
      )
    ).resolves.toBeUndefined();
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("re-bootstrap current run when readiness reports stale bootstrap state", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "blocked",
        identityBindingState: "bound",
        bootstrapState: "stale",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-xhs-stale-bootstrap-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_stale_bootstrap_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_stale_bootstrap_profile",
          run_id: "run-xhs-stale-bootstrap-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).resolves.toBeUndefined();

    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap",
        params: expect.objectContaining({
          run_id: "run-xhs-stale-bootstrap-001",
          profile: "official_stale_bootstrap_profile"
        })
      })
    );
  });

  it("reuses the same runtime_context_id across same-run bootstrap retries", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn(async (request: { command: string; params: { runtime_context_id: string } }) => {
        if (request.command === "runtime.bootstrap") {
          return {
            ok: true,
            payload: {
              result: {
                version: "v1",
                run_id: "run-xhs-retry-001",
                runtime_context_id: request.params.runtime_context_id,
                profile: "official_retry_profile",
                status: "ready"
              }
            },
            error: null
          };
        }
        if (request.command === "runtime.readiness") {
          return {
            ok: true,
            payload: {
              transport_state: "ready",
              bootstrap_state: "pending"
            },
            error: null
          };
        }
        throw new Error(`unexpected command: ${request.command}`);
      })
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_retry_profile",
          run_id: "run-xhs-retry-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
    });

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_retry_profile",
          run_id: "run-xhs-retry-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
    });

    const bootstrapContexts = bridge.runCommand.mock.calls
      .filter(([request]) => request.command === "runtime.bootstrap")
      .map(([request]) => request.params.runtime_context_id);

    expect(bootstrapContexts).toHaveLength(2);
    expect(bootstrapContexts[0]).toBe(bootstrapContexts[1]);
  });

  it("waits for bridge readiness when runtime.bootstrap is initially not delivered", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          error: {
            code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
            message: "runtime bootstrap 尚未获得执行面确认"
          }
        })
        .mockResolvedValueOnce({
          ok: true,
          payload: {
            transport_state: "ready",
            bootstrap_state: "pending"
          },
          error: null
        })
        .mockResolvedValueOnce({
          ok: true,
          payload: {
            transport_state: "ready",
            bootstrap_state: "ready"
          },
          error: null
        })
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_first_command_profile",
          run_id: "run-xhs-first-command-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).resolves.toBeUndefined();

    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "runtime.bootstrap"
      })
    );
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "runtime.readiness"
      })
    );
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        command: "runtime.readiness"
      })
    );
  });

  it("keeps runtime gated when lock is lost before the final official Chrome gate", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "pending",
        transportState: "ready",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        runtimeReadiness: "blocked",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: false
      });
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-xhs-missing-transport-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_missing_transport_state_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_missing_transport_state_profile",
          run_id: "run-xhs-missing-transport-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED",
      details: expect.objectContaining({
        runtime_readiness: "blocked",
        bootstrap_state: "ready",
        transport_state: "ready",
        lock_held: false,
        reason: "ERR_PROFILE_LOCKED"
      })
    });
  });

  it("blocks execution bootstrap while profile is still logging_in", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "logging_in",
      confirmationRequired: true,
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_logging_in_profile",
          run_id: "run-xhs-logging-in-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE",
      retryable: false,
      details: expect.objectContaining({
        profile_state: "logging_in",
        confirmation_required: true,
        reason: "ERR_RUNTIME_LOGIN_CONFIRMATION_REQUIRED"
      })
    });
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("blocks execution bootstrap when confirmationRequired=true even if profile state is ready", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      confirmationRequired: true,
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_confirmation_pending_profile",
          run_id: "run-xhs-confirm-required-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE",
      retryable: false,
      details: expect.objectContaining({
        profile_state: "ready",
        confirmation_required: true,
        reason: "ERR_RUNTIME_LOGIN_CONFIRMATION_REQUIRED"
      })
    });
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("surfaces missing official runtime readiness signals before execution", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      confirmationRequired: false,
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "not_started",
      transportState: "not_connected",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn(async () => ({
        ok: true,
        payload: {
          message: "pong"
        },
        relay_path: "host>background>content-script>background>host"
      }))
    };

    await expect(
      ensureOfficialChromeRuntimeReady(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_transport_not_connected_profile",
          run_id: "run-xhs-transport-not-connected-001"
        } as never,
        {
          id: "xhs.note.search.v1",
          layer: "L3",
          action: "read"
        } as never,
        "live_read_high_risk",
        bridge as never,
        {
          fingerprint_profile_bundle: null
        } as never,
        {
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          targetPage: "search_result_tab",
          options: {
            requested_execution_mode: "live_read_high_risk"
          }
        } as never,
        readStatus
      )
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE",
      details: expect.objectContaining({
        reason: "ERR_RUNTIME_READINESS_SIGNAL_MISSING",
        relay_path: "host>background>content-script>background>host"
      })
    });
    expect(bridge.runCommand).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.readiness"
      })
    );
  });
});

describe("normalizeGateOptionsForContract", () => {
  describe("resolveForwardTimeoutMsForContract", () => {
    it("keeps a valid top-level timeout_ms for native bridge forwarding", () => {
      expect(resolveForwardTimeoutMsForContract({ timeout_ms: 120_000 })).toBe(120_000);
    });

    it("rejects invalid timeout_ms values instead of forwarding ambiguous budgets", () => {
      expect(resolveForwardTimeoutMsForContract({ timeout_ms: 0 })).toBeNull();
      expect(resolveForwardTimeoutMsForContract({ timeout_ms: -1 })).toBeNull();
      expect(resolveForwardTimeoutMsForContract({ timeout_ms: 1.5 })).toBeNull();
      expect(resolveForwardTimeoutMsForContract({ timeout_ms: "120000" })).toBeNull();
      expect(resolveForwardTimeoutMsForContract({})).toBeNull();
    });
  });

  it("keeps target_tab_id mandatory for issue_208 editor_input", () => {
    try {
      normalizeGateOptionsForContract(
        {
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          requested_execution_mode: "live_write",
          validation_action: "editor_input"
        },
        "xhs.note.search.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_TAB_ID_INVALID"
        }
      });
    }
  });

  it("keeps target_tab_id mandatory outside issue_208 editor_input validation", () => {
    try {
      normalizeGateOptionsForContract(
        {
          target_domain: "creator.xiaohongshu.com",
          target_page: "creator_publish_tab",
          requested_execution_mode: "live_write"
        },
        "xhs.note.search.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_TAB_ID_INVALID"
        }
      });
    }
  });

  it("keeps target_tab_id mandatory when issue_208 editor_input is not pinned to creator_publish_tab", () => {
    try {
      normalizeGateOptionsForContract(
        {
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_page: "search_result_tab",
          requested_execution_mode: "live_write",
          validation_action: "editor_input"
        },
        "xhs.note.search.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_TAB_ID_INVALID"
        }
      });
    }
  });

  it("rejects issue_208 editor_input when explicit target_tab_id is paired with a non-publish target_page", () => {
    try {
      normalizeGateOptionsForContract(
        {
          issue_scope: "issue_208",
          target_domain: "creator.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "live_write",
          validation_action: "editor_input"
        },
        "xhs.note.search.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_PAGE_INVALID"
        }
      });
    }
  });

  it("rejects xhs.detail when target_page is not explore_detail_tab", () => {
    try {
      normalizeGateOptionsForContract(
        {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "dry_run"
        },
        "xhs.note.detail.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_PAGE_INVALID"
        }
      });
    }
  });

  it("rejects xhs.user_home when target_page is not profile_tab", () => {
    try {
      normalizeGateOptionsForContract(
        {
          issue_scope: "issue_209",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 32,
          target_page: "search_result_tab",
          requested_execution_mode: "dry_run"
        },
        "xhs.user.home.v1"
      );
      throw new Error("expected normalizeGateOptionsForContract to throw");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ERR_CLI_INVALID_ARGS",
        details: {
          reason: "TARGET_PAGE_INVALID"
        }
      });
    }
  });

  it("derives canonical compatibility mode from FR-0023 objects instead of stale legacy mode", () => {
    const normalized = normalizeGateOptionsForContract(
      {
        requested_execution_mode: "live_write"
      },
      "xhs.note.search.v1",
      {
        command: "xhs.search",
        abilityAction: "read",
        runtimeProfile: "profile-anon-001",
        upstreamAuthorization: {
          action_request: {
            request_ref: "upstream_req_mode_001",
            action_name: "xhs.read_search_results",
            action_category: "read"
          },
          resource_binding: {
            binding_ref: "binding_mode_001",
            resource_kind: "anonymous_context",
            profile_ref: null,
            binding_constraints: {
              anonymous_required: true,
              reuse_logged_in_context_forbidden: true
            }
          },
          authorization_grant: {
            grant_ref: "grant_mode_001",
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
            target_ref: "target_mode_001",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        } as never
      }
    );

    expect(normalized.requestedExecutionMode).toBe("dry_run");
    expect(normalized.options).toMatchObject({
      requested_execution_mode: "dry_run",
      __legacy_requested_execution_mode: "live_write"
    });
  });

  it("projects canonical live-read mode when legacy mode is omitted", () => {
    const normalized = normalizeGateOptionsForContract(
      {},
      "xhs.note.search.v1",
      {
        command: "xhs.search",
        abilityAction: "read",
        runtimeProfile: "profile-session-001",
        upstreamAuthorization: {
          action_request: {
            request_ref: "upstream_req_mode_002",
            action_name: "xhs.read_search_results",
            action_category: "read"
          },
          resource_binding: {
            binding_ref: "binding_mode_002",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_mode_002",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
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
            target_ref: "target_mode_002",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        } as never
      }
    );

    expect(normalized.requestedExecutionMode).toBe("live_read_high_risk");
    expect(normalized.options).not.toHaveProperty("__legacy_requested_execution_mode");
  });

  it("keeps canonical mode at dry_run when grant snapshot is missing", () => {
    const normalized = normalizeGateOptionsForContract(
      {},
      "xhs.note.search.v1",
      {
        command: "xhs.search",
        abilityAction: "read",
        runtimeProfile: "profile-session-001",
        upstreamAuthorization: {
          action_request: {
            request_ref: "upstream_req_mode_003",
            action_name: "xhs.read_search_results",
            action_category: "read"
          },
          resource_binding: {
            binding_ref: "binding_mode_003",
            resource_kind: "profile_session",
            profile_ref: "profile-session-001"
          },
          authorization_grant: {
            grant_ref: "grant_mode_003",
            allowed_actions: ["xhs.read_search_results"],
            binding_scope: {
              allowed_resource_kinds: ["profile_session"],
              allowed_profile_refs: ["profile-session-001"]
            },
            target_scope: {
              allowed_domains: ["www.xiaohongshu.com"],
              allowed_pages: ["search_result_tab"]
            },
            approval_refs: ["approval_admission_external_001"],
            audit_refs: ["audit_admission_external_001"]
          },
          runtime_target: {
            target_ref: "target_mode_003",
            domain: "www.xiaohongshu.com",
            page: "search_result_tab",
            tab_id: 32
          }
        } as never
      }
    );

    expect(normalized.requestedExecutionMode).toBe("dry_run");
  });

  it("blocks XHS live commands before runtime bridge when profile account_safety is blocked", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-account-safety-blocked-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    delete process.env.WEBENVOY_NATIVE_TRANSPORT;
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_account_blocked_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_account_blocked_profile", {
        ...meta,
        accountSafety: {
          state: "account_risk_blocked",
          platform: "xhs",
          reason: "ACCOUNT_ABNORMAL",
          observedAt: "2026-04-25T10:01:00.000Z",
          cooldownUntil: "2026-04-25T10:31:00.000Z",
          sourceRunId: "run-account-risk-source-001",
          sourceCommand: "xhs.search",
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          pageUrl: "https://www.xiaohongshu.com/search_result?keyword=test",
          statusCode: 461,
          platformCode: 300011
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_account_blocked_profile",
            run_id: "run-account-risk-blocked-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ACCOUNT_RISK_BLOCKED",
          closeout_hard_stop_risk: expect.objectContaining({
            state: "hard_stop",
            risk_class: "account_abnormal",
            reason: "ACCOUNT_ABNORMAL",
            source: "account_safety",
            should_block_route_action: true
          }),
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "ACCOUNT_ABNORMAL",
            live_commands_blocked: true
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("blocks non-closeout XHS live commands when profile account_safety is blocked", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-account-safety-write-blocked-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_account_write_blocked_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_account_write_blocked_profile", {
        ...meta,
        accountSafety: {
          state: "account_risk_blocked",
          platform: "xhs",
          reason: "ACCOUNT_ABNORMAL",
          observedAt: "2026-04-25T10:01:00.000Z",
          cooldownUntil: "2026-04-25T10:31:00.000Z",
          sourceRunId: "run-account-risk-source-002",
          sourceCommand: "xhs.search",
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          pageUrl: "https://www.xiaohongshu.com/search_result?keyword=test",
          statusCode: 461,
          platformCode: 300011
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_account_write_blocked_profile",
            run_id: "run-account-risk-write-blocked-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "write"
              },
              input: {
                query: "露营"
              },
              options: {
                issue_scope: "issue_208",
                target_domain: "creator.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "creator_publish_tab",
                action_type: "write",
                requested_execution_mode: "live_write",
                validation_action: "editor_input",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ACCOUNT_RISK_BLOCKED",
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            live_commands_blocked: true
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("persists account_safety blocked when an XHS live command returns an account-risk failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-account-safety-signal-"));
    const runId = "run-account-risk-signal-001";
    const requestId = "issue209-account-risk-signal-001";
    const gateInvocationId = "issue209-gate-account-risk-signal-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_account_signal_profile" });
      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_account_signal_profile",
            run_id: runId,
            params: {
              request_id: requestId,
              gate_invocation_id: gateInvocationId,
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                simulate_result: "account_abnormal",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
                audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ACCOUNT_ABNORMAL",
          closeout_hard_stop_risk: expect.objectContaining({
            state: "hard_stop",
            risk_class: "account_abnormal",
            reason: "ACCOUNT_ABNORMAL",
            source: "account_safety",
            should_block_route_action: true
          }),
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "ACCOUNT_ABNORMAL",
            source_run_id: runId,
            source_command: "xhs.search",
            target_tab_id: 32,
            status_code: 461,
            live_commands_blocked: true
          }),
          runtime_stop: expect.objectContaining({
            attempted: true
          })
        }
      });

      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.readMeta("xhs_account_signal_profile");
      expect(meta?.accountSafety).toMatchObject({
        state: "account_risk_blocked",
        reason: "ACCOUNT_ABNORMAL",
        sourceRunId: runId,
        sourceCommand: "xhs.search",
        targetTabId: 32,
        statusCode: 461
      });
      expect(meta?.xhsCloseoutRhythm).toMatchObject({
        state: "cooldown",
        singleProbeRequired: true,
        fullBundleBlocked: true,
        reasonCodes: expect.arrayContaining(["ACCOUNT_ABNORMAL"])
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("persists account_safety blocked from classifier-only hard-stop evidence", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-classifier-account-safety-"));
    const runId = "run-classifier-account-risk-001";
    const requestId = "issue209-classifier-account-risk-001";
    const gateInvocationId = "issue209-gate-classifier-account-risk-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_classifier_account_signal_profile" });
      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_classifier_account_signal_profile",
            run_id: runId,
            params: {
              request_id: requestId,
              gate_invocation_id: gateInvocationId,
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                simulate_result: "classifier_only_account_abnormal",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
                audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        diagnosis: {
          failure_site: expect.objectContaining({
            summary: "ACCOUNT_ABNORMAL"
          }),
          evidence: expect.arrayContaining(["ACCOUNT_ABNORMAL", "account_abnormal"])
        },
        observability: {
          failure_site: expect.objectContaining({
            summary: "ACCOUNT_ABNORMAL"
          })
        },
        details: {
          closeout_hard_stop_risk: expect.objectContaining({
            state: "hard_stop",
            risk_class: "account_abnormal",
            reason: "ACCOUNT_ABNORMAL",
            should_block_route_action: true
          }),
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "ACCOUNT_ABNORMAL",
            source_run_id: runId,
            source_command: "xhs.search",
            target_tab_id: 32,
            live_commands_blocked: true
          })
        }
      });

      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.readMeta("xhs_classifier_account_signal_profile");
      expect(meta?.accountSafety).toMatchObject({
        state: "account_risk_blocked",
        reason: "ACCOUNT_ABNORMAL",
        sourceRunId: runId,
        sourceCommand: "xhs.search",
        targetTabId: 32
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("prefers classifier hard-stop evidence over generic diagnosis tokens when persisting account_safety", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-classifier-diagnosis-priority-"));
    const runId = "run-classifier-diagnosis-priority-001";
    const requestId = "issue209-classifier-diagnosis-priority-001";
    const gateInvocationId = "issue209-gate-classifier-diagnosis-priority-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_classifier_diagnosis_priority_profile" });
      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_classifier_diagnosis_priority_profile",
            run_id: runId,
            params: {
              request_id: requestId,
              gate_invocation_id: gateInvocationId,
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                simulate_result: "classifier_account_abnormal_with_generic_diagnosis",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
                audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        diagnosis: {
          failure_site: expect.objectContaining({
            summary: "ACCOUNT_ABNORMAL"
          }),
          evidence: expect.arrayContaining(["ACCOUNT_ABNORMAL", "account_abnormal"])
        },
        observability: {
          failure_site: expect.objectContaining({
            summary: "ACCOUNT_ABNORMAL"
          })
        },
        details: {
          closeout_hard_stop_risk: expect.objectContaining({
            state: "hard_stop",
            risk_class: "account_abnormal",
            reason: "ACCOUNT_ABNORMAL",
            should_block_route_action: true
          }),
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "ACCOUNT_ABNORMAL",
            source_run_id: runId,
            source_command: "xhs.search",
            target_tab_id: 32,
            live_commands_blocked: true
          })
        }
      });

      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.readMeta("xhs_classifier_diagnosis_priority_profile");
      expect(meta?.accountSafety).toMatchObject({
        state: "account_risk_blocked",
        reason: "ACCOUNT_ABNORMAL",
        sourceRunId: runId,
        sourceCommand: "xhs.search",
        targetTabId: 32
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("prefers current captcha hard-stop evidence over stale account_safety when persisting account_safety", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-stale-account-current-captcha-"));
    const runId = "run-stale-account-current-captcha-001";
    const requestId = "issue209-stale-account-current-captcha-001";
    const gateInvocationId = "issue209-gate-stale-account-current-captcha-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_stale_account_current_captcha_profile" });
      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_stale_account_current_captcha_profile",
            run_id: runId,
            params: {
              request_id: requestId,
              gate_invocation_id: gateInvocationId,
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                simulate_result: "stale_account_safety_with_current_captcha",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
                audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        diagnosis: {
          failure_site: expect.objectContaining({
            summary: "CAPTCHA_REQUIRED"
          }),
          evidence: expect.arrayContaining(["CAPTCHA_REQUIRED", "captcha_required"])
        },
        observability: {
          failure_site: expect.objectContaining({
            summary: "CAPTCHA_REQUIRED"
          })
        },
        details: {
          closeout_hard_stop_risk: expect.objectContaining({
            state: "hard_stop",
            risk_class: "captcha_required",
            reason: "CAPTCHA_REQUIRED",
            source: "account_safety",
            should_block_route_action: true
          }),
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "CAPTCHA_REQUIRED",
            source_run_id: runId,
            source_command: "xhs.search",
            target_tab_id: 32,
            status_code: 429,
            live_commands_blocked: true
          })
        }
      });

      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.readMeta("xhs_stale_account_current_captcha_profile");
      expect(meta?.accountSafety).toMatchObject({
        state: "account_risk_blocked",
        reason: "CAPTCHA_REQUIRED",
        sourceRunId: runId,
        sourceCommand: "xhs.search",
        targetTabId: 32,
        statusCode: 429
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("blocks the XHS closeout bundle until a recovery single-probe is requested", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-blocked-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_blocked_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_blocked_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.detail",
            profile: "xhs_rhythm_blocked_profile",
            run_id: "run-rhythm-blocked-001",
            params: {
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "note-rhythm-001"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "single_probe_required",
            full_bundle_blocked: true
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks XHS live reads at the validation baseline gate even when scope and caller action are wrong", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-baseline-action-omitted-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_baseline_action_omitted_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_baseline_action_omitted_profile", {
        ...meta,
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
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: false,
          singleProbePassedAt: "2026-04-25T10:40:00.000Z",
          probeRunId: "run-action-omitted-recovery-probe",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_baseline_action_omitted_profile",
            run_id: "run-baseline-action-omitted-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "write"
              },
              input: {
                query: "露营"
              },
              options: {
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED"
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("maps validation store failures before blocking XHS live reads", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-baseline-store-failure-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_baseline_store_failure_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_baseline_store_failure_profile", {
        ...meta,
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
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: false,
          singleProbePassedAt: "2026-04-25T10:40:00.000Z",
          probeRunId: "run-store-failure-recovery-probe",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
        }
      });
      await createSchemaMismatchRuntimeStore(cwd);

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_baseline_store_failure_profile",
            run_id: "run-baseline-store-failure-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_UNAVAILABLE",
        retryable: false
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not apply the baseline gate to steady-state XHS live reads before recovery starts", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-steady-live-read-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      await profileStore.initializeMeta(
        "xhs_steady_live_read_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_steady_live_read_profile",
            run_id: "run-steady-live-read-001",
            params: {
              request_id: "request-steady-live-read-001",
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "EXECUTION_MODE_GATE_BLOCKED",
          gate_reasons: expect.arrayContaining(["ACTION_TYPE_NOT_EXPLICIT"])
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("blocks non-closeout XHS live commands while recovery rhythm is active", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-live-write-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_live_write_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_live_write_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_live_write_profile",
            run_id: "run-rhythm-live-write-001",
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
                issue_scope: "issue_208",
                target_domain: "creator.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "creator_publish_tab",
                action_type: "write",
                requested_execution_mode: "live_write",
                validation_action: "editor_input",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "single_probe_required"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves persisted recovery-probe blocks when profile rhythm metadata is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-persisted-recovery-block-"));
    try {
      const profile = "xhs_persisted_recovery_block_profile";
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      await profileStore.initializeMeta(profile, "2026-04-25T10:00:00.000Z", {
        allowUnsupportedExtensionBrowser: true
      });
      const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await store.recordSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: `rhythm_win_${profile}_issue_209`,
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-recovery",
            current_phase: "recovery_probe",
            risk_state: "limited",
            window_started_at: "2026-04-25T10:35:00.000Z",
            window_deadline_at: "2026-04-25T10:40:00.000Z",
            cooldown_until: null,
            recovery_probe_due_at: "2026-04-25T10:40:00.000Z",
            stability_window_until: null,
            risk_signal_count: 0,
            last_event_id: "rhythm_evt_persisted_recovery_block",
            source_run_id: "run-persisted-recovery-block",
            updated_at: "2026-04-25T10:35:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_persisted_recovery_block",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-recovery",
            window_id: `rhythm_win_${profile}_issue_209`,
            event_type: "recovery_probe_started",
            phase_before: "cooldown",
            phase_after: "recovery_probe",
            risk_state_before: "paused",
            risk_state_after: "limited",
            source_audit_event_id: null,
            reason: "PERSISTED_RECOVERY_PROBE_BLOCKED",
            recorded_at: "2026-04-25T10:35:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_persisted_recovery_block",
            window_id: `rhythm_win_${profile}_issue_209`,
            run_id: "run-persisted-recovery-block",
            session_id: "nm-session-persisted-recovery",
            profile,
            current_phase: "recovery_probe",
            current_risk_state: "limited",
            next_phase: "recovery_probe",
            next_risk_state: "limited",
            effective_execution_mode: "recon",
            decision: "blocked",
            reason_codes: ["PERSISTED_RECOVERY_PROBE_BLOCKED"],
            requires: ["operator_confirmation_required"],
            decided_at: "2026-04-25T10:35:00.000Z"
          }
        });
      } finally {
        store.close();
      }

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile,
            run_id: "run-persisted-recovery-block-current",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "single_probe_required",
            single_probe_required: true,
            reason_codes: expect.arrayContaining(["PERSISTED_RECOVERY_PROBE_BLOCKED"])
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks non-closeout XHS live commands after recovery probe until validation baseline is ready", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-live-write-baseline-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_live_write_baseline_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_live_write_baseline_profile", {
        ...meta,
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
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: false,
          singleProbePassedAt: "2026-04-25T10:40:00.000Z",
          probeRunId: "run-live-write-baseline-recovery-probe",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_live_write_baseline_profile",
            run_id: "run-rhythm-live-write-baseline-001",
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
                issue_scope: "issue_208",
                target_domain: "creator.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "creator_publish_tab",
                action_type: "write",
                requested_execution_mode: "live_write",
                validation_action: "editor_input",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED",
          anti_detection_validation_view: expect.objectContaining({
            effective_execution_mode: "live_write",
            all_required_ready: false
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows a marked xhs.search recovery single-probe and records the passed probe", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-probe-"));
    const runId = "run-rhythm-probe-001";
    const requestId = "issue209-rhythm-probe-001";
    const gateInvocationId = "issue209-gate-rhythm-probe-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_probe_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_probe_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });
      const rhythmStore = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await rhythmStore.recordSessionRhythmStatusView({
          profile: "xhs_rhythm_probe_profile",
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: "rhythm_win_xhs_rhythm_probe_profile_issue_209",
            profile: "xhs_rhythm_probe_profile",
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-previous",
            current_phase: "cooldown",
            risk_state: "paused",
            window_started_at: "2026-04-25T10:00:00.000Z",
            window_deadline_at: null,
            cooldown_until: null,
            recovery_probe_due_at: null,
            stability_window_until: null,
            risk_signal_count: 1,
            last_event_id: "rhythm_evt_previous_paused_no_cooldown",
            source_run_id: "run-previous-paused-no-cooldown",
            updated_at: "2026-04-25T10:00:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_previous_paused_no_cooldown",
            profile: "xhs_rhythm_probe_profile",
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-previous",
            window_id: "rhythm_win_xhs_rhythm_probe_profile_issue_209",
            event_type: "risk_signal",
            phase_before: "steady",
            phase_after: "cooldown",
            risk_state_before: "limited",
            risk_state_after: "paused",
            source_audit_event_id: null,
            reason: "PERSISTED_SESSION_RHYTHM_PAUSED",
            recorded_at: "2026-04-25T10:00:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_previous_paused_no_cooldown",
            window_id: "rhythm_win_xhs_rhythm_probe_profile_issue_209",
            run_id: "run-previous-paused-no-cooldown",
            session_id: "nm-session-previous",
            profile: "xhs_rhythm_probe_profile",
            current_phase: "cooldown",
            current_risk_state: "paused",
            next_phase: "cooldown",
            next_risk_state: "paused",
            effective_execution_mode: "recon",
            decision: "blocked",
            reason_codes: ["PERSISTED_SESSION_RHYTHM_PAUSED"],
            requires: ["operator_confirmation_required"],
            decided_at: "2026-04-25T10:00:00.000Z"
          }
        });
      } finally {
        rhythmStore.close();
      }

      const result = await executeCommand(
        {
          cwd,
          command: "xhs.search",
          profile: "xhs_rhythm_probe_profile",
          run_id: runId,
          params: {
            request_id: requestId,
            gate_invocation_id: gateInvocationId,
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              xhs_recovery_probe: true,
              simulate_result: "success",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "recon",
              risk_state: "allowed",
              approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
              audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(result.summary).toMatchObject({
        capability_result: {
          ability_id: "xhs.note.search.v1",
          outcome: "partial"
        }
      });
      const persisted = await profileStore.readMeta("xhs_rhythm_probe_profile");
      expect(persisted?.xhsCloseoutRhythm).toMatchObject({
        state: "single_probe_passed",
        singleProbeRequired: false,
        probeRunId: runId,
        fullBundleBlocked: true,
        reasonCodes: expect.arrayContaining(["ANTI_DETECTION_BASELINE_REQUIRED"])
      });
      const verificationStore = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await expect(
          verificationStore.getSessionRhythmStatusView({
            profile: "xhs_rhythm_probe_profile",
            platform: "xhs",
            issueScope: "issue_209",
            runId
          })
        ).resolves.toMatchObject({
          event: {
            event_id: `rhythm_evt_${runId}`,
            event_type: "recovery_probe_passed"
          },
          decision: {
            decision_id: `rhythm_decision_${runId}`,
            decision: "deferred",
            reason_codes: expect.arrayContaining(["ANTI_DETECTION_BASELINE_REQUIRED"])
          }
        });
      } finally {
        verificationStore.close();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("blocks XHS closeout live reads when FR-0020 validation baseline is missing", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-validation-missing-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_validation_missing_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_validation_missing_profile", {
        ...meta,
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
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: false,
          singleProbePassedAt: "2026-04-25T10:40:00.000Z",
          probeRunId: "run-validation-missing-probe-001",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.detail",
            profile: "xhs_validation_missing_profile",
            run_id: "run-validation-missing-001",
            params: {
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "note-validation-missing-001"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 33,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED",
          anti_detection_validation_view: expect.objectContaining({
            all_required_ready: false
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves persisted recovery-probe passed rhythm state before live reads", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-persisted-probe-passed-"));
    const profile = "xhs_persisted_probe_passed_profile";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(profile, "2026-04-25T10:00:00.000Z", {
        allowUnsupportedExtensionBrowser: true
      });
      await profileStore.writeMeta(profile, {
        ...meta,
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
        }
      });
      const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await store.recordSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: `rhythm_win_${profile}_issue_209`,
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-probe",
            current_phase: "steady",
            risk_state: "limited",
            window_started_at: "2026-04-25T10:35:00.000Z",
            window_deadline_at: "2026-04-25T11:00:00.000Z",
            cooldown_until: null,
            recovery_probe_due_at: null,
            stability_window_until: "2026-04-25T11:00:00.000Z",
            risk_signal_count: 0,
            last_event_id: "rhythm_evt_persisted_probe_passed",
            source_run_id: "run-persisted-probe-passed",
            updated_at: "2026-04-25T10:40:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_persisted_probe_passed",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-probe",
            window_id: `rhythm_win_${profile}_issue_209`,
            event_type: "recovery_probe_passed",
            phase_before: "recovery_probe",
            phase_after: "steady",
            risk_state_before: "limited",
            risk_state_after: "limited",
            source_audit_event_id: null,
            reason: "XHS_RECOVERY_SINGLE_PROBE_PASSED",
            recorded_at: "2026-04-25T10:40:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_persisted_probe_passed",
            window_id: `rhythm_win_${profile}_issue_209`,
            run_id: "run-persisted-probe-passed",
            session_id: "nm-session-persisted-probe",
            profile,
            current_phase: "steady",
            current_risk_state: "limited",
            next_phase: "steady",
            next_risk_state: "limited",
            effective_execution_mode: "live_read_high_risk",
            decision: "deferred",
            reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"],
            requires: ["anti_detection_validation_view_ready"],
            decided_at: "2026-04-25T10:40:00.000Z"
          }
        });
      } finally {
        store.close();
      }

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.detail",
            profile,
            run_id: "run-persisted-probe-live-read-001",
            params: {
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "note-persisted-probe-001"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 33,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "single_probe_passed",
            probe_run_id: "run-persisted-probe-passed"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks live reads while persisted rhythm is still in recovery probe", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-persisted-recovery-probe-"));
    const profile = "xhs_persisted_recovery_probe_profile";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(profile, "2026-04-25T10:00:00.000Z", {
        allowUnsupportedExtensionBrowser: true
      });
      await profileStore.writeMeta(profile, {
        ...meta,
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
        }
      });
      const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await store.recordSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: `rhythm_win_${profile}_issue_209`,
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-recovery",
            current_phase: "recovery_probe",
            risk_state: "limited",
            window_started_at: "2026-04-25T10:35:00.000Z",
            window_deadline_at: "2026-04-25T10:55:00.000Z",
            cooldown_until: null,
            recovery_probe_due_at: "2026-04-25T10:35:00.000Z",
            stability_window_until: null,
            risk_signal_count: 0,
            last_event_id: "rhythm_evt_persisted_recovery_probe",
            source_run_id: "run-persisted-recovery-probe",
            updated_at: "2026-04-25T10:36:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_persisted_recovery_probe",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-persisted-recovery",
            window_id: `rhythm_win_${profile}_issue_209`,
            event_type: "recovery_probe_started",
            phase_before: "warmup",
            phase_after: "recovery_probe",
            risk_state_before: "limited",
            risk_state_after: "limited",
            source_audit_event_id: null,
            reason: "XHS_RECOVERY_SINGLE_PROBE_REQUIRED",
            recorded_at: "2026-04-25T10:36:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_persisted_recovery_probe",
            window_id: `rhythm_win_${profile}_issue_209`,
            run_id: "run-persisted-recovery-probe",
            session_id: "nm-session-persisted-recovery",
            profile,
            current_phase: "recovery_probe",
            current_risk_state: "limited",
            next_phase: "recovery_probe",
            next_risk_state: "limited",
            effective_execution_mode: "recon",
            decision: "blocked",
            reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"],
            requires: ["xhs.search_recon_probe"],
            decided_at: "2026-04-25T10:36:00.000Z"
          }
        });
      } finally {
        store.close();
      }

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.detail",
            profile,
            run_id: "run-persisted-recovery-live-read-001",
            params: {
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "note-persisted-recovery-001"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 33,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "single_probe_required",
            single_probe_required: true,
            probe_run_id: "run-persisted-recovery-probe"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows XHS closeout live reads through preflight after probe and FR-0020 baselines pass", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-validation-ready-"));
    const runId = "run-validation-ready-user-home-001";
    const requestId = "issue209-validation-ready-user-home-001";
    const gateInvocationId = "issue209-gate-validation-ready-user-home-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_validation_ready_profile" });

      const result = await executeCommand(
        {
          cwd,
          command: "xhs.user_home",
          profile: "xhs_validation_ready_profile",
          run_id: runId,
          params: {
            request_id: requestId,
            gate_invocation_id: gateInvocationId,
            ability: {
              id: "xhs.user.home.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              user_id: "user-validation-ready-001"
            },
            options: {
              simulate_result: "success",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 34,
              target_page: "profile_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed",
              approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
              audit_record: {
                ...createIssue209FormalAuditRecord(requestId, decisionId, approvalId),
                target_tab_id: 34,
                target_page: "profile_tab"
              }
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(result.summary).toMatchObject({
        request_admission_result: {
          request_ref: requestId,
          admission_decision: "allowed"
        }
      });
      const verificationStore = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await expect(
          verificationStore.getSessionRhythmStatusView({
            profile: "xhs_validation_ready_profile",
            platform: "xhs",
            issueScope: "issue_209",
            runId
          })
        ).resolves.toMatchObject({
          decision: {
            decision_id: `rhythm_decision_preflight_${runId}`,
            run_id: runId,
            decision: "deferred",
            reason_codes: ["XHS_LIVE_ADMISSION_PENDING_EXECUTION_AUDIT"],
            requires: ["execution_audit_appended"]
          }
        });
      } finally {
        verificationStore.close();
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("allows XHS live_read_limited reads with the closeout readiness baseline", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-limited-validation-ready-"));
    const runId = "run-validation-ready-limited-search-001";
    const requestId = "issue209-validation-ready-limited-search-001";
    const gateInvocationId = "issue209-gate-validation-ready-limited-search-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_validation_ready_limited_profile" });

      const result = await executeCommand(
        {
          cwd,
          command: "xhs.search",
          profile: "xhs_validation_ready_limited_profile",
          run_id: runId,
          params: {
            request_id: requestId,
            gate_invocation_id: gateInvocationId,
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              simulate_result: "success",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_limited",
              risk_state: "limited",
              limited_read_rollout_ready_true: true,
              approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
              audit_record: {
                ...createIssue209FormalAuditRecord(requestId, decisionId, approvalId),
                requested_execution_mode: "live_read_limited",
                risk_state: "limited"
              }
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(result.summary).toMatchObject({
        gate_outcome: {
          effective_execution_mode: "live_read_limited",
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        request_admission_result: {
          request_ref: requestId,
          admission_decision: "allowed"
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("preserves persisted cooldown before XHS closeout live execution", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-persisted-cooldown-"));
    const profile = "xhs_persisted_cooldown_profile";
    try {
      await seedXhsCloseoutReady({ cwd, profile });
      const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await store.recordSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: `rhythm_win_${profile}_issue_209`,
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-cooldown",
            current_phase: "cooldown",
            risk_state: "paused",
            window_started_at: "2026-04-25T10:35:00.000Z",
            window_deadline_at: "2099-04-25T11:05:00.000Z",
            cooldown_until: "2099-04-25T11:05:00.000Z",
            recovery_probe_due_at: "2099-04-25T11:05:00.000Z",
            stability_window_until: null,
            risk_signal_count: 1,
            last_event_id: "rhythm_evt_persisted_cooldown",
            source_run_id: "run-persisted-cooldown-source",
            updated_at: "2026-04-25T10:35:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_persisted_cooldown",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-cooldown",
            window_id: `rhythm_win_${profile}_issue_209`,
            event_type: "risk_signal",
            phase_before: "steady",
            phase_after: "cooldown",
            risk_state_before: "limited",
            risk_state_after: "paused",
            source_audit_event_id: "gate_evt_persisted_cooldown",
            reason: "ACCOUNT_RISK_RECOVERY_REQUIRED",
            recorded_at: "2026-04-25T10:35:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_persisted_cooldown",
            window_id: `rhythm_win_${profile}_issue_209`,
            run_id: "run-persisted-cooldown-source",
            session_id: "nm-session-cooldown",
            profile,
            current_phase: "cooldown",
            current_risk_state: "paused",
            next_phase: "cooldown",
            next_risk_state: "paused",
            effective_execution_mode: "live_read_high_risk",
            decision: "blocked",
            reason_codes: ["ACCOUNT_RISK_RECOVERY_REQUIRED"],
            requires: ["cooldown_until_elapsed"],
            decided_at: "2026-04-25T10:35:00.000Z"
          }
        });
      } finally {
        store.close();
      }

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.detail",
            profile,
            run_id: "run-persisted-cooldown-current",
            params: {
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "note-persisted-cooldown"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 33,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "cooldown",
            full_bundle_blocked: true
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("allows xhs.search dry_run without official Chrome runtime readiness", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-dry-run-no-runtime-readiness-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    delete process.env.WEBENVOY_NATIVE_TRANSPORT;
    delete process.env.WEBENVOY_BROWSER_PATH;
    delete process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_dry_run_no_runtime_readiness_profile",
        "2026-04-28T01:45:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_dry_run_no_runtime_readiness_profile", {
        ...meta,
        profileState: "logging_in"
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_dry_run_no_runtime_readiness_profile",
            run_id: "run-xhs-dry-run-no-runtime-readiness-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营",
                limit: 3
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "dry_run",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).resolves.toMatchObject({
        summary: {
          session_id: "gate-only-run-xhs-dry-run-no-runtime-readiness-001",
          requested_execution_mode: "dry_run",
          consumer_gate_result: expect.objectContaining({
            effective_execution_mode: "dry_run"
          }),
          audit_record: expect.objectContaining({
            recorded_at: expect.not.stringMatching(/^2026-03-23T10:00:00/)
          }),
          risk_state_output: expect.objectContaining({
            session_rhythm: expect.objectContaining({
              last_event_at: expect.not.stringMatching(/^2026-03-23T10:00:00/)
            })
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("preserves anonymous admission signals in xhs.search dry_run gate-only mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-dry-run-anon-gate-only-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    delete process.env.WEBENVOY_NATIVE_TRANSPORT;
    delete process.env.WEBENVOY_BROWSER_PATH;
    delete process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_dry_run_anon_gate_only_profile",
        "2026-04-28T02:45:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_dry_run_anon_gate_only_profile", {
        ...meta,
        profileState: "logging_in"
      });

      const execution = await executeCommand(
        {
          cwd,
          command: "xhs.search",
          profile: "xhs_dry_run_anon_gate_only_profile",
          run_id: "run-xhs-dry-run-anon-gate-only-001",
          params: {
            request_id: "req-xhs-dry-run-anon-gate-only-001",
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营",
              limit: 3
            },
            options: {
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "dry_run",
              risk_state: "allowed",
              upstream_authorization_request: {
                action_request: {
                  request_ref: "upstream_req_dry_run_anon_gate_only_001",
                  action_name: "xhs.read_search_results",
                  action_category: "read"
                },
                resource_binding: {
                  binding_ref: "binding_dry_run_anon_gate_only_001",
                  resource_kind: "anonymous_context",
                  profile_ref: null,
                  binding_constraints: {
                    anonymous_required: true,
                    reuse_logged_in_context_forbidden: true
                  }
                },
                authorization_grant: {
                  grant_ref: "grant_dry_run_anon_gate_only_001",
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
                  target_ref: "target_dry_run_anon_gate_only_001",
                  domain: "www.xiaohongshu.com",
                  page: "search_result_tab",
                  tab_id: 32,
                  url: "https://www.xiaohongshu.com/search_result?keyword=%E9%9C%B2%E8%90%A5"
                }
              },
              __anonymous_isolation_verified: true,
              target_site_logged_in: false
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        requested_execution_mode: "dry_run",
        __anonymous_isolation_verified: true,
        target_site_logged_in: false,
        request_admission_result: {
          admission_decision: "allowed",
          anonymous_isolation_ok: true,
          effective_runtime_mode: "dry_run"
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("does not consume the recovery probe budget when runtime readiness fails first", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-probe-readiness-"));
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    delete process.env.WEBENVOY_NATIVE_TRANSPORT;
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_probe_readiness_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_probe_readiness_profile", {
        ...meta,
        profileState: "logging_in",
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_probe_readiness_profile",
            run_id: "run-rhythm-probe-readiness-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_RUNTIME_UNAVAILABLE"
      });

      const persisted = await profileStore.readMeta("xhs_rhythm_probe_readiness_profile");
      expect(persisted?.xhsCloseoutRhythm).toMatchObject({
        state: "single_probe_required",
        probeRunId: null,
        singleProbePassedAt: null
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("persists account-safety risk signals from a recovery probe failure", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-probe-risk-"));
    const runId = "run-rhythm-probe-risk-001";
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_probe_risk_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_probe_risk_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_probe_risk_profile",
            run_id: runId,
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                simulate_result: "account_abnormal",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ACCOUNT_ABNORMAL",
          account_safety: expect.objectContaining({
            state: "account_risk_blocked",
            reason: "ACCOUNT_ABNORMAL",
            source_run_id: runId,
            live_commands_blocked: true
          }),
          xhs_closeout_rhythm: expect.objectContaining({
            state: "cooldown",
            full_bundle_blocked: true
          })
        }
      });

      const persisted = await profileStore.readMeta("xhs_rhythm_probe_risk_profile");
      expect(persisted?.accountSafety).toMatchObject({
        state: "account_risk_blocked",
        reason: "ACCOUNT_ABNORMAL",
        sourceRunId: runId
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("keeps the recovery single-probe blocked until the cooldown expires", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-cooldown-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_cooldown_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_cooldown_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2099-04-25T10:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_OPERATOR_CONFIRMED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_cooldown_profile",
            run_id: "run-rhythm-cooldown-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "cooldown",
            cooldown_until: "2099-04-25T10:30:00.000Z",
            reason_codes: expect.arrayContaining(["XHS_CLOSEOUT_COOLDOWN_ACTIVE"])
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps account-safety blocked for recovery probes until the operator clears it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-account-block-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_account_block_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_account_block_profile", {
        ...meta,
        accountSafety: {
          state: "account_risk_blocked",
          platform: "xhs",
          reason: "ACCOUNT_ABNORMAL",
          observedAt: "2026-04-25T10:00:00.000Z",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          sourceRunId: "run-risk-account-block-001",
          sourceCommand: "xhs.search",
          targetDomain: "www.xiaohongshu.com",
          targetTabId: 32,
          pageUrl: "https://www.xiaohongshu.com/search_result?keyword=test",
          statusCode: 461,
          platformCode: 300011
        },
        xhsCloseoutRhythm: {
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: null,
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_REQUIRED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_account_block_profile",
            run_id: "run-rhythm-account-block-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "ACCOUNT_RISK_BLOCKED",
          account_safety: expect.objectContaining({
            state: "account_risk_blocked"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects xhs_recovery_probe when no active recovery state requires it", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-probe-invalid-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      await profileStore.initializeMeta(
        "xhs_rhythm_probe_invalid_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_probe_invalid_profile",
            run_id: "run-rhythm-probe-invalid-001",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_UNAVAILABLE",
          xhs_closeout_rhythm: expect.objectContaining({
            state: "not_required"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("rejects a second recovery probe after the budget is already claimed", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-rhythm-probe-claimed-"));
    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(
        "xhs_rhythm_probe_claimed_profile",
        "2026-04-25T10:00:00.000Z",
        { allowUnsupportedExtensionBrowser: true }
      );
      await profileStore.writeMeta("xhs_rhythm_probe_claimed_profile", {
        ...meta,
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
          state: "single_probe_required",
          cooldownUntil: "2000-01-01T00:30:00.000Z",
          operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
          singleProbeRequired: true,
          singleProbePassedAt: null,
          probeRunId: "run-already-claimed-probe-001",
          fullBundleBlocked: true,
          reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_CLAIMED"]
        }
      });

      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_rhythm_probe_claimed_profile",
            run_id: "run-rhythm-probe-claimed-002",
            params: {
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                xhs_recovery_probe: true,
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "recon",
                risk_state: "allowed"
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "XHS_CLOSEOUT_RHYTHM_BLOCKED",
          xhs_closeout_rhythm: expect.objectContaining({
            probe_run_id: "run-already-claimed-probe-001"
          })
        }
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not persist account_safety when an XHS live command returns a generic API warning", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-account-safety-generic-"));
    const runId = "run-account-risk-generic-001";
    const requestId = "issue209-account-risk-generic-001";
    const gateInvocationId = "issue209-gate-account-risk-generic-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";
    try {
      await seedXhsCloseoutReady({ cwd, profile: "xhs_account_generic_profile" });
      await expect(
        executeCommand(
          {
            cwd,
            command: "xhs.search",
            profile: "xhs_account_generic_profile",
            run_id: runId,
            params: {
              request_id: requestId,
              gate_invocation_id: gateInvocationId,
              ability: {
                id: "xhs.note.search.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                query: "露营"
              },
              options: {
                simulate_result: "generic_api_warning",
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "search_result_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
                audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: {
          reason: "TARGET_API_RESPONSE_INVALID"
        }
      });

      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.readMeta("xhs_account_generic_profile");
      expect(meta?.accountSafety).toMatchObject({
        state: "clear"
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      if (previousTransport === undefined) {
        delete process.env.WEBENVOY_NATIVE_TRANSPORT;
      } else {
        process.env.WEBENVOY_NATIVE_TRANSPORT = previousTransport;
      }
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

  it("preserves anonymous admission signals on the loopback runtime path and exposes request_admission_result plus execution_audit", async () => {
    const runId = "run-anon-loopback-001";
    const requestId = "req-anon-loopback-001";
    const approvalAdmissionRef = `approval_admission_${runId}_${requestId}`;
    const auditAdmissionRef = `audit_admission_${runId}_${requestId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      await seedXhsCloseoutReady({
        cwd: "/tmp/webenvoy",
        profile: "profile-anon-loopback-001"
      });
      const execution = await executeCommand(
        {
          cwd: "/tmp/webenvoy",
          command: "xhs.detail",
          profile: "profile-anon-loopback-001",
          run_id: runId,
          params: {
            request_id: requestId,
            ability: {
              id: "xhs.note.detail.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              note_id: "abc123"
            },
            options: {
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "explore_detail_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed",
              upstream_authorization_request: {
                action_request: {
                  request_ref: "upstream_req_loopback_anon_001",
                  action_name: "xhs.read_note_detail",
                  action_category: "read"
                },
                resource_binding: {
                  binding_ref: "binding_loopback_anon_001",
                  resource_kind: "anonymous_context",
                  profile_ref: null,
                  binding_constraints: {
                    anonymous_required: true,
                    reuse_logged_in_context_forbidden: true
                  }
                },
                authorization_grant: {
                  grant_ref: "grant_loopback_anon_001",
                  allowed_actions: ["xhs.read_note_detail"],
                  binding_scope: {
                    allowed_resource_kinds: ["anonymous_context"],
                    allowed_profile_refs: []
                  },
                  target_scope: {
                    allowed_domains: ["www.xiaohongshu.com"],
                    allowed_pages: ["explore_detail_tab"]
                  },
                  resource_state_snapshot: "active",
                  approval_refs: [approvalAdmissionRef],
                  audit_refs: [auditAdmissionRef]
                },
                runtime_target: {
                  target_ref: "target_loopback_anon_001",
                  domain: "www.xiaohongshu.com",
                  page: "explore_detail_tab",
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
              admission_context: createApprovedAnonymousReadAdmissionContext(runId, requestId),
              __anonymous_isolation_verified: true,
              target_site_logged_in: false
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        request_admission_result: {
          admission_decision: "allowed",
          anonymous_isolation_ok: true
        },
        execution_audit: {
          request_ref: "upstream_req_loopback_anon_001",
          request_admission_decision: "allowed",
          consumed_inputs: {
            action_request_ref: "upstream_req_loopback_anon_001",
            resource_binding_ref: "binding_loopback_anon_001",
            authorization_grant_ref: "grant_loopback_anon_001",
            runtime_target_ref: "target_loopback_anon_001"
          },
          compatibility_refs: {
            approval_admission_ref: approvalAdmissionRef,
            audit_admission_ref: auditAdmissionRef
          }
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

  it("reads session rhythm compatibility refs from the persisted rhythm store before profile meta fallback", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "webenvoy-xhs-persisted-rhythm-"));
    const profile = "profile-persisted-rhythm-refs-001";
    const runId = "run-persisted-rhythm-refs-001";
    const requestId = "req-persisted-rhythm-refs-001";
    const approvalAdmissionRef = `approval_admission_${runId}_${requestId}`;
    const auditAdmissionRef = `audit_admission_${runId}_${requestId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      const profileStore = new ProfileStore(join(cwd, ".webenvoy", "profiles"));
      const meta = await profileStore.initializeMeta(profile, "2026-04-25T10:00:00.000Z", {
        allowUnsupportedExtensionBrowser: true
      });
      await profileStore.writeMeta(profile, {
        ...meta,
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
        xhsCloseoutRhythm: undefined
      });
      const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        await store.recordSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: "rhythm_win_persisted_issue_209",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-001",
            current_phase: "steady",
            risk_state: "limited",
            window_started_at: "2026-04-25T10:40:00.000Z",
            window_deadline_at: "2026-04-25T11:00:00.000Z",
            cooldown_until: null,
            recovery_probe_due_at: null,
            stability_window_until: "2026-04-25T11:00:00.000Z",
            risk_signal_count: 0,
            last_event_id: "rhythm_evt_persisted_refs",
            source_run_id: "run-recovery-probe-persisted",
            updated_at: "2026-04-25T10:41:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_persisted_refs",
            profile,
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-001",
            window_id: "rhythm_win_persisted_issue_209",
            event_type: "recovery_probe_passed",
            phase_before: "recovery_probe",
            phase_after: "steady",
            risk_state_before: "limited",
            risk_state_after: "limited",
            source_audit_event_id: "gate_evt_persisted_refs",
            reason: "XHS_RECOVERY_SINGLE_PROBE_PASSED",
            recorded_at: "2026-04-25T10:41:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_persisted_refs",
            window_id: "rhythm_win_persisted_issue_209",
            run_id: "run-recovery-probe-persisted",
            session_id: "nm-session-001",
            profile,
            current_phase: "steady",
            current_risk_state: "limited",
            next_phase: "steady",
            next_risk_state: "limited",
            effective_execution_mode: "live_read_high_risk",
            decision: "allowed",
            reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"],
            requires: [],
            decided_at: "2026-04-25T10:41:00.000Z"
          }
        });
      } finally {
        store.close();
      }

      const execution = await executeCommand(
        {
          cwd,
          command: "xhs.detail",
          profile,
          run_id: runId,
          params: {
            request_id: requestId,
            ability: {
              id: "xhs.note.detail.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              note_id: "abc123"
            },
            options: {
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "explore_detail_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed",
              upstream_authorization_request: {
                action_request: {
                  request_ref: "upstream_req_persisted_refs_001",
                  action_name: "xhs.read_note_detail",
                  action_category: "read"
                },
                resource_binding: {
                  binding_ref: "binding_persisted_refs_001",
                  resource_kind: "anonymous_context",
                  profile_ref: null,
                  binding_constraints: {
                    anonymous_required: true,
                    reuse_logged_in_context_forbidden: true
                  }
                },
                authorization_grant: {
                  grant_ref: "grant_persisted_refs_001",
                  allowed_actions: ["xhs.read_note_detail"],
                  binding_scope: {
                    allowed_resource_kinds: ["anonymous_context"],
                    allowed_profile_refs: []
                  },
                  target_scope: {
                    allowed_domains: ["www.xiaohongshu.com"],
                    allowed_pages: ["explore_detail_tab"]
                  },
                  resource_state_snapshot: "active",
                  approval_refs: [approvalAdmissionRef],
                  audit_refs: [auditAdmissionRef]
                },
                runtime_target: {
                  target_ref: "target_persisted_refs_001",
                  domain: "www.xiaohongshu.com",
                  page: "explore_detail_tab",
                  tab_id: 32
                }
              },
              approval_record: {
                approved: true,
                approver: "qa-reviewer",
                approved_at: "2026-03-23T10:00:00Z",
                checks: ISSUE209_APPROVAL_CHECKS
              },
              admission_context: createApprovedAnonymousReadAdmissionContext(runId, requestId),
              __anonymous_isolation_verified: true,
              target_site_logged_in: false
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        execution_audit: {
          compatibility_refs: {
            approval_admission_ref: approvalAdmissionRef,
            audit_admission_ref: auditAdmissionRef,
            session_rhythm_window_id: "rhythm_win_persisted_issue_209",
            session_rhythm_decision_id: `rhythm_decision_preflight_${runId}`
          }
        }
      });
      const verificationStore = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
      try {
        const persistedRhythm = await verificationStore.getSessionRhythmStatusView({
          profile,
          platform: "xhs",
          issueScope: "issue_209",
          runId
        });
        expect(persistedRhythm?.decision).toMatchObject({
          decision_id: `rhythm_decision_preflight_${runId}`,
          run_id: runId,
          session_id: expect.any(String),
          effective_execution_mode: "live_read_high_risk",
          decision: "deferred",
          reason_codes: ["XHS_LIVE_ADMISSION_PENDING_EXECUTION_AUDIT"],
          requires: ["execution_audit_appended"]
        });
      } finally {
        verificationStore.close();
      }
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
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("preserves explicit top-level gate_invocation_id through formal-source live reads", async () => {
    const runId = "run-formal-source-loopback-001";
    const requestId = "issue209-live-formal-source-loopback-001";
    const gateInvocationId = "issue209-gate-run-formal-source-loopback-001-001";
    const decisionId = `gate_decision_${gateInvocationId}`;
    const approvalId = `gate_appr_${decisionId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      await seedXhsCloseoutReady({
        cwd: "/tmp/webenvoy",
        profile: "profile-formal-source-loopback-001"
      });
      const execution = await executeCommand(
        {
          cwd: "/tmp/webenvoy",
          command: "xhs.search",
          profile: "profile-formal-source-loopback-001",
          run_id: runId,
          params: {
            request_id: requestId,
            gate_invocation_id: gateInvocationId,
            ability: {
              id: "xhs.note.search.v1",
              layer: "L3",
              action: "read"
            },
            input: {
              query: "露营"
            },
            options: {
              simulate_result: "success",
              issue_scope: "issue_209",
              target_domain: "www.xiaohongshu.com",
              target_tab_id: 32,
              target_page: "search_result_tab",
              action_type: "read",
              requested_execution_mode: "live_read_high_risk",
              risk_state: "allowed",
              approval_record: createIssue209FormalApprovalRecord(decisionId, approvalId),
              audit_record: createIssue209FormalAuditRecord(requestId, decisionId, approvalId)
            }
          }
        } as RuntimeContext,
        createCommandRegistry()
      );

      expect(execution.summary).toMatchObject({
        gate_input: {
          admission_context: {
            approval_admission_evidence: {
              decision_id: decisionId,
              approval_id: approvalId,
              run_id: runId
            },
            audit_admission_evidence: {
              decision_id: decisionId,
              approval_id: approvalId,
              run_id: runId
            }
          }
        },
        gate_outcome: {
          decision_id: decisionId,
          gate_decision: "allowed",
          gate_reasons: ["LIVE_MODE_APPROVED"]
        },
        approval_record: {
          decision_id: decisionId,
          approval_id: approvalId,
          approved: true
        },
        audit_record: {
          decision_id: decisionId,
          approval_id: approvalId,
          gate_decision: "allowed"
        },
        request_admission_result: {
          request_ref: requestId,
          admission_decision: "allowed"
        },
        execution_audit: null
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

  it("preserves explicit false anonymous admission signals on the loopback runtime path for blocked runs", async () => {
    const runId = "run-anon-loopback-blocked-001";
    const requestId = "req-anon-loopback-blocked-001";
    const approvalAdmissionRef = `approval_admission_${runId}_${requestId}`;
    const auditAdmissionRef = `audit_admission_${runId}_${requestId}`;
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      await seedXhsCloseoutReady({
        cwd: "/tmp/webenvoy",
        profile: "profile-anon-loopback-blocked-001"
      });
      await expect(
        executeCommand(
          {
            cwd: "/tmp/webenvoy",
            command: "xhs.detail",
            profile: "profile-anon-loopback-blocked-001",
            run_id: runId,
            params: {
              request_id: requestId,
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "abc123"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                upstream_authorization_request: {
                  action_request: {
                    request_ref: "upstream_req_loopback_anon_blocked_001",
                    action_name: "xhs.read_note_detail",
                    action_category: "read"
                  },
                  resource_binding: {
                    binding_ref: "binding_loopback_anon_blocked_001",
                    resource_kind: "anonymous_context",
                    profile_ref: null,
                    binding_constraints: {
                      anonymous_required: true,
                      reuse_logged_in_context_forbidden: true
                    }
                  },
                  authorization_grant: {
                    grant_ref: "grant_loopback_anon_blocked_001",
                    allowed_actions: ["xhs.read_note_detail"],
                    binding_scope: {
                      allowed_resource_kinds: ["anonymous_context"],
                      allowed_profile_refs: []
                    },
                    target_scope: {
                      allowed_domains: ["www.xiaohongshu.com"],
                      allowed_pages: ["explore_detail_tab"]
                    },
                    resource_state_snapshot: "active",
                    approval_refs: [approvalAdmissionRef],
                    audit_refs: [auditAdmissionRef]
                  },
                  runtime_target: {
                    target_ref: "target_loopback_anon_blocked_001",
                    domain: "www.xiaohongshu.com",
                    page: "explore_detail_tab",
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
                admission_context: createApprovedAnonymousReadAdmissionContext(runId, requestId),
                __anonymous_isolation_verified: false,
                target_site_logged_in: false
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: expect.objectContaining({
          request_admission_result: expect.objectContaining({
            request_ref: "upstream_req_loopback_anon_blocked_001",
            admission_decision: "blocked",
            anonymous_isolation_ok: false
          }),
          execution_audit: expect.objectContaining({
            request_ref: "upstream_req_loopback_anon_blocked_001",
            request_admission_decision: "blocked",
            consumed_inputs: expect.objectContaining({
              action_request_ref: "upstream_req_loopback_anon_blocked_001",
              resource_binding_ref: "binding_loopback_anon_blocked_001",
              authorization_grant_ref: "grant_loopback_anon_blocked_001",
              runtime_target_ref: "target_loopback_anon_blocked_001"
            }),
            compatibility_refs: expect.objectContaining({
              approval_admission_ref: approvalAdmissionRef,
              audit_admission_ref: auditAdmissionRef
            })
          })
        })
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

  it("preserves explicit null gate diagnostics in CLI error details", async () => {
    const runId = "run-anon-loopback-unknown-001";
    const requestId = "req-anon-loopback-unknown-001";
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      await seedXhsCloseoutReady({
        cwd: "/tmp/webenvoy",
        profile: "profile-anon-loopback-unknown-001"
      });
      await expect(
        executeCommand(
          {
            cwd: "/tmp/webenvoy",
            command: "xhs.detail",
            profile: "profile-anon-loopback-unknown-001",
            run_id: runId,
            params: {
              request_id: requestId,
              ability: {
                id: "xhs.note.detail.v1",
                layer: "L3",
                action: "read"
              },
              input: {
                note_id: "abc123"
              },
              options: {
                issue_scope: "issue_209",
                target_domain: "www.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "explore_detail_tab",
                action_type: "read",
                requested_execution_mode: "live_read_high_risk",
                risk_state: "allowed",
                upstream_authorization_request: {
                  action_request: {
                    request_ref: "upstream_req_loopback_anon_unknown_001",
                    action_name: "xhs.read_note_detail",
                    action_category: "read"
                  },
                  resource_binding: {
                    binding_ref: "binding_loopback_anon_unknown_001",
                    resource_kind: "anonymous_context",
                    profile_ref: null,
                    binding_constraints: {
                      anonymous_required: true,
                      reuse_logged_in_context_forbidden: true
                    }
                  },
                  authorization_grant: {
                    grant_ref: "grant_loopback_anon_unknown_001",
                    allowed_actions: ["xhs.read_note_detail"],
                    binding_scope: {
                      allowed_resource_kinds: ["anonymous_context"],
                      allowed_profile_refs: []
                    },
                    target_scope: {
                      allowed_domains: ["www.xiaohongshu.com"],
                      allowed_pages: ["explore_detail_tab"]
                    },
                    resource_state_snapshot: "active",
                    approval_refs: [`approval_admission_${runId}_${requestId}`],
                    audit_refs: [`audit_admission_${runId}_${requestId}`]
                  },
                  runtime_target: {
                    target_ref: "target_loopback_anon_unknown_001",
                    domain: "www.xiaohongshu.com",
                    page: "explore_detail_tab",
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
                admission_context: createApprovedAnonymousReadAdmissionContext(runId, requestId)
              }
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: expect.objectContaining({
          request_admission_result: null,
          execution_audit: null
        })
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

  it("keeps issue_208 editor_input gate and interaction diagnostics in CLI error details", async () => {
    const previousTransport = process.env.WEBENVOY_NATIVE_TRANSPORT;
    const previousBrowserPath = process.env.WEBENVOY_BROWSER_PATH;
    const previousBrowserMockVersion = process.env.WEBENVOY_BROWSER_MOCK_VERSION;
    process.env.WEBENVOY_NATIVE_TRANSPORT = "loopback";
    process.env.WEBENVOY_BROWSER_PATH = join(process.cwd(), "tests", "fixtures", "mock-browser.sh");
    process.env.WEBENVOY_BROWSER_MOCK_VERSION = "Chromium 146.0.0.0";

    try {
      await seedXhsCloseoutReady({
        cwd: "/tmp/webenvoy",
        profile: "profile-loopback-editor-input-001",
        effectiveExecutionMode: "live_write"
      });
      await expect(
        executeCommand(
          {
            cwd: "/tmp/webenvoy",
            command: "xhs.search",
            profile: "profile-loopback-editor-input-001",
            run_id: "run-loopback-editor-input-001",
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
                issue_scope: "issue_208",
                target_domain: "creator.xiaohongshu.com",
                target_tab_id: 32,
                target_page: "creator_publish_tab",
                action_type: "write",
                requested_execution_mode: "live_write",
                validation_action: "editor_input",
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
            }
          } as RuntimeContext,
          createCommandRegistry()
        )
      ).rejects.toMatchObject({
        code: "ERR_EXECUTION_FAILED",
        details: expect.objectContaining({
          gate_reasons: expect.arrayContaining(["EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"]),
          issue_action_matrix: expect.objectContaining({
            issue_scope: "issue_208"
          }),
          write_action_matrix_decisions: expect.objectContaining({
            requested_execution_mode: "live_write",
            write_interaction_tier: "reversible_interaction"
          }),
          consumer_gate_result: expect.objectContaining({
            gate_decision: "blocked",
            requested_execution_mode: "live_write"
          }),
          request_admission_result: expect.objectContaining({
            admission_decision: "blocked"
          }),
          execution_audit: null,
          audit_record: expect.objectContaining({
            requested_execution_mode: "live_write"
          })
        })
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

});
