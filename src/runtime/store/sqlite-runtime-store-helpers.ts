import type {
  AntiDetectionBaselineRegistryEntryRecord,
  AntiDetectionBaselineSnapshotRecord,
  AntiDetectionStructuredSampleRecord,
  AntiDetectionValidationRecord,
  AntiDetectionValidationRequestRecord,
  AntiDetectionValidationViewRecord,
  GateApprovalRecord,
  GateAuditRecord
} from "./sqlite-runtime-store.js";

export const parseJsonObject = <T extends Record<string, unknown>>(
  value: unknown,
  fallback: T
): T => {
  if (typeof value !== "string" || value.length === 0) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as T)
      : fallback;
  } catch {
    return fallback;
  }
};

export const parseJsonArray = (value: unknown): string[] => {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
  } catch {
    return [];
  }
};

export const mapGateAuditRecordRow = (
  row: Omit<GateAuditRecord, "gate_reasons"> & { gate_reasons_json: string }
): GateAuditRecord => ({
  ...row,
  gate_reasons: parseJsonArray(row.gate_reasons_json)
});

export const mapGateApprovalRecordRow = (
  row: Omit<GateApprovalRecord, "approved" | "checks"> & {
    approved: number;
    checks_json: string;
  }
): GateApprovalRecord => ({
  approval_id: row.approval_id,
  run_id: row.run_id,
  decision_id: row.decision_id ?? null,
  approved: row.approved === 1,
  approver: row.approver,
  approved_at: row.approved_at,
  checks: Object.fromEntries(
    Object.entries(parseJsonObject<Record<string, unknown>>(row.checks_json, {})).map(
      ([key, value]) => [key, value === true]
    )
  ),
  created_at: row.created_at,
  updated_at: row.updated_at
});

export const mapAntiDetectionValidationRequestRow = (
  row: AntiDetectionValidationRequestRecord
): AntiDetectionValidationRequestRecord => ({ ...row });

export const mapAntiDetectionStructuredSampleRow = (
  row: Omit<AntiDetectionStructuredSampleRecord, "structured_payload" | "artifact_refs"> & {
    structured_payload: string;
    artifact_refs: string;
  }
): AntiDetectionStructuredSampleRecord => ({
  ...row,
  structured_payload: parseJsonObject<Record<string, unknown>>(row.structured_payload, {}),
  artifact_refs: parseJsonArray(row.artifact_refs)
});

export const mapAntiDetectionBaselineSnapshotRow = (
  row: Omit<
    AntiDetectionBaselineSnapshotRecord,
    "signal_vector" | "source_sample_refs" | "source_run_ids"
  > & {
    signal_vector: string;
    source_sample_refs: string;
    source_run_ids: string;
  }
): AntiDetectionBaselineSnapshotRecord => ({
  ...row,
  signal_vector: parseJsonObject<Record<string, unknown>>(row.signal_vector, {}),
  source_sample_refs: parseJsonArray(row.source_sample_refs),
  source_run_ids: parseJsonArray(row.source_run_ids)
});

export const mapAntiDetectionBaselineRegistryEntryRow = (
  row: Omit<AntiDetectionBaselineRegistryEntryRecord, "superseded_baseline_refs"> & {
    superseded_baseline_refs: string;
  }
): AntiDetectionBaselineRegistryEntryRecord => ({
  ...row,
  superseded_baseline_refs: parseJsonArray(row.superseded_baseline_refs)
});

export const mapAntiDetectionValidationRecordRow = (
  row: AntiDetectionValidationRecord
): AntiDetectionValidationRecord => ({ ...row });

export const mapAntiDetectionValidationViewRow = (
  row: AntiDetectionValidationViewRecord
): AntiDetectionValidationViewRecord => ({ ...row });
