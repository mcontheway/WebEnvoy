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
const SCHEMA_VERSION = 1;
const SUMMARY_MAX_CHARS = 512;
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
        try {
            mkdirSync(path.dirname(dbPath), { recursive: true });
            const DatabaseSyncCtor = resolveDatabaseSyncConstructor();
            this.#db = new DatabaseSyncCtor(dbPath);
            this.#initialize();
        }
        catch (error) {
            if (error instanceof RuntimeStoreError) {
                throw error;
            }
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
                cause: error
            });
        }
    }
    #initialize() {
        this.#db.exec("PRAGMA journal_mode=WAL;");
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
        if (Number(row.value) !== SCHEMA_VERSION) {
            throw new RuntimeStoreError("ERR_RUNTIME_STORE_SCHEMA_MISMATCH", `schema mismatch: ${row.value ?? "unknown"}`);
        }
    }
    close() {
        this.#db.close();
    }
    async upsertRun(input) {
        this.#assertUpsertRunInput(input);
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
          started_at = excluded.started_at,
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
    async appendRunEvent(input) {
        this.#assertAppendEventInput(input);
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
}
