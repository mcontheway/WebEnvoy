import { RuntimeStoreError, SQLiteRuntimeStore, resolveRuntimeStorePath } from "./sqlite-runtime-store.js";
const resolveSessionId = (summary) => {
    const directSession = summary.sessionId;
    if (typeof directSession === "string" && directSession.length > 0) {
        return directSession;
    }
    const directSnake = summary.session_id;
    if (typeof directSnake === "string" && directSnake.length > 0) {
        return directSnake;
    }
    const transport = summary.transport;
    if (transport && typeof transport === "object" && !Array.isArray(transport)) {
        const nested = transport.session_id;
        if (typeof nested === "string" && nested.length > 0) {
            return nested;
        }
    }
    return null;
};
const toSummaryText = (summary) => JSON.stringify(summary);
const buildEvent = (context, input) => ({
    runId: context.run_id,
    eventTime: new Date().toISOString(),
    ...input
});
export class RuntimeStoreRecorder {
    #store;
    #startedAtByRunId = new Map();
    constructor(cwd, store) {
        this.#store = store ?? new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    }
    close() {
        this.#store.close();
    }
    #ensureStartedAt(runId) {
        const existing = this.#startedAtByRunId.get(runId);
        if (existing) {
            return existing;
        }
        const startedAt = new Date().toISOString();
        this.#startedAtByRunId.set(runId, startedAt);
        return startedAt;
    }
    async recordStart(context) {
        await this.#store.upsertRun({
            runId: context.run_id,
            sessionId: null,
            profileName: context.profile ?? "anonymous",
            command: context.command,
            status: "running",
            startedAt: this.#ensureStartedAt(context.run_id),
            endedAt: null,
            errorCode: null
        });
        await this.#store.appendRunEvent(buildEvent(context, {
            stage: "boot",
            component: "cli",
            eventType: "started",
            diagnosisCategory: null,
            failurePoint: null,
            summary: "command started"
        }));
    }
    async recordSuccess(context, summary) {
        try {
            await this.#store.upsertRun({
                runId: context.run_id,
                sessionId: resolveSessionId(summary),
                profileName: context.profile ?? "anonymous",
                command: context.command,
                status: "succeeded",
                startedAt: this.#ensureStartedAt(context.run_id),
                endedAt: new Date().toISOString(),
                errorCode: null
            });
            await this.#store.appendRunEvent(buildEvent(context, {
                stage: "command",
                component: "runtime",
                eventType: "succeeded",
                diagnosisCategory: null,
                failurePoint: null,
                summary: toSummaryText(summary)
            }));
        }
        finally {
            this.#startedAtByRunId.delete(context.run_id);
        }
    }
    async recordFailure(context, error) {
        try {
            await this.#store.upsertRun({
                runId: context.run_id,
                sessionId: null,
                profileName: context.profile ?? "anonymous",
                command: context.command,
                status: "failed",
                startedAt: this.#ensureStartedAt(context.run_id),
                endedAt: new Date().toISOString(),
                errorCode: error.code
            });
            await this.#store.appendRunEvent(buildEvent(context, {
                stage: "command",
                component: "runtime",
                eventType: "failed",
                diagnosisCategory: "execution_error",
                failurePoint: context.command,
                summary: `${error.code}: ${error.message}`
            }));
        }
        finally {
            this.#startedAtByRunId.delete(context.run_id);
        }
    }
}
export const createRuntimeStoreRecorder = (cwd) => process.env.WEBENVOY_RUNTIME_STORE_FORCE_UNAVAILABLE === "1"
    ? (() => {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable (forced)");
    })()
    : new RuntimeStoreRecorder(cwd);
