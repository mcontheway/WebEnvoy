import { join } from "node:path";

import { CliError } from "../core/errors.js";
import type { CommandDefinition, CommandExecutionResult, JsonObject, RuntimeContext } from "../core/types.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";
import { appendFingerprintContext, buildFingerprintContextForMeta } from "../runtime/fingerprint-runtime.js";
import { ProfileStore } from "../runtime/profile-store.js";
import {
  prepareOfficialChromeRuntime
} from "../runtime/official-chrome-runtime.js";

export { buildOfficialChromeRuntimeStatusParams } from "../runtime/official-chrome-runtime.js";

type AbilityLayer = "L3" | "L2" | "L1";
type AbilityAction = "read" | "write" | "download";
type XhsExecutionMode =
  | "dry_run"
  | "recon"
  | "live_read_limited"
  | "live_read_high_risk"
  | "live_write";

interface AbilityRef {
  id: string;
  layer: AbilityLayer;
  action: AbilityAction;
}

interface AbilityEnvelope {
  ability: AbilityRef;
  input: JsonObject;
  options: JsonObject;
}

const ABILITY_LAYERS = new Set<AbilityLayer>(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set<AbilityAction>(["read", "write", "download"]);
const XHS_EXECUTION_MODES = new Set<XhsExecutionMode>([
  "dry_run",
  "recon",
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);
const XHS_LIVE_EXECUTION_MODES = new Set<XhsExecutionMode>([
  "live_read_limited",
  "live_read_high_risk",
  "live_write"
]);
const PROFILE_ROOT_SEGMENTS = [".webenvoy", "profiles"];

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

const invalidAbilityInput = (
  reason: string,
  abilityId = "unknown"
): CliError =>
  new CliError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    details: {
      ability_id: abilityId,
      stage: "input_validation",
      reason
    }
  });

const parseAbilityEnvelope = (params: JsonObject): AbilityEnvelope => {
  const abilityObject = asObject(params.ability);
  if (!abilityObject) {
    throw invalidAbilityInput("ABILITY_MISSING");
  }

  const abilityId =
    typeof abilityObject.id === "string" && abilityObject.id.trim().length > 0
      ? abilityObject.id.trim()
      : null;
  if (!abilityId) {
    throw invalidAbilityInput("ABILITY_ID_INVALID");
  }

  const layer = abilityObject.layer;
  if (typeof layer !== "string" || !ABILITY_LAYERS.has(layer as AbilityLayer)) {
    throw invalidAbilityInput("ABILITY_LAYER_INVALID", abilityId);
  }

  const action = abilityObject.action;
  if (typeof action !== "string" || !ABILITY_ACTIONS.has(action as AbilityAction)) {
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
      layer: layer as AbilityLayer,
      action: action as AbilityAction
    },
    input,
    options
  };
};

const parseSearchInput = (input: JsonObject, abilityId: string): JsonObject => {
  const query =
    typeof input.query === "string" && input.query.trim().length > 0 ? input.query.trim() : null;
  if (!query) {
    throw invalidAbilityInput("QUERY_MISSING", abilityId);
  }

  const normalized: JsonObject = {
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
  if (
    (typeof input.note_type === "string" && input.note_type.trim().length > 0) ||
    typeof input.note_type === "number"
  ) {
    normalized.note_type = input.note_type;
  }

  return normalized;
};

const normalizeGateOptions = (
  options: JsonObject,
  abilityId: string
): {
  targetDomain: string;
  targetTabId: number;
  targetPage: string;
  requestedExecutionMode: XhsExecutionMode;
  options: JsonObject;
} => {
  const targetDomain =
    typeof options.target_domain === "string" && options.target_domain.trim().length > 0
      ? options.target_domain.trim()
      : null;
  if (!targetDomain) {
    throw invalidAbilityInput("TARGET_DOMAIN_INVALID", abilityId);
  }

  const targetTabId =
    typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)
      ? options.target_tab_id
      : null;
  if (targetTabId === null) {
    throw invalidAbilityInput("TARGET_TAB_ID_INVALID", abilityId);
  }

  const targetPage =
    typeof options.target_page === "string" && options.target_page.trim().length > 0
      ? options.target_page.trim()
      : null;
  if (!targetPage) {
    throw invalidAbilityInput("TARGET_PAGE_INVALID", abilityId);
  }

  const requestedExecutionMode =
    typeof options.requested_execution_mode === "string" &&
    XHS_EXECUTION_MODES.has(options.requested_execution_mode as XhsExecutionMode)
      ? (options.requested_execution_mode as XhsExecutionMode)
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
  _gate: ReturnType<typeof normalizeGateOptions>,
  readStatus?: () => Promise<JsonObject>
): Promise<void> => {
  await prepareOfficialChromeRuntime({
    context,
    consumerId: ability.id,
    requestedExecutionMode,
    bridge,
    fingerprintContext,
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
  const profileStore = new ProfileStore(join(context.cwd, ...PROFILE_ROOT_SEGMENTS));
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
        input: parseSearchInput(envelope.input, envelope.ability.id),
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
