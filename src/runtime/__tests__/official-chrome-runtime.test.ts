import { describe, expect, it, vi } from "vitest";

import {
  buildOfficialChromeRuntimeStatusParams,
  prepareOfficialChromeRuntime
} from "../official-chrome-runtime.js";

const buildRuntimeTakeoverEvidence = (input: {
  mode?: "ready_attach" | "recoverable_rebind" | null;
  attachableReadyRuntime?: boolean;
  orphanRecoverable?: boolean;
  observedRunId?: string;
  runtimeContextId?: string | null;
} = {}) => ({
  mode: input.mode ?? null,
  attachableReadyRuntime: input.attachableReadyRuntime ?? false,
  orphanRecoverable: input.orphanRecoverable ?? false,
  observedRunId: input.observedRunId ?? "observed-runtime-001",
  runtimeContextId: input.runtimeContextId ?? null
});

describe("prepareOfficialChromeRuntime", () => {
  it("does not forward persistent extension identity into runtime.status params", () => {
    expect(
      buildOfficialChromeRuntimeStatusParams(
        {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_profile",
          run_id: "run-runtime-ready-identity-001",
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

  it("converges pending bootstrap to ready through the shared runtime contract", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
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
        profileState: "ready",
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
            run_id: "run-runtime-ready-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_ready_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_profile",
          run_id: "run-runtime-ready-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      identityBindingState: "bound",
      bootstrapState: "ready",
      transportState: "ready",
      lockHeld: true
    });

    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap",
        params: expect.objectContaining({
          run_id: "run-runtime-ready-001",
          profile: "official_ready_profile"
        })
      })
    );
  });

  it("forwards explicit target_tab_id into hidden runtime.bootstrap when provided", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
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
        profileState: "ready",
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
            run_id: "run-runtime-ready-target-tab-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_target_tab_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_target_tab_profile",
          run_id: "run-runtime-ready-target-tab-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_write",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        bootstrapTargetTabId: 44,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      bootstrapState: "ready",
      transportState: "ready"
    });

    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "runtime.bootstrap",
        params: expect.objectContaining({
          target_tab_id: 44
        })
      })
    );
  });

  it("attaches a fresh run_id to an already-ready runtime before bootstrapping its own context", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "blocked",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: false,
        runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
          mode: "ready_attach",
          attachableReadyRuntime: true,
          observedRunId: "run-runtime-attach-owner-001"
        })
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-runtime-attach-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_attach_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_attach_profile",
          run_id: "run-runtime-attach-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_write",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        bootstrapTargetTabId: 52,
        attachRuntime,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      bootstrapState: "ready",
      transportState: "ready",
      lockHeld: true
    });

    expect(attachRuntime).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "runtime.bootstrap",
        params: expect.objectContaining({
          run_id: "run-runtime-attach-001",
          target_tab_id: 52
        })
      })
    );
  });

  it("attempts attach from pre-lock orphan recovery facts even after attach rebinding", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "disconnected",
        runtimeReadiness: "recoverable",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "disconnected",
        lockHeld: false,
        runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
          mode: "recoverable_rebind",
          orphanRecoverable: true,
          observedRunId: "run-runtime-recoverable-owner-001"
        })
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-runtime-recoverable-attach-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_recoverable_attach_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_recoverable_attach_profile",
          run_id: "run-runtime-recoverable-attach-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      transportState: "ready",
      lockHeld: true
    });

    expect(attachRuntime).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap"
      })
    );
  });

  it("attempts attach for a ready runtime only after status proves a live transport is still available", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "blocked",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: false,
        runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
          mode: "ready_attach",
          attachableReadyRuntime: true,
          observedRunId: "run-runtime-owner-001"
        })
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-runtime-owner-attach-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_ready_attach_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_attach_profile",
          run_id: "run-runtime-owner-attach-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      transportState: "ready",
      lockHeld: true
    });

    expect(attachRuntime).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap"
      })
    );
  });

  it("still attempts attach when a ready runtime reports bootstrap failure but transport remains healthy", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "blocked",
        identityBindingState: "bound",
        bootstrapState: "failed",
        transportState: "ready",
        lockHeld: false,
        runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
          mode: "ready_attach",
          attachableReadyRuntime: true,
          observedRunId: "run-runtime-bootstrap-failed-owner-001"
        })
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "ready",
        identityBindingState: "bound",
        bootstrapState: "ready",
        transportState: "ready",
        lockHeld: true
      });
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "failed",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn(async (request: { params: { runtime_context_id: string } }) => ({
        ok: true,
        payload: {
          result: {
            version: "v1",
            run_id: "run-runtime-bootstrap-failed-attach-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_failed_bootstrap_attach_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_failed_bootstrap_attach_profile",
          run_id: "run-runtime-bootstrap-failed-attach-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      transportState: "ready",
      lockHeld: true
    });

    expect(attachRuntime).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.bootstrap"
      })
    );
  });

  it("does not attempt attach when status reports a failed-ready conflict as non-attachable", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "blocked",
      identityBindingState: "bound",
      bootstrapState: "failed",
      transportState: "ready",
      lockHeld: false,
      runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
        mode: null,
        attachableReadyRuntime: false
      })
    }));
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "failed",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_conflicted_attach_profile",
          run_id: "run-runtime-conflicted-attach-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });

    expect(attachRuntime).not.toHaveBeenCalled();
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("does not attempt attach when the readiness probe never verified the ready runtime", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "blocked",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: false,
      runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
        mode: null,
        attachableReadyRuntime: false
      })
    }));
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_unverified_attach_profile",
          run_id: "run-runtime-unverified-attach-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });

    expect(attachRuntime).not.toHaveBeenCalled();
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("does not attach a recoverable runtime unless status proves it is orphan-recoverable", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "disconnected",
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "ready",
      transportState: "disconnected",
      lockHeld: false,
      runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
        mode: null,
        orphanRecoverable: false
      })
    }));
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "ready",
      identityBindingState: "bound",
      bootstrapState: "ready",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_non_orphan_recoverable_profile",
          run_id: "run-runtime-non-orphan-attach-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });

    expect(attachRuntime).not.toHaveBeenCalled();
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("does not attach a ready runtime when the transport signal is not ready", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "blocked",
      identityBindingState: "bound",
      bootstrapState: "not_started",
      transportState: "not_connected",
      lockHeld: false,
      runtimeTakeoverEvidence: buildRuntimeTakeoverEvidence({
        mode: null,
        attachableReadyRuntime: false
      })
    }));
    const attachRuntime = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      runtimeReadiness: "ready",
      identityBindingState: "bound",
      bootstrapState: "ready",
      transportState: "ready",
      lockHeld: true
    }));
    const bridge = {
      runCommand: vi.fn()
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_ready_attach_unverified_profile",
          run_id: "run-runtime-ready-attach-unverified-001",
          command: "xhs.detail",
          params: {}
        } as never,
        consumerId: "xhs.detail",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        attachRuntime,
        readStatus
      })
    ).rejects.toMatchObject({
      code: "ERR_PROFILE_LOCKED"
    });

    expect(attachRuntime).not.toHaveBeenCalled();
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });

  it("waits for bridge readiness when bootstrap is initially not delivered", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
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
        profileState: "ready",
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
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_first_prepare_profile",
          run_id: "run-runtime-first-prepare-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        readStatus
      })
    ).resolves.toMatchObject({
      runtimeReadiness: "ready",
      bootstrapState: "ready",
      transportState: "ready"
    });

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

  it("fails with explicit diagnostics when bridge readiness omits execution-surface signals", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "not_started",
        transportState: "not_connected",
        lockHeld: true
      })
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
        runtimeReadiness: "pending",
        identityBindingState: "bound",
        bootstrapState: "not_started",
        transportState: "not_connected",
        lockHeld: true
      });
    const bridge = {
      runCommand: vi.fn()
        .mockResolvedValue({
          ok: true,
          payload: {
            message: "pong"
          },
          relay_path: "host>background>content-script>background>host",
          error: null
        })
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_transport_not_connected_profile",
          run_id: "run-runtime-transport-not-connected-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        readStatus
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_UNAVAILABLE",
      details: {
        ability_id: "xhs.search",
        reason: "ERR_RUNTIME_READINESS_SIGNAL_MISSING",
        relay_path: "host>background>content-script>background>host"
      }
    });
    expect(bridge.runCommand).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "runtime.readiness"
      })
    );
  });

  it.each([
    "ERR_RUNTIME_BOOTSTRAP_ACK_STALE",
    "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
    "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
  ] as const)(
    "preserves bootstrap failure classification when the shared recovery contract receives %s",
    async (bootstrapErrorCode) => {
      const readStatus = vi
        .fn()
        .mockResolvedValueOnce({
          identityPreflight: {
            mode: "official_chrome_persistent_extension"
          },
          profileState: "ready",
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
          profileState: "ready",
          runtimeReadiness: "pending",
          identityBindingState: "bound",
          bootstrapState: "pending",
          transportState: "ready",
          lockHeld: true
        });
      const bridge = {
        runCommand: vi.fn().mockResolvedValueOnce({
          ok: false,
          error: {
            code: bootstrapErrorCode,
            message: `runtime bootstrap failed: ${bootstrapErrorCode}`
          }
        })
      };

      await expect(
        prepareOfficialChromeRuntime({
          context: {
            cwd: "/tmp/webenvoy",
            profile: "official_runtime_prepare_profile",
            run_id: "run-runtime-prepare-recovery-001",
            command: "xhs.search",
            params: {}
          } as never,
          consumerId: "xhs.search",
          requestedExecutionMode: "live_read_high_risk",
          bridge: bridge as never,
          fingerprintContext: {
            fingerprint_profile_bundle: null
          } as never,
          readStatus
        })
      ).rejects.toMatchObject({
        code: bootstrapErrorCode,
        message: `runtime bootstrap failed: ${bootstrapErrorCode}`,
        retryable: bootstrapErrorCode !== "ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH",
        details: {
          ability_id: "xhs.search",
          stage: "execution",
          reason: bootstrapErrorCode
        }
      });

      expect(bridge.runCommand).toHaveBeenCalledTimes(1);
      expect(bridge.runCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          command: "runtime.bootstrap"
        })
      );
    }
  );

  it("keeps runtime blocked when the profile lock is lost before final convergence", async () => {
    const readStatus = vi
      .fn()
      .mockResolvedValueOnce({
        identityPreflight: {
          mode: "official_chrome_persistent_extension"
        },
        profileState: "ready",
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
        profileState: "ready",
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
            run_id: "run-runtime-lock-lost-001",
            runtime_context_id: request.params.runtime_context_id,
            profile: "official_lock_lost_profile",
            status: "ready"
          }
        },
        error: null
      }))
    };

    await expect(
      prepareOfficialChromeRuntime({
        context: {
          cwd: "/tmp/webenvoy",
          profile: "official_lock_lost_profile",
          run_id: "run-runtime-lock-lost-001",
          command: "xhs.search",
          params: {}
        } as never,
        consumerId: "xhs.search",
        requestedExecutionMode: "live_read_high_risk",
        bridge: bridge as never,
        fingerprintContext: {
          fingerprint_profile_bundle: null
        } as never,
        readStatus
      })
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
});
