const TRANSITIONS = {
    uninitialized: ["starting", "logging_in"],
    starting: ["ready"],
    ready: ["logging_in", "disconnected", "stopping"],
    logging_in: ["ready", "disconnected", "stopping"],
    disconnected: ["starting", "logging_in"],
    stopping: ["stopped"],
    stopped: ["starting", "logging_in"]
};
export const canTransitionState = (from, to) => TRANSITIONS[from].includes(to);
export const transitionState = (from, to) => {
    if (!canTransitionState(from, to)) {
        throw new Error(`Invalid profile state transition: ${from} -> ${to}`);
    }
    return to;
};
