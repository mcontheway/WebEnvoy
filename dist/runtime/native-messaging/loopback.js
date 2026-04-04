import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { WRITE_INTERACTION_TIER, ISSUE_SCOPES, buildRiskTransitionAudit, buildUnifiedRiskStateOutput, getIssueActionMatrixEntry, resolveIssueScope as resolveSharedIssueScope, resolveRiskState as resolveSharedRiskState } from "../../../shared/risk-state.js";
import { evaluateXhsGate } from "../../../shared/xhs-gate.js";
const RELAY_PATH = "host>background>content-script>background>host";
const LOOPBACK_PLUGIN_GATE_OWNERSHIP = {
    background_gate: ["target_domain_check", "target_tab_check", "mode_gate", "risk_state_gate"],
    content_script_gate: ["page_context_check", "action_tier_check"],
    main_world_gate: ["signed_call_scope_check"],
    cli_role: "request_and_result_shell_only"
};
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asInteger = (value) => typeof value === "number" && Number.isInteger(value) ? value : null;
const asBoolean = (value) => value === true;
const resolveLoopbackRiskState = (value) => resolveSharedRiskState(value);
const resolveLoopbackIssueScope = (value) => ISSUE_SCOPES.includes(value)
    ? value
    : resolveSharedIssueScope(value);
