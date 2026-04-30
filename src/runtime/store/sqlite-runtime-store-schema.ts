import type { DatabaseSync } from "node:sqlite";

export const SCHEMA_VERSION = 16;

interface InitializeRuntimeStoreSchemaInput {
  db: DatabaseSync;
  onSchemaMismatch: (version: string | undefined) => Error;
}

const hasColumn = (db: DatabaseSync, tableName: string, columnName: string): boolean => {
  const rows = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name?: string }>;
  return rows.some((row) => row.name === columnName);
};

const backfillIssueScope = (db: DatabaseSync): void => {
  db.exec(`
    UPDATE runtime_gate_audit_records
    SET issue_scope = CASE
      WHEN issue_scope IS NOT NULL AND issue_scope != '' THEN issue_scope
      WHEN target_domain = 'www.xiaohongshu.com' THEN 'issue_209'
      WHEN target_page = 'search_result_tab' THEN 'issue_209'
      WHEN requested_execution_mode IN ('live_read_limited', 'live_read_high_risk') THEN 'issue_209'
      WHEN action_type = 'read' THEN 'issue_209'
      WHEN target_domain = 'creator.xiaohongshu.com'
           AND target_page IN ('creator_publish_tab', 'publish_page')
           AND (
             effective_execution_mode = 'live_write'
             OR action_type = 'irreversible_write'
           )
        THEN 'issue_208'
      ELSE NULL
    END
    WHERE issue_scope IS NULL OR issue_scope = '';
  `);
};

