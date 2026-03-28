import { describe, expect, it, vi } from "vitest";

import { buildOfficialChromeRuntimeStatusParams, ensureOfficialChromeRuntimeReady } from "../xhs.js";

describe("ensureOfficialChromeRuntimeReady", () => {
  it("forwards persistent extension identity into runtime.status params", () => {
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
    ).toMatchObject({
      requested_execution_mode: "live_read_high_risk",
      persistent_extension_identity: {
        extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        manifestPath: "/tmp/native-host-manifest.json"
      }
    });
  });

  it("reuses the execution bridge session when official Chrome runtime transitions to ready", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready"
    }));
    const bridge = {
      runCommand: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          payload: {},
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

    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        command: "runtime.ping"
      })
    );
    expect(bridge.runCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        command: "runtime.readiness"
      })
    );
  });

  it("keeps runtime gated when readiness payload misses transport_state", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      runtimeReadiness: "pending",
      identityBindingState: "bound",
      bootstrapState: "pending",
      transportState: "ready"
    }));
    const bridge = {
      runCommand: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          payload: {},
          error: null
        })
        .mockResolvedValueOnce({
          ok: true,
          payload: {
            bootstrap_state: "ready"
          },
          error: null
        })
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
      code: "ERR_RUNTIME_UNAVAILABLE",
      details: expect.objectContaining({
        runtime_readiness: "recoverable",
        bootstrap_state: "ready",
        transport_state: "not_connected",
        reason: "ERR_RUNTIME_TRANSPORT_NOT_READY"
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
      transportState: "ready"
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
      transportState: "ready"
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

  it("keeps transport failures distinct from bootstrap-not-delivered in final readiness gate", async () => {
    const readStatus = vi.fn(async () => ({
      identityPreflight: {
        mode: "official_chrome_persistent_extension"
      },
      profileState: "ready",
      confirmationRequired: false,
      runtimeReadiness: "recoverable",
      identityBindingState: "bound",
      bootstrapState: "not_started",
      transportState: "not_connected"
    }));
    const bridge = {
      runCommand: vi.fn()
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
        runtime_readiness: "recoverable",
        bootstrap_state: "not_started",
        transport_state: "not_connected",
        reason: "ERR_RUNTIME_TRANSPORT_NOT_READY"
      })
    });
    expect(bridge.runCommand).not.toHaveBeenCalled();
  });
});
