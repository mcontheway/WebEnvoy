import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { initializeRuntimeStoreSchema } from "./sqlite-runtime-store-schema.js";
import { mapGateApprovalRecordRow, mapGateAuditRecordRow } from "./sqlite-runtime-store-helpers.js";
import { assertAppendRunEventInput, assertGateApprovalInput, assertGateAuditRecordInput, assertListGateAuditInput, assertUpsertRunInput } from "./sqlite-runtime-store-validation.js";
export class RuntimeStoreError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "RuntimeStoreError";
        this.code = code;
    }
}
const SUMMARY_MAX_CHARS = 512;
const SQLITE_BUSY_MESSAGE = /SQLITE_BUSY|database is locked/i;
const SQLITE_OPEN_RETRY_LIMIT = 8;
let databaseSyncCtorCache;
const sanitizeSummary = (summary) => {
    if (summary === null) {
        return null;
    }
    const redacted = summary
        .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/(cookie\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
        .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
    if (redacted.length <= SUMMARY_MAX_CHARS) {
        return redacted;
    }
    return `${redacted.slice(0, SUMMARY_MAX_CHARS)} [TRUNCATED]`;
};
const isIsoLike = (value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
const isSqliteBusyError = (error) => error instanceof Error && SQLITE_BUSY_MESSAGE.test(error.message);
const invalidRuntimeStoreInput = (message) => {
    throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", message);
};
export const resolveRuntimeStorePath = (cwd) => path.join(cwd, ".webenvoy", "runtime", "store.sqlite");
const sleepSync = (milliseconds) => {
    const buffer = new SharedArrayBuffer(4);
    const view = new Int32Array(buffer);
    Atomics.wait(view, 0, 0, milliseconds);
};
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
            for (let attempt = 0; attempt <= SQLITE_OPEN_RETRY_LIMIT; attempt += 1) {
                try {
                    this.#db = new DatabaseSyncCtor(dbPath);
                    this.#db.exec("PRAGMA busy_timeout=2000;");
                    this.#initialize();
                    return;
                }
                catch (error) {
                    try {
                        this.#db?.close();
                    }
                    catch {
                        // Ignore cleanup failure in retry loop.
                    }
                    if (error instanceof RuntimeStoreError &&
                        error.code === "ERR_RUNTIME_STORE_SCHEMA_MISMATCH") {
                        throw error;
                    }
                    if (isSqliteBusyError(error) && attempt < SQLITE_OPEN_RETRY_LIMIT) {
                        sleepSync(25 * (attempt + 1));
                        lastError = error;
                        continue;
                    }
                    lastError = error;
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
            const eventSummary = sanitizeSummary(input.summary);
            const createdAt = new Date().toISOString();
            const result = this.#db
                .prepare(`
        INSERT INTO runtime_events(
          run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, created_at
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
                .run(input.runId, input.eventTime, input.stage, input.component, input.eventType, input.diagnosisCategory, input.failurePoint, eventSummary, createdAt);
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
            const approvalId = `gate_appr_${input.runId}`;
            this.#db
                .prepare(`
          INSERT INTO runtime_gate_approvals(
            approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            approved = excluded.approved,
            approver = excluded.approver,
            approved_at = excluded.approved_at,
            checks_json = excluded.checks_json,
            updated_at = excluded.updated_at
        `)
                .run(approvalId, input.runId, input.approved ? 1 : 0, input.approver, input.approvedAt, JSON.stringify(input.checks), nowIso, nowIso);
            return this.#getGateApprovalByRunId(input.runId);
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
            event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
            action_type, requested_execution_mode, effective_execution_mode, gate_decision,
            gate_reasons_json, approver, approved_at, recorded_at, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
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
                .run(input.eventId, input.runId, input.sessionId, input.profile, input.issueScope, input.riskState, input.nextState, input.transitionTrigger, input.targetDomain, input.targetTabId, input.targetPage, input.actionType, input.requestedExecutionMode, input.effectiveExecutionMode, input.gateDecision, JSON.stringify(input.gateReasons), input.approver, input.approvedAt, input.recordedAt, createdAt);
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
      SELECT id, run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, created_at
      FROM runtime_events
      WHERE run_id = ?
      ORDER BY event_time ASC
    `)
            .all(runId);
        return {
            run: run ?? null,
            events
        };
    }
    async getGateAuditTrail(runId) {
        if (!runId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
        }
        return {
            approvalRecord: this.#getOptionalGateApprovalByRunId(runId),
            auditRecords: this.#listGateAuditRecords({ runId })
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
      FROM runtime_gate_approvals
      WHERE run_id = ?
    `)
            .get(runId);
        if (!row) {
            return null;
        }
        return mapGateApprovalRecordRow(row);
    }
    #getGateApprovalByRunId(runId) {
        const record = this.#getOptionalGateApprovalByRunId(runId);
        if (!record) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate approval not found");
        }
        return record;
    }
    #getGateAuditRecordByEventId(eventId) {
        const row = this.#db
            .prepare(`
      SELECT event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
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
