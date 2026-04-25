import { normalizeAccountSafetyRecord } from "./account-safety.js";
const STATES = [
    "not_required",
    "cooldown",
    "operator_confirmation_required",
    "single_probe_required",
    "single_probe_passed"
];
const isObjectRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const isIsoTimestampOrNull = (value) => value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
const isStringOrNull = (value) => value === null || typeof value === "string";
const isState = (value) => typeof value === "string" && STATES.includes(value);
const uniqueReasons = (reasons) => [...new Set(reasons.filter((reason) => reason.trim().length > 0))];
export const buildDefaultXhsCloseoutRhythmRecord = () => ({
    state: "not_required",
    cooldownUntil: null,
    operatorConfirmedAt: null,
    singleProbeRequired: false,
    singleProbePassedAt: null,
    probeRunId: null,
    fullBundleBlocked: false,
    reasonCodes: []
});
export const buildBlockedXhsCloseoutRhythmRecord = (input) => ({
    state: "cooldown",
    cooldownUntil: input.cooldownUntil,
    operatorConfirmedAt: null,
    singleProbeRequired: true,
    singleProbePassedAt: null,
    probeRunId: null,
    fullBundleBlocked: true,
    reasonCodes: uniqueReasons([
        "ACCOUNT_RISK_RECOVERY_REQUIRED",
        "XHS_CLOSEOUT_COOLDOWN_ACTIVE",
        input.reasonCode ?? ""
    ])
});
export const markXhsCloseoutOperatorConfirmed = (input) => {
    const current = normalizeXhsCloseoutRhythmRecord(input.current);
    if (current.probeRunId || current.singleProbePassedAt) {
        return {
            ...current,
            operatorConfirmedAt: input.confirmedAt,
            fullBundleBlocked: true,
            reasonCodes: uniqueReasons([...current.reasonCodes, "XHS_RECOVERY_OPERATOR_RECONFIRMED"])
        };
    }
    return {
        ...current,
        state: "single_probe_required",
        operatorConfirmedAt: input.confirmedAt,
        singleProbeRequired: true,
        singleProbePassedAt: null,
        probeRunId: null,
        fullBundleBlocked: true,
        reasonCodes: uniqueReasons([
            ...current.reasonCodes,
            "XHS_RECOVERY_OPERATOR_CONFIRMED",
            "XHS_RECOVERY_SINGLE_PROBE_REQUIRED"
        ])
    };
};
export const markXhsCloseoutSingleProbePassed = (input) => ({
    ...normalizeXhsCloseoutRhythmRecord(input.current),
    state: "single_probe_passed",
    singleProbeRequired: false,
    singleProbePassedAt: input.passedAt,
    probeRunId: input.probeRunId,
    fullBundleBlocked: true,
    reasonCodes: uniqueReasons(["XHS_RECOVERY_SINGLE_PROBE_PASSED", "ANTI_DETECTION_BASELINE_REQUIRED"])
});
export const claimXhsCloseoutSingleProbe = (input) => ({
    ...normalizeXhsCloseoutRhythmRecord(input.current),
    state: "single_probe_required",
    singleProbeRequired: true,
    singleProbePassedAt: null,
    probeRunId: input.probeRunId,
    fullBundleBlocked: true,
    reasonCodes: uniqueReasons([
        ...normalizeXhsCloseoutRhythmRecord(input.current).reasonCodes,
        "XHS_RECOVERY_SINGLE_PROBE_CLAIMED"
    ])
});
export function assertXhsCloseoutRhythmRecordShape(value) {
    const record = isObjectRecord(value) ? value : null;
    if (!record) {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm");
    }
    if (!isState(record.state)) {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.state");
    }
    if (!isIsoTimestampOrNull(record.cooldownUntil) ||
        !isIsoTimestampOrNull(record.operatorConfirmedAt) ||
        !isIsoTimestampOrNull(record.singleProbePassedAt)) {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm timestamps");
    }
    if (!isStringOrNull(record.probeRunId)) {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.probeRunId");
    }
    if (typeof record.singleProbeRequired !== "boolean" ||
        typeof record.fullBundleBlocked !== "boolean") {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm booleans");
    }
    if (!Array.isArray(record.reasonCodes) || record.reasonCodes.some((item) => typeof item !== "string")) {
        throw new Error("Invalid profile meta structure: xhsCloseoutRhythm.reasonCodes");
    }
}
export const normalizeXhsCloseoutRhythmRecord = (value) => {
    if (value === undefined || value === null) {
        return buildDefaultXhsCloseoutRhythmRecord();
    }
    assertXhsCloseoutRhythmRecordShape(value);
    return {
        ...value,
        reasonCodes: uniqueReasons(value.reasonCodes)
    };
};
export const resolveXhsCloseoutRhythmRecord = (input) => {
    const rhythm = normalizeXhsCloseoutRhythmRecord(input.rhythm);
    const accountSafety = normalizeAccountSafetyRecord(input.accountSafety);
    const nowMs = (input.now ?? new Date()).getTime();
    if (accountSafety.state === "account_risk_blocked") {
        const cooldownUntil = accountSafety.cooldownUntil ?? rhythm.cooldownUntil;
        const cooldownActive = cooldownUntil !== null && Date.parse(cooldownUntil) > nowMs;
        if (cooldownActive) {
            return {
                ...rhythm,
                state: "cooldown",
                cooldownUntil,
                singleProbeRequired: true,
                fullBundleBlocked: true,
                reasonCodes: uniqueReasons([
                    ...rhythm.reasonCodes,
                    "ACCOUNT_RISK_BLOCKED",
                    "XHS_CLOSEOUT_COOLDOWN_ACTIVE"
                ])
            };
        }
        if (!rhythm.operatorConfirmedAt) {
            return {
                ...rhythm,
                state: "operator_confirmation_required",
                cooldownUntil,
                singleProbeRequired: true,
                fullBundleBlocked: true,
                reasonCodes: uniqueReasons([
                    ...rhythm.reasonCodes,
                    "ACCOUNT_RISK_BLOCKED",
                    "XHS_RECOVERY_OPERATOR_CONFIRMATION_REQUIRED"
                ])
            };
        }
    }
    if (rhythm.state !== "not_required" &&
        rhythm.cooldownUntil !== null &&
        Date.parse(rhythm.cooldownUntil) > nowMs) {
        return {
            ...rhythm,
            state: "cooldown",
            singleProbeRequired: true,
            fullBundleBlocked: true,
            reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_CLOSEOUT_COOLDOWN_ACTIVE"])
        };
    }
    if (rhythm.state === "cooldown") {
        const cooldownActive = rhythm.cooldownUntil !== null && Date.parse(rhythm.cooldownUntil) > nowMs;
        if (cooldownActive) {
            return {
                ...rhythm,
                singleProbeRequired: true,
                fullBundleBlocked: true,
                reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_CLOSEOUT_COOLDOWN_ACTIVE"])
            };
        }
        if (!rhythm.operatorConfirmedAt) {
            return {
                ...rhythm,
                state: "operator_confirmation_required",
                singleProbeRequired: true,
                fullBundleBlocked: true,
                reasonCodes: uniqueReasons([
                    ...rhythm.reasonCodes,
                    "XHS_RECOVERY_OPERATOR_CONFIRMATION_REQUIRED"
                ])
            };
        }
    }
    if (rhythm.operatorConfirmedAt && !rhythm.singleProbePassedAt) {
        return {
            ...rhythm,
            state: "single_probe_required",
            singleProbeRequired: true,
            fullBundleBlocked: true,
            reasonCodes: uniqueReasons([...rhythm.reasonCodes, "XHS_RECOVERY_SINGLE_PROBE_REQUIRED"])
        };
    }
    if (rhythm.singleProbePassedAt) {
        return {
            ...rhythm,
            state: "single_probe_passed",
            singleProbeRequired: false,
            fullBundleBlocked: true,
            reasonCodes: uniqueReasons([...rhythm.reasonCodes, "ANTI_DETECTION_BASELINE_REQUIRED"])
        };
    }
    return rhythm;
};
export const toXhsCloseoutRhythmStatus = (input) => {
    const record = resolveXhsCloseoutRhythmRecord(input);
    return {
        state: record.state,
        cooldown_until: record.cooldownUntil,
        operator_confirmed_at: record.operatorConfirmedAt,
        single_probe_required: record.singleProbeRequired,
        single_probe_passed_at: record.singleProbePassedAt,
        probe_run_id: record.probeRunId,
        full_bundle_blocked: record.fullBundleBlocked,
        reason_codes: record.reasonCodes
    };
};
export const toSessionRhythmStatusView = (input) => {
    const now = input.now ?? new Date();
    const status = toXhsCloseoutRhythmStatus({ ...input, now });
    const reasonCodes = Array.isArray(status.reason_codes)
        ? status.reason_codes.filter((reason) => typeof reason === "string")
        : [];
    const state = typeof status.state === "string" ? status.state : "not_required";
    const phase = state === "cooldown"
        ? "cooldown"
        : state === "operator_confirmation_required" || state === "single_probe_required"
            ? "recovery_probe"
            : state === "single_probe_passed"
                ? "stability"
                : "steady";
    const riskState = state === "cooldown" || input.accountSafety?.state === "account_risk_blocked"
        ? "paused"
        : state === "not_required"
            ? "allowed"
            : "limited";
    return {
        profile: input.profile,
        platform: "xhs",
        issue_scope: input.issueScope ?? "issue_209",
        current_phase: phase,
        current_risk_state: riskState,
        window_state: phase === "steady" ? "stability" : phase,
        cooldown_until: status.cooldown_until,
        stability_window_until: null,
        latest_event_id: status.probe_run_id,
        latest_reason: reasonCodes[reasonCodes.length - 1] ?? null,
        derived_at: now.toISOString()
    };
};
