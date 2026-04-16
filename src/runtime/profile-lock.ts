export interface ProfileLock {
  profileName: string;
  lockPath: string;
  ownerPid: number;
  controllerPid?: number;
  controllerPidState?: "live" | "stale";
  ownerRunId: string;
  acquiredAt: string;
  lastHeartbeatAt: string;
}

export interface AcquireLockInput {
  profileName: string;
  lockPath: string;
  ownerPid: number;
  ownerRunId: string;
  nowIso: string;
}

export interface LockAcquireOptions {
  staleAfterMs?: number;
}

export interface LockOwner {
  ownerPid: number;
  ownerRunId: string;
}

export interface LockHeartbeatInput extends LockOwner {
  nowIso: string;
}

export interface AcquireLockResult {
  status: "acquired" | "reclaimed" | "conflict";
  lock: ProfileLock;
  reason?: "lock-held";
}

export const DEFAULT_LOCK_STALE_MS = 60_000;

const parseIsoTime = (value: string): number => {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return timestamp;
};

const isLockStale = (lock: ProfileLock, nowIso: string, staleAfterMs: number): boolean => {
  const now = parseIsoTime(nowIso);
  const heartbeat = parseIsoTime(lock.lastHeartbeatAt);
  return now - heartbeat > staleAfterMs;
};

const isSameOwner = (lock: ProfileLock, owner: LockOwner): boolean =>
  lock.ownerPid === owner.ownerPid && lock.ownerRunId === owner.ownerRunId;

export const createProfileLock = (input: AcquireLockInput): ProfileLock => ({
  profileName: input.profileName,
  lockPath: input.lockPath,
  ownerPid: input.ownerPid,
  controllerPid: input.ownerPid,
  controllerPidState: "live",
  ownerRunId: input.ownerRunId,
  acquiredAt: input.nowIso,
  lastHeartbeatAt: input.nowIso
});

export const acquireProfileLock = (
  current: ProfileLock | null,
  request: AcquireLockInput,
  options: LockAcquireOptions = {}
): AcquireLockResult => {
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

export const heartbeatProfileLock = (
  lock: ProfileLock,
  input: LockHeartbeatInput
): ProfileLock => {
  if (!isSameOwner(lock, input)) {
    throw new Error("Lock owner mismatch");
  }

  return {
    ...lock,
    lastHeartbeatAt: input.nowIso
  };
};

export const releaseProfileLock = (lock: ProfileLock, owner: LockOwner): boolean =>
  isSameOwner(lock, owner);
