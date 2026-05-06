import { buildRuntimeBootstrapContextId } from "./runtime-bootstrap.js";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asBooleanOrNull = (value) => typeof value === "boolean" ? value : null;
const isIsoTimestampAtOrAfter = (value, floor) => {
    if (typeof value !== "string" || typeof floor !== "string") {
        return false;
    }
    const valueMs = Date.parse(value);
    const floorMs = Date.parse(floor);
    return Number.isFinite(valueMs) && Number.isFinite(floorMs) && valueMs >= floorMs;
};
const buildObservedRuntimeInstanceId = (input) => `${input.sessionId}:${input.runId}:${input.runtimeContextId}`;
const hasObservedRuntimeContinuity = (input) => {
    const profile = asString(input.status.profile);
    const observedRunId = asString(input.evidence.observedRunId);
    const observedRuntimeSessionId = asString(input.evidence.observedRuntimeSessionId);
    const observedRuntimeContextId = asString(input.evidence.runtimeContextId);
    const observedRuntimeInstanceId = asString(input.evidence.observedRuntimeInstanceId);
    if (profile === null ||
        observedRunId === null ||
        observedRuntimeSessionId === null ||
        observedRuntimeContextId === null ||
        observedRuntimeInstanceId === null) {
        return false;
    }
    if (observedRuntimeContextId !== buildRuntimeBootstrapContextId(profile, observedRunId)) {
        return false;
    }
    return (observedRuntimeInstanceId ===
        buildObservedRuntimeInstanceId({
            sessionId: observedRuntimeSessionId,
            runId: observedRunId,
            runtimeContextId: observedRuntimeContextId
        }));
};
const blocker = (blockerCode, requiredRecoveryAction) => ({
    blocker_layer: "runtime_readiness",
    blocker_code: blockerCode,
    required_recovery_action: requiredRecoveryAction
});
const buildTargetBinding = (params, takeoverEvidence) => {
    const requestedTargetTabId = asInteger(params.target_tab_id);
    const requestedTargetDomain = asString(params.target_domain);
    const requestedTargetPage = asString(params.target_page);
    const requested = requestedTargetTabId !== null || requestedTargetDomain !== null || requestedTargetPage !== null;
    const managedTargetTabId = asInteger(takeoverEvidence?.managedTargetTabId);
    const managedTargetDomain = asString(takeoverEvidence?.managedTargetDomain);
    const managedTargetPage = asString(takeoverEvidence?.managedTargetPage);
    const targetTabContinuity = asString(takeoverEvidence?.targetTabContinuity);
    let state = "not_requested";
    if (requested) {
        const hasManagedTarget = managedTargetTabId !== null || managedTargetDomain !== null || managedTargetPage !== null;
        const exactMatch = requestedTargetTabId !== null &&
            requestedTargetDomain !== null &&
            requestedTargetPage !== null &&
            managedTargetTabId === requestedTargetTabId &&
            managedTargetDomain === requestedTargetDomain &&
            managedTargetPage === requestedTargetPage &&
            targetTabContinuity !== null;
        state =
            exactMatch && targetTabContinuity === "runtime_trust_state"
                ? "verified"
                : hasManagedTarget
                    ? "mismatch"
                    : "missing";
    }
    return {
        requested,
        state,
        requested_target_tab_id: requestedTargetTabId,
        requested_target_domain: requestedTargetDomain,
        requested_target_page: requestedTargetPage,
        managed_target_tab_id: managedTargetTabId,
        managed_target_domain: managedTargetDomain,
        managed_target_page: managedTargetPage,
        target_tab_continuity: targetTabContinuity
    };
};
const hasStaleBootstrapRebindBaseEvidence = (input) => {
    const profile = asString(input.status.profile);
    const runId = asString(input.status.runId);
    if (!input.evidence || profile === null || runId === null) {
        return false;
    }
    return (input.evidence.mode === "stale_bootstrap_rebind" &&
        input.evidence.staleBootstrapRecoverable === true &&
        input.evidence.freshness === "fresh" &&
        input.evidence.identityBound === true &&
        input.evidence.ownerConflictFree === true &&
        input.evidence.controllerBrowserContinuity === true &&
        input.evidence.transportBootstrapViable === true &&
        asString(input.evidence.requestRunId) === runId &&
        asString(input.evidence.requestRuntimeContextId) === buildRuntimeBootstrapContextId(profile, runId) &&
        hasObservedRuntimeContinuity({
            status: input.status,
            evidence: input.evidence
        }) &&
        input.targetBinding.requested === true &&
        input.targetBinding.state === "verified" &&
        input.executionSurface === "real_browser" &&
        input.headless === false);
};
const hasStaleBootstrapRebindEvidence = (input) => hasStaleBootstrapRebindBaseEvidence(input) &&
    isIsoTimestampAtOrAfter(input.evidence?.takeoverEvidenceObservedAt, input.requestedAt);
