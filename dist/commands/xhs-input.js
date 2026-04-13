import { randomUUID } from "node:crypto";
import { CliError } from "../core/errors.js";
import { prepareIssue209LiveReadSource } from "../../shared/issue209-live-read/source.js";
const ABILITY_LAYERS = new Set(["L3", "L2", "L1"]);
const ABILITY_ACTIONS = new Set(["read", "write", "download"]);
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
const XHS_READ_DOMAIN = "www.xiaohongshu.com";
const ISSUE209_LIVE_REQUEST_ID_PREFIX = "issue209-live";
const ISSUE209_GATE_INVOCATION_ID_PREFIX = "issue209-gate";
export const ISSUE209_INTERNAL_ADMISSION_DRAFT_KEY = "__issue209_admission_draft";
const asObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const cloneJsonObject = (value) => JSON.parse(JSON.stringify(value));
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
    return {
        ability: {
            id: abilityId,
            layer: layer,
            action: action
        },
        input,
        options,
        requestId
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
    const canonicalIssueScope = resolveCanonicalIssueScopeForContract({
        ...options,
        target_domain: targetDomain,
        target_tab_id: targetTabId,
        target_page: targetPage,
        requested_execution_mode: requestedExecutionMode
    });
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
            requested_execution_mode: requestedExecutionMode,
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
    const approvalSource = source.approvalSource;
    const auditSource = source.auditSource;
    const formalApprovalValid = approvalSource.approved === true &&
        approvalSource.approver &&
        approvalSource.approved_at &&
        hasAllTrueChecks(approvalSource.checks);
    const formalAuditValid = auditSource.event_id &&
        auditSource.recorded_at &&
        auditSource.gate_decision === "allowed" &&
        (auditSource.issue_scope === null || auditSource.issue_scope === current.issueScope) &&
        (auditSource.target_domain === null || auditSource.target_domain === current.targetDomain) &&
        (auditSource.target_tab_id === null || auditSource.target_tab_id === current.targetTabId) &&
        (auditSource.target_page === null || auditSource.target_page === current.targetPage) &&
        (auditSource.action_type === null || auditSource.action_type === current.actionType) &&
        (auditSource.requested_execution_mode === null ||
            auditSource.requested_execution_mode === current.requestedExecutionMode) &&
        (auditSource.risk_state === null || auditSource.risk_state === current.riskState) &&
        (!input.requestIdWasExplicit ||
            current.commandRequestId === null ||
            auditSource.request_id === null ||
            auditSource.request_id === current.commandRequestId);
    const completeFormalSource = formalApprovalValid && formalAuditValid;
    if (source.explicitAdmissionContext !== null && completeFormalSource && !explicitSourceValid) {
        return { kind: "missing" };
    }
    if (completeFormalSource) {
        const auditChecks = Object.values(auditSource.audited_checks).some((value) => value === true)
            ? auditSource.audited_checks
            : approvalSource.checks;
        return {
            kind: "draft",
            admission_context: {
                approval_admission_evidence: {
                    approval_admission_ref: `approval_admission_${current.gateInvocationId}`,
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
                    approver: approvalSource.approver,
                    approved_at: approvalSource.approved_at,
                    checks: approvalSource.checks,
                    recorded_at: approvalSource.approved_at
                },
                audit_admission_evidence: {
                    audit_admission_ref: `audit_admission_${current.gateInvocationId}`,
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
                    audited_checks: auditChecks,
                    recorded_at: auditSource.recorded_at
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
