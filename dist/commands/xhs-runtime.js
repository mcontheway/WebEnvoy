import { CliError } from "../core/errors.js";
import { mapCapabilitySummaryForContract } from "../core/capability-output.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { buildLoopbackAuditRecord } from "../runtime/native-messaging/loopback-gate-audit.js";
import { buildLoopbackGate } from "../runtime/native-messaging/loopback-gate.js";
import { buildLoopbackGatePayload } from "../runtime/native-messaging/loopback-gate-payload.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { isAccountSafetyReason, toAccountSafetyStatus } from "../runtime/account-safety.js";
import { toSessionRhythmStatusView, toXhsCloseoutRhythmStatus } from "../runtime/xhs-closeout-rhythm.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import { readXhsCloseoutValidationGateView, toXhsCloseoutValidationGateJson } from "../runtime/anti-detection-validation.js";
import { RuntimeStoreError, SQLiteRuntimeStore, resolveRuntimeStorePath } from "../runtime/store/sqlite-runtime-store.js";
import { prepareOfficialChromeRuntime } from "../runtime/official-chrome-runtime.js";
import { buildCapabilityResult, ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY, normalizeGateOptionsForContract, parseAbilityEnvelopeForContract, parseDetailInputForContract, parseSearchInputForContract, parseUserHomeInputForContract, prepareIssue209LiveReadEnvelopeForContract } from "./xhs-input.js";
export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
export { normalizeGateOptionsForContract } from "./xhs-input.js";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asPositiveInteger = (value) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
export const resolveForwardTimeoutMsForContract = (params) => asPositiveInteger(params.timeout_ms);
const toSessionRhythmIdPart = (value) => value.replace(/[^A-Za-z0-9._-]+/gu, "_");
const buildSessionRhythmCompatibilityRefsForRuntime = async (input) => {
    if (!input.profile) {
        return null;
    }
    let store = null;
    try {
        store = new SQLiteRuntimeStore(resolveRuntimeStorePath(input.cwd));
        const issueScope = asString(input.gate.options.issue_scope) ?? "issue_209";
        const persisted = await store.getSessionRhythmStatusView({
            profile: input.profile,
            platform: "xhs",
            issueScope,
            sessionId: input.sessionId,
            runId: input.runId
        });
        const shouldWriteCurrentDecision = !!persisted ||
            !!input.profileMeta?.xhsCloseoutRhythm ||
            input.profileMeta?.accountSafety?.state === "account_risk_blocked";
        if (!shouldWriteCurrentDecision) {
            return null;
        }
        const currentView = toSessionRhythmStatusView({
            profile: input.profile,
            rhythm: input.profileMeta?.xhsCloseoutRhythm,
            accountSafety: input.profileMeta?.accountSafety,
            issueScope,
            sessionId: input.sessionId,
            sourceRunId: input.runId,
            effectiveExecutionMode: input.gate.requestedExecutionMode
        });
        const currentWindowState = asObject(currentView.session_rhythm_window_state);
        const currentEvent = asObject(currentView.session_rhythm_event);
        const currentDecision = asObject(currentView.session_rhythm_decision);
        const persistedWindowState = persisted?.window_state;
        const persistedEvent = persisted?.event;
        const persistedDecision = persisted?.decision;
        const windowId = asString(persistedWindowState?.window_id) ?? asString(currentWindowState?.window_id);
        const windowStateForRecord = persistedWindowState ?? currentWindowState;
        const eventForRecord = persistedEvent ?? currentEvent;
        const decisionForRecord = persistedDecision ?? currentDecision;
        if (!windowId || !windowStateForRecord || !eventForRecord || !decisionForRecord) {
            return null;
        }
        const liveRunPendingExecutionAudit = isLiveXhsExecutionMode(input.gate.requestedExecutionMode);
        const currentSourceKey = toSessionRhythmIdPart(input.runId);
        const currentEventId = `rhythm_evt_preflight_${currentSourceKey}`;
        const currentDecisionId = `rhythm_decision_preflight_${currentSourceKey}`;
        await store.recordSessionRhythmStatusView({
            profile: input.profile,
            platform: "xhs",
            issueScope,
            windowState: {
                ...windowStateForRecord,
                window_id: windowId,
                last_event_id: asString(persistedWindowState?.last_event_id) ?? currentEventId,
                source_run_id: asString(persistedWindowState?.source_run_id) ?? input.runId
            },
            event: {
                ...eventForRecord,
                event_id: asString(persistedEvent?.event_id) ?? currentEventId,
                session_id: asString(persistedEvent?.session_id) ?? input.sessionId,
                window_id: windowId,
                source_audit_event_id: asString(persistedEvent?.source_audit_event_id)
            },
            decision: {
                ...decisionForRecord,
                decision_id: currentDecisionId,
                window_id: windowId,
                run_id: input.runId,
                session_id: input.sessionId,
                profile: input.profile,
                current_phase: asString(windowStateForRecord.current_phase) ??
                    asString(decisionForRecord.current_phase) ??
                    "warmup",
                current_risk_state: asString(windowStateForRecord.risk_state) ??
                    asString(decisionForRecord.current_risk_state) ??
                    "paused",
                next_phase: asString(windowStateForRecord.current_phase) ??
                    asString(decisionForRecord.next_phase) ??
                    "warmup",
                next_risk_state: asString(windowStateForRecord.risk_state) ??
                    asString(decisionForRecord.next_risk_state) ??
                    "paused",
                effective_execution_mode: input.gate.requestedExecutionMode,
                decision: liveRunPendingExecutionAudit
                    ? "deferred"
                    : (asString(decisionForRecord.decision) ?? "blocked"),
                reason_codes: liveRunPendingExecutionAudit
                    ? ["XHS_LIVE_ADMISSION_PENDING_EXECUTION_AUDIT"]
                    : Array.isArray(decisionForRecord.reason_codes)
                        ? decisionForRecord.reason_codes
                        : [],
                requires: liveRunPendingExecutionAudit
                    ? ["execution_audit_appended"]
                    : Array.isArray(decisionForRecord.requires)
                        ? decisionForRecord.requires
                        : []
            }
        });
        const current = await store.getSessionRhythmStatusView({
            profile: input.profile,
            platform: "xhs",
            issueScope,
            sessionId: input.sessionId,
            runId: input.runId
        });
        const currentWindowId = asString(current?.window_state.window_id);
        const currentDecisionIdFromStore = asString(current?.decision.run_id) === input.runId
            ? asString(current?.decision.decision_id)
            : null;
        if (currentWindowId || currentDecisionIdFromStore) {
            return {
                ...(currentWindowId ? { __session_rhythm_window_id: currentWindowId } : {}),
                ...(currentDecisionIdFromStore
                    ? { __session_rhythm_decision_id: currentDecisionIdFromStore }
                    : {})
            };
        }
    }
    catch (error) {
        if (error instanceof RuntimeStoreError) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
                retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
                cause: error
            });
        }
        throw error;
    }
    finally {
        try {
            store?.close();
        }
        catch {
            // Compatibility refs are best-effort read-only after the query finishes.
        }
    }
    return null;
};
const readPersistedSessionRhythmBlockStatus = async (input) => {
    if (!input.profile) {
        return null;
    }
    let store = null;
    try {
        store = new SQLiteRuntimeStore(resolveRuntimeStorePath(input.cwd));
        const persisted = await store.getSessionRhythmStatusView({
            profile: input.profile,
            platform: "xhs",
            issueScope: input.issueScope ?? "issue_209"
        });
        const windowState = persisted?.window_state;
        const persistedDecision = persisted?.decision;
        const persistedDecisionValue = asString(persistedDecision?.decision);
        const event = persisted?.event;
        const profileRhythmState = asString(input.profileMeta?.xhsCloseoutRhythm?.state);
        const persistedPhase = asString(windowState?.current_phase);
        const fallbackAllowed = !profileRhythmState || profileRhythmState === "not_required";
        if (fallbackAllowed &&
            (persistedPhase === "recovery_probe" || persistedPhase === "warmup")) {
            return {
                state: "single_probe_required",
                cooldown_until: asString(windowState?.cooldown_until),
                operator_confirmed_at: null,
                single_probe_required: true,
                single_probe_passed_at: null,
                probe_run_id: asString(windowState?.source_run_id),
                full_bundle_blocked: true,
                reason_codes: Array.isArray(persistedDecision?.reason_codes) &&
                    persistedDecision.reason_codes.every((reason) => typeof reason === "string")
                    ? persistedDecision.reason_codes
                    : [
                        asString(event?.reason) ??
                            asString(windowState?.last_event_id) ??
                            "PERSISTED_SESSION_RHYTHM_RECOVERY_REQUIRED"
                    ]
            };
        }
        if (persistedPhase !== "cooldown" &&
            asString(windowState?.risk_state) !== "paused") {
            if (persistedDecisionValue === "deferred" &&
                fallbackAllowed) {
                const reasonCodes = Array.isArray(persistedDecision?.reason_codes) &&
                    persistedDecision.reason_codes.every((reason) => typeof reason === "string")
                    ? persistedDecision.reason_codes
                    : [
                        asString(event?.reason) ??
                            asString(windowState?.last_event_id) ??
                            "XHS_RECOVERY_SINGLE_PROBE_PASSED"
                    ];
                return {
                    state: "single_probe_passed",
                    cooldown_until: asString(windowState?.cooldown_until),
                    operator_confirmed_at: null,
                    single_probe_required: false,
                    single_probe_passed_at: asString(persistedDecision?.decided_at) ?? asString(event?.recorded_at),
                    probe_run_id: asString(persistedDecision?.run_id) ?? asString(windowState?.source_run_id),
                    full_bundle_blocked: true,
                    reason_codes: reasonCodes
                };
            }
            if (persistedDecisionValue &&
                persistedDecisionValue !== "allowed" &&
                fallbackAllowed) {
                return {
                    state: "operator_confirmation_required",
                    cooldown_until: null,
                    operator_confirmed_at: null,
                    single_probe_required: true,
                    single_probe_passed_at: null,
                    probe_run_id: null,
                    full_bundle_blocked: true,
                    reason_codes: Array.isArray(persistedDecision?.reason_codes) &&
                        persistedDecision.reason_codes.every((reason) => typeof reason === "string")
                        ? persistedDecision.reason_codes
                        : [
                            asString(event?.reason) ??
                                asString(windowState?.last_event_id) ??
                                "PERSISTED_SESSION_RHYTHM_BLOCKED"
                        ]
                };
            }
            return null;
        }
        const cooldownUntil = asString(windowState?.cooldown_until);
        const operatorConfirmedAt = asString(input.profileMeta?.xhsCloseoutRhythm?.operatorConfirmedAt);
        if (operatorConfirmedAt &&
            (!cooldownUntil || Date.parse(cooldownUntil) <= Date.now())) {
            return null;
        }
        return {
            state: "cooldown",
            cooldown_until: cooldownUntil,
            operator_confirmed_at: null,
            single_probe_required: true,
            single_probe_passed_at: null,
            probe_run_id: null,
            full_bundle_blocked: true,
            reason_codes: [
                asString(event?.reason) ??
                    asString(windowState?.last_event_id) ??
                    "PERSISTED_SESSION_RHYTHM_PAUSED"
            ]
        };
    }
    catch (error) {
        if (error instanceof RuntimeStoreError) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
                retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
                cause: error
            });
        }
        throw error;
    }
    finally {
        try {
            store?.close();
        }
        catch {
            // Read-only preflight best-effort close.
        }
    }
};
const asInteger = (value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    return null;
};
const hasOwn = (record, key) => !!record && Object.prototype.hasOwnProperty.call(record, key);
const LIVE_XHS_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const isLiveXhsExecutionMode = (mode) => LIVE_XHS_EXECUTION_MODES.has(mode);
const isLiveXhsReadExecutionMode = (mode) => mode === "live_read_limited" || mode === "live_read_high_risk";
const ACCOUNT_SAFETY_REASON_ALIASES = {
    SESSION_EXPIRED: "SESSION_EXPIRED",
    XHS_LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
    LOGIN_REQUIRED: "XHS_LOGIN_REQUIRED",
    ACCOUNT_ABNORMAL: "ACCOUNT_ABNORMAL",
    XHS_ACCOUNT_RISK_PAGE: "XHS_ACCOUNT_RISK_PAGE",
    CAPTCHA_REQUIRED: "CAPTCHA_REQUIRED",
    BROWSER_ENV_ABNORMAL: "BROWSER_ENV_ABNORMAL"
};
const normalizeAccountSafetyReason = (value) => {
    const raw = asString(value);
    if (!raw) {
        return null;
    }
    const normalized = raw.trim().toUpperCase();
    const mapped = ACCOUNT_SAFETY_REASON_ALIASES[normalized];
    return mapped && isAccountSafetyReason(mapped) ? mapped : null;
};
const pickCanonicalSummaryField = (payload, key) => {
    const summary = asObject(payload.summary);
    const value = hasOwn(payload, key)
        ? payload[key]
        : hasOwn(summary ?? undefined, key)
            ? summary?.[key]
            : undefined;
    if (!hasOwn(payload, key) && !hasOwn(summary ?? undefined, key)) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    return asObject(value) ?? undefined;
};
const isTransportFailureCode = (code) => code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
    code === "ERR_TRANSPORT_TIMEOUT" ||
    code === "ERR_TRANSPORT_DISCONNECTED" ||
    code === "ERR_TRANSPORT_FORWARD_FAILED" ||
    code === "ERR_TRANSPORT_NOT_READY";
