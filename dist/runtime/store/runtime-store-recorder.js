import { diagnosisFromCliError } from "../cli-diagnosis.js";
import { buildDiagnosis } from "../diagnostics.js";
import { ProfileStore } from "../profile-store.js";
import { toSessionRhythmStatusView } from "../xhs-closeout-rhythm.js";
import { resolveRuntimeProfileRoot } from "../worktree-root.js";
import { APPROVAL_CHECK_KEYS, getWriteActionMatrixDecisions } from "../../../shared/risk-state.js";
import { RuntimeStoreError, SQLiteRuntimeStore, resolveRuntimeStorePath, sanitizeRuntimeEventSummary } from "./sqlite-runtime-store.js";
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
const toSessionRhythmIdPart = (value) => value.replace(/[^A-Za-z0-9._-]+/gu, "_");
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asBoolean = (value) => value === true;
const REQUIRED_APPROVAL_CHECK_KEYS = APPROVAL_CHECK_KEYS;
const hasRealApprovalRecord = (approvalRecord) => {
    if (!approvalRecord || !asBoolean(approvalRecord.approved)) {
        return false;
    }
    if (!asString(approvalRecord.approver) || !asString(approvalRecord.approved_at)) {
        return false;
    }
    const checksObject = asObject(approvalRecord.checks);
    return REQUIRED_APPROVAL_CHECK_KEYS.every((key) => checksObject?.[key] === true);
};
const LIVE_EXECUTION_MODES = new Set(["live_read_limited", "live_read_high_risk", "live_write"]);
const requiresApprovalIdForAudit = (input) => input.gateDecision === "allowed" &&
    (LIVE_EXECUTION_MODES.has(input.requestedExecutionMode) ||
        LIVE_EXECUTION_MODES.has(input.effectiveExecutionMode));
