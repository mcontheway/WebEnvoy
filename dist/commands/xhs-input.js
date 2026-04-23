import { randomUUID } from "node:crypto";
import { CliError } from "../core/errors.js";
import { prepareIssue209LiveReadSource } from "../../shared/issue209-live-read/source.js";
import { validateIssue209ApprovalSourceAgainstCurrentLinkage, validateIssue209AuditSourceAgainstCurrentLinkage } from "../../shared/issue209-live-read/source-validation.js";
const ABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set(["read", "write", "download"]);
const GATE_ACTION_TYPES = new Set(["read", "write", "irreversible_write"]);
const XHS_EXECUTION_MODES = new Set([
    "dry_run",
    "recon",
    "live_read_limited",
    "live_read_high_risk",
    "live_write"
]);
const XHS_LIVE_READ_EXECUTION_MODES = new Set([
    "live_read_limited",
    "live_read_high_risk"
]);
const LEGACY_RISK_STATES = new Set(["paused", "limited", "allowed"]);
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const XHS_WRITE_DOMAIN = "creator.xiaohongshu.com";
const UPSTREAM_RESOURCE_KINDS = new Set([
    "anonymous_context",
    "profile_session"
]);
const RESOURCE_STATE_SNAPSHOTS = new Set([
    "active",
    "cool_down",
    "paused"
]);
const UPSTREAM_AUTHORIZATION_KEYS = [
    "action_request",
    "resource_binding",
    "authorization_grant",
    "runtime_target"
];
const XHS_COMMAND_ACTION_NAMES = {
    "xhs.search::xhs.note.search.v1": "xhs.read_search_results",
    "xhs.search::xhs.editor.input.v1": "xhs.write_editor_input",
    "xhs.detail::xhs.note.detail.v1": "xhs.read_note_detail",
    "xhs.user_home::xhs.user.home.v1": "xhs.read_user_home"
};
const ISSUE209_LIVE_REQUEST_ID_PREFIX = "issue209-live";
const ISSUE209_GATE_INVOCATION_ID_PREFIX = "issue209-gate";
export const ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY = "__issue209_admission_draft";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asStringArray = (value) => {
    if (!Array.isArray(value)) {
        return null;
    }
    const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0);
    return normalized.length === value.length ? normalized : null;
};
const cloneJsonObject = (value) => JSON.parse(JSON.stringify(value));
const projectLegacyActionTypeForContract = (actionType) => {
    if (actionType === "read") {
        return "read";
    }
    if (actionType === "write" || actionType === "irreversible_write") {
        return "write";
    }
    return null;
};
const resolveIssue209ScopeFromAdmissionSource = (options) => {
    const admissionContext = asObject(options.admission_context);
    const approvalEvidence = asObject(admissionContext?.approval_admission_evidence);
    const auditEvidence = asObject(admissionContext?.audit_admission_evidence);
    if (approvalEvidence?.issue_scope === "issue_209" || auditEvidence?.issue_scope === "issue_209") {
        return "issue_209";
    }
    const auditRecord = asObject(options.audit_record);
    if (auditRecord?.issue_scope === "issue_209") {
        return "issue_209";
    }
    return null;
};
const projectRiskStateForContract = (resourceStateSnapshot) => {
    if (resourceStateSnapshot === "active") {
        return "allowed";
    }
    if (resourceStateSnapshot === "cool_down") {
        return "limited";
    }
    if (resourceStateSnapshot === "paused") {
        return "paused";
    }
    return null;
};
const inferRequestedExecutionModeForContract = (input) => {
    if (!input.upstreamAuthorization) {
        return input.explicitRequestedExecutionMode;
    }
    if (input.normalizedActionType === "write" || input.normalizedActionType === "irreversible_write") {
        return "live_write";
    }
    if (input.normalizedActionType !== "read") {
        return null;
    }
    const approvalRefs = input.upstreamAuthorization.authorization_grant.approval_refs ?? [];
    const auditRefs = input.upstreamAuthorization.authorization_grant.audit_refs ?? [];
    const hasLiveReadGrantRefs = approvalRefs.length > 0 && auditRefs.length > 0;
    if (!hasLiveReadGrantRefs || input.targetDomain !== XHS_READ_DOMAIN) {
        return "dry_run";
    }
    const projectedRiskState = projectRiskStateForContract(input.upstreamAuthorization.authorization_grant.resource_state_snapshot);
    if (projectedRiskState === "allowed") {
        return "live_read_high_risk";
    }
    if (projectedRiskState === "limited") {
        return "live_read_limited";
    }
    return "dry_run";
};
const resolveInferredIssueScopeForContract = (options) => {
    if (asString(options.validation_action) === "editor_input" &&
        asString(options.action_type) === "write" &&
        asString(options.target_domain) === XHS_WRITE_DOMAIN &&
        asString(options.target_page) === "creator_publish_tab" &&
        options.requested_execution_mode === "live_write") {
        return "issue_208";
    }
    const explicitIssueScope = asString(options.issue_scope);
    if (explicitIssueScope === "issue_209") {
        return "issue_209";
    }
    if (typeof options.requested_execution_mode === "string" &&
        XHS_LIVE_READ_EXECUTION_MODES.has(options.requested_execution_mode)) {
        const sourceIssueScope = resolveIssue209ScopeFromAdmissionSource(options);
        if (sourceIssueScope === "issue_209") {
            return sourceIssueScope;
        }
        if (asString(options.action_type) === "read" && asString(options.target_domain) === XHS_READ_DOMAIN) {
            return "issue_209";
        }
    }
    return null;
};
const resolveCanonicalIssueScopeForContract = (options) => {
    const explicitIssueScope = asString(options.issue_scope);
    if (explicitIssueScope === "issue_209") {
        return "issue_209";
    }
    if (typeof options.requested_execution_mode === "string" &&
        XHS_LIVE_READ_EXECUTION_MODES.has(options.requested_execution_mode)) {
        const sourceIssueScope = resolveIssue209ScopeFromAdmissionSource(options);
        if (sourceIssueScope === "issue_209") {
            return sourceIssueScope;
        }
        if (asString(options.action_type) === "read" && asString(options.target_domain) === XHS_READ_DOMAIN) {
            return "issue_209";
        }
    }
    return null;
};
const invalidAbilityInput = (reason, abilityId = "unknown") => new CliError("ERR_CLI_INVALID_ARGS", "能力输入不合法", {
    details: {
        ability_id: abilityId,
        stage: "input_validation",
        reason
    }
});
const parseRequiredObjectFieldForContract = (source, key, reason, abilityId) => {
    const object = asObject(source[key]);
    if (!object) {
        throw invalidAbilityInput(reason, abilityId);
    }
    return object;
};
const parseRequiredStringFieldForContract = (source, key, reason, abilityId) => {
    const value = asString(source[key]);
    if (!value) {
        throw invalidAbilityInput(reason, abilityId);
    }
    return value;
};
const parseOptionalStringFieldForContract = (source, key, reason, abilityId) => {
    if (!hasOwn(source, key)) {
        return undefined;
    }
    const value = asString(source[key]);
    if (!value) {
        throw invalidAbilityInput(reason, abilityId);
    }
    return value;
};
const parseOptionalNullableStringFieldForContract = (source, key, reason, abilityId) => {
    if (!hasOwn(source, key)) {
        return undefined;
    }
    if (source[key] === null) {
        return null;
    }
    const value = asString(source[key]);
    if (!value) {
        throw invalidAbilityInput(reason, abilityId);
    }
    return value;
};
const parseActionRequestForContract = (source, abilityId) => {
    const requestRef = parseRequiredStringFieldForContract(source, "request_ref", "ACTION_REQUEST_REF_INVALID", abilityId);
    const actionName = parseRequiredStringFieldForContract(source, "action_name", "ACTION_REQUEST_NAME_INVALID", abilityId);
    const actionCategory = asString(source.action_category);
    if (!actionCategory || !GATE_ACTION_TYPES.has(actionCategory)) {
        throw invalidAbilityInput("ACTION_CATEGORY_INVALID", abilityId);
    }
    const constraintRefs = hasOwn(source, "constraint_refs") && source.constraint_refs !== undefined
        ? asStringArray(source.constraint_refs)
        : undefined;
    if (hasOwn(source, "constraint_refs") && source.constraint_refs !== undefined && !constraintRefs) {
        throw invalidAbilityInput("ACTION_REQUEST_INVALID", abilityId);
    }
    const intent = parseOptionalStringFieldForContract(source, "intent", "ACTION_REQUEST_INVALID", abilityId);
    const requestedAt = parseOptionalStringFieldForContract(source, "requested_at", "ACTION_REQUEST_INVALID", abilityId);
    return {
        request_ref: requestRef,
        action_name: actionName,
        action_category: actionCategory,
        ...(intent ? { intent } : {}),
        ...(constraintRefs ? { constraint_refs: constraintRefs } : {}),
        ...(requestedAt ? { requested_at: requestedAt } : {})
    };
};
const parseResourceBindingForContract = (source, abilityId) => {
    const bindingRef = parseRequiredStringFieldForContract(source, "binding_ref", "BINDING_REF_INVALID", abilityId);
    const resourceKind = asString(source.resource_kind);
    if (!resourceKind || !UPSTREAM_RESOURCE_KINDS.has(resourceKind)) {
        throw invalidAbilityInput("RESOURCE_KIND_INVALID", abilityId);
    }
    const profileRef = parseOptionalNullableStringFieldForContract(source, "profile_ref", resourceKind === "profile_session" ? "PROFILE_REF_REQUIRED" : "PROFILE_REF_FORBIDDEN", abilityId);
    if (resourceKind === "profile_session" && !profileRef) {
        throw invalidAbilityInput("PROFILE_REF_REQUIRED", abilityId);
    }
    if (resourceKind === "anonymous_context" && typeof profileRef === "string") {
        throw invalidAbilityInput("PROFILE_REF_FORBIDDEN", abilityId);
    }
    const bindingConstraints = hasOwn(source, "binding_constraints") && source.binding_constraints !== undefined
        ? asObject(source.binding_constraints)
        : undefined;
    if (hasOwn(source, "binding_constraints") && source.binding_constraints !== undefined && !bindingConstraints) {
        throw invalidAbilityInput("RESOURCE_BINDING_INVALID", abilityId);
    }
    if (resourceKind === "anonymous_context") {
        if (bindingConstraints?.anonymous_required !== true ||
            bindingConstraints?.reuse_logged_in_context_forbidden !== true) {
            throw invalidAbilityInput("ANONYMOUS_BINDING_CONSTRAINTS_INVALID", abilityId);
        }
    }
    const subjectRef = parseOptionalStringFieldForContract(source, "subject_ref", "RESOURCE_BINDING_INVALID", abilityId);
    const accountRef = parseOptionalStringFieldForContract(source, "account_ref", "RESOURCE_BINDING_INVALID", abilityId);
    return {
        binding_ref: bindingRef,
        resource_kind: resourceKind,
        ...(profileRef !== undefined ? { profile_ref: profileRef } : {}),
        ...(subjectRef ? { subject_ref: subjectRef } : {}),
        ...(accountRef ? { account_ref: accountRef } : {}),
        ...(bindingConstraints ? { binding_constraints: cloneJsonObject(bindingConstraints) } : {})
    };
};
const parseGrantScopeForContract = (source, scopeKey, reason, abilityId) => {
    const scope = parseRequiredObjectFieldForContract(source, scopeKey, reason, abilityId);
    return cloneJsonObject(scope);
};
const parseAuthorizationGrantForContract = (source, abilityId) => {
    const grantRef = parseRequiredStringFieldForContract(source, "grant_ref", "GRANT_REF_INVALID", abilityId);
    const allowedActions = asStringArray(source.allowed_actions);
    if (!allowedActions || allowedActions.length === 0) {
        throw invalidAbilityInput("GRANT_ALLOWED_ACTIONS_INVALID", abilityId);
    }
    const bindingScope = parseGrantScopeForContract(source, "binding_scope", "GRANT_BINDING_SCOPE_INVALID", abilityId);
    if (!hasOwn(bindingScope, "allowed_resource_kinds") || !hasOwn(bindingScope, "allowed_profile_refs")) {
        throw invalidAbilityInput("GRANT_BINDING_SCOPE_INVALID", abilityId);
    }
    const allowedResourceKinds = asStringArray(bindingScope.allowed_resource_kinds);
    const allowedProfileRefs = asStringArray(bindingScope.allowed_profile_refs);
    if (!allowedResourceKinds ||
        allowedResourceKinds.length === 0 ||
        !allowedProfileRefs ||
        !allowedResourceKinds.every((value) => UPSTREAM_RESOURCE_KINDS.has(value))) {
        throw invalidAbilityInput("GRANT_BINDING_SCOPE_INVALID", abilityId);
    }
    const targetScope = parseGrantScopeForContract(source, "target_scope", "GRANT_TARGET_SCOPE_INVALID", abilityId);
    if (hasOwn(targetScope, "tab_id")) {
        throw invalidAbilityInput("GRANT_TARGET_SCOPE_INVALID", abilityId);
    }
    if (!hasOwn(targetScope, "allowed_domains") || !hasOwn(targetScope, "allowed_pages")) {
        throw invalidAbilityInput("GRANT_TARGET_SCOPE_INVALID", abilityId);
    }
    const allowedDomains = asStringArray(targetScope.allowed_domains);
    const allowedPages = asStringArray(targetScope.allowed_pages);
    if (!allowedDomains || allowedDomains.length === 0 || !allowedPages || allowedPages.length === 0) {
        throw invalidAbilityInput("GRANT_TARGET_SCOPE_INVALID", abilityId);
    }
    const resourceStateSnapshot = parseOptionalStringFieldForContract(source, "resource_state_snapshot", "RESOURCE_STATE_SNAPSHOT_INVALID", abilityId);
    if (resourceStateSnapshot &&
        !RESOURCE_STATE_SNAPSHOTS.has(resourceStateSnapshot)) {
        throw invalidAbilityInput("RESOURCE_STATE_SNAPSHOT_INVALID", abilityId);
    }
    const grantConstraints = hasOwn(source, "grant_constraints") && source.grant_constraints !== undefined
        ? asObject(source.grant_constraints)
        : undefined;
    if (hasOwn(source, "grant_constraints") && source.grant_constraints !== undefined && !grantConstraints) {
        throw invalidAbilityInput("AUTHORIZATION_GRANT_INVALID", abilityId);
    }
    const approvalRefs = hasOwn(source, "approval_refs") && source.approval_refs !== undefined
        ? asStringArray(source.approval_refs)
        : undefined;
    const auditRefs = hasOwn(source, "audit_refs") && source.audit_refs !== undefined
        ? asStringArray(source.audit_refs)
        : undefined;
    if ((hasOwn(source, "approval_refs") && source.approval_refs !== undefined && !approvalRefs) ||
        (hasOwn(source, "audit_refs") && source.audit_refs !== undefined && !auditRefs)) {
        throw invalidAbilityInput("AUTHORIZATION_GRANT_INVALID", abilityId);
    }
    const grantedAt = parseOptionalStringFieldForContract(source, "granted_at", "AUTHORIZATION_GRANT_INVALID", abilityId);
    return {
        grant_ref: grantRef,
        allowed_actions: allowedActions,
        binding_scope: {
            allowed_resource_kinds: allowedResourceKinds,
            allowed_profile_refs: allowedProfileRefs
        },
        target_scope: {
            allowed_domains: allowedDomains,
            allowed_pages: allowedPages
        },
        ...(resourceStateSnapshot
            ? { resource_state_snapshot: resourceStateSnapshot }
            : {}),
        ...(grantConstraints ? { grant_constraints: cloneJsonObject(grantConstraints) } : {}),
        ...(approvalRefs ? { approval_refs: approvalRefs } : {}),
        ...(auditRefs ? { audit_refs: auditRefs } : {}),
        ...(grantedAt ? { granted_at: grantedAt } : {})
    };
};
const parseRuntimeTargetForContract = (source, abilityId) => {
    const targetRef = parseRequiredStringFieldForContract(source, "target_ref", "RUNTIME_TARGET_REF_INVALID", abilityId);
    const domain = parseRequiredStringFieldForContract(source, "domain", "TARGET_DOMAIN_INVALID", abilityId);
    const page = parseRequiredStringFieldForContract(source, "page", "TARGET_PAGE_INVALID", abilityId);
    const tabId = asInteger(source.tab_id);
    if (tabId === null) {
        throw invalidAbilityInput("TARGET_TAB_ID_INVALID", abilityId);
    }
    const url = parseOptionalStringFieldForContract(source, "url", "TARGET_URL_INVALID", abilityId);
    return {
        target_ref: targetRef,
        domain,
        page,
        tab_id: tabId,
        ...(url ? { url } : {})
    };
};
const parseUpstreamAuthorizationForContract = (params, abilityId) => {
    const presentKeys = UPSTREAM_AUTHORIZATION_KEYS.filter((key) => hasOwn(params, key));
    if (presentKeys.length === 0) {
        return null;
    }
    if (presentKeys.length !== UPSTREAM_AUTHORIZATION_KEYS.length) {
        throw invalidAbilityInput("UPSTREAM_AUTHORIZATION_OBJECT_SET_INCOMPLETE", abilityId);
    }
    const actionRequest = parseActionRequestForContract(parseRequiredObjectFieldForContract(params, "action_request", "ACTION_REQUEST_INVALID", abilityId), abilityId);
    const resourceBinding = parseResourceBindingForContract(parseRequiredObjectFieldForContract(params, "resource_binding", "RESOURCE_BINDING_INVALID", abilityId), abilityId);
    const authorizationGrant = parseAuthorizationGrantForContract(parseRequiredObjectFieldForContract(params, "authorization_grant", "AUTHORIZATION_GRANT_INVALID", abilityId), abilityId);
    const runtimeTarget = parseRuntimeTargetForContract(parseRequiredObjectFieldForContract(params, "runtime_target", "RUNTIME_TARGET_INVALID", abilityId), abilityId);
    return {
        action_request: actionRequest,
        resource_binding: resourceBinding,
        authorization_grant: authorizationGrant,
        runtime_target: runtimeTarget
    };
};
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
    const requestId = params.request_id === undefined
        ? null
        : typeof params.request_id === "string" && params.request_id.trim().length > 0
            ? params.request_id.trim()
            : (() => {
                throw invalidAbilityInput("REQUEST_ID_INVALID", abilityId);
            })();
    const gateInvocationId = params.gate_invocation_id === undefined
        ? null
        : typeof params.gate_invocation_id === "string" &&
            params.gate_invocation_id.trim().length > 0
            ? params.gate_invocation_id.trim()
            : (() => {
                throw invalidAbilityInput("GATE_INVOCATION_ID_INVALID", abilityId);
            })();
    const upstreamAuthorization = parseUpstreamAuthorizationForContract(params, abilityId);
    return {
        ability: {
            id: abilityId,
            layer: layer,
            action: action
        },
        input,
        options,
        requestId,
        gateInvocationId,
        upstreamAuthorization
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
export const normalizeGateOptionsForContract = (options, abilityId, input) => {
    const upstreamAuthorization = input?.upstreamAuthorization ?? null;
    const canonicalActionName = upstreamAuthorization && input?.command
        ? XHS_COMMAND_ACTION_NAMES[`${input.command}::${abilityId}`] ?? null
        : null;
    if (upstreamAuthorization && !canonicalActionName) {
        throw invalidAbilityInput("ABILITY_COMMAND_UNSUPPORTED", abilityId);
    }
    if (upstreamAuthorization && upstreamAuthorization.action_request.action_name !== canonicalActionName) {
        throw invalidAbilityInput("ACTION_NAME_COMMAND_MISMATCH", abilityId);
    }
    const normalizedActionType = upstreamAuthorization
        ? upstreamAuthorization.action_request.action_category
        : null;
    const legacyProjectedActionType = projectLegacyActionTypeForContract(normalizedActionType);
    const projectedValidationAction = upstreamAuthorization &&
        upstreamAuthorization.action_request.action_name === "xhs.write_editor_input"
        ? "editor_input"
        : null;
    const targetDomain = upstreamAuthorization
        ? upstreamAuthorization.runtime_target.domain
        : typeof options.target_domain === "string" && options.target_domain.trim().length > 0
            ? options.target_domain.trim()
            : null;
    if (!targetDomain) {
        throw invalidAbilityInput("TARGET_DOMAIN_INVALID", abilityId);
    }
    const targetTabId = upstreamAuthorization
        ? upstreamAuthorization.runtime_target.tab_id
        : typeof options.target_tab_id === "number" && Number.isInteger(options.target_tab_id)
            ? options.target_tab_id
            : null;
    if (targetTabId === null) {
        throw invalidAbilityInput("TARGET_TAB_ID_INVALID", abilityId);
    }
    const targetPage = upstreamAuthorization
        ? upstreamAuthorization.runtime_target.page
        : typeof options.target_page === "string" && options.target_page.trim().length > 0
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
    const requestedExecutionModeFromContract = inferRequestedExecutionModeForContract({
        normalizedActionType,
        explicitRequestedExecutionMode: requestedExecutionMode,
        targetDomain,
        upstreamAuthorization
    });
    const projectedRiskState = upstreamAuthorization && requestedExecutionModeFromContract !== null
        ? projectRiskStateForContract(upstreamAuthorization.authorization_grant.resource_state_snapshot) ??
            (requestedExecutionModeFromContract === "live_read_high_risk"
                ? "allowed"
                : requestedExecutionModeFromContract === "live_read_limited"
                    ? "limited"
                    : null)
        : null;
    if (upstreamAuthorization && hasOwn(options, "risk_state")) {
        if (typeof options.risk_state !== "string" ||
            !LEGACY_RISK_STATES.has(options.risk_state)) {
            throw invalidAbilityInput("RISK_STATE_INVALID", abilityId);
        }
    }
    const normalizedRiskState = typeof options.risk_state === "string" && LEGACY_RISK_STATES.has(options.risk_state)
        ? options.risk_state
        : projectedRiskState;
    if (upstreamAuthorization && projectedRiskState && normalizedRiskState !== projectedRiskState) {
        throw invalidAbilityInput("RISK_STATE_CONFLICT", abilityId);
    }
    if (!requestedExecutionModeFromContract) {
        throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_INVALID", abilityId);
    }
    const inferredIssueScope = resolveInferredIssueScopeForContract({
        ...options,
        ...(legacyProjectedActionType ? { action_type: legacyProjectedActionType } : {}),
        ...(projectedValidationAction ? { validation_action: projectedValidationAction } : {}),
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        target_page: targetPage,
        requested_execution_mode: requestedExecutionModeFromContract
    });
    const legacyActionType = hasOwn(options, "action_type") ? asString(options.action_type) : null;
    if (upstreamAuthorization && hasOwn(options, "action_type") && !legacyActionType) {
        throw invalidAbilityInput("ACTION_TYPE_INVALID", abilityId);
    }
    const legacyTargetDomain = hasOwn(options, "target_domain") ? asString(options.target_domain) : null;
    if (upstreamAuthorization && hasOwn(options, "target_domain") && !legacyTargetDomain) {
        throw invalidAbilityInput("TARGET_DOMAIN_INVALID", abilityId);
    }
    const legacyTargetTabId = hasOwn(options, "target_tab_id") ? asInteger(options.target_tab_id) : null;
    if (upstreamAuthorization && hasOwn(options, "target_tab_id") && legacyTargetTabId === null) {
        throw invalidAbilityInput("TARGET_TAB_ID_INVALID", abilityId);
    }
    const legacyTargetPage = hasOwn(options, "target_page") ? asString(options.target_page) : null;
    if (upstreamAuthorization && hasOwn(options, "target_page") && !legacyTargetPage) {
        throw invalidAbilityInput("TARGET_PAGE_INVALID", abilityId);
    }
    if (upstreamAuthorization && hasOwn(options, "requested_execution_mode") && !requestedExecutionMode) {
        throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_INVALID", abilityId);
    }
    const legacyValidationAction = hasOwn(options, "validation_action")
        ? asString(options.validation_action)
        : null;
    if (upstreamAuthorization && hasOwn(options, "validation_action") && !legacyValidationAction) {
        throw invalidAbilityInput("ACTION_REQUEST_INVALID", abilityId);
    }
    const explicitIssueScope = hasOwn(options, "issue_scope") ? asString(options.issue_scope) : null;
    if (upstreamAuthorization &&
        hasOwn(options, "issue_scope") &&
        explicitIssueScope !== "issue_208" &&
        explicitIssueScope !== "issue_209") {
        throw invalidAbilityInput("ISSUE_SCOPE_INVALID", abilityId);
    }
    if (upstreamAuthorization && legacyActionType && legacyActionType !== legacyProjectedActionType) {
        throw invalidAbilityInput("ACTION_TYPE_CONFLICT", abilityId);
    }
    if (upstreamAuthorization && legacyTargetDomain && legacyTargetDomain !== targetDomain) {
        throw invalidAbilityInput("TARGET_DOMAIN_CONFLICT", abilityId);
    }
    if (upstreamAuthorization && legacyTargetTabId !== null && legacyTargetTabId !== targetTabId) {
        throw invalidAbilityInput("TARGET_TAB_ID_CONFLICT", abilityId);
    }
    if (upstreamAuthorization && legacyTargetPage && legacyTargetPage !== targetPage) {
        throw invalidAbilityInput("TARGET_PAGE_CONFLICT", abilityId);
    }
    if (upstreamAuthorization &&
        projectedValidationAction &&
        legacyValidationAction &&
        legacyValidationAction !== projectedValidationAction) {
        throw invalidAbilityInput("ACTION_REQUEST_INVALID", abilityId);
    }
    if (upstreamAuthorization) {
        const expectedAbilityAction = normalizedActionType === "read" ? "read" : "write";
        if (input?.abilityAction && input.abilityAction !== expectedAbilityAction) {
            throw invalidAbilityInput("ACTION_NAME_COMMAND_MISMATCH", abilityId);
        }
        if (normalizedActionType === "read" && requestedExecutionModeFromContract === "live_write") {
            throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_CONFLICT", abilityId);
        }
        if (normalizedActionType !== "read" &&
            requestedExecutionModeFromContract !== "live_write") {
            throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_CONFLICT", abilityId);
        }
        if (inferredIssueScope === "issue_209" &&
            !XHS_LIVE_READ_EXECUTION_MODES.has(requestedExecutionModeFromContract)) {
            throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_CONFLICT", abilityId);
        }
        if (inferredIssueScope === "issue_208" && requestedExecutionModeFromContract !== "live_write") {
            throw invalidAbilityInput("REQUESTED_EXECUTION_MODE_CONFLICT", abilityId);
        }
        const allowedResourceKinds = asStringArray(upstreamAuthorization.authorization_grant.binding_scope.allowed_resource_kinds);
        const allowedProfileRefs = asStringArray(upstreamAuthorization.authorization_grant.binding_scope.allowed_profile_refs);
        const allowedDomains = asStringArray(upstreamAuthorization.authorization_grant.target_scope.allowed_domains);
        const allowedPages = asStringArray(upstreamAuthorization.authorization_grant.target_scope.allowed_pages);
        if (!allowedResourceKinds ||
            !allowedProfileRefs ||
            !allowedDomains ||
            !allowedPages) {
            throw invalidAbilityInput("AUTHORIZATION_GRANT_INVALID", abilityId);
        }
        void allowedResourceKinds;
        void allowedProfileRefs;
        void allowedDomains;
        void allowedPages;
    }
    if (upstreamAuthorization &&
        hasOwn(options, "issue_scope") &&
        explicitIssueScope !== inferredIssueScope) {
        throw invalidAbilityInput("ISSUE_SCOPE_CONFLICT", abilityId);
    }
    const canonicalIssueScope = !upstreamAuthorization && inferredIssueScope === "issue_209"
        ? inferredIssueScope
        : explicitIssueScope ?? inferredIssueScope ?? resolveCanonicalIssueScopeForContract({
            ...options,
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            requested_execution_mode: requestedExecutionModeFromContract
        });
    return {
        targetDomain,
        targetTabId,
        targetPage,
        requestedExecutionMode: requestedExecutionModeFromContract,
        options: {
            ...options,
            ...(legacyProjectedActionType ? { action_type: legacyProjectedActionType } : {}),
            ...(projectedValidationAction ? { validation_action: projectedValidationAction } : {}),
            target_domain: targetDomain,
            target_tab_id: targetTabId,
            target_page: targetPage,
            requested_execution_mode: requestedExecutionModeFromContract,
            ...(normalizedRiskState ? { risk_state: normalizedRiskState } : {}),
            ...(upstreamAuthorization
                ? {
                    upstream_authorization_request: cloneJsonObject(upstreamAuthorization),
                    ...(requestedExecutionMode
                        ? { __legacy_requested_execution_mode: requestedExecutionMode }
                        : {})
                }
                : {}),
            ...(canonicalIssueScope ? { issue_scope: canonicalIssueScope } : {})
        }
    };
};
const cloneAdmissionContextForContract = (value) => {
    const object = asObject(value);
    if (!object) {
        return null;
    }
    return cloneJsonObject(object);
};
const cloneAdmissionDraftForContract = (value) => {
    const object = asObject(value);
    if (!object) {
        return null;
    }
    const kind = asString(object.kind);
    if (kind === "missing") {
        return { kind };
    }
    if (kind !== "draft" && kind !== "explicit_context" && kind !== "derived_draft") {
        return null;
    }
    const admissionContext = cloneAdmissionContextForContract(object.admission_context);
    if (!admissionContext) {
        return null;
    }
    return {
        kind: "draft",
        admission_context: admissionContext
    };
};
const isIssue209LiveReadRequest = (options) => options.issue_scope === "issue_209" &&
    typeof options.requested_execution_mode === "string" &&
    XHS_LIVE_READ_EXECUTION_MODES.has(options.requested_execution_mode);
const resolveIssue209AdmissionDraftForContract = (input) => {
    const legacyDraft = cloneAdmissionDraftForContract(input.admissionDraft);
    if (legacyDraft) {
        return legacyDraft;
    }
    const source = prepareIssue209LiveReadSource({
        commandRequestId: input.requestId,
        gateInvocationId: input.gateInvocationId,
        runId: input.runId,
        targetDomain: input.options.target_domain,
        targetTabId: input.options.target_tab_id,
        targetPage: input.options.target_page,
        actionType: input.options.action_type,
        requestedExecutionMode: input.options.requested_execution_mode,
        riskState: input.options.risk_state,
        admissionContext: input.options.admission_context,
        approvalRecord: input.options.approval_record ?? input.options.approval,
        auditRecord: input.options.audit_record
    });
    const current = source.current;
    const canonicalGrant = asObject(asObject(input.options.upstream_authorization_request)?.authorization_grant);
    const canonicalGrantUpstream = asObject(input.options.upstream_authorization_request);
    const canonicalGrantActionRequest = asObject(canonicalGrantUpstream?.action_request);
    const canonicalGrantResourceBinding = asObject(canonicalGrantUpstream?.resource_binding);
    const canonicalGrantRuntimeTarget = asObject(canonicalGrantUpstream?.runtime_target);
    const canonicalActionRequestRef = asString(canonicalGrantActionRequest?.request_ref);
    const canonicalBindingRef = asString(canonicalGrantResourceBinding?.binding_ref);
    const canonicalGrantRef = asString(canonicalGrant?.grant_ref);
    const canonicalTargetRef = asString(canonicalGrantRuntimeTarget?.target_ref);
    const canonicalBindingScope = asObject(canonicalGrant?.binding_scope);
    const canonicalTargetScope = asObject(canonicalGrant?.target_scope);
    const canonicalGrantApprovalRefs = asStringArray(canonicalGrant?.approval_refs);
    const canonicalGrantAuditRefs = asStringArray(canonicalGrant?.audit_refs);
    const canonicalGrantActionType = asString(canonicalGrantActionRequest?.action_category);
    const canonicalGrantApprovedAt = asString(canonicalGrant?.granted_at) ?? asString(canonicalGrantActionRequest?.requested_at);
    const canonicalGrantResourceKind = asString(canonicalGrantResourceBinding?.resource_kind);
    const canonicalGrantProfileRef = asString(canonicalGrantResourceBinding?.profile_ref);
    const canonicalGrantBindingConstraints = asObject(canonicalGrantResourceBinding?.binding_constraints);
    const canonicalGrantDomain = asString(canonicalGrantRuntimeTarget?.domain);
    const canonicalGrantPage = asString(canonicalGrantRuntimeTarget?.page);
    const canonicalGrantTabId = asInteger(canonicalGrantRuntimeTarget?.tab_id);
    const canonicalGrantRiskState = projectRiskStateForContract(asString(canonicalGrant?.resource_state_snapshot));
    const canonicalGrantSupportsRequestedMode = input.options.requested_execution_mode === "live_read_high_risk"
        ? canonicalGrantRiskState === "allowed"
        : input.options.requested_execution_mode === "live_read_limited"
            ? canonicalGrantRiskState === "limited" || canonicalGrantRiskState === "allowed"
            : false;
    const canonicalGrantMatchesCurrentTarget = canonicalGrantDomain === current.targetDomain &&
        canonicalGrantPage === current.targetPage &&
        canonicalGrantTabId === current.targetTabId;
    const canonicalGrantHasSupportedResourceKind = canonicalGrantResourceKind !== null &&
        UPSTREAM_RESOURCE_KINDS.has(canonicalGrantResourceKind);
    const canonicalGrantHasExecutableBinding = canonicalGrantResourceKind === "profile_session"
        ? canonicalGrantProfileRef !== null
        : canonicalGrantResourceKind === "anonymous_context"
            ? canonicalGrantProfileRef === null &&
                canonicalGrantBindingConstraints?.anonymous_required === true &&
                canonicalGrantBindingConstraints?.reuse_logged_in_context_forbidden === true
            : false;
    const canonicalGrantCanDriveAdmission = canonicalGrantActionRequest !== null &&
        canonicalGrantResourceBinding !== null &&
        canonicalGrant !== null &&
        canonicalGrantRuntimeTarget !== null &&
        canonicalActionRequestRef !== null &&
        canonicalBindingRef !== null &&
        canonicalGrantRef !== null &&
        canonicalTargetRef !== null &&
        canonicalGrantApprovedAt !== null &&
        canonicalGrantApprovalRefs !== null &&
        canonicalGrantApprovalRefs.length > 0 &&
        canonicalGrantAuditRefs !== null &&
        canonicalGrantAuditRefs.length > 0 &&
        canonicalGrantSupportsRequestedMode &&
        canonicalGrantActionType === current.actionType &&
        canonicalGrantMatchesCurrentTarget &&
        canonicalGrantHasSupportedResourceKind &&
        canonicalGrantHasExecutableBinding &&
        canonicalGrantDomain !== null &&
        canonicalGrantPage !== null &&
        (asStringArray(canonicalGrant?.allowed_actions)?.includes(asString(canonicalGrantActionRequest?.action_name) ?? "") ?? false) &&
        (asStringArray(canonicalBindingScope?.allowed_resource_kinds)?.includes(canonicalGrantResourceKind) ??
            false) &&
        (canonicalGrantResourceKind !== "profile_session" ||
            !canonicalGrantProfileRef ||
            (asStringArray(canonicalBindingScope?.allowed_profile_refs)?.includes(canonicalGrantProfileRef) ??
                false)) &&
        (asStringArray(canonicalTargetScope?.allowed_domains)?.includes(canonicalGrantDomain) ?? false) &&
        (asStringArray(canonicalTargetScope?.allowed_pages)?.includes(canonicalGrantPage) ?? false);
    const hasAllTrueChecks = (checks) => Object.keys(checks).length > 0 && Object.values(checks).every((value) => value === true);
    const bindingMatches = (evidence, includeRiskState = false, riskState) => {
        if (evidence.run_id !== current.runId ||
            evidence.issue_scope !== current.issueScope ||
            evidence.target_domain !== current.targetDomain ||
            evidence.target_tab_id !== current.targetTabId ||
            evidence.target_page !== current.targetPage ||
            evidence.action_type !== current.actionType ||
            evidence.requested_execution_mode !== current.requestedExecutionMode) {
            return false;
        }
        if (input.requestIdWasExplicit &&
            current.commandRequestId &&
            evidence.request_id !== null &&
            evidence.request_id !== undefined &&
            evidence.request_id !== current.commandRequestId) {
            return false;
        }
        if (includeRiskState && riskState !== current.riskState) {
            return false;
        }
        return true;
    };
    const linkageMatches = (decisionId, approvalId) => {
        const carriesDecisionId = decisionId !== null && decisionId !== undefined;
        const carriesApprovalId = approvalId !== null && approvalId !== undefined;
        if (!carriesDecisionId && !carriesApprovalId) {
            return true;
        }
        if (!carriesDecisionId || !carriesApprovalId) {
            return false;
        }
        return decisionId === current.decisionId && approvalId === current.approvalId;
    };
    const explicitApproval = source.explicitApprovalEvidence;
    const explicitAudit = source.explicitAuditEvidence;
    const explicitSourceValid = source.explicitAdmissionContext !== null &&
        explicitApproval.approval_admission_ref &&
        explicitApproval.recorded_at &&
        explicitApproval.approved === true &&
        explicitApproval.approver &&
        explicitApproval.approved_at &&
        hasAllTrueChecks(explicitApproval.checks) &&
        bindingMatches(explicitApproval) &&
        linkageMatches(explicitApproval.decision_id, explicitApproval.approval_id) &&
        explicitAudit.audit_admission_ref &&
        explicitAudit.recorded_at &&
        hasAllTrueChecks(explicitAudit.audited_checks) &&
        bindingMatches(explicitAudit, true, explicitAudit.risk_state) &&
        linkageMatches(explicitAudit.decision_id, explicitAudit.approval_id);
    const approvalSource = source.approvalSource;
    const auditSource = source.auditSource;
    const validatedApprovalSource = validateIssue209ApprovalSourceAgainstCurrentLinkage({
        current,
        approvalSource
    });
    const validatedAuditSource = validateIssue209AuditSourceAgainstCurrentLinkage({
        current,
        auditSource,
        requestIdWasExplicit: input.requestIdWasExplicit
    });
    const formalApprovalValid = validatedApprovalSource.isValid;
    const formalAuditValid = validatedAuditSource.isValid;
    const completeFormalSource = formalApprovalValid && formalAuditValid;
    if (source.explicitAdmissionContext !== null) {
        if (explicitSourceValid) {
            return {
                kind: "draft",
                admission_context: {
                    approval_admission_evidence: {
                        approval_admission_ref: explicitApproval.approval_admission_ref,
                        decision_id: current.decisionId,
                        approval_id: current.approvalId,
                        ...(current.commandRequestId ? { request_id: current.commandRequestId } : {}),
                        run_id: current.runId,
                        session_id: null,
                        issue_scope: current.issueScope,
                        target_domain: current.targetDomain,
                        target_tab_id: current.targetTabId,
                        target_page: current.targetPage,
                        action_type: current.actionType,
                        requested_execution_mode: current.requestedExecutionMode,
                        approved: true,
                        approver: explicitApproval.approver,
                        approved_at: explicitApproval.approved_at,
                        checks: explicitApproval.checks,
                        recorded_at: explicitApproval.recorded_at
                    },
                    audit_admission_evidence: {
                        audit_admission_ref: explicitAudit.audit_admission_ref,
                        decision_id: current.decisionId,
                        approval_id: current.approvalId,
                        ...(current.commandRequestId ? { request_id: current.commandRequestId } : {}),
                        run_id: current.runId,
                        session_id: null,
                        issue_scope: current.issueScope,
                        target_domain: current.targetDomain,
                        target_tab_id: current.targetTabId,
                        target_page: current.targetPage,
                        action_type: current.actionType,
                        requested_execution_mode: current.requestedExecutionMode,
                        risk_state: current.riskState,
                        audited_checks: explicitAudit.audited_checks,
                        recorded_at: explicitAudit.recorded_at
                    }
                }
            };
        }
    }
    if (completeFormalSource && canonicalGrantCanDriveAdmission) {
        return { kind: "missing" };
    }
    if (completeFormalSource) {
        return {
            kind: "draft",
            admission_context: {
                approval_admission_evidence: {
                    approval_admission_ref: `approval_admission_${current.gateInvocationId}`,
                    decision_id: validatedApprovalSource.approvalRecord.decision_id,
                    approval_id: validatedApprovalSource.approvalRecord.approval_id,
                    ...(current.commandRequestId ? { request_id: current.commandRequestId } : {}),
                    run_id: current.runId,
                    session_id: null,
                    issue_scope: current.issueScope,
                    target_domain: current.targetDomain,
                    target_tab_id: current.targetTabId,
                    target_page: current.targetPage,
                    action_type: current.actionType,
                    requested_execution_mode: current.requestedExecutionMode,
                    approved: validatedApprovalSource.approvalRecord.approved,
                    approver: validatedApprovalSource.approvalRecord.approver,
                    approved_at: validatedApprovalSource.approvalRecord.approved_at,
                    checks: validatedApprovalSource.approvalRecord.checks,
                    recorded_at: validatedApprovalSource.approvalRecord.approved_at
                },
                audit_admission_evidence: {
                    audit_admission_ref: `audit_admission_${current.gateInvocationId}`,
                    decision_id: validatedAuditSource.auditRecord.decision_id,
                    approval_id: validatedAuditSource.auditRecord.approval_id,
                    ...(current.commandRequestId ? { request_id: current.commandRequestId } : {}),
                    run_id: current.runId,
                    session_id: null,
                    issue_scope: current.issueScope,
                    target_domain: current.targetDomain,
                    target_tab_id: current.targetTabId,
                    target_page: current.targetPage,
                    action_type: current.actionType,
                    requested_execution_mode: current.requestedExecutionMode,
                    risk_state: current.riskState,
                    audited_checks: validatedAuditSource.auditRecord.audited_checks,
                    recorded_at: validatedAuditSource.auditRecord.recorded_at
                }
            }
        };
    }
    return { kind: "missing" };
};
const bindIssue209AdmissionContextToSession = (admissionContext, sessionId) => {
    const nextAdmissionContext = cloneJsonObject(admissionContext);
    const bindEvidence = (key) => {
        const evidence = asObject(nextAdmissionContext[key]);
        if (!evidence) {
            return;
        }
        nextAdmissionContext[key] = {
            ...evidence,
            session_id: sessionId
        };
    };
    bindEvidence("approval_admission_evidence");
    bindEvidence("audit_admission_evidence");
    return nextAdmissionContext;
};
export const prepareIssue209LiveReadEnvelopeForContract = (input) => {
    const nextOptions = cloneJsonObject(input.options);
    if (!isIssue209LiveReadRequest(nextOptions)) {
        const admissionDraft = cloneAdmissionDraftForContract(input.admissionDraft);
        delete nextOptions.admission_context;
        delete nextOptions[ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY];
        return {
            commandRequestId: asString(input.requestId),
            gateInvocationId: asString(input.gateInvocationId),
            options: nextOptions,
            admissionDraft
        };
    }
    const explicitRequestId = asString(input.requestId);
    const commandRequestId = explicitRequestId ?? `${ISSUE209_LIVE_REQUEST_ID_PREFIX}-${randomUUID()}`;
    const gateInvocationId = asString(input.gateInvocationId) ??
        `${ISSUE209_GATE_INVOCATION_ID_PREFIX}-${input.runId}-${randomUUID()}`;
    const admissionDraft = resolveIssue209AdmissionDraftForContract({
        options: nextOptions,
        runId: input.runId,
        requestId: commandRequestId,
        requestIdWasExplicit: explicitRequestId !== null,
        gateInvocationId,
        admissionDraft: input.admissionDraft
    });
    delete nextOptions.admission_context;
    delete nextOptions[ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY];
    return {
        commandRequestId,
        gateInvocationId,
        options: nextOptions,
        admissionDraft: admissionDraft ?? { kind: "missing" }
    };
};
export const bindIssue209LiveReadEnvelopeToSessionForContract = (input) => {
    const nextParams = cloneJsonObject(input.params);
    const optionParams = asObject(nextParams.options);
    if (!optionParams) {
        return nextParams;
    }
    const prepared = prepareIssue209LiveReadEnvelopeForContract({
        options: optionParams,
        runId: input.runId,
        requestId: asString(nextParams.request_id),
        gateInvocationId: asString(nextParams.gate_invocation_id),
        admissionDraft: cloneAdmissionDraftForContract(nextParams[ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY]) ??
            cloneAdmissionDraftForContract(optionParams[ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY])
    });
    const nextOptions = cloneJsonObject(prepared.options);
    const draftKind = asString(prepared.admissionDraft?.kind);
    if (draftKind === "draft") {
        const admissionContext = cloneAdmissionContextForContract(prepared.admissionDraft?.admission_context);
        if (admissionContext) {
            nextOptions.admission_context = bindIssue209AdmissionContextToSession(admissionContext, input.sessionId);
        }
    }
    nextParams.options = nextOptions;
    delete nextParams[ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY];
    if (prepared.commandRequestId) {
        nextParams.request_id = prepared.commandRequestId;
    }
    if (prepared.gateInvocationId) {
        nextParams.gate_invocation_id = prepared.gateInvocationId;
    }
    return nextParams;
};
export const prepareIssue209LiveReadContract = (input) => {
    const prepared = prepareIssue209LiveReadEnvelopeForContract({
        options: input.options,
        runId: input.runId,
        requestId: input.requestId,
        gateInvocationId: input.gateInvocationId
    });
    const bound = input.sessionId && prepared.admissionDraft
        ? bindIssue209LiveReadEnvelopeToSessionForContract({
            params: {
                request_id: prepared.commandRequestId,
                gate_invocation_id: prepared.gateInvocationId,
                options: prepared.options,
                [ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY]: prepared.admissionDraft
            },
            runId: input.runId,
            sessionId: input.sessionId
        })
        : { options: prepared.options };
    return {
        commandRequestId: prepared.commandRequestId,
        gateInvocationId: prepared.gateInvocationId,
        options: asObject(bound.options) ?? prepared.options
    };
};
export const resolveIssue209CommandRequestIdForContract = (input) => {
    const requestId = asString(input.requestId);
    if (requestId) {
        return requestId;
    }
    if (!isIssue209LiveReadRequest(input.options)) {
        return null;
    }
    void input.runId;
    return `${ISSUE209_LIVE_REQUEST_ID_PREFIX}-${randomUUID()}`;
};
export const resolveIssue209GateInvocationIdForContract = (input) => {
    const explicitInvocationId = asString(input.gateInvocationId);
    if (explicitInvocationId) {
        return explicitInvocationId;
    }
    if (!isIssue209LiveReadRequest(input.options)) {
        return null;
    }
    return `${ISSUE209_GATE_INVOCATION_ID_PREFIX}-${input.runId}-${randomUUID()}`;
};
export const ensureIssue209AdmissionContextForContract = (input) => {
    return prepareIssue209LiveReadContract({
        options: input.options,
        runId: input.runId,
        requestId: input.requestId,
        sessionId: input.sessionId,
        gateInvocationId: input.gateInvocationId
    }).options;
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
