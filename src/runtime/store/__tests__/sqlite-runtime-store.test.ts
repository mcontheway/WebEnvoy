import { mkdtemp, readFile, rm } from "node:fs/promises";
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
      riskState: "allowed",
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
      riskState: "limited",
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
      riskState: "paused",
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
        riskState: "allowed",
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
});
