import { describe, expect, it, vi } from "vitest";

import { ensureOfficialChromeRuntimeReady } from "../xhs.js";

describe("ensureOfficialChromeRuntimeReady", () => {
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
        runtime_readiness: "unknown",
        bootstrap_state: "ready",
        transport_state: "not_connected",
        reason: "ERR_RUNTIME_NOT_READY"
      })
    });
  });
});
