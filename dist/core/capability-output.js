import { CliError } from "./errors.js";
const CAPABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const CAPABILITY_ACTIONS = new Set(["read", "write", "download"]);
const CAPABILITY_OUTCOMES = new Set(["success", "partial"]);
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const invalidCapabilityOutput = (abilityId, reason) => new CliError("ERR_EXECUTION_FAILED", "能力输出映射失败", {
    details: {
        ability_id: abilityId,
        stage: "output_mapping",
        reason
    }
});
export const mapCapabilitySummaryForContract = (abilityId, summary) => {
    const summaryObject = asObject(summary);
    if (!summaryObject) {
        throw invalidCapabilityOutput(abilityId, "SUMMARY_INVALID");
    }
    return {
        ...summaryObject,
        capability_result: mapCapabilityResultForContract(abilityId, summaryObject.capability_result)
    };
};
const mapCapabilityResultForContract = (abilityId, capabilityResult) => {
    if (capabilityResult === undefined) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_MISSING");
    }
    const capabilityObject = asObject(capabilityResult);
    if (!capabilityObject) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_INVALID");
    }
    const mappedAbilityId = typeof capabilityObject.ability_id === "string" && capabilityObject.ability_id.trim().length > 0
        ? capabilityObject.ability_id.trim()
        : null;
    if (!mappedAbilityId) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ABILITY_ID_INVALID");
    }
    if (mappedAbilityId !== abilityId) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ABILITY_ID_MISMATCH");
    }
    const layer = capabilityObject.layer;
    if (typeof layer !== "string" || !CAPABILITY_LAYERS.has(layer)) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_LAYER_INVALID");
    }
    const action = capabilityObject.action;
    if (typeof action !== "string" || !CAPABILITY_ACTIONS.has(action)) {
        throw invalidCapabilityOutput(abilityId, "CAPABILITY_RESULT_ACTION_INVALID");
    }
    const outcome = capabilityObject.outcome;
    if (typeof outcome !== "string" || !CAPABILITY_OUTCOMES.has(outcome)) {
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
