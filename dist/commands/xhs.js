import { CliError } from "../core/errors.js";
const ABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set(["read", "write", "download"]);
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const invalidAbilityInput = (reason, abilityId = null) => new CliError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
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
const buildCapabilityResult = (ability, summary) => ({
    capability_result: {
        ability_id: ability.id,
        layer: ability.layer,
        action: ability.action,
        outcome: "partial",
        ...(summary ? summary : {})
    }
});
const xhsSearch = async (context) => {
    const envelope = parseAbilityEnvelope(context.params);
    if (envelope.input.force_bad_output === true) {
        throw new CliError("ERR_EXECUTION_FAILED", "能力输出映射失败", {
            details: {
                ability_id: envelope.ability.id,
                stage: "output_mapping",
                reason: "CAPABILITY_RESULT_MISSING"
            }
        });
    }
    if (envelope.options.fixture_success === true) {
        const query = typeof envelope.input.query === "string" ? envelope.input.query : null;
        return buildCapabilityResult(envelope.ability, {
            data_ref: query ? { query } : {},
            metrics: {
                count: 0
            }
        });
    }
    throw new CliError("ERR_CLI_NOT_IMPLEMENTED", "能力壳已接入，但小红书读链路尚未实现", {
        details: {
            ability_id: envelope.ability.id,
            stage: "execution",
            reason: "XHS_SEARCH_SPIKE_PENDING"
        }
    });
};
export const xhsCommands = () => [
    {
        name: "xhs.search",
        status: "implemented",
        requiresProfile: true,
        handler: xhsSearch
    }
];
