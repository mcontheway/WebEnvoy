const defaultMaxTrustedFingerprintContexts = 64;
const buildTrustedFingerprintContextKey = (profile, sessionId) => `${profile}::${sessionId}`;
export class BackgroundRuntimeTrustState {
    options;
    #trustedFingerprintContexts = new Map();
    #runtimeBootstrapStates = new Map();
    constructor(options) {
        this.options = options;
    }
    clearAll() {
        this.clearTrustedContexts();
        this.clearRuntimeBootstrapStates();
    }
    clearTrustedContexts() {
        if (this.#trustedFingerprintContexts.size === 0) {
            return;
        }
        this.#trustedFingerprintContexts.clear();
    }
    clearRuntimeBootstrapStates() {
        if (this.#runtimeBootstrapStates.size === 0) {
            return;
        }
        this.#runtimeBootstrapStates.clear();
    }
    clearTrustedContextBySession(profile, sessionId) {
        this.#trustedFingerprintContexts.delete(buildTrustedFingerprintContextKey(profile, sessionId));
    }
    clearTrustedContextsByProfile(profile) {
        const profilePrefix = `${profile}::`;
        for (const key of this.#trustedFingerprintContexts.keys()) {
            if (key.startsWith(profilePrefix)) {
                this.#trustedFingerprintContexts.delete(key);
            }
        }
    }
    getBootstrap(profile) {
        return this.#runtimeBootstrapStates.get(profile) ?? null;
    }
    setBootstrap(profile, state) {
        this.#runtimeBootstrapStates.set(profile, state);
    }
    getTrusted(profile, sessionId) {
        return this.#trustedFingerprintContexts.get(buildTrustedFingerprintContextKey(profile, sessionId)) ?? null;
    }
    upsertTrusted(profile, sessionId, normalized, source) {
        const key = buildTrustedFingerprintContextKey(profile, sessionId);
        const serializedFingerprintRuntime = this.options.serializeFingerprintRuntimeContext(normalized);
        const sourceTabId = source?.sourceTabId ?? null;
        const sourceDomain = source?.sourceDomain ?? null;
        const runId = source?.runId ?? null;
        const runtimeContextId = source?.runtimeContextId ?? null;
        const existing = this.#trustedFingerprintContexts.get(key);
        const shouldRotate = !!existing &&
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
        const maxTrustedFingerprintContexts = this.options.maxTrustedFingerprintContexts ?? defaultMaxTrustedFingerprintContexts;
        if (this.#trustedFingerprintContexts.size <= maxTrustedFingerprintContexts) {
            return;
        }
        const oldestKey = this.#trustedFingerprintContexts.keys().next().value;
        if (typeof oldestKey === "string") {
            this.#trustedFingerprintContexts.delete(oldestKey);
        }
    }
    listTrustedByProfile(profile) {
        return Array.from(this.#trustedFingerprintContexts.entries()).filter(([key]) => key.startsWith(`${profile}::`));
    }
}
