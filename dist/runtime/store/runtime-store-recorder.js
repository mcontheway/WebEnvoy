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
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asBoolean = (value) => value === true;
const buildEvent = (context, input) => ({
    runId: context.run_id,
    eventTime: new Date().toISOString(),
    ...input
});
const extractGateApprovalInput = (source) => {
    const approvalRecord = asObject(source.approval_record);
    if (!approvalRecord) {
        return null;
    }
    const runId = asString(source.run_id) ??
        asString((asObject(source.audit_record) ?? {}).run_id) ??
        asString((asObject(source.gate_input) ?? {}).run_id);
    if (!runId) {
        return null;
    }
    const checksObject = asObject(approvalRecord.checks) ?? {};
    return {
        runId,
        approved: asBoolean(approvalRecord.approved),
        approver: asString(approvalRecord.approver),
        approvedAt: asString(approvalRecord.approved_at),
        checks: Object.fromEntries(Object.entries(checksObject).map(([key, value]) => [key, asBoolean(value)]))
    };
};
const extractGateAuditRecordInput = (source) => {
    const auditRecord = asObject(source.audit_record);
    const transitionAudit = asObject(source.risk_transition_audit);
    if (!auditRecord) {
        return null;
    }
    const runId = asString(auditRecord.run_id);
    const sessionId = asString(auditRecord.session_id);
    const profile = asString(auditRecord.profile);
    const eventId = asString(auditRecord.event_id);
    const riskState = asString(auditRecord.risk_state);
    const nextState = asString(auditRecord.next_state) ?? asString(transitionAudit?.next_state) ?? riskState;
    const transitionTrigger = asString(auditRecord.transition_trigger) ??
        asString(transitionAudit?.trigger) ??
        "gate_evaluation";
    const targetDomain = asString(auditRecord.target_domain);
    const targetTabId = asInteger(auditRecord.target_tab_id);
    const targetPage = asString(auditRecord.target_page);
    const actionType = asString(auditRecord.action_type);
    const requestedExecutionMode = asString(auditRecord.requested_execution_mode);
    const effectiveExecutionMode = asString(auditRecord.effective_execution_mode);
    const gateDecision = asString(auditRecord.gate_decision);
    const recordedAt = asString(auditRecord.recorded_at);
    const gateReasons = Array.isArray(auditRecord.gate_reasons)
        ? auditRecord.gate_reasons.filter((item) => typeof item === "string" && item.trim().length > 0)
        : [];
    if (!runId ||
        !sessionId ||
        !profile ||
        !eventId ||
        !riskState ||
        !nextState ||
        !transitionTrigger ||
        !targetDomain ||
        targetTabId === null ||
        !targetPage ||
        !actionType ||
        !requestedExecutionMode ||
        !effectiveExecutionMode ||
        !gateDecision ||
        !recordedAt ||
        gateReasons.length === 0) {
        return null;
    }
    return {
        eventId,
        runId,
        sessionId,
        profile,
        riskState,
        nextState,
        transitionTrigger,
        targetDomain,
        targetTabId,
        targetPage,
        actionType,
        requestedExecutionMode,
        effectiveExecutionMode,
        gateDecision,
        gateReasons,
        approver: asString(auditRecord.approver),
        approvedAt: asString(auditRecord.approved_at),
        recordedAt
    };
};
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
    async #recordGateArtifacts(source) {
        const approvalInput = extractGateApprovalInput(source);
        if (approvalInput && this.#store.upsertGateApproval) {
            await this.#store.upsertGateApproval(approvalInput);
        }
        const auditInput = extractGateAuditRecordInput(source);
        if (auditInput && this.#store.appendGateAuditRecord) {
            await this.#store.appendGateAuditRecord(auditInput);
        }
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
            await this.#recordGateArtifacts(summary);
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
            if (error.details) {
                await this.#recordGateArtifacts(error.details);
            }
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
