import { CliError } from "../core/errors.js";
import { mapCapabilitySummaryForContract } from "../core/capability-output.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import { prepareOfficialChromeRuntime } from "../runtime/official-chrome-runtime.js";
import { buildCapabilityResult, normalizeGateOptionsForContract, parseAbilityEnvelopeForContract, parseSearchInputForContract } from "./xhs-input.js";
export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
export { normalizeGateOptionsForContract } from "./xhs-input.js";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
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
export const ensureOfficialChromeRuntimeReady = async (context, ability, requestedExecutionMode, bridge, fingerprintContext, gate, readStatus) => {
    await prepareOfficialChromeRuntime({
        context,
        consumerId: ability.id,
        requestedExecutionMode,
        bridge,
        fingerprintContext,
        bootstrapTargetTabId: gate.targetTabId,
        bootstrapTargetDomain: gate.targetDomain,
        bootstrapTargetPage: gate.targetPage,
        readStatus
    });
};
const xhsSearch = async (context) => {
    const envelope = parseAbilityEnvelopeForContract(context.params);
    const gate = normalizeGateOptionsForContract(envelope.options, envelope.ability.id);
    if (process.env.NODE_ENV === "test" &&
        process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
        gate.options.fixture_success === true) {
        const query = typeof envelope.input.query === "string" ? envelope.input.query : null;
        return {
            summary: mapCapabilitySummaryForContract(envelope.ability.id, buildCapabilityResult(envelope.ability, {
                data_ref: query ? { query } : {},
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
    const bridge = resolveRuntimeBridge();
    const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
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
            input: parseSearchInputForContract(envelope.input, envelope.ability.id, gate.options, envelope.ability.action),
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
        const consumerGateResult = asObject(bridgeResult.payload.consumer_gate_result);
        const summary = mapCapabilitySummaryForContract(envelope.ability.id, {
            ...(asObject(bridgeResult.payload.summary) ?? {}),
            ...(consumerGateResult ? { consumer_gate_result: consumerGateResult } : {})
        });
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
    }
];
