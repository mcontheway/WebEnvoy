import type { FingerprintRuntimeContext } from "../shared/fingerprint-profile.js";

export type RuntimeBootstrapStatus = "pending" | "ready" | "stale" | "failed";

export interface RuntimeBootstrapState {
  version: string;
  runId: string;
  runtimeContextId: string;
  profile: string;
  sessionId: string;
  status: RuntimeBootstrapStatus;
  serializedFingerprintRuntime: string;
  updatedAt: string;
}

export interface TrustedFingerprintContextEntry {
  sessionId: string;
  runId: string | null;
  runtimeContextId: string | null;
  fingerprintRuntime: FingerprintRuntimeContext;
  serializedFingerprintRuntime: string;
  sourceTabId: number | null;
  sourceDomain: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const buildTrustedFingerprintContextKey = (
  profile: string,
  sessionId: string
): string => `${profile}::${sessionId}`;

export const serializeFingerprintRuntimeContext = (
  fingerprintRuntime: FingerprintRuntimeContext
): string => {
  const record = { ...(fingerprintRuntime as unknown as Record<string, unknown>) };
  delete record.injection;
  return JSON.stringify(record);
};

export const hasInstalledFingerprintInjection = (
  fingerprintRuntime: FingerprintRuntimeContext | null
): boolean => {
  if (!fingerprintRuntime) {
    return false;
  }
  const injection = asRecord((fingerprintRuntime as unknown as Record<string, unknown>).injection);
  return (
    injection?.installed === true &&
    asStringArray(injection.missing_required_patches).length === 0
  );
};

export const isFingerprintRuntimeContextEquivalent = (
  left: FingerprintRuntimeContext,
  right: FingerprintRuntimeContext
): boolean => serializeFingerprintRuntimeContext(left) === serializeFingerprintRuntimeContext(right);

export class BackgroundRuntimeTrustState {
  #trustedFingerprintContexts = new Map<string, TrustedFingerprintContextEntry>();
  #runtimeBootstrapStates = new Map<string, RuntimeBootstrapState>();

  constructor(private readonly maxTrustedContexts: number) {}

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
    return (
      this.#trustedFingerprintContexts.get(buildTrustedFingerprintContextKey(profile, sessionId)) ??
      null
    );
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
    const serializedFingerprintRuntime = serializeFingerprintRuntimeContext(normalized);
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
    if (this.#trustedFingerprintContexts.size <= this.maxTrustedContexts) {
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
