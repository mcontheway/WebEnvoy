import type { ProfileMeta } from "./profile-store.js";
import { transitionState, type ProfileState } from "./profile-state.js";
import {
  resolveProxyBinding,
  type ProxyBinding,
  type ProxyBindingSource
} from "./proxy-binding.js";

export interface RuntimeSession {
  profileName: string;
  profileState: ProfileState;
  proxyBinding: ProxyBinding | null;
  ownerRunId: string | null;
  updatedAt: string | null;
}

interface SessionActionInput {
  runId: string;
  nowIso: string;
}

interface ProxyActionInput {
  requested: string | null | undefined;
  nowIso: string;
  source: ProxyBindingSource;
}

const ensureExclusiveOwner = (session: RuntimeSession, runId: string): void => {
  if (session.ownerRunId !== null && session.ownerRunId !== runId) {
    throw new Error("Profile lock conflict");
  }
};

const applyState = (session: RuntimeSession, nextState: ProfileState, nowIso: string): RuntimeSession => {
  const state = session.profileState === nextState ? nextState : transitionState(session.profileState, nextState);
  return {
    ...session,
    profileState: state,
    updatedAt: nowIso
  };
};

export const buildRuntimeSession = (
  profileName: string,
  meta: Pick<ProfileMeta, "profileState" | "proxyBinding" | "updatedAt"> | null
): RuntimeSession => ({
  profileName,
  profileState: meta?.profileState ?? "uninitialized",
  proxyBinding: meta?.proxyBinding ?? null,
  ownerRunId: null,
  updatedAt: meta?.updatedAt ?? null
});

export const beginStartSession = (
  session: RuntimeSession,
  input: SessionActionInput
): RuntimeSession => {
  ensureExclusiveOwner(session, input.runId);
  return {
    ...applyState(session, "starting", input.nowIso),
    ownerRunId: input.runId
  };
};

export const beginLoginSession = (
  session: RuntimeSession,
  input: SessionActionInput
): RuntimeSession => {
  ensureExclusiveOwner(session, input.runId);
  return {
    ...applyState(session, "logging_in", input.nowIso),
    ownerRunId: input.runId
  };
};

export const markSessionReady = (session: RuntimeSession): RuntimeSession =>
  applyState(session, "ready", session.updatedAt ?? new Date().toISOString());

export const markSessionDisconnected = (session: RuntimeSession): RuntimeSession =>
  applyState(session, "disconnected", session.updatedAt ?? new Date().toISOString());

export const beginStopSession = (
  session: RuntimeSession,
  input: SessionActionInput
): RuntimeSession => {
  ensureExclusiveOwner(session, input.runId);
  return {
    ...applyState(session, "stopping", input.nowIso),
    ownerRunId: input.runId
  };
};

export const markSessionStopped = (session: RuntimeSession): RuntimeSession => ({
  ...applyState(session, "stopped", session.updatedAt ?? new Date().toISOString()),
  ownerRunId: null
});

export const applyProfileProxyBinding = (
  session: RuntimeSession,
  input: ProxyActionInput
): RuntimeSession => {
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