const migrateV1ToV2 = (db: DatabaseSync): void => {
  db.exec(`
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
      issue_scope TEXT,
      risk_state TEXT NOT NULL DEFAULT 'paused',
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
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_run_recorded
      ON runtime_gate_audit_records(run_id, recorded_at ASC);
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_session_recorded
      ON runtime_gate_audit_records(session_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_profile_recorded
      ON runtime_gate_audit_records(profile, recorded_at DESC);
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "2"
  );
};

const migrateV2ToV3 = (db: DatabaseSync): void => {
  db.exec(`
    ALTER TABLE runtime_gate_audit_records
    ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'paused';
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("3");
};

const migrateV3ToV4 = (db: DatabaseSync): void => {
  db.exec(`
    ALTER TABLE runtime_gate_audit_records
    ADD COLUMN next_state TEXT NOT NULL DEFAULT 'paused';
    ALTER TABLE runtime_gate_audit_records
    ADD COLUMN transition_trigger TEXT NOT NULL DEFAULT 'gate_evaluation';
    UPDATE runtime_gate_audit_records
    SET next_state = risk_state
    WHERE next_state IS NULL OR next_state = '';
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("4");
};

const migrateV4ToV5 = (db: DatabaseSync): void => {
  db.exec(`
    ALTER TABLE runtime_gate_audit_records
    ADD COLUMN issue_scope TEXT;
  `);
  backfillIssueScope(db);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("5");
};

const migrateV5ToV6 = (db: DatabaseSync): void => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE runtime_gate_audit_records_v6 (
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
    INSERT INTO runtime_gate_audit_records_v6 (
      event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger,
      target_domain, target_tab_id, target_page, action_type, requested_execution_mode, effective_execution_mode,
      gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
    )
    SELECT
      event_id, run_id, session_id, profile, issue_scope, risk_state, next_state, transition_trigger,
      target_domain, target_tab_id, target_page, action_type, requested_execution_mode, effective_execution_mode,
      gate_decision, gate_reasons_json, approver, approved_at, recorded_at, created_at
    FROM runtime_gate_audit_records;
    DROP TABLE runtime_gate_audit_records;
    ALTER TABLE runtime_gate_audit_records_v6 RENAME TO runtime_gate_audit_records;
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_run_recorded
      ON runtime_gate_audit_records(run_id, recorded_at ASC);
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_session_recorded
      ON runtime_gate_audit_records(session_id, recorded_at DESC);
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_audit_profile_recorded
      ON runtime_gate_audit_records(profile, recorded_at DESC);
    PRAGMA foreign_keys = ON;
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "6"
  );
};

const migrateV6ToV7 = (db: DatabaseSync): void => {
  if (!hasColumn(db, "runtime_gate_approvals", "decision_id")) {
    db.exec(`
      ALTER TABLE runtime_gate_approvals
      ADD COLUMN decision_id TEXT;
    `);
  }
  if (!hasColumn(db, "runtime_gate_audit_records", "decision_id")) {
    db.exec(`
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN decision_id TEXT;
    `);
  }
  if (!hasColumn(db, "runtime_gate_audit_records", "approval_id")) {
    db.exec(`
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN approval_id TEXT;
    `);
  }
  db.exec(`
    UPDATE runtime_gate_approvals
    SET decision_id = 'gate_decision_' || run_id
    WHERE decision_id IS NULL OR decision_id = '';

    UPDATE runtime_gate_audit_records
    SET approval_id = COALESCE(
      (
        SELECT runtime_gate_approvals.approval_id
        FROM runtime_gate_approvals
        WHERE runtime_gate_approvals.run_id = runtime_gate_audit_records.run_id
      ),
      CASE
        WHEN (approver IS NOT NULL AND approver != '')
          OR (approved_at IS NOT NULL AND approved_at != '')
        THEN 'gate_appr_' || run_id
        ELSE NULL
      END
    )
    WHERE approval_id IS NULL OR approval_id = '';

    UPDATE runtime_gate_audit_records
    SET decision_id = COALESCE(
      (
        SELECT runtime_gate_approvals.decision_id
        FROM runtime_gate_approvals
        WHERE runtime_gate_approvals.run_id = runtime_gate_audit_records.run_id
      ),
      'gate_decision_' || run_id
    )
    WHERE decision_id IS NULL OR decision_id = '';
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "7"
  );
};

const migrateV7ToV8 = (db: DatabaseSync): void => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE runtime_gate_approvals_v8 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      approval_id TEXT NOT NULL,
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
    INSERT INTO runtime_gate_approvals_v8(
      approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
    )
    SELECT
      approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
    FROM runtime_gate_approvals;
    INSERT INTO runtime_gate_approvals_v8(
      approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
    )
    SELECT
      synthesized_approvals.approval_id,
      synthesized_approvals.run_id,
      synthesized_approvals.decision_id,
      1,
      synthesized_approvals.approver,
      synthesized_approvals.approved_at,
      '{}',
      synthesized_approvals.recorded_at,
      synthesized_approvals.recorded_at
    FROM (
      SELECT *
      FROM (
        SELECT
          runtime_gate_audit_records.approval_id,
          runtime_gate_audit_records.run_id,
          runtime_gate_audit_records.decision_id,
          runtime_gate_audit_records.approver,
          runtime_gate_audit_records.approved_at,
          runtime_gate_audit_records.recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY runtime_gate_audit_records.decision_id
            ORDER BY runtime_gate_audit_records.recorded_at DESC, runtime_gate_audit_records.event_id DESC
          ) AS row_num
        FROM runtime_gate_audit_records
        WHERE runtime_gate_audit_records.approval_id IS NOT NULL
          AND runtime_gate_audit_records.approval_id != ''
          AND runtime_gate_audit_records.decision_id IS NOT NULL
          AND runtime_gate_audit_records.decision_id != ''
          AND runtime_gate_audit_records.gate_decision = 'allowed'
          AND runtime_gate_audit_records.effective_execution_mode IN (
            'live_read_limited',
            'live_read_high_risk',
            'live_write'
          )
          AND runtime_gate_audit_records.approver IS NOT NULL
          AND runtime_gate_audit_records.approver != ''
          AND runtime_gate_audit_records.approved_at IS NOT NULL
          AND runtime_gate_audit_records.approved_at != ''
      )
      WHERE row_num = 1
    ) AS synthesized_approvals
    WHERE synthesized_approvals.decision_id IS NOT NULL
      AND synthesized_approvals.decision_id != ''
      AND NOT EXISTS (
        SELECT 1
        FROM runtime_gate_approvals_v8
        WHERE runtime_gate_approvals_v8.decision_id = synthesized_approvals.decision_id
      );
    DROP TABLE runtime_gate_approvals;
    ALTER TABLE runtime_gate_approvals_v8 RENAME TO runtime_gate_approvals;
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_approvals_run_updated
      ON runtime_gate_approvals(run_id, updated_at DESC);
    PRAGMA foreign_keys = ON;
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("8");
};

