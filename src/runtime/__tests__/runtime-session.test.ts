import { describe, expect, it } from "vitest";

import {
  applyProfileProxyBinding,
  beginLoginSession,
  beginStartSession,
  beginStopSession,
  buildRuntimeSession,
  markSessionDisconnected,
  markSessionReady,
  markSessionStopped
} from "../runtime-session.js";

describe("runtime-session", () => {
  it("starts from uninitialized and assigns owner", () => {
    const initial = buildRuntimeSession("default", null);
    const starting = beginStartSession(initial, {
      runId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    expect(starting.profileState).toBe("starting");
    expect(starting.ownerRunId).toBe("run-1");
  });

  it("prevents conflicting owner from starting same profile", () => {
    const initial = buildRuntimeSession("default", null);
    const starting = beginStartSession(initial, {
      runId: "run-1",
      nowIso: "2026-03-19T10:00:00.000Z"
    });

    expect(() =>
      beginStartSession(starting, {
        runId: "run-2",
        nowIso: "2026-03-19T10:00:01.000Z"
      })
    ).toThrow(/profile lock conflict/i);
  });

  it("supports login transition from ready", () => {
    const initial = markSessionReady(
      beginStartSession(buildRuntimeSession("default", null), {
        runId: "run-1",
        nowIso: "2026-03-19T10:00:00.000Z"
      })
    );

    const loggingIn = beginLoginSession(initial, {
      runId: "run-1",
      nowIso: "2026-03-19T10:01:00.000Z"
    });
    expect(loggingIn.profileState).toBe("logging_in");
  });

  it("supports stop transition and clears owner when stopped", () => {
    const ready = markSessionReady(
      beginStartSession(buildRuntimeSession("default", null), {
        runId: "run-1",
        nowIso: "2026-03-19T10:00:00.000Z"
      })
    );

    const stopping = beginStopSession(ready, {
      runId: "run-1",
      nowIso: "2026-03-19T10:02:00.000Z"
    });
    const stopped = markSessionStopped(stopping);

    expect(stopping.profileState).toBe("stopping");
    expect(stopped.profileState).toBe("stopped");
    expect(stopped.ownerRunId).toBeNull();
  });

  it("marks disconnected from active session", () => {
    const ready = markSessionReady(
      beginStartSession(buildRuntimeSession("default", null), {
        runId: "run-1",
        nowIso: "2026-03-19T10:00:00.000Z"
      })
    );

    const disconnected = markSessionDisconnected(ready);
    expect(disconnected.profileState).toBe("disconnected");
  });

  it("rejects conflicting proxy override", () => {
    const ready = markSessionReady(
      applyProfileProxyBinding(
        beginStartSession(buildRuntimeSession("default", null), {
          runId: "run-1",
          nowIso: "2026-03-19T10:00:00.000Z"
        }),
        {
          requested: "http://127.0.0.1:8080",
          nowIso: "2026-03-19T10:00:00.000Z",
          source: "runtime.start"
        }
      )
    );

    expect(() =>
      applyProfileProxyBinding(ready, {
        requested: "http://127.0.0.1:9090",
        nowIso: "2026-03-19T10:01:00.000Z",
        source: "runtime.start"
      })
    ).toThrow(/proxy binding conflict/i);
  });
});
