import { describe, expect, it } from "vitest";

import {
  acquireProfileLock,
  createProfileLock,
  heartbeatProfileLock,
  releaseProfileLock
} from "../profile-lock.js";

describe("profile-lock", () => {
  it("acquires lock when profile is free", () => {
    const result = acquireProfileLock(null, {
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    expect(result.status).toBe("acquired");
    expect(result.lock.ownerRunId).toBe("run-1");
  });

  it("returns conflict for a fresh lock from another owner", () => {
    const existing = createProfileLock({
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    const result = acquireProfileLock(existing, {
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 101,
      ownerRunId: "run-2",
      nowIso: "2026-03-19T10:00:10.000Z"
    });

    expect(result.status).toBe("conflict");
    expect(result.reason).toBe("lock-held");
  });

  it("reclaims stale lock from another owner", () => {
    const existing = createProfileLock({
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    const result = acquireProfileLock(
      existing,
      {
        profileName: "default",
        lockPath: "/tmp/default.lock",
        ownerPid: 101,
        ownerRunId: "run-2",
        nowIso: "2026-03-19T10:02:10.000Z"
      },
      { staleAfterMs: 30_000 }
    );

    expect(result.status).toBe("reclaimed");
    expect(result.lock.ownerRunId).toBe("run-2");
  });

  it("updates heartbeat only for lock owner", () => {
    const lock = createProfileLock({
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    const updated = heartbeatProfileLock(lock, {
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:05.000Z"
    });

    expect(updated.lastHeartbeatAt).toBe("2026-03-19T10:00:05.000Z");
    expect(() =>
      heartbeatProfileLock(lock, {
        ownerPid: 999,
        ownerRunId: "run-other",
        nowIso: "2026-03-19T10:00:05.000Z"
      })
    ).toThrow(/lock owner mismatch/i);
  });

  it("releases lock only for lock owner", () => {
    const lock = createProfileLock({
      profileName: "default",
      lockPath: "/tmp/default.lock",
      ownerPid: 100,
      ownerRunId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    expect(releaseProfileLock(lock, { ownerPid: 999, ownerRunId: "run-x" })).toBe(false);
    expect(releaseProfileLock(lock, { ownerPid: 100, ownerRunId: "run-1" })).toBe(true);
  });
});
