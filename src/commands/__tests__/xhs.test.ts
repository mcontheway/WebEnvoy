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
          profile: "official_ready_profile"
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
});
