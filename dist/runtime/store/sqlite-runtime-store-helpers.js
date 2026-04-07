export const parseJsonObject = (value, fallback) => {
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
export const parseJsonArray = (value) => {
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
export const mapGateAuditRecordRow = (row) => ({
    ...row,
    gate_reasons: parseJsonArray(row.gate_reasons_json)
});
export const mapGateApprovalRecordRow = (row) => ({
    approval_id: row.approval_id,
    run_id: row.run_id,
    approved: row.approved === 1,
    approver: row.approver,
    approved_at: row.approved_at,
    checks: Object.fromEntries(Object.entries(parseJsonObject(row.checks_json, {})).map(([key, value]) => [key, value === true])),
    created_at: row.created_at,
    updated_at: row.updated_at
});
