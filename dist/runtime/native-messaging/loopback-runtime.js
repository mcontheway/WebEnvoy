import { BRIDGE_PROTOCOL, ensureBridgeRequestEnvelope } from "./protocol.js";
import { buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const resolveApprovalRecord = (options) => asRecord(options.approval_record) ?? asRecord(options.approval);
const buildLoopbackXhsSearchGateBundle = (input) => {
    const approvalRecord = resolveApprovalRecord(input.options);
    const decisionId = `gate_decision_${input.runId}_${input.requestId}`;
    const gate = buildLoopbackGate(input.options, input.abilityAction, {
        runId: input.runId,
        decisionId,
        approvalId: asString(approvalRecord?.approval_id) ?? undefined
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
        if (message.command === "xhs.search") {
            return this.handleXhsSearch(message);
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
    handleXhsSearch(message) {
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
        const gateBundle = buildLoopbackXhsSearchGateBundle({
            options,
            abilityAction: asString(ability.action),
            runId: message.runId,
            requestId: message.id,
            sessionId: message.sessionId,
            profile: "loopback_profile"
        });
        const consumerGateResult = gateBundle.consumerGateResult;
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
                    ...gateBundle.payload
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
                        ...gateBundle.payload
                    },
                    observability: {
                        page_state: {
                            page_kind: "search",
                            url: "https://www.xiaohongshu.com/search_result",
                            title: "Search Result",
                            ready_state: "complete",
                            observation_status: "complete"
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
                        ...gateBundle.payload,
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
                        ...gateBundle.payload
                    },
                    observability: {
                        page_state: {
                            page_kind: "search",
                            url: "https://www.xiaohongshu.com/search_result",
                            title: "Search Result",
                            ready_state: "complete",
                            observation_status: "complete"
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
                            : simulated === "captcha_required"
                                ? "平台要求额外人机验证，无法继续执行"
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
                                : simulated === "captcha_required"
                                    ? "CAPTCHA_REQUIRED"
                                    : simulated === "signature_entry_missing"
                                        ? "SIGNATURE_ENTRY_MISSING"
                                        : "GATEWAY_INVOKER_FAILED"
                },
                ...gateBundle.payload,
                observability: {
                    page_state: {
                        page_kind: simulated === "login_required" ? "login" : "search",
                        url: simulated === "login_required"
                            ? "https://www.xiaohongshu.com/login"
                            : "https://www.xiaohongshu.com/search_result",
                        title: "Search Result",
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
                                url: "/api/sns/web/v1/search/notes",
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
                            : "/api/sns/web/v1/search/notes",
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
                            : "/api/sns/web/v1/search/notes",
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
            if (command === "xhs.search") {
                const ability = typeof commandParams.ability === "object" && commandParams.ability !== null
                    ? commandParams.ability
                    : {};
                const options = typeof commandParams.options === "object" && commandParams.options !== null
                    ? commandParams.options
                    : {};
                const gateBundle = buildLoopbackXhsSearchGateBundle({
                    options,
                    abilityAction: asString(ability.action),
                    runId,
                    requestId: request.id,
                    sessionId,
                    profile: "loopback_profile"
                });
                gatePayload = gateBundle.payload;
                if (gateBundle.consumerGateResult.gate_decision === "blocked") {
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
