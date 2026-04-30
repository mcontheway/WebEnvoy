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
import { toSessionRhythmStatusView } from "../../xhs-closeout-rhythm.js";

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

const getGeneratedSessionRhythmView = (input: {
  profile: string;
  sessionId?: string | null;
  sourceRunId?: string | null;
}) => toSessionRhythmStatusView({
    profile: input.profile,
    issueScope: "issue_209",
    sessionId: input.sessionId,
    sourceRunId: input.sourceRunId,
    effectiveExecutionMode: "live_read_high_risk"
  }) as {
    session_rhythm_window_state?: {
      window_id?: string;
    };
    session_rhythm_event?: Record<string, unknown>;
    session_rhythm_decision?: Record<string, unknown>;
    stability_window_until?: string | null;
  };

const expectLegacyMigrationAllowsNullActionTypeWrite = async (
  store: SQLiteRuntimeStore,
  input: {
    runId: string;
    sessionId: string;
    profile: string;
    issueScope: string;
    riskState: string;
    nextState: string;
    targetDomain: string;
    targetTabId: number;
    targetPage: string;
    requestedExecutionMode: string;
    effectiveExecutionMode: string;
    gateDecision: string;
  }
) => {
  const appended = await store.appendGateAuditRecord({
    eventId: `evt-null-action-${input.runId}`,
    decisionId: `gate_decision_${input.runId}`,
    approvalId: null,
    runId: input.runId,
    sessionId: input.sessionId,
    profile: input.profile,
    issueScope: input.issueScope,
    riskState: input.riskState,
    nextState: input.nextState,
    transitionTrigger: "gate_evaluation",
    targetDomain: input.targetDomain,
    targetTabId: input.targetTabId,
    targetPage: input.targetPage,
    actionType: null,
    requestedExecutionMode: input.requestedExecutionMode,
    effectiveExecutionMode: input.effectiveExecutionMode,
    gateDecision: input.gateDecision,
    gateReasons: ["ACTION_TYPE_NOT_EXPLICIT", "EXECUTION_MODE_UNSUPPORTED_FOR_COMMAND"],
    approver: null,
    approvedAt: null,
    recordedAt: "2026-03-23T10:59:59.000Z"
  });

  expect(appended.action_type).toBeNull();
};

const seedAntiDetectionValidationRecord = async (
  store: SQLiteRuntimeStore,
  input: {
    targetFrRef?: "FR-0012" | "FR-0013" | "FR-0014";
    validationScope?: "layer1_consistency" | "layer2_interaction" | "layer3_session_rhythm";
    profileRef?: string;
    effectiveExecutionMode?: "live_read_high_risk" | "recon";
    probeBundleRef?: string;
    requestRef?: string;
    sampleRef?: string;
    baselineRef?: string | null;
    activeBaselineRef?: string | null;
    recordRef?: string;
    resultState?: "captured" | "verified" | "broken" | "stale";
    driftState?: "no_drift" | "drift_detected" | "insufficient_baseline";
    validatedAt?: string;
  } = {}
) => {
  const targetFrRef = input.targetFrRef ?? "FR-0012";
  const validationScope = input.validationScope ?? "layer1_consistency";
  const profileRef = input.profileRef ?? "profile/xhs_001";
  const effectiveExecutionMode = input.effectiveExecutionMode ?? "live_read_high_risk";
  const probeBundleRef = input.probeBundleRef ?? "probe-bundle/xhs-closeout-min-v1";
  const requestRef = input.requestRef ?? `validation-request/${targetFrRef}/001`;
  const sampleRef = input.sampleRef ?? `validation-sample/${targetFrRef}/001`;
  const baselineRef = input.baselineRef === undefined ? `baseline/${targetFrRef}/001` : input.baselineRef;
  const recordRef = input.recordRef ?? `validation-record/${targetFrRef}/001`;
  const validatedAt = input.validatedAt ?? "2026-04-25T10:10:00.000Z";
  const scope = {
    targetFrRef,
    validationScope,
    profileRef,
    browserChannel: "Google Chrome stable" as const,
    executionSurface: "real_browser" as const,
    effectiveExecutionMode,
    probeBundleRef
  };

  await store.upsertAntiDetectionValidationRequest({
    requestRef,
    validationScope,
    targetFrRef,
    profileRef,
    browserChannel: "Google Chrome stable",
    executionSurface: "real_browser",
    sampleGoal: `capture ${targetFrRef} closeout baseline`,
    requestedExecutionMode: effectiveExecutionMode,
    probeBundleRef,
    requestState: "accepted",
    requestedAt: "2026-04-25T10:00:00.000Z"
  });
  await store.upsertAntiDetectionValidationRequest({
    requestRef,
    validationScope,
    targetFrRef,
    profileRef,
    browserChannel: "Google Chrome stable",
    executionSurface: "real_browser",
    sampleGoal: `capture ${targetFrRef} closeout baseline`,
    requestedExecutionMode: effectiveExecutionMode,
    probeBundleRef,
    requestState: "completed",
    requestedAt: "2026-04-25T10:00:00.000Z"
  });
  await store.insertAntiDetectionStructuredSample({
    ...scope,
    sampleRef,
    requestRef,
    runId: `run-${recordRef.replace(/[^a-z0-9]+/gi, "-")}`,
    capturedAt: "2026-04-25T10:05:00.000Z",
    structuredPayload: {
      target_fr_ref: targetFrRef,
      signal: "stable"
    },
    artifactRefs: []
  });
  if (baselineRef) {
    await store.insertAntiDetectionBaselineSnapshot({
      ...scope,
      baselineRef,
      signalVector: {
        stable: true
      },
      capturedAt: "2026-04-25T10:06:00.000Z",
      sourceSampleRefs: [sampleRef],
      sourceRunIds: [`run-${recordRef.replace(/[^a-z0-9]+/gi, "-")}`]
    });
  }
  await store.insertAntiDetectionValidationRecord({
    ...scope,
    recordRef,
    requestRef,
    sampleRef,
    baselineRef,
    resultState: input.resultState ?? "verified",
    driftState: input.driftState ?? "no_drift",
    failureClass: null,
    runId: `run-${recordRef.replace(/[^a-z0-9]+/gi, "-")}`,
    validatedAt
  });
  if (input.activeBaselineRef !== null && baselineRef) {
    await store.upsertAntiDetectionBaselineRegistryEntry({
      ...scope,
      activeBaselineRef: input.activeBaselineRef ?? baselineRef,
      supersededBaselineRefs:
        input.activeBaselineRef && input.activeBaselineRef !== baselineRef ? [baselineRef] : [],
      replacementReason: input.activeBaselineRef && input.activeBaselineRef !== baselineRef
        ? "manual_reseed"
        : "initial_seed",
      updatedAt: "2026-04-25T10:07:00.000Z"
    });
  }

  return scope;
};

