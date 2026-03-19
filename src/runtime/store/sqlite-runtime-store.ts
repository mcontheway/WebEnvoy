import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export type RuntimeRunStatus = "running" | "succeeded" | "failed";

export interface UpsertRunInput {
  runId: string;
  sessionId: string | null;
  profileName: string;
  command: string;
  status: RuntimeRunStatus;
  startedAt: string;
  endedAt: string | null;
  errorCode: string | null;
}

export interface UpsertRunResult {
  run_id: string;
  status: RuntimeRunStatus;
  created: boolean;
  updated_at: string;
}

export interface AppendRunEventInput {
  runId: string;
  eventTime: string;
  stage: string;
  component: string;
  eventType: string;
  diagnosisCategory: string | null;
  failurePoint: string | null;
  summary: string | null;
}

export interface AppendRunEventResult {
  run_id: string;
  event_id: number;
  event_time: string;
}

export interface RuntimeRunRecord {
  run_id: string;
  session_id: string | null;
  profile_name: string;
  command: string;
  status: RuntimeRunStatus;
  started_at: string;
  ended_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface RuntimeEventRecord {
  id: number;
  run_id: string;
  event_time: string;
  stage: string;
  component: string;
  event_type: string;
  diagnosis_category: string | null;
  failure_point: string | null;
  summary: string | null;
  created_at: string;
}

export interface GetRunTraceResult {
  run: RuntimeRunRecord | null;
  events: RuntimeEventRecord[];
}

export type RuntimeStoreErrorCode =
  | "ERR_RUNTIME_STORE_UNAVAILABLE"
  | "ERR_RUNTIME_STORE_SCHEMA_MISMATCH"
  | "ERR_RUNTIME_STORE_CONFLICT"
  | "ERR_RUNTIME_STORE_INVALID_INPUT"
  | "ERR_RUNTIME_STORE_RUN_NOT_FOUND";

export class RuntimeStoreError extends Error {
  code: RuntimeStoreErrorCode;

  constructor(code: RuntimeStoreErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeStoreError";
    this.code = code;
  }
}

const SCHEMA_VERSION = 1;
const SUMMARY_MAX_CHARS = 512;

const sanitizeSummary = (summary: string | null): string | null => {
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

const isIsoLike = (value: string): boolean =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);

export const resolveRuntimeStorePath = (cwd: string): string =>
  path.join(cwd, ".webenvoy", "runtime", "store.sqlite");

export class SQLiteRuntimeStore {
  #db: DatabaseSync;

  constructor(dbPath: string) {
    try {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      this.#db = new DatabaseSync(dbPath);
      this.#initialize();
    } catch (error) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
        cause: error
      });
    }
  }

  #initialize(): void {
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
      .get() as { value?: string } | undefined;
    if (!row) {
      this.#db
        .prepare("INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', ?)")
        .run(String(SCHEMA_VERSION));
      return;
    }

    if (Number(row.value) !== SCHEMA_VERSION) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
        `schema mismatch: ${row.value ?? "unknown"}`
      );
    }
  }

  close(): void {
    this.#db.close();
  }

  async upsertRun(input: UpsertRunInput): Promise<UpsertRunResult> {
    this.#assertUpsertRunInput(input);

    const nowIso = new Date().toISOString();
    const existing = this.#db
      .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
      .get(input.runId) as { run_id?: string } | undefined;
    const created = !existing;

    this.#db
      .prepare(
        `
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
      `
      )
      .run(
        input.runId,
        input.sessionId,
        input.profileName,
        input.command,
        input.status,
        input.startedAt,
        input.endedAt,
        input.errorCode,
        nowIso,
        nowIso
      );

    return {
      run_id: input.runId,
      status: input.status,
      created,
      updated_at: nowIso
    };
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<AppendRunEventResult> {
    this.#assertAppendEventInput(input);

    const runExists = this.#db
      .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
      .get(input.runId) as { run_id?: string } | undefined;
    if (!runExists) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
    }

    const eventSummary = sanitizeSummary(input.summary);
    const createdAt = new Date().toISOString();
    const result = this.#db
      .prepare(
        `
      INSERT INTO runtime_events(
        run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        input.runId,
        input.eventTime,
        input.stage,
        input.component,
        input.eventType,
        input.diagnosisCategory,
        input.failurePoint,
        eventSummary,
        createdAt
      );

    return {
      run_id: input.runId,
      event_id: Number(result.lastInsertRowid),
      event_time: input.eventTime
    };
  }

  async getRunTrace(runId: string): Promise<GetRunTraceResult> {
    if (!runId.trim()) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
    }

    const run = this.#db
      .prepare(
        `
      SELECT run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      FROM runtime_runs
      WHERE run_id = ?
    `
      )
      .get(runId) as RuntimeRunRecord | undefined;

    const events = this.#db
      .prepare(
        `
      SELECT id, run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, created_at
      FROM runtime_events
      WHERE run_id = ?
      ORDER BY event_time ASC
    `
      )
      .all(runId) as unknown as RuntimeEventRecord[];

    return {
      run: run ?? null,
      events
    };
  }

  #assertUpsertRunInput(input: UpsertRunInput): void {
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
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "running status must not include ended_at"
      );
    }
    if (input.status !== "running" && input.endedAt === null) {
      throw new RuntimeStoreError(
        "ERR_RUNTIME_STORE_INVALID_INPUT",
        "final status must include ended_at"
      );
    }
  }

  #assertAppendEventInput(input: AppendRunEventInput): void {
    if (!input.runId.trim() || !input.stage.trim() || !input.component.trim() || !input.eventType.trim()) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "missing required event fields");
    }
    if (!isIsoLike(input.eventTime)) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "invalid event_time");
    }
  }
}
