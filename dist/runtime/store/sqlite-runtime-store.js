import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { initializeRuntimeStoreSchema } from "./sqlite-runtime-store-schema.js";
import { mapAntiDetectionBaselineRegistryEntryRow, mapAntiDetectionBaselineSnapshotRow, mapAntiDetectionStructuredSampleRow, mapAntiDetectionValidationRecordRow, mapAntiDetectionValidationRequestRow, mapAntiDetectionValidationViewRow, mapGateApprovalRecordRow, mapGateAuditRecordRow } from "./sqlite-runtime-store-helpers.js";
import { assertAntiDetectionValidationScopeKeyInput, assertAppendRunEventInput, assertInsertAntiDetectionBaselineSnapshotInput, assertInsertAntiDetectionStructuredSampleInput, assertInsertAntiDetectionValidationRecordInput, assertGateApprovalInput, assertGateAuditRecordInput, assertListGateAuditInput, assertUpsertAntiDetectionBaselineRegistryEntryInput, assertUpsertAntiDetectionValidationRequestInput, assertUpsertRunInput } from "./sqlite-runtime-store-validation.js";
const LIVE_APPROVAL_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const isAllowedLiveAuditRecord = (record) => record.gate_decision === "allowed" &&
    LIVE_APPROVAL_EXECUTION_MODES.has(record.effective_execution_mode);
export class RuntimeStoreError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "RuntimeStoreError";
        this.code = code;
    }
}
const SUMMARY_MAX_CHARS = 512;
const SQLITE_BUSY_MESSAGE = /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i;
const SQLITE_OPEN_MAX_ATTEMPTS = 8;
const SQLITE_OPEN_RETRY_MS = 50;
const SQLITE_OPEN_BUSY_TIMEOUT_MS = 250;
const SQLITE_RUNTIME_BUSY_TIMEOUT_MS = 2000;
let databaseSyncCtorCache;
export const sanitizeRuntimeEventSummary = (summary) => {
    if (summary === null) {
        return {
            summary: null,
            summaryTruncated: false
        };
    }
    const redacted = summary
        .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/(cookie\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
    if (redacted.length <= SUMMARY_MAX_CHARS) {
        return {
            summary: redacted,
            summaryTruncated: false
        };
    }
    return {
        summary: `${redacted.slice(0, SUMMARY_MAX_CHARS)} [TRUNCATED]`,
        summaryTruncated: true
    };
};
const isIsoLike = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
const isSqliteBusyError = (error) => {
    if (!(error instanceof Error)) {
        return false;
    }
    const sqliteFields = [
        error.name,
        error.message,
        error.code,
        error.cause instanceof Error
            ? error.cause?.message
            : null
    ];
    return sqliteFields.some((value) => typeof value === "string" && SQLITE_BUSY_MESSAGE.test(value));
};
const sleepSync = (ms) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};
const invalidRuntimeStoreInput = (message) => {
    throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", message);
};
const REQUEST_STATE_TRANSITIONS = {
    accepted: ["accepted", "sampling", "completed", "aborted"],
    sampling: ["sampling", "completed", "aborted"],
    completed: ["completed"],
    aborted: ["aborted"]
};
const antiDetectionScopeMatches = (actual, expected) => actual.target_fr_ref === expected.targetFrRef &&
    actual.validation_scope === expected.validationScope &&
    actual.profile_ref === expected.profileRef &&
    actual.browser_channel === expected.browserChannel &&
    actual.execution_surface === expected.executionSurface &&
    (actual.effective_execution_mode ?? actual.requested_execution_mode) ===
        expected.effectiveExecutionMode &&
    actual.probe_bundle_ref === expected.probeBundleRef;
