import { SQLiteRuntimeStore, resolveRuntimeStorePath } from "./sqlite-runtime-store.js";
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
    constructor(cwd) {
        this.#store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    }
    close() {
        this.#store.close();
    }
    async recordStart(context) {
        try {
            await this.#store.upsertRun({
                runId: context.run_id,
                sessionId: null,
                profileName: context.profile ?? "anonymous",
                command: context.command,
                status: "running",
                startedAt: new Date().toISOString(),
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
        catch {
            // Best effort in first implementation slice; should not affect CLI response contract.
        }
    }
    async recordSuccess(context, summary) {
        try {
            await this.#store.upsertRun({
                runId: context.run_id,
                sessionId: resolveSessionId(summary),
                profileName: context.profile ?? "anonymous",
                command: context.command,
                status: "succeeded",
                startedAt: new Date().toISOString(),
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
        catch {
            // Best effort in first implementation slice; should not affect CLI response contract.
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
                startedAt: new Date().toISOString(),
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
        catch {
            // Best effort in first implementation slice; should not affect CLI response contract.
        }
    }
}
export const createRuntimeStoreRecorder = (cwd) => {
    try {
        return new RuntimeStoreRecorder(cwd);
    }
    catch {
        return null;
    }
};
