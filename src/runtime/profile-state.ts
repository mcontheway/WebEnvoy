export type ProfileState =
  | "uninitialized"
  | "starting"
  | "ready"
  | "logging_in"
  | "disconnected"
  | "stopping"
  | "stopped";

const TRANSITIONS: Record<ProfileState, readonly ProfileState[]> = {
  uninitialized: ["starting", "logging_in"],
  starting: ["ready"],
  ready: ["logging_in", "disconnected", "stopping"],
  logging_in: ["ready", "disconnected", "stopping"],
  disconnected: ["starting", "logging_in"],
  stopping: ["stopped"],
  stopped: ["starting", "logging_in"]
};

export const canTransitionState = (from: ProfileState, to: ProfileState): boolean =>
  TRANSITIONS[from].includes(to);

export const transitionState = (from: ProfileState, to: ProfileState): ProfileState => {
  if (!canTransitionState(from, to)) {
    throw new Error(`Invalid profile state transition: ${from} -> ${to}`);
  }

  return to;
};
