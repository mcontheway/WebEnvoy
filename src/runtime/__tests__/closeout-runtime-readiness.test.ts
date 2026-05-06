import { describe, expect, it } from "vitest";

import { buildCloseoutRuntimeReadinessPreflight } from "../closeout-runtime-readiness.js";
import { buildRuntimeBootstrapContextId } from "../runtime-bootstrap.js";

const PROFILE = "xhs_closeout_preflight_profile";
const REQUEST_RUN_ID = "run-request";
const OBSERVED_RUN_ID = "run-owner";
const OBSERVED_SESSION_ID = "nm-session-001";

const observedContextId = () => buildRuntimeBootstrapContextId(PROFILE, OBSERVED_RUN_ID);
const requestContextId = () => buildRuntimeBootstrapContextId(PROFILE, REQUEST_RUN_ID);
const observedRuntimeInstanceId = () =>
  `${OBSERVED_SESSION_ID}:${OBSERVED_RUN_ID}:${observedContextId()}`;

const readyStatus = () => ({
  profile: PROFILE,
  runId: REQUEST_RUN_ID,
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

const recoverableStaleBootstrapEvidence = () => ({
  identityBound: true,
  ownerConflictFree: true,
  controllerBrowserContinuity: true,
  transportBootstrapViable: true,
  mode: "stale_bootstrap_rebind",
  attachableReadyRuntime: false,
  orphanRecoverable: false,
  staleBootstrapRecoverable: true,
  freshness: "fresh",
  observedRunId: OBSERVED_RUN_ID,
  observedRuntimeSessionId: OBSERVED_SESSION_ID,
  runtimeContextId: observedContextId(),
  observedRuntimeInstanceId: observedRuntimeInstanceId(),
  requestRunId: REQUEST_RUN_ID,
  requestRuntimeContextId: requestContextId(),
  managedTargetTabId: 88,
  managedTargetDomain: "www.xiaohongshu.com",
  managedTargetPage: "search_result_tab",
  targetTabContinuity: "runtime_trust_state",
  takeoverEvidenceObservedAt: "2026-05-06T14:00:01.000Z"
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

  it("blocks attachable runtime recovery on non-real-browser execution surface", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        status: {
          ...readyStatus(),
          lockHeld: false,
          runtimeReadiness: "blocked",
          executionSurface: "headless_browser",
          headless: true,
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
      decision: "NO_GO",
      runtime_state: "blocked",
      recovery_mode: "none",
      blocker: {
        blocker_code: "runtime_not_ready"
      },
      runtime_status: {
        execution_surface: "headless_browser",
        headless: true
      }
    });
  });

  it("blocks ready runtime when requested target continuity is missing", () => {
    expect(
      buildCloseoutRuntimeReadinessPreflight({
        params: {
          target_domain: "www.xiaohongshu.com",
          target_tab_id: 88,
          target_page: "search_result_tab"
        },
        status: readyStatus()
      })
    ).toMatchObject({
      decision: "NO_GO",
      runtime_state: "blocked",
      recovery_mode: "none",
      blocker: {
        blocker_code: "target_mismatch",
        required_recovery_action: "restore_or_rebind_managed_target_tab"
      },
      target_binding: {
        requested: true,
        state: "missing"
      }
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
          runtimeTakeoverEvidence: recoverableStaleBootstrapEvidence()
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

  it("blocks stale bootstrap rebind when continuity token is not trusted", () => {
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
            ...recoverableStaleBootstrapEvidence(),
            staleBootstrapRecoverable: true,
            targetTabContinuity: "non_trusted_value",
            takeoverEvidenceObservedAt: "2026-05-06T14:00:01.000Z"
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "target_mismatch"
      },
      target_binding: {
        state: "mismatch",
        target_tab_continuity: "non_trusted_value"
      }
    });
  });

  it("blocks stale bootstrap rebind when runtime continuity fields are incomplete", () => {
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
            ...recoverableStaleBootstrapEvidence(),
            observedRunId: OBSERVED_RUN_ID,
            observedRuntimeSessionId: undefined,
            runtimeContextId: undefined,
            observedRuntimeInstanceId: undefined
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "bootstrap_stale_unrecoverable"
      },
      target_binding: {
        state: "verified"
      }
    });
  });

  it("blocks stale bootstrap rebind when takeover evidence is older than the request", () => {
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
            ...recoverableStaleBootstrapEvidence(),
            takeoverEvidenceObservedAt: "2026-05-06T13:59:59.000Z"
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "bootstrap_stale_unrecoverable"
      },
      target_binding: {
        state: "verified"
      }
    });
  });

  it("blocks stale bootstrap rebind when request run context does not match status", () => {
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
            ...recoverableStaleBootstrapEvidence(),
            requestRunId: "run-other-request",
            requestRuntimeContextId: requestContextId()
          }
        }
      })
    ).toMatchObject({
      decision: "NO_GO",
      blocker: {
        blocker_code: "bootstrap_stale_unrecoverable"
      }
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
            ...recoverableStaleBootstrapEvidence(),
            managedTargetTabId: 88,
            takeoverEvidenceObservedAt: "2026-05-06T14:00:01.000Z"
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

  it("blocks stale bootstrap as unrecoverable when requested_at is missing but rebind evidence is incomplete", () => {
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
            staleBootstrapRecoverable: false,
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
        blocker_code: "bootstrap_stale_unrecoverable"
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
          runtimeTakeoverEvidence: recoverableStaleBootstrapEvidence()
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