describeWithSqlite("sqlite-runtime-store", () => {
  it("keeps FR-0014 rhythm windows profile-scoped while retaining run/session ids", () => {
    const firstView = getGeneratedSessionRhythmView({
      profile: "xhs_001",
      sessionId: "nm-session-001",
      sourceRunId: "run-session-window-001"
    });
    const secondView = getGeneratedSessionRhythmView({
      profile: "xhs_001",
      sessionId: "nm-session-002",
      sourceRunId: "run-session-window-002"
    });
    const missingIdsView = getGeneratedSessionRhythmView({
      profile: "xhs_001",
      sessionId: null,
      sourceRunId: null
    });

    expect(firstView.session_rhythm_window_state?.window_id).toBe(
      "rhythm_win_xhs_001_issue_209"
    );
    expect(secondView.session_rhythm_window_state?.window_id).toBe(
      "rhythm_win_xhs_001_issue_209"
    );
    expect(missingIdsView.session_rhythm_window_state).toBeUndefined();
    expect(missingIdsView.session_rhythm_event).toBeUndefined();
    expect(missingIdsView.session_rhythm_decision).toBeUndefined();
    const steadyView = toSessionRhythmStatusView({
      profile: "xhs_001",
      issueScope: "issue_209",
      sessionId: "nm-session-003",
      sourceRunId: "run-session-window-003",
      effectiveExecutionMode: "live_read_high_risk",
      rhythm: {
        state: "single_probe_passed",
        cooldownUntil: null,
        operatorConfirmedAt: "2026-04-25T10:35:00.000Z",
        singleProbeRequired: false,
        singleProbePassedAt: "2026-04-25T10:40:00.000Z",
        probeRunId: "run-session-window-003",
        fullBundleBlocked: true,
        reasonCodes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"]
      },
      now: new Date("2026-04-25T10:45:00.000Z")
    }) as { stability_window_until?: string | null };
    expect(steadyView.stability_window_until).toBe("2026-04-25T11:00:00.000Z");
  });

  it("persists FR-0014 session rhythm window event and decision view", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    try {
      const view = await store.recordSessionRhythmStatusView({
        profile: "xhs_001",
        platform: "xhs",
        issueScope: "issue_209",
        windowState: {
          window_id: "rhythm_win_xhs_001_issue_209",
          profile: "xhs_001",
          platform: "xhs",
          issue_scope: "issue_209",
          session_id: "nm-session-001",
          current_phase: "recovery_probe",
          risk_state: "limited",
          window_started_at: "2026-04-25T10:35:00.000Z",
          window_deadline_at: "2026-04-25T10:55:00.000Z",
          cooldown_until: null,
          recovery_probe_due_at: "2026-04-25T10:35:00.000Z",
          stability_window_until: "2026-04-25T11:00:00.000Z",
          risk_signal_count: 0,
          last_event_id: "rhythm_evt_run-probe-001",
          source_run_id: "run-probe-001",
          updated_at: "2026-04-25T10:40:00.000Z"
        },
        event: {
          event_id: "rhythm_evt_run-probe-001",
          profile: "xhs_001",
          platform: "xhs",
          issue_scope: "issue_209",
          session_id: "nm-session-001",
          window_id: "rhythm_win_xhs_001_issue_209",
          event_type: "recovery_probe_passed",
          phase_before: "recovery_probe",
          phase_after: "steady",
          risk_state_before: "limited",
          risk_state_after: "limited",
          source_audit_event_id: "gate_evt_probe",
          reason: "XHS_RECOVERY_SINGLE_PROBE_PASSED",
          recorded_at: "2026-04-25T10:40:00.000Z"
        },
        decision: {
          decision_id: "rhythm_decision_run-probe-001",
          window_id: "rhythm_win_xhs_001_issue_209",
          run_id: "run-probe-001",
          session_id: "nm-session-001",
          profile: "xhs_001",
          current_phase: "recovery_probe",
          current_risk_state: "limited",
          next_phase: "steady",
          next_risk_state: "limited",
          effective_execution_mode: "recon",
          decision: "allowed",
          reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"],
          requires: ["audit_record_present"],
          decided_at: "2026-04-25T10:40:00.000Z"
        }
      });

      expect(view).toMatchObject({
        window_state: {
          window_id: "rhythm_win_xhs_001_issue_209",
          source_run_id: "run-probe-001"
        },
        event: {
          event_id: "rhythm_evt_run-probe-001",
          source_audit_event_id: "gate_evt_probe"
        },
        decision: {
          decision_id: "rhythm_decision_run-probe-001",
          decision: "allowed",
          reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"]
        }
      });
      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toMatchObject(view);

      await store.recordSessionRhythmStatusView({
        profile: "xhs_001",
        platform: "xhs",
        issueScope: "issue_209",
        windowState: {
          ...view.window_state,
          session_id: "nm-session-001",
          current_phase: "steady",
          updated_at: "2026-04-25T10:45:00.000Z"
        },
        event: {
          ...view.event,
          source_audit_event_id: "gate_evt_probe_overwrite_attempt",
          reason: "OVERWRITE_ATTEMPT",
          recorded_at: "2026-04-25T10:45:00.000Z"
        },
        decision: {
          ...view.decision,
          decision: "blocked",
          reason_codes: ["OVERWRITE_ATTEMPT"],
          requires: ["should_not_replace_existing_decision"],
          decided_at: "2026-04-25T10:45:00.000Z"
        }
      });
      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toMatchObject({
        window_state: {
          session_id: "nm-session-001",
          current_phase: "steady"
        },
        event: {
          event_id: "rhythm_evt_run-probe-001",
          session_id: "nm-session-001",
          source_audit_event_id: "gate_evt_probe",
          reason: "XHS_RECOVERY_SINGLE_PROBE_PASSED"
        },
        decision: {
          decision_id: "rhythm_decision_run-probe-001",
          session_id: "nm-session-001",
          current_phase: "recovery_probe",
          decision: "allowed",
          reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"]
        }
      });
    } finally {
      store.close();
    }
  });

  it("migrates v12 rhythm windows into profile-scoped writable windows", async () => {
    const DatabaseSyncCtor = DatabaseSync;
    expect(DatabaseSyncCtor).toBeTruthy();
    if (!DatabaseSyncCtor) {
      return;
    }
    const cwd = await createTempCwd();
    const dbPath = resolveRuntimeStorePath(cwd);
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new DatabaseSyncCtor(dbPath);
    try {
      db.exec(`
        CREATE TABLE runtime_store_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '12');
        CREATE TABLE session_rhythm_window_state (
          window_id TEXT PRIMARY KEY,
          profile TEXT NOT NULL,
          platform TEXT NOT NULL,
          issue_scope TEXT NOT NULL,
          session_id TEXT,
          current_phase TEXT NOT NULL,
          risk_state TEXT NOT NULL,
          window_started_at TEXT,
          window_deadline_at TEXT,
          cooldown_until TEXT,
          recovery_probe_due_at TEXT,
          stability_window_until TEXT,
          risk_signal_count INTEGER NOT NULL DEFAULT 0,
          last_event_id TEXT,
          source_run_id TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(profile, platform, issue_scope)
        );
        INSERT INTO session_rhythm_window_state(
          window_id, profile, platform, issue_scope, session_id, current_phase, risk_state,
          window_started_at, window_deadline_at, cooldown_until, recovery_probe_due_at,
          stability_window_until, risk_signal_count, last_event_id, source_run_id, updated_at
        ) VALUES(
          'rhythm_win_legacy_session_001', 'xhs_001', 'xhs', 'issue_209',
          'nm-session-legacy-001', 'steady', 'limited',
          '2026-04-25T10:00:00.000Z', '2026-04-25T10:30:00.000Z',
          NULL, NULL, '2026-04-25T10:30:00.000Z', 0, NULL,
          'run-legacy-session-001', '2026-04-25T10:00:00.000Z'
        );
      `);
    } finally {
      db.close();
    }

    const store = new SQLiteRuntimeStore(dbPath);
    try {
      await store.recordSessionRhythmStatusView({
        profile: "xhs_001",
        platform: "xhs",
        issueScope: "issue_209",
        windowState: {
          window_id: "rhythm_win_legacy_session_002",
          profile: "xhs_001",
          platform: "xhs",
          issue_scope: "issue_209",
          session_id: "nm-session-legacy-002",
          current_phase: "recovery_probe",
          risk_state: "limited",
          window_started_at: "2026-04-25T10:35:00.000Z",
          window_deadline_at: "2026-04-25T10:55:00.000Z",
          cooldown_until: null,
          recovery_probe_due_at: "2026-04-25T10:35:00.000Z",
          stability_window_until: "2026-04-25T11:00:00.000Z",
          risk_signal_count: 0,
          last_event_id: "rhythm_evt_legacy_session_002",
          source_run_id: "run-legacy-session-002",
          updated_at: "2026-04-25T10:40:00.000Z"
        },
        event: {
          event_id: "rhythm_evt_legacy_session_002",
          profile: "xhs_001",
          platform: "xhs",
          issue_scope: "issue_209",
          session_id: "nm-session-legacy-002",
          window_id: "rhythm_win_legacy_session_002",
          event_type: "recovery_probe_passed",
          phase_before: "recovery_probe",
          phase_after: "steady",
          risk_state_before: "limited",
          risk_state_after: "limited",
          source_audit_event_id: null,
          reason: "XHS_RECOVERY_SINGLE_PROBE_PASSED",
          recorded_at: "2026-04-25T10:40:00.000Z"
        },
        decision: {
          decision_id: "rhythm_decision_legacy_session_002",
          window_id: "rhythm_win_legacy_session_002",
          run_id: "run-legacy-session-002",
          session_id: "nm-session-legacy-002",
          profile: "xhs_001",
          current_phase: "recovery_probe",
          current_risk_state: "limited",
          next_phase: "steady",
          next_risk_state: "limited",
          effective_execution_mode: "live_read_high_risk",
          decision: "allowed",
          reason_codes: ["XHS_RECOVERY_SINGLE_PROBE_PASSED"],
          requires: [],
          decided_at: "2026-04-25T10:40:00.000Z"
        }
      });

      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209",
          sessionId: "nm-session-legacy-001"
        })
      ).resolves.toMatchObject({
        window_state: {
          window_id: "rhythm_win_legacy_session_002",
          session_id: "nm-session-legacy-002"
        }
      });
      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209",
          sessionId: "nm-session-legacy-002"
        })
      ).resolves.toMatchObject({
        window_state: {
          window_id: "rhythm_win_legacy_session_002",
          session_id: "nm-session-legacy-002"
        }
      });
    } finally {
      store.close();
    }
  }, 15000);

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

  it("rejects non-contract FR-0014 risk states and missing decision effective mode", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const baseInput = {
      profile: "xhs_001",
      platform: "xhs",
      issueScope: "issue_209",
      windowState: {
        window_id: "rhythm_win_xhs_001_issue_209",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-001",
        current_phase: "cooldown",
        risk_state: "paused",
        window_started_at: "2026-04-25T10:35:00.000Z",
        window_deadline_at: "2026-04-25T10:55:00.000Z",
        cooldown_until: "2026-04-25T10:55:00.000Z",
        recovery_probe_due_at: "2026-04-25T10:55:00.000Z",
        stability_window_until: null,
        risk_signal_count: 1,
        last_event_id: "rhythm_evt_risk-001",
        source_run_id: "run-risk-001",
        updated_at: "2026-04-25T10:40:00.000Z"
      },
      event: {
        event_id: "rhythm_evt_risk-001",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-001",
        window_id: "rhythm_win_xhs_001_issue_209",
        event_type: "risk_signal",
        phase_before: "steady",
        phase_after: "cooldown",
        risk_state_before: "limited",
        risk_state_after: "paused",
        source_audit_event_id: "gate_evt_risk",
        reason: "ACCOUNT_RISK_RECOVERY_REQUIRED",
        recorded_at: "2026-04-25T10:40:00.000Z"
      },
      decision: {
        decision_id: "rhythm_decision_risk-001",
        window_id: "rhythm_win_xhs_001_issue_209",
        run_id: "run-risk-001",
        session_id: "nm-session-001",
        profile: "xhs_001",
        current_phase: "cooldown",
        current_risk_state: "paused",
        next_phase: "cooldown",
        next_risk_state: "paused",
        effective_execution_mode: "live_read_high_risk",
        decision: "blocked",
        reason_codes: ["ACCOUNT_RISK_RECOVERY_REQUIRED"],
        requires: ["cooldown_until_elapsed"],
        decided_at: "2026-04-25T10:40:00.000Z"
      }
    };
    try {
      await expect(
        store.recordSessionRhythmStatusView({
          ...baseInput,
          windowState: {
            ...baseInput.windowState,
            risk_state: "blocked"
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });
      await expect(
        store.recordSessionRhythmStatusView({
          ...baseInput,
          decision: {
            ...baseInput.decision,
            effective_execution_mode: null
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });
      await expect(
        store.recordSessionRhythmStatusView({
          ...baseInput,
          windowState: {
            ...baseInput.windowState,
            current_phase: "paused"
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });
      await expect(
        store.recordSessionRhythmStatusView({
          ...baseInput,
          event: {
            ...baseInput.event,
            event_type: "manual_override"
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });
      await expect(
        store.recordSessionRhythmStatusView({
          ...baseInput,
          decision: {
            ...baseInput.decision,
            decision: "rollback"
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });
    } finally {
      store.close();
    }
  });

  it("rolls back FR-0014 rhythm writes when the decision row is invalid", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    try {
      await expect(
        store.recordSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209",
          windowState: {
            window_id: "rhythm_win_atomic_issue_209",
            profile: "xhs_001",
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-atomic",
            current_phase: "cooldown",
            risk_state: "paused",
            window_started_at: "2026-04-25T10:35:00.000Z",
            window_deadline_at: "2026-04-25T10:55:00.000Z",
            cooldown_until: "2026-04-25T10:55:00.000Z",
            recovery_probe_due_at: "2026-04-25T10:55:00.000Z",
            stability_window_until: null,
            risk_signal_count: 1,
            last_event_id: "rhythm_evt_atomic",
            source_run_id: "run-atomic",
            updated_at: "2026-04-25T10:40:00.000Z"
          },
          event: {
            event_id: "rhythm_evt_atomic",
            profile: "xhs_001",
            platform: "xhs",
            issue_scope: "issue_209",
            session_id: "nm-session-atomic",
            window_id: "rhythm_win_atomic_issue_209",
            event_type: "risk_signal",
            phase_before: "steady",
            phase_after: "cooldown",
            risk_state_before: "limited",
            risk_state_after: "paused",
            source_audit_event_id: "gate_evt_atomic",
            reason: "ACCOUNT_RISK_RECOVERY_REQUIRED",
            recorded_at: "2026-04-25T10:40:00.000Z"
          },
          decision: {
            decision_id: "rhythm_decision_atomic",
            window_id: "rhythm_win_atomic_issue_209",
            run_id: "run-atomic",
            session_id: "nm-session-atomic",
            profile: "xhs_001",
            current_phase: "cooldown",
            current_risk_state: "paused",
            next_phase: "cooldown",
            next_risk_state: "paused",
            effective_execution_mode: "invalid_mode",
            decision: "blocked",
            reason_codes: ["ACCOUNT_RISK_RECOVERY_REQUIRED"],
            requires: ["cooldown_until_elapsed"],
            decided_at: "2026-04-25T10:40:00.000Z"
          }
        })
      ).rejects.toMatchObject({ code: "ERR_RUNTIME_STORE_INVALID_INPUT" });

      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toBeNull();
    } finally {
      store.close();
    }
  });

  it("preserves newer conservative FR-0014 rhythm windows from stale overwrites", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const conservativeInput = {
      profile: "xhs_001",
      platform: "xhs",
      issueScope: "issue_209",
      windowState: {
        window_id: "rhythm_win_xhs_001_issue_209",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-newer",
        current_phase: "cooldown",
        risk_state: "paused",
        window_started_at: "2026-04-25T10:35:00.000Z",
        window_deadline_at: "2026-04-25T11:05:00.000Z",
        cooldown_until: "2026-04-25T11:05:00.000Z",
        recovery_probe_due_at: "2026-04-25T11:05:00.000Z",
        stability_window_until: null,
        risk_signal_count: 1,
        last_event_id: "rhythm_evt_newer_cooldown",
        source_run_id: "run-newer-cooldown",
        updated_at: "2026-04-25T10:45:00.000Z"
      },
      event: {
        event_id: "rhythm_evt_newer_cooldown",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-newer",
        window_id: "rhythm_win_xhs_001_issue_209",
        event_type: "cooldown_started",
        phase_before: "steady",
        phase_after: "cooldown",
        risk_state_before: "limited",
        risk_state_after: "paused",
        source_audit_event_id: "gate_evt_newer_cooldown",
        reason: "ACCOUNT_RISK_RECOVERY_REQUIRED",
        recorded_at: "2026-04-25T10:45:00.000Z"
      },
      decision: {
        decision_id: "rhythm_decision_newer_cooldown",
        window_id: "rhythm_win_xhs_001_issue_209",
        run_id: "run-newer-cooldown",
        session_id: "nm-session-newer",
        profile: "xhs_001",
        current_phase: "cooldown",
        current_risk_state: "paused",
        next_phase: "cooldown",
        next_risk_state: "paused",
        effective_execution_mode: "recon",
        decision: "blocked",
        reason_codes: ["ACCOUNT_RISK_RECOVERY_REQUIRED"],
        requires: ["cooldown_until_elapsed"],
        decided_at: "2026-04-25T10:45:00.000Z"
      }
    };
    try {
      await store.recordSessionRhythmStatusView(conservativeInput);
      await store.recordSessionRhythmStatusView({
        ...conservativeInput,
        windowState: {
          ...conservativeInput.windowState,
          window_id: "rhythm_win_xhs_001_issue_209_stale",
          session_id: "nm-session-stale",
          current_phase: "steady",
          risk_state: "limited",
          cooldown_until: null,
          last_event_id: "rhythm_evt_stale_steady",
          source_run_id: "run-stale-steady",
          updated_at: "2026-04-25T10:40:00.000Z"
        },
        event: {
          ...conservativeInput.event,
          event_id: "rhythm_evt_stale_steady",
          session_id: "nm-session-stale",
          window_id: "rhythm_win_xhs_001_issue_209_stale",
          event_type: "stability_window_passed",
          phase_before: "steady",
          phase_after: "steady",
          risk_state_before: "limited",
          risk_state_after: "limited",
          reason: "STALE_STEADY_WRITE",
          recorded_at: "2026-04-25T10:40:00.000Z"
        },
        decision: {
          ...conservativeInput.decision,
          decision_id: "rhythm_decision_stale_steady",
          window_id: "rhythm_win_xhs_001_issue_209_stale",
          run_id: "run-stale-steady",
          session_id: "nm-session-stale",
          current_phase: "steady",
          current_risk_state: "limited",
          next_phase: "steady",
          next_risk_state: "limited",
          decision: "allowed",
          reason_codes: ["STALE_STEADY_WRITE"],
          requires: [],
          decided_at: "2026-04-25T10:40:00.000Z"
        }
      });

      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toMatchObject({
        window_state: {
          current_phase: "cooldown",
          risk_state: "paused",
          last_event_id: "rhythm_evt_newer_cooldown"
        }
      });
    } finally {
      store.close();
    }
  });

  it("backfills missing FR-0014 rhythm event audit links without overwriting existing links", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const input = {
      profile: "xhs_001",
      platform: "xhs",
      issueScope: "issue_209",
      windowState: {
        window_id: "rhythm_win_xhs_001_issue_209",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-001",
        current_phase: "steady",
        risk_state: "limited",
        window_started_at: "2026-04-25T10:35:00.000Z",
        window_deadline_at: "2026-04-25T10:55:00.000Z",
        cooldown_until: null,
        recovery_probe_due_at: null,
        stability_window_until: "2026-04-25T10:55:00.000Z",
        risk_signal_count: 0,
        last_event_id: "rhythm_evt_run-current-001",
        source_run_id: "run-current-001",
        updated_at: "2026-04-25T10:40:00.000Z"
      },
      event: {
        event_id: "rhythm_evt_run-current-001",
        profile: "xhs_001",
        platform: "xhs",
        issue_scope: "issue_209",
        session_id: "nm-session-001",
        window_id: "rhythm_win_xhs_001_issue_209",
        event_type: "stability_window_passed",
        phase_before: "steady",
        phase_after: "steady",
        risk_state_before: "limited",
        risk_state_after: "limited",
        source_audit_event_id: null,
        reason: "SESSION_RHYTHM_STATUS_OBSERVED",
        recorded_at: "2026-04-25T10:40:00.000Z"
      },
      decision: {
        decision_id: "rhythm_decision_run-current-001",
        window_id: "rhythm_win_xhs_001_issue_209",
        run_id: "run-current-001",
        session_id: "nm-session-001",
        profile: "xhs_001",
        current_phase: "steady",
        current_risk_state: "limited",
        next_phase: "steady",
        next_risk_state: "limited",
        effective_execution_mode: "live_read_high_risk",
        decision: "allowed",
        reason_codes: ["SESSION_RHYTHM_STATUS_OBSERVED"],
        requires: [],
        decided_at: "2026-04-25T10:40:00.000Z"
      }
    };
    try {
      await store.recordSessionRhythmStatusView(input);
      await store.recordSessionRhythmStatusView({
        ...input,
        event: {
          ...input.event,
          source_audit_event_id: "gate_evt_current",
          reason: "OVERWRITE_ATTEMPT"
        }
      });
      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toMatchObject({
        event: {
          event_id: "rhythm_evt_run-current-001",
          source_audit_event_id: "gate_evt_current",
          reason: "SESSION_RHYTHM_STATUS_OBSERVED"
        }
      });
      await store.recordSessionRhythmStatusView({
        ...input,
        event: {
          ...input.event,
          source_audit_event_id: "gate_evt_late_overwrite"
        }
      });
      await expect(
        store.getSessionRhythmStatusView({
          profile: "xhs_001",
          platform: "xhs",
          issueScope: "issue_209"
        })
      ).resolves.toMatchObject({
        event: {
          source_audit_event_id: "gate_evt_current"
        }
      });
    } finally {
      store.close();
    }
  });

  it("projects FR-0020 anti-detection validation views from exact scoped records", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await expect(
      store.getAntiDetectionValidationView({
        ...scope,
        effectiveExecutionMode: "recon"
      })
    ).resolves.toBeNull();

    await expect(store.getAntiDetectionValidationView(scope)).resolves.toMatchObject({
      target_fr_ref: "FR-0012",
      validation_scope: "layer1_consistency",
      profile_ref: "profile/xhs_001",
      browser_channel: "Google Chrome stable",
      execution_surface: "real_browser",
      effective_execution_mode: "live_read_high_risk",
      probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1",
      latest_record_ref: "validation-record/FR-0012/001",
      baseline_status: "ready",
      current_result_state: "verified",
      current_drift_state: "no_drift",
      last_success_at: "2026-04-25T10:10:00.000Z"
    });

    await store.insertAntiDetectionBaselineSnapshot({
      ...scope,
      baselineRef: "baseline/FR-0012/002",
      signalVector: { stable: true, reseeded: true },
      capturedAt: "2026-04-25T11:00:00.000Z",
      sourceSampleRefs: ["validation-sample/FR-0012/001"],
      sourceRunIds: ["run-validation-record-FR-0012-001"]
    });
    await store.upsertAntiDetectionBaselineRegistryEntry({
      ...scope,
      activeBaselineRef: "baseline/FR-0012/002",
      supersededBaselineRefs: ["baseline/FR-0012/001"],
      replacementReason: "manual_reseed",
      updatedAt: "2026-04-25T11:01:00.000Z"
    });

    await expect(store.getAntiDetectionValidationView(scope)).resolves.toMatchObject({
      latest_record_ref: "validation-record/FR-0012/001",
      baseline_status: "superseded",
      current_result_state: "stale",
      current_drift_state: "insufficient_baseline"
    });
    store.close();
  });

  it("keeps anti-detection validation view insufficient when no active baseline exists", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store, {
      targetFrRef: "FR-0013",
      validationScope: "layer2_interaction",
      requestRef: "validation-request/FR-0013/001",
      sampleRef: "validation-sample/FR-0013/001",
      baselineRef: null,
      activeBaselineRef: null,
      recordRef: "validation-record/FR-0013/001",
      resultState: "captured",
      driftState: "insufficient_baseline"
    });

    await expect(store.getAntiDetectionValidationView(scope)).resolves.toMatchObject({
      latest_record_ref: "validation-record/FR-0013/001",
      baseline_status: "insufficient",
      current_result_state: "captured",
      current_drift_state: "insufficient_baseline",
      last_success_at: null
    });
    store.close();
  });

  it("rejects anti-detection validation links when referenced records use another scope", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await store.upsertAntiDetectionValidationRequest({
      requestRef: "validation-request/FR-0012/stub",
      validationScope: "layer1_consistency",
      targetFrRef: "FR-0012",
      profileRef: "profile/xhs_001",
      browserChannel: "Google Chrome stable",
      executionSurface: "stub",
      sampleGoal: "capture invalid stub baseline",
      requestedExecutionMode: "live_read_high_risk",
      probeBundleRef: "probe-bundle/xhs-closeout-min-v1",
      requestState: "accepted",
      requestedAt: "2026-04-25T10:00:00.000Z"
    });

    await expect(
      store.insertAntiDetectionStructuredSample({
        ...scope,
        sampleRef: "validation-sample/FR-0012/scope-mismatch",
        requestRef: "validation-request/FR-0012/stub",
        runId: "run-scope-mismatch",
        capturedAt: "2026-04-25T10:15:00.000Z",
        structuredPayload: { target_fr_ref: "FR-0012", stable: true },
        artifactRefs: []
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });

    await store.insertAntiDetectionStructuredSample({
      ...scope,
      sampleRef: "validation-sample/FR-0012/stub",
      requestRef: "validation-request/FR-0012/stub",
      executionSurface: "stub",
      runId: "run-stub-sample",
      capturedAt: "2026-04-25T10:16:00.000Z",
      structuredPayload: { target_fr_ref: "FR-0012", stable: true },
      artifactRefs: []
    });

    await expect(
      store.insertAntiDetectionBaselineSnapshot({
        ...scope,
        baselineRef: "baseline/FR-0012/scope-mismatch",
        signalVector: { stable: true },
        capturedAt: "2026-04-25T10:17:00.000Z",
        sourceSampleRefs: ["validation-sample/FR-0012/stub"],
        sourceRunIds: ["run-stub-sample"]
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("rejects anti-detection ref reuse across immutable validation scopes", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await store.upsertAntiDetectionValidationRequest({
      requestRef: "validation-request/FR-0012/other-profile",
      validationScope: "layer1_consistency",
      targetFrRef: "FR-0012",
      profileRef: "profile/other_xhs",
      browserChannel: "Google Chrome stable",
      executionSurface: "real_browser",
      sampleGoal: "capture other profile baseline",
      requestedExecutionMode: "live_read_high_risk",
      probeBundleRef: "probe-bundle/xhs-closeout-min-v1",
      requestState: "accepted",
      requestedAt: "2026-04-25T10:20:00.000Z"
    });

    await expect(
      store.insertAntiDetectionStructuredSample({
        ...scope,
        profileRef: "profile/other_xhs",
        sampleRef: "validation-sample/FR-0012/001",
        requestRef: "validation-request/FR-0012/other-profile",
        runId: "run-other-profile-sample",
        capturedAt: "2026-04-25T10:21:00.000Z",
        structuredPayload: { target_fr_ref: "FR-0012", stable: true },
        artifactRefs: []
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });

    const otherScope = {
      ...scope,
      profileRef: "profile/other_xhs"
    };
    await store.insertAntiDetectionStructuredSample({
      ...otherScope,
      sampleRef: "validation-sample/FR-0012/other-profile",
      requestRef: "validation-request/FR-0012/other-profile",
      runId: "run-other-profile-sample",
      capturedAt: "2026-04-25T10:22:00.000Z",
      structuredPayload: { target_fr_ref: "FR-0012", stable: true },
      artifactRefs: []
    });

    await expect(
      store.insertAntiDetectionBaselineSnapshot({
        ...otherScope,
        baselineRef: "baseline/FR-0012/001",
        signalVector: { stable: true, other_profile: true },
        capturedAt: "2026-04-25T10:23:00.000Z",
        sourceSampleRefs: ["validation-sample/FR-0012/other-profile"],
        sourceRunIds: ["run-other-profile-sample"]
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });

    await store.insertAntiDetectionBaselineSnapshot({
      ...otherScope,
      baselineRef: "baseline/FR-0012/other-profile",
      signalVector: { stable: true, other_profile: true },
      capturedAt: "2026-04-25T10:24:00.000Z",
      sourceSampleRefs: ["validation-sample/FR-0012/other-profile"],
      sourceRunIds: ["run-other-profile-sample"]
    });

    await expect(
      store.insertAntiDetectionValidationRecord({
        ...otherScope,
        recordRef: "validation-record/FR-0012/001",
        requestRef: "validation-request/FR-0012/other-profile",
        sampleRef: "validation-sample/FR-0012/other-profile",
        baselineRef: "baseline/FR-0012/other-profile",
        resultState: "verified",
        driftState: "no_drift",
        failureClass: null,
        runId: "run-other-profile-record",
        validatedAt: "2026-04-25T10:25:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });

    await expect(store.getAntiDetectionValidationView(scope)).resolves.toMatchObject({
      baseline_status: "ready",
      current_result_state: "verified",
      current_drift_state: "no_drift"
    });
    store.close();
  });

  it("keeps anti-detection validation records append-only for the same record_ref", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await expect(
      store.insertAntiDetectionValidationRecord({
        ...scope,
        recordRef: "validation-record/FR-0012/001",
        requestRef: "validation-request/FR-0012/001",
        sampleRef: "validation-sample/FR-0012/001",
        baselineRef: "baseline/FR-0012/001",
        resultState: "verified",
        driftState: "no_drift",
        failureClass: null,
        runId: "run-validation-record-rewrite-001",
        validatedAt: "2026-04-25T10:30:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("keeps anti-detection baseline snapshots append-only for the same baseline_ref", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await expect(
      store.insertAntiDetectionBaselineSnapshot({
        ...scope,
        baselineRef: "baseline/FR-0012/001",
        signalVector: { stable: false, rewritten: true },
        capturedAt: "2026-04-25T10:30:00.000Z",
        sourceSampleRefs: ["validation-sample/FR-0012/001"],
        sourceRunIds: ["run-validation-baseline-rewrite-001"]
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("keeps anti-detection structured samples append-only for the same sample_ref", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);

    await expect(
      store.insertAntiDetectionStructuredSample({
        ...scope,
        sampleRef: "validation-sample/FR-0012/001",
        requestRef: "validation-request/FR-0012/001",
        runId: "run-validation-sample-rewrite-001",
        capturedAt: "2026-04-25T10:30:00.000Z",
        structuredPayload: { target_fr_ref: "FR-0012", rewritten: true },
        artifactRefs: []
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("rejects initial terminal anti-detection validation request states", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await expect(
      store.upsertAntiDetectionValidationRequest({
        requestRef: "validation-request/FR-0012/terminal",
        validationScope: "layer1_consistency",
        targetFrRef: "FR-0012",
        profileRef: "profile/xhs_001",
        browserChannel: "Google Chrome stable",
        executionSurface: "real_browser",
        sampleGoal: "capture terminal baseline",
        requestedExecutionMode: "live_read_high_risk",
        probeBundleRef: "probe-bundle/xhs-closeout-min-v1",
        requestState: "completed",
        requestedAt: "2026-04-25T10:00:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("rejects validation records that link samples from another request", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    const scope = await seedAntiDetectionValidationRecord(store);
    const otherRequestRef = "validation-request/FR-0012/other-request";
    const otherSampleRef = "validation-sample/FR-0012/other-request";

    await store.upsertAntiDetectionValidationRequest({
      ...scope,
      requestRef: otherRequestRef,
      sampleGoal: "capture other request baseline",
      requestedExecutionMode: "live_read_high_risk",
      requestState: "accepted",
      requestedAt: "2026-04-25T10:30:00.000Z"
    });
    await store.insertAntiDetectionStructuredSample({
      ...scope,
      sampleRef: otherSampleRef,
      requestRef: otherRequestRef,
      runId: "run-validation-other-request-sample-001",
      capturedAt: "2026-04-25T10:31:00.000Z",
      structuredPayload: { target_fr_ref: "FR-0012", other_request: true },
      artifactRefs: []
    });

    await expect(
      store.insertAntiDetectionValidationRecord({
        ...scope,
        recordRef: "validation-record/FR-0012/request-mismatch",
        requestRef: "validation-request/FR-0012/001",
        sampleRef: otherSampleRef,
        baselineRef: "baseline/FR-0012/001",
        resultState: "verified",
        driftState: "no_drift",
        failureClass: null,
        runId: "run-validation-request-mismatch-001",
        validatedAt: "2026-04-25T10:32:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
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
        summary: "connection failed",
        summaryTruncated: false
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
      summary: oversized,
      summaryTruncated: false
    });

    const trace = await store.getRunTrace("run-redact-001");
    store.close();

    const summary = trace.events[0]?.summary ?? "";
    expect(summary).not.toContain("BearerABC");
    expect(summary).not.toContain("session123");
    expect(summary).not.toContain("abc123");
    expect(summary).toContain("[REDACTED]");
    expect(summary).toContain("[TRUNCATED]");
    expect(trace.events[0]?.summary_truncated).toBe(true);
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
      summary: "done",
      summaryTruncated: false
    });
    await store.appendRunEvent({
      runId: "run-order-001",
      eventTime: "2026-03-19T10:00:01.000Z",
      stage: "boot",
      component: "cli",
      eventType: "started",
      diagnosisCategory: null,
      failurePoint: null,
      summary: "start",
      summaryTruncated: false
    });

    const trace = await store.getRunTrace("run-order-001");
    store.close();

    expect(trace.events.map((event) => event.event_time)).toEqual([
      "2026-03-19T10:00:01.000Z",
      "2026-03-19T10:00:03.000Z"
    ]);
    expect(trace.events.map((event) => event.summary_truncated)).toEqual([false, false]);
  });

  it("rejects append event when summary_truncated is not boolean", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-invalid-truncation-001",
      sessionId: null,
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });

    await expect(
      store.appendRunEvent({
        runId: "run-invalid-truncation-001",
        eventTime: "2026-03-19T10:00:01.000Z",
        stage: "command",
        component: "runtime",
        eventType: "failed",
        diagnosisCategory: "unknown",
        failurePoint: "runtime.ping",
        summary: "bad flag",
        summaryTruncated: "false" as unknown as boolean
      })
    ).rejects.toMatchObject<Partial<RuntimeStoreError>>({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("preserves caller-provided summary_truncated when store does not need to truncate again", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-caller-truncated-001",
      sessionId: null,
      profileName: "default",
      command: "runtime.ping",
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      endedAt: null,
      errorCode: null
    });

    await store.appendRunEvent({
      runId: "run-caller-truncated-001",
      eventTime: "2026-03-19T10:00:01.000Z",
      stage: "command",
      component: "runtime",
      eventType: "failed",
      diagnosisCategory: "unknown",
      failurePoint: "runtime.ping",
      summary: "diagnosis unavailable",
      summaryTruncated: true
    });

    const trace = await store.getRunTrace("run-caller-truncated-001");
    store.close();

    expect(trace.events[0]?.summary_truncated).toBe(true);
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
      decisionId: "gate_decision_run-gate-001",
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
      decisionId: "gate_decision_run-gate-001",
      approvalId: "gate_appr_gate_decision_run-gate-001",
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
      approval_id: "gate_appr_gate_decision_run-gate-001",
      run_id: "run-gate-001",
      decision_id: "gate_decision_run-gate-001",
      approved: true,
      approver: "qa-reviewer",
      approved_at: "2026-03-23T10:00:10.000Z"
    });
    expect(trail.audit_records).toHaveLength(1);
    expect(trail.audit_records[0]).toMatchObject({
      decision_id: "gate_decision_run-gate-001",
      approval_id: "gate_appr_gate_decision_run-gate-001",
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

  it("preserves a caller-provided approval_id when upserting approval records", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-custom-approval-001",
      sessionId: "session-gate-custom-approval-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    const approval = await store.upsertApprovalRecord({
      approvalId: "gate_appr_custom_run-gate-custom-approval-001",
      runId: "run-gate-custom-approval-001",
      decisionId: "gate_decision_run-gate-custom-approval-001_req-1",
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
    store.close();

    expect(approval.approval_id).toBe("gate_appr_custom_run-gate-custom-approval-001");
    expect(approval.decision_id).toBe("gate_decision_run-gate-custom-approval-001_req-1");
  });

  it("falls back to a decision-scoped approval_id when a reused caller approval_id would hit a primary-key conflict", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-conflict-approval-001",
      sessionId: "session-gate-conflict-approval-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    await store.upsertApprovalRecord({
      approvalId: "gate_appr_custom_conflict",
      runId: "run-gate-conflict-approval-001",
      decisionId: "gate_decision_run-gate-conflict-approval-001_req-1",
      approved: true,
      approver: "qa-reviewer-a",
      approvedAt: "2026-03-23T10:00:10.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });

    const approval = await store.upsertApprovalRecord({
      approvalId: "gate_appr_custom_conflict",
      runId: "run-gate-conflict-approval-001",
      decisionId: "gate_decision_run-gate-conflict-approval-001_req-2",
      approved: true,
      approver: "qa-reviewer-b",
      approvedAt: "2026-03-23T10:00:20.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
    store.close();

    expect(approval.approval_id).toBe("gate_appr_gate_decision_run-gate-conflict-approval-001_req-2");
    expect(approval.decision_id).toBe("gate_decision_run-gate-conflict-approval-001_req-2");
  });

  it("rejects allowed live audit records that omit approval_id", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-live-audit-missing-approval-001",
      sessionId: "session-gate-live-audit-missing-approval-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    await expect(
      store.appendAuditRecord({
        eventId: "gate_evt_run-gate-live-audit-missing-approval-001",
        decisionId: "gate_decision_run-gate-live-audit-missing-approval-001_req-1",
        approvalId: null,
        runId: "run-gate-live-audit-missing-approval-001",
        sessionId: "session-gate-live-audit-missing-approval-1",
        profile: "profile-a",
        issueScope: "issue_209",
        riskState: "allowed",
        nextState: "allowed",
        transitionTrigger: "manual_approval",
        targetDomain: "www.xiaohongshu.com",
        targetTabId: 12,
        targetPage: "search_result_tab",
        actionType: "read",
        requestedExecutionMode: "live_read_high_risk",
        effectiveExecutionMode: "live_read_high_risk",
        gateDecision: "allowed",
        gateReasons: ["LIVE_MODE_APPROVED"],
        approver: "qa-reviewer",
        approvedAt: "2026-03-23T10:00:10.000Z",
        recordedAt: "2026-03-23T10:00:11.000Z"
      })
    ).rejects.toMatchObject<Partial<RuntimeStoreError>>({
      code: "ERR_RUNTIME_STORE_INVALID_INPUT"
    });
    store.close();
  });

  it("keeps separate approval records for multiple decisions in the same run", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));
    await store.upsertRun({
      runId: "run-gate-multi-decision-001",
      sessionId: "session-gate-multi-decision-1",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:01.000Z",
      errorCode: null
    });

    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-multi-decision-001_req-1",
      runId: "run-gate-multi-decision-001",
      decisionId: "gate_decision_run-gate-multi-decision-001_req-1",
      approved: true,
      approver: "qa-reviewer-a",
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
      eventId: "gate_evt_run-gate-multi-decision-001_req-1",
      decisionId: "gate_decision_run-gate-multi-decision-001_req-1",
      approvalId: "gate_appr_run-gate-multi-decision-001_req-1",
      runId: "run-gate-multi-decision-001",
      sessionId: "session-gate-multi-decision-1",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "manual_approval",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 32,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer-a",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });

    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-multi-decision-001_req-2",
      runId: "run-gate-multi-decision-001",
      decisionId: "gate_decision_run-gate-multi-decision-001_req-2",
      approved: true,
      approver: "qa-reviewer-b",
      approvedAt: "2026-03-23T10:00:20.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-multi-decision-001_req-2",
      decisionId: "gate_decision_run-gate-multi-decision-001_req-2",
      approvalId: "gate_appr_run-gate-multi-decision-001_req-2",
      runId: "run-gate-multi-decision-001",
      sessionId: "session-gate-multi-decision-1",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "manual_approval",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 33,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer-b",
      approvedAt: "2026-03-23T10:00:20.000Z",
      recordedAt: "2026-03-23T10:00:21.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-multi-decision-001");
    const listed = await store.listAuditRecords({ run_id: "run-gate-multi-decision-001" });
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_run-gate-multi-decision-001_req-2",
      decision_id: "gate_decision_run-gate-multi-decision-001_req-2",
      approver: "qa-reviewer-b"
    });
    expect(trail.audit_records).toHaveLength(2);
    expect(trail.audit_records.map((record) => record.decision_id)).toEqual([
      "gate_decision_run-gate-multi-decision-001_req-2",
      "gate_decision_run-gate-multi-decision-001_req-1"
    ]);
    expect(listed.map((record) => record.approval_id)).toEqual([
      "gate_appr_run-gate-multi-decision-001_req-2",
      "gate_appr_run-gate-multi-decision-001_req-1"
    ]);
  });

  it("keeps the latest real approval in run-level audit trails even when the newest decision is blocked", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await store.upsertRun({
      runId: "run-gate-approval-fallback-001",
      sessionId: "session-gate-approval-fallback-001",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:30.000Z",
      errorCode: null
    });
    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-approval-fallback-001_req-1",
      runId: "run-gate-approval-fallback-001",
      decisionId: "gate_decision_run-gate-approval-fallback-001_req-1",
      approved: true,
      approver: "qa-reviewer-a",
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
      eventId: "gate_evt_run-gate-approval-fallback-001_req-1",
      decisionId: "gate_decision_run-gate-approval-fallback-001_req-1",
      approvalId: "gate_appr_run-gate-approval-fallback-001_req-1",
      runId: "run-gate-approval-fallback-001",
      sessionId: "session-gate-approval-fallback-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "manual_approval",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 40,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer-a",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-approval-fallback-001_req-2",
      decisionId: "gate_decision_run-gate-approval-fallback-001_req-2",
      approvalId: null,
      runId: "run-gate-approval-fallback-001",
      sessionId: "session-gate-approval-fallback-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "paused",
      nextState: "paused",
      transitionTrigger: "gate_evaluation",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 40,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked",
      gateReasons: ["RISK_STATE_PAUSED", "ISSUE_ACTION_MATRIX_BLOCKED"],
      approver: null,
      approvedAt: null,
      recordedAt: "2026-03-23T10:00:21.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-approval-fallback-001");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_run-gate-approval-fallback-001_req-1",
      decision_id: "gate_decision_run-gate-approval-fallback-001_req-1",
      approver: "qa-reviewer-a"
    });
    expect(trail.audit_records.map((record) => record.decision_id)).toEqual([
      "gate_decision_run-gate-approval-fallback-001_req-2",
      "gate_decision_run-gate-approval-fallback-001_req-1"
    ]);
    expect(trail.audit_records.map((record) => record.approval_id)).toEqual([
      null,
      "gate_appr_run-gate-approval-fallback-001_req-1"
    ]);
  });

  it("ignores stale blocked approval_id when selecting the run-level approval record", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await store.upsertRun({
      runId: "run-gate-approval-stale-blocked-001",
      sessionId: "session-gate-approval-stale-blocked-001",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:30.000Z",
      errorCode: null
    });
    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-approval-stale-blocked-001_req-1",
      runId: "run-gate-approval-stale-blocked-001",
      decisionId: "gate_decision_run-gate-approval-stale-blocked-001_req-1",
      approved: true,
      approver: "qa-reviewer-a",
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
      eventId: "gate_evt_run-gate-approval-stale-blocked-001_req-1",
      decisionId: "gate_decision_run-gate-approval-stale-blocked-001_req-1",
      approvalId: "gate_appr_run-gate-approval-stale-blocked-001_req-1",
      runId: "run-gate-approval-stale-blocked-001",
      sessionId: "session-gate-approval-stale-blocked-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "manual_approval",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 41,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer-a",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-approval-stale-blocked-001_req-2",
      decisionId: "gate_decision_run-gate-approval-stale-blocked-001_req-2",
      approvalId: "gate_appr_stale_blocked_run-gate-approval-stale-blocked-001",
      runId: "run-gate-approval-stale-blocked-001",
      sessionId: "session-gate-approval-stale-blocked-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "paused",
      nextState: "paused",
      transitionTrigger: "gate_evaluation",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 41,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked",
      gateReasons: ["RISK_STATE_PAUSED", "ISSUE_ACTION_MATRIX_BLOCKED"],
      approver: null,
      approvedAt: null,
      recordedAt: "2026-03-23T10:00:21.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-approval-stale-blocked-001");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_run-gate-approval-stale-blocked-001_req-1",
      decision_id: "gate_decision_run-gate-approval-stale-blocked-001_req-1",
      approver: "qa-reviewer-a"
    });
    expect(trail.audit_records.map((record) => record.approval_id)).toEqual([
      "gate_appr_stale_blocked_run-gate-approval-stale-blocked-001",
      "gate_appr_run-gate-approval-stale-blocked-001_req-1"
    ]);
  });

  it("ignores blocked audit rows even when they match a persisted approval trail", async () => {
    const cwd = await createTempCwd();
    const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(cwd));

    await store.upsertRun({
      runId: "run-gate-approval-blocked-match-001",
      sessionId: "session-gate-approval-blocked-match-001",
      profileName: "profile-a",
      command: "xhs.search",
      status: "succeeded",
      startedAt: "2026-03-23T10:00:00.000Z",
      endedAt: "2026-03-23T10:00:30.000Z",
      errorCode: null
    });
    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-approval-blocked-match-001_req-1",
      runId: "run-gate-approval-blocked-match-001",
      decisionId: "gate_decision_run-gate-approval-blocked-match-001_req-1",
      approved: true,
      approver: "qa-reviewer-a",
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
      eventId: "gate_evt_run-gate-approval-blocked-match-001_req-1",
      decisionId: "gate_decision_run-gate-approval-blocked-match-001_req-1",
      approvalId: "gate_appr_run-gate-approval-blocked-match-001_req-1",
      runId: "run-gate-approval-blocked-match-001",
      sessionId: "session-gate-approval-blocked-match-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      transitionTrigger: "manual_approval",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 42,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "live_read_high_risk",
      gateDecision: "allowed",
      gateReasons: ["LIVE_MODE_APPROVED"],
      approver: "qa-reviewer-a",
      approvedAt: "2026-03-23T10:00:10.000Z",
      recordedAt: "2026-03-23T10:00:11.000Z"
    });
    await store.upsertApprovalRecord({
      approvalId: "gate_appr_run-gate-approval-blocked-match-001_req-2",
      runId: "run-gate-approval-blocked-match-001",
      decisionId: "gate_decision_run-gate-approval-blocked-match-001_req-2",
      approved: true,
      approver: "qa-reviewer-b",
      approvedAt: "2026-03-23T10:00:20.000Z",
      checks: {
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }
    });
    await store.appendAuditRecord({
      eventId: "gate_evt_run-gate-approval-blocked-match-001_req-2",
      decisionId: "gate_decision_run-gate-approval-blocked-match-001_req-2",
      approvalId: "gate_appr_run-gate-approval-blocked-match-001_req-2",
      runId: "run-gate-approval-blocked-match-001",
      sessionId: "session-gate-approval-blocked-match-001",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "limited",
      transitionTrigger: "risk_signal_detected",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 42,
      targetPage: "search_result_tab",
      actionType: "read",
      requestedExecutionMode: "live_read_high_risk",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked",
      gateReasons: ["MANUAL_CONFIRMATION_MISSING"],
      approver: "qa-reviewer-b",
      approvedAt: "2026-03-23T10:00:20.000Z",
      recordedAt: "2026-03-23T10:00:21.000Z"
    });

    const trail = await store.getAuditTrailByRunId("run-gate-approval-blocked-match-001");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_run-gate-approval-blocked-match-001_req-1",
      decision_id: "gate_decision_run-gate-approval-blocked-match-001_req-1",
      approver: "qa-reviewer-a"
    });
  });

  it("backfills v6 gate linkage fields during v7 migration", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '6');
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
      CREATE TABLE runtime_gate_approvals (
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
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v6-allowed",
      "session-v6-allowed",
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
      "run-v6-blocked",
      "session-v6-blocked",
      "profile-b",
      "xhs.search",
      "failed",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z",
      "ERR_EXECUTION_FAILED",
      "2026-03-23T10:05:00.000Z",
      "2026-03-23T10:05:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_custom_run-v6-allowed",
      "run-v6-allowed",
      1,
      "qa-reviewer",
      "2026-03-23T10:00:10.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:10.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v6-allowed",
      "run-v6-allowed",
      "session-v6-allowed",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      21,
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
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v6-blocked",
      "run-v6-blocked",
      "session-v6-blocked",
      "profile-b",
      "issue_209",
      "paused",
      "paused",
      "gate_evaluation",
      "www.xiaohongshu.com",
      22,
      "search_result_tab",
      "read",
      "live_read_limited",
      "recon",
      "blocked",
      JSON.stringify(["LIVE_READ_LIMITED_NOT_FORMALLY_APPROVED"]),
      null,
      null,
      "2026-03-23T10:05:11.000Z",
      "2026-03-23T10:05:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const allowedTrail = await store.getAuditTrailByRunId("run-v6-allowed");
    const blockedTrail = await store.getAuditTrailByRunId("run-v6-blocked");
    store.close();

    expect(allowedTrail.approval_record).toMatchObject({
      approval_id: "gate_appr_custom_run-v6-allowed",
      run_id: "run-v6-allowed",
      decision_id: "gate_decision_run-v6-allowed"
    });
    expect(allowedTrail.audit_records[0]).toMatchObject({
      event_id: "evt-v6-allowed",
      decision_id: "gate_decision_run-v6-allowed",
      approval_id: "gate_appr_custom_run-v6-allowed"
    });
    expect(blockedTrail.approval_record).toBeNull();
    expect(blockedTrail.audit_records[0]).toMatchObject({
      event_id: "evt-v6-blocked",
      decision_id: "gate_decision_run-v6-blocked",
      approval_id: null
    });
  });

  it("backfills missing per-decision approval rows when migrating v7 approval storage", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '7');
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
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        decision_id TEXT,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        decision_id TEXT,
        approval_id TEXT,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v7-multi",
      "session-v7-multi",
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
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_run-v7-multi_req-2",
      "run-v7-multi",
      "gate_decision_run-v7-multi_req-2",
      1,
      "qa-reviewer-b",
      "2026-03-23T10:00:20.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T10:00:20.000Z",
      "2026-03-23T10:00:20.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger,
        target_domain, target_tab_id, target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision,
        gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_evt_run-v7-multi_req-1",
      "gate_decision_run-v7-multi_req-1",
      "gate_appr_run-v7-multi_req-1",
      "run-v7-multi",
      "session-v7-multi",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      32,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer-a",
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:11.000Z",
      "2026-03-23T10:00:11.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger,
        target_domain, target_tab_id, target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision,
        gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_evt_run-v7-multi_req-2",
      "gate_decision_run-v7-multi_req-2",
      "gate_appr_run-v7-multi_req-2",
      "run-v7-multi",
      "session-v7-multi",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      33,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer-b",
      "2026-03-23T10:00:20.000Z",
      "2026-03-23T10:00:21.000Z",
      "2026-03-23T10:00:21.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v7-multi");
    store.close();

    const migratedDb = new DatabaseSyncCtor(dbPath);
    const approvalRows = migratedDb
      .prepare(
        "SELECT approval_id, decision_id FROM runtime_gate_approvals WHERE run_id = ? ORDER BY decision_id ASC"
      )
      .all("run-v7-multi") as Array<{ approval_id: string; decision_id: string }>;
    migratedDb.close();

    expect(approvalRows).toEqual([
      {
        approval_id: "gate_appr_run-v7-multi_req-1",
        decision_id: "gate_decision_run-v7-multi_req-1"
      },
      {
        approval_id: "gate_appr_run-v7-multi_req-2",
        decision_id: "gate_decision_run-v7-multi_req-2"
      }
    ]);
    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_run-v7-multi_req-2",
      decision_id: "gate_decision_run-v7-multi_req-2",
      approver: "qa-reviewer-b"
    });
    expect(trail.audit_records.map((record) => record.decision_id)).toEqual([
      "gate_decision_run-v7-multi_req-2",
      "gate_decision_run-v7-multi_req-1"
    ]);
  });

  it("deduplicates synthesized v7 approvals by decision_id and ignores blocked legacy audits", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '7');
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
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL UNIQUE,
        decision_id TEXT,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        decision_id TEXT,
        approval_id TEXT,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v7-synth",
      "session-v7-synth",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z",
      null,
      "2026-03-23T10:00:00.000Z",
      "2026-03-23T10:00:01.000Z"
    );
    const insertAudit = db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger,
        target_domain, target_tab_id, target_page, action_type, requested_execution_mode, effective_execution_mode, gate_decision,
        gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAudit.run(
      "gate_evt_run-v7-synth_req-1_a",
      "gate_decision_run-v7-synth_req-1",
      "gate_appr_run-v7-synth_req-1",
      "run-v7-synth",
      "session-v7-synth",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      21,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer-a",
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:11.000Z",
      "2026-03-23T10:00:11.000Z"
    );
    insertAudit.run(
      "gate_evt_run-v7-synth_req-1_b",
      "gate_decision_run-v7-synth_req-1",
      "gate_appr_run-v7-synth_req-1",
      "run-v7-synth",
      "session-v7-synth",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      21,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer-b",
      "2026-03-23T10:00:20.000Z",
      "2026-03-23T10:00:21.000Z",
      "2026-03-23T10:00:21.000Z"
    );
    insertAudit.run(
      "gate_evt_run-v7-synth_blocked",
      "gate_decision_run-v7-synth_blocked",
      "gate_appr_run-v7-synth_blocked",
      "run-v7-synth",
      "session-v7-synth",
      "profile-a",
      "issue_209",
      "paused",
      "paused",
      "gate_evaluation",
      "www.xiaohongshu.com",
      22,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "dry_run",
      "blocked",
      JSON.stringify(["LIVE_READ_HIGH_RISK_BLOCKED"]),
      "qa-reviewer-z",
      "2026-03-23T10:00:30.000Z",
      "2026-03-23T10:00:31.000Z",
      "2026-03-23T10:00:31.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v7-synth");
    store.close();

    const migratedDb = new DatabaseSyncCtor(dbPath);
    const approvalRows = migratedDb
      .prepare(
        "SELECT approval_id, decision_id, approver FROM runtime_gate_approvals WHERE run_id = ? ORDER BY decision_id ASC"
      )
      .all("run-v7-synth") as Array<{ approval_id: string; decision_id: string; approver: string | null }>;
    migratedDb.close();

    expect(approvalRows).toEqual([
      {
        approval_id: "gate_appr_run-v7-synth_req-1",
        decision_id: "gate_decision_run-v7-synth_req-1",
        approver: "qa-reviewer-b"
      }
    ]);
    expect(trail.audit_records.map((record) => record.decision_id)).toEqual([
      "gate_decision_run-v7-synth_blocked",
      "gate_decision_run-v7-synth_req-1",
      "gate_decision_run-v7-synth_req-1"
    ]);
    expect(trail.audit_records.filter((record) => record.approval_id === "gate_appr_run-v7-synth_blocked")).toHaveLength(1);
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
      decisionId: "gate_decision_run-gate-limited-001",
      approvalId: "gate_appr_run-gate-limited-001",
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
      decision_id: "gate_decision_run-gate-limited-001",
      approval_id: "gate_appr_run-gate-limited-001",
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
      decisionId: "gate_decision_run-gate-filter-1",
      approvalId: null,
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
      decisionId: "gate_decision_run-gate-filter-2",
      approvalId: null,
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
        decisionId: "gate_decision_run-gate-invalid-001",
        approvalId: null,
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
        decisionId: "gate_decision_run-gate-limited-invalid-001",
        approvalId: null,
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

  it("backfills summary_truncated for legacy v10 runtime events during v11 migration", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '10');
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
      CREATE TABLE runtime_events (
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
    `);
    db.prepare(`
      INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-legacy-truncation-001",
      null,
      "default",
      "runtime.ping",
      "failed",
      "2026-03-19T10:00:00.000Z",
      "2026-03-19T10:00:01.000Z",
      "ERR_EXECUTION_FAILED",
      "2026-03-19T10:00:00.000Z",
      "2026-03-19T10:00:01.000Z"
    );
    db.prepare(`
      INSERT INTO runtime_events(
        run_id, event_time, stage, component, event_type, diagnosis_category, failure_point, summary, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "run-legacy-truncation-001",
      "2026-03-19T10:00:01.000Z",
      "command",
      "runtime",
      "failed",
      "unknown",
      "runtime.ping",
      "legacy projection [TRUNCATED]",
      "2026-03-19T10:00:01.000Z"
    );
    db.close();

    const storeAfterMigration = new SQLiteRuntimeStore(dbPath);
    const trace = await storeAfterMigration.getRunTrace("run-legacy-truncation-001");
    storeAfterMigration.close();

    expect(trace.events[0]?.summary).toBe("legacy projection [TRUNCATED]");
    expect(trace.events[0]?.summary_truncated).toBe(true);
  });

  it("backfills decision_id and approval_id linkages when migrating v6 gate records", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '6');
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
      CREATE TABLE runtime_gate_approvals (
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
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v6-approved",
      "session-v6-approved",
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
      "run-v6-blocked",
      "session-v6-blocked",
      "profile-b",
      "xhs.search",
      "failed",
      "2026-03-23T10:02:00.000Z",
      "2026-03-23T10:02:01.000Z",
      "ERR_EXECUTION_FAILED",
      "2026-03-23T10:02:00.000Z",
      "2026-03-23T10:02:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_custom_run-v6-approved",
      "run-v6-approved",
      1,
      "qa-reviewer",
      "2026-03-23T10:00:10.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:10.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v6-approved",
      "run-v6-approved",
      "session-v6-approved",
      "profile-a",
      "issue_208",
      "allowed",
      "allowed",
      "manual_approval",
      "creator.xiaohongshu.com",
      18,
      "creator_publish_tab",
      "write",
      "live_write",
      "live_write",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T10:00:10.000Z",
      "2026-03-23T10:00:11.000Z",
      "2026-03-23T10:00:11.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v6-blocked",
      "run-v6-blocked",
      "session-v6-blocked",
      "profile-b",
      "issue_209",
      "paused",
      "paused",
      "gate_evaluation",
      "www.xiaohongshu.com",
      11,
      "search_result_tab",
      "read",
      "live_read_limited",
      "recon",
      "blocked",
      JSON.stringify(["LIVE_READ_LIMITED_DISABLED"]),
      null,
      null,
      "2026-03-23T10:02:11.000Z",
      "2026-03-23T10:02:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const approvedTrail = await store.getAuditTrailByRunId("run-v6-approved");
    const blockedTrail = await store.getAuditTrailByRunId("run-v6-blocked");
    store.close();

    expect(approvedTrail.approval_record).toMatchObject({
      approval_id: "gate_appr_custom_run-v6-approved",
      decision_id: "gate_decision_run-v6-approved"
    });
    expect(approvedTrail.audit_records[0]).toMatchObject({
      decision_id: "gate_decision_run-v6-approved",
      approval_id: "gate_appr_custom_run-v6-approved"
    });
    expect(blockedTrail.approval_record).toBeNull();
    expect(blockedTrail.audit_records[0]).toMatchObject({
      decision_id: "gate_decision_run-v6-blocked",
      approval_id: null
    });
  });

  it("normalizes legacy run-scoped approval_id in both approval and audit records during migration", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '6');
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
      CREATE TABLE runtime_gate_approvals (
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
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v6-legacy-approved",
      "session-v6-legacy-approved",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T12:00:00.000Z",
      "2026-03-23T12:00:01.000Z",
      null,
      "2026-03-23T12:00:00.000Z",
      "2026-03-23T12:00:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_run-v6-legacy-approved",
      "run-v6-legacy-approved",
      1,
      "qa-reviewer",
      "2026-03-23T12:00:10.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T12:00:10.000Z",
      "2026-03-23T12:00:10.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v6-legacy-approved",
      "run-v6-legacy-approved",
      "session-v6-legacy-approved",
      "profile-a",
      "issue_208",
      "allowed",
      "allowed",
      "manual_approval",
      "creator.xiaohongshu.com",
      18,
      "creator_publish_tab",
      "write",
      "live_write",
      "live_write",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T12:00:10.000Z",
      "2026-03-23T12:00:11.000Z",
      "2026-03-23T12:00:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v6-legacy-approved");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_gate_decision_run-v6-legacy-approved",
      decision_id: "gate_decision_run-v6-legacy-approved"
    });
    expect(trail.audit_records[0]).toMatchObject({
      approval_id: "gate_appr_gate_decision_run-v6-legacy-approved",
      decision_id: "gate_decision_run-v6-legacy-approved"
    });
  });

  it("repairs buggy v9 audit linkage drift on reopen", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '9');
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
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        decision_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        decision_id TEXT,
        approval_id TEXT,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v9-buggy-approved",
      "session-v9-buggy-approved",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T13:00:00.000Z",
      "2026-03-23T13:00:01.000Z",
      null,
      "2026-03-23T13:00:00.000Z",
      "2026-03-23T13:00:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_gate_decision_run-v9-buggy-approved",
      "run-v9-buggy-approved",
      "gate_decision_run-v9-buggy-approved",
      1,
      "qa-reviewer",
      "2026-03-23T13:00:10.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T13:00:10.000Z",
      "2026-03-23T13:00:10.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "evt-v9-buggy-approved",
      "gate_decision_run-v9-buggy-approved",
      "gate_appr_run-v9-buggy-approved",
      "run-v9-buggy-approved",
      "session-v9-buggy-approved",
      "profile-a",
      "issue_208",
      "allowed",
      "allowed",
      "manual_approval",
      "creator.xiaohongshu.com",
      18,
      "creator_publish_tab",
      "write",
      "live_write",
      "live_write",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T13:00:10.000Z",
      "2026-03-23T13:00:11.000Z",
      "2026-03-23T13:00:11.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v9-buggy-approved");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_gate_decision_run-v9-buggy-approved",
      decision_id: "gate_decision_run-v9-buggy-approved"
    });
    expect(trail.audit_records[0]).toMatchObject({
      approval_id: "gate_appr_gate_decision_run-v9-buggy-approved",
      decision_id: "gate_decision_run-v9-buggy-approved"
    });
  });

  it("does not backfill blocked v9 audit rows when repairing approval linkage drift", async () => {
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
      INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', '9');
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
      CREATE TABLE runtime_gate_approvals (
        approval_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        decision_id TEXT NOT NULL UNIQUE,
        approved INTEGER NOT NULL,
        approver TEXT,
        approved_at TEXT,
        checks_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
      );
      CREATE TABLE runtime_gate_audit_records (
        event_id TEXT PRIMARY KEY,
        decision_id TEXT,
        approval_id TEXT,
        run_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        profile TEXT NOT NULL,
        issue_scope TEXT,
        risk_state TEXT NOT NULL,
        next_state TEXT NOT NULL DEFAULT 'paused',
        transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation',
        target_domain TEXT NOT NULL,
        target_tab_id INTEGER NOT NULL,
        target_page TEXT NOT NULL,
        action_type TEXT,
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
    `);
    db.prepare(
      `INSERT INTO runtime_runs(
        run_id, session_id, profile_name, command, status, started_at, ended_at, error_code, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "run-v9-buggy-mixed",
      "session-v9-buggy-mixed",
      "profile-a",
      "xhs.search",
      "succeeded",
      "2026-03-23T13:00:00.000Z",
      "2026-03-23T13:00:01.000Z",
      null,
      "2026-03-23T13:00:00.000Z",
      "2026-03-23T13:00:01.000Z"
    );
    db.prepare(
      `INSERT INTO runtime_gate_approvals(
        approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "gate_appr_gate_decision_run-v9-buggy-mixed",
      "run-v9-buggy-mixed",
      "gate_decision_run-v9-buggy-mixed",
      1,
      "qa-reviewer",
      "2026-03-23T13:00:10.000Z",
      JSON.stringify({
        target_domain_confirmed: true,
        target_tab_confirmed: true,
        target_page_confirmed: true,
        risk_state_checked: true,
        action_type_confirmed: true
      }),
      "2026-03-23T13:00:10.000Z",
      "2026-03-23T13:00:10.000Z"
    );
    const insertAudit = db.prepare(
      `INSERT INTO runtime_gate_audit_records(
        event_id, decision_id, approval_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger, target_domain, target_tab_id, target_page,
        action_type, requested_execution_mode, effective_execution_mode, gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
      ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    insertAudit.run(
      "evt-v9-buggy-mixed-allowed",
      "gate_decision_run-v9-buggy-mixed",
      "gate_appr_run-v9-buggy-mixed",
      "run-v9-buggy-mixed",
      "session-v9-buggy-mixed",
      "profile-a",
      "issue_209",
      "allowed",
      "allowed",
      "manual_approval",
      "www.xiaohongshu.com",
      18,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "live_read_high_risk",
      "allowed",
      JSON.stringify(["LIVE_MODE_APPROVED"]),
      "qa-reviewer",
      "2026-03-23T13:00:10.000Z",
      "2026-03-23T13:00:11.000Z",
      "2026-03-23T13:00:11.000Z"
    );
    insertAudit.run(
      "evt-v9-buggy-mixed-blocked",
      "gate_decision_run-v9-buggy-mixed",
      "gate_appr_run-v9-buggy-mixed",
      "run-v9-buggy-mixed",
      "session-v9-buggy-mixed",
      "profile-a",
      "issue_209",
      "allowed",
      "limited",
      "risk_signal_detected",
      "www.xiaohongshu.com",
      18,
      "search_result_tab",
      "read",
      "live_read_high_risk",
      "dry_run",
      "blocked",
      JSON.stringify(["MANUAL_CONFIRMATION_MISSING"]),
      "qa-reviewer",
      "2026-03-23T13:00:10.000Z",
      "2026-03-23T13:00:12.000Z",
      "2026-03-23T13:00:12.000Z"
    );
    db.close();

    const store = new SQLiteRuntimeStore(dbPath);
    const trail = await store.getAuditTrailByRunId("run-v9-buggy-mixed");
    store.close();

    expect(trail.approval_record).toMatchObject({
      approval_id: "gate_appr_gate_decision_run-v9-buggy-mixed",
      decision_id: "gate_decision_run-v9-buggy-mixed"
    });
    expect(trail.audit_records[0]).toMatchObject({
      event_id: "evt-v9-buggy-mixed-blocked",
      approval_id: "gate_appr_run-v9-buggy-mixed",
      effective_execution_mode: "dry_run",
      gate_decision: "blocked"
    });
    expect(trail.audit_records[1]).toMatchObject({
      event_id: "evt-v9-buggy-mixed-allowed",
      approval_id: "gate_appr_gate_decision_run-v9-buggy-mixed",
      effective_execution_mode: "live_read_high_risk",
      gate_decision: "allowed"
    });
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
    await expectLegacyMigrationAllowsNullActionTypeWrite(store, {
      runId: "run-v2-read",
      sessionId: "session-v2-read",
      profile: "profile-a",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "allowed",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 11,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_write",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked"
    });
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
    await expectLegacyMigrationAllowsNullActionTypeWrite(store, {
      runId: "run-v3-write",
      sessionId: "session-v3-write",
      profile: "profile-b",
      issueScope: "issue_209",
      riskState: "paused",
      nextState: "paused",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 22,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_write",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked"
    });
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
    await expectLegacyMigrationAllowsNullActionTypeWrite(store, {
      runId: "run-v4-legacy-ambiguous-write",
      sessionId: "session-v4-legacy-ambiguous-write",
      profile: "profile-legacy",
      issueScope: "issue_209",
      riskState: "allowed",
      nextState: "limited",
      targetDomain: "www.xiaohongshu.com",
      targetTabId: 52,
      targetPage: "search_result_tab",
      requestedExecutionMode: "live_write",
      effectiveExecutionMode: "dry_run",
      gateDecision: "blocked"
    });
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
