import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RuntimeStoreError,
  SQLiteRuntimeStore,
  resolveRuntimeStorePath
} from "../sqlite-runtime-store.js";

const tempDirs: string[] = [];
type DatabaseSyncCtor = new (path: string) => {
  prepare: (sql: string) => { run: (...args: unknown[]) => unknown };
  close: () => void;
};

const resolveDatabaseSync = (): DatabaseSyncCtor | null => {
  try {
    const require = createRequire(import.meta.url);
    const sqliteModule = require("node:sqlite") as { DatabaseSync?: DatabaseSyncCtor };
    return typeof sqliteModule.DatabaseSync === "function" ? sqliteModule.DatabaseSync : null;
  } catch {
    return null;
  }
};

const DatabaseSync = resolveDatabaseSync();
const describeWithSqlite = DatabaseSync ? describe : describe.skip;

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const createTempCwd = async (): Promise<string> => {
  const cwd = await mkdtemp(path.join(tmpdir(), "webenvoy-runtime-store-"));
  tempDirs.push(cwd);
  return cwd;
};

describeWithSqlite("sqlite-runtime-store", () => {
  it("initializes schema with WAL and schema version", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);

    const store = new SQLiteRuntimeStore(dbPath);
    await store.upsertRun({
      runId: "run-schema-001",
      sessionId: null,
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });
    store.close();

    const sqliteHeader = await readFile(dbPath, { encoding: "utf8" });
    expect(sqliteHeader.slice(0, 16)).toBe("SQLite format 3\u0000");
  });

  it("upserts run idempotently", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    const first = await store.upsertRun({
      runId: "run-upsert-001",
      sessionId: "sess-1",
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });
    const second = await store.upsertRun({
      runId: "run-upsert-001",
      sessionId: "sess-1",
      profileName: "default",
      command: "runtime.ping",
      status: "succeeded",
      startedAt: "2026-03-19T10:05:00.000Z",
      endedAt: "2026-03-19T10:00:02.000Z",
      errorCode: null
    });

    const trace = await store.getRunTrace("run-upsert-001");
    store.close();

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(trace.run?.status).toBe("succeeded");
    expect(trace.run?.started_at).toBe("2026-03-19T10:00:00.000Z");
    expect(trace.run?.ended_at).toBe("2026-03-19T10:00:02.000Z");
  });

  it("rejects append event when run does not exist", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await expect(
      store.appendRunEvent({
        runId: "run-missing-001",
        eventTime: "2026-03-19T10:00:01.000Z",
        stage: "transport",
        component: "runtime",
        eventType: "failed",
        diagnosisCategory: "runtime_unavailable",
        failurePoint: "bridge.open",
        summary: "connection failed"
      })
    ).rejects.toMatchObject<Partial<RuntimeStoreError>>({
      code: "ERR_RUNTIME_STORE_RUN_NOT_FOUND"
    });
    store.close();
  });

  it("redacts and truncates sensitive summary", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-redact-001",
      sessionId: null,
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });

    const oversized = `authorization=BearerABC cookie=session123 token=abc123 ${"x".repeat(700)}`;
    await store.appendRunEvent({
      runId: "run-redact-001",
      eventTime: "2026-03-19T10:00:01.000Z",
      stage: "transport",
      component: "runtime",
      eventType: "failed",
      diagnosisCategory: "runtime_unavailable",
      failurePoint: "bridge.open",
      summary: oversized
    });

    const trace = await store.getRunTrace("run-redact-001");
    store.close();

    const summary = trace.events[0]?.summary ?? "";
    expect(summary).not.toContain("BearerABC");
    expect(summary).not.toContain("session123");
    expect(summary).not.toContain("abc123");
    expect(summary).toContain("[REDACTED]");
    expect(summary).toContain("[TRUNCATED]");
  });

  it("returns events ordered by event_time", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-order-001",
      sessionId: null,
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });

    await store.appendRunEvent({
      runId: "run-order-001",
      eventTime: "2026-03-19T10:00:03.000Z",
      stage: "command",
      component: "runtime",
      eventType: "succeeded",
      diagnosisCategory: null,
      failurePoint: null,
      summary: "done"
    });
    await store.appendRunEvent({
      runId: "run-order-001",
      eventTime: "2026-03-19T10:00:01.000Z",
      stage: "boot",
      component: "cli",
      eventType: "started",
      diagnosisCategory: null,
      failurePoint: null,
      summary: "start"
    });

    const trace = await store.getRunTrace("run-order-001");
    store.close();

    expect(trace.events.map((event) => event.event_time)).toEqual([
      "2026-03-19T10:00:01.000Z",
      "2026-03-19T10:00:03.000Z"
    ]);
  });

  it("persists approval_record and audit_record and queries by run_id", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-001",
      sessionId: "session-gate-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    await store.upsertApprovalRecord({
      runId: "run-gate-001",
      approved: true,
      approver: "qa-reviewer",
      approvedAt: "2026-03-23T10:00:10.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-001_1",
      runId: "run-gate-001",
      sessionId: "session-gate-1",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "stability_window_passed_and_manual_approve",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 32,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-001");
    store.close();

    expect(trail.approval_record).toMatchObject({
      run_id: "run-gate-001",
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:10.000Z"
    });
    expect(trail.audit_records).toHaveLength(1);
    expect(trail.audit_records[0]).toMatchObject({
      run_id: "run-gate-001",
      session_id: "session-gate-1",
      profile: "profile-a",
      risk_state: "allowed",
      next_state: "allowed",
      transition_trigger: "stability_window_passed_and_manual_approve",
      target_domain: "www.xiaohongshu.com",
      target_tab_id: 32,
      target_page: "search_result_tab",
      action_type: "read",
      requested_execution_mode: "live_read_high_risk",
      effective_execution_mode: "live_read_high_risk",
      gate_decision: "allowed",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
  });

  it("accepts live_read_limited in persisted gate audit records", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-limited-001",
      sessionId: "session-gate-limited-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-limited-001_1",
      runId: "run-gate-limited-001",
      sessionId: "session-gate-limited-1",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "limited",
      nextState: "allowed",
      transitionTrigger: "stability_window_passed_and_manual_approve",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 32,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_limited",
      effectiveExecutionMode: "live_read_limited",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-limited-001");
    store.close();

    expect(trail.audit_records).toHaveLength(1);
    expect(trail.audit_records[0]).toMatchObject({
      run_id: "run-gate-limited-001",
      risk_state: "limited",
      next_state: "allowed",
      transition_trigger: "stability_window_passed_and_manual_approve",
      requested_execution_mode: "live_read_limited",
      effective_execution_mode: "live_read_limited",
      gate_decision: "allowed",
      gate_reasons: ["LIVE_MODE_APPROVED"]
    });
  });

  it("lists audit records by session_id/profile filters", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await store.upsertRun({
      runId: "run-gate-filter-1",
      sessionId: "session-a",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });
    await store.upsertRun({
      runId: "run-gate-filter-2",
      sessionId: "session-b",
      profileName: "profile-b",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:01:00.000Z",
      endedAt: "2026-03-23T10:01:01.000Z",
      errorCode: null
    });

    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-filter-1",
      runId: "run-gate-filter-1",
      sessionId: "session-a",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "limited",
      nextState: "limited",
      transitionTrigger: "gate_evaluation",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 11,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "recon",
      effectiveExecutionMode: "recon",
      gateDecision: "blocked",
      gateReasons: ["DEFAULT_MODE_RECON"],
      approver: null,
      approvedAt: null,
      recordedAt: "2026-03-23T10:00:20.000Z"
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-filter-2",
      runId: "run-gate-filter-2",
      sessionId: "session-b",
      profile: "profile-b",
      issueScope: "issue_209",
      riskState: "paused",
      nextState: "paused",
      transitionTrigger: "gate_evaluation",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 22,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "recon",
      effectiveExecutionMode: "recon",
      gateDecision: "blocked",
      gateReasons: ["DEFAULT_MODE_RECON"],
      approver: null,
      approvedAt: null,
      recordedAt: "2026-03-23T10:01:20.000Z"
    });

    const bySession = await store.listAuditRecords({ session_id: "session-a" });
    const byProfile = await store.listAuditRecords({ profile: "profile-b" });
    store.close();

    expect(bySession).toHaveLength(1);
    expect(bySession[0]?.run_id).toBe("run-gate-filter-1");
    expect(byProfile).toHaveLength(1);
    expect(byProfile[0]?.run_id).toBe("run-gate-filter-2");
  });

  it("rejects allowed audit record without approver/approved_at", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-invalid-001",
      sessionId: "session-gate-invalid",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T11:00:00.000Z",
      endedAt: "2026-03-23T11:00:01.000Z",
      errorCode: null
    });

    await expect(
      store.appendAuditRecord({
        eventId: "gate_evt_run-gate-invalid-001",
        runId: "run-gate-invalid-001",
        sessionId: "session-gate-invalid",
        profile: "profile-a",
        issueScope: "issue_209",
        riskState: "allowed",
        nextState: "allowed",
        transitionTrigger: "stability_window_passed_and_manual_approve",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 33,
        targetPage: "search_result_tab",
        actionType: "read",
        requestedExecutionMode: "live_read_high_risk",
        effectiveExecutionMode: "live_read_high_risk",
        gateDecision: "allowed",
        gateReasons: ["LIVE_MODE_APPROVED"],
        approver: null,
        approvedAt: null,
        recordedAt: "2026-03-23T11:00:02.000Z"
      })
    ).rejects.toMatchObject<Partial<RuntimeStoreError>>({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("rejects allowed live_read_limited audit record without approver/approved_at", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-limited-invalid-001",
      sessionId: "session-gate-limited-invalid",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T11:05:00.000Z",
      endedAt: "2026-03-23T11:05:01.000Z",
      errorCode: null
    });

    await expect(
      store.appendAuditRecord({
        eventId: "gate_evt_run-gate-limited-invalid-001",
        runId: "run-gate-limited-invalid-001",
        sessionId: "session-gate-limited-invalid",
        profile: "profile-a",
        issueScope: "issue_209",
        riskState: "limited",
        nextState: "allowed",
        transitionTrigger: "stability_window_passed_and_manual_approve",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 33,
        targetPage: "search_result_tab",
        actionType: "read",
        requestedExecutionMode: "live_read_limited",
        effectiveExecutionMode: "live_read_limited",
        gateDecision: "allowed",
        gateReasons: ["LIVE_MODE_APPROVED"],
        approver: null,
        approvedAt: null,
        recordedAt: "2026-03-23T11:05:02.000Z"
      })
    ).rejects.toMatchObject<Partial<RuntimeStoreError>>({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("fails on schema mismatch", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const store = new SQLiteRuntimeStore(dbPath);
    store.close();

    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    const db = new DatabaseSyncCtor(dbPath);
    db.prepare("UPDATE runtime_store_meta SET value = '999' WHERE key = 'schema_version'").run();
    db.close();

    expect(() => new SQLiteRuntimeStore(dbPath)).toThrowError(RuntimeStoreError);
  });

  it("backfills issue_scope conservatively when migrating v4 gate audit records", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '4');
      CREATE TABLE runtime_runs (
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
      CREATE TABLE runtime_gate_audit_records (
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
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-read",
      "session-v4-read",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z",
      null,
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-issue209-write",
      "session-v4-issue209-write",
      "profile-c",
      "xhs.search",
      "failed",
      "2026-03-23T10:06:00.000Z",
      "2026-03-23T10:06:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:06:00.000Z",
      "2026-03-23T10:06:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-write",
      "session-v4-write",
      "profile-b",
      "xhs.search",
      "failed",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-live-write",
      "session-v4-live-write",
      "profile-d",
      "xhs.search",
      "succeeded",
      "2026-03-23T10:07:00.000Z",
      "2026-03-23T10:07:01.000Z",
      null,
      "2026-03-23T10:07:00.000Z",
      "2026-03-23T10:07:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-read",
      "run-v4-read",
      "session-v4-read",
      "profile-a",
      "allowed",
      "allowed",
      "stability_window_passed_and_manual_approve",
      "www.xiaohongshu.com",
      11,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:11.000Z",
      "2026-03-23T10:00:11.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-issue209-write",
      "run-v4-issue209-write",
      "session-v4-issue209-write",
      "profile-c",
      "allowed",
      "allowed",
      "gate_evaluation",
      "www.xiaohongshu.com",
      33,
      "search_result_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["RISK_STATE_ALLOWED", "ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:06:11.000Z",
      "2026-03-23T10:06:11.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-write",
      "run-v4-write",
      "session-v4-write",
      "profile-b",
      "paused",
      "paused",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      22,
      "creator_publish_tab",
      "write",
      "live_write",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:05:11.000Z",
      "2026-03-23T10:05:11.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-live-write",
      "run-v4-live-write",
      "session-v4-live-write",
      "profile-d",
      "allowed",
      "allowed",
      "manual_allow_live_write",
      "creator.xiaohongshu.com",
      42,
      "creator_publish_tab",
      "write",
      "live_write",
      "live_write",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T10:07:10.000Z",
      "2026-03-23T10:07:11.000Z",
      "2026-03-23T10:07:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const readTrail = await store.getAuditTrailByRunId("run-v4-read");
    const issue209WriteTrail = await store.getAuditTrailByRunId("run-v4-issue209-write");
    const writeTrail = await store.getAuditTrailByRunId("run-v4-write");
    const liveWriteTrail = await store.getAuditTrailByRunId("run-v4-live-write");
    store.close();

    expect(readTrail.audit_records[0]?.issue_scope).toBe("issue_209");
    expect(issue209WriteTrail.audit_records[0]?.issue_scope).toBe("issue_209");
    expect(writeTrail.audit_records[0]?.issue_scope).toBeNull();
    expect(liveWriteTrail.audit_records[0]?.issue_scope).toBe("issue_208");
  });

  it("backfills issue_scope when migrating v2 gate audit records", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '2');
      CREATE TABLE runtime_runs (
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
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
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
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v2-read",
      "session-v2-read",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z",
      null,
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, target_domain, target_tab_id, target_page, action_type,
        requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v2-read",
      "run-v2-read",
      "session-v2-read",
      "profile-a",
      "www.xiaohongshu.com",
      11,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:11.000Z",
      "2026-03-23T10:00:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v2-read");
    store.close();

    expect(trail.audit_records[0]?.issue_scope).toBe("issue_209");
  });

  it("backfills issue_scope conservatively when migrating v3 gate audit records", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '3');
      CREATE TABLE runtime_runs (
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
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        risk_state TEXT NOT NULL,
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
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v3-write",
      "session-v3-write",
      "profile-b",
      "xhs.search",
      "failed",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, target_domain, target_tab_id, target_page, action_type,
        requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v3-write",
      "run-v3-write",
      "session-v3-write",
      "profile-b",
      "paused",
      "creator.xiaohongshu.com",
      22,
      "creator_publish_tab",
      "write",
      "live_write",
      "dry_run",
      "blocked",
      JSON.stringify(["ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:05:11.000Z",
      "2026-03-23T10:05:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v3-write");
    store.close();

    expect(trail.audit_records[0]?.issue_scope).toBeNull();
  });

  it("keeps ambiguous creator publish legacy write audit records unclassified after v4->v5 migration", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '4');
      CREATE TABLE runtime_runs (
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
      CREATE TABLE runtime_gate_audit_records (
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
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-legacy-ambiguous-write",
      "session-v4-legacy-ambiguous-write",
      "profile-legacy",
      "xhs.search",
      "failed",
      "2026-03-23T10:16:00.000Z",
      "2026-03-23T10:16:01.000Z",
      "ERR_CLI_INVALID_ARGS",
      "2026-03-23T10:16:00.000Z",
      "2026-03-23T10:16:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-legacy-ambiguous-write",
      "run-v4-legacy-ambiguous-write",
      "session-v4-legacy-ambiguous-write",
      "profile-legacy",
      "allowed",
      "allowed",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "dry_run",
      "dry_run",
      "blocked",
      JSON.stringify(["RISK_STATE_ALLOWED", "ISSUE_ACTION_MATRIX_BLOCKED"]),
      null,
      null,
      "2026-03-23T10:16:11.000Z",
      "2026-03-23T10:16:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v4-legacy-ambiguous-write");
    store.close();

    expect(trail.audit_records[0]?.issue_scope).toBeNull();
  });

  it("backfills creator publish legacy live_write execution records to issue_208 after v4->v5 migration", async () => {
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    const DatabaseSyncCtor = DatabaseSync as DatabaseSyncCtor;
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);

    db.prepare("PRAGMA journal_mode=WAL").run();
    db.exec(`
      CREATE TABLE runtime_store_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '4');
      CREATE TABLE runtime_runs (
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
      CREATE TABLE runtime_gate_audit_records (
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
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v4-legacy-live-write",
      "session-v4-legacy-live-write",
      "profile-legacy",
      "xhs.search",
      "succeeded",
      "2026-03-23T10:18:00.000Z",
      "2026-03-23T10:18:01.000Z",
      null,
      "2026-03-23T10:18:00.000Z",
      "2026-03-23T10:18:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v4-legacy-live-write",
      "run-v4-legacy-live-write",
      "session-v4-legacy-live-write",
      "profile-legacy",
      "allowed",
      "allowed",
      "gate_evaluation",
      "creator.xiaohongshu.com",
      52,
      "creator_publish_tab",
      "write",
      "live_write",
      "live_write",
      "allowed",
      JSON.stringify(["APPROVAL_GRANTED", "WRITE_GATE_ONLY_PATH"]),
      "ops-reviewer",
      "2026-03-23T10:18:10.000Z",
      "2026-03-23T10:18:11.000Z",
      "2026-03-23T10:18:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v4-legacy-live-write");
    store.close();

    expect(trail.audit_records[0]?.issue_scope).toBe("issue_208");
  });
});
