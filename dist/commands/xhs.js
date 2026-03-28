import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { CliError } from "../core/errors.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileRuntimeService } from "../runtime/profile-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
const ABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set(["read", "write", "download"]);
const XHS_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const XHS_LIVE_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];
const profileRuntime = new ProfileRuntimeService();
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const isTransportFailureCode = (code) => code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
    code === "ERR_TRANSPORT_TIMEOUT" ||
    code === "ERR_TRANSPORT_DISCONNECTED" ||
    code === "ERR_TRANSPORT_FORWARD_FAILED" ||
    code === "ERR_TRANSPORT_NOT_READY";
const buildOfficialChromeRuntimeReadiness = (input) => {
    if (input.identityBindingState === "missing" || input.identityBindingState === "mismatch") {
        return "blocked";
    }
    if (!input.lockHeld) {
        return input.transportState === "disconnected" ? "recoverable" : "blocked";
    }
    if (input.transportState === "disconnected" || input.transportState === "not_connected") {
        return "recoverable";
    }
    if (input.transportState === "ready" && input.bootstrapState === "ready") {
        return "ready";
    }
    if (input.transportState === "ready" &&
        (input.bootstrapState === "pending" || input.bootstrapState === "not_started")) {
        return "pending";
    }
    if (input.bootstrapState === "failed") {
        return "recoverable";
    }
    if (input.bootstrapState === "stale") {
        return "blocked";
    }
    return "unknown";
};
const buildRuntimeBootstrapEnvelope = (input) => ({
    version: "v1",
    run_id: input.runId,
    runtime_context_id: `runtime-context-${createHash("sha256")
        .update(`${input.profile}:${input.runId}`)
        .digest("hex")
        .slice(0, 16)}`,
    profile: input.profile,
    fingerprint_runtime: input.fingerprintRuntime,
    fingerprint_patch_manifest: asObject(input.fingerprintRuntime.fingerprint_patch_manifest) ?? {},
    main_world_secret: randomUUID()
});
const readOfficialChromeRuntimeReadinessViaBridge = async (input) => {
    const readinessResult = await input.bridge.runCommand({
        runId: input.context.run_id,
        profile: input.context.profile,
        cwd: input.context.cwd,
        command: "runtime.readiness",
        params: appendFingerprintContext({
            requested_execution_mode: input.requestedExecutionMode,
            target_domain: input.gate.targetDomain,
            target_tab_id: input.gate.targetTabId,
            target_page: input.gate.targetPage,
            options: input.gate.options
        }, input.fingerprintContext)
    });
    if (!readinessResult.ok) {
        if (isTransportFailureCode(readinessResult.error.code)) {
            throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${readinessResult.error.code}`, {
                retryable: true,
                details: {
                    ability_id: input.abilityId,
                    stage: "execution",
                    reason: readinessResult.error.code
                }
            });
        }
        throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime readiness 未获得执行面确认", {
            retryable: true,
            details: {
                ability_id: input.abilityId,
                stage: "execution",
                reason: readinessResult.error.code
            }
        });
    }
    const payload = asObject(readinessResult.payload);
    const transportState = payload?.transport_state === "disconnected"
        ? "disconnected"
        : payload?.transport_state === "ready"
            ? "ready"
            : "not_connected";
    const bootstrapState = payload?.bootstrap_state === "not_started" ||
        payload?.bootstrap_state === "pending" ||
        payload?.bootstrap_state === "ready" ||
        payload?.bootstrap_state === "stale" ||
        payload?.bootstrap_state === "failed"
        ? String(payload.bootstrap_state)
        : "not_started";
    return {
        identityBindingState: input.identityBindingState,
        transportState,
        bootstrapState,
        runtimeReadiness: buildOfficialChromeRuntimeReadiness({
            lockHeld: input.lockHeld,
            identityBindingState: input.identityBindingState,
            transportState,
            bootstrapState
        })
    };
};
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
export const buildOfficialChromeRuntimeStatusParams = (context, requestedExecutionMode) => {
    const params = {
        requested_execution_mode: requestedExecutionMode
    };
    const persistentExtensionIdentity = asObject(context.params.persistent_extension_identity) ??
        asObject(context.params.persistentExtensionIdentity);
    if (persistentExtensionIdentity) {
        params.persistent_extension_identity = persistentExtensionIdentity;
    }
    return params;
};
const invalidAbilityInput = (reason, abilityId = "unknown") => new CliError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason
    }
});
const parseAbilityEnvelope = (params) => {
    const abilityObject = asObject(params.ability);
    if (!abilityObject) {
        throw invalidAbilityInput("ABILITY_MISSING");
    }
    const abilityId = typeof abilityObject.id === "string" && abilityObject.id.trim().length > 0
        ? abilityObject.id.trim()
        : null;
    if (!abilityId) {
        throw invalidAbilityInput("ABILITY_ID_INVALID");
    }
    const layer = abilityObject.layer;
    if (typeof layer !== "string" || !ABILITY_LAYERS.has(layer)) {
        throw invalidAbilityInput("ABILITY_LAYER_INVALID", abilityId);
    }
    const action = abilityObject.action;
    if (typeof action !== "string" || !ABILITY_ACTIONS.has(action)) {
        throw invalidAbilityInput("ABILITY_ACTION_INVALID", abilityId);
    }
    const input = asObject(params.input);
    if (!input) {
        throw invalidAbilityInput("ABILITY_INPUT_INVALID", abilityId);
    }
    const options = params.options === undefined ? {} : asObject(params.options);
    if (!options) {
        throw invalidAbilityInput("ABILITY_OPTIONS_INVALID", abilityId);
    }
    return {
        ability: {
            id: abilityId,
            layer: layer,
            action: action
        },
        input,
        options
    };
};
const parseSearchInput = (input, abilityId) => {
    const query = typeof input.query === "string" && input.query.trim().length > 0 ? input.query.trim() : null;
    if (!query) {
        throw invalidAbilityInput("QUERY_MISSING", abilityId);
    }
    const normalized = {
        query
    };
    if (typeof input.limit === "number" && Number.isFinite(input.limit)) {
        normalized.limit = Math.max(1, Math.floor(input.limit));
    }
    if (typeof input.page === "number" && Number.isFinite(input.page)) {
        normalized.page = Math.max(1, Math.floor(input.page));
    }
    if (typeof input.search_id === "string" && input.search_id.trim().length > 0) {
        normalized.search_id = input.search_id.trim();
    }
    if (typeof input.sort === "string" && input.sort.trim().length > 0) {
        normalized.sort = input.sort.trim();
    }
    if ((typeof input.note_type === "string" && input.note_type.trim().length > 0) ||
        typeof input.note_type === "number") {
        normalized.note_type = input.note_type;
    }
    return normalized;
};
const normalizeGateOptions = (options, abilityId) => {
    const targetDomain = typeof options.target_domain === "string" && options.target_domain.trim().length > 0
        ? options.target_domain.trim()
        : null;
    if (!targetDomain) {
        throw invalidAbilityInput("TARGET_DOMAIN_INVALID", abilityId);
    }
    const targetTabId = typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)
        ? options.target_tab_id
        : null;
    if (targetTabId === null) {
        throw invalidAbilityInput("TARGET_TAB_ID_INVALID", abilityId);
    }
    const targetPage = typeof options.target_page === "string" && options.target_page.trim().length > 0
        ? options.target_page.trim()
        : null;
    if (!targetPage) {
        throw invalidAbilityInput("TARGET_PAGE_INVALID", abilityId);
    }
    const requestedExecutionMode = typeof options.requested_execution_mode === "string" &&
        XHS_EXECUTION_MODES.has(options.requested_execution_mode)
        ? options.requested_execution_mode
        : null;
    if (!requestedExecutionMode) {
        throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_INVALID", abilityId);
    }
    return {
        targetDomain,
        targetTabId,
        targetPage,
        requestedExecutionMode,
        options: {
            ...options,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            requested_execution_mode: requestedExecutionMode
        }
    };
};
const buildCapabilityResult = (ability, summary) => ({
    capability_result: {
        ability_id: ability.id,
        layer: ability.layer,
        action: ability.action,
        outcome: "partial",
        ...(summary ? summary : {})
    }
});
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
        "scope_context",
        "gate_input",
        "gate_outcome",
        "read_execution_policy",
        "issue_action_matrix",
        "write_interaction_tier",
        "write_action_matrix_decisions",
        "consumer_gate_result",
        "approval_record",
        "audit_record",
        "risk_state_output"
    ];
    const picked = {};
    for (const key of detailKeys) {
        const value = payload[key] ?? details?.[key];
        if (value === null) {
            picked[key] = null;
            continue;
        }
        const object = asObject(value);
        if (object) {
            picked[key] = object;
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
export const ensureOfficialChromeRuntimeReady = async (context, ability, requestedExecutionMode, bridge, fingerprintContext, gate, readStatus = async () => await profileRuntime.status({
    cwd: context.cwd,
    profile: context.profile ?? "",
    runId: context.run_id,
    params: buildOfficialChromeRuntimeStatusParams(context, requestedExecutionMode)
})) => {
    let status = await readStatus();
    const identityPreflight = asObject(status.identityPreflight);
    if (identityPreflight?.mode !== "official_chrome_persistent_extension") {
        return;
    }
    const profileState = typeof status.profileState === "string" ? status.profileState : "uninitialized";
    const confirmationRequired = status.confirmationRequired === true;
    const attemptExecutionBootstrap = async () => {
        const envelope = buildRuntimeBootstrapEnvelope({
            profile: context.profile ?? "",
            runId: context.run_id,
            fingerprintRuntime: fingerprintContext
        });
        const bootstrapResult = await bridge.runCommand({
            runId: context.run_id,
            profile: context.profile,
            cwd: context.cwd,
            command: "runtime.bootstrap",
            params: envelope
        });
        if (!bootstrapResult.ok) {
            if (isTransportFailureCode(bootstrapResult.error.code)) {
                throw new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${bootstrapResult.error.code}`, {
                    details: {
                        ability_id: ability.id,
                        stage: "execution",
                        reason: bootstrapResult.error.code
                    },
                    retryable: true
                });
            }
            throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime bootstrap 未获得执行面确认", {
                details: {
                    ability_id: ability.id,
                    stage: "execution",
                    reason: bootstrapResult.error.code
                },
                retryable: true
            });
        }
        const payload = asObject(bootstrapResult.payload);
        const ack = asObject(payload?.result);
        const ackVersion = typeof ack?.version === "string" ? ack.version : null;
        const ackStatus = typeof ack?.status === "string" ? ack.status : null;
        const ackRunId = typeof ack?.run_id === "string" ? ack.run_id : null;
        const ackContextId = typeof ack?.runtime_context_id === "string" ? ack.runtime_context_id : null;
        const ackProfile = typeof ack?.profile === "string" ? ack.profile : null;
        if (ackStatus !== "ready" ||
            ackVersion !== envelope.version ||
            ackRunId !== envelope.run_id ||
            ackContextId !== envelope.runtime_context_id ||
            ackProfile !== envelope.profile) {
            throw new CliError(ackStatus === "stale"
                ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
                : "ERR_RUNTIME_READY_SIGNAL_CONFLICT", ackStatus === "stale"
                ? "official Chrome runtime bootstrap 返回了陈旧 ack"
                : "official Chrome runtime bootstrap ack 与当前运行上下文不一致", {
                details: {
                    ability_id: ability.id,
                    stage: "execution",
                    reason: ackStatus === "stale"
                        ? "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
                        : "ERR_RUNTIME_READY_SIGNAL_CONFLICT"
                },
                retryable: true
            });
        }
    };
    let runtimeReadiness = typeof status.runtimeReadiness === "string" ? status.runtimeReadiness : "unknown";
    let lockHeld = status.lockHeld === true;
    if (runtimeReadiness === "ready" && lockHeld) {
        return;
    }
    let identityBindingState = typeof status.identityBindingState === "string" ? status.identityBindingState : "missing";
    let bootstrapState = typeof status.bootstrapState === "string" ? status.bootstrapState : "not_started";
    let transportState = typeof status.transportState === "string" ? status.transportState : "not_connected";
    const buildBaseDetails = () => ({
        ability_id: ability.id,
        stage: "execution",
        runtime_readiness: runtimeReadiness,
        identity_binding_state: identityBindingState,
        bootstrap_state: bootstrapState,
        transport_state: transportState,
        lock_held: lockHeld,
        profile_state: profileState,
        confirmation_required: confirmationRequired
    });
    if (profileState === "logging_in" || confirmationRequired) {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 登录确认未完成", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_LOGIN_CONFIRMATION_REQUIRED"
            },
            retryable: false
        });
    }
    if (lockHeld &&
        identityBindingState === "bound" &&
        transportState === "ready" &&
        (bootstrapState === "not_started" || bootstrapState === "pending")) {
        await attemptExecutionBootstrap();
        status = await readStatus();
        runtimeReadiness = typeof status.runtimeReadiness === "string" ? status.runtimeReadiness : "unknown";
        lockHeld = status.lockHeld === true;
        identityBindingState =
            typeof status.identityBindingState === "string" ? status.identityBindingState : "missing";
        bootstrapState =
            typeof status.bootstrapState === "string" ? status.bootstrapState : "not_started";
        transportState =
            typeof status.transportState === "string" ? status.transportState : "not_connected";
        if (runtimeReadiness !== "ready" &&
            lockHeld &&
            identityBindingState === "bound") {
            const bridgedReadiness = await readOfficialChromeRuntimeReadinessViaBridge({
                lockHeld,
                context,
                bridge,
                abilityId: ability.id,
                requestedExecutionMode,
                gate,
                fingerprintContext,
                identityBindingState
            });
            runtimeReadiness = bridgedReadiness.runtimeReadiness;
            identityBindingState = bridgedReadiness.identityBindingState;
            bootstrapState = bridgedReadiness.bootstrapState;
            transportState = bridgedReadiness.transportState;
        }
        if (runtimeReadiness === "ready") {
            return;
        }
    }
    if (identityBindingState === "missing") {
        throw new CliError("ERR_RUNTIME_IDENTITY_NOT_BOUND", "official Chrome runtime identity 未绑定", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_IDENTITY_NOT_BOUND"
            }
        });
    }
    if (identityBindingState === "mismatch") {
        throw new CliError("ERR_RUNTIME_IDENTITY_MISMATCH", "official Chrome runtime identity 不一致", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_IDENTITY_MISMATCH"
            }
        });
    }
    if (bootstrapState === "stale") {
        throw new CliError("ERR_RUNTIME_BOOTSTRAP_ACK_STALE", "official Chrome runtime bootstrap 上下文已陈旧", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_BOOTSTRAP_ACK_STALE"
            },
            retryable: true
        });
    }
    if (!lockHeld) {
        throw new CliError("ERR_PROFILE_LOCKED", "official Chrome runtime 未持有 profile 锁", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_PROFILE_LOCKED"
            },
            retryable: true
        });
    }
    if (transportState !== "ready") {
        throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 传输链路未就绪", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_TRANSPORT_NOT_READY"
            },
            retryable: true
        });
    }
    if (bootstrapState === "not_started" || bootstrapState === "pending") {
        throw new CliError("ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED", "official Chrome runtime bootstrap 未就绪", {
            details: {
                ...buildBaseDetails(),
                reason: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED"
            },
            retryable: true
        });
    }
    throw new CliError("ERR_RUNTIME_UNAVAILABLE", "official Chrome runtime 未就绪", {
        details: {
            ...buildBaseDetails(),
            reason: "ERR_RUNTIME_NOT_READY"
        },
        retryable: true
    });
};
const xhsSearch = async (context) => {
    const envelope = parseAbilityEnvelope(context.params);
    const gate = normalizeGateOptions(envelope.options, envelope.ability.id);
    if (process.env.NODE_ENV === "test" &&
        process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
        gate.options.fixture_success === true) {
        const query = typeof envelope.input.query === "string" ? envelope.input.query : null;
        return {
            summary: buildCapabilityResult(envelope.ability, {
                data_ref: query ? { query } : {},
                metrics: {
                    count: 0
                }
            })
        };
    }
    if (envelope.input.force_bad_output === true) {
        throw new CliError("ERR_EXECUTION_FAILED", "能力输出映射失败", {
            details: {
                ability_id: envelope.ability.id,
                stage: "output_mapping",
                reason: "CAPABILITY_RESULT_MISSING"
            }
        });
    }
    const bridge = resolveRuntimeBridge();
    const profileStore = new ProfileStore(join(context.cwd, ...PROFILE_ROOT_SEGMENTS));
    const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
    const fingerprintContext = buildFingerprintContextForMeta(context.profile ?? "unknown", profileMeta, {
        requestedExecutionMode: gate.requestedExecutionMode
    });
    try {
        await ensureOfficialChromeRuntimeReady(context, envelope.ability, gate.requestedExecutionMode, bridge, fingerprintContext, gate);
        const commandParams = appendFingerprintContext({
            target_domain: gate.targetDomain,
            target_tab_id: gate.targetTabId,
            target_page: gate.targetPage,
            requested_execution_mode: gate.requestedExecutionMode,
            ability: envelope.ability,
            input: parseSearchInput(envelope.input, envelope.ability.id),
            options: gate.options
        }, fingerprintContext);
        const bridgeResult = await bridge.runCommand({
            runId: context.run_id,
            profile: context.profile,
            cwd: context.cwd,
            command: context.command,
            params: commandParams
        });
        if (!bridgeResult.ok) {
            throw toCliExecutionError(envelope.ability, bridgeResult.payload, bridgeResult.error.message);
        }
        const summary = asObject(bridgeResult.payload.summary);
        if (!summary) {
            throw new CliError("ERR_EXECUTION_FAILED", "能力输出映射失败", {
                details: {
                    ability_id: envelope.ability.id,
                    stage: "output_mapping",
                    reason: "CAPABILITY_RESULT_MISSING"
                }
            });
        }
        return {
            summary: {
                ...summary,
                ...(asObject(bridgeResult.payload.consumer_gate_result)
                    ? { consumer_gate_result: asObject(bridgeResult.payload.consumer_gate_result) }
                    : {})
            },
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
    }
];
