export const DEFAULT_LOCK_STALE_MS = 60_000;
const parseIsoTime = (value) => {
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
        throw new Error(`Invalid ISO timestamp: ${value}`);
    }
    return timestamp;
};
const isLockStale = (lock, nowIso, staleAfterMs) => {
    const now = parseIsoTime(nowIso);
    const heartbeat = parseIsoTime(lock.lastHeartbeatAt);
    return now - heartbeat > staleAfterMs;
};
const isSameOwner = (lock, owner) => lock.ownerPid === owner.ownerPid && lock.ownerRunId === owner.ownerRunId;
export const createProfileLock = (input) => ({
    profileName: input.profileName,
    lockPath: input.lockPath,
    ownerPid: input.ownerPid,
    ownerRunId: input.ownerRunId,
    acquiredAt: input.nowIso,
    lastHeartbeatAt: input.nowIso
});
export const acquireProfileLock = (current, request, options = {}) => {
    if (current === null) {
        return {
            status: "acquired",
            lock: createProfileLock(request)
        };
    }
    if (isSameOwner(current, request)) {
        return {
            status: "acquired",
            lock: {
                ...current,
                lastHeartbeatAt: request.nowIso
            }
        };
    }
    const staleAfterMs = options.staleAfterMs ?? DEFAULT_LOCK_STALE_MS;
    if (isLockStale(current, request.nowIso, staleAfterMs)) {
        return {
            status: "reclaimed",
            lock: createProfileLock(request)
        };
    }
    return {
        status: "conflict",
        lock: current,
        reason: "lock-held"
    };
};
export const heartbeatProfileLock = (lock, input) => {
    if (!isSameOwner(lock, input)) {
        throw new Error("Lock owner mismatch");
    }
    return {
        ...lock,
        lastHeartbeatAt: input.nowIso
    };
};
export const releaseProfileLock = (lock, owner) => isSameOwner(lock, owner);