const buildEvent = (context, input) => ({
    runId: context.run_id,
    eventTime: new Date().toISOString(),
    ...input
});
const buildSummaryProjection = (summary) => sanitizeRuntimeEventSummary(summary);
const buildFailureEventProjection = (context, error) => {
    const diagnosis = error.diagnosis
        ? buildDiagnosis(error.diagnosis)
        : error.observability?.failure_site
            ? buildDiagnosis({
                failure_site: error.observability.failure_site
            })
            : buildDiagnosis(diagnosisFromCliError(error));
    const failureSite = diagnosis?.failure_site ?? null;
    const evidenceSummary = diagnosis?.evidence.find((item) => typeof item === "string" && item.trim().length > 0) ?? null;
    const summaryText = (failureSite?.summary && failureSite.summary !== "diagnosis unavailable"
        ? failureSite.summary
        : null) ??
        evidenceSummary ??
        `${error.code}: ${error.message}`;
    return {
        stage: failureSite?.stage ?? "command",
        component: failureSite?.component ?? "runtime",
        eventType: "failed",
        diagnosisCategory: diagnosis?.category ?? "unknown",
        failurePoint: failureSite?.target ?? context.command,
        ...(() => {
            const projection = buildSummaryProjection(summaryText);
            return {
                ...projection,
                summaryTruncated: projection.summaryTruncated || failureSite?.summary_truncated === true
            };
        })()
    };
};
const extractGateApprovalInput = (source) => {
    const approvalRecord = asObject(source.approval_record);
    if (!approvalRecord || !hasRealApprovalRecord(approvalRecord)) {
        return null;
    }
    const runId = asString(source.run_id) ??
        asString((asObject(source.audit_record) ?? {}).run_id) ??
        asString((asObject(source.gate_input) ?? {}).run_id);
    if (!runId) {
        return null;
    }
    const approvalDecisionId = asString(approvalRecord.decision_id);
    const currentDecisionId = asString((asObject(source.gate_outcome) ?? {}).decision_id) ??
        asString((asObject(source.audit_record) ?? {}).decision_id) ??
        `gate_decision_${runId}`;
    if (!approvalDecisionId || approvalDecisionId !== currentDecisionId) {
        return null;
    }
    const decisionId = approvalDecisionId;
    const approvalId = asString(approvalRecord.approval_id);
    if (!approvalId) {
        return null;
    }
    return {
        approvalId,
        runId,
        decisionId,
        approved: asBoolean(approvalRecord.approved),
        approver: asString(approvalRecord.approver),
        approvedAt: asString(approvalRecord.approved_at),
        checks: Object.fromEntries(REQUIRED_APPROVAL_CHECK_KEYS.map((key) => [
            key,
            asBoolean((asObject(approvalRecord.checks) ?? {})[key])
        ]))
    };
};
const extractGateAuditRecordInput = (source) => {
    const auditRecord = asObject(source.audit_record);
    const transitionAudit = asObject(source.risk_transition_audit);
    const gateInput = asObject(source.gate_input);
    const consumerGateResult = asObject(source.consumer_gate_result);
    const providedWriteActionDecisions = asObject(source.write_action_matrix_decisions);
    if (!auditRecord) {
        return null;
    }
    const derivedIssueScope = asString(auditRecord.issue_scope) ??
        asString(gateInput?.issue_scope) ??
        asString(transitionAudit?.issue_scope);
    const derivedActionType = asString(auditRecord.action_type) ??
        asString(consumerGateResult?.action_type) ??
        asString(gateInput?.action_type) ??
        asString(providedWriteActionDecisions?.action_type);
    const derivedRequestedExecutionMode = asString(auditRecord.requested_execution_mode) ??
        asString(consumerGateResult?.requested_execution_mode) ??
        asString(gateInput?.requested_execution_mode) ??
        asString(providedWriteActionDecisions?.requested_execution_mode);
    const derivedWriteActionDecisions = derivedIssueScope && derivedActionType && derivedRequestedExecutionMode
        ? getWriteActionMatrixDecisions(derivedIssueScope, derivedActionType, derivedRequestedExecutionMode)
        : null;
    const runId = asString(auditRecord.run_id) ?? asString(gateInput?.run_id) ?? asString(source.run_id);
    const sessionId = asString(auditRecord.session_id) ??
        asString(gateInput?.session_id) ??
        asString(source.session_id);
    const profile = asString(auditRecord.profile) ?? asString(gateInput?.profile) ?? asString(source.profile);
    const eventId = asString(auditRecord.event_id);
    const riskState = asString(auditRecord.risk_state) ?? asString(gateInput?.risk_state);
    const issueScope = asString(auditRecord.issue_scope) ??
        asString(gateInput?.issue_scope) ??
        asString(transitionAudit?.issue_scope) ??
        asString(consumerGateResult?.issue_scope) ??
        asString(providedWriteActionDecisions?.issue_scope);
    const nextState = asString(auditRecord.next_state) ?? asString(transitionAudit?.next_state) ?? riskState;
    const transitionTrigger = asString(auditRecord.transition_trigger) ??
        asString(transitionAudit?.trigger) ??
        "gate_evaluation";
    const targetDomain = asString(auditRecord.target_domain);
    const targetTabId = asInteger(auditRecord.target_tab_id);
    const targetPage = asString(auditRecord.target_page);
    const actionType = asString(auditRecord.action_type) ??
        asString(consumerGateResult?.action_type) ??
        asString(gateInput?.action_type) ??
        asString(providedWriteActionDecisions?.action_type);
    const requestedExecutionMode = asString(auditRecord.requested_execution_mode) ??
        asString(consumerGateResult?.requested_execution_mode) ??
        asString(gateInput?.requested_execution_mode) ??
        asString(providedWriteActionDecisions?.requested_execution_mode) ??
        asString(derivedWriteActionDecisions?.requested_execution_mode);
    const effectiveExecutionMode = asString(auditRecord.effective_execution_mode) ??
        asString(consumerGateResult?.effective_execution_mode) ??
        requestedExecutionMode;
    const gateDecision = asString(auditRecord.gate_decision) ??
        asString(consumerGateResult?.gate_decision) ??
        asString(asObject(source.gate_outcome)?.gate_decision);
    const decisionId = asString(auditRecord.decision_id) ??
        asString(asObject(source.gate_outcome)?.decision_id) ??
        asString((asObject(source.approval_record) ?? {}).decision_id) ??
        (runId ? `gate_decision_${runId}` : null);
    const sourceApprovalRecord = asObject(source.approval_record);
    const hasRealApprovalEvidence = hasRealApprovalRecord(sourceApprovalRecord);
    const approvalId = hasRealApprovalEvidence
        ? (asString(auditRecord.approval_id) ??
            asString(sourceApprovalRecord?.approval_id) ??
            null)
        : null;
    const recordedAt = asString(auditRecord.recorded_at);
    const gateReasons = Array.isArray(auditRecord.gate_reasons)
        ? auditRecord.gate_reasons.filter((item) => typeof item === "string" && item.trim().length > 0)
        : Array.isArray(consumerGateResult?.gate_reasons)
            ? consumerGateResult.gate_reasons.filter((item) => typeof item === "string" && item.trim().length > 0)
            : [];
    if (!runId ||
        !decisionId ||
        !sessionId ||
        !profile ||
        !issueScope ||
        !eventId ||
        !riskState ||
        !nextState ||
        !transitionTrigger ||
        !targetDomain ||
        targetTabId === null ||
        !targetPage ||
        !requestedExecutionMode ||
        !effectiveExecutionMode ||
        !gateDecision ||
        !recordedAt ||
        gateReasons.length === 0) {
        return null;
    }
    return {
        eventId,
        decisionId,
        approvalId,
        runId,
        sessionId,
        profile,
        issueScope,
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
const hasSessionRhythmCompatibilityRefs = (summary) => {
    const compatibilityRefs = asObject(asObject(summary.execution_audit)?.compatibility_refs);
    return (asString(compatibilityRefs?.session_rhythm_window_id) !== null ||
        asString(compatibilityRefs?.session_rhythm_decision_id) !== null);
};
export class RuntimeStoreRecorder {
    #store;
    #cwd;
    #startedAtByRunId = new Map();
    constructor(cwd, store) {
        this.#cwd = cwd;
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
        let persistedApprovalId = null;
        let persistedDecisionId = null;
        const approvalInput = extractGateApprovalInput(source);
        if (approvalInput && this.#store.upsertGateApproval) {
            const persistedApproval = asObject(await this.#store.upsertGateApproval(approvalInput));
            persistedApprovalId = asString(persistedApproval?.approval_id);
            persistedDecisionId = asString(persistedApproval?.decision_id);
        }
        const auditInput = extractGateAuditRecordInput(source);
        if (auditInput && this.#store.appendGateAuditRecord) {
            const approvalRequired = requiresApprovalIdForAudit(auditInput);
            if (approvalRequired && !approvalInput) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "approval_record is required for allowed live audit records");
            }
            if (persistedApprovalId) {
                auditInput.approvalId = persistedApprovalId;
            }
            if (persistedDecisionId) {
                auditInput.decisionId = persistedDecisionId;
            }
            if (approvalRequired && !persistedApprovalId) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "persisted approval_id is required for allowed live audit records");
            }
            const persistedAuditRecord = asObject(await this.#store.appendGateAuditRecord(auditInput));
            await this.#recordSessionRhythmArtifacts({
                profile: auditInput.profile,
                issueScope: auditInput.issueScope,
                sessionId: auditInput.sessionId,
                runId: auditInput.runId,
                sourceAuditEventId: auditInput.eventId,
                effectiveExecutionMode: auditInput.effectiveExecutionMode
            }, persistedAuditRecord);
        }
    }
    async #recordSessionRhythmArtifacts(input, persistedAuditRecord) {
        if (!this.#store.recordSessionRhythmStatusView) {
            return;
        }
        const profile = input.profile;
        if (!profile) {
            return;
        }
        if (!input.runId || !input.sessionId) {
            return;
        }
        const profileStore = new ProfileStore(resolveRuntimeProfileRoot(this.#cwd));
        const meta = await profileStore.readMeta(profile, { mode: "readonly" });
        const rhythmReasonCodes = Array.isArray(meta?.xhsCloseoutRhythm?.reasonCodes)
            ? meta.xhsCloseoutRhythm.reasonCodes
            : [];
        if (input.force !== true &&
            !meta?.xhsCloseoutRhythm &&
            meta?.accountSafety?.state !== "account_risk_blocked" &&
            rhythmReasonCodes.length === 0) {
            return;
        }
        const view = toSessionRhythmStatusView({
            profile,
            rhythm: meta?.xhsCloseoutRhythm,
            accountSafety: meta?.accountSafety,
            issueScope: input.issueScope ?? "issue_209",
            sessionId: input.sessionId ?? null,
            sourceRunId: input.runId,
            sourceAuditEventId: asString(persistedAuditRecord?.event_id) ?? input.sourceAuditEventId ?? null,
            effectiveExecutionMode: input.effectiveExecutionMode ?? null
        });
        const windowState = asObject(view.session_rhythm_window_state);
        const event = asObject(view.session_rhythm_event);
        const decision = asObject(view.session_rhythm_decision);
        if (!windowState || !event || !decision) {
            return;
        }
        const liveRunAdmittedAfterDeferredProbe = (input.effectiveExecutionMode === "live_read_limited" ||
            input.effectiveExecutionMode === "live_read_high_risk" ||
            input.effectiveExecutionMode === "live_write") &&
            asString(decision.decision) === "deferred";
        const currentLiveRunKey = toSessionRhythmIdPart(input.runId);
        const currentLiveEventId = `rhythm_evt_${currentLiveRunKey}`;
        const currentLiveDecisionId = `rhythm_decision_${currentLiveRunKey}`;
        await this.#store.recordSessionRhythmStatusView({
            profile,
            platform: "xhs",
            issueScope: input.issueScope ?? "issue_209",
            windowState: liveRunAdmittedAfterDeferredProbe
                ? {
                    ...windowState,
                    session_id: input.sessionId,
                    last_event_id: currentLiveEventId,
                    source_run_id: input.runId
                }
                : windowState,
            event: liveRunAdmittedAfterDeferredProbe
                ? {
                    ...event,
                    event_id: currentLiveEventId,
                    session_id: input.sessionId,
                    source_audit_event_id: asString(persistedAuditRecord?.event_id) ?? input.sourceAuditEventId ?? null,
                    reason: "XHS_CLOSEOUT_LIVE_ADMISSION_ALLOWED"
                }
                : event,
            decision: liveRunAdmittedAfterDeferredProbe
                ? {
                    ...decision,
                    decision_id: currentLiveDecisionId,
                    run_id: input.runId,
                    session_id: input.sessionId,
                    decision: "allowed",
                    reason_codes: ["XHS_CLOSEOUT_LIVE_ADMISSION_ALLOWED"],
                    requires: []
                }
                : decision
        });
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
            ...buildSummaryProjection("command started")
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
                ...buildSummaryProjection(toSummaryText(summary))
            }));
            await this.#recordGateArtifacts(summary);
            if (context.profile &&
                (summary.xhs_closeout_rhythm ||
                    summary.account_safety ||
                    hasSessionRhythmCompatibilityRefs(summary))) {
                await this.#recordSessionRhythmArtifacts({
                    profile: context.profile,
                    issueScope: "issue_209",
                    sessionId: resolveSessionId(summary),
                    runId: context.run_id,
                    sourceAuditEventId: null,
                    effectiveExecutionMode: asString(summary.requested_execution_mode),
                    force: true
                }, null);
            }
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
            await this.#store.appendRunEvent(buildEvent(context, buildFailureEventProjection(context, error)));
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
