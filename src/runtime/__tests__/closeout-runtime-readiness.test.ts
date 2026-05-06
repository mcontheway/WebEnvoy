import { describe, expect, it } from "vitest";

import { buildCloseoutRuntimeReadinessPreflight } from "../closeout-runtime-readiness.js";

const readyStatus = () => ({
  profileState: "ready",
  lockHeld: true,
  identityBindingState: "bound",
  transportState: "ready",
  bootstrapState: "ready",
  runtimeReadiness: "ready",
  executionSurface: "real_browser",
  headless: false,
  runtimeTakeoverEvidence: {
    identityBound: true,
    ownerConflictFree: true,
    attachableReadyRuntime: false,
    orphanRecoverable: false,
    staleBootstrapRecoverable: false
  }
});

describe("closeout runtime readiness preflight", () => {
  it("returns GO for a held real-browser ready runtime", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        status: readyStatus()
      })
    ).toMatchObject({
      decision: "GO",
      runtime_state: "ready",
      recovery_mode: "none",
      blocker: null,
      runtime_status: {
        lock_held: true,
        identity_binding_state: "bound",
        transport_state: "ready",
        bootstrap_state: "ready",
        runtime_readiness: "ready",
        execution_surface: "real_browser",
        headless: false
      }
    });
  });

  it("returns RECOVERABLE for an attachable ready runtime without mutating ownership", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        status: {
          ...readyStatus(),
          lockHeld: false,
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            attachableReadyRuntime: true,
            orphanRecoverable: false,
            staleBootstrapRecoverable: false
          }
        }
      })
    ).toMatchObject({
      decision: "RECOVERABLE",
      runtime_state: "recoverable",
      recovery_mode: "ready_attach",
      blocker: null
    });
  });

  it("returns RECOVERABLE for fresh stale-bootstrap rebind evidence bound to the requested target", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        params: {
          requested_at: "2026-05-06T14:00:00.000Z",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 88,
          target_page: "search_result_tab"
        },
        status: {
          ...readyStatus(),
          lockHeld: false,
          bootstrapState: "stale",
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            attachableReadyRuntime: false,
            orphanRecoverable: false,
            staleBootstrapRecoverable: true,
            freshness: "fresh",
            managedTargetTabId: 88,
            managedTargetDomain: "www.xiaohongshu.com",
            managedTargetPage: "search_result_tab",
            targetTabContinuity: "runtime_trust_state"
          }
        }
      })
    ).toMatchObject({
      decision: "RECOVERABLE",
      runtime_state: "recoverable",
      recovery_mode: "stale_bootstrap_rebind",
      target_binding: {
        requested: true,
        state: "verified"
      },
      blocker: null
    });
  });

  it("blocks stale bootstrap when target continuity mismatches", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        params: {
          requested_at: "2026-05-06T14:00:00.000Z",
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 99,
          target_page: "search_result_tab"
        },
        status: {
          ...readyStatus(),
          lockHeld: false,
          bootstrapState: "stale",
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            staleBootstrapRecoverable: true,
            freshness: "fresh",
            managedTargetTabId: 88,
            managedTargetDomain: "www.xiaohongshu.com",
            managedTargetPage: "search_result_tab",
            targetTabContinuity: "runtime_trust_state"
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      runtime_state: "blocked",
      blocker: {
        blocker_layer: "runtime_readiness",
        blocker_code: "target_mismatch",
        required_recovery_action: "restore_or_rebind_managed_target_tab"
      },
      target_binding: {
        state: "mismatch"
      }
    });
  });

  it("blocks stale bootstrap when request freshness is missing", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        params: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 88,
          target_page: "search_result_tab"
        },
        status: {
          ...readyStatus(),
          lockHeld: false,
          bootstrapState: "stale",
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            staleBootstrapRecoverable: true,
            freshness: "fresh",
            managedTargetTabId: 88,
            managedTargetDomain: "www.xiaohongshu.com",
            managedTargetPage: "search_result_tab",
            targetTabContinuity: "runtime_trust_state"
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "request_identity_replay",
        required_recovery_action: "rerun_preflight_with_fresh_requested_at"
      }
    });
  });

  it("blocks stale bootstrap without recoverable evidence", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        status: {
          ...readyStatus(),
          lockHeld: true,
          bootstrapState: "stale",
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            staleBootstrapRecoverable: false
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "bootstrap_stale_unrecoverable",
        required_recovery_action: "restart_runtime_with_fresh_bootstrap"
      }
    });
  });

  it("blocks stale bootstrap rebind when no request target is bound", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        status: {
          ...readyStatus(),
          lockHeld: false,
          bootstrapState: "stale",
          runtimeReadiness: "blocked",
          runtimeTakeoverEvidence: {
            identityBound: true,
            ownerConflictFree: true,
            staleBootstrapRecoverable: true,
            freshness: "fresh"
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "bootstrap_stale_unrecoverable"
      },
      target_binding: {
        requested: false,
        state: "not_requested"
      }
    });
  });
});