const migrateV8ToV9 = (db: DatabaseSync): void => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE runtime_gate_approvals_v9 (
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
    INSERT INTO runtime_gate_approvals_v9(
      approval_id, run_id, decision_id, approved, approver, approved_at, checks_json, created_at, updated_at
    )
    SELECT
      CASE
        WHEN approval_id IS NULL OR approval_id = '' OR approval_id = 'gate_appr_' || run_id
          THEN 'gate_appr_' || decision_id
        ELSE approval_id
      END,
      run_id,
      decision_id,
      approved,
      approver,
      approved_at,
      checks_json,
      created_at,
      updated_at
    FROM runtime_gate_approvals;
    DROP TABLE runtime_gate_approvals;
    ALTER TABLE runtime_gate_approvals_v9 RENAME TO runtime_gate_approvals;
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_approvals_run_updated
      ON runtime_gate_approvals(run_id, updated_at DESC);
    PRAGMA foreign_keys = ON;
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "9"
  );
};

const migrateV9ToV10 = (db: DatabaseSync): void => {
  db.exec(`
    UPDATE runtime_gate_audit_records
    SET approval_id = (
      SELECT runtime_gate_approvals.approval_id
      FROM runtime_gate_approvals
      WHERE runtime_gate_approvals.decision_id = runtime_gate_audit_records.decision_id
    )
    WHERE decision_id IS NOT NULL
      AND decision_id != ''
      AND gate_decision = 'allowed'
      AND effective_execution_mode IN (
        'live_read_limited',
        'live_read_high_risk',
        'live_write'
      )
      AND approver IS NOT NULL
      AND approver != ''
      AND approved_at IS NOT NULL
      AND approved_at != ''
      AND EXISTS (
        SELECT 1
        FROM runtime_gate_approvals
        WHERE runtime_gate_approvals.decision_id = runtime_gate_audit_records.decision_id
      )
      AND (
        approval_id IS NULL
        OR approval_id = ''
        OR approval_id != (
          SELECT runtime_gate_approvals.approval_id
          FROM runtime_gate_approvals
          WHERE runtime_gate_approvals.decision_id = runtime_gate_audit_records.decision_id
        )
      );
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "10"
  );
};

const migrateV10ToV11 = (db: DatabaseSync): void => {
  if (!hasColumn(db, "runtime_events", "summary_truncated")) {
    db.exec(`
      ALTER TABLE runtime_events
      ADD COLUMN summary_truncated INTEGER NOT NULL DEFAULT 0;
    `);
  }
  db.exec(`
    UPDATE runtime_events
    SET summary_truncated = 1
    WHERE summary IS NOT NULL
      AND summary LIKE '%[TRUNCATED]';
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("11");
};

const migrateV11ToV12 = (db: DatabaseSync): void => {
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "12"
  );
};

const migrateV12ToV13 = (db: DatabaseSync): void => {
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    "13"
  );
};

