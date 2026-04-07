import { CliError } from "../core/errors.js";
import type { CommandDefinition, CommandExecutionResult, JsonObject, RuntimeContext } from "../core/types.js";
import {
  normalizeGateOptions,
  parseAbilityEnvelope,
  parseSearchInput,
  type AbilityRef,
  type XhsExecutionMode
} from "./xhs-input.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import { resolveRuntimeProfileRoot } from "../runtime/worktree-root.js";
import {
  prepareOfficialChromeRuntime
} from "../runtime/official-chrome-runtime.js";

export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";
const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const isTransportFailureCode = (code: unknown): code is string =>
  code === "ERR_TRANSPORT_HANDSHAKE_FAILED" ||
  code === "ERR_TRANSPORT_TIMEOUT" ||
  code === "ERR_TRANSPORT_DISCONNECTED" ||
  code === "ERR_TRANSPORT_FORWARD_FAILED" ||
  code === "ERR_TRANSPORT_NOT_READY";


const resolveRuntimeBridge = (): NativeMessagingBridge => {
  if (process.env.WEBENVOY_NATIVE_TRANSPORT === "loopback") {
    return new NativeMessagingBridge({
      transport: createLoopbackNativeBridgeTransport()
    });
  }

  return new NativeMessagingBridge({
    transport: new NativeHostBridgeTransport()
  });
};

export const normalizeGateOptionsForContract = normalizeGateOptions;

const buildCapabilityResult = (ability: AbilityRef, summary?: JsonObject): JsonObject => ({
  capability_result: {
    ability_id: ability.id,
    layer: ability.layer,
    action: ability.action,
    outcome: "partial",
    ...(summary ? summary : {})
  }
});

const asObservabilityInput = (value: unknown): CommandExecutionResult["observability"] => {
  const object = asObject(value);
  return object ?? undefined;
};

const asDiagnosisInput = (value: unknown): CliError["diagnosis"] => {
  const object = asObject(value);
  return object ?? undefined;
};

const pickGateErrorDetails = (
  payload: Record<string, unknown>,
  details?: JsonObject | null
): JsonObject => {
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
  ] as const;
  const picked: JsonObject = {};
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

const toCliExecutionError = (
  ability: AbilityRef,
  payload: Record<string, unknown>,
  fallbackMessage: string
): CliError => {
  const details = asObject(payload.details);
  const reason =
    typeof details?.reason === "string" && details.reason.trim().length > 0
      ? details.reason.trim()
      : "TARGET_API_RESPONSE_INVALID";
  const consumerGateResult = asObject(payload.consumer_gate_result);

  return new CliError("ERR_EXECUTION_FAILED", fallbackMessage, {
    retryable: payload.retryable === true,
    details: {
      ability_id: ability.id,
      stage:
        details?.stage === "input_validation" ||
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

const toTransportCliError = (error: NativeMessagingTransportError, ability: AbilityRef): CliError =>
  new CliError("ERR_RUNTIME_UNAVAILABLE", `通信链路不可用: ${error.code}`, {
    retryable: error.retryable,
    cause: error,
    details: {
      ability_id: ability.id,
      stage: "execution",
      reason: error.code
    }
  });

export const ensureOfficialChromeRuntimeReady = async (
  context: RuntimeContext,
  ability: AbilityRef,
  requestedExecutionMode: XhsExecutionMode,
  bridge: NativeMessagingBridge,
  fingerprintContext: ReturnType<typeof buildFingerprintContextForMeta>,
  gate: ReturnType<typeof normalizeGateOptions>,
  readStatus?: () => Promise<JsonObject>
): Promise<void> => {
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

const xhsSearch = async (context: RuntimeContext): Promise<CommandExecutionResult> => {
  const envelope = parseAbilityEnvelope(context.params);
  const gate = normalizeGateOptions(envelope.options, envelope.ability.id);

  if (
    process.env.NODE_ENV === "test" &&
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
    gate.options.fixture_success === true
  ) {
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
  const profileStore = new ProfileStore(resolveRuntimeProfileRoot(context.cwd));
  const profileMeta = context.profile ? await profileStore.readMeta(context.profile) : null;
  const fingerprintContext = buildFingerprintContextForMeta(context.profile ?? "unknown", profileMeta, {
    requestedExecutionMode: gate.requestedExecutionMode
  });

  try {
    await ensureOfficialChromeRuntimeReady(
      context,
      envelope.ability,
      gate.requestedExecutionMode,
      bridge,
      fingerprintContext,
      gate
    );
    const commandParams = appendFingerprintContext(
      {
        target_domain: gate.targetDomain,
        target_tab_id: gate.targetTabId,
        target_page: gate.targetPage,
        requested_execution_mode: gate.requestedExecutionMode,
        ability: envelope.ability,
        input: parseSearchInput(
          envelope.input,
          envelope.ability.id,
          gate.options,
          envelope.ability.action
        ),
        options: gate.options
      },
      fingerprintContext
    );
    const bridgeResult = await bridge.runCommand({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      command: context.command,
      params: commandParams
    });

    if (!bridgeResult.ok) {
      throw toCliExecutionError(
        envelope.ability,
        bridgeResult.payload,
        bridgeResult.error.message
      );
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
  } catch (error) {
    if (error instanceof NativeMessagingTransportError) {
      throw toTransportCliError(error, envelope.ability);
    }
    throw error;
  }
};

export const xhsCommands = (): CommandDefinition[] => [
  {
    name: "xhs.search",
    status: "implemented",
    requiresProfile: true,
    handler: xhsSearch
  }
];
