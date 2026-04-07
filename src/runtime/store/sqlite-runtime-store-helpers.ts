import type { GateApprovalRecord, GateAuditRecord } from "./sqlite-runtime-store.js";

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
