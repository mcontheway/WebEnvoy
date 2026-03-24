import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
export class RuntimeStoreError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = "RuntimeStoreError";
        this.code = code;
    }
}
const SCHEMA_VERSION = 4;
const SUMMARY_MAX_CHARS = 512;
const SQLITE_BUSY_MESSAGE = /SQLITE_BUSY|database is locked/i;
const SQLITE_OPEN_RETRY_LIMIT = 3;
let databaseSyncCtorCache;
const GATE_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const GATE_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const GATE_RISK_STATES = new Set(["paused", "limited", "allowed"]);
const GATE_DECISIONS = new Set(["allowed", "blocked"]);
const REQUIRED_APPROVAL_CHECKS = new Set([
    "target_domain_confirmed",
    "target_tab_confirmed",
    "target_page_confirmed",
    "risk_state_checked",
    "action_type_confirmed"
]);
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
const parseJsonObject = (value, fallback) => {
    if (typeof value !== "string" || value.length === 0) {
        return fallback;
    }
    try {
        const parsed = JSON.parse(value);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? parsed
            : fallback;
    }
    catch {
        return fallback;
    }
};
const parseJsonArray = (value) => {
    if (typeof value !== "string" || value.length === 0) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter((item) => typeof item === "string" && item.length > 0)
            : [];
    }
    catch {
        return [];
    }
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
                    if (error instanceof Error && SQLITE_BUSY_MESSAGE.test(error.message) && attempt < SQLITE_OPEN_RETRY_LIMIT) {
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
        this.#db.exec("PRAGMA journal_mode=WAL;");
        this.#db.exec("PRAGMA busy_timeout=2000;");
        this.#db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_runs (
        run_id TEXT PRIMARY KEY,
        session_id TEXT,
        profile_name TEXT NOT NULL,
        command TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        event_time TEXT NOT NULL,
        stage TEXT NOT NULL,
        component TEXT NOT NULL,
        event_type TEXT NOT NULL,
        diagnosis_category TEXT,
        failure_point TEXT,
        summary TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_events_run_time
        ON runtime_events(run_id, event_time ASC);
      CREATE TABLE IF NOT EXISTS runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_execution_mode TEXT NOT NULL,
        effective_execution_mode TEXT NOT NULL,
        gate_decision TEXT NOT NULL,
        gate_reasons_json TEXT NOT NULL,
        approver TEXT,
        approved_at TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_run_recorded
        ON runtime_gate_audit_records(run_id, recorded_at ASC);
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_session_recorded
        ON runtime_gate_audit_records(session_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_profile_recorded
        ON runtime_gate_audit_records(profile, recorded_at DESC);
    `);
        const row = this.#db
            .prepare("SELECT value FROM runtime_store_meta WHERE key = 'schema_version'")
            .get();
        if (!row) {
            this.#db
                .prepare("INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', ?)")
                .run(String(SCHEMA_VERSION));
            return;
        }
        const version = Number(row.value);
        if (version === 1) {
            this.#migrateV1ToV2();
            return;
        }
        if (version === 2) {
            this.#migrateV2ToV3();
            return;
        }
        if (version === 3) {
            this.#migrateV3ToV4();
            return;
        }
        if (version !== SCHEMA_VERSION) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_SCHEMA_MISMATCH", `schema mismatch: ${row.value ?? "unknown"}`);
        }
    }
    #migrateV1ToV2() {
        this.#db.exec(`
      CREATE TABLE IF NOT EXISTS runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE IF NOT EXISTS runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        risk_state TEXT NOT NULL DEFAULT 'paused',
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT NOT NULL,
        requested_execution_mode TEXT NOT NULL,
        effective_execution_mode TEXT NOT NULL,
        gate_decision TEXT NOT NULL,
        gate_reasons_json TEXT NOT NULL,
        approver TEXT,
        approved_at TEXT,
        recorded_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_run_recorded
        ON runtime_gate_audit_records(run_id, recorded_at ASC);
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_session_recorded
        ON runtime_gate_audit_records(session_id, recorded_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_profile_recorded
        ON runtime_gate_audit_records(profile, recorded_at DESC);
    `);
        this.#db
            .prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'")
            .run(String(SCHEMA_VERSION));
    }
    #migrateV2ToV3() {
        this.#db.exec(`
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'paused';
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN next_state TEXT NOT NULL DEFAULT 'paused';
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation';
      UPDATE runtime_gate_audit_records
      SET next_state = risk_state
      WHERE next_state IS NULL OR next_state = '';
    `);
        this.#db
            .prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'")
            .run(String(SCHEMA_VERSION));
    }
    #migrateV3ToV4() {
        this.#db.exec(`
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN next_state TEXT NOT NULL DEFAULT 'paused';
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation';
      UPDATE runtime_gate_audit_records
      SET next_state = risk_state
      WHERE next_state IS NULL OR next_state = '';
    `);
        this.#db
            .prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'")
            .run(String(SCHEMA_VERSION));
    }
    close() {
        this.#db.close();
    }
    #toStoreDbError(error) {
        if (error instanceof RuntimeStoreError) {
            return error;
        }
        if (error instanceof Error && SQLITE_BUSY_MESSAGE.test(error.message)) {
            return new RuntimeStoreError("ERR_RUNTIME_STORE_CONFLICT", "runtime store write conflict", {
                cause: error
            });
        }
        return new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
            cause: error
        });
    }
    async upsertRun(input) {
        this.#assertUpsertRunInput(input);
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
        this.#assertAppendEventInput(input);
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
        this.#assertGateApprovalInput(input);
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
        this.#assertGateAuditRecordInput(input);
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
            event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
            action_type, requested_execution_mode, effective_execution_mode, gate_decision,
            gate_reasons_json, approver, approved_at, recorded_at, created_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(event_id) DO UPDATE SET
            session_id = excluded.session_id,
            profile = excluded.profile,
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
                .run(input.eventId, input.runId, input.sessionId, input.profile, input.riskState, input.nextState, input.transitionTrigger, input.targetDomain, input.targetTabId, input.targetPage, input.actionType, input.requestedExecutionMode, input.effectiveExecutionMode, input.gateDecision, JSON.stringify(input.gateReasons), input.approver, input.approvedAt, input.recordedAt, createdAt);
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
        this.#assertListGateAuditInput(input);
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
      SELECT event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
             action_type, requested_execution_mode, effective_execution_mode, gate_decision,
             gate_reasons_json, approver, approved_at, recorded_at, created_at
      FROM runtime_gate_audit_records
      ${clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY recorded_at DESC
      LIMIT ?
    `;
        const rows = this.#db.prepare(sql).all(...values);
        return rows.map((row) => ({
            ...row,
            gate_reasons: parseJsonArray(row.gate_reasons_json)
        }));
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
        return {
            approval_id: row.approval_id,
            run_id: row.run_id,
            approved: row.approved === 1,
            approver: row.approver,
            approved_at: row.approved_at,
            checks: Object.fromEntries(Object.entries(parseJsonObject(row.checks_json, {})).map(([key, value]) => [key, value === true])),
            created_at: row.created_at,
            updated_at: row.updated_at
        };
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
      SELECT event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
             action_type, requested_execution_mode, effective_execution_mode, gate_decision,
             gate_reasons_json, approver, approved_at, recorded_at, created_at
      FROM runtime_gate_audit_records
      WHERE event_id = ?
    `)
            .get(eventId);
        if (!row) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate audit record not found");
        }
        return {
            ...row,
            gate_reasons: parseJsonArray(row.gate_reasons_json)
        };
    }
    #assertUpsertRunInput(input) {
        if (!input.runId.trim() || !input.profileName.trim() || !input.command.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "missing required run fields");
        }
        if (input.status !== "running" && input.status !== "succeeded" && input.status !== "failed") {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid run status");
        }
        if (!isIsoLike(input.startedAt) || (input.endedAt !== null && !isIsoLike(input.endedAt))) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid timestamp format");
        }
        if (input.status === "running" && input.endedAt !== null) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "running status must not include ended_at");
        }
        if (input.status !== "running" && input.endedAt === null) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "final status must include ended_at");
        }
    }
    #assertAppendEventInput(input) {
        if (!input.runId.trim() || !input.stage.trim() || !input.component.trim() || !input.eventType.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "missing required event fields");
        }
        if (!isIsoLike(input.eventTime)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid event_time");
        }
    }
    #assertGateApprovalInput(input) {
        if (!input.runId.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
        }
        if (!input.checks || typeof input.checks !== "object") {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "checks is required");
        }
        for (const check of REQUIRED_APPROVAL_CHECKS) {
            if (typeof input.checks[check] !== "boolean") {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", `checks.${check} is required`);
            }
        }
        if (input.approved) {
            if (!input.approver?.trim() || !input.approvedAt || !isIsoLike(input.approvedAt)) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "approved record requires approver and approved_at");
            }
        }
        else if (input.approvedAt !== null && !isIsoLike(input.approvedAt)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid approved_at");
        }
    }
    #assertGateAuditRecordInput(input) {
        if (!input.eventId.trim() ||
            !input.runId.trim() ||
            !input.sessionId.trim() ||
            !input.profile.trim() ||
            !input.riskState.trim() ||
            !input.nextState.trim() ||
            !input.transitionTrigger.trim() ||
            !input.targetDomain.trim() ||
            !input.targetPage.trim() ||
            !input.actionType.trim() ||
            !input.requestedExecutionMode.trim() ||
            !input.effectiveExecutionMode.trim() ||
            !input.gateDecision.trim()) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "missing required gate audit fields");
        }
        if (!Number.isInteger(input.targetTabId) || input.targetTabId <= 0) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid target_tab_id");
        }
        if (!GATE_RISK_STATES.has(input.riskState)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid risk_state");
        }
        if (!GATE_RISK_STATES.has(input.nextState)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid next_state");
        }
        if (!GATE_ACTION_TYPES.has(input.actionType)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid action_type");
        }
        if (!GATE_EXECUTION_MODES.has(input.requestedExecutionMode)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid requested_execution_mode");
        }
        if (!GATE_EXECUTION_MODES.has(input.effectiveExecutionMode)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid effective_execution_mode");
        }
        if (!GATE_DECISIONS.has(input.gateDecision)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid gate_decision");
        }
        if (!Array.isArray(input.gateReasons) || input.gateReasons.length === 0) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "gate_reasons is required");
        }
        for (const reason of input.gateReasons) {
            if (typeof reason !== "string" || reason.trim().length === 0) {
                throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid gate_reasons");
            }
        }
        if (!isIsoLike(input.recordedAt)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid recorded_at");
        }
        const requiresApprovalEvidence = input.gateDecision === "allowed" &&
            (input.requestedExecutionMode === "live_read_limited" ||
                input.requestedExecutionMode === "live_read_high_risk" ||
                input.requestedExecutionMode === "live_write" ||
                input.effectiveExecutionMode === "live_read_limited" ||
                input.effectiveExecutionMode === "live_read_high_risk" ||
                input.effectiveExecutionMode === "live_write");
        if (requiresApprovalEvidence &&
            (!input.approver?.trim() || !input.approvedAt || !isIsoLike(input.approvedAt))) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "allowed record requires approver and approved_at");
        }
        if (input.approvedAt !== null && !isIsoLike(input.approvedAt)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid approved_at");
        }
    }
    #assertListGateAuditInput(input) {
        if (input.runId !== undefined && input.runId.trim().length === 0) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is empty");
        }
        if (input.sessionId !== undefined && input.sessionId.trim().length === 0) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "session_id is empty");
        }
        if (input.profile !== undefined && input.profile.trim().length === 0) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "profile is empty");
        }
        if (input.limit !== undefined &&
            (!Number.isInteger(input.limit) || input.limit <= 0 || input.limit > 100)) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid limit");
        }
    }
}
