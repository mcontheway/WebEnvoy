import { CliError } from "../core/errors.js";
const ABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set(["read", "write", "download"]);
const XHS_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const invalidAbilityInput = (reason, abilityId = "unknown") => new CliError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason
    }
});
export const parseAbilityEnvelopeForContract = (params) => {
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
export const parseSearchInputForContract = (input, abilityId, options, abilityAction) => {
    const issue208EditorInputValidation = abilityAction === "write" &&
        options.issue_scope === "issue_208" &&
        options.action_type === "write" &&
        options.requested_execution_mode === "live_write" &&
        options.validation_action === "editor_input";
    if (issue208EditorInputValidation) {
        return {};
    }
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
export const parseDetailInputForContract = (input, abilityId) => {
    const noteId = typeof input.note_id === "string" && input.note_id.trim().length > 0 ? input.note_id.trim() : null;
    if (!noteId) {
        throw invalidAbilityInput("NOTE_ID_MISSING", abilityId);
    }
    return {
        note_id: noteId
    };
};
export const parseUserHomeInputForContract = (input, abilityId) => {
    const userId = typeof input.user_id === "string" && input.user_id.trim().length > 0 ? input.user_id.trim() : null;
    if (!userId) {
        throw invalidAbilityInput("USER_ID_MISSING", abilityId);
    }
    return {
        user_id: userId
    };
};
export const parseXhsCommandInputForContract = (input) => {
    if (input.command === "xhs.search") {
        return parseSearchInputForContract(input.payload, input.abilityId, input.options, input.abilityAction);
    }
    if (input.command === "xhs.detail") {
        return parseDetailInputForContract(input.payload, input.abilityId);
    }
    if (input.command === "xhs.user_home") {
        return parseUserHomeInputForContract(input.payload, input.abilityId);
    }
    throw invalidAbilityInput("ABILITY_COMMAND_UNSUPPORTED", input.abilityId);
};
export const normalizeGateOptionsForContract = (options, abilityId) => {
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
    const issueScope = typeof options.issue_scope === "string" && options.issue_scope.trim().length > 0
        ? options.issue_scope.trim()
        : null;
    const validationAction = typeof options.validation_action === "string" && options.validation_action.trim().length > 0
        ? options.validation_action.trim()
        : null;
    if (issueScope === "issue_208" &&
        validationAction === "editor_input" &&
        targetPage !== "creator_publish_tab") {
        throw invalidAbilityInput("TARGET_PAGE_INVALID", abilityId);
    }
    if (abilityId === "xhs.note.detail.v1" && targetPage !== "explore_detail_tab") {
        throw invalidAbilityInput("TARGET_PAGE_INVALID", abilityId);
    }
    if (abilityId === "xhs.user.home.v1" && targetPage !== "profile_tab") {
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
export const buildCapabilityResult = (ability, summary) => ({
    capability_result: {
        ability_id: ability.id,
        layer: ability.layer,
        action: ability.action,
        outcome: "partial",
        ...(summary ? summary : {})
    }
});
