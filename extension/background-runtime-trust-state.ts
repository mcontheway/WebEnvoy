import type { FingerprintRuntimeContext } from "../shared/fingerprint-profile.js";

interface TrustedFingerprintContextEntry {
  sessionId: string;
  runId: string | null;
  runtimeContextId: string | null;
  fingerprintRuntime: FingerprintRuntimeContext;
  serializedFingerprintRuntime: string;
  sourceTabId: number | null;
  sourceDomain: string | null;
}

type RuntimeBootstrapStatus = "pending" | "ready" | "stale" | "failed";

interface RuntimeBootstrapState {
  version: string;
  runId: string;
  runtimeContextId: string;
  profile: string;
  sessionId: string;
  status: RuntimeBootstrapStatus;
  serializedFingerprintRuntime: string;
  updatedAt: string;
}

const defaultMaxTrustedFingerprintContexts = 64;

const buildTrustedFingerprintContextKey = (profile: string, sessionId: string): string =>
  `${profile}::${sessionId}`;

export interface BackgroundRuntimeTrustStateOptions {
  maxTrustedFingerprintContexts?: number;
  serializeFingerprintRuntimeContext: (
    fingerprintRuntime: FingerprintRuntimeContext
  ) => string;
}

export class BackgroundRuntimeTrustState {
  #trustedFingerprintContexts = new Map<string, TrustedFingerprintContextEntry>();
  #runtimeBootstrapStates = new Map<string, RuntimeBootstrapState>();

  constructor(private readonly options: BackgroundRuntimeTrustStateOptions) {}

  clearAll(): void {
    this.clearTrustedContexts();
    this.clearRuntimeBootstrapStates();
  }

  clearTrustedContexts(): void {
    if (this.#trustedFingerprintContexts.size === 0) {
      return;
    }
    this.#trustedFingerprintContexts.clear();
  }

  clearRuntimeBootstrapStates(): void {
    if (this.#runtimeBootstrapStates.size === 0) {
      return;
    }
    this.#runtimeBootstrapStates.clear();
  }

  clearTrustedContextBySession(profile: string, sessionId: string): void {
    this.#trustedFingerprintContexts.delete(buildTrustedFingerprintContextKey(profile, sessionId));
  }

  clearTrustedContextsByProfile(profile: string): void {
    const profilePrefix = `${profile}::`;
    for (const key of this.#trustedFingerprintContexts.keys()) {
      if (key.startsWith(profilePrefix)) {
        this.#trustedFingerprintContexts.delete(key);
      }
    }
  }

  getBootstrap(profile: string): RuntimeBootstrapState | null {
    return this.#runtimeBootstrapStates.get(profile) ?? null;
  }

  setBootstrap(profile: string, state: RuntimeBootstrapState): void {
    this.#runtimeBootstrapStates.set(profile, state);
  }

  getTrusted(profile: string, sessionId: string): TrustedFingerprintContextEntry | null {
    return this.#trustedFingerprintContexts.get(buildTrustedFingerprintContextKey(profile, sessionId)) ?? null;
  }

  upsertTrusted(
    profile: string,
    sessionId: string,
    normalized: FingerprintRuntimeContext,
    source?: {
      sourceTabId?: number | null;
      sourceDomain?: string | null;
      runId?: string | null;
      runtimeContextId?: string | null;
    }
  ): void {
    const key = buildTrustedFingerprintContextKey(profile, sessionId);
    const serializedFingerprintRuntime =
      this.options.serializeFingerprintRuntimeContext(normalized);
    const sourceTabId = source?.sourceTabId ?? null;
    const sourceDomain = source?.sourceDomain ?? null;
    const runId = source?.runId ?? null;
    const runtimeContextId = source?.runtimeContextId ?? null;
    const existing = this.#trustedFingerprintContexts.get(key);
    const shouldRotate =
      !!existing &&
      (existing.sessionId !== sessionId ||
        existing.runId !== runId ||
        existing.runtimeContextId !== runtimeContextId ||
        existing.serializedFingerprintRuntime !== serializedFingerprintRuntime ||
        existing.sourceTabId !== sourceTabId ||
        existing.sourceDomain !== sourceDomain);
    if (shouldRotate) {
      this.#trustedFingerprintContexts.delete(key);
    }
    this.#trustedFingerprintContexts.set(key, {
      sessionId,
      runId,
      runtimeContextId,
      fingerprintRuntime: normalized,
      serializedFingerprintRuntime,
      sourceTabId,
      sourceDomain
    });
    const maxTrustedFingerprintContexts =
      this.options.maxTrustedFingerprintContexts ?? defaultMaxTrustedFingerprintContexts;
    if (this.#trustedFingerprintContexts.size <= maxTrustedFingerprintContexts) {
      return;
    }
    const oldestKey = this.#trustedFingerprintContexts.keys().next().value;
    if (typeof oldestKey === "string") {
      this.#trustedFingerprintContexts.delete(oldestKey);
    }
  }

  listTrustedByProfile(profile: string): Array<[string, TrustedFingerprintContextEntry]> {
    return Array.from(this.#trustedFingerprintContexts.entries()).filter(([key]) =>
      key.startsWith(`${profile}::`)
    );
  }
}
