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
const EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const SESSION_RHYTHM_PHASES = new Set([
    "warmup",
    "steady",
    "cooldown",
    "recovery_probe",
    "afterglow_hook"
]);
const SESSION_RHYTHM_EVENT_TYPES = new Set([
    "risk_signal",
    "cooldown_started",
    "cooldown_extended",
    "recovery_probe_started",
    "recovery_probe_passed",
    "recovery_probe_failed",
    "stability_window_passed",
    "manual_approval_recorded",
    "window_closed"
]);
const SESSION_RHYTHM_DECISIONS = new Set(["allowed", "blocked", "deferred"]);
const SESSION_RHYTHM_RISK_STATES = new Set(["paused", "limited", "allowed"]);
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
const asNonEmptyRuntimeStoreString = (value, fieldName) => {
    if (typeof value !== "string" || value.trim().length === 0) {
        invalidRuntimeStoreInput(`${fieldName} is required`);
    }
    return value.trim();
};
const asNullableRuntimeStoreString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asSessionRhythmRiskState = (value, fieldName) => {
    const riskState = asNonEmptyRuntimeStoreString(value, fieldName);
    if (!SESSION_RHYTHM_RISK_STATES.has(riskState)) {
        invalidRuntimeStoreInput(`${fieldName} must be one of ${[...SESSION_RHYTHM_RISK_STATES].join(", ")}`);
    }
    return riskState;
};
const asEnumRuntimeStoreString = (value, fieldName, allowedValues) => {
    const enumValue = asNonEmptyRuntimeStoreString(value, fieldName);
    if (!allowedValues.has(enumValue)) {
        invalidRuntimeStoreInput(`${fieldName} must be one of ${[...allowedValues].join(", ")}`);
    }
    return enumValue;
};
const parseJsonArray = (value) => {
    if (typeof value !== "string") {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
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
    async runInTransaction(callback) {
        try {
            this.#db.exec("BEGIN IMMEDIATE");
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
        try {
            const result = await callback();
            this.#db.exec("COMMIT");
            return result;
        }
        catch (error) {
            try {
                this.#db.exec("ROLLBACK");
            }
            catch {
                // Preserve the original failure; rollback errors are secondary.
            }
            throw this.#toStoreDbError(error);
        }
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
    async getGateAuditTrail(runId, options) {
        if (!runId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
        }
        try {
            const auditRecords = this.#listGateAuditRecords({ runId, limit: options?.limit });
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
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async listGateAuditRecords(input) {
        return this.#listGateAuditRecords(input);
    }
    async upsertApprovalRecord(input) {
        return this.upsertGateApproval(input);
    }
    async getGateApprovalByDecisionId(decisionId) {
        if (!decisionId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "decision_id is required");
        }
        try {
            return this.#getOptionalGateApprovalByDecisionId(decisionId);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async getGateAuditRecordByIdentity(input) {
        if (!input.runId.trim() ||
            !input.eventId.trim() ||
            !input.decisionId.trim() ||
            !input.sessionId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "gate audit identity is required");
        }
        try {
            const row = this.#db
                .prepare(`
          SELECT event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
                 decision_id, approval_id,
                 action_type, requested_execution_mode, effective_execution_mode, gate_decision,
                 gate_reasons_json, approver, approved_at, recorded_at, created_at
          FROM runtime_gate_audit_records
          WHERE run_id = ?
            AND event_id = ?
            AND decision_id = ?
            AND session_id = ?
          LIMIT 1
        `)
                .get(input.runId, input.eventId, input.decisionId, input.sessionId);
            return row ? mapGateAuditRecordRow(row) : null;
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
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
    async recordSessionRhythmStatusView(input) {
        const windowState = input.windowState;
        const event = input.event;
        const decision = input.decision;
        const windowId = asNonEmptyRuntimeStoreString(windowState.window_id, "window_id");
        const eventId = asNonEmptyRuntimeStoreString(event.event_id, "event_id");
        const decisionId = asNonEmptyRuntimeStoreString(decision.decision_id, "decision_id");
        const updatedAt = asNonEmptyRuntimeStoreString(windowState.updated_at, "updated_at");
        const recordedAt = asNonEmptyRuntimeStoreString(event.recorded_at, "recorded_at");
        const decidedAt = asNonEmptyRuntimeStoreString(decision.decided_at, "decided_at");
        let transactionStarted = false;
        try {
            this.#db.exec("BEGIN IMMEDIATE");
            transactionStarted = true;
            const existingWindow = this.#db
                .prepare(`
          SELECT window_id, updated_at
          FROM session_rhythm_window_state
          WHERE profile = ? AND platform = ? AND issue_scope = ?
        `)
                .get(input.profile, input.platform, input.issueScope);
            if (typeof existingWindow?.updated_at === "string" &&
                existingWindow.updated_at > updatedAt) {
                this.#db.exec("COMMIT");
                transactionStarted = false;
                return this.getSessionRhythmStatusView({
                    profile: input.profile,
                    platform: input.platform,
                    issueScope: input.issueScope
                });
            }
            this.#db
                .prepare(`
          INSERT INTO session_rhythm_window_state(
            window_id, profile, platform, issue_scope, session_id, current_phase, risk_state,
            window_started_at, window_deadline_at, cooldown_until, recovery_probe_due_at,
            stability_window_until, risk_signal_count, last_event_id, source_run_id, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(profile, platform, issue_scope) DO UPDATE SET
            window_id = excluded.window_id,
            session_id = excluded.session_id,
            current_phase = excluded.current_phase,
            risk_state = excluded.risk_state,
            window_started_at = excluded.window_started_at,
            window_deadline_at = excluded.window_deadline_at,
            cooldown_until = excluded.cooldown_until,
            recovery_probe_due_at = excluded.recovery_probe_due_at,
            stability_window_until = excluded.stability_window_until,
            risk_signal_count = excluded.risk_signal_count,
            last_event_id = excluded.last_event_id,
            source_run_id = excluded.source_run_id,
            updated_at = excluded.updated_at
          WHERE excluded.updated_at >= session_rhythm_window_state.updated_at
        `)
                .run(windowId, input.profile, input.platform, input.issueScope, asNonEmptyRuntimeStoreString(windowState.session_id, "window_state.session_id"), asEnumRuntimeStoreString(windowState.current_phase, "current_phase", SESSION_RHYTHM_PHASES), asSessionRhythmRiskState(windowState.risk_state, "risk_state"), asNullableRuntimeStoreString(windowState.window_started_at), asNullableRuntimeStoreString(windowState.window_deadline_at), asNullableRuntimeStoreString(windowState.cooldown_until), asNullableRuntimeStoreString(windowState.recovery_probe_due_at), asNullableRuntimeStoreString(windowState.stability_window_until), Number.isInteger(windowState.risk_signal_count)
                ? windowState.risk_signal_count
                : 0, asNullableRuntimeStoreString(windowState.last_event_id), asNonEmptyRuntimeStoreString(windowState.source_run_id, "window_state.source_run_id"), updatedAt);
            this.#db
                .prepare(`
          INSERT INTO session_rhythm_event(
            event_id, profile, platform, issue_scope, session_id, window_id, event_type,
            phase_before, phase_after, risk_state_before, risk_state_after,
            source_audit_event_id, reason, recorded_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            source_audit_event_id = COALESCE(
              session_rhythm_event.source_audit_event_id,
              excluded.source_audit_event_id
            )
        `)
                .run(eventId, input.profile, input.platform, input.issueScope, asNonEmptyRuntimeStoreString(event.session_id, "event.session_id"), windowId, asEnumRuntimeStoreString(event.event_type, "event_type", SESSION_RHYTHM_EVENT_TYPES), asEnumRuntimeStoreString(event.phase_before, "phase_before", SESSION_RHYTHM_PHASES), asEnumRuntimeStoreString(event.phase_after, "phase_after", SESSION_RHYTHM_PHASES), asSessionRhythmRiskState(event.risk_state_before, "risk_state_before"), asSessionRhythmRiskState(event.risk_state_after, "risk_state_after"), asNullableRuntimeStoreString(event.source_audit_event_id), asNullableRuntimeStoreString(event.reason), recordedAt);
            this.#db
                .prepare(`
          INSERT INTO session_rhythm_decision(
            decision_id, window_id, run_id, session_id, profile, current_phase,
            current_risk_state, next_phase, next_risk_state, effective_execution_mode,
            decision, reason_codes_json, requires_json, decided_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(decision_id) DO NOTHING
        `)
                .run(decisionId, windowId, asNonEmptyRuntimeStoreString(decision.run_id, "decision.run_id"), asNonEmptyRuntimeStoreString(decision.session_id, "decision.session_id"), input.profile, asEnumRuntimeStoreString(decision.current_phase, "current_phase", SESSION_RHYTHM_PHASES), asSessionRhythmRiskState(decision.current_risk_state, "current_risk_state"), asEnumRuntimeStoreString(decision.next_phase, "next_phase", SESSION_RHYTHM_PHASES), asSessionRhythmRiskState(decision.next_risk_state, "next_risk_state"), asEnumRuntimeStoreString(decision.effective_execution_mode, "effective_execution_mode", EXECUTION_MODES), asEnumRuntimeStoreString(decision.decision, "decision", SESSION_RHYTHM_DECISIONS), JSON.stringify(Array.isArray(decision.reason_codes) ? decision.reason_codes : []), JSON.stringify(Array.isArray(decision.requires) ? decision.requires : []), decidedAt);
            this.#db.exec("COMMIT");
            transactionStarted = false;
            return this.getSessionRhythmStatusView({
                profile: input.profile,
                platform: input.platform,
                issueScope: input.issueScope
            });
        }
        catch (error) {
            if (transactionStarted) {
                try {
                    this.#db.exec("ROLLBACK");
                }
                catch {
                    // Preserve the original write failure; SQLite may already have closed the transaction.
                }
            }
            throw this.#toStoreDbError(error);
        }
    }
    async upsertSessionRhythmStatusView(input) {
        return this.recordSessionRhythmStatusView(input);
    }
    async getSessionRhythmStatusView(input) {
        const platform = input.platform ?? "xhs";
        const issueScope = input.issueScope ?? "issue_209";
        const runId = asNullableRuntimeStoreString(input.runId);
        const row = this.#db
            .prepare(`
        SELECT
          w.window_id, w.profile, w.platform, w.issue_scope, w.session_id,
          w.current_phase, w.risk_state, w.window_started_at, w.window_deadline_at,
          w.cooldown_until, w.recovery_probe_due_at, w.stability_window_until,
          w.risk_signal_count, w.last_event_id, w.source_run_id, w.updated_at,
          e.event_id, e.profile AS event_profile, e.platform AS event_platform,
          e.issue_scope AS event_issue_scope, e.session_id AS event_session_id,
          e.window_id AS event_window_id, e.event_type, e.phase_before,
          e.phase_after, e.risk_state_before, e.risk_state_after,
          e.source_audit_event_id, e.reason, e.recorded_at,
          d.decision_id, d.window_id AS decision_window_id,
          d.run_id AS decision_run_id, d.session_id AS decision_session_id,
          d.profile AS decision_profile, d.current_phase AS decision_current_phase,
          d.current_risk_state, d.next_phase, d.next_risk_state,
          d.effective_execution_mode, d.decision, d.reason_codes_json,
          d.requires_json, d.decided_at
        FROM session_rhythm_window_state w
        LEFT JOIN session_rhythm_event e ON e.event_id = w.last_event_id
        LEFT JOIN session_rhythm_decision d ON d.window_id = w.window_id
        WHERE w.profile = ? AND w.platform = ? AND w.issue_scope = ?
        ORDER BY
          CASE WHEN ? IS NOT NULL AND d.run_id = ? THEN 0 ELSE 1 END,
          CASE WHEN ? IS NOT NULL AND d.session_id = ? THEN 0 ELSE 1 END,
          CASE
            WHEN d.decision_id LIKE 'rhythm_decision_preflight_%' THEN 1
            ELSE 0
          END,
          d.decided_at DESC
        LIMIT 1
      `)
            .get(input.profile, platform, issueScope, runId, runId, asNullableRuntimeStoreString(input.sessionId), asNullableRuntimeStoreString(input.sessionId));
        if (!row) {
            return null;
        }
        return {
            window_state: {
                window_id: row.window_id,
                profile: row.profile,
                platform: row.platform,
                issue_scope: row.issue_scope,
                session_id: row.session_id,
                current_phase: row.current_phase,
                risk_state: row.risk_state,
                window_started_at: row.window_started_at,
                window_deadline_at: row.window_deadline_at,
                cooldown_until: row.cooldown_until,
                recovery_probe_due_at: row.recovery_probe_due_at,
                stability_window_until: row.stability_window_until,
                risk_signal_count: row.risk_signal_count,
                last_event_id: row.last_event_id,
                source_run_id: row.source_run_id,
                updated_at: row.updated_at
            },
            event: {
                event_id: row.event_id,
                profile: row.event_profile,
                platform: row.event_platform,
                issue_scope: row.event_issue_scope,
                session_id: row.event_session_id,
                window_id: row.event_window_id,
                event_type: row.event_type,
                phase_before: row.phase_before,
                phase_after: row.phase_after,
                risk_state_before: row.risk_state_before,
                risk_state_after: row.risk_state_after,
                source_audit_event_id: row.source_audit_event_id,
                reason: row.reason,
                recorded_at: row.recorded_at
            },
            decision: {
                decision_id: row.decision_id,
                window_id: row.decision_window_id,
                run_id: row.decision_run_id,
                session_id: row.decision_session_id,
                profile: row.decision_profile,
                current_phase: row.decision_current_phase,
                current_risk_state: row.current_risk_state,
                next_phase: row.next_phase,
                next_risk_state: row.next_risk_state,
                effective_execution_mode: row.effective_execution_mode,
                decision: row.decision,
                reason_codes: parseJsonArray(row.reason_codes_json),
                requires: parseJsonArray(row.requires_json),
                decided_at: row.decided_at
            }
        };
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
    async getAntiDetectionStructuredSample(sampleRef) {
        if (!sampleRef.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "sample_ref is required");
        }
        try {
            return this.#getOptionalAntiDetectionStructuredSampleByRef(sampleRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async getAntiDetectionValidationRequest(requestRef) {
        if (typeof requestRef !== "string" || requestRef.trim().length === 0) {
            throw invalidRuntimeStoreInput("missing required anti-detection request_ref");
        }
        try {
            return this.#getOptionalAntiDetectionValidationRequestByRef(requestRef);
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
    async getAntiDetectionBaselineRegistryEntry(scope) {
        assertAntiDetectionValidationScopeKeyInput(scope, {
            invalidInput: invalidRuntimeStoreInput,
            isIsoLike
        });
        try {
            return this.#getOptionalAntiDetectionBaselineRegistryEntry(scope);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
    }
    async getAntiDetectionBaselineSnapshot(baselineRef) {
        if (typeof baselineRef !== "string" || baselineRef.trim().length === 0) {
            throw invalidRuntimeStoreInput("missing required anti-detection baseline_ref");
        }
        try {
            return this.#getOptionalAntiDetectionBaselineSnapshotByRef(baselineRef);
        }
        catch (error) {
            throw this.#toStoreDbError(error);
        }
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
        const row = this.#getOptionalAntiDetectionBaselineRegistryEntry(scope);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "anti-detection baseline registry entry not found");
        }
        return row;
    }
    #getOptionalAntiDetectionBaselineRegistryEntry(scope) {
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
            return null;
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