const rebuildSessionRhythmWindowStateAsProfileScoped = (
  db: DatabaseSync,
  schemaVersion: number
): void => {
  db.exec(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE session_rhythm_window_state_profile_scoped (
      window_id TEXT PRIMARY KEY,
      profile TEXT NOT NULL,
      platform TEXT NOT NULL,
      issue_scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
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
    INSERT INTO session_rhythm_window_state_profile_scoped(
      window_id, profile, platform, issue_scope, session_id, current_phase, risk_state,
      window_started_at, window_deadline_at, cooldown_until, recovery_probe_due_at,
      stability_window_until, risk_signal_count, last_event_id, source_run_id, updated_at
    )
    SELECT
      window_id, profile, platform, issue_scope,
      COALESCE(NULLIF(session_id, ''), 'unknown-session') AS session_id,
      current_phase, risk_state, window_started_at, window_deadline_at, cooldown_until,
      recovery_probe_due_at, stability_window_until, risk_signal_count, last_event_id,
      source_run_id, updated_at
    FROM session_rhythm_window_state old
    WHERE old.rowid = (
      SELECT newer.rowid
      FROM session_rhythm_window_state newer
      WHERE newer.profile = old.profile
        AND newer.platform = old.platform
        AND newer.issue_scope = old.issue_scope
      ORDER BY newer.updated_at DESC, newer.rowid DESC
      LIMIT 1
    );
    DROP TABLE session_rhythm_window_state;
    ALTER TABLE session_rhythm_window_state_profile_scoped RENAME TO session_rhythm_window_state;
    PRAGMA foreign_keys = ON;
  `);
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run(
    String(schemaVersion)
  );
};

const migrateV13ToV14 = (db: DatabaseSync): void => {
  rebuildSessionRhythmWindowStateAsProfileScoped(db, 14);
};

const migrateV14ToV15 = (db: DatabaseSync): void => {
  rebuildSessionRhythmWindowStateAsProfileScoped(db, 15);
};

const migrateV15ToV16 = (db: DatabaseSync): void => {
  if (!hasColumn(db, "runtime_gate_audit_records", "action_ref")) {
    db.exec(`
      ALTER TABLE runtime_gate_audit_records
      ADD COLUMN action_ref TEXT;
    `);
  }
  db.prepare("UPDATE runtime_store_meta SET value = ? WHERE key = 'schema_version'").run("16");
};

export const initializeRuntimeStoreSchema = ({
  db,
  onSchemaMismatch
}: InitializeRuntimeStoreSchemaInput): void => {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec(`
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
      summary_truncated INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(run_id) REFERENCES runtime_runs(run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_events_run_time
      ON runtime_events(run_id, event_time ASC);
    CREATE TABLE IF NOT EXISTS runtime_gate_approvals (
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
    CREATE INDEX IF NOT EXISTS idx_runtime_gate_approvals_run_updated
      ON runtime_gate_approvals(run_id, updated_at DESC);
    CREATE TABLE IF NOT EXISTS runtime_gate_audit_records (
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
      action_ref TEXT,
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
    CREATE TABLE IF NOT EXISTS session_rhythm_window_state (
      window_id TEXT PRIMARY KEY,
      profile TEXT NOT NULL,
      platform TEXT NOT NULL,
      issue_scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
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
    CREATE TABLE IF NOT EXISTS session_rhythm_event (
      event_id TEXT PRIMARY KEY,
      profile TEXT NOT NULL,
      platform TEXT NOT NULL,
      issue_scope TEXT NOT NULL,
      session_id TEXT NOT NULL,
      window_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      phase_before TEXT NOT NULL,
      phase_after TEXT NOT NULL,
      risk_state_before TEXT NOT NULL,
      risk_state_after TEXT NOT NULL,
      source_audit_event_id TEXT,
      reason TEXT,
      recorded_at TEXT NOT NULL,
      FOREIGN KEY(window_id) REFERENCES session_rhythm_window_state(window_id)
    );
    CREATE TABLE IF NOT EXISTS session_rhythm_decision (
      decision_id TEXT PRIMARY KEY,
      window_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      profile TEXT NOT NULL,
      current_phase TEXT NOT NULL,
      current_risk_state TEXT NOT NULL,
      next_phase TEXT NOT NULL,
      next_risk_state TEXT NOT NULL,
      effective_execution_mode TEXT,
      decision TEXT NOT NULL,
      reason_codes_json TEXT NOT NULL,
      requires_json TEXT NOT NULL,
      decided_at TEXT NOT NULL,
      FOREIGN KEY(window_id) REFERENCES session_rhythm_window_state(window_id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_rhythm_window_scope
      ON session_rhythm_window_state(profile, platform, issue_scope);
    CREATE INDEX IF NOT EXISTS idx_session_rhythm_event_window_recorded
      ON session_rhythm_event(window_id, recorded_at DESC);
    CREATE TABLE IF NOT EXISTS anti_detection_validation_request (
      request_ref TEXT PRIMARY KEY,
      validation_scope TEXT NOT NULL,
      target_fr_ref TEXT NOT NULL,
      profile_ref TEXT NOT NULL,
      browser_channel TEXT NOT NULL,
      execution_surface TEXT NOT NULL,
      sample_goal TEXT NOT NULL,
      requested_execution_mode TEXT NOT NULL,
      probe_bundle_ref TEXT NOT NULL,
      request_state TEXT NOT NULL,
      requested_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS anti_detection_structured_sample (
      sample_ref TEXT PRIMARY KEY,
      request_ref TEXT NOT NULL,
      target_fr_ref TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      profile_ref TEXT NOT NULL,
      browser_channel TEXT NOT NULL,
      execution_surface TEXT NOT NULL,
      effective_execution_mode TEXT NOT NULL,
      probe_bundle_ref TEXT NOT NULL,
      run_id TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      structured_payload TEXT NOT NULL,
      artifact_refs TEXT NOT NULL,
      FOREIGN KEY(request_ref) REFERENCES anti_detection_validation_request(request_ref)
    );
    CREATE TABLE IF NOT EXISTS anti_detection_baseline_snapshot (
      baseline_ref TEXT PRIMARY KEY,
      target_fr_ref TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      probe_bundle_ref TEXT NOT NULL,
      profile_ref TEXT NOT NULL,
      browser_channel TEXT NOT NULL,
      execution_surface TEXT NOT NULL,
      effective_execution_mode TEXT NOT NULL,
      signal_vector TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      source_sample_refs TEXT NOT NULL,
      source_run_ids TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS anti_detection_baseline_registry_entry (
      target_fr_ref TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      profile_ref TEXT NOT NULL,
      browser_channel TEXT NOT NULL,
      execution_surface TEXT NOT NULL,
      effective_execution_mode TEXT NOT NULL,
      probe_bundle_ref TEXT NOT NULL,
      active_baseline_ref TEXT NOT NULL,
      superseded_baseline_refs TEXT NOT NULL,
      replacement_reason TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (
        target_fr_ref,
        validation_scope,
        profile_ref,
        browser_channel,
        execution_surface,
        effective_execution_mode,
        probe_bundle_ref
      ),
      FOREIGN KEY(active_baseline_ref) REFERENCES anti_detection_baseline_snapshot(baseline_ref)
    );
    CREATE TABLE IF NOT EXISTS anti_detection_validation_record (
      record_ref TEXT PRIMARY KEY,
      request_ref TEXT NOT NULL,
      target_fr_ref TEXT NOT NULL,
      validation_scope TEXT NOT NULL,
      profile_ref TEXT NOT NULL,
      browser_channel TEXT NOT NULL,
      execution_surface TEXT NOT NULL,
      effective_execution_mode TEXT NOT NULL,
      probe_bundle_ref TEXT NOT NULL,
      sample_ref TEXT NOT NULL,
      baseline_ref TEXT,
      result_state TEXT NOT NULL,
      drift_state TEXT NOT NULL,
      failure_class TEXT,
      run_id TEXT NOT NULL,
      validated_at TEXT NOT NULL,
      FOREIGN KEY(request_ref) REFERENCES anti_detection_validation_request(request_ref),
      FOREIGN KEY(sample_ref) REFERENCES anti_detection_structured_sample(sample_ref),
      FOREIGN KEY(baseline_ref) REFERENCES anti_detection_baseline_snapshot(baseline_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_anti_detection_validation_record_scope_latest
      ON anti_detection_validation_record(
        target_fr_ref,
        validation_scope,
        profile_ref,
        browser_channel,
        execution_surface,
        effective_execution_mode,
        probe_bundle_ref,
        validated_at DESC
      );
    CREATE INDEX IF NOT EXISTS idx_anti_detection_validation_record_scope_success
      ON anti_detection_validation_record(
        target_fr_ref,
        validation_scope,
        profile_ref,
        browser_channel,
        execution_surface,
        effective_execution_mode,
        probe_bundle_ref,
        result_state,
        validated_at DESC
      );
  `);
  db.exec(`
    DROP VIEW IF EXISTS anti_detection_validation_view;
    CREATE VIEW IF NOT EXISTS anti_detection_validation_view AS
    WITH latest_records AS (
      SELECT
        anti_detection_validation_record.record_ref,
        anti_detection_validation_record.target_fr_ref,
        anti_detection_validation_record.validation_scope,
        anti_detection_validation_record.profile_ref,
        anti_detection_validation_record.browser_channel,
        anti_detection_validation_record.execution_surface,
        anti_detection_validation_record.effective_execution_mode,
        anti_detection_validation_record.probe_bundle_ref,
        anti_detection_validation_record.baseline_ref,
        anti_detection_validation_record.result_state,
        anti_detection_validation_record.drift_state,
        anti_detection_validation_record.validated_at,
        ROW_NUMBER() OVER (
          PARTITION BY
            anti_detection_validation_record.target_fr_ref,
            anti_detection_validation_record.validation_scope,
            anti_detection_validation_record.profile_ref,
            anti_detection_validation_record.browser_channel,
            anti_detection_validation_record.execution_surface,
            anti_detection_validation_record.effective_execution_mode,
            anti_detection_validation_record.probe_bundle_ref
          ORDER BY anti_detection_validation_record.validated_at DESC, anti_detection_validation_record.record_ref DESC
        ) AS row_num,
        MAX(
          CASE
            WHEN anti_detection_validation_record.result_state = 'verified'
              THEN anti_detection_validation_record.validated_at
            ELSE NULL
          END
        ) OVER (
          PARTITION BY
            anti_detection_validation_record.target_fr_ref,
            anti_detection_validation_record.validation_scope,
            anti_detection_validation_record.profile_ref,
            anti_detection_validation_record.browser_channel,
            anti_detection_validation_record.execution_surface,
            anti_detection_validation_record.effective_execution_mode,
            anti_detection_validation_record.probe_bundle_ref
        ) AS last_success_at
      FROM anti_detection_validation_record
    )
    SELECT
      latest_records.target_fr_ref,
      latest_records.validation_scope,
      latest_records.profile_ref,
      latest_records.browser_channel,
      latest_records.execution_surface,
      latest_records.effective_execution_mode,
      latest_records.probe_bundle_ref,
      latest_records.record_ref AS latest_record_ref,
      CASE
        WHEN anti_detection_baseline_registry_entry.active_baseline_ref IS NULL
          OR anti_detection_baseline_registry_entry.active_baseline_ref = ''
          THEN 'insufficient'
        WHEN latest_records.baseline_ref IS NULL OR latest_records.baseline_ref = ''
          THEN 'insufficient'
        WHEN latest_records.baseline_ref != anti_detection_baseline_registry_entry.active_baseline_ref
          THEN 'superseded'
        ELSE 'ready'
      END AS baseline_status,
      CASE
        WHEN anti_detection_baseline_registry_entry.active_baseline_ref IS NOT NULL
          AND anti_detection_baseline_registry_entry.active_baseline_ref != ''
          AND latest_records.baseline_ref IS NOT NULL
          AND latest_records.baseline_ref != ''
          AND latest_records.baseline_ref != anti_detection_baseline_registry_entry.active_baseline_ref
          THEN 'stale'
        ELSE latest_records.result_state
      END AS current_result_state,
      CASE
        WHEN anti_detection_baseline_registry_entry.active_baseline_ref IS NULL
          OR anti_detection_baseline_registry_entry.active_baseline_ref = ''
          THEN 'insufficient_baseline'
        WHEN latest_records.baseline_ref IS NULL OR latest_records.baseline_ref = ''
          THEN 'insufficient_baseline'
        WHEN latest_records.baseline_ref != anti_detection_baseline_registry_entry.active_baseline_ref
          THEN 'insufficient_baseline'
        ELSE latest_records.drift_state
      END AS current_drift_state,
      latest_records.last_success_at
    FROM latest_records
    LEFT JOIN anti_detection_baseline_registry_entry
      ON anti_detection_baseline_registry_entry.target_fr_ref = latest_records.target_fr_ref
      AND anti_detection_baseline_registry_entry.validation_scope = latest_records.validation_scope
      AND anti_detection_baseline_registry_entry.profile_ref = latest_records.profile_ref
      AND anti_detection_baseline_registry_entry.browser_channel = latest_records.browser_channel
      AND anti_detection_baseline_registry_entry.execution_surface = latest_records.execution_surface
      AND anti_detection_baseline_registry_entry.effective_execution_mode = latest_records.effective_execution_mode
      AND anti_detection_baseline_registry_entry.probe_bundle_ref = latest_records.probe_bundle_ref
    WHERE latest_records.row_num = 1;
  `);

  const row = db
    .prepare("SELECT value FROM runtime_store_meta WHERE key = 'schema_version'")
    .get() as { value?: string } | undefined;
  if (!row) {
    db.prepare(
      "INSERT INTO runtime_store_meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO NOTHING"
    ).run(String(SCHEMA_VERSION));
    return;
  }

  const version = Number(row.value);
  if (version === 1) {
    migrateV1ToV2(db);
    return;
  }

  let currentVersion = version;
  while (currentVersion !== SCHEMA_VERSION) {
    if (currentVersion === 2) {
      migrateV2ToV3(db);
      currentVersion = 3;
      continue;
    }
    if (currentVersion === 3) {
      migrateV3ToV4(db);
      currentVersion = 4;
      continue;
    }
    if (currentVersion === 4) {
      migrateV4ToV5(db);
      currentVersion = 5;
      continue;
    }
    if (currentVersion === 5) {
      migrateV5ToV6(db);
      currentVersion = 6;
      continue;
    }
    if (currentVersion === 6) {
      migrateV6ToV7(db);
      currentVersion = 7;
      continue;
    }
    if (currentVersion === 7) {
      migrateV7ToV8(db);
      currentVersion = 8;
      continue;
    }
    if (currentVersion === 8) {
      migrateV8ToV9(db);
      currentVersion = 9;
      continue;
    }
    if (currentVersion === 9) {
      migrateV9ToV10(db);
      currentVersion = 10;
      continue;
    }
    if (currentVersion === 10) {
      migrateV10ToV11(db);
      currentVersion = 11;
      continue;
    }
    if (currentVersion === 11) {
      migrateV11ToV12(db);
      currentVersion = 12;
      continue;
    }
    if (currentVersion === 12) {
      migrateV12ToV13(db);
      currentVersion = 13;
      continue;
    }
    if (currentVersion === 13) {
      migrateV13ToV14(db);
      currentVersion = 14;
      continue;
    }
    if (currentVersion === 14) {
      migrateV14ToV15(db);
      currentVersion = 15;
      continue;
    }
    if (currentVersion === 15) {
      migrateV15ToV16(db);
      currentVersion = 16;
      continue;
    }
    break;
  }

  if (currentVersion !== SCHEMA_VERSION) {
    throw onSchemaMismatch(row.value);
  }
};