export const buildCloseoutRuntimeReadinessPreflight = (input) => {
    const params = input.params ?? {};
    const status = input.status;
    const takeoverEvidence = asObject(status.runtimeTakeoverEvidence);
    const targetBinding = buildTargetBinding(params, takeoverEvidence);
    const identityBindingState = asString(status.identityBindingState);
    const transportState = asString(status.transportState);
    const bootstrapState = asString(status.bootstrapState);
    const runtimeReadiness = asString(status.runtimeReadiness);
    const lockHeld = status.lockHeld === true;
    const executionSurface = asString(status.executionSurface);
    const headless = asBooleanOrNull(status.headless);
    const requestedAt = asString(params.requested_at);
    const officialRealBrowserSurface = executionSurface === "real_browser" && headless === false;
    const base = {
        target_binding: targetBinding,
        runtime_status: {
            profile_state: asString(status.profileState),
            lock_held: lockHeld,
            identity_binding_state: identityBindingState,
            transport_state: transportState,
            bootstrap_state: bootstrapState,
            runtime_readiness: runtimeReadiness,
            execution_surface: executionSurface,
            headless
        },
        takeover_evidence: takeoverEvidence
    };
    if (identityBindingState !== "bound" || takeoverEvidence?.identityBound === false) {
        return {
            decision: "NO_GO",
            runtime_state: "blocked",
            recovery_mode: "none",
            blocker: blocker("identity_mismatch", "rebind_official_chrome_extension_identity"),
            ...base
        };
    }
    if (targetBinding.state === "mismatch") {
        return {
            decision: "NO_GO",
            runtime_state: "blocked",
            recovery_mode: "none",
            blocker: blocker("target_mismatch", "restore_or_rebind_managed_target_tab"),
            ...base
        };
    }
    if (targetBinding.state === "missing") {
        return {
            decision: "NO_GO",
            runtime_state: "blocked",
            recovery_mode: "none",
            blocker: blocker("target_mismatch", "restore_or_rebind_managed_target_tab"),
            ...base
        };
    }
    if (lockHeld &&
        identityBindingState === "bound" &&
        transportState === "ready" &&
        bootstrapState === "ready" &&
        runtimeReadiness === "ready" &&
        officialRealBrowserSurface) {
        return {
            decision: "GO",
            runtime_state: "ready",
            recovery_mode: "none",
            blocker: null,
            ...base
        };
    }
    if (!lockHeld && takeoverEvidence?.ownerConflictFree === false) {
        return {
            decision: "NO_GO",
            runtime_state: "blocked",
            recovery_mode: "none",
            blocker: blocker("lock_conflict", "stop_or_wait_for_current_runtime_owner"),
            ...base
        };
    }
    if (!lockHeld && takeoverEvidence?.attachableReadyRuntime === true && officialRealBrowserSurface) {
        return {
            decision: "RECOVERABLE",
            runtime_state: "recoverable",
            recovery_mode: "ready_attach",
            blocker: null,
            ...base
        };
    }
    if (!lockHeld && takeoverEvidence?.orphanRecoverable === true && officialRealBrowserSurface) {
        return {
            decision: "RECOVERABLE",
            runtime_state: "recoverable",
            recovery_mode: "recoverable_rebind",
            blocker: null,
            ...base
        };
    }
    if (bootstrapState === "stale") {
        if (requestedAt === null &&
            hasStaleBootstrapRebindBaseEvidence({
                status,
                evidence: takeoverEvidence,
                targetBinding,
                executionSurface,
                headless
            })) {
            return {
                decision: "NO_GO",
                runtime_state: "blocked",
                recovery_mode: "none",
                blocker: blocker("request_identity_replay", "rerun_preflight_with_fresh_requested_at"),
                ...base
            };
        }
        if (!lockHeld &&
            hasStaleBootstrapRebindEvidence({
                status,
                evidence: takeoverEvidence,
                targetBinding,
                requestedAt,
                executionSurface,
                headless
            })) {
            return {
                decision: "RECOVERABLE",
                runtime_state: "recoverable",
                recovery_mode: "stale_bootstrap_rebind",
                blocker: null,
                ...base
            };
        }
        return {
            decision: "NO_GO",
            runtime_state: "blocked",
            recovery_mode: "none",
            blocker: blocker("bootstrap_stale_unrecoverable", "restart_runtime_with_fresh_bootstrap"),
            ...base
        };
    }
    return {
        decision: "NO_GO",
        runtime_state: "blocked",
        recovery_mode: "none",
        blocker: blocker("runtime_not_ready", "start_or_restore_official_chrome_runtime"),
        ...base
    };
};
