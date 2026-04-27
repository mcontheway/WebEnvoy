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
const sanitizeIdPart = (value) => value.replace(/[^A-Za-z0-9._-]+/gu, "_");
const addMinutesIso = (value, minutes) => new Date(Date.parse(value) + minutes * 60 * 1000).toISOString();
const resolveSessionRhythmPhase = (state) => state === "cooldown"
    ? "cooldown"
    : state === "operator_confirmation_required" || state === "single_probe_required"
        ? "recovery_probe"
        : "steady";
const resolveSessionRhythmRiskState = (input) => input.state === "cooldown" || input.accountSafety?.state === "account_risk_blocked"
    ? "paused"
    : input.state === "not_required"
        ? "allowed"
        : "limited";
const resolveSessionRhythmEventType = (input) => {
    if (input.accountSafety?.state === "account_risk_blocked") {
        return "risk_signal";
    }
    if (input.state === "single_probe_passed") {
        return "recovery_probe_passed";
    }
    if (input.phase === "cooldown") {
        return "cooldown_started";
    }
    if (input.phase === "recovery_probe") {
        return "recovery_probe_started";
    }
    return "stability_window_passed";
};
export const buildSessionRhythmFormalView = (input) => {
    const now = input.now ?? new Date();
    const status = toXhsCloseoutRhythmStatus({ ...input, now });
    const reasonCodes = Array.isArray(status.reason_codes)
        ? status.reason_codes.filter((reason) => typeof reason === "string")
        : [];
    const state = typeof status.state === "string" ? status.state : "not_required";
    const phase = resolveSessionRhythmPhase(state);
    const riskState = resolveSessionRhythmRiskState({ state, accountSafety: input.accountSafety });
    const profileKey = sanitizeIdPart(input.profile);
    const issueScope = input.issueScope ?? "issue_209";
    const statusProbeRunId = typeof status.probe_run_id === "string" && status.probe_run_id.length > 0
        ? status.probe_run_id
        : null;
    const sourceRunId = statusProbeRunId ?? input.sourceRunId ?? null;
    const sourceKey = sanitizeIdPart(sourceRunId ?? `${profileKey}_${state}`);
    const windowId = `rhythm_win_${profileKey}_${sanitizeIdPart(issueScope)}`;
    const latestEventId = `rhythm_evt_${sourceKey}`;
    const decisionId = `rhythm_decision_${sourceKey}`;
    const latestReason = reasonCodes[reasonCodes.length - 1] ?? null;
    const observedAt = input.accountSafety?.observedAt ?? null;
    const operatorConfirmedAt = typeof status.operator_confirmed_at === "string" ? status.operator_confirmed_at : null;
    const singleProbePassedAt = typeof status.single_probe_passed_at === "string" ? status.single_probe_passed_at : null;
    const cooldownUntil = typeof status.cooldown_until === "string" ? status.cooldown_until : null;
    const windowStartedAt = observedAt ??
        operatorConfirmedAt ??
        singleProbePassedAt ??
        now.toISOString();
    const recoveryProbeDueAt = state === "single_probe_required"
        ? operatorConfirmedAt ?? now.toISOString()
        : state === "operator_confirmation_required"
            ? cooldownUntil ?? now.toISOString()
            : null;
    const stabilityWindowUntil = phase === "steady" ? addMinutesIso(singleProbePassedAt ?? windowStartedAt, 20) : null;
    const windowDeadlineAt = phase === "cooldown"
        ? cooldownUntil ?? addMinutesIso(windowStartedAt, 30)
        : phase === "recovery_probe"
            ? recoveryProbeDueAt ?? addMinutesIso(windowStartedAt, 5)
            : stabilityWindowUntil ?? addMinutesIso(windowStartedAt, 20);
    const decision = phase === "cooldown" || state === "operator_confirmation_required" || state === "single_probe_required"
        ? "blocked"
        : state === "single_probe_passed"
            ? "deferred"
            : "allowed";
    const eventPhaseBefore = state === "single_probe_passed" ? "recovery_probe" : phase;
    const eventPhaseAfter = state === "single_probe_passed" ? "steady" : phase;
    return {
        windowState: {
            window_id: windowId,
            profile: input.profile,
            platform: "xhs",
            issue_scope: issueScope,
            session_id: input.sessionId ?? null,
            current_phase: phase,
            risk_state: riskState,
            window_started_at: windowStartedAt,
            window_deadline_at: windowDeadlineAt,
            cooldown_until: cooldownUntil,
            recovery_probe_due_at: recoveryProbeDueAt,
            stability_window_until: stabilityWindowUntil,
            risk_signal_count: input.accountSafety?.state === "account_risk_blocked" ? 1 : 0,
            last_event_id: latestEventId,
            source_run_id: sourceRunId,
            updated_at: now.toISOString()
        },
        event: {
            event_id: latestEventId,
            profile: input.profile,
            platform: "xhs",
            issue_scope: issueScope,
            session_id: input.sessionId ?? null,
            window_id: windowId,
            event_type: resolveSessionRhythmEventType({
                state,
                phase,
                accountSafety: input.accountSafety
            }),
            phase_before: eventPhaseBefore,
            phase_after: eventPhaseAfter,
            risk_state_before: riskState,
            risk_state_after: riskState,
            source_audit_event_id: input.sourceAuditEventId ?? null,
            reason: latestReason ?? "SESSION_RHYTHM_STATUS_OBSERVED",
            recorded_at: now.toISOString()
        },
        decision: {
            decision_id: decisionId,
            window_id: windowId,
            run_id: sourceRunId,
            session_id: input.sessionId ?? null,
            profile: input.profile,
            current_phase: phase,
            current_risk_state: riskState,
            next_phase: phase,
            next_risk_state: riskState,
            effective_execution_mode: input.effectiveExecutionMode ?? "recon",
            decision,
            reason_codes: reasonCodes,
            requires: decision === "allowed" ? [] : ["session_rhythm_window_not_ready"],
            decided_at: now.toISOString()
        }
    };
};
export const toSessionRhythmStatusView = (input) => {
    const now = input.now ?? new Date();
    const status = toXhsCloseoutRhythmStatus({ ...input, now });
    const reasonCodes = Array.isArray(status.reason_codes)
        ? status.reason_codes.filter((reason) => typeof reason === "string")
        : [];
    const state = typeof status.state === "string" ? status.state : "not_required";
    const phase = resolveSessionRhythmPhase(state);
    const riskState = resolveSessionRhythmRiskState({ state, accountSafety: input.accountSafety });
    const formalView = buildSessionRhythmFormalView({ ...input, now });
    const hasFormalIds = typeof input.sessionId === "string" &&
        input.sessionId.length > 0 &&
        typeof formalView.windowState.source_run_id === "string" &&
        formalView.windowState.source_run_id.length > 0 &&
        typeof formalView.decision.run_id === "string" &&
        formalView.decision.run_id.length > 0;
    return {
        profile: input.profile,
        platform: "xhs",
        issue_scope: input.issueScope ?? "issue_209",
        current_phase: phase,
        current_risk_state: riskState,
        window_state: phase === "steady" ? "stability" : phase,
        cooldown_until: status.cooldown_until,
        stability_window_until: null,
        latest_event_id: formalView.event.event_id,
        latest_reason: reasonCodes[reasonCodes.length - 1] ?? null,
        derived_at: now.toISOString(),
        ...(hasFormalIds
            ? {
                session_rhythm_window_state: formalView.windowState,
                session_rhythm_event: formalView.event,
                session_rhythm_decision: formalView.decision
            }
            : {})
    };
};
