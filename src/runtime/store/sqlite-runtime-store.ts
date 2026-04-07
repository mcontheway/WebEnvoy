import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

import { initializeRuntimeStoreSchema } from "./sqlite-runtime-store-schema.js";
import {
  mapGateApprovalRecordRow,
  mapGateAuditRecordRow,
  parseJsonArray,
  parseJsonObject
} from "./sqlite-runtime-store-helpers.js";
import {
  assertAppendRunEventInput,
  assertGateApprovalInput,
  assertGateAuditRecordInput,
  assertListGateAuditInput,
  assertUpsertRunInput
} from "./sqlite-runtime-store-validation.js";

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

export interface UpsertGateApprovalInput {
  runId: string;
  approved: boolean;
  approver: string | null;
  approvedAt: string | null;
  checks: Record<string, boolean>;
}

export interface GateApprovalRecord {
  approval_id: string;
  run_id: string;
  approved: boolean;
  approver: string | null;
  approved_at: string | null;
  checks: Record<string, boolean>;
  created_at: string;
  updated_at: string;
}

export interface AppendGateAuditRecordInput {
  eventId: string;
  runId: string;
  sessionId: string;
  profile: string;
  issueScope: string;
  riskState: string;
  nextState: string;
  transitionTrigger: string;
  targetDomain: string;
  targetTabId: number;
  targetPage: string;
  actionType: string | null;
  requestedExecutionMode: string;
  effectiveExecutionMode: string;
  gateDecision: string;
  gateReasons: string[];
  approver: string | null;
  approvedAt: string | null;
  recordedAt: string;
}

export interface GateAuditRecord {
  event_id: string;
  run_id: string;
  session_id: string;
  profile: string;
  issue_scope: string | null;
  risk_state: string;
  next_state: string;
  transition_trigger: string;
  target_domain: string;
  target_tab_id: number;
  target_page: string;
  action_type: string | null;
  requested_execution_mode: string;
  effective_execution_mode: string;
  gate_decision: string;
  gate_reasons: string[];
  approver: string | null;
  approved_at: string | null;
  recorded_at: string;
  created_at: string;
}

export interface GetAuditTrailByRunIdResult {
  approval_record: GateApprovalRecord | null;
  audit_records: GateAuditRecord[];
}

export interface ListAuditRecordsInput {
  run_id?: string;
  session_id?: string;
  profile?: string;
  limit?: number;
}

export interface ListGateAuditRecordsInput {
  runId?: string;
  sessionId?: string;
  profile?: string;
  limit?: number;
}

export interface GetGateAuditTrailResult {
  approvalRecord: GateApprovalRecord | null;
  auditRecords: GateAuditRecord[];
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

const SUMMARY_MAX_CHARS = 512;
const SQLITE_BUSY_MESSAGE = /SQLITE_BUSY|database is locked/i;
const SQLITE_OPEN_RETRY_LIMIT = 8;
type DatabaseSyncConstructor = new (path: string) => DatabaseSync;
let databaseSyncCtorCache: DatabaseSyncConstructor | null | undefined;

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

const isSqliteBusyError = (error: unknown): error is Error =>
  error instanceof Error && SQLITE_BUSY_MESSAGE.test(error.message);
const invalidRuntimeStoreInput = (message: string): never => {
  throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", message);
};

export const resolveRuntimeStorePath = (cwd: string): string =>
  path.join(cwd, ".webenvoy", "runtime", "store.sqlite");

const sleepSync = (milliseconds: number): void => {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, milliseconds);
};

const resolveDatabaseSyncConstructor = (): DatabaseSyncConstructor => {
  if (databaseSyncCtorCache === null) {
    throw new Error("node:sqlite unavailable");
  }
  if (databaseSyncCtorCache) {
    return databaseSyncCtorCache;
  }

  const require = createRequire(import.meta.url);
  const sqliteModule = require("node:sqlite") as { DatabaseSync?: DatabaseSyncConstructor };
  if (typeof sqliteModule.DatabaseSync !== "function") {
    databaseSyncCtorCache = null;
    throw new Error("node:sqlite DatabaseSync unavailable");
  }
  databaseSyncCtorCache = sqliteModule.DatabaseSync;
  return databaseSyncCtorCache;
};

