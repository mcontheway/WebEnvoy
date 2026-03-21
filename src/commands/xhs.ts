import { CliError } from "../core/errors.js";
import type { CommandDefinition, CommandExecutionResult, JsonObject, RuntimeContext } from "../core/types.js";
import {
  NativeMessagingBridge,
  NativeMessagingTransportError
} from "../runtime/native-messaging/bridge.js";
import { NativeHostBridgeTransport } from "../runtime/native-messaging/host.js";
import { createLoopbackNativeBridgeTransport } from "../runtime/native-messaging/loopback.js";

type AbilityLayer = "L3" | "L2" | "L1";
type AbilityAction = "read" | "write" | "download";

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

const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

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
      reason
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

const xhsSearch = async (context: RuntimeContext): Promise<CommandExecutionResult> => {
  const envelope = parseAbilityEnvelope(context.params);

  if (
    process.env.NODE_ENV === "test" &&
    process.env.WEBENVOY_ALLOW_FIXTURE_SUCCESS === "1" &&
    envelope.options.fixture_success === true
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

  try {
    const bridgeResult = await bridge.runCommand({
      runId: context.run_id,
      profile: context.profile,
      cwd: context.cwd,
      command: context.command,
      params: {
        ability: envelope.ability,
        input: parseSearchInput(envelope.input, envelope.ability.id),
        options: envelope.options
      }
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
      summary,
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
