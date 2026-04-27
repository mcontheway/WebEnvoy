import { CliError } from "../core/errors.js";
import { WRITE_INTERACTION_TIER, getWriteActionMatrixDecisions, isIssueScope } from "../../shared/risk-state.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import { buildFingerprintContextForMeta, appendFingerprintContext } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { toSessionRhythmStatusView } from "../runtime/xhs-closeout-rhythm.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import { buildUnifiedRiskStateOutput, resolveRiskState } from "../runtime/risk-state.js";
import { RuntimeStoreError, SQLiteRuntimeStore, resolveRuntimeStorePath } from "../runtime/store/sqlite-runtime-store.js";
import { readXhsCloseoutValidationGateView, toXhsCloseoutValidationGateJson } from "../runtime/anti-detection-validation.js";
const asBoolean = (value) => value === true;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const buildPersistedSessionRhythmStatusView = (persisted) => {
    const windowState = persisted.window_state;
    const event = persisted.event;
    const currentPhase = asString(windowState.current_phase) ?? "unknown";
    return {
        profile: windowState.profile,
        platform: windowState.platform,
        issue_scope: windowState.issue_scope,
        current_phase: currentPhase,
        current_risk_state: windowState.risk_state,
        window_state: currentPhase === "steady" ? "stability" : currentPhase,
        cooldown_until: windowState.cooldown_until ?? null,
        stability_window_until: windowState.stability_window_until ?? null,
        latest_event_id: event.event_id ?? null,
        latest_reason: event.reason ?? null,
        derived_at: windowState.updated_at ?? null,
        session_rhythm_window_state: windowState,
        session_rhythm_event: event,
        session_rhythm_decision: persisted.decision
    };
};
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asStringArray = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
const hasOwn = (record, key) => Object.prototype.hasOwnProperty.call(record, key);
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
const profileRuntime = new ProfileRuntimeService();
const deriveWriteActionDecisions = (auditRecord) => {
    const issueScope = asString(auditRecord.issue_scope);
    const actionType = asString(auditRecord.action_type);
    const requestedExecutionMode = asString(auditRecord.requested_execution_mode);
    if (!issueScope || !isIssueScope(issueScope) || !actionType || !requestedExecutionMode) {
        return null;
    }
    return getWriteActionMatrixDecisions(issueScope, actionType, requestedExecutionMode);
};
const enrichAuditRecordWithWriteTier = (auditRecord) => {
    const writeActionMatrixDecisions = deriveWriteActionDecisions(auditRecord);
    const existingGateReasons = asStringArray(auditRecord.gate_reasons);
    const derivedGateReasons = [...existingGateReasons];
    const tierReason = writeActionMatrixDecisions
        ? `WRITE_INTERACTION_TIER_${String(writeActionMatrixDecisions.write_interaction_tier).toUpperCase()}`
        : null;
    if (writeActionMatrixDecisions &&
        writeActionMatrixDecisions.action_type !== "read" &&
        tierReason &&
        !derivedGateReasons.some((reason) => reason === tierReason)) {
        derivedGateReasons.push(tierReason);
    }
    return {
        ...auditRecord,
        gate_reasons: derivedGateReasons,
        write_interaction_tier: writeActionMatrixDecisions?.write_interaction_tier ?? null,
        write_action_matrix_decisions: writeActionMatrixDecisions
    };
};
const buildSessionRhythmStatusViewForProfile = async (cwd, profile, input) => {
    if (!profile) {
        return null;
    }
    const profileStore = new ProfileStore(resolveRuntimeProfileRoot(cwd));
    try {
        const meta = await profileStore.readMeta(profile, { mode: "readonly" });
        const fallbackView = toSessionRhythmStatusView({
            profile,
            rhythm: meta?.xhsCloseoutRhythm,
            accountSafety: meta?.accountSafety,
            sessionId: input?.sessionId ?? null,
            sourceRunId: input?.sourceRunId ?? null,
            sourceAuditEventId: input?.sourceAuditEventId ?? null,
            effectiveExecutionMode: input?.effectiveExecutionMode ?? null
        });
        const store = input?.store;
        if (!store) {
            return fallbackView;
        }
        const persisted = await store.getSessionRhythmStatusView({
            profile,
            platform: "xhs",
            issueScope: "issue_209",
            sessionId: input?.sessionId ?? null,
            runId: input?.sourceRunId ?? null
        });
        return persisted ? buildPersistedSessionRhythmStatusView(persisted) : fallbackView;
    }
    catch {
        return null;
    }
};
const resolveAntiDetectionEffectiveExecutionMode = (value) => {
    const mode = asString(value) ?? "live_read_high_risk";
    if (isAntiDetectionExecutionMode(mode)) {
        return mode;
    }
    return "live_read_high_risk";
};
const isAntiDetectionExecutionMode = (mode) => mode === "dry_run" ||
    mode === "recon" ||
    mode === "live_read_limited" ||
    mode === "live_read_high_risk" ||
    mode === "live_write";
