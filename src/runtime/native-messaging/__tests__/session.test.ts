import { describe, expect, it } from "vitest";

import {
  MAX_PENDING_DURING_RECOVERY,
  NativeMessagingSession,
  RECOVERY_WINDOW_MS,
  classifyTransportFailure
} from "../session.js";

describe("native messaging session", () => {
  it("transitions from idle to ready through handshake", () => {
    const session = new NativeMessagingSession();

    session.beginHandshake();
    session.markReady("nm-session-001");

    expect(session.snapshot()).toMatchObject({
      state: "ready",
      sessionId: "nm-session-001"
    });
  });

  it("fails forward transition when not ready", () => {
    const session = new NativeMessagingSession();
    expect(() => session.beginForward()).toThrowError(/not ready/i);
  });

  it("marks disconnected and supports limited queue during recovery window", () => {
    const now = 1_000;
    const session = new NativeMessagingSession();
    session.beginHandshake();
    session.markReady("nm-session-001");
    session.observeDisconnect("onDisconnect", now);

    expect(session.snapshot().state).toBe("disconnected");
    for (let i = 0; i < MAX_PENDING_DURING_RECOVERY; i += 1) {
      expect(session.tryQueuePending(now + 100)).toBe(true);
    }
    expect(session.tryQueuePending(now + 100)).toBe(false);
  });

  it("stops queueing when recovery window expires", () => {
    const now = 1_000;
    const session = new NativeMessagingSession();
    session.beginHandshake();
    session.markReady("nm-session-001");
    session.observeDisconnect("heartbeat_timeout", now);

    expect(session.tryQueuePending(now + RECOVERY_WINDOW_MS + 1)).toBe(false);
  });

  it("prioritizes disconnected over timeout classification", () => {
    expect(
      classifyTransportFailure({
        disconnectedObserved: true,
        timeoutElapsed: true
      })
    ).toBe("ERR_TRANSPORT_DISCONNECTED");
  });
});
