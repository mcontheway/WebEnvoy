import { transitionState } from "./profile-state.js";
import { resolveProxyBinding } from "./proxy-binding.js";
const ensureExclusiveOwner = (session, runId) => {
    if (session.ownerRunId !== null && session.ownerRunId !== runId) {
        throw new Error("Profile lock conflict");
    }
};
const applyState = (session, nextState, nowIso) => {
    const state = session.profileState === nextState ? nextState : transitionState(session.profileState, nextState);
    return {
        ...session,
        profileState: state,
        updatedAt: nowIso
    };
};
export const buildRuntimeSession = (profileName, meta) => ({
    profileName,
    profileState: meta?.profileState ?? "uninitialized",
    proxyBinding: meta?.proxyBinding ?? null,
    ownerRunId: null,
    updatedAt: meta?.updatedAt ?? null
});
export const beginStartSession = (session, input) => {
    ensureExclusiveOwner(session, input.runId);
    return {
        ...applyState(session, "starting", input.nowIso),
        ownerRunId: input.runId
    };
};
export const beginLoginSession = (session, input) => {
    ensureExclusiveOwner(session, input.runId);
    return {
        ...applyState(session, "logging_in", input.nowIso),
        ownerRunId: input.runId
    };
};
export const markSessionReady = (session) => applyState(session, "ready", session.updatedAt ?? new Date().toISOString());
export const markSessionDisconnected = (session) => applyState(session, "disconnected", session.updatedAt ?? new Date().toISOString());
export const beginStopSession = (session, input) => {
    ensureExclusiveOwner(session, input.runId);
    return {
        ...applyState(session, "stopping", input.nowIso),
        ownerRunId: input.runId
    };
};
export const markSessionStopped = (session) => ({
    ...applyState(session, "stopped", session.updatedAt ?? new Date().toISOString()),
    ownerRunId: null
});
export const applyProfileProxyBinding = (session, input) => {
    const result = resolveProxyBinding({
        current: session.proxyBinding,
        requested: input.requested,
        nowIso: input.nowIso,
        source: input.source
    });
    if (result.conflict) {
        throw new Error("Proxy binding conflict");
    }
    return {
        ...session,
        proxyBinding: result.binding,
        updatedAt: result.changed ? input.nowIso : session.updatedAt
    };
};