export class SQLiteRuntimeStore {
  #db!: DatabaseSync;

  constructor(dbPath: string) {
    let lastError: unknown;
    try {
      mkdirSync(path.dirname(dbPath), { recursive: true });
      const DatabaseSyncCtor = resolveDatabaseSyncConstructor();
      for (let attempt = 0; attempt <= SQLITE_OPEN_RETRY_LIMIT; attempt += 1) {
        try {
          this.#db = new DatabaseSyncCtor(dbPath);
          this.#db.exec("PRAGMA busy_timeout=2000;");
          this.#initialize();
          return;
        } catch (error) {
          try {
            this.#db?.close();
          } catch {
            // Ignore cleanup failure in retry loop.
          }
          if (
            error instanceof RuntimeStoreError &&
            error.code === "ERR_RUNTIME_STORE_SCHEMA_MISMATCH"
          ) {
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
    } catch (error) {
      lastError = error;
    }

    if (lastError instanceof RuntimeStoreError) {
      throw lastError;
    }
    throw new RuntimeStoreError("ERR_RUNTIME_STORE_UNAVAILABLE", "runtime store unavailable", {
      cause: lastError
    });
  }

  #initialize(): void {
    initializeRuntimeStoreSchema({
      db: this.#db,
      onSchemaMismatch: (version) =>
        new RuntimeStoreError(
          "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
          `schema mismatch: ${version ?? "unknown"}`
        )
    });
  }

  close(): void {
    this.#db.close();
  }

  #toStoreDbError(error: unknown): RuntimeStoreError {
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

  async upsertRun(input: UpsertRunInput): Promise<UpsertRunResult> {
    assertUpsertRunInput(input, {
      invalidInput: invalidRuntimeStoreInput,
      isIsoLike
    });
    try {
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
            started_at = runtime_runs.started_at,
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
    } catch (error) {
      throw this.#toStoreDbError(error);
    }
  }

  async appendRunEvent(input: AppendRunEventInput): Promise<AppendRunEventResult> {
    assertAppendRunEventInput(input, {
      invalidInput: invalidRuntimeStoreInput,
      isIsoLike
    });
    try {
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
    } catch (error) {
      throw this.#toStoreDbError(error);
    }
  }

  async upsertGateApproval(input: UpsertGateApprovalInput): Promise<GateApprovalRecord> {
    assertGateApprovalInput(input, {
      invalidInput: invalidRuntimeStoreInput,
      isIsoLike
    });
    try {
      const runExists = this.#db
        .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
        .get(input.runId) as { run_id?: string } | undefined;
      if (!runExists) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
      }

      const nowIso = new Date().toISOString();
      const approvalId = `gate_appr_${input.runId}`;
      this.#db
        .prepare(
          `
          INSERT INTO runtime_gate_approvals(
            approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
          ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id) DO UPDATE SET
            approved = excluded.approved,
            approver = excluded.approver,
            approved_at = excluded.approved_at,
            checks_json = excluded.checks_json,
            updated_at = excluded.updated_at
        `
        )
        .run(
          approvalId,
          input.runId,
          input.approved ? 1 : 0,
          input.approver,
          input.approvedAt,
          JSON.stringify(input.checks),
          nowIso,
          nowIso
        );

      return this.#getGateApprovalByRunId(input.runId);
    } catch (error) {
      throw this.#toStoreDbError(error);
    }
  }

  async appendGateAuditRecord(input: AppendGateAuditRecordInput): Promise<GateAuditRecord> {
    assertGateAuditRecordInput(input, {
      invalidInput: invalidRuntimeStoreInput,
      isIsoLike
    });
    try {
      const runExists = this.#db
        .prepare("SELECT run_id FROM runtime_runs WHERE run_id = ?")
        .get(input.runId) as { run_id?: string } | undefined;
      if (!runExists) {
        throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "run not found");
      }

      const createdAt = new Date().toISOString();
      this.#db
        .prepare(
          `
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
        `
        )
        .run(
          input.eventId,
          input.runId,
          input.sessionId,
          input.profile,
          input.issueScope,
          input.riskState,
          input.nextState,
          input.transitionTrigger,
          input.targetDomain,
          input.targetTabId,
          input.targetPage,
          input.actionType,
          input.requestedExecutionMode,
          input.effectiveExecutionMode,
          input.gateDecision,
          JSON.stringify(input.gateReasons),
          input.approver,
          input.approvedAt,
          input.recordedAt,
          createdAt
        );

      return this.#getGateAuditRecordByEventId(input.eventId);
    } catch (error) {
      throw this.#toStoreDbError(error);
    }
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

  async getGateAuditTrail(runId: string): Promise<GetGateAuditTrailResult> {
    if (!runId.trim()) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_INVALID_INPUT", "run_id is required");
    }

    return {
      approvalRecord: this.#getOptionalGateApprovalByRunId(runId),
      auditRecords: this.#listGateAuditRecords({ runId })
    };
  }

