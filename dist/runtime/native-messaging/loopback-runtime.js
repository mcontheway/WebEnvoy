import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
import { resolveXhsGateDecisionId } from "../../../shared/xhs-gate.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
const XHS_READ_COMMAND_DEFAULT_ABILITY_IDS = {
    "xhs.search": "xhs.note.search.v1",
    "xhs.detail": "xhs.note.detail.v1",
    "xhs.user_home": "xhs.user.home.v1"
};
const XHS_READ_COMMAND_SPECS = {
    "xhs.search": {
        abilityId: "xhs.note.search.v1",
        pageKind: "search",
        pageUrl: "https://www.xiaohongshu.com/search_result",
        pageTitle: "Search Result",
        requestUrl: "/api/sns/web/v1/search/notes",
        dataRefKey: "query",
        successDataRef: (input) => ({
            query: String(input.query ?? ""),
            search_id: "loopback-search-id"
        }),
        failureSummary: "网关调用失败，当前上下文不足以完成搜索请求"
    },
    "xhs.detail": {
        abilityId: "xhs.note.detail.v1",
        pageKind: "detail",
        pageUrl: "https://www.xiaohongshu.com/explore/loopback-note",
        pageTitle: "Note Detail",
        requestUrl: "/api/sns/web/v1/feed",
        dataRefKey: "note_id",
        successDataRef: (input) => ({
            note_id: String(input.note_id ?? ""),
            note_title: "loopback-note-title"
        }),
        failureSummary: "网关调用失败，当前上下文不足以完成详情读取请求"
    },
    "xhs.user_home": {
        abilityId: "xhs.user.home.v1",
        pageKind: "profile",
        pageUrl: "https://www.xiaohongshu.com/user/profile/loopback-user",
        pageTitle: "User Home",
        requestUrl: "/api/sns/web/v1/user/otherinfo",
        dataRefKey: "user_id",
        successDataRef: (input) => ({
            user_id: String(input.user_id ?? ""),
            profile_id: "loopback-profile-id"
        }),
        failureSummary: "网关调用失败，当前上下文不足以完成主页读取请求"
    }
};
const resolveApprovalRecord = (options) => asRecord(options.approval_record) ?? asRecord(options.approval);
const buildLoopbackXhsReadGateBundle = (input) => {
    const decisionId = resolveXhsGateDecisionId({
        runId: input.runId,
        requestId: input.requestId,
        commandRequestId: input.commandRequestId,
        gateInvocationId: asString(input.gateInvocationId),
        issueScope: input.options.issue_scope,
        requestedExecutionMode: input.options.requested_execution_mode
    });
    const gate = buildLoopbackGate(input.options, input.abilityAction, {
        runId: input.runId,
        requestId: input.requestId,
        commandRequestId: asString(input.commandRequestId) ?? undefined,
        sessionId: input.sessionId,
        gateInvocationId: asString(input.gateInvocationId) ?? undefined,
        decisionId
    });
    const auditRecord = buildLoopbackAuditRecord({
        runId: input.runId,
        sessionId: input.sessionId,
        profile: input.profile,
        gate
    });
    return {
        consumerGateResult: gate.consumerGateResult,
        payload: buildLoopbackGatePayload({
            runId: input.runId,
            sessionId: input.sessionId,
            profile: input.profile,
            gate,
            auditRecord
        })
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
        if (XHS_READ_COMMANDS.has(message.command)) {
            return this.handleXhsRead(message);
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
    handleXhsRead(message) {
        const command = message.command;
        const spec = XHS_READ_COMMAND_SPECS[command];
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
        const gateBundle = buildLoopbackXhsReadGateBundle({
            options,
            abilityAction: asString(ability.action),
            runId: message.runId,
            requestId: message.id,
            commandRequestId: message.commandParams.request_id,
            gateInvocationId: message.commandParams.gate_invocation_id,
            sessionId: message.sessionId,
            profile: "loopback_profile"
        });
        const consumerGateResult = gateBundle.consumerGateResult;
        const successObservability = {
            page_state: {
                page_kind: spec.pageKind,
                url: spec.pageUrl,
                title: spec.pageTitle,
                ready_state: "complete",
                observation_status: "complete"
            },
            key_requests: [],
            failure_site: null
        };
        const buildSuccessfulResult = (capabilityResult, overrides) => ({
            kind: "result",
            id: message.id,
            ok: true,
            payload: {
                summary: capabilityResult === undefined
                    ? {
                        ...gateBundle.payload
                    }
                    : {
                        capability_result: capabilityResult,
                        ...gateBundle.payload
                    },
                observability: {
                    ...successObservability,
                    ...(overrides?.key_requests ? { key_requests: overrides.key_requests } : {})
                }
            }
        });
        if (consumerGateResult.gate_decision === "blocked") {
            const isEditorInputValidation = options.validation_action === "editor_input";
            const editorInputFailureSignals = Array.isArray(consumerGateResult.gate_reasons)
                ? consumerGateResult.gate_reasons.map((reason) => String(reason))
                : ["EXECUTION_MODE_GATE_BLOCKED"];
            return {
                kind: "result",
                id: message.id,
                ok: false,
                error: {
                    code: "ERR_EXECUTION_FAILED",
                    message: `执行模式门禁阻断了当前 ${command} 请求`
                },
                payload: {
                    details: {
                        ability_id: String(ability.id ?? spec.abilityId),
                        stage: "execution",
                        reason: "EXECUTION_MODE_GATE_BLOCKED",
                        ...(isEditorInputValidation
                            ? {
                                validation_action: "editor_input",
                                target_page: "creator_publish_tab",
                                focus_confirmed: false,
                                preserved_after_blur: false,
                                failure_signals: editorInputFailureSignals,
                                minimum_replay: ["focus_editor", "type_short_text", "blur_or_reobserve"],
                                out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
                            }
                            : {})
                    },
                    ...gateBundle.payload
                }
            };
        }
        if (consumerGateResult.effective_execution_mode === "dry_run" ||
            consumerGateResult.effective_execution_mode === "recon") {
            return buildSuccessfulResult({
                ability_id: String(ability.id ?? spec.abilityId),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "partial",
                data_ref: {
                    [spec.dataRefKey]: String(input[spec.dataRefKey] ?? "")
                },
                metrics: {
                    count: 0
                }
            });
        }
        if (consumerGateResult.effective_execution_mode === "live_write" &&
            options.validation_action === "editor_input") {
            const validationText = typeof options.validation_text === "string" && options.validation_text.trim().length > 0
                ? options.validation_text.trim()
                : "WebEnvoy editor_input validation";
            const interactionResult = {
                validation_action: "editor_input",
                target_page: "creator_publish_tab",
                focus_confirmed: false,
                preserved_after_blur: false,
                success_signals: [],
                failure_signals: ["EDITOR_INPUT_VALIDATION_REQUIRED"],
                minimum_replay: ["focus_editor", "type_short_text", "blur_or_reobserve"],
                out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
            };
            return {
                kind: "result",
                id: message.id,
                ok: false,
                payload: {
                    details: {
                        ability_id: String(ability.id ?? "xhs.issue208.editor_input"),
                        stage: "execution",
                        reason: "EDITOR_INPUT_VALIDATION_REQUIRED",
                        ...interactionResult,
                        consumer_gate_result: gateBundle.payload.consumer_gate_result,
                        request_admission_result: gateBundle.payload.request_admission_result,
                        execution_audit: gateBundle.payload.execution_audit,
                        approval_record: gateBundle.payload.approval_record,
                        audit_record: gateBundle.payload.audit_record
                    },
                    ...gateBundle.payload,
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
                        ...gateBundle.payload,
                        interaction_result: interactionResult
                    },
                    observability: {
                        page_state: {
                            page_kind: "compose",
                            url: "https://creator.xiaohongshu.com/publish/publish",
                            title: "Creator Publish",
                            ready_state: "complete",
                            observation_status: "complete"
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
        if (simulated === "missing_capability_result") {
            return buildSuccessfulResult(undefined);
        }
        if (simulated === "capability_result_not_object") {
            return buildSuccessfulResult("invalid");
        }
        if (simulated === "capability_result_missing_layer") {
            return buildSuccessfulResult({
                ability_id: String(ability.id ?? spec.abilityId),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "success"
            });
        }
        if (simulated === "capability_result_invalid_outcome") {
            return buildSuccessfulResult({
                ability_id: String(ability.id ?? spec.abilityId),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "blocked"
            });
        }
        if (simulated === "success") {
            return buildSuccessfulResult({
                ability_id: String(ability.id ?? spec.abilityId),
                layer: String(ability.layer ?? "L3"),
                action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                outcome: "success",
                data_ref: spec.successDataRef(input),
                metrics: {
                    count: 2,
                    duration_ms: 12
                }
            }, {
                key_requests: [
                    {
                        request_id: "req-loopback-001",
                        stage: "request",
                        method: "POST",
                        url: spec.requestUrl,
                        outcome: "completed",
                        status_code: 200
                    }
                ]
            });
        }
        return {
            kind: "result",
            id: message.id,
            ok: false,
            error: {
                code: "ERR_EXECUTION_FAILED",
                message: simulated === "login_required"
                    ? `登录态缺失，无法执行 ${command}`
                    : simulated === "account_abnormal"
                        ? "账号异常，平台拒绝当前请求"
                        : simulated === "browser_env_abnormal"
                            ? "浏览器环境异常，平台拒绝当前请求"
                            : simulated === "captcha_required"
                                ? "平台要求额外人机验证，无法继续执行"
                                : simulated === "signature_entry_missing"
                                    ? "页面签名入口不可用"
                                    : spec.failureSummary
            },
            payload: {
                details: {
                    ability_id: String(ability.id ?? spec.abilityId),
                    stage: "execution",
                    reason: simulated === "login_required"
                        ? "SESSION_EXPIRED"
                        : simulated === "account_abnormal"
                            ? "ACCOUNT_ABNORMAL"
                            : simulated === "browser_env_abnormal"
                                ? "BROWSER_ENV_ABNORMAL"
                                : simulated === "captcha_required"
                                    ? "CAPTCHA_REQUIRED"
                                    : simulated === "signature_entry_missing"
                                        ? "SIGNATURE_ENTRY_MISSING"
                                        : "GATEWAY_INVOKER_FAILED"
                },
                ...gateBundle.payload,
                observability: {
                    page_state: {
                        page_kind: simulated === "login_required" ? "login" : spec.pageKind,
                        url: simulated === "login_required"
                            ? "https://www.xiaohongshu.com/login"
                            : spec.pageUrl,
                        title: spec.pageTitle,
                        ready_state: "complete",
                        observation_status: "complete"
                    },
                    key_requests: simulated === "signature_entry_missing"
                        ? []
                        : [
                            {
                                request_id: "req-loopback-001",
                                stage: "request",
                                method: "POST",
                                url: spec.requestUrl,
                                outcome: "failed",
                                status_code: simulated === "account_abnormal"
                                    ? 461
                                    : simulated === "browser_env_abnormal"
                                        ? 200
                                        : simulated === "captcha_required"
                                            ? 429
                                            : simulated === "gateway_invoker_failed"
                                                ? 500
                                                : undefined,
                                failure_reason: simulated
                            }
                        ],
                    failure_site: {
                        stage: simulated === "signature_entry_missing" ? "action" : "request",
                        component: simulated === "signature_entry_missing" ? "page" : "network",
                        target: simulated === "signature_entry_missing"
                            ? "window._webmsxyw"
                            : spec.requestUrl,
                        summary: simulated
                    }
                },
                diagnosis: {
                    category: simulated === "signature_entry_missing" ? "page_changed" : "request_failed",
                    stage: simulated === "signature_entry_missing" ? "action" : "request",
                    component: simulated === "signature_entry_missing" ? "page" : "network",
                    failure_site: {
                        stage: simulated === "signature_entry_missing" ? "action" : "request",
                        component: simulated === "signature_entry_missing" ? "page" : "network",
                        target: simulated === "signature_entry_missing"
                            ? "window._webmsxyw"
                            : spec.requestUrl,
                        summary: simulated
                    },
                    evidence: [simulated]
                }
            }
        };
    }
}
class InMemoryBackgroundRelay {
    hostPort;
    contentPort;
    relayPath;
    #pendingForward = new Map();
    #sessionId = "nm-session-001";
    constructor(hostPort, contentPort, relayPath) {
        this.hostPort = hostPort;
        this.contentPort = contentPort;
        this.relayPath = relayPath;
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
                        relay_path: this.relayPath
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
                        relay_path: this.relayPath
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
            if (XHS_READ_COMMANDS.has(command)) {
                const ability = typeof commandParams.ability === "object" && commandParams.ability !== null
                    ? commandParams.ability
                    : {};
                const options = typeof commandParams.options === "object" && commandParams.options !== null
                    ? commandParams.options
                    : {};
                const gateBundle = buildLoopbackXhsReadGateBundle({
                    options,
                    abilityAction: asString(ability.action),
                    runId,
                    requestId: request.id,
                    commandRequestId: commandParams.request_id,
                    gateInvocationId: commandParams.gate_invocation_id,
                    sessionId,
                    profile: "loopback_profile"
                });
                gatePayload = gateBundle.payload;
                if (gateBundle.consumerGateResult.gate_decision === "blocked") {
                    const isEditorInputValidation = options.validation_action === "editor_input";
                    const editorInputFailureSignals = Array.isArray(gateBundle.consumerGateResult.gate_reasons)
                        ? gateBundle.consumerGateResult.gate_reasons.map((reason) => String(reason))
                        : ["EXECUTION_MODE_GATE_BLOCKED"];
                    this.hostPort.postMessage({
                        kind: "response",
                        envelope: {
                            id: request.id,
                            status: "error",
                            summary: {
                                relay_path: this.relayPath
                            },
                            payload: {
                                details: {
                                    ability_id: String(ability.id ??
                                        XHS_READ_COMMAND_DEFAULT_ABILITY_IDS[command] ??
                                        "xhs.note.search.v1"),
                                    stage: "execution",
                                    reason: "EXECUTION_MODE_GATE_BLOCKED",
                                    ...(isEditorInputValidation
                                        ? {
                                            validation_action: "editor_input",
                                            target_page: "creator_publish_tab",
                                            focus_confirmed: false,
                                            preserved_after_blur: false,
                                            failure_signals: editorInputFailureSignals,
                                            minimum_replay: ["focus_editor", "type_short_text", "blur_or_reobserve"],
                                            out_of_scope_actions: ["image_upload", "submit", "publish_confirm"]
                                        }
                                        : {})
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
                        relay_path: this.relayPath
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
                    relay_path: this.relayPath
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
export const createInMemoryLoopbackTransport = (relayPath) => {
    const [hostPort, backgroundHostPort] = createPortPair();
    const [backgroundContentPort, contentPort] = createPortPair();
    new InMemoryContentScriptRuntime(contentPort);
    new InMemoryBackgroundRelay(backgroundHostPort, backgroundContentPort, relayPath);
    return new InMemoryHostTransport(hostPort);
};
