import { CliError } from "./errors.js";
import type { JsonObject } from "./types.js";

type CapabilityLayer = "L3" | "L2" | "L1";
type CapabilityAction = "read" | "write" | "download";
type CapabilityOutcome = "success" | "partial";

const CAPABILITY_LAYERS = new Set<CapabilityLayer>(["L3", "L2", "L1"]);
const CAPABILITY_ACTIONS = new Set<CapabilityAction>(["read", "write", "download"]);
const CAPABILITY_OUTCOMES = new Set<CapabilityOutcome>(["success", "partial"]);

const asObject = (value: unknown): JsonObject | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;

const invalidCapabilityOutput = (abilityId: string, reason: string): CliError =>
  new CliError("ERR_EXECUTION_FAILED", "能力输出映射失败", {
    details: {
      ability_id: abilityId,
      stage: "output_mapping",
      reason
    }
  });

export const mapCapabilitySummaryForContract = (
  abilityId: string,
  summary: unknown
): JsonObject => {
  const summaryObject = asObject(summary);
  if (!summaryObject) {
    throw invalidCapabilityOutput(abilityId, "SUMMARY_INVALID");
  }

  return {
    ...summaryObject,
    capability_result: mapCapabilityResultForContract(abilityId, summaryObject.capability_result)
  };
};

const mapCapabilityResultForContract = (
  abilityId: string,
  capabilityResult: unknown
): JsonObject => {
  if (capabilityResult === undefined) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_MISSING");
  }

  const capabilityObject = asObject(capabilityResult);
  if (!capabilityObject) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_INVALID");
  }

  const mappedAbilityId =
    typeof capabilityObject.ability_id === "string" && capabilityObject.ability_id.trim().length > 0
      ? capabilityObject.ability_id.trim()
      : null;
  if (!mappedAbilityId) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ABILITY_ID_INVALID");
  }
  if (mappedAbilityId !== abilityId) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ABILITY_ID_MISMATCH");
  }

  const layer = capabilityObject.layer;
  if (typeof layer !== "string" || !CAPABILITY_LAYERS.has(layer as CapabilityLayer)) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_LAYER_INVALID");
  }

  const action = capabilityObject.action;
  if (typeof action !== "string" || !CAPABILITY_ACTIONS.has(action as CapabilityAction)) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ACTION_INVALID");
  }

  const outcome = capabilityObject.outcome;
  if (typeof outcome !== "string" || !CAPABILITY_OUTCOMES.has(outcome as CapabilityOutcome)) {
    throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_OUTCOME_INVALID");
  }

  return {
    ...capabilityObject,
    ability_id: mappedAbilityId,
    layer,
    action,
    outcome
  };
};