const buildAntiDetectionValidationViewForProfile = async (input) => {
    if (!input.profile) {
        return null;
    }
    const gate = await readXhsCloseoutValidationGateView({
        store: input.store,
        profile: input.profile,
        effectiveExecutionMode: resolveAntiDetectionEffectiveExecutionMode(input.effectiveExecutionMode)
    });
    return toXhsCloseoutValidationGateJson(gate);
};
const resolveCurrentRiskState = (approvalRecord, auditRecords) => {
    const latestAudit = auditRecords[0] ?? null;
    const auditNextState = latestAudit?.next_state;
    const auditRiskState = latestAudit?.risk_state;
    if (typeof auditNextState === "string") {
        return resolveRiskState(auditNextState);
    }
    const latestRequestedMode = typeof latestAudit?.requested_execution_mode === "string"
        ? latestAudit.requested_execution_mode
        : null;
    const latestGateDecision = latestAudit?.gate_decision === "allowed" || latestAudit?.gate_decision === "blocked"
        ? latestAudit.gate_decision
        : null;
    const isLatestLiveMode = latestRequestedMode === "live_read_limited" ||
        latestRequestedMode === "live_read_high_risk" ||
        latestRequestedMode === "live_write";
    if (latestGateDecision === "blocked" && isLatestLiveMode) {
        const resolvedAuditRiskState = resolveRiskState(auditRiskState);
        if (resolvedAuditRiskState === "allowed") {
            return "limited";
        }
        if (resolvedAuditRiskState === "limited") {
            return "paused";
        }
        return resolvedAuditRiskState;
    }
    if (typeof auditRiskState === "string") {
        return resolveRiskState(auditRiskState);
    }
    const approvalChecks = asObject(approvalRecord?.checks);
    if (approvalRecord?.approved === true && approvalChecks?.risk_state_checked === true) {
        return "allowed";
    }
    const gateReasons = Array.isArray(latestAudit?.gate_reasons)
        ? latestAudit.gate_reasons.filter((item) => typeof item === "string")
        : [];
    if (gateReasons.some((reason) => reason === "RISK_STATE_LIMITED")) {
        return "limited";
    }
    return "paused";
};
const runtimePing = async (context) => {
    if (asBoolean(context.params.simulate_runtime_unavailable)) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "运行时不可用", { retryable: true });
    }
    if (asBoolean(context.params.force_fail)) {
        throw new Error("forced execution failure");
    }
    let bridge = null;
    try {
        const requestedExecutionMode = typeof context.params.requested_execution_mode === "string"
            ? context.params.requested_execution_mode
            : null;
        const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
        const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
        const bridgeParams = context.profile
            ? appendFingerprintContext(context.params, buildFingerprintContextForMeta(context.profile, profileMeta, {
                requestedExecutionMode
            }))
            : context.params;
        bridge = resolveRuntimeBridge();
        return await bridge.runtimePing({
            runId: context.run_id,
            profile: context.profile,
            cwd: context.cwd,
            params: bridgeParams
        });
    }
    catch (error) {
        if (error instanceof NativeMessagingTransportError) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
                retryable: error.retryable,
                cause: error
            });
        }
        throw error;
    }
    finally {
        await bridge?.close().catch(() => undefined);
    }
};
const runtimeStart = async (context) => profileRuntime.start({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
});
const runtimeLogin = async (context) => profileRuntime.login({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
});
const runtimeStatus = async (context) => profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
});
const runtimeStop = async (context) => profileRuntime.stop({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: context.params
});
const runtimeAuditQuery = async (context) => {
    const runId = asString(context.params.run_id);
    const sessionId = asString(context.params.session_id);
    const profile = asString(context.params.profile);
    const requestedExecutionMode = asString(context.params.requested_execution_mode);
    const limitRaw = asInteger(context.params.limit);
    const limit = limitRaw === null ? 20 : Math.max(1, Math.min(100, limitRaw));
    if (hasOwn(context.params, "requested_execution_mode") &&
        (!requestedExecutionMode || !isAntiDetectionExecutionMode(requestedExecutionMode))) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
            details: {
                ability_id: "runtime.audit",
                stage: "input_validation",
                reason: "AUDIT_QUERY_REQUESTED_EXECUTION_MODE_INVALID"
            }
        });
    }
    if (!runId && !sessionId && !profile) {
        throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
            details: {
                ability_id: "runtime.audit",
                stage: "input_validation",
                reason: "AUDIT_QUERY_FILTER_MISSING"
            }
        });
    }
    let store = null;
    try {
        store = new SQLiteRuntimeStore(resolveRuntimeStorePath(context.cwd));
        if (runId) {
            const trail = await store.getGateAuditTrail(runId);
            const enrichedAuditRecords = trail.auditRecords.map((record) => enrichAuditRecordWithWriteTier(record));
            const currentRiskState = resolveCurrentRiskState(asObject(trail.approvalRecord), enrichedAuditRecords);
            const auditProfile = asString(enrichedAuditRecords[0]?.profile);
            const latestAuditRecord = enrichedAuditRecords[0];
            const sessionRhythmStatusView = await buildSessionRhythmStatusViewForProfile(context.cwd, auditProfile, {
                store,
                sessionId: asString(latestAuditRecord?.session_id),
                sourceRunId: runId,
                sourceAuditEventId: asString(latestAuditRecord?.event_id),
                effectiveExecutionMode: asString(latestAuditRecord?.effective_execution_mode)
            });
            const antiDetectionValidationView = await buildAntiDetectionValidationViewForProfile({
                store,
                profile: auditProfile,
                effectiveExecutionMode: requestedExecutionMode ??
                    enrichedAuditRecords[0]
                        ?.requested_execution_mode ??
                    enrichedAuditRecords[0]
                        ?.effective_execution_mode
            });
            return {
                query: {
                    run_id: runId,
                    ...(requestedExecutionMode ? { requested_execution_mode: requestedExecutionMode } : {})
                },
                approval_record: trail.approvalRecord,
                audit_records: enrichedAuditRecords,
                write_interaction_tier: WRITE_INTERACTION_TIER,
                write_action_matrix_decisions: enrichedAuditRecords[0]
                    ?.write_action_matrix_decisions ?? null,
                risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
                    auditRecords: enrichedAuditRecords
                }),
                session_rhythm_status_view: sessionRhythmStatusView,
                anti_detection_validation_view: antiDetectionValidationView
            };
        }
        const records = await store.listGateAuditRecords({
            sessionId: sessionId ?? undefined,
            profile: profile ?? undefined,
            limit
        });
        const enrichedAuditRecords = records.map((record) => enrichAuditRecordWithWriteTier(record));
        const currentRiskState = resolveCurrentRiskState(null, enrichedAuditRecords);
        const auditProfile = asString(enrichedAuditRecords[0]?.profile);
        const latestAuditRecord = enrichedAuditRecords[0];
        const sessionRhythmStatusView = await buildSessionRhythmStatusViewForProfile(context.cwd, profile ?? auditProfile, {
            store,
            sessionId: sessionId ?? asString(latestAuditRecord?.session_id),
            sourceRunId: asString(latestAuditRecord?.run_id),
            sourceAuditEventId: asString(latestAuditRecord?.event_id),
            effectiveExecutionMode: asString(latestAuditRecord?.effective_execution_mode)
        });
        const antiDetectionValidationView = await buildAntiDetectionValidationViewForProfile({
            store,
            profile: profile ?? auditProfile,
            effectiveExecutionMode: requestedExecutionMode ??
                enrichedAuditRecords[0]
                    ?.requested_execution_mode ??
                enrichedAuditRecords[0]
                    ?.effective_execution_mode
        });
        return {
            query: {
                ...(sessionId ? { session_id: sessionId } : {}),
                ...(profile ? { profile } : {}),
                ...(requestedExecutionMode ? { requested_execution_mode: requestedExecutionMode } : {}),
                limit
            },
            audit_records: enrichedAuditRecords,
            write_interaction_tier: WRITE_INTERACTION_TIER,
            write_action_matrix_decisions: null,
            risk_state_output: buildUnifiedRiskStateOutput(currentRiskState, {
                auditRecords: enrichedAuditRecords
            }),
            session_rhythm_status_view: sessionRhythmStatusView,
            anti_detection_validation_view: antiDetectionValidationView
        };
    }
    catch (error) {
        if (error instanceof RuntimeStoreError) {
            if (error.code === "ERR_RUNTIME_STORE_INVALID_INPUT") {
                throw new CliError("ERR_CLI_INVALID_ARGS", "审计查询参数不合法", {
                    details: {
                        ability_id: "runtime.audit",
                        stage: "input_validation",
                        reason: "AUDIT_QUERY_INVALID_INPUT"
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
            // Best-effort close for read-only query path.
        }
    }
};
const runtimeHelp = async () => ({
    usage: "webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]",
    commands: [
        "runtime.help",
        "runtime.install",
        "runtime.uninstall",
        "runtime.ping",
        "runtime.start",
        "runtime.login",
        "runtime.status",
        "runtime.stop",
        "runtime.audit",
        "xhs.search",
        "xhs.detail",
        "xhs.user_home"
    ],
    notes: ["--params 必须是 JSON 对象字符串", "stdout 只输出单个 JSON 对象"]
});
export const runtimeCommands = () => [
    {
        name: "runtime.help",
        status: "implemented",
        handler: runtimeHelp
    },
    {
        name: "runtime.ping",
        status: "implemented",
        handler: runtimePing
    },
    {
        name: "runtime.start",
        status: "implemented",
        requiresProfile: true,
        handler: runtimeStart
    },
    {
        name: "runtime.login",
        status: "implemented",
        requiresProfile: true,
        handler: runtimeLogin
    },
    {
        name: "runtime.status",
        status: "implemented",
        requiresProfile: true,
        handler: runtimeStatus
    },
    {
        name: "runtime.stop",
        status: "implemented",
        requiresProfile: true,
        handler: runtimeStop
    },
    {
        name: "runtime.audit",
        status: "implemented",
        handler: runtimeAuditQuery
    }
];