const resolveLoopbackIssueActionMatrixEntry = (issueScope, riskState) => {
    return getIssueActionMatrixEntry(issueScope, riskState);
};
const buildLoopbackGate = (options, abilityAction, allowIssue208InteractProbe = false) => {
    const issue208EditorInputValidation = options.issue_scope === "issue_208" &&
        options.requested_execution_mode === "live_write" &&
        asString(options.validation_action) === "editor_input";
    const evaluatedGate = evaluateXhsGate({
        issueScope: options.issue_scope,
        riskState: options.risk_state,
        targetDomain: options.target_domain,
        targetTabId: options.target_tab_id,
        targetPage: options.target_page,
        actionType: options.action_type,
        abilityAction,
        requestedExecutionMode: options.requested_execution_mode,
        approvalRecord: options.approval_record ?? options.approval,
        issue208EditorInputValidation,
        treatMissingEditorValidationAsUnsupported: true,
        includeWriteInteractionTierReason: true,
        writeGateOnlyEligibleBehavior: "block"
    });
    const issueScope = resolveLoopbackIssueScope(evaluatedGate.gate_input.issue_scope);
    return {
        scopeContext: { ...evaluatedGate.scope_context },
        readExecutionPolicy: { ...evaluatedGate.read_execution_policy },
        issueScope,
        issueActionMatrix: evaluatedGate.issue_action_matrix,
        gateInput: { ...evaluatedGate.gate_input },
        gateOutcome: { ...evaluatedGate.gate_outcome },
        consumerGateResult: { ...evaluatedGate.consumer_gate_result },
        approvalRecord: { ...evaluatedGate.approval_record },
        writeInteractionTier: WRITE_INTERACTION_TIER,
        writeActionMatrixDecisions: evaluatedGate.write_action_matrix_decisions
    };
};
const buildLoopbackAuditRecord = (input) => ({
    event_id: `gate_evt_${input.runId}`,
    run_id: input.runId,
    session_id: input.sessionId,
    profile: input.profile,
    risk_state: String(input.gate.gateInput.risk_state ?? "paused"),
    target_domain: input.gate.consumerGateResult.target_domain,
    target_tab_id: input.gate.consumerGateResult.target_tab_id,
    target_page: input.gate.consumerGateResult.target_page,
    action_type: input.gate.consumerGateResult.action_type,
    requested_execution_mode: input.gate.consumerGateResult.requested_execution_mode,
    effective_execution_mode: input.gate.consumerGateResult.effective_execution_mode,
    gate_decision: input.gate.consumerGateResult.gate_decision,
    gate_reasons: input.gate.consumerGateResult.gate_reasons,
    approver: input.gate.approvalRecord.approver,
    approved_at: input.gate.approvalRecord.approved_at,
    write_interaction_tier: input.gate.writeActionMatrixDecisions?.write_interaction_tier ?? null,
    write_action_matrix_decisions: input.gate.writeActionMatrixDecisions,
    recorded_at: "2026-03-23T10:00:00.000Z"
});
const buildLoopbackGatePayload = (input) => {
    const riskTransitionAudit = buildRiskTransitionAudit({
        runId: input.runId,
        sessionId: input.sessionId,
        issueScope: resolveLoopbackIssueScope(input.gate.gateInput.issue_scope),
        prevState: resolveLoopbackRiskState(input.gate.gateInput.risk_state),
        decision: input.gate.consumerGateResult.gate_decision === "allowed" ? "allowed" : "blocked",
        gateReasons: Array.isArray(input.gate.consumerGateResult.gate_reasons)
            ? input.gate.consumerGateResult.gate_reasons.map((item) => String(item))
            : [],
        requestedExecutionMode: asString(input.gate.gateInput.requested_execution_mode),
        approvalRecord: input.gate.approvalRecord,
        auditRecords: [input.auditRecord],
        now: String(input.auditRecord.recorded_at ?? "")
    });
    const resolvedRiskState = resolveLoopbackRiskState(riskTransitionAudit.next_state);
    const resolvedIssueActionMatrix = resolveLoopbackIssueActionMatrixEntry(resolveLoopbackIssueScope(input.gate.gateInput.issue_scope), resolvedRiskState);
    const persistedAuditRecord = {
        ...input.auditRecord,
        next_state: riskTransitionAudit.next_state,
        transition_trigger: riskTransitionAudit.trigger
    };
    return {
        plugin_gate_ownership: LOOPBACK_PLUGIN_GATE_OWNERSHIP,
        scope_context: input.gate.scopeContext,
        gate_input: {
            run_id: input.runId,
            session_id: input.sessionId,
            profile: input.profile,
            ...input.gate.gateInput
        },
        gate_outcome: input.gate.gateOutcome,
        consumer_gate_result: input.gate.consumerGateResult,
        approval_record: input.gate.approvalRecord,
        issue_action_matrix: resolvedIssueActionMatrix,
        write_interaction_tier: input.gate.writeInteractionTier,
        write_action_matrix_decisions: input.gate.writeActionMatrixDecisions,
        observability: buildLoopbackGateObservability(input.gate),
        read_execution_policy: input.gate.readExecutionPolicy,
        risk_state_output: buildUnifiedRiskStateOutput(resolvedRiskState, {
            auditRecords: [persistedAuditRecord],
            now: String(persistedAuditRecord.recorded_at ?? "")
        }),
        audit_record: persistedAuditRecord,
        risk_transition_audit: riskTransitionAudit
    };
};
const buildLoopbackGateObservability = (gate) => {
    const targetPage = asString(gate.gateInput.target_page);
    const targetDomain = asString(gate.gateInput.target_domain);
    return {
        page_state: targetPage && targetDomain
            ? {
                page_kind: targetPage === "creator_publish_tab" ? "compose" : targetPage,
                url: targetPage === "creator_publish_tab"
                    ? `https://${targetDomain}/publish/publish`
                    : targetPage === "search_result_tab"
                        ? `https://${targetDomain}/search_result`
                        : `https://${targetDomain}/`,
                title: targetPage === "creator_publish_tab" ? "Creator Publish" : "Search Result",
                ready_state: "complete"
            }
            : null,
        key_requests: [],
        failure_site: gate.consumerGateResult.gate_decision === "blocked"
            ? {
                stage: "execution",
                component: "gate",
                target: targetPage ?? targetDomain ?? "issue_208_gate_only",
                summary: Array.isArray(gate.consumerGateResult.gate_reasons) &&
                    typeof gate.consumerGateResult.gate_reasons[0] === "string"
                    ? gate.consumerGateResult.gate_reasons[0]
                    : "gate blocked"
            }
            : null
    };
};
class InMemoryPort {
    #listeners = new Set();
    #peer = null;
    connect(peer) {
        this.#peer = peer;
    }
    onMessage(listener) {
        this.#listeners.add(listener);
        return () => this.#listeners.delete(listener);
    }
    postMessage(message) {
        const peer = this.#peer;
        if (!peer) {
            return;
        }
        queueMicrotask(() => {
            for (const listener of peer.#listeners) {
                listener(message);
            }
        });
    }
}
const createPortPair = () => {
    const left = new InMemoryPort();
    const right = new InMemoryPort();
    left.connect(right);
    right.connect(left);
    return [left, right];
};
class InMemoryContentScriptRuntime {
    port;
    static BOOTSTRAP_ATTEST_DELAY_MS = 10;
    #bootstrapContext = null;
    constructor(port) {
        this.port = port;
        this.port.onMessage((message) => {
            if (message.kind !== "forward") {
                return;
            }
            this.port.postMessage(this.handleForward(message));
        });
    }
    handleForward(message) {
        if (message.command === "runtime.ping") {
            return {
                kind: "result",
                id: message.id,
                ok: true,
                payload: {
                    message: "pong",
                    runtime_bootstrap_attested: this.#bootstrapContext?.attested === true
                }
            };
        }
        if (message.command === "runtime.bootstrap") {
            const commandParams = asRecord(message.commandParams) ?? {};
            const version = asString(commandParams.version);
            const runId = asString(commandParams.run_id);
            const runtimeContextId = asString(commandParams.runtime_context_id);
            const profile = asString(commandParams.profile);
            const fingerprintRuntime = asRecord(commandParams.fingerprint_runtime);
            const fingerprintPatchManifest = asRecord(commandParams.fingerprint_patch_manifest);
            const mainWorldSecret = asString(commandParams.main_world_secret);
            if (!version ||
                !runId ||
                !runtimeContextId ||
                !profile ||
                !fingerprintRuntime ||
                !fingerprintPatchManifest ||
                !mainWorldSecret) {
                return {
                    kind: "result",
                    id: message.id,
                    ok: false,
                    error: {
                        code: "ERR_RUNTIME_READY_SIGNAL_CONFLICT",
                        message: "invalid runtime bootstrap envelope"
                    }
                };
            }
            const currentBootstrapContext = this.#bootstrapContext;
            if (currentBootstrapContext &&
                currentBootstrapContext.attested &&
                currentBootstrapContext.version === version &&
                currentBootstrapContext.runId === runId &&
                currentBootstrapContext.runtimeContextId === runtimeContextId &&
                currentBootstrapContext.profile === profile) {
                return {
                    kind: "result",
                    id: message.id,
                    ok: true,
                    payload: {
                        method: "runtime.bootstrap.ack",
                        result: {
                            version,
                            run_id: runId,
                            runtime_context_id: runtimeContextId,
                            profile,
                            status: "ready"
                        },
                        runtime_bootstrap_attested: true
                    }
                };
            }
            this.#bootstrapContext = {
                version,
                runId,
                runtimeContextId,
                profile,
                attested: false
            };
            setTimeout(() => {
                const bootstrapContext = this.#bootstrapContext;
                if (bootstrapContext &&
                    bootstrapContext.runId === runId &&
                    bootstrapContext.runtimeContextId === runtimeContextId &&
                    bootstrapContext.profile === profile) {
                    this.#bootstrapContext = {
                        ...bootstrapContext,
                        attested: true
                    };
                }
            }, InMemoryContentScriptRuntime.BOOTSTRAP_ATTEST_DELAY_MS);
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED",
                    message: "runtime bootstrap 尚未获得执行面确认"
                }
            };
        }
        if (message.command === "runtime.readiness") {
            const commandParams = asRecord(message.commandParams) ?? {};
            const runId = asString(commandParams.run_id);
            const runtimeContextId = asString(commandParams.runtime_context_id);
            let bootstrapState = "not_started";
            if (this.#bootstrapContext) {
                bootstrapState =
                    runId === this.#bootstrapContext.runId &&
                        runtimeContextId === this.#bootstrapContext.runtimeContextId
                        ? (this.#bootstrapContext.attested ? "ready" : "pending")
                        : "stale";
            }
            return {
                kind: "result",
                id: message.id,
                ok: true,
                payload: {
                    transport_state: "ready",
                    bootstrap_state: bootstrapState
                }
            };
        }
        if (message.command === "xhs.search") {
            const simulated = typeof message.commandParams.options === "object" &&
                message.commandParams.options !== null &&
                typeof message.commandParams.options.simulate_result === "string"
                ? String(message.commandParams.options.simulate_result)
                : "success";
            const ability = typeof message.commandParams.ability === "object" && message.commandParams.ability !== null
                ? message.commandParams.ability
                : {};
            const input = typeof message.commandParams.input === "object" && message.commandParams.input !== null
                ? message.commandParams.input
                : {};
            const options = typeof message.commandParams.options === "object" && message.commandParams.options !== null
                ? message.commandParams.options
                : {};
            const gate = buildLoopbackGate(options, asString(ability.action));
            const consumerGateResult = gate.consumerGateResult;
            const auditRecord = buildLoopbackAuditRecord({
                runId: message.runId,
                sessionId: message.sessionId,
                profile: "loopback_profile",
                gate
            });
            const gateBundle = buildLoopbackGatePayload({
                runId: message.runId,
                sessionId: message.sessionId,
                profile: "loopback_profile",
                gate,
                auditRecord
            });
            if (consumerGateResult.gate_decision === "blocked") {
                return {
                    kind: "result",
                    id: message.id,
                    ok: false,
                    error: {
                        code: "ERR_EXECUTION_FAILED",
                        message: "执行模式门禁阻断了当前 xhs.search 请求"
                    },
                    payload: {
                        details: {
                            ability_id: String(ability.id ?? "xhs.note.search.v1"),
                            stage: "execution",
                            reason: "EXECUTION_MODE_GATE_BLOCKED"
                        },
                        ...gateBundle
                    }
                };
            }
            if (consumerGateResult.effective_execution_mode === "dry_run" ||
                consumerGateResult.effective_execution_mode === "recon") {
                return {
                    kind: "result",
                    id: message.id,
                    ok: true,
                    payload: {
                        summary: {
                            capability_result: {
                                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                                layer: String(ability.layer ?? "L3"),
                                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                                outcome: "partial",
                                data_ref: {
                                    query: String(input.query ?? "")
                                },
                                metrics: {
                                    count: 0
                                }
                            },
                            ...gateBundle
                        },
                        observability: {
                            page_state: {
                                page_kind: "search",
                                url: "https://www.xiaohongshu.com/search_result",
                                title: "Search Result",
                                ready_state: "complete"
                            },
                            key_requests: [],
                            failure_site: null
                        }
                    }
                };
            }
            if (consumerGateResult.effective_execution_mode === "live_write" &&
                options.validation_action === "editor_input") {
                const validationText = typeof options.validation_text === "string" && options.validation_text.trim().length > 0
                    ? options.validation_text.trim()
                    : "WebEnvoy editor_input validation";
                return {
                    kind: "result",
                    id: message.id,
                    ok: false,
                    payload: {
                        summary: {
                            capability_result: {
                                ability_id: String(ability.id ?? "xhs.issue208.editor_input"),
                                layer: String(ability.layer ?? "L3"),
                                action: String(consumerGateResult.action_type ?? ability.action ?? "write"),
                                outcome: "blocked",
                                data_ref: {
                                    validation_action: "editor_input"
                                },
                                metrics: {
                                    duration_ms: 12
                                }
                            },
                            ...gateBundle,
                            interaction_result: {
                                validation_action: "editor_input",
                                target_page: "creator.xiaohongshu.com/publish",
                                success_signals: [],
                                failure_signals: ["EDITOR_INPUT_VALIDATION_REQUIRED"],
                                minimum_replay: ["focus_editor", "type_short_text", "blur_or_reobserve"],
                                out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
                            }
                        },
                        observability: {
                            page_state: {
                                page_kind: "compose",
                                url: "https://creator.xiaohongshu.com/publish/publish",
                                title: "Creator Publish",
                                ready_state: "complete"
                            },
                            key_requests: [],
                            failure_site: {
                                stage: "execution",
                                component: "page",
                                target: "editor_input",
                                summary: "loopback transport cannot attest controlled editor_input validation"
                            }
                        }
                    },
                    error: {
                        code: "ERR_EXECUTION_FAILED",
                        message: `editor_input validation requires a controlled execution surface: ${validationText}`
                    }
                };
            }
            if (simulated === "success") {
                return {
                    kind: "result",
                    id: message.id,
                    ok: true,
                    payload: {
                        summary: {
                            capability_result: {
                                ability_id: String(ability.id ?? "xhs.note.search.v1"),
                                layer: String(ability.layer ?? "L3"),
                                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                                outcome: "success",
                                data_ref: {
                                    query: String(input.query ?? ""),
                                    search_id: "loopback-search-id"
                                },
                                metrics: {
                                    count: 2,
                                    duration_ms: 12
                                }
                            },
                            ...gateBundle
                        },
                        observability: {
                            page_state: {
                                page_kind: "search",
                                url: "https://www.xiaohongshu.com/search_result",
                                title: "Search Result",
                                ready_state: "complete"
                            },
                            key_requests: [
                                {
                                    request_id: "req-loopback-001",
                                    stage: "request",
                                    method: "POST",
                                    url: "/api/sns/web/v1/search/notes",
                                    outcome: "completed",
                                    status_code: 200
                                }
                            ],
                            failure_site: null
                        }
                    }
                };
            }
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: simulated === "login_required"
                        ? "登录态缺失，无法执行 xhs.search"
                        : simulated === "account_abnormal"
                            ? "账号异常，平台拒绝当前请求"
                            : simulated === "browser_env_abnormal"
                                ? "浏览器环境异常，平台拒绝当前请求"
                                : simulated === "signature_entry_missing"
                                    ? "页面签名入口不可用"
                                    : "网关调用失败，当前上下文不足以完成搜索请求"
                },
                payload: {
                    details: {
                        ability_id: String(ability.id ?? "xhs.note.search.v1"),
                        stage: "execution",
                        reason: simulated === "login_required"
                            ? "SESSION_EXPIRED"
                            : simulated === "account_abnormal"
                                ? "ACCOUNT_ABNORMAL"
                                : simulated === "browser_env_abnormal"
                                    ? "BROWSER_ENV_ABNORMAL"
                                    : simulated === "signature_entry_missing"
                                        ? "SIGNATURE_ENTRY_MISSING"
                                        : "GATEWAY_INVOKER_FAILED"
                    },
                    ...gateBundle,
                    observability: {
                        page_state: {
                            page_kind: simulated === "login_required" ? "login" : "search",
                            url: simulated === "login_required"
                                ? "https://www.xiaohongshu.com/login"
                                : "https://www.xiaohongshu.com/search_result",
                            title: "Search Result",
                            ready_state: "complete"
                        },
                        key_requests: [
                            {
                                request_id: "req-loopback-001",
                                stage: "request",
                                method: "POST",
                                url: "/api/sns/web/v1/search/notes",
                                outcome: "failed",
                                status_code: simulated === "account_abnormal"
                                    ? 461
                                    : simulated === "browser_env_abnormal"
                                        ? 200
                                        : simulated === "gateway_invoker_failed"
                                            ? 500
                                            : undefined,
                                failure_reason: simulated
                            }
                        ],
                        failure_site: {
                            stage: simulated === "signature_entry_missing" ? "execution" : "request",
                            component: simulated === "signature_entry_missing" ? "page" : "network",
                            target: simulated === "signature_entry_missing"
                                ? "window._webmsxyw"
                                : "/api/sns/web/v1/search/notes",
                            summary: simulated
                        }
                    },
                    diagnosis: {
                        category: simulated === "signature_entry_missing" ? "page_changed" : "request_failed",
                        stage: simulated === "signature_entry_missing" ? "execution" : "request",
                        component: simulated === "signature_entry_missing" ? "page" : "network",
                        failure_site: {
                            stage: simulated === "signature_entry_missing" ? "execution" : "request",
                            component: simulated === "signature_entry_missing" ? "page" : "network",
                            target: simulated === "signature_entry_missing"
                                ? "window._webmsxyw"
                                : "/api/sns/web/v1/search/notes",
                            summary: simulated
                        },
                        evidence: [simulated]
                    }
                }
            };
        }
        return {
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                message: "pong"
            }
        };
    }
}
class InMemoryBackgroundRelay {
    hostPort;
    contentPort;
    #pendingForward = new Map();
    #sessionId = "nm-session-001";
    constructor(hostPort, contentPort) {
        this.hostPort = hostPort;
        this.contentPort = contentPort;
        this.hostPort.onMessage((message) => {
            if (message.kind !== "request") {
                return;
            }
            this.handleHostRequest(message.envelope);
        });
        this.contentPort.onMessage((message) => {
            if (message.kind !== "result") {
                return;
            }
            this.handleContentResult(message);
        });
    }
    handleHostRequest(request) {
        ensureBridgeRequestEnvelope(request);
        if (request.method === "bridge.open") {
            this.hostPort.postMessage({
                kind: "response",
                envelope: {
                    id: request.id,
                    status: "success",
                    summary: {
                        protocol: BRIDGE_PROTOCOL,
                        session_id: this.#sessionId,
                        state: "ready",
                        relay_path: RELAY_PATH
                    },
                    error: null
                }
            });
            return;
        }
        if (request.method === "__ping__") {
            this.hostPort.postMessage({
                kind: "response",
                envelope: {
                    id: request.id,
                    status: "success",
                    summary: {
                        session_id: this.#sessionId,
                        relay_path: RELAY_PATH
                    },
                    error: null
                }
            });
            return;
        }
        if (request.method === "bridge.forward") {
            const command = String(request.params.command ?? "");
            const commandParams = typeof request.params.command_params === "object" && request.params.command_params !== null
                ? request.params.command_params
                : {};
            const runId = String(request.params.run_id ?? request.id);
            const sessionId = String(request.params.session_id ?? this.#sessionId);
            let gatePayload;
            if (command === "xhs.search") {
                const ability = typeof commandParams.ability === "object" && commandParams.ability !== null
                    ? commandParams.ability
                    : {};
                const options = typeof commandParams.options === "object" && commandParams.options !== null
                    ? commandParams.options
                    : {};
                const gate = buildLoopbackGate(options, asString(ability.action));
                const auditRecord = buildLoopbackAuditRecord({
                    runId,
                    sessionId,
                    profile: "loopback_profile",
                    gate
                });
                gatePayload = buildLoopbackGatePayload({
                    runId,
                    sessionId,
                    profile: "loopback_profile",
                    gate,
                    auditRecord
                });
                const consumerGateResult = asRecord(gatePayload.consumer_gate_result);
                if (consumerGateResult?.gate_decision === "blocked") {
                    this.hostPort.postMessage({
                        kind: "response",
                        envelope: {
                            id: request.id,
                            status: "error",
                            summary: {
                                relay_path: RELAY_PATH
                            },
                            payload: {
                                details: {
                                    ability_id: String(ability.id ?? "xhs.note.search.v1"),
                                    stage: "execution",
                                    reason: "EXECUTION_MODE_GATE_BLOCKED"
                                },
                                ...gatePayload
                            },
                            error: {
                                code: "ERR_EXECUTION_FAILED",
                                message: `执行模式门禁阻断了当前 ${command} 请求`
                            }
                        }
                    });
                    return;
                }
            }
            if (command === "xhs.interact") {
                this.hostPort.postMessage({
                    kind: "response",
                    envelope: {
                        id: request.id,
                        status: "error",
                        summary: {},
                        error: {
                            code: "ERR_TRANSPORT_FORWARD_FAILED",
                            message: "unsupported command"
                        }
                    }
                });
                return;
            }
            this.#pendingForward.set(request.id, { request, gatePayload });
            this.contentPort.postMessage({
                kind: "forward",
                id: request.id,
                command,
                commandParams,
                runId,
                sessionId
            });
            return;
        }
        this.hostPort.postMessage({
            kind: "response",
            envelope: {
                id: request.id,
                status: "error",
                summary: {},
                error: {
                    code: "ERR_TRANSPORT_FORWARD_FAILED",
                    message: `unknown method: ${request.method}`
                }
            }
        });
    }
    handleContentResult(result) {
        const pending = this.#pendingForward.get(result.id);
        if (!pending) {
            return;
        }
        this.#pendingForward.delete(result.id);
        const request = pending.request;
        const payload = typeof result.payload === "object" && result.payload !== null
            ? { ...result.payload }
            : {};
        const summary = typeof payload.summary === "object" && payload.summary !== null
            ? payload.summary
            : null;
        if (pending.gatePayload) {
            for (const [key, value] of Object.entries(pending.gatePayload)) {
                const hasInPayload = Object.prototype.hasOwnProperty.call(payload, key);
                const hasInSummary = summary !== null && Object.prototype.hasOwnProperty.call(summary, key);
                if (!hasInPayload && !hasInSummary) {
                    if (summary !== null) {
                        summary[key] = value;
                    }
                    else {
                        payload[key] = value;
                    }
                }
            }
        }
        if (!result.ok) {
            this.hostPort.postMessage({
                kind: "response",
                envelope: {
                    id: request.id,
                    status: "error",
                    summary: {
                        relay_path: RELAY_PATH
                    },
                    payload,
                    error: result.error ?? {
                        code: "ERR_TRANSPORT_FORWARD_FAILED",
                        message: "content script failed"
                    }
                }
            });
            return;
        }
        this.hostPort.postMessage({
            kind: "response",
            envelope: {
                id: request.id,
                status: "success",
                summary: {
                    session_id: String(request.params.session_id ?? this.#sessionId),
                    run_id: String(request.params.run_id ?? request.id),
                    command: String(request.params.command ?? "runtime.ping"),
                    relay_path: RELAY_PATH
                },
                payload,
                error: null
            }
        });
    }
}
class InMemoryHostTransport {
    hostPort;
    #pending = new Map();
    constructor(hostPort) {
        this.hostPort = hostPort;
        this.hostPort.onMessage((message) => {
            if (message.kind !== "response") {
                return;
            }
            const pending = this.#pending.get(message.envelope.id);
            if (!pending) {
                return;
            }
            this.#pending.delete(message.envelope.id);
            pending.resolve(message.envelope);
        });
    }
    open(request) {
        return this.request(request);
    }
    forward(request) {
        return this.request(request);
    }
    heartbeat(request) {
        return this.request(request);
    }
    request(request) {
        ensureBridgeRequestEnvelope(request);
        return new Promise((resolve, reject) => {
            this.#pending.set(request.id, { resolve, reject });
            this.hostPort.postMessage({
                kind: "request",
                envelope: request
            });
        });
    }
}
export const createLoopbackNativeBridgeTransport = () => {
    const [hostPort, backgroundHostPort] = createPortPair();
    const [backgroundContentPort, contentPort] = createPortPair();
    new InMemoryContentScriptRuntime(contentPort);
    new InMemoryBackgroundRelay(backgroundHostPort, backgroundContentPort);
    return new InMemoryHostTransport(hostPort);
};
export const loopbackRelayPath = () => RELAY_PATH;