const resolveRuntimeBridge = () => {
    if (process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback") {
        return new NativeMessagingBridge({
            transport: createLoopbackNativeBridgeTransport()
        });
    }
    return new NativeMessagingBridge({
        transport: new NativeHostBridgeTransport()
    });
};
const asObservabilityInput = (value) => {
    const object = asObject(value);
    return object ?? undefined;
};
const asDiagnosisInput = (value) => {
    const object = asObject(value);
    return object ?? undefined;
};
const pickGateErrorDetails = (payload, details) => {
    const detailKeys = [
        "validation_action",
        "target_page",
        "editor_locator",
        "input_text",
        "before_text",
        "visible_text",
        "post_blur_text",
        "focus_confirmed",
        "preserved_after_blur",
        "success_signals",
        "failure_signals",
        "minimum_replay",
        "out_of_scope_actions",
        "execution_failure",
        "scope_context",
        "gate_input",
        "gate_outcome",
        "read_execution_policy",
        "issue_action_matrix",
        "write_interaction_tier",
        "write_action_matrix_decisions",
        "consumer_gate_result",
        "request_admission_result",
        "execution_audit",
        "approval_record",
        "audit_record",
        "risk_state_output",
        "account_safety",
        "xhs_closeout_rhythm",
        "anti_detection_validation_view",
        "runtime_stop",
        "status_code",
        "platform_code"
    ];
    const picked = {};
    const hasOwn = (record, key) => !!record && Object.prototype.hasOwnProperty.call(record, key);
    for (const key of detailKeys) {
        const value = hasOwn(payload, key)
            ? payload[key]
            : hasOwn(details ?? undefined, key)
                ? details?.[key]
                : undefined;
        if (!hasOwn(payload, key) && !hasOwn(details ?? undefined, key)) {
            continue;
        }
        if (value === null) {
            picked[key] = null;
            continue;
        }
        const object = asObject(value);
        if (object) {
            picked[key] = object;
            continue;
        }
        if (Array.isArray(value)) {
            picked[key] = value;
            continue;
        }
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            picked[key] = value;
        }
    }
    return picked;
};
const toCliExecutionError = (ability, payload, fallbackMessage) => {
    const details = asObject(payload.details);
    const reason = typeof details?.reason === "string" && details.reason.trim().length > 0
        ? details.reason.trim()
        : "TARGET_API_RESPONSE_INVALID";
    const consumerGateResult = asObject(payload.consumer_gate_result);
    return new CliError("ERR_EXECUTION_FAILED", fallbackMessage, {
        retryable: payload.retryable === true,
        details: {
            ability_id: ability.id,
            stage: details?.stage === "input_validation" ||
                details?.stage === "output_mapping" ||
                details?.stage === "execution"
                ? details.stage
                : "execution",
            reason,
            ...(consumerGateResult ?? {}),
            ...pickGateErrorDetails(payload, details)
        },
        observability: asObservabilityInput(payload.observability),
        diagnosis: asDiagnosisInput(payload.diagnosis)
    });
};
const toTransportCliError = (error, ability) => new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
    retryable: error.retryable,
    cause: error,
    details: {
        ability_id: ability.id,
        stage: "execution",
        reason: error.code
    }
});
const firstRecord = (value) => {
    if (!Array.isArray(value)) {
        return null;
    }
    for (const item of value) {
        const record = asObject(item);
        if (record) {
            return record;
        }
    }
    return null;
};
const resolveNestedObject = (record, key) => asObject(record?.[key]);
const resolveAccountSafetySignal = (payload, fallback) => {
    const details = asObject(payload.details);
    const observability = asObject(payload.observability);
    const pageState = resolveNestedObject(observability, "page_state");
    const keyRequest = firstRecord(observability?.key_requests);
    const gateInput = asObject(payload.gate_input) ?? asObject(details?.gate_input);
    const consumerGateResult = asObject(payload.consumer_gate_result);
    const auditRecord = asObject(payload.audit_record);
    const diagnosis = asObject(payload.diagnosis);
    const diagnosisEvidence = Array.isArray(diagnosis?.evidence) ? diagnosis?.evidence : [];
    const reason = normalizeAccountSafetyReason(details?.reason) ??
        normalizeAccountSafetyReason(keyRequest?.failure_reason) ??
        normalizeAccountSafetyReason(diagnosisEvidence.find((item) => normalizeAccountSafetyReason(item))) ??
        (() => {
            const statusCode = asInteger(details?.status_code) ?? asInteger(keyRequest?.status_code);
            const platformCode = asInteger(details?.platform_code);
            if (statusCode === 401) {
                return "SESSION_EXPIRED";
            }
            if (statusCode === 461 || platformCode === 300011) {
                return "ACCOUNT_ABNORMAL";
            }
            if (platformCode === 300015) {
                return "BROWSER_ENV_ABNORMAL";
            }
            return null;
        })();
    if (!reason) {
        return null;
    }
    const targetTabId = asInteger(details?.target_tab_id) ??
        asInteger(consumerGateResult?.target_tab_id) ??
        asInteger(gateInput?.target_tab_id) ??
        asInteger(auditRecord?.target_tab_id) ??
        fallback.targetTabId;
    return {
        reason,
        sourceCommand: fallback.command,
        targetDomain: asString(details?.target_domain) ??
            asString(consumerGateResult?.target_domain) ??
            asString(gateInput?.target_domain) ??
            asString(auditRecord?.target_domain) ??
            fallback.targetDomain,
        targetTabId,
        pageUrl: asString(details?.page_url) ??
            asString(pageState?.url) ??
            fallback.targetPage,
        statusCode: asInteger(details?.status_code) ?? asInteger(keyRequest?.status_code),
        platformCode: asInteger(details?.platform_code)
    };
};
const mergeAccountSafetyIntoFailurePayload = (payload, accountSafety, xhsCloseoutRhythm, runtimeStop) => {
    const details = asObject(payload.details) ?? {};
    const accountSafetyReason = asString(accountSafety.reason);
    payload.details = {
        ...details,
        ...(!asString(details.reason) && accountSafetyReason ? { reason: accountSafetyReason } : {}),
        account_safety: accountSafety,
        ...(xhsCloseoutRhythm ? { xhs_closeout_rhythm: xhsCloseoutRhythm } : {}),
        ...(runtimeStop ? { runtime_stop: runtimeStop } : {})
    };
    payload.account_safety = accountSafety;
    if (xhsCloseoutRhythm) {
        payload.xhs_closeout_rhythm = xhsCloseoutRhythm;
    }
    if (runtimeStop) {
        payload.runtime_stop = runtimeStop;
    }
};
const isXhsRecoveryProbe = (input) => input.command === "xhs.search" &&
    input.ability.id === "xhs.note.search.v1" &&
    input.options.xhs_recovery_probe === true;
