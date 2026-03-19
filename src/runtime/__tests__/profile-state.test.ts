import { describe, expect, it } from "vitest";

import {
  canTransitionState,
  transitionState,
  type ProfileState
} from "../profile-state.js";

describe("profile-state", () => {
  it("allows core lifecycle transitions", () => {
    expect(canTransitionState("uninitialized", "starting")).toBe(true);
    expect(canTransitionState("starting", "ready")).toBe(true);
    expect(canTransitionState("ready", "logging_in")).toBe(true);
    expect(canTransitionState("logging_in", "ready")).toBe(true);
    expect(canTransitionState("ready", "disconnected")).toBe(true);
    expect(canTransitionState("ready", "stopping")).toBe(true);
    expect(canTransitionState("stopping", "stopped")).toBe(true);
  });

  it("rejects unsupported transitions", () => {
    expect(canTransitionState("uninitialized", "ready")).toBe(false);
    expect(canTransitionState("stopped", "ready")).toBe(false);
    expect(canTransitionState("disconnected", "ready")).toBe(false);
    expect(canTransitionState("stopping", "ready")).toBe(false);
  });

  it("throws when trying to move into an invalid state", () => {
    expect(() => transitionState("uninitialized", "ready")).toThrow(
      /invalid profile state transition/i
    );
  });

  it("returns next state when transition is valid", () => {
    const next: ProfileState = transitionState("stopped", "starting");
    expect(next).toBe("starting");
  });
});