  async listGateAuditRecords(input: ListGateAuditRecordsInput): Promise<GateAuditRecord[]> {
    return this.#listGateAuditRecords(input);
  }

  async upsertApprovalRecord(input: UpsertGateApprovalInput): Promise<GateApprovalRecord> {
    return this.upsertGateApproval(input);
  }

  async appendAuditRecord(input: AppendGateAuditRecordInput): Promise<GateAuditRecord> {
    return this.appendGateAuditRecord(input);
  }

  async getAuditTrailByRunId(runId: string): Promise<GetAuditTrailByRunIdResult> {
    const result = await this.getGateAuditTrail(runId);
    return {
      approval_record: result.approvalRecord,
      audit_records: result.auditRecords
    };
  }

  async listAuditRecords(input: ListAuditRecordsInput): Promise<GateAuditRecord[]> {
    return this.#listGateAuditRecords({
      runId: input.run_id,
      sessionId: input.session_id,
      profile: input.profile,
      limit: input.limit
    });
  }

  #listGateAuditRecords(input: ListGateAuditRecordsInput): GateAuditRecord[] {
    assertListGateAuditInput(input, {
      invalidInput: invalidRuntimeStoreInput,
      isIsoLike
    });

    const clauses: string[] = [];
    const values: Array<string | number> = [];

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

    const limit =
      typeof input.limit === "number" && Number.isInteger(input.limit)
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

    const rows = this.#db.prepare(sql).all(...values) as unknown as Array<
      Omit<GateAuditRecord, "gate_reasons"> & { gate_reasons_json: string }
    >;
    return rows.map(mapGateAuditRecordRow);
  }

  #getOptionalGateApprovalByRunId(runId: string): GateApprovalRecord | null {
    const row = this.#db
      .prepare(
        `
      SELECT approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
      FROM runtime_gate_approvals
      WHERE run_id = ?
    `
      )
      .get(runId) as
      | (Omit<GateApprovalRecord, "approved" | "checks"> & {
          approved: number;
          checks_json: string;
        })
      | undefined;

    if (!row) {
      return null;
    }

    return mapGateApprovalRecordRow(row);
  }

  #getGateApprovalByRunId(runId: string): GateApprovalRecord {
    const record = this.#getOptionalGateApprovalByRunId(runId);
    if (!record) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate approval not found");
    }
    return record;
  }

  #getGateAuditRecordByEventId(eventId: string): GateAuditRecord {
    const row = this.#db
      .prepare(
        `
      SELECT event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
             action_type, requested_execution_mode, effective_execution_mode, gate_decision,
             gate_reasons_json, approver, approved_at, recorded_at, created_at
      FROM runtime_gate_audit_records
      WHERE event_id = ?
    `
      )
      .get(eventId) as
      | (Omit<GateAuditRecord, "gate_reasons"> & { gate_reasons_json: string })
      | undefined;

    if (!row) {
      throw new RuntimeStoreError("ERR_RUNTIME_STORE_RUN_NOT_FOUND", "gate audit record not found");
    }

    return mapGateAuditRecordRow(row);
  }
}