export const resolveRuntimeStorePath = (cwd) => path.join(cwd, ".webenvoy", "runtime", "store.sqlite");
const resolveDatabaseSyncConstructor = () => {
    if (databaseSyncCtorCache === null) {
        throw new Error("node:sqlite unavailable");
    }
    if (databaseSyncCtorCache) {
        return databaseSyncCtorCache;
    }
    const require = createRequire(import.meta.url);
    const sqliteModule = require("node:sqlite");
    if (typeof sqliteModule.DatabaseSync !== "function") {
        databaseSyncCtorCache = null;
        throw new Error("node:sqlite DatabaseSync unavailable");
    }
    databaseSyncCtorCache = sqliteModule.DatabaseSync;
    return databaseSyncCtorCache;
};
export class SQLiteRuntimeStore {
    #db;
    constructor(dbPath) {
        let lastError;
        try {
            mkdirSync(path.dirname(dbPath), { recursive: true });
            const DatabaseSyncCtor = resolveDatabaseSyncConstructor();
            for (let attempt = 0; attempt < SQLITE_OPEN_MAX_ATTEMPTS; attempt += 1) {
                try {
                    this.#db = new DatabaseSyncCtor(dbPath);
                    this.#db.exec(`PRAGMA busy_timeout=${SQLITE_OPEN_BUSY_TIMEOUT_MS};`);
                    this.#initialize();
                    this.#db.exec(`PRAGMA busy_timeout=${SQLITE_RUNTIME_BUSY_TIMEOUT_MS};`);
                    return;
                }
                catch (error) {
                    try {
                        this.#db?.close();
                    }
                    catch {
                        // Ignore cleanup failure after constructor initialization fails.
                    }
                    if (error instanceof RuntimeStoreError &&
                        error.code === "ERR_RUNTIME_STORE_SCHEMA_MISMATCH") {
                        throw error;
                    }
                    lastError = error;
                    if (isSqliteBusyError(error) && attempt < SQLITE_OPEN_MAX_ATTEMPTS - 1) {
                        sleepSync(SQLITE_OPEN_RETRY_MS);
                        continue;
                    }
                    break;
                }
            }
        }
        catch (error) {
            lastError = error;
        }
        if (lastError instanceof RuntimeStoreError) {
            throw lastError;
        }
        if (isSqliteBusyError(lastError)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_CONFLICT", "runtime store write conflict", {
                cause: lastError
            });
        }
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
            cause: lastError
        });
    }
    #initialize() {
        initializeRuntimeStoreSchema({
            db: this.#db,
            onSchemaMismatch: (version) => new RuntimeStoreError("ERR_RUNTIME_STORE_SCHEMA_MISMATCH", `schema mismatch: ${version ?? "unknown"}`)
        });
    }
    close() {
        this.#db.close();
    }
    #toStoreDbError(error) {
        if (error instanceof RuntimeStoreError) {
            return error;
        }
        if (isSqliteBusyError(error)) {
            return new RuntimeStoreError("ERR_RUNTIME_STORE_CONFLICT", "runtime store write conflict", {
                cause: error
            });
        }
        return new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
            cause: error
        });
    }
    async upsertRun(input) {
        assertUpsertRunInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const nowIso = new Date().toISOString();
            const existing = this.#db
                .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
                .get(input.runId);
            const created = !existing;
            this.#db
                .prepare(`
          INSERT INTO runtime_runs(
            run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            session_id = excluded.session_id,
            profile_name = excluded.profile_name,
            command = excluded.command,
            status = excluded.status,
            started_at = runtime_runs.started_at,
            ended_at = excluded.ended_at,
            error_code = excluded.error_code,
            updated_at = excluded.updated_at
        `)
                .run(input.runId, input.sessionId, input.profileName, input.command, input.status, input.startedAt, input.endedAt, input.errorCode, nowIso, nowIso);
            return {
                run_id: input.runId,
                status: input.status,
                created,
                updated_at: nowIso
            };
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async appendRunEvent(input) {
        assertAppendRunEventInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const runExists = this.#db
                .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
                .get(input.runId);
            if (!runExists) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
            }
            const eventSummary = sanitizeRuntimeEventSummary(input.summary);
            const summaryTruncated = input.summaryTruncated || eventSummary.summaryTruncated;
            const createdAt = new Date().toISOString();
            const result = this.#db
                .prepare(`
        INSERT INTO runtime_events(
          run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, summary_truncated, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
                .run(input.runId, input.eventTime, input.stage, input.component, input.eventType, input.diagnosisCategory, input.failurePoint, eventSummary.summary, summaryTruncated ? 1 : 0, createdAt);
            return {
                run_id: input.runId,
                event_id: Number(result.lastInsertRowid),
                event_time: input.eventTime
            };
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async upsertGateApproval(input) {
        assertGateApprovalInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const runExists = this.#db
                .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
                .get(input.runId);
            if (!runExists) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
            }
            const nowIso = new Date().toISOString();
            let approvalId = typeof input.approvalId === "string" && input.approvalId.trim().length > 0
                ? input.approvalId.trim()
                : `gate_appr_${input.decisionId}`;
            const existingApprovalById = this.#db
                .prepare("SELECT decision_id FROM runtime_gate_approvals WHERE approval_id = ?")
                .get(approvalId);
            if (existingApprovalById?.decision_id &&
                existingApprovalById.decision_id !== input.decisionId) {
                approvalId = `gate_appr_${input.decisionId}`;
            }
            this.#db
                .prepare(`
          INSERT INTO runtime_gate_approvals(
            approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(decision_id) DO UPDATE SET
            approval_id = excluded.approval_id,
            run_id = excluded.run_id,
            decision_id = excluded.decision_id,
            approved = excluded.approved,
            approver = excluded.approver,
            approved_at = excluded.approved_at,
            checks_json = excluded.checks_json,
            updated_at = excluded.updated_at
        `)
                .run(approvalId, input.runId, input.decisionId, input.approved ? 1 : 0, input.approver, input.approvedAt, JSON.stringify(input.checks), nowIso, nowIso);
            return this.#getGateApprovalByDecisionId(input.decisionId);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async appendGateAuditRecord(input) {
        assertGateAuditRecordInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const runExists = this.#db
                .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
                .get(input.runId);
            if (!runExists) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
            }
            const createdAt = new Date().toISOString();
            this.#db
                .prepare(`
          INSERT INTO runtime_gate_audit_records(
            event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
            action_type, requested_execution_mode, effective_execution_mode, gate_decision,
            gate_reasons_json, approver, approved_at, recorded_at, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            decision_id = excluded.decision_id,
            approval_id = excluded.approval_id,
            session_id = excluded.session_id,
            profile = excluded.profile,
            issue_scope = excluded.issue_scope,
            risk_state = excluded.risk_state,
            next_state = excluded.next_state,
            transition_trigger = excluded.transition_trigger,
            target_domain = excluded.target_domain,
            target_tab_id = excluded.target_tab_id,
            target_page = excluded.target_page,
            action_type = excluded.action_type,
            requested_execution_mode = excluded.requested_execution_mode,
            effective_execution_mode = excluded.effective_execution_mode,
            gate_decision = excluded.gate_decision,
            gate_reasons_json = excluded.gate_reasons_json,
            approver = excluded.approver,
            approved_at = excluded.approved_at,
            recorded_at = excluded.recorded_at
        `)
                .run(input.eventId, input.decisionId, input.approvalId, input.runId, input.sessionId, input.profile, input.issueScope, input.riskState, input.nextState, input.transitionTrigger, input.targetDomain, input.targetTabId, input.targetPage, input.actionType, input.requestedExecutionMode, input.effectiveExecutionMode, input.gateDecision, JSON.stringify(input.gateReasons), input.approver, input.approvedAt, input.recordedAt, createdAt);
            return this.#getGateAuditRecordByEventId(input.eventId);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async getRunTrace(runId) {
        if (!runId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
        }
        const run = this.#db
            .prepare(`
      SELECT run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      FROM runtime_runs
      WHERE run_id = ?
    `)
            .get(runId);
        const events = this.#db
            .prepare(`
      SELECT id, run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, summary_truncated, created_at
      FROM runtime_events
      WHERE run_id = ?
      ORDER BY event_time ASC
    `)
            .all(runId)
            .map((row) => {
            const event = row;
            return {
                ...event,
                summary_truncated: event.summary_truncated === true ||
                    (typeof event.summary_truncated === "number" && event.summary_truncated === 1)
            };
        });
        return {
            run: run ?? null,
            events
        };
    }
    async getGateAuditTrail(runId) {
        if (!runId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
        }
        const auditRecords = this.#listGateAuditRecords({ runId });
        const latestApprovedRecord = auditRecords
            .map((record) => {
            if (!isAllowedLiveAuditRecord(record)) {
                return null;
            }
            if (typeof record.decision_id !== "string" ||
                record.decision_id.length === 0 ||
                typeof record.approval_id !== "string" ||
                record.approval_id.length === 0) {
                return null;
            }
            const approvalRecord = this.#getOptionalGateApprovalByDecisionId(record.decision_id);
            if (!approvalRecord || approvalRecord.approval_id !== record.approval_id) {
                return null;
            }
            return {
                auditRecord: record,
                approvalRecord
            };
        })
            .find((entry) => entry !== null) ?? null;
        const latestApprovedDecisionId = latestApprovedRecord?.auditRecord.decision_id ?? null;
        const latestDecisionId = auditRecords.find((record) => typeof record.decision_id === "string" && record.decision_id.length > 0)?.decision_id ?? null;
        const approvalDecisionId = latestApprovedDecisionId ?? latestDecisionId;
        return {
            approvalRecord: latestApprovedRecord?.approvalRecord ??
                (approvalDecisionId
                    ? this.#getOptionalGateApprovalByDecisionId(approvalDecisionId)
                    : this.#getOptionalGateApprovalByRunId(runId)),
            auditRecords
        };
    }
    async listGateAuditRecords(input) {
        return this.#listGateAuditRecords(input);
    }
    async upsertApprovalRecord(input) {
        return this.upsertGateApproval(input);
    }
    async appendAuditRecord(input) {
        return this.appendGateAuditRecord(input);
    }
    async getAuditTrailByRunId(runId) {
        const result = await this.getGateAuditTrail(runId);
        return {
            approval_record: result.approvalRecord,
            audit_records: result.auditRecords
        };
    }
    async listAuditRecords(input) {
        return this.#listGateAuditRecords({
            runId: input.run_id,
            sessionId: input.session_id,
            profile: input.profile,
            limit: input.limit
        });
    }
    async upsertAntiDetectionValidationRequest(input) {
        assertUpsertAntiDetectionValidationRequestInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const existing = this.#getOptionalAntiDetectionValidationRequestByRef(input.requestRef);
            if (existing) {
                const immutableMismatch = existing.validation_scope !== input.validationScope ||
                    existing.target_fr_ref !== input.targetFrRef ||
                    existing.profile_ref !== input.profileRef ||
                    existing.browser_channel !== input.browserChannel ||
                    existing.execution_surface !== input.executionSurface ||
                    existing.sample_goal !== input.sampleGoal ||
                    existing.requested_execution_mode !== input.requestedExecutionMode ||
                    existing.probe_bundle_ref !== input.probeBundleRef ||
                    existing.requested_at !== input.requestedAt;
                if (immutableMismatch) {
                    invalidRuntimeStoreInput("request_ref conflicts with an existing anti-detection request");
                }
                if (!REQUEST_STATE_TRANSITIONS[existing.request_state].includes(input.requestState)) {
                    invalidRuntimeStoreInput("anti-detection request_state transition is not allowed");
                }
            }
            else if (input.requestState === "completed" || input.requestState === "aborted") {
                invalidRuntimeStoreInput("anti-detection request_state terminal state requires an existing request");
            }
            this.#db
                .prepare(`
          INSERT INTO anti_detection_validation_request(
            request_ref,
            validation_scope,
            target_fr_ref,
            profile_ref,
            browser_channel,
            execution_surface,
            sample_goal,
            requested_execution_mode,
            probe_bundle_ref,
            request_state,
            requested_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(request_ref) DO UPDATE SET
            request_state = excluded.request_state
        `)
                .run(input.requestRef, input.validationScope, input.targetFrRef, input.profileRef, input.browserChannel, input.executionSurface, input.sampleGoal, input.requestedExecutionMode, input.probeBundleRef, input.requestState, input.requestedAt);
            return this.#getAntiDetectionValidationRequestByRef(input.requestRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async insertAntiDetectionStructuredSample(input) {
        assertInsertAntiDetectionStructuredSampleInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const existing = this.#getOptionalAntiDetectionStructuredSampleByRef(input.sampleRef);
            if (existing) {
                invalidRuntimeStoreInput("sample_ref conflicts with an existing anti-detection sample");
            }
            const request = this.#getAntiDetectionValidationRequestByRef(input.requestRef);
            if (!antiDetectionScopeMatches(request, input)) {
                invalidRuntimeStoreInput("anti-detection structured sample scope does not match request scope");
            }
            this.#db
                .prepare(`
          INSERT INTO anti_detection_structured_sample(
            sample_ref,
            request_ref,
            target_fr_ref,
            validation_scope,
            profile_ref,
            browser_channel,
            execution_surface,
            effective_execution_mode,
            probe_bundle_ref,
            run_id,
            captured_at,
            structured_payload,
            artifact_refs
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
                .run(input.sampleRef, input.requestRef, input.targetFrRef, input.validationScope, input.profileRef, input.browserChannel, input.executionSurface, input.effectiveExecutionMode, input.probeBundleRef, input.runId, input.capturedAt, JSON.stringify(input.structuredPayload), JSON.stringify(input.artifactRefs));
            return this.#getAntiDetectionStructuredSampleByRef(input.sampleRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async insertAntiDetectionBaselineSnapshot(input) {
        assertInsertAntiDetectionBaselineSnapshotInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const existing = this.#getOptionalAntiDetectionBaselineSnapshotByRef(input.baselineRef);
            if (existing) {
                invalidRuntimeStoreInput("baseline_ref conflicts with an existing anti-detection baseline");
            }
            for (const sampleRef of input.sourceSampleRefs) {
                const sample = this.#getAntiDetectionStructuredSampleByRef(sampleRef);
                if (!antiDetectionScopeMatches(sample, input)) {
                    invalidRuntimeStoreInput("anti-detection baseline source sample scope does not match baseline scope");
                }
            }
            this.#db
                .prepare(`
          INSERT INTO anti_detection_baseline_snapshot(
            baseline_ref,
            target_fr_ref,
            validation_scope,
            probe_bundle_ref,
            profile_ref,
            browser_channel,
            execution_surface,
            effective_execution_mode,
            signal_vector,
            captured_at,
            source_sample_refs,
            source_run_ids
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
                .run(input.baselineRef, input.targetFrRef, input.validationScope, input.probeBundleRef, input.profileRef, input.browserChannel, input.executionSurface, input.effectiveExecutionMode, JSON.stringify(input.signalVector), input.capturedAt, JSON.stringify(input.sourceSampleRefs), JSON.stringify(input.sourceRunIds));
            return this.#getAntiDetectionBaselineSnapshotByRef(input.baselineRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async upsertAntiDetectionBaselineRegistryEntry(input) {
        assertUpsertAntiDetectionBaselineRegistryEntryInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const activeBaseline = this.#getAntiDetectionBaselineSnapshotByRef(input.activeBaselineRef);
            if (!antiDetectionScopeMatches(activeBaseline, input)) {
                invalidRuntimeStoreInput("anti-detection active baseline scope does not match registry scope");
            }
            for (const baselineRef of input.supersededBaselineRefs) {
                const supersededBaseline = this.#getAntiDetectionBaselineSnapshotByRef(baselineRef);
                if (!antiDetectionScopeMatches(supersededBaseline, input)) {
                    invalidRuntimeStoreInput("anti-detection superseded baseline scope does not match registry scope");
                }
            }
            this.#db
                .prepare(`
          INSERT INTO anti_detection_baseline_registry_entry(
            target_fr_ref,
            validation_scope,
            profile_ref,
            browser_channel,
            execution_surface,
            effective_execution_mode,
            probe_bundle_ref,
            active_baseline_ref,
            superseded_baseline_refs,
            replacement_reason,
            updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(
            target_fr_ref,
            validation_scope,
            profile_ref,
            browser_channel,
            execution_surface,
            effective_execution_mode,
            probe_bundle_ref
          ) DO UPDATE SET
            active_baseline_ref = excluded.active_baseline_ref,
            superseded_baseline_refs = excluded.superseded_baseline_refs,
            replacement_reason = excluded.replacement_reason,
            updated_at = excluded.updated_at
        `)
                .run(input.targetFrRef, input.validationScope, input.profileRef, input.browserChannel, input.executionSurface, input.effectiveExecutionMode, input.probeBundleRef, input.activeBaselineRef, JSON.stringify(input.supersededBaselineRefs), input.replacementReason, input.updatedAt);
            return this.#getAntiDetectionBaselineRegistryEntry(input);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async insertAntiDetectionValidationRecord(input) {
        assertInsertAntiDetectionValidationRecordInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            const existing = this.#getOptionalAntiDetectionValidationRecordByRef(input.recordRef);
            if (existing) {
                invalidRuntimeStoreInput("record_ref conflicts with an existing anti-detection record");
            }
            const request = this.#getAntiDetectionValidationRequestByRef(input.requestRef);
            if (!antiDetectionScopeMatches(request, input)) {
                invalidRuntimeStoreInput("anti-detection validation record scope does not match request scope");
            }
            const sample = this.#getAntiDetectionStructuredSampleByRef(input.sampleRef);
            if (sample.request_ref !== input.requestRef) {
                invalidRuntimeStoreInput("anti-detection validation record sample does not belong to request");
            }
            if (!antiDetectionScopeMatches(sample, input)) {
                invalidRuntimeStoreInput("anti-detection validation record scope does not match sample scope");
            }
            if (input.baselineRef) {
                const baseline = this.#getAntiDetectionBaselineSnapshotByRef(input.baselineRef);
                if (!antiDetectionScopeMatches(baseline, input)) {
                    invalidRuntimeStoreInput("anti-detection validation record scope does not match baseline scope");
                }
            }
            this.#db
                .prepare(`
          INSERT INTO anti_detection_validation_record(
            record_ref,
            request_ref,
            target_fr_ref,
            validation_scope,
            profile_ref,
            browser_channel,
            execution_surface,
            effective_execution_mode,
            probe_bundle_ref,
            sample_ref,
            baseline_ref,
            result_state,
            drift_state,
            failure_class,
            run_id,
            validated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
                .run(input.recordRef, input.requestRef, input.targetFrRef, input.validationScope, input.profileRef, input.browserChannel, input.executionSurface, input.effectiveExecutionMode, input.probeBundleRef, input.sampleRef, input.baselineRef, input.resultState, input.driftState, input.failureClass, input.runId, input.validatedAt);
            return this.#getAntiDetectionValidationRecordByRef(input.recordRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async getAntiDetectionValidationView(scope) {
        assertAntiDetectionValidationScopeKeyInput(scope, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        const row = this.#db
            .prepare(`
        SELECT
          target_fr_ref,
          validation_scope,
          profile_ref,
          browser_channel,
          execution_surface,
          effective_execution_mode,
          probe_bundle_ref,
          latest_record_ref,
          baseline_status,
          current_result_state,
          current_drift_state,
          last_success_at
        FROM anti_detection_validation_view
        WHERE target_fr_ref = ?
          AND validation_scope = ?
          AND profile_ref = ?
          AND browser_channel = ?
          AND execution_surface = ?
          AND effective_execution_mode = ?
          AND probe_bundle_ref = ?
      `)
            .get(scope.targetFrRef, scope.validationScope, scope.profileRef, scope.browserChannel, scope.executionSurface, scope.effectiveExecutionMode, scope.probeBundleRef);
        return row ? mapAntiDetectionValidationViewRow(row) : null;
    }
    #getAntiDetectionValidationRequestByRef(requestRef) {
        const row = this.#getOptionalAntiDetectionValidationRequestByRef(requestRef);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection validation request not found");
        }
        return row;
    }
    #getOptionalAntiDetectionValidationRequestByRef(requestRef) {
        const row = this.#db
            .prepare(`
        SELECT
          request_ref,
          validation_scope,
          target_fr_ref,
          profile_ref,
          browser_channel,
          execution_surface,
          sample_goal,
          requested_execution_mode,
          probe_bundle_ref,
          request_state,
          requested_at
        FROM anti_detection_validation_request
        WHERE request_ref = ?
      `)
            .get(requestRef);
        return row ? mapAntiDetectionValidationRequestRow(row) : null;
    }
    #getAntiDetectionStructuredSampleByRef(sampleRef) {
        const row = this.#getOptionalAntiDetectionStructuredSampleByRef(sampleRef);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection structured sample not found");
        }
        return row;
    }
    #getOptionalAntiDetectionStructuredSampleByRef(sampleRef) {
        const row = this.#db
            .prepare(`
        SELECT
          sample_ref,
          request_ref,
          target_fr_ref,
          validation_scope,
          profile_ref,
          browser_channel,
          execution_surface,
          effective_execution_mode,
          probe_bundle_ref,
          run_id,
          captured_at,
          structured_payload,
          artifact_refs
        FROM anti_detection_structured_sample
        WHERE sample_ref = ?
      `)
            .get(sampleRef);
        return row ? mapAntiDetectionStructuredSampleRow(row) : null;
    }
    #getAntiDetectionBaselineSnapshotByRef(baselineRef) {
        const row = this.#getOptionalAntiDetectionBaselineSnapshotByRef(baselineRef);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection baseline snapshot not found");
        }
        return row;
    }
    #getOptionalAntiDetectionBaselineSnapshotByRef(baselineRef) {
        const row = this.#db
            .prepare(`
        SELECT
          baseline_ref,
          target_fr_ref,
          validation_scope,
          probe_bundle_ref,
          profile_ref,
          browser_channel,
          execution_surface,
          effective_execution_mode,
          signal_vector,
          captured_at,
          source_sample_refs,
          source_run_ids
        FROM anti_detection_baseline_snapshot
        WHERE baseline_ref = ?
      `)
            .get(baselineRef);
        return row ? mapAntiDetectionBaselineSnapshotRow(row) : null;
    }
    #getAntiDetectionBaselineRegistryEntry(scope) {
        const row = this.#db
            .prepare(`
        SELECT
          target_fr_ref,
          validation_scope,
          profile_ref,
          browser_channel,
          execution_surface,
          effective_execution_mode,
          probe_bundle_ref,
          active_baseline_ref,
          superseded_baseline_refs,
          replacement_reason,
          updated_at
        FROM anti_detection_baseline_registry_entry
        WHERE target_fr_ref = ?
          AND validation_scope = ?
          AND profile_ref = ?
          AND browser_channel = ?
          AND execution_surface = ?
          AND effective_execution_mode = ?
          AND probe_bundle_ref = ?
      `)
            .get(scope.targetFrRef, scope.validationScope, scope.profileRef, scope.browserChannel, scope.executionSurface, scope.effectiveExecutionMode, scope.probeBundleRef);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection baseline registry entry not found");
        }
        return mapAntiDetectionBaselineRegistryEntryRow(row);
    }
    #getAntiDetectionValidationRecordByRef(recordRef) {
        const row = this.#getOptionalAntiDetectionValidationRecordByRef(recordRef);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection validation record not found");
        }
        return row;
    }
    #getOptionalAntiDetectionValidationRecordByRef(recordRef) {
        const row = this.#db
            .prepare(`
        SELECT
          record_ref,
          request_ref,
          target_fr_ref,
          validation_scope,
          profile_ref,
          browser_channel,
          execution_surface,
          effective_execution_mode,
          probe_bundle_ref,
          sample_ref,
          baseline_ref,
          result_state,
          drift_state,
          failure_class,
          run_id,
          validated_at
        FROM anti_detection_validation_record
        WHERE record_ref = ?
      `)
            .get(recordRef);
        return row ? mapAntiDetectionValidationRecordRow(row) : null;
    }
    #listGateAuditRecords(input) {
        assertListGateAuditInput(input, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        const clauses = [];
        const values = [];
        if (input.runId?.trim()) {
            clauses.push("run_id = ?");
            values.push(input.runId.trim());
        }
        if (input.sessionId?.trim()) {
            clauses.push("session_id = ?");
            values.push(input.sessionId.trim());
        }
        if (input.profile?.trim()) {
            clauses.push("profile = ?");
            values.push(input.profile.trim());
        }
        const limit = typeof input.limit === "number" && Number.isInteger(input.limit)
            ? Math.max(1, Math.min(input.limit, 100))
            : 50;
        values.push(limit);
        const sql = `
      SELECT event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
             decision_id, approval_id,
             action_type, requested_execution_mode, effective_execution_mode, gate_decision,
             gate_reasons_json, approver, approved_at, recorded_at, created_at
      FROM runtime_gate_audit_records
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY recorded_at DESC
      LIMIT ?
    `;
        const rows = this.#db.prepare(sql).all(...values);
        return rows.map(mapGateAuditRecordRow);
    }
    #getOptionalGateApprovalByRunId(runId) {
        const row = this.#db
            .prepare(`
      SELECT approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
             , decision_id
      FROM runtime_gate_approvals
      WHERE run_id = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `)
            .get(runId);
        if (!row) {
            return null;
        }
        return mapGateApprovalRecordRow(row);
    }
    #getOptionalGateApprovalByDecisionId(decisionId) {
        const row = this.#db
            .prepare(`
      SELECT approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
             , decision_id
      FROM runtime_gate_approvals
      WHERE decision_id = ?
      LIMIT 1
    `)
            .get(decisionId);
        if (!row) {
            return null;
        }
        return mapGateApprovalRecordRow(row);
    }
    #getGateApprovalByDecisionId(decisionId) {
        const record = this.#getOptionalGateApprovalByDecisionId(decisionId);
        if (!record) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate approval not found");
        }
        return record;
    }
    #getGateAuditRecordByEventId(eventId) {
        const row = this.#db
            .prepare(`
      SELECT event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
             decision_id, approval_id,
             action_type, requested_execution_mode, effective_execution_mode, gate_decision,
             gate_reasons_json, approver, approved_at, recorded_at, created_at
      FROM runtime_gate_audit_records
      WHERE event_id = ?
    `)
            .get(eventId);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate audit record not found");
        }
        return mapGateAuditRecordRow(row);
    }
}