const isXhsLiveReadBaselineGateCommand = (input) => (input.command === "xhs.search" ||
    input.command === "xhs.detail" ||
    input.command === "xhs.user_home") &&
    isLiveXhsReadExecutionMode(input.requestedExecutionMode);
const shouldReturnInProcessGateOnlyResult = (input) => input.requestedExecutionMode === "dry_run" &&
    asString(process.env.WEBENVOY_NATIVE_TRANSPORT) === null;
const buildInProcessGateOnlyResult = (input) => {
    const profile = input.context.profile ?? "gate_only_profile";
    const sessionId = `gate-only-${input.context.run_id}`;
    const { __anonymous_isolation_verified: anonymousIsolationVerified, target_site_logged_in: targetSiteLoggedIn, ...preparedGateOptions } = input.preparedIssue209LiveRead.options;
    const gateOptions = {
        ...preparedGateOptions,
        ...(typeof anonymousIsolationVerified === "boolean"
            ? { __anonymous_isolation_verified: anonymousIsolationVerified }
            : {}),
        ...(typeof targetSiteLoggedIn === "boolean"
            ? { target_site_logged_in: targetSiteLoggedIn }
            : {}),
        ...(typeof input.context.profile === "string"
            ? { __runtime_profile_ref: input.context.profile }
            : {})
    };
    const gateBundle = buildLoopbackGate(gateOptions, input.envelope.ability.action, {
        runId: input.context.run_id,
        requestId: input.envelope.requestId ?? undefined,
        commandRequestId: input.preparedIssue209LiveRead.commandRequestId ?? undefined,
        sessionId,
        profile,
        gateInvocationId: input.preparedIssue209LiveRead.gateInvocationId ?? undefined
    });
    const auditRecord = buildLoopbackAuditRecord({
        runId: input.context.run_id,
        sessionId,
        profile,
        gate: gateBundle
    });
    auditRecord.recorded_at = new Date().toISOString();
    const payload = buildLoopbackGatePayload({
        runId: input.context.run_id,
        sessionId,
        profile,
        gate: gateBundle,
        auditRecord
    });
    if (gateBundle.consumerGateResult.gate_decision === "blocked") {
        payload.details = {
            ability_id: input.envelope.ability.id,
            stage: "execution",
            reason: "EXECUTION_MODE_GATE_BLOCKED"
        };
        throw toCliExecutionError(input.envelope.ability, payload, `执行模式门禁阻断了当前 ${input.context.command} 请求`);
    }
    const dataRefValue = typeof input.parsedInput[input.dataRefKey] === "string"
        ? String(input.parsedInput[input.dataRefKey])
        : "";
    const summary = mapCapabilitySummaryForContract(input.envelope.ability.id, {
        ...buildCapabilityResult(input.envelope.ability, {
            data_ref: dataRefValue ? { [input.dataRefKey]: dataRefValue } : {},
            metrics: {
                count: 0
            }
        }),
        ...payload,
        session_id: sessionId,
        requested_execution_mode: input.gate.requestedExecutionMode,
        ...(typeof anonymousIsolationVerified === "boolean"
            ? { __anonymous_isolation_verified: anonymousIsolationVerified }
            : {}),
        ...(typeof targetSiteLoggedIn === "boolean"
            ? { target_site_logged_in: targetSiteLoggedIn }
            : {})
    });
    return {
        summary,
        observability: asObservabilityInput(payload.observability)
    };
};
const assertXhsLivePreflightAllowsCommand = (input) => {
    const recoveryProbe = isXhsRecoveryProbe(input);
    const xhsLiveReadBaselineGate = isXhsLiveReadBaselineGateCommand(input);
    const rhythmState = asString(input.xhsCloseoutRhythm.state);
    const fullBundleBlocked = input.xhsCloseoutRhythm.full_bundle_blocked === true;
    const singleProbeRequired = input.xhsCloseoutRhythm.single_probe_required === true;
    const probeRunId = asString(input.xhsCloseoutRhythm.probe_run_id);
    const accountSafetyClear = input.accountSafety.state === "clear";
    if (recoveryProbe &&
        input.requestedExecutionMode === "recon" &&
        rhythmState === "single_probe_required" &&
        accountSafetyClear &&
        probeRunId === null) {
        return;
    }
    if (!recoveryProbe &&
        xhsLiveReadBaselineGate &&
        accountSafetyClear &&
        rhythmState === "single_probe_passed" &&
        input.antiDetectionValidationView?.all_required_ready === true) {
        return;
    }
    if (!recoveryProbe &&
        isLiveXhsExecutionMode(input.requestedExecutionMode) &&
        accountSafetyClear &&
        rhythmState === "not_required") {
        return;
    }
    if (!recoveryProbe &&
        !xhsLiveReadBaselineGate &&
        isLiveXhsExecutionMode(input.requestedExecutionMode) &&
        accountSafetyClear &&
        rhythmState === "single_probe_passed" &&
        input.antiDetectionValidationView?.all_required_ready === true) {
        return;
    }
    throw new CliError("ERR_EXECUTION_FAILED", "XHS account-safety gate blocked current live command", {
        retryable: false,
        details: {
            ability_id: input.ability.id,
            stage: "execution",
            reason: input.accountSafety.state === "account_risk_blocked"
                ? "ACCOUNT_RISK_BLOCKED"
                : recoveryProbe && input.requestedExecutionMode !== "recon"
                    ? "XHS_RECOVERY_PROBE_MODE_INVALID"
                    : !recoveryProbe && isLiveXhsExecutionMode(input.requestedExecutionMode) && rhythmState === "single_probe_passed"
                        ? "ANTI_DETECTION_VALIDATION_BASELINE_BLOCKED"
                        : fullBundleBlocked || singleProbeRequired
                            ? "XHS_CLOSEOUT_RHYTHM_BLOCKED"
                            : "XHS_CLOSEOUT_RHYTHM_UNAVAILABLE",
            account_safety: input.accountSafety,
            xhs_closeout_rhythm: input.xhsCloseoutRhythm,
            ...(input.antiDetectionValidationView
                ? {
                    anti_detection_validation_view: toXhsCloseoutValidationGateJson(input.antiDetectionValidationView)
                }
                : {})
        }
    });
};
const prepareXhsOfficialChromeRuntime = async (context, ability, requestedExecutionMode, bridge, fingerprintContext, gate, readStatus) => {
    return await prepareOfficialChromeRuntime({
        context,
        consumerId: ability.id,
        requestedExecutionMode,
        bridge,
        fingerprintContext,
        bootstrapTargetTabId: gate.targetTabId,
        bootstrapTargetDomain: gate.targetDomain,
        bootstrapTargetPage: gate.targetPage,
        bootstrapTargetResourceId: gate.targetResourceId ?? null,
        readStatus
    });
};
export const ensureOfficialChromeRuntimeReady = async (context, ability, requestedExecutionMode, bridge, fingerprintContext, gate, readStatus) => {
    await prepareXhsOfficialChromeRuntime(context, ability, requestedExecutionMode, bridge, fingerprintContext, gate, readStatus);
};
const resolveBootstrapTargetResourceId = (command, parsedInput) => {
    if (command === "xhs.detail") {
        return typeof parsedInput.note_id === "string" && parsedInput.note_id.trim().length > 0
            ? parsedInput.note_id.trim()
            : null;
    }
    if (command === "xhs.user_home") {
        return typeof parsedInput.user_id === "string" && parsedInput.user_id.trim().length > 0
            ? parsedInput.user_id.trim()
            : null;
    }
    return null;
};
const buildActiveApiFetchFallbackRuntimeAttestation = (input) => {
    const runtimeReadiness = asString(input.status?.runtimeReadiness ?? input.status?.runtime_readiness);
    const executionSurface = asString(input.status?.executionSurface ?? input.status?.execution_surface);
    const headless = typeof input.status?.headless === "boolean" ? input.status.headless : null;
    if (!runtimeReadiness || !executionSurface || headless === null) {
        return null;
    }
    return {
        source: "official_chrome_runtime_readiness",
        runtime_readiness: runtimeReadiness,
        profile_ref: input.context.profile ?? null,
        session_id: input.sessionId,
        run_id: input.context.run_id,
        execution_surface: executionSurface,
        headless,
        observed_at: new Date().toISOString()
    };
};
const injectActiveApiFetchFallbackRuntimeAttestation = (input) => {
    const activeFallback = asObject(input.options.active_api_fetch_fallback);
    if (!activeFallback) {
        return input.options;
    }
    const { fingerprint_validation_state: _fingerprintValidationState, execution_surface: _executionSurface, headless: _headless, runtime_attestation: _runtimeAttestation, fingerprint_attestation: _fingerprintAttestation, ...activeFallbackRest } = activeFallback;
    return {
        ...input.options,
        active_api_fetch_fallback: {
            ...activeFallbackRest,
            ...(input.attestation ? { runtime_attestation: input.attestation } : {})
        }
    };
};
const xhsSearch = async (context) => {
    return xhsReadCommand(context, {
        fixtureDataRefKey: "query",
        parseInput: (envelope, gate) => parseSearchInputForContract(envelope.input, envelope.ability.id, gate.options, envelope.ability.action)
    });
};
const xhsDetail = async (context) => {
    return xhsReadCommand(context, {
        fixtureDataRefKey: "note_id",
        parseInput: (envelope) => parseDetailInputForContract(envelope.input, envelope.ability.id)
    });
};
const xhsUserHome = async (context) => {
    return xhsReadCommand(context, {
        fixtureDataRefKey: "user_id",
        parseInput: (envelope) => parseUserHomeInputForContract(envelope.input, envelope.ability.id)
    });
};
const xhsReadCommand = async (context, inputConfig) => {
    const envelope = parseAbilityEnvelopeForContract(context.params);
    const gate = normalizeGateOptionsForContract(envelope.options, envelope.ability.id, {
        command: context.command,
        abilityAction: envelope.ability.action,
        runtimeProfile: context.profile ?? null,
        upstreamAuthorization: envelope.upstreamAuthorization
    });
    const parsedInput = inputConfig.parseInput(envelope, gate);
    if (process.env.NODE_ENV === "test" &&
        process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
        gate.options.fixture_success === true) {
        const dataRefValue = typeof parsedInput[inputConfig.fixtureDataRefKey] === "string"
            ? String(parsedInput[inputConfig.fixtureDataRefKey])
            : null;
        return {
            summary: mapCapabilitySummaryForContract(envelope.ability.id, buildCapabilityResult(envelope.ability, {
                data_ref: dataRefValue ? { [inputConfig.fixtureDataRefKey]: dataRefValue } : {},
                metrics: {
                    count: 0
                }
            }))
        };
    }
    if (envelope.input.force_bad_output === true) {
        return {
            summary: mapCapabilitySummaryForContract(envelope.ability.id, {})
        };
    }
    const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
    let profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
    const accountSafetyStatus = toAccountSafetyStatus(profileMeta?.accountSafety);
    let xhsCloseoutRhythmStatus = toXhsCloseoutRhythmStatus({
        rhythm: profileMeta?.xhsCloseoutRhythm,
        accountSafety: profileMeta?.accountSafety
    });
    xhsCloseoutRhythmStatus =
        (await readPersistedSessionRhythmBlockStatus({
            cwd: context.cwd,
            profile: context.profile,
            issueScope: asString(gate.options.issue_scope),
            profileMeta
        })) ?? xhsCloseoutRhythmStatus;
    const profileRuntime = new ProfileRuntimeService();
    const recoveryProbeRequested = isXhsRecoveryProbe({
        command: context.command,
        ability: envelope.ability,
        options: gate.options
    });
    const liveXhsCommandRequested = isLiveXhsExecutionMode(gate.requestedExecutionMode);
    const reconXhsCommandRequested = gate.requestedExecutionMode === "recon";
    const xhsLiveReadBaselineGateRequested = isXhsLiveReadBaselineGateCommand({
        command: context.command,
        options: gate.options,
        requestedExecutionMode: gate.requestedExecutionMode
    });
    const accountSafetyBlockedLiveCommand = accountSafetyStatus.state === "account_risk_blocked" &&
        (liveXhsCommandRequested || recoveryProbeRequested);
    let antiDetectionValidationGate = null;
    if (context.profile &&
        (liveXhsCommandRequested || recoveryProbeRequested || accountSafetyBlockedLiveCommand)) {
        const rhythmState = asString(xhsCloseoutRhythmStatus.state);
        const shouldRunRhythmGate = recoveryProbeRequested ||
            liveXhsCommandRequested ||
            accountSafetyBlockedLiveCommand ||
            (rhythmState !== null && rhythmState !== "not_required");
        if (shouldRunRhythmGate) {
            if (!recoveryProbeRequested &&
                liveXhsCommandRequested &&
                rhythmState === "single_probe_passed") {
                let store = null;
                try {
                    store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
                    antiDetectionValidationGate = await readXhsCloseoutValidationGateView({
                        store,
                        profile: context.profile,
                        effectiveExecutionMode: gate.requestedExecutionMode
                    });
                }
                catch (error) {
                    if (error instanceof RuntimeStoreError) {
                        if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
                            throw new CliError("ERR_CLI_INVALID_ARGS", "XHS 反检测验证查询参数不合法", {
                                details: {
                                    ability_id: envelope.ability.id,
                                    stage: "input_validation",
                                    reason: "ANTI_DETECTION_VALIDATION_QUERY_INVALID_INPUT"
                                }
                            });
                        }
                        throw new CliError("ERR_RUNTIME_UNAVAILABLE", `运行记录存储失败: ${error.code}`, {
                            retryable: error.code !== "ERR_RUNTIME_STORE_SCHEMA_MISMATCH",
                            cause: error
                        });
                    }
                    throw error;
                }
                finally {
                    try {
                        store?.close();
                    }
                    catch {
                        // Read-only preflight best-effort close.
                    }
                }
            }
            assertXhsLivePreflightAllowsCommand({
                command: context.command,
                ability: envelope.ability,
                accountSafety: accountSafetyStatus,
                xhsCloseoutRhythm: xhsCloseoutRhythmStatus,
                antiDetectionValidationView: antiDetectionValidationGate,
                options: gate.options,
                requestedExecutionMode: gate.requestedExecutionMode
            });
        }
    }
    try {
        const preparedIssue209LiveRead = prepareIssue209LiveReadEnvelopeForContract({
            options: gate.options,
            requestId: envelope.requestId,
            gateInvocationId: envelope.gateInvocationId,
            runId: context.run_id
        });
        if (shouldReturnInProcessGateOnlyResult({
            requestedExecutionMode: gate.requestedExecutionMode
        })) {
            return buildInProcessGateOnlyResult({
                context,
                envelope,
                gate,
                parsedInput,
                preparedIssue209LiveRead,
                dataRefKey: inputConfig.fixtureDataRefKey
            });
        }
        const bridge = resolveRuntimeBridge();
        const fingerprintContext = buildFingerprintContextForMeta(context.profile ?? "unknown", profileMeta, {
            requestedExecutionMode: gate.requestedExecutionMode
        });
        let officialChromeRuntimeStatus = null;
        if (liveXhsCommandRequested || recoveryProbeRequested || reconXhsCommandRequested) {
            officialChromeRuntimeStatus = await prepareXhsOfficialChromeRuntime(context, envelope.ability, gate.requestedExecutionMode, bridge, fingerprintContext, {
                ...gate,
                targetResourceId: resolveBootstrapTargetResourceId(context.command, parsedInput)
            });
        }
        const bridgeSessionId = await bridge.ensureSession({
            profile: context.profile
        });
        if (context.profile && recoveryProbeRequested) {
            await profileRuntime.claimXhsCloseoutSingleProbe({
                cwd: context.cwd,
                profile: context.profile,
                runId: context.run_id,
                params: {}
            });
            profileMeta = await profileStore.readMeta(context.profile);
        }
        const transportIsLoopback = process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback";
        const { __anonymous_isolation_verified: anonymousIsolationVerified, target_site_logged_in: targetSiteLoggedIn, ...preparedGateOptions } = preparedIssue209LiveRead.options;
        const sessionRhythmCompatibilityRefs = await buildSessionRhythmCompatibilityRefsForRuntime({
            cwd: context.cwd,
            profile: context.profile,
            runId: context.run_id,
            sessionId: bridgeSessionId,
            profileMeta,
            gate
        });
        const forwardTimeoutMs = resolveForwardTimeoutMsForContract(context.params);
        const runtimeGateOptions = {
            ...injectActiveApiFetchFallbackRuntimeAttestation({
                options: preparedGateOptions,
                attestation: buildActiveApiFetchFallbackRuntimeAttestation({
                    status: officialChromeRuntimeStatus,
                    context,
                    sessionId: bridgeSessionId
                })
            }),
            ...(sessionRhythmCompatibilityRefs ?? {}),
            ...(transportIsLoopback && typeof anonymousIsolationVerified === "boolean"
                ? { __anonymous_isolation_verified: anonymousIsolationVerified }
                : {}),
            ...(transportIsLoopback && typeof targetSiteLoggedIn === "boolean"
                ? { target_site_logged_in: targetSiteLoggedIn }
                : {}),
            ...(typeof context.profile === "string" ? { __runtime_profile_ref: context.profile } : {})
        };
        const commandParams = appendFingerprintContext({
            ...(forwardTimeoutMs ? { timeout_ms: forwardTimeoutMs } : {}),
            ...(preparedIssue209LiveRead.commandRequestId
                ? { request_id: preparedIssue209LiveRead.commandRequestId }
                : {}),
            ...(preparedIssue209LiveRead.gateInvocationId
                ? { gate_invocation_id: preparedIssue209LiveRead.gateInvocationId }
                : {}),
            ...(preparedIssue209LiveRead.admissionDraft
                ? {
                    [ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY]: preparedIssue209LiveRead.admissionDraft
                }
                : {}),
            target_domain: gate.targetDomain,
            target_tab_id: gate.targetTabId,
            target_page: gate.targetPage,
            requested_execution_mode: gate.requestedExecutionMode,
            ability: envelope.ability,
            input: parsedInput,
            options: runtimeGateOptions,
            session_id: bridgeSessionId
        }, fingerprintContext);
        const bridgeResult = await bridge.runCommand({
            runId: context.run_id,
            profile: context.profile,
            cwd: context.cwd,
            command: context.command,
            params: commandParams
        });
        if (!bridgeResult.ok) {
            const accountSafetySignal = context.profile && (isLiveXhsExecutionMode(gate.requestedExecutionMode) || recoveryProbeRequested)
                ? resolveAccountSafetySignal(bridgeResult.payload, {
                    command: context.command,
                    targetDomain: gate.targetDomain,
                    targetTabId: gate.targetTabId,
                    targetPage: gate.targetPage
                })
                : null;
            if (accountSafetySignal && context.profile) {
                const accountSafetyResult = await profileRuntime.markAccountSafetyBlocked({
                    cwd: context.cwd,
                    profile: context.profile,
                    runId: context.run_id,
                    params: {},
                    signal: accountSafetySignal
                });
                const accountSafety = asObject(accountSafetyResult.account_safety);
                const xhsCloseoutRhythm = asObject(accountSafetyResult.xhs_closeout_rhythm);
                const runtimeStop = asObject(accountSafetyResult.runtime_stop);
                if (accountSafety) {
                    mergeAccountSafetyIntoFailurePayload(bridgeResult.payload, accountSafety, xhsCloseoutRhythm, runtimeStop);
                }
            }
            throw toCliExecutionError(envelope.ability, bridgeResult.payload, bridgeResult.error.message);
        }
        const recoveryProbeRiskSignal = context.profile && recoveryProbeRequested
            ? resolveAccountSafetySignal(bridgeResult.payload, {
                command: context.command,
                targetDomain: gate.targetDomain,
                targetTabId: gate.targetTabId,
                targetPage: gate.targetPage
            })
            : null;
        if (recoveryProbeRiskSignal && context.profile) {
            const accountSafetyResult = await profileRuntime.markAccountSafetyBlocked({
                cwd: context.cwd,
                profile: context.profile,
                runId: context.run_id,
                params: {},
                signal: recoveryProbeRiskSignal
            });
            const accountSafety = asObject(accountSafetyResult.account_safety);
            const xhsCloseoutRhythm = asObject(accountSafetyResult.xhs_closeout_rhythm);
            const runtimeStop = asObject(accountSafetyResult.runtime_stop);
            if (accountSafety) {
                mergeAccountSafetyIntoFailurePayload(bridgeResult.payload, accountSafety, xhsCloseoutRhythm, runtimeStop);
            }
            throw toCliExecutionError(envelope.ability, bridgeResult.payload, "XHS recovery probe detected account-safety risk");
        }
        const consumerGateResult = asObject(bridgeResult.payload.consumer_gate_result);
        const requestAdmissionResult = pickCanonicalSummaryField(bridgeResult.payload, "request_admission_result");
        const executionAudit = pickCanonicalSummaryField(bridgeResult.payload, "execution_audit");
        const summary = mapCapabilitySummaryForContract(envelope.ability.id, {
            ...(asObject(bridgeResult.payload.summary) ?? {}),
            session_id: bridgeSessionId,
            requested_execution_mode: gate.requestedExecutionMode,
            ...(consumerGateResult ? { consumer_gate_result: consumerGateResult } : {}),
            ...(requestAdmissionResult !== undefined
                ? { request_admission_result: requestAdmissionResult }
                : {}),
            ...(executionAudit !== undefined ? { execution_audit: executionAudit } : {})
        });
        if (context.profile &&
            recoveryProbeRequested) {
            const recoveryStatus = await profileRuntime.markXhsCloseoutSingleProbePassed({
                cwd: context.cwd,
                profile: context.profile,
                runId: context.run_id,
                params: {}
            });
            const xhsCloseoutRhythm = asObject(recoveryStatus.xhs_closeout_rhythm);
            if (xhsCloseoutRhythm) {
                summary.xhs_closeout_rhythm = xhsCloseoutRhythm;
            }
            const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
            const latestMeta = await profileStore.readMeta(context.profile, { mode: "readonly" });
            const recoveryRhythmView = toSessionRhythmStatusView({
                profile: context.profile,
                rhythm: latestMeta?.xhsCloseoutRhythm,
                accountSafety: latestMeta?.accountSafety,
                issueScope: asString(gate.options.issue_scope) ?? "issue_209",
                sessionId: bridgeSessionId,
                sourceRunId: context.run_id,
                effectiveExecutionMode: gate.requestedExecutionMode
            });
            const windowState = asObject(recoveryRhythmView.session_rhythm_window_state);
            const event = asObject(recoveryRhythmView.session_rhythm_event);
            const decision = asObject(recoveryRhythmView.session_rhythm_decision);
            if (windowState && event && decision) {
                const store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
                try {
                    await store.recordSessionRhythmStatusView({
                        profile: context.profile,
                        platform: "xhs",
                        issueScope: asString(gate.options.issue_scope) ?? "issue_209",
                        windowState,
                        event,
                        decision
                    });
                }
                finally {
                    store.close();
                }
            }
        }
        return {
            summary,
            observability: asObservabilityInput(bridgeResult.payload.observability)
        };
    }
    catch (error) {
        if (error instanceof NativeMessagingTransportError) {
            throw toTransportCliError(error, envelope.ability);
        }
        throw error;
    }
};
export const xhsCommands = () => [
    {
        name: "xhs.search",
        status: "implemented",
        requiresProfile: true,
        handler: xhsSearch
    },
    {
        name: "xhs.detail",
        status: "implemented",
        requiresProfile: true,
        handler: xhsDetail
    },
    {
        name: "xhs.user_home",
        status: "implemented",
        requiresProfile: true,
        handler: xhsUserHome
    }
];
