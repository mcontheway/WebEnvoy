import { CliError } from "../core/errors.js";
import { mapCapabilitySummaryForContract } from "../core/capability-output.js";
import { NativeMessagingBridge, NativeMessagingTransportError } from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import { prepareOfficialChromeRuntime } from "../runtime/official-chrome-runtime.js";
import { buildCapabilityResult, ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY, normalizeGateOptionsForContract, parseAbilityEnvelopeForContract, parseDetailInputForContract, parseSearchInputForContract, parseUserHomeInputForContract, prepareIssue209LiveReadEnvelopeForContract } from "./xhs-input.js";
export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
export { normalizeGateOptionsForContract } from "./xhs-input.js";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const hasOwn = (record, key) => !!record && Object.prototype.hasOwnProperty.call(record, key);
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
        "risk_state_output"
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
    const bridge = resolveRuntimeBridge();
    const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
    const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
    const fingerprintContext = buildFingerprintContextForMeta(context.profile ?? "unknown", profileMeta, {
        requestedExecutionMode: gate.requestedExecutionMode
    });
    try {
        const preparedIssue209LiveRead = prepareIssue209LiveReadEnvelopeForContract({
            options: gate.options,
            requestId: envelope.requestId,
            runId: context.run_id
        });
        await ensureOfficialChromeRuntimeReady(context, envelope.ability, gate.requestedExecutionMode, bridge, fingerprintContext, gate);
        const bridgeSessionId = await bridge.ensureSession({
            profile: context.profile
        });
        const transportIsLoopback = process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback";
        const { __anonymous_isolation_verified: anonymousIsolationVerified, target_site_logged_in: targetSiteLoggedIn, ...preparedGateOptions } = preparedIssue209LiveRead.options;
        const runtimeGateOptions = {
            ...preparedGateOptions,
            ...(transportIsLoopback && typeof anonymousIsolationVerified === "boolean"
                ? { __anonymous_isolation_verified: anonymousIsolationVerified }
                : {}),
            ...(transportIsLoopback && typeof targetSiteLoggedIn === "boolean"
                ? { target_site_logged_in: targetSiteLoggedIn }
                : {}),
            ...(typeof context.profile === "string" ? { __runtime_profile_ref: context.profile } : {})
        };
        const commandParams = appendFingerprintContext({
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
            throw toCliExecutionError(envelope.ability, bridgeResult.payload, bridgeResult.error.message);
        }
        const consumerGateResult = asObject(bridgeResult.payload.consumer_gate_result);
        const requestAdmissionResult = pickCanonicalSummaryField(bridgeResult.payload, "request_admission_result");
        const executionAudit = pickCanonicalSummaryField(bridgeResult.payload, "execution_audit");
        const summary = mapCapabilitySummaryForContract(envelope.ability.id, {
            ...(asObject(bridgeResult.payload.summary) ?? {}),
            ...(consumerGateResult ? { consumer_gate_result: consumerGateResult } : {}),
            ...(requestAdmissionResult !== undefined
                ? { request_admission_result: requestAdmissionResult }
                : {}),
            ...(executionAudit !== undefined ? { execution_audit: executionAudit } : {})
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
