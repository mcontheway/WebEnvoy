import { buildLoopbackGate } from "./loopback-gate.js";
import { buildLoopbackAuditRecord } from "./loopback-gate-audit.js";
import { buildLoopbackGatePayload } from "./loopback-gate-payload.js";
import { CliError } from "../../core/errors.js";
import { parseXhsCommandInputForContract } from "../../commands/xhs-input.js";
import { resolveXhsGateDecisionId } from "../../../shared/xhs-gate.js";
const asRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
const asString = (value) => typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const XHS_READ_COMMANDS = new Set(["xhs.search", "xhs.detail", "xhs.user_home"]);
export class InMemoryContentScriptRuntime {
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
            const decisionId = resolveXhsGateDecisionId({
                runId: message.runId,
                requestId: message.id,
                commandRequestId: message.commandParams.request_id,
                gateInvocationId: asString(message.commandParams.gate_invocation_id),
                issueScope: options.issue_scope,
                requestedExecutionMode: options.requested_execution_mode
            });
            const gate = buildLoopbackGate(options, asString(ability.action), {
                runId: message.runId,
                requestId: message.id,
                commandRequestId: asString(message.commandParams.request_id) ?? undefined,
                sessionId: message.sessionId,
                gateInvocationId: asString(message.commandParams.gate_invocation_id) ?? undefined,
                decisionId
            });
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
            const commandName = message.command;
            let normalizedInput = input;
            try {
                normalizedInput = parseXhsCommandInputForContract({
                    command: commandName,
                    abilityId: asString(ability.id) ?? "unknown",
                    abilityAction: asString(ability.action) === "write" || asString(ability.action) === "download"
                        ? asString(ability.action)
                        : "read",
                    payload: input,
                    options
                });
            }
            catch (error) {
                if (error instanceof CliError && error.code === "ERR_CLI_INVALID_ARGS") {
                    return {
                        kind: "result",
                        id: message.id,
                        ok: false,
                        error: {
                            code: error.code,
                            message: error.message
                        },
                        payload: {
                            details: error.details
                        }
                    };
                }
                throw error;
            }
            const commandSpec = commandName === "xhs.detail"
                ? {
                    defaultAbilityId: "xhs.note.detail.v1",
                    page_kind: "detail",
                    url: "https://www.xiaohongshu.com/explore/note-id",
                    title: "Detail",
                    request_method: "POST",
                    request_url: "/api/sns/web/v1/feed",
                    successDataRef: {
                        note_id: String(normalizedInput.note_id ?? "")
                    }
                }
                : commandName === "xhs.user_home"
                    ? {
                        defaultAbilityId: "xhs.user.home.v1",
                        page_kind: "user_home",
                        url: "https://www.xiaohongshu.com/user/profile/user-id",
                        title: "User Home",
                        request_method: "GET",
                        request_url: "/api/sns/web/v1/user/otherinfo",
                        successDataRef: {
                            user_id: String(normalizedInput.user_id ?? "")
                        }
                    }
                    : {
                        defaultAbilityId: "xhs.note.search.v1",
                        page_kind: "search",
                        url: "https://www.xiaohongshu.com/search_result",
                        title: "Search Result",
                        request_method: "POST",
                        request_url: "/api/sns/web/v1/search/notes",
                        successDataRef: {
                            query: String(normalizedInput.query ?? ""),
                            search_id: "loopback-search-id"
                        }
                    };
            const successObservability = {
                page_state: {
                    page_kind: commandSpec.page_kind,
                    url: commandSpec.url,
                    title: commandSpec.title,
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
                            ...gateBundle
                        }
                        : {
                            capability_result: capabilityResult,
                            ...gateBundle
                        },
                    observability: {
                        ...successObservability,
                        ...(overrides?.key_requests ? { key_requests: overrides.key_requests } : {})
                    }
                }
            });
            if (consumerGateResult.gate_decision === "blocked") {
                return {
                    kind: "result",
                    id: message.id,
                    ok: false,
                    error: {
                        code: "ERR_EXECUTION_FAILED",
                        message: `执行模式门禁阻断了当前 ${commandName} 请求`
                    },
                    payload: {
                        details: {
                            ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
                            stage: "execution",
                            reason: "EXECUTION_MODE_GATE_BLOCKED"
                        },
                        ...gateBundle
                    }
                };
            }
            if (consumerGateResult.effective_execution_mode === "dry_run" ||
                consumerGateResult.effective_execution_mode === "recon") {
                return buildSuccessfulResult({
                    ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
                    layer: String(ability.layer ?? "L3"),
                    action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                    outcome: "partial",
                    data_ref: commandSpec.successDataRef,
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
                    ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
                    action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                    outcome: "success"
                });
            }
            if (simulated === "capability_result_invalid_outcome") {
                return buildSuccessfulResult({
                    ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
                    layer: String(ability.layer ?? "L3"),
                    action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                    outcome: "blocked"
                });
            }
            if (simulated === "success") {
                return buildSuccessfulResult({
                    ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
                    layer: String(ability.layer ?? "L3"),
                    action: String(consumerGateResult.action_type ?? ability.action ?? "read"),
                    outcome: "success",
                    data_ref: commandSpec.successDataRef,
                    metrics: {
                        count: 1,
                        duration_ms: 12
                    }
                }, {
                    key_requests: [
                        {
                            request_id: "req-loopback-001",
                            stage: "request",
                            method: commandSpec.request_method,
                            url: commandSpec.request_url,
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
                        ? `登录态缺失，无法执行 ${commandName}`
                        : simulated === "account_abnormal"
                            ? "账号异常，平台拒绝当前请求"
                            : simulated === "browser_env_abnormal"
                                ? "浏览器环境异常，平台拒绝当前请求"
                                : simulated === "captcha_required"
                                    ? "平台要求额外人机验证，无法继续执行"
                                    : simulated === "signature_entry_missing"
                                        ? "页面签名入口不可用"
                                        : `网关调用失败，当前上下文不足以完成 ${commandName} 请求`
                },
                payload: {
                    details: {
                        ability_id: String(ability.id ?? commandSpec.defaultAbilityId),
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
                    ...gateBundle,
                    observability: {
                        page_state: {
                            page_kind: simulated === "login_required" ? "login" : commandSpec.page_kind,
                            url: simulated === "login_required" ? "https://www.xiaohongshu.com/login" : commandSpec.url,
                            title: commandSpec.title,
                            ready_state: "complete",
                            observation_status: "complete"
                        },
                        key_requests: simulated === "signature_entry_missing"
                            ? []
                            : [
                                {
                                    request_id: "req-loopback-001",
                                    stage: "request",
                                    method: commandSpec.request_method,
                                    url: commandSpec.request_url,
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
                                : commandSpec.request_url,
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
                                : commandSpec.request_url,
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
