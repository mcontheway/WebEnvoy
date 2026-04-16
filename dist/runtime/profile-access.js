export const isStartableProfileState = (state) => state === "uninitialized" || state === "stopped" || state === "disconnected";
export const isLoginableProfileState = (state) => state === "uninitialized" ||
    state === "stopped" ||
    state === "disconnected" ||
    state === "ready" ||
    state === "logging_in";
export const isRuntimeActiveProfileState = (state) => state === "starting" || state === "ready" || state === "logging_in" || state === "stopping";
export const shouldRecoverAsDisconnected = (acquisition, state) => acquisition !== "same-owner" && isRuntimeActiveProfileState(state);
export const inspectProfileLock = (input) => {
    const browserInstanceState = input.browserInstanceState;
    const lockOwnerAlive = input.isProcessAlive(input.lock.ownerPid);
    const pinnedControllerPid = typeof input.lock.controllerPid === "number"
        ? input.lock.controllerPid
        : input.lock.ownerPid;
    const stalePinnedController = input.lock.controllerPidState === "stale";
    const stateMatchesRun = browserInstanceState !== null && browserInstanceState.runId === input.lock.ownerRunId;
    const stateMatchesPinnedController = stateMatchesRun && browserInstanceState.controllerPid === pinnedControllerPid;
    const controllerAlive = stateMatchesRun &&
        !stalePinnedController &&
        stateMatchesPinnedController &&
        input.isProcessAlive(browserInstanceState.controllerPid);
    const browserAlive = browserInstanceState !== null && input.isProcessAlive(browserInstanceState.browserPid);
    const orphanRecoverable = !lockOwnerAlive &&
        !controllerAlive &&
        stateMatchesPinnedController &&
        browserInstanceState !== null &&
        browserAlive;
    return {
        blocksReuse: lockOwnerAlive || controllerAlive || browserAlive,
        controlConnected: lockOwnerAlive || controllerAlive,
        browserPid: browserAlive ? browserInstanceState?.browserPid ?? null : null,
        stateRunId: browserInstanceState?.runId ?? null,
        orphanRecoverable
    };
};
export const resolveProfileAccessState = (input) => {
    const activeState = isRuntimeActiveProfileState(input.storedProfileState) ||
        input.storedProfileState === "disconnected";
    const healthyLock = input.lockInspection?.blocksReuse ?? false;
    const controlConnected = input.lockInspection?.controlConnected ?? false;
    const profileState = activeState && !controlConnected ? "disconnected" : input.storedProfileState;
    const lockHeld = activeState && healthyLock && input.lockOwnerRunId === input.runtimeRunId;
    const observedRunId = activeState && healthyLock && typeof input.lockOwnerRunId === "string"
        ? input.lockOwnerRunId
        : input.runtimeRunId;
    return {
        profileState,
        lockHeld,
        observedRunId,
        healthyLock,
        controlConnected
    };
};
