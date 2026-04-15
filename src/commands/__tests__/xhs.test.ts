import { describe, expect, it, vi } from "vitest";
import { join } from "node:path";

import {
  buildOfficialChromeRuntimeStatusParams,
  ensureOfficialChromeRuntimeReady,
  normalizeGateOptionsForContract
} from "../xhs.js";
import { executeCommand } from "../../core/router.js";
import { createCommandRegistry } from "../index.js";
import type { RuntimeContext } from "../../core/types.js";

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

});
